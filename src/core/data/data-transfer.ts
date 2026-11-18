import fs from "node:fs";
import path from "node:path";
import { environment, LocalStorage } from "@raycast/api";
import {
  assertPrefixWritable,
  assertWritable,
  isCorruptJson,
  listKeySuffixes,
  readJson,
  StorageUnreadableError,
  updateJson,
} from "@/core/fs/storage";
import { getAllProjectMetadata, type ProjectMetadata } from "@/core/metadata/project-metadata";
import { collectionTaxonomy, genreTaxonomy, roleTaxonomy, stageTaxonomy } from "@/core/metadata/taxonomies";
import type { TaxonomyOption } from "@/core/metadata/taxonomy";
import { getPinnedCollections } from "@/core/metadata/collection-pins";
import { getTrackMap, setTrackMap, removeTrackMap, type TrackMap } from "@/core/metadata/collection-order";
import { getRoleMap, setRoleMap, removeRoleMap, type RoleMap } from "@/core/metadata/collection-roles";
import { sameFolder, type FolderIdentity } from "@/core/fs/project-snapshot";
import type { Project } from "@/core/projects/types";

export const DATA_FORMAT = "daw-project-manager-data";
export const DATA_VERSION = 1;

const PROJECT_METADATA_KEY = "project-metadata";
const TAXONOMY_KEYS = ["stage-options", "genre-options", "collection-options", "role-options"] as const;
const PINS_KEY = "collection-pins";
const ORDER_PREFIX = "collection-order:";
const ROLE_PREFIX = "collection-roles:";
const DELETED_KEY = "deleted-projects";
const GENRE_SEED_KEY = "genre-options-seeded-v1";

// 这些存储记录的是本机磁盘状态，不是用户数据：导入不改磁盘，快照仍然有效；
// Replace 也不清空它，否则会漏掉上次扫描之后在 Finder 里做的改名或删除。
const LOCAL_STATE_PREFIXES = ["project-snapshot:"];

export type DataSnapshot = {
  projectMetadata: Record<string, ProjectMetadata>;
  taxonomies: Record<string, TaxonomyOption[]>;
  collectionPins: string[];
  collectionOrders: Record<string, TrackMap>;
  collectionRoles: Record<string, RoleMap>;
  deletedProjects: DeletedRecord[];
};

export type DataFile = {
  format: string;
  version: number;
  extension: string;
  exportedAt: string;
  identities: Record<string, FolderIdentity>;
  data: DataSnapshot;
};

export type DeletedRecord = FolderIdentity & {
  id: string;
  deletedAt: number;
  metadata: ProjectMetadata | null;
  orders: Record<string, number>;
  roles: Record<string, string>;
  docs: { name: string; kind: string }[];
  dataRestored?: boolean;
};

export type ImportMode = "merge" | "replace";

export type ImportReport = {
  projects: number;
  rematched: number;
  unmatched: number;
  skippedTracks: number;
  backupPath: string | null;
  renameTrackingSkipped: boolean;
  naturalKeyFields: string[];
};

/** 哪一类数据损坏：用于提示里写明，而不是只说"数据读不出"。 */
export type CorruptDataKind = "metadata" | "categories" | "pins" | "orders" | "roles" | "deleted";

export class CorruptDataError extends StorageUnreadableError {
  readonly kind: CorruptDataKind;

  constructor(kind: CorruptDataKind) {
    super();
    this.kind = kind;
    this.name = "CorruptDataError";
  }
}

export class DataFileError extends Error {
  constructor(
    public readonly reason: "parse" | "format" | "version" | "extension" | "structure",
    message: string,
  ) {
    super(message);
    this.name = "DataFileError";
  }
}

// ---------- 校验 ----------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNumberMap(value: unknown): value is Record<string, number> {
  return (
    isPlainObject(value) && Object.values(value).every((n) => typeof n === "number" && Number.isFinite(n) && n >= 1)
  );
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((s) => typeof s === "string" && s.trim() !== "");
}

function isTaxonomyOption(value: unknown): value is TaxonomyOption {
  return isPlainObject(value) && typeof value.id === "string" && typeof value.name === "string";
}

function isMetadata(value: unknown): value is ProjectMetadata {
  if (!isPlainObject(value)) return false;
  return (
    (value.stageId === null || typeof value.stageId === "string") &&
    isStringArray(value.genreIds) &&
    isStringArray(value.collectionIds) &&
    typeof value.pinned === "boolean" &&
    (value.pinOrder === null || typeof value.pinOrder === "number") &&
    typeof value.notes === "string" &&
    isStringArray(value.externalBounceFolders) &&
    isStringArray(value.externalBounceFiles) &&
    isStringArray(value.bounceAliases) &&
    Array.isArray(value.previousBounceNames) &&
    value.previousBounceNames.every(
      (item) => isPlainObject(item) && typeof item.name === "string" && typeof item.before === "number",
    ) &&
    isStringArray(value.excludedSharedBounces) &&
    isPlainObject(value.externalBounceFingerprints)
  );
}

function isDeletedRecord(value: unknown): value is DeletedRecord {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.deletedAt === "number" &&
    typeof value.birthtimeMs === "number" &&
    (value.metadata === null || isMetadata(value.metadata)) &&
    isNumberMap(value.orders) &&
    isStringMap(value.roles) &&
    Array.isArray(value.docs)
  );
}

/** 只校验、不修正：任何会被现有 parse 函数丢弃或改写的结构都算不合法。 */
export function parseDataFile(raw: string, extensionName: string): DataFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DataFileError("parse", "The file is not valid JSON.");
  }

  if (!isPlainObject(parsed)) throw new DataFileError("structure", "The file has an unexpected structure.");
  if (parsed.format !== DATA_FORMAT) throw new DataFileError("format", "This is not an exported data file.");
  if (parsed.version !== DATA_VERSION) {
    throw new DataFileError("version", `Version ${String(parsed.version)} is not supported.`);
  }
  if (parsed.extension !== extensionName) {
    throw new DataFileError("extension", `The file was exported by "${String(parsed.extension)}".`);
  }

  const data = parsed.data;
  if (!isPlainObject(data)) throw new DataFileError("structure", "The file has no data section.");

  const projectMetadata = data.projectMetadata;
  if (!isPlainObject(projectMetadata) || !Object.values(projectMetadata).every(isMetadata)) {
    throw new DataFileError("structure", "Project data in the file is not valid.");
  }

  const taxonomies = data.taxonomies;
  if (!isPlainObject(taxonomies)) throw new DataFileError("structure", "Category data in the file is not valid.");
  for (const key of TAXONOMY_KEYS) {
    const options = taxonomies[key];
    if (!Array.isArray(options) || !options.every(isTaxonomyOption)) {
      throw new DataFileError("structure", "Category data in the file is not valid.");
    }
  }

  if (!isStringArray(data.collectionPins)) {
    throw new DataFileError("structure", "Pinned collections in the file are not valid.");
  }

  const collectionOrders = data.collectionOrders;
  if (!isPlainObject(collectionOrders) || !Object.values(collectionOrders).every(isNumberMap)) {
    throw new DataFileError("structure", "Track numbers in the file are not valid.");
  }

  const collectionRoles = data.collectionRoles;
  if (!isPlainObject(collectionRoles) || !Object.values(collectionRoles).every(isStringMap)) {
    throw new DataFileError("structure", "Roles in the file are not valid.");
  }

  const deletedProjects = data.deletedProjects;
  if (!Array.isArray(deletedProjects) || !deletedProjects.every(isDeletedRecord)) {
    throw new DataFileError("structure", "Recently deleted projects in the file are not valid.");
  }

  const identities = isPlainObject(parsed.identities) ? parsed.identities : {};
  const cleanIdentities: Record<string, FolderIdentity> = {};
  for (const [id, identity] of Object.entries(identities)) {
    if (isPlainObject(identity) && typeof identity.birthtimeMs === "number") {
      cleanIdentities[id] = {
        birthtimeMs: identity.birthtimeMs,
        inode: typeof identity.inode === "number" ? identity.inode : undefined,
      };
    }
  }

  return {
    format: DATA_FORMAT,
    version: DATA_VERSION,
    extension: extensionName,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : "",
    identities: cleanIdentities,
    data: {
      projectMetadata: projectMetadata as Record<string, ProjectMetadata>,
      taxonomies: {
        "stage-options": taxonomies["stage-options"] as TaxonomyOption[],
        "genre-options": taxonomies["genre-options"] as TaxonomyOption[],
        "collection-options": taxonomies["collection-options"] as TaxonomyOption[],
        "role-options": taxonomies["role-options"] as TaxonomyOption[],
      },
      collectionPins: data.collectionPins,
      collectionOrders: collectionOrders as Record<string, TrackMap>,
      collectionRoles: collectionRoles as Record<string, RoleMap>,
      deletedProjects,
    },
  };
}

// ---------- 导出 ----------

async function checkWritable(kind: CorruptDataKind, check: () => Promise<void>): Promise<void> {
  try {
    await check();
  } catch (error) {
    if (error instanceof StorageUnreadableError) throw new CorruptDataError(kind);
    throw error;
  }
}

/** 导出前预检：任何一份要导出的存储损坏就拒绝，避免导出一份看起来正常、其实丢了数据的备份。 */
export async function assertExportable(): Promise<void> {
  await checkWritable("metadata", () => assertWritable(PROJECT_METADATA_KEY));
  for (const key of TAXONOMY_KEYS) await checkWritable("categories", () => assertWritable(key));
  await checkWritable("pins", () => assertWritable(PINS_KEY));
  await checkWritable("deleted", () => assertWritable(DELETED_KEY));
  await checkWritable("orders", () => assertPrefixWritable(ORDER_PREFIX));
  await checkWritable("roles", () => assertPrefixWritable(ROLE_PREFIX));
}

function readDeletedRecords(): Promise<DeletedRecord[]> {
  return readJson<DeletedRecord[]>(
    DELETED_KEY,
    (value) => (Array.isArray(value) ? (value as DeletedRecord[]) : []),
    () => [],
  );
}

async function readOrders(): Promise<Record<string, TrackMap>> {
  const out: Record<string, TrackMap> = {};
  for (const collectionId of await listKeySuffixes(ORDER_PREFIX)) {
    out[collectionId] = await getTrackMap(collectionId);
  }
  return out;
}

async function readRoles(): Promise<Record<string, RoleMap>> {
  const out: Record<string, RoleMap> = {};
  for (const collectionId of await listKeySuffixes(ROLE_PREFIX)) {
    out[collectionId] = await getRoleMap(collectionId);
  }
  return out;
}

/** 项目文件夹的身份：用文件夹本身，不用 Project.createdAt（它可能是子文件夹的创建时间）。 */
export function collectIdentities(projects: Project[]): Record<string, FolderIdentity> {
  const identities: Record<string, FolderIdentity> = {};
  for (const project of projects) {
    try {
      const stats = fs.statSync(project.folderPath);
      identities[project.id] = { birthtimeMs: stats.birthtimeMs, inode: stats.ino };
    } catch {
      // 文件夹不可用：跳过这一项，导出照常进行。
    }
  }
  return identities;
}

export async function buildSnapshot(projects: Project[]): Promise<DataFile> {
  await assertExportable();

  const taxonomies: Record<string, TaxonomyOption[]> = {
    "stage-options": await stageTaxonomy.get(),
    // Genre 走 get()：文件里存的一定是补过默认值之后的状态。
    "genre-options": await genreTaxonomy.get(),
    "collection-options": await collectionTaxonomy.get(),
    "role-options": await roleTaxonomy.get(),
  };

  return {
    format: DATA_FORMAT,
    version: DATA_VERSION,
    extension: environment.extensionName,
    exportedAt: new Date().toISOString(),
    identities: collectIdentities(projects),
    data: {
      projectMetadata: await getAllProjectMetadata(),
      taxonomies,
      collectionPins: await getPinnedCollections(),
      collectionOrders: await readOrders(),
      collectionRoles: await readRoles(),
      deletedProjects: await readDeletedRecords(),
    },
  };
}

// ---------- 文件命名 ----------

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function exportFileName(now: Date): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${environment.extensionName}-data-${date}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}

export function backupFileName(now: Date): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${environment.extensionName}-backup-before-import-${date}-${time}.json`;
}

/** 撞名时在 .json 前依次加 " 2"、" 3"……；用 wx 写入，避免检查和写入之间的竞态。 */
export function writeJsonFile(folder: string, fileName: string, content: string): string {
  const base = fileName.endsWith(".json") ? fileName.slice(0, -".json".length) : fileName;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(folder, index === 1 ? `${base}.json` : `${base} ${index}.json`);
    try {
      fs.writeFileSync(candidate, content, { encoding: "utf8", flag: "wx" });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Could not find an unused file name.");
}

export async function exportData(folder: string, projects: Project[]): Promise<string> {
  const snapshot = await buildSnapshot(projects);
  return writeJsonFile(folder, exportFileName(new Date()), JSON.stringify(snapshot, null, 2));
}

// ---------- 改名追踪 ----------

type RenameResult = {
  data: DataSnapshot;
  rematched: number;
  unmatched: number;
  skipped: boolean;
};

function projectIdsIn(data: DataSnapshot): Set<string> {
  const ids = new Set<string>(Object.keys(data.projectMetadata));
  for (const map of Object.values(data.collectionOrders)) for (const id of Object.keys(map)) ids.add(id);
  for (const map of Object.values(data.collectionRoles)) for (const id of Object.keys(map)) ids.add(id);
  return ids;
}

function renameProjectId(data: DataSnapshot, from: string, to: string): void {
  if (from in data.projectMetadata) {
    data.projectMetadata[to] = data.projectMetadata[from];
    delete data.projectMetadata[from];
  }
  for (const map of Object.values(data.collectionOrders)) {
    if (from in map) {
      map[to] = map[from];
      delete map[from];
    }
  }
  for (const map of Object.values(data.collectionRoles)) {
    if (from in map) {
      map[to] = map[from];
      delete map[from];
    }
  }
}

/** 文件里的项目 ID 是旧名、而当前文件夹已改名时，把数据挪到新 ID 下。 */
export function trackRenames(
  data: DataSnapshot,
  identities: Record<string, FolderIdentity>,
  projects: Project[] | null,
): RenameResult {
  const copy: DataSnapshot = JSON.parse(JSON.stringify(data)) as DataSnapshot;
  if (!projects) return { data: copy, rematched: 0, unmatched: 0, skipped: true };

  const currentIds = new Set(projects.map((project) => project.id));
  const currentIdentities = collectIdentities(projects);
  let rematched = 0;
  let unmatched = 0;

  for (const id of projectIdsIn(copy)) {
    if (currentIds.has(id)) continue;
    const identity = identities[id];
    const target = identity
      ? projects.find((project) => {
          const current = currentIdentities[project.id];
          return current !== undefined && sameFolder(identity, current);
        })
      : undefined;

    if (!target || target.id === id) {
      unmatched += 1;
      continue;
    }
    // 目标 ID 在文件里已有自己的条目：不改，计入未匹配。
    if (projectIdsIn(copy).has(target.id)) {
      unmatched += 1;
      continue;
    }
    renameProjectId(copy, id, target.id);
    rematched += 1;
  }

  return { data: copy, rematched, unmatched, skipped: false };
}

// ---------- Merge ----------

const NATURAL_KEYS: Record<string, string> = {
  previousBounceNames: "name",
};

function mergeStringArray(current: string[], incoming: string[]): string[] {
  const seen = new Set(current);
  const out = [...current];
  for (const item of incoming) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function mergeObjectArray(current: unknown[], incoming: unknown[], naturalKey: string | undefined): unknown[] {
  const out = [...current];
  if (naturalKey) {
    const seen = new Set(
      current.map((item) => (isPlainObject(item) ? String(item[naturalKey]) : JSON.stringify(item))),
    );
    for (const item of incoming) {
      const key = isPlainObject(item) ? String(item[naturalKey]) : JSON.stringify(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }
  const seen = new Set(current.map((item) => JSON.stringify(item)));
  for (const item of incoming) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function mergeMetadata(current: ProjectMetadata, incoming: ProjectMetadata): ProjectMetadata {
  const out: ProjectMetadata = { ...current };
  for (const [field, value] of Object.entries(incoming)) {
    const existing = (current as unknown as Record<string, unknown>)[field];
    if (Array.isArray(value)) {
      const currentArray = Array.isArray(existing) ? existing : [];
      const isObjectArray = value.some((item) => typeof item === "object" && item !== null);
      (out as unknown as Record<string, unknown>)[field] = isObjectArray
        ? mergeObjectArray(currentArray, value, NATURAL_KEYS[field])
        : mergeStringArray(currentArray as string[], value as string[]);
      continue;
    }
    if (isPlainObject(value)) {
      const currentMap = isPlainObject(existing) ? existing : {};
      (out as unknown as Record<string, unknown>)[field] = { ...value, ...currentMap };
      continue;
    }
    if (existing === undefined || existing === "") {
      (out as unknown as Record<string, unknown>)[field] = value;
    }
  }
  return out;
}

function mergeTaxonomies(
  current: Record<string, TaxonomyOption[]>,
  incoming: Record<string, TaxonomyOption[]>,
): { merged: Record<string, TaxonomyOption[]>; idMap: Map<string, string> } {
  const merged: Record<string, TaxonomyOption[]> = {};
  const idMap = new Map<string, string>();

  for (const key of TAXONOMY_KEYS) {
    const existing = current[key] ?? [];
    const byName = new Map(existing.map((option) => [option.name.trim().toLowerCase(), option]));
    const out = [...existing];
    for (const option of incoming[key] ?? []) {
      const match = byName.get(option.name.trim().toLowerCase());
      if (match) {
        if (match.id !== option.id) idMap.set(option.id, match.id);
        continue;
      }
      out.push(option);
    }
    merged[key] = out;
  }

  return { merged, idMap };
}

function remapIds(ids: string[], idMap: Map<string, string>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const mapped = idMap.get(id) ?? id;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

function mergeDeleted(current: DeletedRecord[], incoming: DeletedRecord[]): DeletedRecord[] {
  const seen = new Set(current.map((record) => `${record.id}\n${record.deletedAt}`));
  const out = [...current];
  for (const record of incoming) {
    const key = `${record.id}\n${record.deletedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

export async function mergeData(file: DataFile, projects: Project[] | null): Promise<ImportReport> {
  // 先预检：分类的 get() 在存储损坏时会悄悄返回默认值，读之前必须先确认能写。
  await assertImportWritable(file.data.collectionOrders, file.data.collectionRoles);

  const tracked = trackRenames(file.data, file.identities, projects);
  const incoming = tracked.data;

  const currentTaxonomies: Record<string, TaxonomyOption[]> = {
    "stage-options": await stageTaxonomy.get(),
    "genre-options": await genreTaxonomy.get(),
    "collection-options": await collectionTaxonomy.get(),
    "role-options": await roleTaxonomy.get(),
  };
  const { merged: mergedTaxonomies, idMap } = mergeTaxonomies(currentTaxonomies, incoming.taxonomies);

  const currentMetadata = await getAllProjectMetadata();
  const mergedMetadata: Record<string, ProjectMetadata> = { ...currentMetadata };
  for (const [id, metadata] of Object.entries(incoming.projectMetadata)) {
    const remapped: ProjectMetadata = {
      ...metadata,
      genreIds: remapIds(metadata.genreIds, idMap),
      collectionIds: remapIds(metadata.collectionIds, idMap),
    };
    mergedMetadata[id] = id in currentMetadata ? mergeMetadata(currentMetadata[id], remapped) : remapped;
  }

  const currentPins = await getPinnedCollections();
  const mergedPins = mergeStringArray(currentPins, remapIds(incoming.collectionPins, idMap));

  const currentOrders = await readOrders();
  const mergedOrders: Record<string, TrackMap> = { ...currentOrders };
  let skippedTracks = 0;
  for (const [collectionId, map] of Object.entries(incoming.collectionOrders)) {
    const target = { ...(mergedOrders[collectionId] ?? {}) };
    const taken = new Set(Object.values(target));
    for (const [projectId, number] of Object.entries(map)) {
      if (projectId in target) continue;
      if (taken.has(number)) {
        skippedTracks += 1;
        continue;
      }
      target[projectId] = number;
      taken.add(number);
    }
    mergedOrders[collectionId] = target;
  }

  const currentRoles = await readRoles();
  const mergedRoles: Record<string, RoleMap> = { ...currentRoles };
  for (const [collectionId, map] of Object.entries(incoming.collectionRoles)) {
    const target = { ...(mergedRoles[collectionId] ?? {}) };
    for (const [projectId, role] of Object.entries(map)) {
      if (projectId in target) continue;
      target[projectId] = role;
    }
    mergedRoles[collectionId] = target;
  }

  const mergedDeleted = mergeDeleted(await readDeletedRecords(), incoming.deletedProjects);

  for (const key of TAXONOMY_KEYS) {
    await updateJson(
      key,
      (value) => (Array.isArray(value) ? (value as TaxonomyOption[]) : []),
      () => [],
      () => mergedTaxonomies[key],
    );
  }
  await LocalStorage.setItem(GENRE_SEED_KEY, "true");

  await updateJson(
    PROJECT_METADATA_KEY,
    (value) => (isPlainObject(value) ? value : {}),
    () => ({}),
    () => mergedMetadata,
  );
  await updateJson(
    PINS_KEY,
    (value) => (isStringArray(value) ? value : []),
    () => [],
    () => mergedPins,
  );
  for (const [collectionId, map] of Object.entries(mergedOrders)) await setTrackMap(collectionId, map);
  for (const [collectionId, map] of Object.entries(mergedRoles)) await setRoleMap(collectionId, map);
  await updateJson(
    DELETED_KEY,
    (value) => (Array.isArray(value) ? (value as DeletedRecord[]) : []),
    () => [],
    () => mergedDeleted,
  );

  return {
    projects: Object.keys(incoming.projectMetadata).length,
    rematched: tracked.rematched,
    unmatched: tracked.unmatched,
    skippedTracks,
    backupPath: null,
    renameTrackingSkipped: tracked.skipped,
    naturalKeyFields: Object.keys(NATURAL_KEYS),
  };
}

// ---------- Replace ----------

async function assertImportWritable(orders: Record<string, TrackMap>, roles: Record<string, RoleMap>): Promise<void> {
  await checkWritable("metadata", () => assertWritable(PROJECT_METADATA_KEY));
  for (const key of TAXONOMY_KEYS) await checkWritable("categories", () => assertWritable(key));
  await checkWritable("pins", () => assertWritable(PINS_KEY));
  await checkWritable("deleted", () => assertWritable(DELETED_KEY));
  await checkWritable("orders", () => assertPrefixWritable(ORDER_PREFIX));
  await checkWritable("roles", () => assertPrefixWritable(ROLE_PREFIX));
  for (const collectionId of Object.keys(orders)) {
    await checkWritable("orders", () => assertWritable(ORDER_PREFIX + collectionId));
  }
  for (const collectionId of Object.keys(roles)) {
    await checkWritable("roles", () => assertWritable(ROLE_PREFIX + collectionId));
  }
}

export async function replaceData(
  file: DataFile,
  projects: Project[] | null,
  backupFolder: string,
): Promise<ImportReport> {
  // 先预检：分类的 get() 在存储损坏时会悄悄返回默认值，读之前必须先确认能写。
  await assertImportWritable(file.data.collectionOrders, file.data.collectionRoles);

  const tracked = trackRenames(file.data, file.identities, projects);
  const incoming = tracked.data;

  // 备份失败就中止，不做任何改动。
  const backup = await buildSnapshot(projects ?? []);
  const backupPath = writeJsonFile(backupFolder, backupFileName(new Date()), JSON.stringify(backup, null, 2));

  const currentOrders = await readOrders();
  const currentRoles = await readRoles();

  try {
    for (const key of TAXONOMY_KEYS) {
      await updateJson(
        key,
        (value) => (Array.isArray(value) ? (value as TaxonomyOption[]) : []),
        () => [],
        () => incoming.taxonomies[key],
      );
    }
    await LocalStorage.setItem(GENRE_SEED_KEY, "true");

    await updateJson(
      PROJECT_METADATA_KEY,
      (value) => (isPlainObject(value) ? value : {}),
      () => ({}),
      () => incoming.projectMetadata,
    );
    await updateJson(
      PINS_KEY,
      (value) => (isStringArray(value) ? value : []),
      () => [],
      () => incoming.collectionPins,
    );

    for (const [collectionId, map] of Object.entries(incoming.collectionOrders)) {
      await setTrackMap(collectionId, map);
    }
    for (const collectionId of Object.keys(currentOrders)) {
      if (!(collectionId in incoming.collectionOrders)) await removeTrackMap(collectionId);
    }

    for (const [collectionId, map] of Object.entries(incoming.collectionRoles)) {
      await setRoleMap(collectionId, map);
    }
    for (const collectionId of Object.keys(currentRoles)) {
      if (!(collectionId in incoming.collectionRoles)) await removeRoleMap(collectionId);
    }

    // 删除记录只取并集，绝不删除现有记录。
    const mergedDeleted = mergeDeleted(await readDeletedRecords(), incoming.deletedProjects);
    await updateJson(
      DELETED_KEY,
      (value) => (Array.isArray(value) ? (value as DeletedRecord[]) : []),
      () => [],
      () => mergedDeleted,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} (backup: ${backupPath})`);
  }

  return {
    projects: Object.keys(incoming.projectMetadata).length,
    rematched: tracked.rematched,
    unmatched: tracked.unmatched,
    skippedTracks: 0,
    backupPath,
    renameTrackingSkipped: tracked.skipped,
    naturalKeyFields: Object.keys(NATURAL_KEYS),
  };
}

/** 现有存储是否损坏（导入前预检用）。 */
export async function isStorageCorrupt(): Promise<boolean> {
  const all = await LocalStorage.allItems();
  for (const [key, value] of Object.entries(all)) {
    if (typeof value !== "string") continue;
    if (LOCAL_STATE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    if (isCorruptJson(value)) return true;
  }
  return false;
}

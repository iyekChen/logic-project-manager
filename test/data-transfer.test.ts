import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorage, environment } from "@raycast/api";

// 测试桩里没有 Color 等 Raycast 运行时对象；这里用最小实现替代真实分类模块。
vi.mock("@/core/metadata/taxonomies", async () => {
  const { createTaxonomy } = await import("@/core/metadata/taxonomy");
  const genreBase = createTaxonomy("genre-options", []);
  return {
    stageTaxonomy: createTaxonomy("stage-options", []),
    collectionTaxonomy: createTaxonomy("collection-options", []),
    roleTaxonomy: createTaxonomy("role-options", []),
    genreTaxonomy: {
      get: async () => {
        const options = await genreBase.get();
        const seeded = await LocalStorage.getItem<string>("genre-options-seeded-v1");
        if (seeded === "true") return options;
        const existing = new Set(options.map((option) => option.id));
        const additions = [{ id: "house", name: "House" }].filter((option) => !existing.has(option.id));
        await genreBase.save([...options, ...additions]);
        await LocalStorage.setItem("genre-options-seeded-v1", "true");
        return genreBase.get();
      },
      save: genreBase.save,
      reset: genreBase.reset,
    },
  };
});
import {
  buildSnapshot,
  CorruptDataError,
  DataFileError,
  exportData,
  exportFileName,
  backupFileName,
  mergeData,
  parseDataFile,
  replaceData,
  writeJsonFile,
  type DataFile,
} from "@/core/data/data-transfer";
import { genreTaxonomy } from "@/core/metadata/taxonomies";
import type { Project } from "@/core/projects/types";

const EXTENSION = environment.extensionName;

let tempDir: string;

function makeProject(id: string, folderPath: string): Project {
  return {
    id,
    title: id,
    folderPath,
    kind: "folder",
    createdAt: 0,
    inode: 0,
    modifiedAt: 0,
    stageId: null,
    genreIds: [],
    collectionIds: [],
    notes: "",
    lyrics: "",
    pinned: false,
    pinOrder: null,
    setsCount: 0,
    bouncesCount: 0,
    externalBounceFolders: [],
    externalBounceFiles: [],
  };
}

function makeFolder(name: string): string {
  const folder = path.join(tempDir, name);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    stageId: null,
    genreIds: [],
    collectionIds: [],
    pinned: false,
    pinOrder: null,
    notes: "",
    externalBounceFolders: [],
    externalBounceFiles: [],
    bounceAliases: [],
    previousBounceNames: [],
    excludedSharedBounces: [],
    externalBounceFingerprints: {},
    ...overrides,
  };
}

function dataFile(overrides: Partial<DataFile["data"]> = {}, identities: DataFile["identities"] = {}): DataFile {
  return {
    format: "daw-project-manager-data",
    version: 1,
    extension: EXTENSION,
    exportedAt: new Date().toISOString(),
    identities,
    data: {
      projectMetadata: {},
      taxonomies: {
        "stage-options": [],
        "genre-options": [],
        "collection-options": [],
        "role-options": [],
      },
      collectionPins: [],
      collectionOrders: {},
      collectionRoles: {},
      deletedProjects: [],
      ...overrides,
    },
  };
}

async function seed() {
  await LocalStorage.setItem("project-metadata", JSON.stringify({ alpha: metadata({ notes: "hello" }) }));
  await LocalStorage.setItem("stage-options", JSON.stringify([{ id: "demo", name: "Demo", order: 1 }]));
  await LocalStorage.setItem("genre-options", JSON.stringify([{ id: "house", name: "House" }]));
  await LocalStorage.setItem("genre-options-seeded-v1", "true");
  await LocalStorage.setItem("collection-options", JSON.stringify([{ id: "ep", name: "EP" }]));
  await LocalStorage.setItem("role-options", JSON.stringify([{ id: "intro", name: "Intro", order: 1 }]));
  await LocalStorage.setItem("collection-pins", JSON.stringify(["ep"]));
  await LocalStorage.setItem("collection-order:ep", JSON.stringify({ alpha: 1 }));
  await LocalStorage.setItem("collection-roles:ep", JSON.stringify({ alpha: "Intro" }));
  await LocalStorage.setItem(
    "deleted-projects",
    JSON.stringify([
      {
        id: "gone",
        birthtimeMs: 1000,
        inode: 5,
        deletedAt: Date.now(),
        metadata: null,
        orders: {},
        roles: {},
        docs: [],
      },
    ]),
  );
}

async function snapshotStorage(): Promise<Record<string, string>> {
  return LocalStorage.allItems();
}

beforeEach(async () => {
  await LocalStorage.clear();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "data-transfer-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("export and replace round trip", () => {
  it("restores every exported store", async () => {
    await seed();
    const before = await snapshotStorage();
    const file = await buildSnapshot([]);

    await LocalStorage.clear();
    await replaceData(file, [], tempDir);

    const after = await snapshotStorage();
    for (const key of [
      "project-metadata",
      "stage-options",
      "genre-options",
      "collection-options",
      "role-options",
      "collection-pins",
      "collection-order:ep",
      "collection-roles:ep",
      "deleted-projects",
    ]) {
      expect(after[key]).toBe(before[key]);
    }
  });

  it("leaves excluded stores out of the file", async () => {
    await seed();
    await LocalStorage.setItem("onboarding:shared-bounces-asked", "true");
    await LocalStorage.setItem("audio-analysis-cache-v1", JSON.stringify({ a: 1 }));
    await LocalStorage.setItem("als-metadata-cache-v2", JSON.stringify({ b: 2 }));
    await LocalStorage.setItem("bounces-sort-option", "created-desc");
    await LocalStorage.setItem("project-snapshot:/music", JSON.stringify([]));
    fs.mkdirSync(environment.supportPath, { recursive: true });
    fs.writeFileSync(path.join(environment.supportPath, "doc-folders.json"), JSON.stringify({ notes: "/x" }), {
      flag: "w",
    });

    const file = await buildSnapshot([]);
    const text = JSON.stringify(file);

    expect(text).not.toContain("onboarding");
    expect(text).not.toContain("audio-analysis-cache-v1");
    expect(text).not.toContain("als-metadata-cache-v2");
    expect(text).not.toContain("bounces-sort-option");
    expect(text).not.toContain("project-snapshot");
    expect(text).not.toContain("doc-folders");
  });
});

describe("validation", () => {
  const cases: [string, string, string][] = [
    ["bad JSON", "{not json", "parse"],
    ["wrong format", JSON.stringify({ ...dataFile(), format: "other" }), "format"],
    ["wrong version", JSON.stringify({ ...dataFile(), version: 2 }), "version"],
    ["wrong extension", JSON.stringify({ ...dataFile(), extension: "other-extension" }), "extension"],
    ["bad data", JSON.stringify({ ...dataFile(), data: { projectMetadata: 5 } }), "structure"],
  ];

  for (const [label, raw, reason] of cases) {
    it(`rejects ${label} without touching storage`, async () => {
      await seed();
      const before = await snapshotStorage();
      expect(() => parseDataFile(raw, EXTENSION)).toThrow(DataFileError);
      try {
        parseDataFile(raw, EXTENSION);
      } catch (error) {
        expect((error as DataFileError).reason).toBe(reason);
      }
      expect(await snapshotStorage()).toEqual(before);
    });
  }

  it("names the extension found in the file", () => {
    const raw = JSON.stringify({ ...dataFile(), extension: "other-extension" });
    try {
      parseDataFile(raw, EXTENSION);
    } catch (error) {
      expect((error as DataFileError).message).toContain("other-extension");
    }
  });
});

describe("merge", () => {
  it("keeps current values, unions arrays and adds new projects", async () => {
    await seed();
    const file = dataFile({
      projectMetadata: {
        alpha: metadata({ notes: "from file", genreIds: ["house"], bounceAliases: ["a1"] }),
        beta: metadata({ notes: "new project" }),
      },
    });

    await mergeData(file, []);

    const store = JSON.parse((await LocalStorage.getItem<string>("project-metadata")) ?? "{}");
    expect(store.alpha.notes).toBe("hello");
    expect(store.alpha.genreIds).toEqual(["house"]);
    expect(store.alpha.bounceAliases).toEqual(["a1"]);
    expect(store.beta.notes).toBe("new project");
  });

  it("maps same-name categories to the existing id everywhere", async () => {
    await seed();
    const file = dataFile({
      taxonomies: {
        "stage-options": [{ id: "demo", name: "Demo", order: 1 }],
        "genre-options": [{ id: "house", name: "House" }],
        "collection-options": [{ id: "ep-2", name: "EP" }],
        "role-options": [{ id: "intro", name: "Intro", order: 1 }],
      },
      projectMetadata: { alpha: metadata({ collectionIds: ["ep-2"] }) },
      collectionPins: ["ep-2"],
      collectionOrders: { "ep-2": { alpha: 1 } },
      collectionRoles: { "ep-2": { alpha: "Intro" } },
    });

    await mergeData(file, []);

    const store = JSON.parse((await LocalStorage.getItem<string>("project-metadata")) ?? "{}");
    expect(store.alpha.collectionIds).toEqual(["ep"]);
    expect(JSON.parse((await LocalStorage.getItem<string>("collection-pins")) ?? "[]")).toEqual(["ep"]);
    expect(JSON.parse((await LocalStorage.getItem<string>("collection-order:ep")) ?? "{}")).toEqual({ alpha: 1 });
    expect(JSON.parse((await LocalStorage.getItem<string>("collection-roles:ep")) ?? "{}")).toEqual({
      alpha: "Intro",
    });
    // 导入的收藏夹 ID 已映射到现有 ID，不会在 ep-2 下另建一份。
    expect(JSON.parse((await LocalStorage.getItem<string>("collection-order:ep-2")) ?? "{}")).toEqual({ alpha: 1 });
  });

  it("skips track numbers already taken in the same collection", async () => {
    await seed();
    const file = dataFile({ collectionOrders: { ep: { beta: 1, gamma: 2 } } });

    const report = await mergeData(file, []);

    expect(report.skippedTracks).toBe(1);
    expect(JSON.parse((await LocalStorage.getItem<string>("collection-order:ep")) ?? "{}")).toEqual({
      alpha: 1,
      gamma: 2,
    });
  });
});

describe("rename tracking", () => {
  it("moves data to the new id when the folder identity matches", async () => {
    await seed();
    const folder = makeFolder("Renamed");
    const stats = fs.statSync(folder);
    const projects = [makeProject("renamed", folder)];
    const file = dataFile(
      { projectMetadata: { old: metadata({ notes: "kept" }) }, collectionOrders: { ep: { old: 2 } } },
      { old: { birthtimeMs: stats.birthtimeMs, inode: stats.ino } },
    );

    const report = await mergeData(file, projects);

    expect(report.rematched).toBe(1);
    const store = JSON.parse((await LocalStorage.getItem<string>("project-metadata")) ?? "{}");
    expect(store.renamed.notes).toBe("kept");
    expect(store.old).toBeUndefined();
    expect(JSON.parse((await LocalStorage.getItem<string>("collection-order:ep")) ?? "{}")).toEqual({
      alpha: 1,
      renamed: 2,
    });
  });

  it("imports as-is and counts unmatched when the identity differs", async () => {
    await seed();
    const folder = makeFolder("Other");
    const projects = [makeProject("other", folder)];
    const file = dataFile({ projectMetadata: { old: metadata() } }, { old: { birthtimeMs: 1, inode: 1 } });

    const report = await mergeData(file, projects);

    expect(report.unmatched).toBe(1);
    const store = JSON.parse((await LocalStorage.getItem<string>("project-metadata")) ?? "{}");
    expect(store.old).toBeDefined();
  });

  it("does not rename when the target id already has its own entry", async () => {
    await seed();
    const folder = makeFolder("Renamed");
    const stats = fs.statSync(folder);
    const projects = [makeProject("renamed", folder)];
    const file = dataFile(
      { projectMetadata: { old: metadata({ notes: "old" }), renamed: metadata({ notes: "own" }) } },
      { old: { birthtimeMs: stats.birthtimeMs, inode: stats.ino } },
    );

    const report = await mergeData(file, projects);

    expect(report.unmatched).toBe(1);
    const store = JSON.parse((await LocalStorage.getItem<string>("project-metadata")) ?? "{}");
    expect(store.renamed.notes).toBe("own");
    expect(store.old.notes).toBe("old");
  });
});

describe("deleted projects", () => {
  it("unions records in merge and replace", async () => {
    await seed();
    const extra = {
      id: "gone-2",
      birthtimeMs: 2000,
      inode: 6,
      deletedAt: Date.now(),
      metadata: null,
      orders: {},
      roles: {},
      docs: [],
    };
    const file = dataFile({ deletedProjects: [extra] });

    await mergeData(file, []);
    let records = JSON.parse((await LocalStorage.getItem<string>("deleted-projects")) ?? "[]");
    expect(records.map((r: { id: string }) => r.id).sort()).toEqual(["gone", "gone-2"]);

    await replaceData(file, [], tempDir);
    records = JSON.parse((await LocalStorage.getItem<string>("deleted-projects")) ?? "[]");
    expect(records.map((r: { id: string }) => r.id).sort()).toEqual(["gone", "gone-2"]);
  });
});

describe("replace", () => {
  it("removes collection keys missing from the file", async () => {
    await seed();
    await LocalStorage.setItem("collection-order:other", JSON.stringify({ alpha: 3 }));
    await LocalStorage.setItem("collection-roles:other", JSON.stringify({ alpha: "Intro" }));

    await replaceData(dataFile(), [], tempDir);

    expect(await LocalStorage.getItem<string>("collection-order:other")).toBeUndefined();
    expect(await LocalStorage.getItem<string>("collection-roles:other")).toBeUndefined();
  });

  it("writes a backup before replacing", async () => {
    await seed();
    const report = await replaceData(dataFile(), [], tempDir);

    expect(report.backupPath).not.toBeNull();
    const backup = JSON.parse(fs.readFileSync(report.backupPath as string, "utf8"));
    expect(backup.data.projectMetadata.alpha.notes).toBe("hello");
  });

  it("aborts without changes when the backup cannot be written", async () => {
    await seed();
    const before = await snapshotStorage();
    const missing = path.join(tempDir, "missing-folder");

    await expect(replaceData(dataFile(), [], missing)).rejects.toThrow();
    expect(await snapshotStorage()).toEqual(before);
  });
});

describe("file names", () => {
  it("formats export and backup names", () => {
    const now = new Date(2026, 0, 2, 4, 48, 7);
    expect(exportFileName(now)).toBe(`${EXTENSION}-data-2026-01-02-0448.json`);
    expect(backupFileName(now)).toBe(`${EXTENSION}-backup-before-import-2026-01-02-044807.json`);
  });

  it("adds 2 and 3 instead of overwriting", () => {
    const first = writeJsonFile(tempDir, "x.json", "a");
    const second = writeJsonFile(tempDir, "x.json", "b");
    const third = writeJsonFile(tempDir, "x.json", "c");

    expect(path.basename(first)).toBe("x.json");
    expect(path.basename(second)).toBe("x 2.json");
    expect(path.basename(third)).toBe("x 3.json");
    expect(fs.readFileSync(first, "utf8")).toBe("a");
  });
});

describe("genre seed marker", () => {
  it("does not bring back a removed default genre after replace", async () => {
    await LocalStorage.setItem("genre-options", JSON.stringify([{ id: "house", name: "House" }]));
    await LocalStorage.setItem("genre-options-seeded-v1", "true");
    const file = dataFile({
      taxonomies: {
        "stage-options": [],
        "genre-options": [{ id: "house", name: "House" }],
        "collection-options": [],
        "role-options": [],
      },
    });

    await LocalStorage.clear();
    await replaceData(file, [], tempDir);

    const genres = await genreTaxonomy.get();
    expect(genres.map((genre) => genre.id)).toEqual(["house"]);
  });
});

describe("corrupt storage", () => {
  it("refuses to export and writes no file", async () => {
    await seed();
    await LocalStorage.setItem("stage-options", "{broken");

    await expect(exportData(tempDir, [])).rejects.toThrow();
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it("refuses to merge when a category key is corrupt", async () => {
    await seed();
    await LocalStorage.setItem("stage-options", "{broken");
    const before = await snapshotStorage();

    await expect(mergeData(dataFile(), [])).rejects.toThrow(CorruptDataError);
    expect(await snapshotStorage()).toEqual(before);
  });

  it("refuses to replace when a category key is corrupt and writes no backup", async () => {
    await seed();
    await LocalStorage.setItem("stage-options", "{broken");
    const before = await snapshotStorage();

    await expect(replaceData(dataFile(), [], tempDir)).rejects.toThrow(CorruptDataError);
    expect(await snapshotStorage()).toEqual(before);
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });
});

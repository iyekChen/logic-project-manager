import { getPreferenceValues } from "@raycast/api";
import fs from "node:fs";
import path from "node:path";
import type { Project } from "./types";

export const AUDIO_EXTENSIONS = new Set([".wav", ".aif", ".aiff", ".mp3", ".m4a", ".flac"]);

export type Bounce = {
  name: string;
  path: string;
  createdAt: number;
  modifiedAt: number;
  size: number;
};

/** 按后缀判断是否为音频文件。 */
export function isAudioFile(fileName: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/** 根据偏好里的 Bounces 子文件夹名，解析某个项目的 bounces 所在目录。 */
export function resolveBouncesFolder(projectPath: string): string {
  const folderName = (getPreferenceValues<Preferences>().bouncesFolderName ?? "").trim();
  return folderName ? path.join(projectPath, folderName) : projectPath;
}

/**
 * 列出某目录「顶层」的全部 bounce，不递归子文件夹。
 * statSync 会跟随 symlink，所以链接到外部文件夹的 bounce 也能读到。
 */
export function listBounces(folderPath: string): Bounce[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(folderPath);
  } catch {
    return [];
  }

  const bounces: Bounce[] = [];
  for (const entry of entries) {
    if (!isAudioFile(entry)) continue;
    const fullPath = path.join(folderPath, entry);
    try {
      const stats = fs.statSync(fullPath); // follows symlinks
      if (!stats.isFile()) continue;
      bounces.push({
        name: entry,
        path: fullPath,
        createdAt: stats.birthtimeMs,
        modifiedAt: stats.mtimeMs,
        size: stats.size,
      });
    } catch {
      continue;
    }
  }
  return bounces;
}

/** 统计某目录下的 bounce 数量：与 listBounces 口径一致（跟随 symlink、必须是文件），避免把同名目录当成音频。 */
export function countBounces(folderPath: string): number {
  return listBounces(folderPath).length;
}

/** 返回某目录下最近修改的 bounce 路径，没有则返回 null。
 *  用 mtime 而非 birthtime：重新导出覆盖同名文件时，修改时间才会更新。 */
export function findLatestBounce(folderPath: string): string | null {
  let latestPath: string | null = null;
  let latestModifiedAt = Number.NEGATIVE_INFINITY;

  for (const bounce of listBounces(folderPath)) {
    if (bounce.modifiedAt > latestModifiedAt) {
      latestModifiedAt = bounce.modifiedAt;
      latestPath = bounce.path;
    }
  }

  return latestPath;
}

// ───────────────── 共享 Bounces 文件夹 ─────────────────
// 所有项目的 bounce 导出到同一个文件夹（Package 项目没有自己的 Bounces 子文件夹），按文件名分给项目。
// 偏好只在声明了 sharedBouncesFolder 的扩展里存在（目前是 LPM），所以这里不用生成的 Preferences 类型。

/** 偏好里的共享 Bounces 文件夹；没设时为 null。 */
export function resolveSharedBouncesFolder(): string | null {
  const folder = (getPreferenceValues<{ sharedBouncesFolder?: string }>().sharedBouncesFolder ?? "").trim();
  return folder || null;
}

// 项目名后面允许紧跟的字符：结尾、空格、-、_、.（如 "Song.wav"、"Song v2.wav"、"Song-master.wav"）。
const TITLE_BOUNDARY = new Set(["", " ", "-", "_", "."]);

/** 文件名是否以这个项目名开头（不区分大小写），且项目名后面是边界字符。"Songbird.wav" 不算 "Song" 的。 */
export function bounceMatchesTitle(fileName: string, title: string): boolean {
  const stem = fileName.slice(0, fileName.length - path.extname(fileName).length).toLowerCase();
  const name = title.toLowerCase();
  return name !== "" && stem.startsWith(name) && TITLE_BOUNDARY.has(stem.charAt(name.length));
}

/**
 * 把共享文件夹里的文件名分给项目，返回 项目名 → 文件名列表。
 * 一个文件同时对上好几个项目时，归名字最长的那个："Demo Package v2.wav" 归 "Demo Package"，不归 "Demo"。
 * 对不上任何项目的文件不出现在结果里。
 */
export function assignSharedBounces(fileNames: string[], titles: string[]): Map<string, string[]> {
  const byLength = [...new Set(titles)].sort((a, b) => b.length - a.length);
  const result = new Map<string, string[]>();
  for (const fileName of fileNames) {
    if (!isAudioFile(fileName)) continue;
    const owner = byLength.find((title) => bounceMatchesTitle(fileName, title));
    if (owner === undefined) continue;
    const files = result.get(owner) ?? [];
    files.push(fileName);
    result.set(owner, files);
  }
  return result;
}

// 当前所有项目的名字。loadProjects 每次加载后更新；判断「名字最长的那个」要知道全部项目。
let sharedBounceTitles: string[] = [];

export function setSharedBounceTitles(titles: string[]): void {
  sharedBounceTitles = titles;
  sharedAssignment = null;
}

// 共享文件夹的分配结果，按文件夹路径 + mtime 缓存：增删、改名文件会改 mtime，届时重新读目录。
// 同名覆盖导出不改文件夹 mtime，但只影响文件的修改时间，不影响分配；修改时间在 listBounces 时实时读取。
let sharedAssignment: { key: string; byTitle: Map<string, string[]> } | null = null;

/** 共享文件夹里归这个项目的 bounce 的完整路径。没设共享文件夹或读不到时为空。 */
export function sharedBounceFilesFor(title: string): string[] {
  const folder = resolveSharedBouncesFolder();
  if (!folder) return [];
  const toPaths = (byTitle: Map<string, string[]>) =>
    (byTitle.get(title) ?? []).map((fileName) => path.join(folder, fileName));
  try {
    // 项目不在已知名单里（还没加载过项目，或刚改名）：只按这一个名字分配，不写缓存，免得缓存里缺了别的项目。
    if (!sharedBounceTitles.includes(title)) {
      return toPaths(assignSharedBounces(fs.readdirSync(folder), [title]));
    }
    const key = `${folder}:${fs.statSync(folder).mtimeMs}`;
    if (sharedAssignment?.key !== key) {
      sharedAssignment = { key, byTitle: assignSharedBounces(fs.readdirSync(folder), sharedBounceTitles) };
    }
    return toPaths(sharedAssignment.byTitle);
  } catch {
    // 文件夹不存在或读不到（外接盘没接上等）：当作没有共享 bounce。
    return [];
  }
}

// ───────────────── 外部 bounce 来源聚合 ─────────────────
// 默认 Bounces 文件夹 + 共享文件夹 + 外部文件夹 + 外部文件，统一成带来源标记、去重后的列表。
// 所有 bounce 相关功能（Browse / Latest / Copy / 计数）都应改走这里。

export type BounceSourceKind = "project" | "shared" | "external";

export type BounceWithSource = Bounce & {
  source: BounceSourceKind;
  /** false = 记录在案但当前读不到（如外接盘未连接 / 文件被删）。保留路径，不计入可用。 */
  available: boolean;
  /** 外部来源的登记路径（外部文件夹或外部文件）；默认目录的 bounce 为 undefined。用于按来源移除。 */
  externalSource?: string;
};

export type BounceSourceInput = {
  defaultFolder: string;
  /** 共享文件夹里归这个项目的文件（完整路径），由 sharedBounceFilesFor 给出。 */
  sharedFiles?: string[];
  externalFolders?: string[];
  externalFiles?: string[];
};

/** 规范化真实路径用于去重（跟随 symlink；失败时回退原路径）。 */
function canonicalPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function unavailablePlaceholder(p: string): Bounce {
  return { name: path.basename(p), path: p, createdAt: 0, modifiedAt: 0, size: 0 };
}

// 读单个音频文件的信息；不存在、不是文件或不是音频时返回 null。
function statBounceFile(file: string): Bounce | null {
  try {
    const stats = fs.statSync(file);
    if (!stats.isFile() || !isAudioFile(file)) return null;
    return {
      name: path.basename(file),
      path: file,
      createdAt: stats.birthtimeMs,
      modifiedAt: stats.mtimeMs,
      size: stats.size,
    };
  } catch {
    return null;
  }
}

/**
 * 汇总一个项目的全部 bounce 来源。
 * - 默认目录标记 source:"project"，共享文件夹标记 source:"shared"，外部标记 source:"external"。
 * - 按规范化真实路径去重，优先级：默认目录 > 共享文件夹 > 外部。
 * - 记录在案但读不到的外部来源，产出 available:false 占位（保留路径，不自动删除）。
 */
export function collectBounces(input: BounceSourceInput): BounceWithSource[] {
  const seen = new Set<string>();
  const result: BounceWithSource[] = [];

  const push = (bounce: Bounce, source: BounceSourceKind, available: boolean, externalSource?: string) => {
    const key = canonicalPath(bounce.path);
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ ...bounce, source, available, externalSource });
  };

  // 1) 默认文件夹：优先占住去重键
  for (const bounce of listBounces(input.defaultFolder)) push(bounce, "project", true);

  // 2) 共享文件夹：按文件名分配来的；读不到的直接跳过（文件在别处被删了，不是用户登记的来源）。
  for (const file of input.sharedFiles ?? []) {
    const bounce = statBounceFile(file);
    if (bounce) push(bounce, "shared", true);
  }

  // 3) 外部文件夹：实时扫描；路径读不到则整条记为不可用占位。externalSource 记文件夹本身，供整体移除。
  for (const folder of input.externalFolders ?? []) {
    try {
      fs.accessSync(folder);
    } catch {
      push(unavailablePlaceholder(folder), "external", false, folder);
      continue;
    }
    for (const bounce of listBounces(folder)) push(bounce, "external", true, folder);
  }

  // 4) 外部单文件：externalSource 即文件自身路径
  for (const file of input.externalFiles ?? []) {
    // 不是文件、或不是音频：标成不可用，留在列表里方便移除，也不会被当成最新 bounce。
    const bounce = statBounceFile(file);
    if (bounce) push(bounce, "external", true, file);
    else push(unavailablePlaceholder(file), "external", false, file);
  }

  return result;
}

/** 可用 bounce 数（默认 + 共享 + 外部，去重后排除不可用）。 */
export function countBouncesWithSources(input: BounceSourceInput): number {
  return collectBounces(input).filter((bounce) => bounce.available).length;
}

/** 最近修改的可用 bounce 路径（含共享和外部），没有则 null。 */
export function findLatestBounceWithSources(input: BounceSourceInput): string | null {
  let latestPath: string | null = null;
  let latestModifiedAt = Number.NEGATIVE_INFINITY;
  for (const bounce of collectBounces(input)) {
    if (!bounce.available) continue;
    if (bounce.modifiedAt > latestModifiedAt) {
      latestModifiedAt = bounce.modifiedAt;
      latestPath = bounce.path;
    }
  }
  return latestPath;
}

type ProjectBounceSources = Pick<Project, "title" | "folderPath" | "externalBounceFolders" | "externalBounceFiles">;

// 项目 → bounce 来源（默认文件夹 + 共享文件夹 + 外部来源）。
export function projectBounceSources(project: ProjectBounceSources): BounceSourceInput {
  return {
    defaultFolder: resolveBouncesFolder(project.folderPath),
    sharedFiles: sharedBounceFilesFor(project.title),
    externalFolders: project.externalBounceFolders,
    externalFiles: project.externalBounceFiles,
  };
}

/** 某个项目的最新 bounce。播放、复制、排队、分析都走这里，避免各处口径不一。 */
export function findLatestProjectBounce(project: ProjectBounceSources): string | null {
  return findLatestBounceWithSources(projectBounceSources(project));
}

/** 某个项目的 bounce 数（去重、排除不可用）。 */
export function countProjectBounces(project: ProjectBounceSources): number {
  return countBouncesWithSources(projectBounceSources(project));
}

import type { DawAdapter } from "../types";

/** Logic 的项目包后缀。 */
export const PACKAGE_EXTENSION = ".logicx";

const PACKAGE_EXTENSION_PATTERN = /\.logicx$/i;

/**
 * Logic Pro 适配器（空壳）：.logicx 包的结构还没确认，暂时认不出任何项目，
 * LPM 运行时列表为空。确认结构后再实现 detectProject / listSets / parseSet。
 */
export const logicAdapter: DawAdapter = {
  id: "logic",
  appNameMatch: "logic pro",

  // 包名去掉 .logicx 就是 id；文件夹形态的项目直接用文件夹名。
  projectIdForEntry: (entryName) => entryName.replace(PACKAGE_EXTENSION_PATTERN, ""),
  entryNameFor: (title, kind) => (kind === "package" ? `${title}${PACKAGE_EXTENSION}` : title),

  detectProject: () => null,
  listSets: () => [],
  parseSet: async () => ({ bpm: null, timeSignature: null, key: null }),
};

import { environment } from "@raycast/api";
import { abletonAdapter } from "./ableton/adapter";
import { logicAdapter } from "./logic/adapter";
import type { DawAdapter } from "./types";

export type { DawAdapter, DawId, DawSet, DetectedProject, ProjectFileMetadata, ProjectKind } from "./types";

const LOGIC_EXTENSION_NAME = "logic-project-manager";

/** 当前激活的 DAW 适配器：按 package.json 的扩展名选择，APM 和 LPM 共用同一份代码。 */
export const daw: DawAdapter = environment.extensionName === LOGIC_EXTENSION_NAME ? logicAdapter : abletonAdapter;

import path from "node:path";
import type { Project } from "@/core/projects/types";
import type { ProjectFilesInfo } from "../types";
import { listPackages, PACKAGE_EXTENSION } from "./adapter";
import { projectFilesViewStrings } from "./strings";
import { AlternativesView } from "./alternatives-view";
import { ProjectFilesView } from "./project-files-view";

/** 项目里有几个 .logicx：Package 形态算 1 个。 */
export function projectFileCount(project: Pick<Project, "kind" | "folderPath">): number {
  return project.kind === "folder" ? listPackages(project.folderPath).length : 1;
}

/** Search Projects 用：文件夹形态的项目有「工程文件」这一层，Package 没有。 */
export function projectFilesInfo(project: Pick<Project, "kind" | "folderPath">): ProjectFilesInfo | null {
  if (project.kind !== "folder") return null;
  return {
    count: projectFileCount(project),
    // Logic 的 Set 路径就是 .logicx 包的路径。
    latestName: (currentSetPath) => path.basename(currentSetPath, PACKAGE_EXTENSION),
    labels: projectFilesViewStrings,
  };
}

// 共用代码的 SetsView 入口：文件夹形态的项目先列出里面的 .logicx（只有一个也一样），Package 直接进 Alternatives。
export function LogicSetsView({ project }: { project: Project }) {
  return project.kind === "folder" ? <ProjectFilesView project={project} /> : <AlternativesView project={project} />;
}

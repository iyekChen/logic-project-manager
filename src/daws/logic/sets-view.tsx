import type { Project } from "@/core/projects/types";
import { listPackages } from "./adapter";
import { AlternativesView } from "./alternatives-view";
import { ProjectFilesView } from "./project-files-view";

/** 项目里有几个 .logicx：Package 形态算 1 个。 */
export function projectFileCount(project: Pick<Project, "kind" | "folderPath">): number {
  return project.kind === "folder" ? listPackages(project.folderPath).length : 1;
}

// 共用代码的 SetsView 入口：文件夹形态的项目先列出里面的 .logicx（只有一个也一样），Package 直接进 Alternatives。
export function LogicSetsView({ project }: { project: Project }) {
  return project.kind === "folder" ? <ProjectFilesView project={project} /> : <AlternativesView project={project} />;
}

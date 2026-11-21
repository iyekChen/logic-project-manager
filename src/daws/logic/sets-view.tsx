import type { Project } from "@/core/projects/types";
import { listPackages } from "./adapter";
import { AlternativesView } from "./alternatives-view";
import { ProjectFilesView } from "./project-files-view";

/** 项目里有几个 .logicx：Package 形态算 1 个。 */
export function projectFileCount(project: Pick<Project, "kind" | "folderPath">): number {
  return project.kind === "folder" ? listPackages(project.folderPath).length : 1;
}

// 共用代码的 SetsView 入口：文件夹里有多个 .logicx 时先列出它们，否则直接进 Alternatives（只有一个 Alternative 也一样）。
export function LogicSetsView({ project }: { project: Project }) {
  return projectFileCount(project) > 1 ? (
    <ProjectFilesView project={project} />
  ) : (
    <AlternativesView project={project} />
  );
}

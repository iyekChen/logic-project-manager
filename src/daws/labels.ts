import type { Language } from "@/settings";
import type { DawLabels } from "./types";

const labels: Record<Language, DawLabels> = {
  en: {
    sets: "Alternatives",
    // 共用代码取的「最新 Set」优先是 Active 的那个，Logic 打开项目时打开的也是它。
    latestSet: "Active Alternative",
    viewSets: "View Alternatives",
    openLatestSet: "Open Active Alternative",
    noSets: "No Alternatives Found",
    openSetFailed: "Couldn't Open Project",
    readingSets: "Reading Alternatives…",
    newProjectFile: "New Logic Project",
    newProjectFileFailed: "Logic Pro not found",
    newProjectWithTemplate: "New Project with Template",
    noProjectsFound: "No Logic projects found",
    noProjectsFoundHint: "Nothing in {folder} contains a Logic project. Check the Projects Folder in preferences.",
    // 开着项目改名时 Logic 会怎样还没测过，所以只提醒先关掉，不写后果。
    renameConfirmMessage: "Make sure this project is closed in Logic Pro before renaming it.",
  },
};

export function getDawLabels(language: Language): DawLabels {
  return labels[language];
}

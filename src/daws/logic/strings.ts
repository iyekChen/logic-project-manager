import type { Language } from "@/settings";

// Alternatives 视图专用的文字：Logic 的 Alternative 在 .logicx 包里。
type AlternativesViewStrings = {
  searchAlternatives: string;
  openInDaw: string;
  activeAlternative: string;
  copyAlternativeName: string;
  setActive: string;
  activeChanged: string;
  renameAlternative: string;
  alternativeRenamed: string;
  alternativeNameExists: string;
  duplicateAlternative: string;
  alternativeDuplicated: string;
  trashAlternativeHint: string;
  lastAlternative: string;
  changeConfirmTitle: string;
  changeConfirmMessage: string;
  changeFailed: string;
};

const strings: Record<Language, AlternativesViewStrings> = {
  en: {
    searchAlternatives: "Search Alternatives",
    openInDaw: "Open in Logic Pro",
    activeAlternative: "Active Alternative",
    copyAlternativeName: "Copy Alternative Name",
    setActive: "Set as Active Alternative",
    activeChanged: "Active Alternative Changed",
    renameAlternative: "Rename Alternative",
    alternativeRenamed: "Alternative Renamed",
    alternativeNameExists: "An Alternative with that name already exists",
    duplicateAlternative: "Duplicate Alternative",
    alternativeDuplicated: "Alternative Duplicated",
    trashAlternativeHint: "This moves the Alternative to the Trash:",
    lastAlternative: "A project needs at least one Alternative",
    changeConfirmTitle: "Change Alternative?",
    changeConfirmMessage:
      "Make sure this project is closed in Logic Pro. If it's open, Logic will overwrite this change the next time it saves.",
    changeFailed: "Couldn't Change Alternative",
  },
};

export function getAlternativesViewStrings(language: Language): AlternativesViewStrings {
  return strings[language];
}

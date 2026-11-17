import type { Language } from "@/settings";

// Alternatives 视图专用的文字：Logic 的 Alternative 在 .logicx 包里，只读。
type AlternativesViewStrings = {
  searchAlternatives: string;
  openInDaw: string;
  activeAlternative: string;
  copyAlternativeName: string;
};

const strings: Record<Language, AlternativesViewStrings> = {
  en: {
    searchAlternatives: "Search Alternatives",
    openInDaw: "Open in Logic Pro",
    activeAlternative: "Active",
    copyAlternativeName: "Copy Alternative Name",
  },
};

export function getAlternativesViewStrings(language: Language): AlternativesViewStrings {
  return strings[language];
}

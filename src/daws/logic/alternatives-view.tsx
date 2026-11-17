import { ActionPanel, Action, closeMainWindow, Color, Icon, Keyboard, List, type Application } from "@raycast/api";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { useEffect, useState } from "react";
import type { DawSet, ProjectFileMetadata } from "@/daws";
import { logicAdapter } from "./adapter";
import {
  EMPTY_METADATA,
  cachedSetMetadata,
  loadPersistentProjectFileCache,
  parseSetMetadata,
} from "@/core/projects/project-file-cache";
import { getSettings } from "@/settings";
import { getTranslations } from "@/i18n";
import type { Project } from "@/core/projects/types";
import { LOG_PREFIX } from "@/core/log";
import { getAlternativesViewStrings } from "./strings";
import { openWithDaw, resolveDawApp } from "@/core/daw-app";
import { showFailure } from "@/core/ui/toast";
import { getDawLabels } from "@/daws/labels";

const settings = getSettings();
const t = getTranslations(settings.language);
const alternativesText = getAlternativesViewStrings(settings.language);
const labels = getDawLabels(settings.language);

// windowImage：Logic 保存时截下的工程窗口缩略图（Alternatives/NNN/WindowImage.jpg），没有时为 null。
type ProjectAlternative = DawSet & ProjectFileMetadata & { windowImage: string | null };

function findWindowImage(set: DawSet): string | null {
  const image = path.join(path.dirname(set.metadataFile), "WindowImage.jpg");
  return fs.existsSync(image) ? image : null;
}

// 详情顶部放缩略图；不是 Active 的再加一句说明，因为 Logic 按路径打开时总是打开 Active 的那个。
// 路径转成 file:// URL，空格、# 这类字符才不会打断 Markdown。
function detailMarkdown(alternative: ProjectAlternative, activeName: string | undefined): string {
  const parts: string[] = [];
  if (alternative.windowImage) parts.push(`![](${pathToFileURL(alternative.windowImage).href})`);
  if (!alternative.active && activeName) {
    parts.push(alternativesText.logicOpensActiveAlternative.replace("{name}", activeName));
  }
  return parts.join("\n\n");
}

// Logic 项目的 Alternatives：只读。改名、复制、删除要动 .logicx 包内部，交给 Logic 自己做。
export function AlternativesView({ project }: { project: Project }) {
  const [alternatives, setAlternatives] = useState<ProjectAlternative[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [logicApp, setLogicApp] = useState<Application | null>(null);

  // 解析 Logic Pro，用于 Open in Logic Pro 的图标：偏好设置里选了版本就用那个版本。
  useEffect(() => {
    void resolveDawApp().then(setLogicApp);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAlternatives() {
      try {
        await loadPersistentProjectFileCache();
        if (cancelled) return;

        // 按编号排（Alternatives/000、001……），和 Logic 菜单里的顺序一致。
        const sets = logicAdapter.listSets(project).sort((a, b) => a.metadataFile.localeCompare(b.metadataFile));
        const items: ProjectAlternative[] = [];
        for (const set of sets) {
          const cached = cachedSetMetadata(set);
          let metadata = cached ?? EMPTY_METADATA;
          if (!cached) {
            try {
              metadata = await parseSetMetadata(set);
            } catch (error) {
              console.error(`${LOG_PREFIX} Failed to load alternative metadata: ${set.metadataFile}`, error);
            }
          }
          if (cancelled) return;
          items.push({ ...set, ...metadata, windowImage: findWindowImage(set) });
        }
        setAlternatives(items);
      } catch (error) {
        if (!cancelled) {
          console.error(`${LOG_PREFIX} Failed to load alternatives:`, error);
          setAlternatives([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadAlternatives();

    return () => {
      cancelled = true;
    };
  }, [project.folderPath, project.kind]);

  // Logic 按路径打开时总是打开当前 Active 的那个：选中别的 Alternative 时在详情里说明。
  const activeName = alternatives.find((alternative) => alternative.active)?.name;

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      navigationTitle={project.title}
      searchBarPlaceholder={alternativesText.searchAlternatives}
    >
      {alternatives.map((alternative) => (
        <List.Item
          key={alternative.metadataFile}
          icon={alternative.windowImage ? { source: alternative.windowImage } : Icon.Layers}
          title={alternative.name}
          accessories={
            alternative.active ? [{ tag: { value: alternativesText.activeAlternative, color: Color.Green } }] : []
          }
          detail={
            <List.Item.Detail
              markdown={detailMarkdown(alternative, activeName)}
              metadata={
                <List.Item.Detail.Metadata>
                  {alternative.active ? (
                    <List.Item.Detail.Metadata.TagList title={alternativesText.activeAlternative}>
                      <List.Item.Detail.Metadata.TagList.Item
                        text={alternativesText.activeAlternative}
                        color={Color.Green}
                      />
                    </List.Item.Detail.Metadata.TagList>
                  ) : (
                    <List.Item.Detail.Metadata.Label title={alternativesText.activeAlternative} text="" />
                  )}
                  <List.Item.Detail.Metadata.Separator />
                  <List.Item.Detail.Metadata.Label title="Key" text={alternative.key ?? ""} />
                  <List.Item.Detail.Metadata.Label
                    title="BPM"
                    text={alternative.bpm === null ? "" : String(alternative.bpm)}
                  />
                  <List.Item.Detail.Metadata.Label title="Time Signature" text={alternative.timeSignature ?? ""} />
                </List.Item.Detail.Metadata>
              }
            />
          }
          actions={
            <ActionPanel>
              <ActionPanel.Section>
                <Action
                  title={alternativesText.openInDaw}
                  icon={logicApp ? { fileIcon: logicApp.path } : Icon.Document}
                  onAction={async () => {
                    try {
                      await openWithDaw(alternative.path);
                      await closeMainWindow();
                    } catch (error) {
                      await showFailure(labels.openSetFailed, error);
                    }
                  }}
                />
                <Action.ShowInFinder
                  path={alternative.path}
                  title={t.showInFinder}
                  shortcut={{ modifiers: ["cmd", "opt"], key: "o" }}
                />
              </ActionPanel.Section>
              <ActionPanel.Section title={t.sectionCopy}>
                <Action.CopyToClipboard
                  content={alternative.name}
                  title={alternativesText.copyAlternativeName}
                  icon={Icon.CopyClipboard}
                  shortcut={Keyboard.Shortcut.Common.CopyName}
                />
                <Action.CopyToClipboard
                  content={alternative.path}
                  title={t.copyProjectPath}
                  icon={Icon.CopyClipboard}
                  shortcut={Keyboard.Shortcut.Common.CopyPath}
                />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

import {
  ActionPanel,
  Action,
  Alert,
  closeMainWindow,
  Color,
  confirmAlert,
  Form,
  Icon,
  Image,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
  type Application,
} from "@raycast/api";
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
import { SortBySubmenu, sortItems, sortOptionTitle, useSortOption } from "@/core/ui/sorting";
import type { SortOption } from "@/core/ui/sorting";
import { GroupBySubmenu, groupItems, useGroupOption } from "@/core/ui/grouping";
import { alternativeIndex, duplicateName } from "./alternative-rules";
import { duplicateAlternative, renameAlternative, setActiveAlternative, trashAlternative } from "./alternative-edits";

const settings = getSettings();
const t = getTranslations(settings.language);
const alternativesText = getAlternativesViewStrings(settings.language);
const labels = getDawLabels(settings.language);

const ALTERNATIVES_SORT_STORAGE_KEY = "alternatives-sort-option";
const ALTERNATIVES_GROUP_STORAGE_KEY = "alternatives-group-option";

const ALTERNATIVES_SORT_OPTIONS: SortOption[] = [
  "modified-desc",
  "modified-asc",
  "created-desc",
  "created-asc",
  "name-asc",
  "name-desc",
];

// windowImage：Logic 保存时截下的工程窗口缩略图（Alternatives/NNN/WindowImage.jpg），没有时为 null。
type ProjectAlternative = DawSet & ProjectFileMetadata & { windowImage: string | null };

export function findWindowImage(set: DawSet): string | null {
  const image = path.join(path.dirname(set.metadataFile), "WindowImage.jpg");
  return fs.existsSync(image) ? image : null;
}

// 详情顶部放缩略图。路径转成 file:// URL，空格、# 这类字符才不会打断 Markdown。
function detailMarkdown(alternative: ProjectAlternative): string {
  return alternative.windowImage ? `![](${pathToFileURL(alternative.windowImage).href})` : "";
}

function RenameAlternativeForm({ alternative, onRenamed }: { alternative: ProjectAlternative; onRenamed: () => void }) {
  const { pop } = useNavigation();
  const [name, setName] = useState(alternative.name);

  async function handleSubmit() {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === alternative.name) {
      pop();
      return;
    }
    if (trimmed.includes("/") || trimmed.includes(":")) {
      await showToast({ style: Toast.Style.Failure, title: t.invalidName });
      return;
    }

    const confirmed = await confirmAlert({
      icon: { source: Icon.Warning, tintColor: Color.Yellow },
      title: alternativesText.changeConfirmTitle,
      message: alternativesText.changeConfirmMessage,
      primaryAction: { title: t.rename, style: Alert.ActionStyle.Default },
    });
    if (!confirmed) return;

    try {
      await renameAlternative(alternative.path, alternative, trimmed);
    } catch (error) {
      await showFailure(t.renameFailed, error);
      return;
    }

    onRenamed();
    await showToast({ style: Toast.Style.Success, title: alternativesText.alternativeRenamed, message: trimmed });
    pop();
  }

  return (
    <Form
      navigationTitle={`${alternativesText.renameAlternative} — ${alternative.name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={t.save} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title={t.name} value={name} onChange={setName} />
    </Form>
  );
}

// Logic 项目的 Alternatives：改名、复制、删除都要动 .logicx 包内部，改之前先确认项目没在 Logic 里开着。
export function AlternativesView({ project }: { project: Project }) {
  const [alternatives, setAlternatives] = useState<ProjectAlternative[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [logicApp, setLogicApp] = useState<Application | null>(null);
  const [sortBy, setSortBy] = useSortOption(ALTERNATIVES_SORT_STORAGE_KEY, ALTERNATIVES_SORT_OPTIONS, "created-desc");
  const [groupBy, setGroupBy] = useGroupOption(ALTERNATIVES_GROUP_STORAGE_KEY, "created");
  const [reloadToken, setReloadToken] = useState(0);

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
  }, [project.folderPath, project.kind, reloadToken]);

  const reload = () => setReloadToken((n) => n + 1);

  // 所有会改文件的操作都先确认：项目在 Logic 里开着时，Logic 下次保存会盖掉这些改动。
  const confirmChange = (title: string, message: string, actionTitle: string) =>
    confirmAlert({
      icon: { source: Icon.Warning, tintColor: Color.Yellow },
      title,
      message,
      primaryAction: { title: actionTitle, style: Alert.ActionStyle.Default },
    });

  const handleOpen = async (alternative: ProjectAlternative) => {
    try {
      if (!alternative.active) {
        const confirmed = await confirmChange(
          alternativesText.changeConfirmTitle,
          alternativesText.changeConfirmMessage,
          alternativesText.openInDaw,
        );
        if (!confirmed) return;
        await setActiveAlternative(alternative.path, alternativeIndex(alternative));
      }
      await openWithDaw(alternative.path);
      await closeMainWindow();
    } catch (error) {
      await showFailure(labels.openSetFailed, error);
    }
  };

  const handleSetActive = async (alternative: ProjectAlternative) => {
    const confirmed = await confirmChange(
      alternativesText.changeConfirmTitle,
      alternativesText.changeConfirmMessage,
      alternativesText.setActive,
    );
    if (!confirmed) return;
    try {
      await setActiveAlternative(alternative.path, alternativeIndex(alternative));
      reload();
      await showToast({ style: Toast.Style.Success, title: alternativesText.activeChanged, message: alternative.name });
    } catch (error) {
      await showFailure(alternativesText.changeFailed, error);
    }
  };

  const handleDuplicate = async (alternative: ProjectAlternative) => {
    const name = duplicateName(
      alternative.name,
      alternatives.map((item) => item.name),
    );
    const confirmed = await confirmChange(
      alternativesText.changeConfirmTitle,
      alternativesText.changeConfirmMessage,
      alternativesText.duplicateAlternative,
    );
    if (!confirmed) return;
    try {
      await duplicateAlternative(alternative.path, alternative, alternatives.map(alternativeIndex), name);
      reload();
      await showToast({ style: Toast.Style.Success, title: alternativesText.alternativeDuplicated, message: name });
    } catch (error) {
      await showFailure(t.duplicateFailed, error);
    }
  };

  const handleTrash = async (alternative: ProjectAlternative) => {
    if (alternatives.length <= 1) {
      await showToast({ style: Toast.Style.Failure, title: alternativesText.lastAlternative });
      return;
    }
    const confirmed = await confirmAlert({
      title: t.moveToTrash,
      icon: Icon.Trash,
      message: `${alternativesText.trashAlternativeHint}\n${alternative.name}\n\n${alternativesText.changeConfirmMessage}`,
      primaryAction: { title: t.moveToTrash, style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      await trashAlternative(
        alternative.path,
        alternative,
        alternatives.map(alternativeIndex),
        alternative.active === true,
      );
      reload();
      await showToast({ style: Toast.Style.Success, title: t.movedToTrash, message: alternative.name });
    } catch (error) {
      await showFailure(t.trashFailed, error);
    }
  };

  const sortedAlternatives = sortItems(alternatives, sortBy, (alternative) => ({
    created: alternative.createdAt,
    modified: alternative.modifiedAt,
    name: alternative.name,
  }));

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      navigationTitle={project.title}
      searchBarPlaceholder={alternativesText.searchAlternatives}
    >
      {groupItems(
        sortedAlternatives,
        groupBy,
        (alternative) => ({ created: alternative.createdAt, modified: alternative.modifiedAt }),
        sortOptionTitle(sortBy),
      ).map((group) => (
        <List.Section key={group.key} title={group.title} subtitle={group.subtitle}>
          {group.items.map((alternative) => (
            <List.Item
              key={alternative.metadataFile}
              icon={
                alternative.windowImage
                  ? { source: alternative.windowImage, mask: Image.Mask.RoundedRectangle }
                  : Icon.Layers
              }
              title={{ value: alternative.name, tooltip: alternative.name }}
              accessories={
                alternative.active
                  ? [
                      {
                        icon: { source: Icon.CheckCircle, tintColor: Color.Green },
                        tooltip: alternativesText.activeAlternative,
                      },
                    ]
                  : []
              }
              detail={
                <List.Item.Detail
                  markdown={detailMarkdown(alternative)}
                  metadata={
                    <List.Item.Detail.Metadata>
                      {alternative.active ? (
                        <List.Item.Detail.Metadata.Label
                          title={alternativesText.activeAlternative}
                          icon={{ source: Icon.CheckCircle, tintColor: Color.Green }}
                        />
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
                      onAction={() => handleOpen(alternative)}
                    />
                    {!alternative.active && (
                      <Action
                        title={alternativesText.setActive}
                        icon={Icon.CheckCircle}
                        onAction={() => handleSetActive(alternative)}
                      />
                    )}
                    <Action.ShowInFinder
                      path={path.dirname(alternative.metadataFile)}
                      title={t.showInFinder}
                      shortcut={{ modifiers: ["cmd", "opt"], key: "o" }}
                    />
                    <Action.Push
                      title={alternativesText.renameAlternative}
                      icon={Icon.Pencil}
                      shortcut={Keyboard.Shortcut.Common.Edit}
                      target={<RenameAlternativeForm alternative={alternative} onRenamed={reload} />}
                    />
                    <Action
                      title={alternativesText.duplicateAlternative}
                      icon={Icon.Duplicate}
                      shortcut={Keyboard.Shortcut.Common.Duplicate}
                      onAction={() => handleDuplicate(alternative)}
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
                  <ActionPanel.Section title={t.sectionArrange}>
                    <GroupBySubmenu allowed={["modified", "created"]} value={groupBy} onChange={setGroupBy} />
                    <SortBySubmenu allowed={ALTERNATIVES_SORT_OPTIONS} value={sortBy} onChange={setSortBy} />
                  </ActionPanel.Section>
                  <ActionPanel.Section title={t.sectionDangerZone}>
                    <Action
                      title={t.moveToTrash}
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      shortcut={Keyboard.Shortcut.Common.Remove}
                      onAction={() => handleTrash(alternative)}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

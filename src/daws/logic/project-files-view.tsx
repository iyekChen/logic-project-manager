import {
  ActionPanel,
  Action,
  Alert,
  closeMainWindow,
  Color,
  confirmAlert,
  Icon,
  Image,
  Keyboard,
  List,
  showToast,
  Toast,
  trash,
  type Application,
} from "@raycast/api";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { useEffect, useState } from "react";
import type { DawSet, ProjectFileMetadata } from "@/daws";
import { findPackage, lastSavedAt, listPackages, logicAdapter } from "./adapter";
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
import { getAlternativesViewStrings, getProjectFilesViewStrings } from "./strings";
import { openWithDaw, resolveDawApp } from "@/core/daw-app";
import { showFailure } from "@/core/ui/toast";
import { getDawLabels } from "@/daws/labels";
import { AlternativesView, findWindowImage } from "./alternatives-view";

const settings = getSettings();
const t = getTranslations(settings.language);
const alternativesText = getAlternativesViewStrings(settings.language);
const filesText = getProjectFilesViewStrings(settings.language);
const labels = getDawLabels(settings.language);

// 文件夹里的一个 .logicx。缩略图和元数据取它的 Active Alternative。
type ProjectFile = {
  packagePath: string;
  name: string;
  savedAt: number;
  isLatest: boolean;
  alternativeCount: number;
  active: DawSet | null;
  metadata: ProjectFileMetadata;
  windowImage: string | null;
};

function formatDate(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// 文件夹形态的项目里有多个 .logicx 时的列表。Enter 进这个 .logicx 的 Alternatives，⌘O 直接打开它。
export function ProjectFilesView({ project }: { project: Project }) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [logicApp, setLogicApp] = useState<Application | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    void resolveDawApp().then(setLogicApp);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadFiles() {
      try {
        await loadPersistentProjectFileCache();
        if (cancelled) return;

        const latest = findPackage(project.folderPath);
        const items: ProjectFile[] = [];
        for (const packagePath of listPackages(project.folderPath)) {
          const sets = logicAdapter.listSets({ folderPath: packagePath, kind: "package" });
          const active = sets.find((set) => set.active) ?? null;
          let metadata = EMPTY_METADATA;
          if (active) {
            const cached = cachedSetMetadata(active);
            metadata = cached ?? EMPTY_METADATA;
            if (!cached) {
              try {
                metadata = await parseSetMetadata(active);
              } catch (error) {
                console.error(`${LOG_PREFIX} Failed to load project file metadata: ${active.metadataFile}`, error);
              }
            }
          }
          if (cancelled) return;
          items.push({
            packagePath,
            name: logicAdapter.projectIdForEntry(path.basename(packagePath)),
            savedAt: lastSavedAt(packagePath),
            isLatest: packagePath === latest,
            alternativeCount: sets.length,
            active,
            metadata,
            windowImage: active ? findWindowImage(active) : null,
          });
        }
        // 最后保存的排最上面；都读不到保存时间时按名字。
        items.sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name));
        setFiles(items);
      } catch (error) {
        if (!cancelled) {
          console.error(`${LOG_PREFIX} Failed to load project files:`, error);
          setFiles([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadFiles();

    return () => {
      cancelled = true;
    };
  }, [project.folderPath, reloadToken]);

  const reload = () => setReloadToken((n) => n + 1);

  const handleOpen = async (file: ProjectFile) => {
    try {
      await openWithDaw(file.packagePath);
      await closeMainWindow();
    } catch (error) {
      await showFailure(labels.openSetFailed, error);
    }
  };

  const handleTrash = async (file: ProjectFile) => {
    if (files.length <= 1) {
      await showToast({ style: Toast.Style.Failure, title: filesText.lastProjectFile });
      return;
    }
    const confirmed = await confirmAlert({
      title: t.moveToTrash,
      icon: Icon.Trash,
      message: `${filesText.trashProjectFileHint}\n${file.name}\n\n${filesText.trashConfirmMessage}`,
      primaryAction: { title: t.moveToTrash, style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      await trash(file.packagePath);
      reload();
      await showToast({ style: Toast.Style.Success, title: t.movedToTrash, message: file.name });
    } catch (error) {
      await showFailure(t.trashFailed, error);
    }
  };

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      navigationTitle={project.title}
      searchBarPlaceholder={filesText.searchProjectFiles}
    >
      {files.map((file) => (
        <List.Item
          key={file.packagePath}
          icon={file.windowImage ? { source: file.windowImage, mask: Image.Mask.RoundedRectangle } : "package.png"}
          title={{ value: file.name, tooltip: file.name }}
          accessories={
            file.isLatest
              ? [{ icon: { source: Icon.CheckCircle, tintColor: Color.Green }, tooltip: filesText.latestProjectFile }]
              : []
          }
          detail={
            <List.Item.Detail
              markdown={file.windowImage ? `![](${pathToFileURL(file.windowImage).href})` : ""}
              metadata={
                <List.Item.Detail.Metadata>
                  {file.isLatest ? (
                    <List.Item.Detail.Metadata.Label
                      title={filesText.latestProjectFile}
                      icon={{ source: Icon.CheckCircle, tintColor: Color.Green }}
                    />
                  ) : (
                    <List.Item.Detail.Metadata.Label title={filesText.latestProjectFile} text="" />
                  )}
                  <List.Item.Detail.Metadata.Label title="Saved" text={formatDate(file.savedAt)} />
                  <List.Item.Detail.Metadata.Separator />
                  <List.Item.Detail.Metadata.Label title={labels.sets} text={String(file.alternativeCount)} />
                  <List.Item.Detail.Metadata.Label title={labels.latestSet} text={file.active?.name ?? ""} />
                  <List.Item.Detail.Metadata.Label title="Key" text={file.metadata.key ?? ""} />
                  <List.Item.Detail.Metadata.Label
                    title="BPM"
                    text={file.metadata.bpm === null ? "" : String(file.metadata.bpm)}
                  />
                  <List.Item.Detail.Metadata.Label title="Time Signature" text={file.metadata.timeSignature ?? ""} />
                </List.Item.Detail.Metadata>
              }
            />
          }
          actions={
            <ActionPanel>
              <ActionPanel.Section>
                <Action.Push
                  title={labels.viewSets}
                  icon={Icon.Layers}
                  target={
                    <AlternativesView
                      project={{ ...project, title: file.name, folderPath: file.packagePath, kind: "package" }}
                    />
                  }
                  onPop={reload}
                />
                <Action
                  title={alternativesText.openInDaw}
                  icon={logicApp ? { fileIcon: logicApp.path } : Icon.Document}
                  shortcut={Keyboard.Shortcut.Common.Open}
                  onAction={() => handleOpen(file)}
                />
                <Action.ShowInFinder
                  path={file.packagePath}
                  title={t.showInFinder}
                  shortcut={{ modifiers: ["cmd", "opt"], key: "o" }}
                />
              </ActionPanel.Section>
              <ActionPanel.Section title={t.sectionCopy}>
                <Action.CopyToClipboard
                  content={file.name}
                  title={filesText.copyProjectFileName}
                  icon={Icon.CopyClipboard}
                  shortcut={Keyboard.Shortcut.Common.CopyName}
                />
                <Action.CopyToClipboard
                  content={file.packagePath}
                  title={t.copyProjectPath}
                  icon={Icon.CopyClipboard}
                  shortcut={Keyboard.Shortcut.Common.CopyPath}
                />
              </ActionPanel.Section>
              <ActionPanel.Section title={t.sectionDangerZone}>
                <Action
                  title={t.moveToTrash}
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={Keyboard.Shortcut.Common.Remove}
                  onAction={() => handleTrash(file)}
                />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

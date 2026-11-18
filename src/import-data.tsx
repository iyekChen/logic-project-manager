import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  environment,
  Form,
  Icon,
  showInFinder,
  showToast,
  Toast,
} from "@raycast/api";
import path from "node:path";
import { useState } from "react";
import {
  CorruptDataError,
  DataFileError,
  mergeData,
  parseDataFile,
  replaceData,
  type ImportMode,
} from "@/core/data/data-transfer";
import { loadProjects } from "@/core/projects/load-projects";
import { showFailure } from "@/core/ui/toast";
import { getTranslations } from "@/i18n";
import { getSettings } from "@/settings";

const settings = getSettings();

function corruptKindName(kind: CorruptDataError["kind"]): string {
  switch (kind) {
    case "metadata":
      return t.corruptDataMetadata;
    case "categories":
      return t.corruptDataCategories;
    case "pins":
      return t.corruptDataPins;
    case "orders":
      return t.corruptDataOrders;
    case "roles":
      return t.corruptDataRoles;
    case "deleted":
      return t.corruptDataDeleted;
  }
}
const t = getTranslations(settings.language);

export default function ImportData() {
  const [file, setFile] = useState<string[]>([]);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [fileError, setFileError] = useState<string | undefined>();

  function validateFile(value: string[]): string | undefined {
    return value[0] ? undefined : t.importFileRequired;
  }

  async function handleSubmit() {
    const error = validateFile(file);
    if (error) {
      setFileError(error);
      return;
    }

    const target = file[0];
    if (mode === "replace") {
      const confirmed = await confirmAlert({
        title: t.replaceDataTitle,
        message: t.replaceDataMessage,
        primaryAction: { title: t.replaceData, style: Alert.ActionStyle.Destructive },
      });
      if (!confirmed) return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: t.importingData });
    try {
      const raw = await import("node:fs").then((fs) => fs.readFileSync(target, "utf8"));
      const parsed = parseDataFile(raw, environment.extensionName);
      const projects = settings.projectsFolder ? loadProjects(settings.projectsFolder) : null;
      const report =
        mode === "replace"
          ? await replaceData(parsed, projects, path.dirname(target))
          : await mergeData(parsed, projects);

      toast.style = Toast.Style.Success;
      toast.title = t.dataImported;
      toast.message = t.importSummary
        .replace("{projects}", String(report.projects))
        .replace("{rematched}", String(report.rematched))
        .replace("{unmatched}", String(report.unmatched))
        .replace("{skipped}", String(report.skippedTracks));
      if (report.backupPath) {
        const backup = report.backupPath;
        toast.message = `${toast.message} ${t.importBackupSaved.replace("{file}", path.basename(backup))}`;
        toast.primaryAction = {
          title: t.showInFinder,
          onAction: () => {
            void showInFinder(backup);
          },
        };
      }
    } catch (error) {
      if (error instanceof CorruptDataError) {
        await showFailure(t.importFailed, error, {
          message: t.corruptDataKind.replace("{kind}", corruptKindName(error.kind)),
        });
        return;
      }
      if (error instanceof DataFileError) {
        await showFailure(t.importFailed, new Error(importErrorMessage(error)));
        return;
      }
      await showFailure(t.importFailed, error);
    }
  }

  function importErrorMessage(error: DataFileError): string {
    switch (error.reason) {
      case "parse":
      case "format":
        return t.importBadFormat;
      case "version":
        return t.importBadVersion;
      case "extension":
        return t.importOtherExtension.replace("{extension}", error.message);
      case "structure":
        return t.importBadStructure;
    }
  }

  return (
    <Form
      navigationTitle={t.importData}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={t.importData} icon={Icon.Upload} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="file"
        title={t.importFile}
        value={file}
        error={fileError}
        onChange={(value) => {
          setFile(value);
          if (fileError) setFileError(validateFile(value));
        }}
        canChooseDirectories={false}
        canChooseFiles
        allowMultipleSelection={false}
      />
      <Form.Dropdown id="mode" title={t.importMode} value={mode} onChange={(value) => setMode(value as ImportMode)}>
        <Form.Dropdown.Item value="merge" title={t.importModeMerge} />
        <Form.Dropdown.Item value="replace" title={t.importModeReplace} />
      </Form.Dropdown>
      <Form.Description text={mode === "replace" ? t.importReplaceHint : t.importMergeHint} />
    </Form>
  );
}

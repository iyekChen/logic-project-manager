import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { logicAdapter } from "../src/daws/logic/adapter";

let root: string;
let templatesRoot: string;
let projectsRoot: string;
let templatePath: string;

function writeTemplate(packagePath: string) {
  fs.mkdirSync(path.join(packagePath, "Alternatives", "000"), { recursive: true });
  fs.writeFileSync(path.join(packagePath, "Alternatives", "000", "ProjectData"), "project data");
  fs.writeFileSync(path.join(packagePath, "Alternatives", "000", "MetaData.plist"), "metadata");
  fs.mkdirSync(path.join(packagePath, "Resources"), { recursive: true });
  fs.writeFileSync(path.join(packagePath, "Resources", "ProjectInformation.plist"), "info");
}

// 递归读出包里的全部文件（相对路径 → 内容），用来比对复制结果。
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [inner, content] of Object.entries(snapshot(entryPath))) {
        files[path.join(entry.name, inner)] = content;
      }
    } else {
      files[entry.name] = fs.readFileSync(entryPath, "utf8");
    }
  }
  return files;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lpm-logic-templates-"));
  templatesRoot = path.join(root, "Templates");
  projectsRoot = path.join(root, "Projects");
  fs.mkdirSync(projectsRoot, { recursive: true });
  templatePath = path.join(templatesRoot, "Starter.logicx");
  writeTemplate(templatePath);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("logicAdapter.isTemplate", () => {
  it("认 .logicx 包，不认普通文件夹和文件", () => {
    expect(logicAdapter.isTemplate(templatePath, "Starter.logicx")).toBe(true);
    expect(logicAdapter.isTemplate(projectsRoot, "Projects")).toBe(false);
    expect(logicAdapter.isTemplate(path.join(root, "notes.txt"), "notes.txt")).toBe(false);
  });
});

describe("logicAdapter.createFromTemplate", () => {
  it("把整个包复制成 Projects Folder 下的新项目，内容一致", () => {
    const target = logicAdapter.createFromTemplate(templatePath, projectsRoot, "New Song");
    expect(target).toBe(path.join(projectsRoot, "New Song.logicx"));
    expect(snapshot(target)).toEqual(snapshot(templatePath));
  });

  it("模板原件没有变", () => {
    const before = snapshot(templatePath);
    logicAdapter.createFromTemplate(templatePath, projectsRoot, "Another Song");
    expect(snapshot(templatePath)).toEqual(before);
  });

  it("目标已存在时报错，并且不覆盖", () => {
    const target = path.join(projectsRoot, "Taken.logicx");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "keep.txt"), "keep");

    expect(() => logicAdapter.createFromTemplate(templatePath, projectsRoot, "Taken")).toThrow();
    expect(fs.readFileSync(path.join(target, "keep.txt"), "utf8")).toBe("keep");
    expect(fs.readdirSync(target)).toEqual(["keep.txt"]);
  });
});

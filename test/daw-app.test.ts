import type { Application } from "@raycast/api";
import { afterEach, describe, expect, it } from "vitest";
import { pickDawApp } from "../src/core/daw-app";
import { __setPreferences } from "./mocks/raycast-api";

const perpetual: Application = { name: "Logic Pro", path: "/Applications/Logic Pro.app", bundleId: "com.apple.logic10" };
const creatorStudio: Application = {
  name: "Logic Pro",
  path: "/Applications/Logic Pro Creator Studio.app",
  bundleId: "com.apple.mobilelogic",
};
const other: Application = { name: "Finder", path: "/System/Library/CoreServices/Finder.app", bundleId: "com.apple.finder" };

afterEach(() => {
  __setPreferences({});
});

describe("pickDawApp", () => {
  it("按 bundle ID 找到选的版本", () => {
    __setPreferences({ dawApp: "com.apple.mobilelogic" });
    expect(pickDawApp([other, perpetual, creatorStudio])).toEqual(creatorStudio);
  });

  it("选的版本没装时，用装着的另一个 Logic Pro", () => {
    __setPreferences({ dawApp: "com.apple.mobilelogic" });
    expect(pickDawApp([other, perpetual])).toEqual(perpetual);
  });

  it("没设偏好时按名字找", () => {
    expect(pickDawApp([other, creatorStudio])).toEqual(creatorStudio);
  });

  it("一个都没装时为 null", () => {
    __setPreferences({ dawApp: "com.apple.logic10" });
    expect(pickDawApp([other])).toBeNull();
  });
});

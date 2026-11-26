import { describe, expect, it } from "vitest";
import { readSettings, SETTINGS_STORAGE_KEY, writeSettings, type SettingsStorage } from "../src/lib/settings";

function storage(initial: Record<string, string> = {}): SettingsStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }
  };
}

describe("studio settings", () => {
  it("uses empty preferences when no saved value exists", () => {
    expect(readSettings(storage())).toEqual({
      libraryRoot: "",
      defaultOutputDirectory: "",
      speechProfilesDirectory: ""
    });
  });

  it("reads known folder preferences and ignores malformed values", () => {
    const saved = storage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({
        libraryRoot: "/books",
        defaultOutputDirectory: "/exports",
        speechProfilesDirectory: 12,
        ignored: true
      })
    });
    expect(readSettings(saved)).toEqual({
      libraryRoot: "/books",
      defaultOutputDirectory: "/exports",
      speechProfilesDirectory: ""
    });
    expect(readSettings(storage({ [SETTINGS_STORAGE_KEY]: "{" })).libraryRoot).toBe("");
  });

  it("persists the complete preference set", () => {
    const saved = storage();
    const settings = {
      libraryRoot: "/books",
      defaultOutputDirectory: "/exports",
      speechProfilesDirectory: "/profiles"
    };
    writeSettings(settings, saved);
    expect(readSettings(saved)).toEqual(settings);
  });
});

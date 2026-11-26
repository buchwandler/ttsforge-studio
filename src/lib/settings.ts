export const SETTINGS_STORAGE_KEY = "ttsforge-studio.settings.v1";

export interface StudioSettings {
  libraryRoot: string;
  defaultOutputDirectory: string;
  speechProfilesDirectory: string;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const defaults = (): StudioSettings => ({ libraryRoot: "", defaultOutputDirectory: "", speechProfilesDirectory: "" });

export function readSettings(storage: SettingsStorage = window.localStorage): StudioSettings {
  try {
    const value: unknown = JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) || "null");
    if (typeof value !== "object" || value === null) return defaults();
    const settings = value as Record<string, unknown>;
    return {
      libraryRoot: typeof settings.libraryRoot === "string" ? settings.libraryRoot : "",
      defaultOutputDirectory: typeof settings.defaultOutputDirectory === "string"
        ? settings.defaultOutputDirectory
        : "",
      speechProfilesDirectory: typeof settings.speechProfilesDirectory === "string"
        ? settings.speechProfilesDirectory
        : ""
    };
  } catch {
    return defaults();
  }
}

export function writeSettings(
  settings: StudioSettings,
  storage: SettingsStorage = window.localStorage
): void {
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings are optional; the app remains usable when browser storage is unavailable.
  }
}

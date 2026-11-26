import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";
import LibraryPage from "../src/components/LibraryPage.svelte";
import ActiveJobCloseDialog from "../src/components/ActiveJobCloseDialog.svelte";
import Navigation from "../src/components/Navigation.svelte";
import SetupPanel from "../src/components/SetupPanel.svelte";

describe("product surface components", () => {
  it("marks the active destination in a labeled navigation landmark", () => {
    const { body } = render(Navigation, { props: { active: "new", onNavigate: vi.fn() } });
    expect(body).toContain('<nav aria-label="Main navigation"');
    expect(body).toContain('aria-current="page"');
    expect(body).toContain("New audiobook");
    expect(body).toContain("Runtime &amp; models");
  });

  it("announces library loading and exposes project refresh controls", () => {
    const { body } = render(LibraryPage, {
      props: {
        root: "/books",
        busy: true,
        onRoot: vi.fn(),
        onBrowseRoot: vi.fn(),
        onRefresh: vi.fn(),
        onSelectProject: vi.fn(),
        onSaveMetadata: vi.fn(),
        onSaveChapters: vi.fn(),
        onRunQc: vi.fn(),
        onOpenOutput: vi.fn()
      }
    });
    expect(body).toContain('aria-busy="true"');
    expect(body).toContain('aria-live="polite">Loading projects');
    expect(body).toContain("No projects were found in this folder.");
  });

  it("renders backend-provided engine options and accessible preview controls", () => {
    const { body } = render(SetupPanel, {
      props: {
        enabled: true,
        previewUrl: "blob:preview",
        engineOptions: [{
          name: "speed",
          value_type: "number",
          required: false,
          default: 1,
          choices: [],
          minimum: 0.5,
          maximum: 2,
          description: "Playback speed multiplier.",
          identity_affecting: false,
          runtime_only: true
        }],
        onLanguage: vi.fn(),
        onChapters: vi.fn(),
        onOutput: vi.fn(),
        onPickOutput: vi.fn(),
        onEngine: vi.fn(),
        onTarget: vi.fn(),
        onVoice: vi.fn(),
        onPreviewVoice: vi.fn(),
        onSpacy: vi.fn(),
        onInstallSpacy: vi.fn(),
        onPause: vi.fn(),
        onSpeechProfile: vi.fn(),
        onEngineOptions: vi.fn()
      }
    });
    expect(body).toContain("Engine options (1)");
    expect(body).toContain("Save audiobook as…");
    expect(body).toContain('aria-label="Voice preview audio"');
  });
  it("links unavailable engine integrations to Runtime & models", () => {
    const { body } = render(SetupPanel, {
      props: {
        engines: [{
          id: "kitten",
          version: null,
          installed: false,
          runnable: false,
          features: ["voices"],
          reason: "Optional engine component is not installed."
        }],
        onManageEngines: vi.fn(),
        onLanguage: vi.fn(),
        onChapters: vi.fn(),
        onOutput: vi.fn(),
        onPickOutput: vi.fn(),
        onEngine: vi.fn(),
        onTarget: vi.fn(),
        onVoice: vi.fn(),
        onPreviewVoice: vi.fn(),
        onSpacy: vi.fn(),
        onInstallSpacy: vi.fn(),
        onPause: vi.fn(),
        onSpeechProfile: vi.fn(),
        onEngineOptions: vi.fn()
      }
    });

    expect(body).toContain("Some engine integrations are missing or unavailable.");
    expect(body).toContain("Manage engines");
  });

  it("explains active-job close behavior and offers tray or cancel choices", () => {
    const { body } = render(ActiveJobCloseDialog, {
      props: {
        open: false,
        busy: false,
        onContinue: vi.fn(),
        onCancelAndQuit: vi.fn(),
        onKeepOpen: vi.fn()
      }
    });
    expect(body).toContain("Keep TTSForge running?");
    expect(body).toContain("Minimize to system tray and continue");
    expect(body).toContain("Cancel job and quit");
    expect(body).toContain("Keep TTSForge open");
  });
});

import { render } from "svelte/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import EngineManager from "../src/components/EngineManager.svelte";
import RuntimeCard from "../src/components/RuntimeCard.svelte";
import StorageSummary from "../src/components/StorageSummary.svelte";
import ModelResourceManager from "../src/components/ModelResourceManager.svelte";
import {
  mockCreateResourceOperation,
  mockDesktopRuntimeStatus,
  mockEngineModelStatus,
  mockEngineModels,
  mockEngineStatuses,
  mockGetResourceOperation
} from "../src/lib/mock";
import { checkDownloadSpace, formatBytes, summarizeModelStorage } from "../src/lib/storage";
import { backendStatus, engineStatus, mutateEngine, removeRuntime } from "../src/lib/runtime";
import type { EngineMutationResult } from "../src/lib/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mutationResult: EngineMutationResult = {
  status: mockEngineStatuses()[0],
  packageMutationSucceeded: true,
  backendWasRunning: false,
  backendRestarted: false,
  message: null
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("native engine wrappers", () => {
  it("uses only fixed native commands and canonical engine identifiers", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockEngineStatuses());
    await engineStatus();
    expect(invoke).toHaveBeenCalledWith("engine_status");

    vi.mocked(invoke).mockResolvedValueOnce(mutationResult);
    await mutateEngine("kitten", "install");
    expect(invoke).toHaveBeenLastCalledWith("install_engine", { engineId: "kitten" });

    vi.mocked(invoke).mockResolvedValueOnce(null);
    await backendStatus();
    expect(invoke).toHaveBeenLastCalledWith("backend_status");
  });

  it("preserves desired engine choices by default when removing the runtime", async () => {
    vi.mocked(invoke).mockResolvedValue(mockDesktopRuntimeStatus());

    await removeRuntime();
    expect(invoke).toHaveBeenLastCalledWith("remove_runtime", { resetEngineChoices: false });

    await removeRuntime(true);
    expect(invoke).toHaveBeenLastCalledWith("remove_runtime", { resetEngineChoices: true });
  });
  it("renders explicit runtime repair and removal effects without removing external model data", () => {
    const { body } = render(RuntimeCard, {
      props: {
        status: mockDesktopRuntimeStatus(),
        backendReady: true,
        canInstall: true,
        canRepair: true,
        canRemove: true,
        onInstall: vi.fn(),
        onStart: vi.fn(),
        onRemoveRuntime: vi.fn()
      }
    });

    expect(body).toContain("Repair runtime");
    expect(body).toContain("reinstalls saved desired engine packages");
    expect(body).toContain("Remove runtime");
    expect(body).toContain("Saved desired engine choices are preserved by default");
    expect(body).toContain("Also clear saved desired engine choices");
    expect(body).toContain("Provider-owned model data, cache data, and audio outputs are not removed.");
  });
  it("refuses package changes outside Tauri", async () => {
    vi.stubGlobal("window", undefined);
    await expect(mutateEngine("kitten", "install")).rejects.toThrow(
      "Engine package changes are only available in the desktop app."
    );
    expect(invoke).not.toHaveBeenCalled();
    await expect(removeRuntime()).rejects.toThrow("Runtime removal is only available in the desktop app.");
  });
});

describe("runtime management examples", () => {
  it("renders missing, ready, update-available, broken, and unknown engine states read-only in mock mode", () => {
    const { body } = render(EngineManager, {
      props: {
        engines: mockEngineStatuses(),
        nativeDesktop: false,
        mockMode: true,
        onAction: vi.fn(),
        onRefresh: vi.fn()
      }
    });

    expect(body).toContain("Representative mock engine states");
    expect(body).toContain("Not installed");
    expect(body).toContain("Ready");
    expect(body).toContain("Update available");
    expect(body).toContain("Broken");
    expect(body).toContain("Unknown");
    expect(body).not.toContain("Up to date");
    expect(body).toContain("disabled");
  });

  it("blocks engine actions while a conversion is active", () => {
    const { body } = render(EngineManager, {
      props: {
        engines: mockEngineStatuses(),
        nativeDesktop: true,
        locked: true,
        onAction: vi.fn(),
        onRefresh: vi.fn()
      }
    });

    expect(body).toContain("Engine changes are disabled while a conversion job is active.");
    expect(body).toContain("disabled");
  });

  it("keeps runtime, engine package, and free-space totals distinct", () => {
    const { body } = render(StorageSummary, {
      props: { runtime: mockDesktopRuntimeStatus(), engines: mockEngineStatuses(), resources: mockEngineModels({ engine: "kokoro" }) }
    });

    expect(body).toContain("Managed runtime");
    expect(body).toContain("Known engine package files");
    expect(body).toContain("Managed-runtime volume free");
    expect(body).toContain("Provider cache totals and the model destination volume are not exposed");
    expect(body).toContain("At least 1.0 GiB");
    expect(body).toContain("Known unique provider bytes");
    expect(body).toContain("858.3 MiB");
    expect(body).toContain("Unknown model sizes");
  });
  it("counts shared provider storage identifiers once and adds a download safety margin", () => {
    const resources = mockEngineModels({ engine: "kokoro" });
    const totals = summarizeModelStorage(resources);
    const sufficient = checkDownloadSpace(100 * 1024 * 1024, 164 * 1024 * 1024);
    const insufficient = checkDownloadSpace(100 * 1024 * 1024, 163 * 1024 * 1024);
    const unknown = checkDownloadSpace(null, 5 * 1024 * 1024 * 1024);

    expect(totals.knownUniqueBytes).toBe(900_000_000);
    expect(totals.knownStorageCount).toBe(1);
    expect(sufficient.state).toBe("sufficient");
    expect(sufficient.marginBytes).toBe(64 * 1024 * 1024);
    expect(insufficient.state).toBe("insufficient");
    expect(unknown.state).toBe("unknown");
  });

  it("renders resource lifecycle actions, safe removal, unknown metadata, and operation progress", () => {
    const resources = [
      ...mockEngineModels({ engine: "kokoro" }),
      ...mockEngineModels({ engine: "kitten" }),
      ...mockEngineModels({ engine: "piper" }),
      ...mockEngineModels({ engine: "chatterbox" }),
      ...mockEngineModels({ engine: "qwen3" })
    ];
    const queued = mockCreateResourceOperation({
      action: "install",
      engine: "kitten",
      target: "kitten-v1",
      force: false
    });
    const running = { ...queued, id: "running-op", state: "running" as const, current: 1, total: 4 };
    const { body } = render(ModelResourceManager, {
      props: {
        resources,
        operations: [queued, running],
        availableBytes: 1024 * 1024,
        backendReady: true,
        locked: true,
        mockMode: true,
        onAction: vi.fn(),
        onPoll: vi.fn(),
        onRefresh: vi.fn()
      }
    });

    expect(body).toContain("Missing");
    expect(body).toContain("Downloaded · ready");
    expect(body).toContain("Outdated");
    expect(body).toContain("Partial");
    expect(body).toContain("Corrupt");
    expect(body).toContain("Update status unknown");
    expect(body).toContain("Install with space warning");
    expect(body).toContain("Proceed with install");
    expect(body).toContain("Confirm provider removal");
    expect(body).toContain("does not uninstall an engine package or delete a guessed local path");
    expect(body).toContain("shared storage with 1 other resource");
    expect(body).toContain("Progress is not reported by this provider.");
    expect(body).toContain("1 / 4");
    expect(body).toContain("The provider API does not support operation cancellation.");
    expect(body).not.toContain(">Cancel</button>");
    expect(body).toMatch(/<button class="secondary" type="button">\s*Verify\s*<\/button>/);
  });

  it("formats unknown and known sizes without making an unknown size look like zero", () => {
    expect(formatBytes(null)).toBe("Unknown");
    expect(formatBytes(1024)).toBe("1.0 KiB");
  });
  it("provides representative provider resource states and indeterminate mock operations", () => {
    const kokoro = mockEngineModels({ engine: "kokoro" });
    const missing = mockEngineModels({ engine: "kitten" })[0];
    const corrupt = mockEngineModels({ engine: "chatterbox" })[0];
    const partial = mockEngineModels({ engine: "piper" })[0];
    const unknown = mockEngineModelStatus({ engine: "qwen3", target: "qwen3-v1" });
    const queued = mockCreateResourceOperation({
      action: "verify",
      engine: "kokoro",
      target: "en-us-medium",
      quality: "medium",
      force: false
    });
    const completed = mockGetResourceOperation(queued.id);

    expect(kokoro.map((model) => model.state)).toEqual(["outdated", "ready"]);
    expect(kokoro[0].storage_id).toBe(kokoro[1].storage_id);
    expect(missing.state).toBe("missing");
    expect(corrupt.state).toBe("corrupt");
    expect(partial.state).toBe("partial");
    expect(unknown.update_state).toBe("unknown");
    expect(queued.state).toBe("queued");
    expect(queued.current).toBeNull();
    expect(queued.total).toBeNull();
    expect(completed.state).toBe("completed");
  });
});

import { invoke } from "@tauri-apps/api/core";
import { TTSFORGE_API_VERSION } from "./api/contract";
import { mockDesktopRuntimeStatus, mockEngineStatuses } from "./mock";
import type {
  BackendInfo,
  EngineAction,
  EngineMutationResult,
  EnginePackageStatus,
  RuntimeStatus
} from "./types";

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isMockMode(): boolean {
  return import.meta.env.VITE_TTSFORGE_MOCK === "1";
}

export async function runtimeStatus(): Promise<RuntimeStatus> {
  if (inTauri()) {
    return invoke<RuntimeStatus>("runtime_status");
  }
  if (isMockMode()) return mockDesktopRuntimeStatus();

  return {
    installed: true,
    runtimeDir: null,
    pythonVersion: null,
    ttsforgeVersion: null,
    readioVersion: null,
    runtimeBytes: null,
    freeBytes: null,
    message: "Browser mode uses an externally started TTSForge server."
  };
}

export async function installRuntime(): Promise<RuntimeStatus> {
  if (!inTauri()) {
    throw new Error("Runtime installation is only available in the desktop app.");
  }
  return invoke<RuntimeStatus>("install_runtime");
}



export async function removeRuntime(resetEngineChoices = false): Promise<RuntimeStatus> {
  if (!inTauri()) {
    throw new Error("Runtime removal is only available in the desktop app.");
  }
  return invoke<RuntimeStatus>("remove_runtime", { resetEngineChoices });
}


export async function engineStatus(): Promise<EnginePackageStatus[]> {
  if (inTauri()) return invoke<EnginePackageStatus[]>("engine_status");
  return isMockMode() ? mockEngineStatuses() : [];
}

export async function mutateEngine(
  engineId: string,
  action: EngineAction
): Promise<EngineMutationResult> {
  if (!inTauri()) {
    throw new Error("Engine package changes are only available in the desktop app.");
  }
  const commands: Record<EngineAction, string> = {
    install: "install_engine",
    update: "update_engine",
    repair: "repair_engine",
    remove: "remove_engine"
  };
  return invoke<EngineMutationResult>(commands[action], { engineId });
}

export async function backendStatus(): Promise<BackendInfo | null> {
  if (!inTauri()) return null;
  return invoke<BackendInfo | null>("backend_status");
}

export async function startBackend(): Promise<BackendInfo> {
  if (inTauri()) {
    return invoke<BackendInfo>("start_backend");
  }

  return {
    baseUrl: import.meta.env.VITE_TTSFORGE_API_URL || window.location.origin,
    token: import.meta.env.VITE_TTSFORGE_TOKEN || "",
    apiVersion: TTSFORGE_API_VERSION,
    runtimeReady: true,
    runtimeProblems: []
  };
}

export async function stopBackend(): Promise<void> {
  if (inTauri()) {
    await invoke("stop_backend");
  }
}

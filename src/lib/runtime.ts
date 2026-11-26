import { invoke } from "@tauri-apps/api/core";
import { TTSFORGE_API_VERSION } from "./api/contract";
import type { BackendInfo, RuntimeStatus } from "./types";

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function runtimeStatus(): Promise<RuntimeStatus> {
  if (inTauri()) {
    return invoke<RuntimeStatus>("runtime_status");
  }

  return {
    installed: true,
    runtimeDir: null,
    pythonVersion: null,
    ttsforgeVersion: null,
    message: import.meta.env.VITE_TTSFORGE_MOCK === "1"
      ? "Browser mock mode"
      : "Browser mode uses an externally started TTSForge server."
  };
}

export async function installRuntime(): Promise<RuntimeStatus> {
  if (!inTauri()) {
    throw new Error("Runtime installation is only available in the desktop app.");
  }
  return invoke<RuntimeStatus>("install_runtime");
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

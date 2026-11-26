<script lang="ts">
  import type { RuntimeResponse } from "../lib/api";
  import { formatBytes } from "../lib/storage";
  import type { RuntimeStatus } from "../lib/types";

  export let status: RuntimeStatus | null = null;
  export let backendRuntime: RuntimeResponse | null = null;
  export let busy = false;
  export let backendReady = false;
  export let onInstall: () => void;
  export let canInstall = false;
  export let locked = false;
  export let canRepair = false;
  export let onStart: () => void;
  export let canRemove = false;
  export let onRemoveRuntime: (resetEngineChoices: boolean) => void | Promise<void> = () => {};
  let resetEngineChoices = false;

  async function confirmRemoveRuntime() {
    await onRemoveRuntime(resetEngineChoices);
    resetEngineChoices = false;
  }
</script>

<section class="card runtime-card">
  <div class="card-title-row">
    <div>
      <p class="eyebrow">Runtime</p>
      <h2>Local TTSForge</h2>
    </div>
    <span class:ok={status?.installed} class="status-pill">
      {status?.installed ? "Installed" : "Not installed"}
    </span>
  </div>

  <p class="muted">{status?.message || "Checking managed runtime…"}</p>

  {#if status}
    <dl class="facts">
      {#if status.runtimeDir}
        <div><dt>Managed runtime</dt><dd><code>{status.runtimeDir}</code></dd></div>
      {/if}
      {#if status.pythonVersion}
        <div><dt>Python</dt><dd>{status.pythonVersion}</dd></div>
      {/if}
      <div><dt>TTSForge</dt><dd>{backendRuntime?.packages.ttsforge || status.ttsforgeVersion || "Unknown"}</dd></div>
      <div><dt>Readio</dt><dd>{backendRuntime?.packages.readio || status.readioVersion || "Unknown"}</dd></div>
      <div><dt>Runtime disk size</dt><dd>{formatBytes(status.runtimeBytes)}</dd></div>
      <div><dt>Managed-runtime volume free</dt><dd>{formatBytes(status.freeBytes)}</dd></div>
    </dl>
  {/if}

  <div class="actions">
    {#if !status?.installed}
      {#if canInstall}
        <button class="primary" disabled={busy || locked} onclick={onInstall}>
          {busy ? "Installing…" : "Install runtime"}
        </button>
      {:else}
        <p class="muted">The managed runtime is available in the Tauri desktop app. Browser mode connects to an externally started TTSForge server.</p>
      {/if}
    {:else}
      {#if !backendReady}
        <button class="primary" disabled={busy} onclick={onStart}>
          {busy ? "Starting…" : "Start backend"}
        </button>
      {:else}
        <span class="ready-line">API ready</span>
      {/if}
      {#if canRepair}
        <details class="runtime-confirm">
          <summary>Repair runtime</summary>
          <p>Rebuilds the managed Python environment and reinstalls saved desired engine packages. Provider-owned model data, cache data, and audio outputs are not removed.</p>
          <button class="secondary" disabled={busy || locked} onclick={onInstall}>
            {busy ? "Repairing…" : "Confirm runtime repair"}
          </button>
        </details>
      {/if}
      {#if canRemove}
        <details class="runtime-confirm remove-runtime">
          <summary>Remove runtime</summary>
          <p>Removes only the managed Python runtime and its installed packages. Saved desired engine choices are preserved by default and restored when the runtime is installed again. Provider-owned model data, cache data, and audio outputs are not removed.</p>
          <label>
            <input type="checkbox" bind:checked={resetEngineChoices} disabled={busy || locked} />
            Also clear saved desired engine choices
          </label>
          <button class="danger" disabled={busy || locked} onclick={confirmRemoveRuntime}>
            {busy ? "Removing…" : "Confirm runtime removal"}
          </button>
        </details>
      {/if}
    {/if}
  </div>
</section>

<style>
  .runtime-confirm { display: grid; gap: 8px; max-width: 620px; margin-top: 10px; }
  .runtime-confirm summary { cursor: pointer; }
  .runtime-confirm p { margin: 4px 0; }
  .runtime-confirm label { display: flex; align-items: center; gap: 8px; }
</style>

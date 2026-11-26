<script lang="ts">
  import type { EngineAction, EnginePackageStatus } from "../lib/types";
  import { formatBytes } from "../lib/storage";

  export let engines: EnginePackageStatus[] = [];
  export let busy = false;
  export let loading = false;
  export let locked = false;
  export let nativeDesktop = false;
  export let mockMode = false;
  export let operation = "";
  export let operationMessage = "";
  export let onAction: (engineId: string, action: EngineAction) => void;
  export let onRefresh: () => void;

  function stateLabel(state: EnginePackageStatus["state"]): string {
    return {
      not_installed: "Not installed",
      ready: "Ready",
      incompatible: "Incompatible",
      broken: "Broken",
      unknown: "Unknown"
    }[state];
  }

  function updateLabel(state: EnginePackageStatus["updateState"]): string {
    return {
      current: "Current",
      update_available: "Update available",
      unavailable: "Unavailable",
      unknown: "Unknown"
    }[state];
  }

  function catalogLabel(value: boolean | null): string {
    if (value === null) return "Unknown";
    return value ? "Yes" : "No";
  }
</script>

<section class="card engine-manager" aria-busy={busy || loading}>
  <div class="card-title-row">
    <div>
      <p class="eyebrow">Python packages</p>
      <h2>Engine packages</h2>
    </div>
    <button class="secondary" type="button" disabled={busy || loading} onclick={onRefresh}>
      {loading ? "Refreshing…" : "Refresh"}
    </button>
  </div>

  {#if mockMode && !nativeDesktop}
    <p class="notice" role="status">Representative mock engine states. Native package changes are disabled.</p>
  {:else if !nativeDesktop}
    <p class="notice" role="status">Engine package details and changes are available in the Tauri desktop app.</p>
  {/if}
  {#if locked}
    <p class="notice" role="status">Engine changes are disabled while a conversion job is active.</p>
  {/if}
  {#if operationMessage}
    <p class="operation" role="status" aria-live="polite">{operationMessage}</p>
  {/if}

  {#if loading && engines.length === 0}
    <p class="muted" aria-live="polite">Loading engine package status…</p>
  {:else if engines.length === 0}
    <p class="muted">No engine package status is available in this browser session.</p>
  {:else}
    <div class="engine-list">
      {#each engines as engine (engine.engineId)}
        <article class="engine-row">
          <div class="engine-heading">
            <div>
              <p class="eyebrow">{engine.engineId}</p>
              <h3>{engine.label}</h3>
            </div>
            <span
              class="status-pill"
              class:ok={engine.state === "ready"}
              class:bad={engine.state === "broken" || engine.state === "incompatible"}
            >
              {stateLabel(engine.state)}
            </span>
          </div>

          <dl class="facts">
            <div><dt>Package</dt><dd><code>{engine.distribution}</code></dd></div>
            <div><dt>Installed version</dt><dd>{engine.installedVersion ?? "Not installed"}</dd></div>
            <div><dt>Supported requirement</dt><dd><code>{engine.supportedRequirement ?? "Unknown"}</code></dd></div>
            <div><dt>Package size</dt><dd>{formatBytes(engine.packageBytes)}</dd></div>
            <div><dt>Catalog installed</dt><dd>{catalogLabel(engine.catalogInstalled)}</dd></div>
            <div><dt>Catalog runnable</dt><dd>{catalogLabel(engine.catalogRunnable)}</dd></div>
            <div><dt>Update state</dt><dd>{updateLabel(engine.updateState)}{engine.availableVersion ? ` (${engine.availableVersion})` : ""}</dd></div>
          </dl>

          {#if engine.message || engine.catalogReason}
            <p class="muted engine-message">{engine.catalogReason || engine.message}</p>
          {/if}

          <div class="actions">
            {#if !engine.installed}
              <button
                class="primary"
                type="button"
                disabled={!nativeDesktop || busy || loading || locked}
                onclick={() => onAction(engine.engineId, "install")}
              >
                {operation.startsWith(`${engine.engineId}:install`) ? "Installing…" : "Install"}
              </button>
            {:else}
              <button
                class="primary"
                type="button"
                disabled={!nativeDesktop || busy || loading || locked}
                onclick={() => onAction(engine.engineId, "update")}
              >
                {operation.startsWith(`${engine.engineId}:update`) ? "Updating…" : "Update"}
              </button>
              <button
                class="secondary"
                type="button"
                disabled={!nativeDesktop || busy || loading || locked}
                onclick={() => onAction(engine.engineId, "repair")}
              >
                {operation.startsWith(`${engine.engineId}:repair`) ? "Repairing…" : "Repair"}
              </button>
              <button
                class="danger"
                type="button"
                disabled={!nativeDesktop || busy || loading || locked}
                onclick={() => onAction(engine.engineId, "remove")}
              >
                {operation.startsWith(`${engine.engineId}:remove`) ? "Removing…" : "Uninstall"}
              </button>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .engine-list { display: grid; gap: 14px; }
  .engine-row { border: 1px solid #2c3341; border-radius: 14px; padding: 17px; background: #10151f; }
  .engine-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
  .engine-heading h3 { margin-bottom: 0; }
  .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 18px; margin: 16px 0 0; }
  .facts div { min-width: 0; }
  .facts dt { color: #929aac; font-size: 0.8rem; }
  .facts dd { overflow-wrap: anywhere; margin: 3px 0 0; }
  .engine-message { margin: 14px 0 0; }
  .notice { margin: 0 0 14px; color: #c5d5f3; }
  .operation { margin: 0 0 14px; color: #dce8ff; }
  .status-pill.bad { border-color: #704343; color: #ffd1d1; background: #251515; }
  @media (max-width: 760px) { .facts { grid-template-columns: 1fr; } }
</style>

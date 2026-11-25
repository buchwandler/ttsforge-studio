<script lang="ts">
  import type { RuntimeStatus } from "../lib/types";

  export let status: RuntimeStatus | null = null;
  export let busy = false;
  export let backendReady = false;
  export let onInstall: () => void;
  export let onStart: () => void;
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

  {#if status?.pythonVersion || status?.ttsforgeVersion}
    <dl class="facts">
      {#if status.pythonVersion}
        <div><dt>Python</dt><dd>{status.pythonVersion}</dd></div>
      {/if}
      {#if status.ttsforgeVersion}
        <div><dt>TTSForge</dt><dd>{status.ttsforgeVersion}</dd></div>
      {/if}
    </dl>
  {/if}

  <div class="actions">
    {#if !status?.installed}
      <button class="primary" disabled={busy} onclick={onInstall}>
        {busy ? "Installing…" : "Install runtime"}
      </button>
    {:else if !backendReady}
      <button class="primary" disabled={busy} onclick={onStart}>
        {busy ? "Starting…" : "Start backend"}
      </button>
    {:else}
      <span class="ready-line">API ready</span>
    {/if}
  </div>
</section>

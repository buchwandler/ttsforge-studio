<script lang="ts">
  import type { BackendInfo } from "../lib/types";
  import type { RuntimeResponse, SystemResponse } from "../lib/api";

  export let backend: BackendInfo | null = null;
  export let system: SystemResponse | null = null;
  export let runtime: RuntimeResponse | null = null;
  export let onRefresh: () => void;
  export let busy = false;
</script>

<section class="card" aria-labelledby="diagnostics-title">
  <div class="card-title-row">
    <div>
      <p class="eyebrow">Local backend</p>
      <h2 id="diagnostics-title">Diagnostics</h2>
    </div>
    <button class="secondary" type="button" disabled={!backend || busy} onclick={onRefresh}>
      {busy ? "Checking…" : "Refresh diagnostics"}
    </button>
  </div>
  {#if backend}
    <dl class="facts">
      <div><dt>Connection</dt><dd>{backend.baseUrl}</dd></div>
      <div><dt>API version</dt><dd>{system?.api_version ?? backend.apiVersion}</dd></div>
      <div><dt>TTSForge</dt><dd>{system?.ttsforge_version || "Unavailable"}</dd></div>
      <div><dt>Python</dt><dd>{system?.python_version || "Unavailable"}</dd></div>
    </dl>
    {#if runtime}
      <h3>Operational runtime</h3>
      <p class:good={runtime.ready} class:bad={!runtime.ready} role="status">
        {runtime.ready ? "Ready" : "Not ready"}
      </p>
      {#if runtime.problems.length}
        <ul>
          {#each runtime.problems as problem (problem.code)}
            <li><strong>{problem.code}</strong>: {problem.message}</li>
          {/each}
        </ul>
      {/if}
    {/if}
    {#if system}
      <h3>Capabilities</h3>
      <ul>
        {#each Object.entries(system.capabilities) as [name, supported] (name)}
          <li>{name}: {supported ? "Available" : "Unavailable"}</li>
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="muted">Start the local backend to inspect runtime diagnostics.</p>
  {/if}
</section>

<style>
  .good { color: #a4e3b3; }
  .bad { color: #ffb2b2; }
</style>

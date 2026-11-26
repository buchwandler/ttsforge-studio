<script lang="ts">
  import type { JobSummary } from "../lib/types";

  export let jobs: JobSummary[] = [];
  export let selectedId: string | null = null;
  export let busy = false;
  export let onSelect: (id: string) => void;
</script>

<section class="card" aria-labelledby="job-history-title">
  <div class="card-title-row">
    <div>
      <p class="eyebrow">Persistent jobs</p>
      <h2 id="job-history-title">Job history</h2>
    </div>
    <span class="status-pill">{jobs.length}</span>
  </div>

  {#if jobs.length}
    <ul class="job-list">
      {#each jobs as item (item.id)}
        <li>
          <button
            class="job-entry"
            class:selected={item.id === selectedId}
            aria-pressed={item.id === selectedId}
            disabled={busy}
            onclick={() => onSelect(item.id)}
          >
            <span class="job-state">{item.state}</span>
            <span class="job-output">{item.output || item.project || item.id}</span>
            <time datetime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">Completed and active jobs will appear here.</p>
  {/if}
</section>

<style>
  .job-list { display: grid; gap: 0.45rem; margin: 0; padding: 0; list-style: none; }
  .job-entry {
    display: grid;
    width: 100%;
    grid-template-columns: minmax(5rem, auto) 1fr auto;
    align-items: center;
    gap: 0.8rem;
    border: 1px solid #353d4c;
    color: #e6eaf2;
    background: #111620;
    text-align: left;
  }
  .job-entry.selected { border-color: #7181a5; background: #171c27; }
  .job-output { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .job-entry time { color: #929aac; font-size: 0.82rem; }
  @media (max-width: 780px) {
    .job-entry { grid-template-columns: 1fr; gap: 0.3rem; }
  }
</style>

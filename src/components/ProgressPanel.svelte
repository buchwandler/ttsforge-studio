<script lang="ts">
  import type { JobStatus } from "../lib/types";

  export let job: JobStatus | null = null;
  export let onCancel: () => void;

  function percent(): number | null {
    const p = job?.progress;
    if (!p || p.current == null || p.total == null || p.total <= 0) return null;
    return Math.max(0, Math.min(100, (p.current / p.total) * 100));
  }

  function elapsed(): string {
    const seconds = job?.progress?.elapsed_seconds;
    if (seconds == null) return "—";
    const whole = Math.floor(seconds);
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = whole % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  }

  function chapter(): string {
    const details = job?.progress?.details || {};
    const n = details.chapter_number;
    const title = details.chapter_title;
    if (typeof n === "number" && typeof title === "string") return `${n} · ${title}`;
    if (typeof title === "string") return title;
    if (typeof n === "number") return `Chapter ${n}`;
    return "—";
  }
</script>

<section class="card progress-card">
  <div class="card-title-row">
    <div>
      <p class="eyebrow">Audiobook workflow</p>
      <h2>{job ? job.state : "Idle"}</h2>
    </div>
    {#if job}
      <span class="status-pill" class:ok={job.state === "completed"}>
        {job.state}
      </span>
    {/if}
  </div>

  {#if job}
    <div class="progress-track" aria-label="stage progress">
      <div class="progress-fill" style={`width: ${percent() ?? 0}%`}></div>
    </div>

    <dl class="facts progress-facts">
      <div><dt>Stage</dt><dd>{job.progress?.stage || "Preparing"}</dd></div>
      <div><dt>Chapter</dt><dd>{chapter()}</dd></div>
      <div><dt>Elapsed</dt><dd>{elapsed()}</dd></div>
      <div>
        <dt>Units</dt>
        <dd>
          {#if job.progress?.current != null && job.progress?.total != null}
            {job.progress.current}/{job.progress.total}
          {:else}
            —
          {/if}
        </dd>
      </div>
    </dl>

    {#if job.progress?.message}
      <p class="muted">{job.progress.message}</p>
    {/if}

    {#if job.error}
      <div class="error-box">
        <strong>{job.error.type}</strong>
        <span>{job.error.message}</span>
      </div>
    {/if}

    {#if job.result}
      <div class="result-box">
        <strong>Audiobook created</strong>
        <span>{job.result.output}</span>
      </div>
    {/if}

    {#if ["queued", "preparing", "running"].includes(job.state)}
      <button class="danger" onclick={onCancel}>Cancel</button>
    {/if}
  {:else}
    <p class="muted">
      Select and configure a book. Progress events from TTSForge will appear here.
    </p>
  {/if}
</section>

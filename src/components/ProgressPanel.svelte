<script lang="ts">
  import type { JobEvent, JobError, JobStatus } from "../lib/types";
  import { canRetryJob, serializeJobError } from "../lib/jobs/state";

  export let job: JobStatus | null = null;
  export let events: JobEvent[] = [];
  export let historyTruncated = false;
  export let reconnecting = false;
  export let cancelling = false;
  export let actionBusy = false;
  export let trackingMessage = "";
  export let trackingError: JobError | null = null;
  export let onCancel: () => void;
  export let onRetry: () => void;
  export let onCopyOutput: () => void;
  export let onOpenOutput: (path: string) => void;
  export let canOpenOutput = true;

  function percent(): number | null {
    const progress = job?.progress;
    if (!progress || progress.current == null || progress.total == null || progress.total <= 0) return null;
    return Math.max(0, Math.min(100, (progress.current / progress.total) * 100));
  }

  function elapsed(): string {
    const seconds = job?.progress?.elapsed_seconds;
    if (seconds == null) return "—";
    const whole = Math.floor(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const remainder = whole % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function chapter(): string {
    const details = job?.progress?.details || {};
    const number = details.chapter_number;
    const title = details.chapter_title;
    if (typeof number === "number" && typeof title === "string") return `${number} · ${title}`;
    if (typeof title === "string") return title;
    if (typeof number === "number") return `Chapter ${number}`;
    return "—";
  }

  function describeEvent(item: JobEvent): string {
    if (item.event.type === "job.state") return `Job ${item.event.state}`;
    if (item.event.type === "job.prepared") return `Prepared ${item.event.project}, output ${item.event.output}`;
    const event = item.event.event;
    return event.message || `${event.stage} · ${event.kind}`;
  }

  function details(value: JobError): string {
    return serializeJobError(value);
  }
</script>

<section class="card progress-card" aria-labelledby="progress-title">
  <div class="card-title-row">
    <div>
      <p class="eyebrow">Audiobook workflow</p>
      <h2 id="progress-title">{job ? (cancelling ? "Cancelling…" : job.state) : "Idle"}</h2>
    </div>
    {#if job}
      <span class="status-pill" class:ok={job.state === "completed"}>
        {cancelling ? "cancelling" : reconnecting ? "reconnecting" : job.state}
      </span>
    {/if}
  </div>

  {#if job}
    <div
      class="progress-track"
      role="progressbar"
      aria-label="Job progress"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={percent() ?? undefined}
    >
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

    {#if job.progress?.message || reconnecting || cancelling}
      <p class="muted" aria-live="polite">
        {cancelling ? "Cancellation requested. Waiting for the backend." : reconnecting ? "Connection lost. Reconnecting to the persistent job…" : job.progress?.message}
      </p>
    {/if}
    {#if trackingMessage}
      <p class="muted" role="status">{trackingMessage}</p>
    {/if}
    {#if trackingError}
      <div class="error-box" role="status">
        <strong>{trackingError.type}: {trackingError.message}</strong>
        <details><summary>Connection error details</summary><pre>{details(trackingError)}</pre></details>
      </div>
    {/if}

    {#if job.error}
      <div class="error-box" role="alert">
        <strong>{job.error.type}</strong>
        <span>{job.error.message}</span>
        <details><summary>Job error details</summary><pre>{details(job.error)}</pre></details>
      </div>
    {/if}

    {#if job.result || job.output}
      <div class="result-box">
        <strong>Audiobook created</strong>
        <span>{job.result?.output || job.output}</span>
        <button class="secondary" disabled={actionBusy} onclick={onCopyOutput}>Copy output path</button>
        <button class="secondary" disabled={actionBusy || !canOpenOutput || !(job.result?.output || job.output)} onclick={() => onOpenOutput(job.result?.output || job.output || "")}>Open output</button>
      </div>
    {/if}

    {#if events.length}
      <details class="event-details">
        <summary>Recent events ({events.length})</summary>
        {#if historyTruncated}
          <p class="muted">Older backend events have expired. The current job state was refreshed.</p>
        {/if}
        <ol aria-label="Recent job events">
          {#each events as item (item.seq)}
            <li>
              <time datetime={item.timestamp}>{new Date(item.timestamp).toLocaleTimeString()}</time>
              <span>{describeEvent(item)}</span>
            </li>
          {/each}
        </ol>
      </details>
    {/if}

    <div class="job-actions">
      {#if ["queued", "preparing", "running"].includes(job.state)}
        <button class="danger" disabled={actionBusy || cancelling} onclick={onCancel}>
          {cancelling ? "Cancelling…" : "Cancel job"}
        </button>
      {/if}
      {#if canRetryJob(job.state)}
        <button class="primary" disabled={actionBusy} onclick={onRetry}>Retry job</button>
      {/if}
    </div>
  {:else}
    <p class="muted">Select a job or configure an audiobook. Persistent jobs will appear here.</p>
  {/if}
</section>

<style>
  .event-details { margin-top: 1rem; }
  .event-details summary { cursor: pointer; font-weight: 650; }
  .event-details ol { display: grid; gap: 0.45rem; max-height: 18rem; overflow: auto; padding-left: 1.25rem; }
  .event-details li { display: grid; grid-template-columns: auto 1fr; gap: 0.8rem; }
  .event-details time { color: #929aac; font-variant-numeric: tabular-nums; }
  .job-actions { display: flex; flex-wrap: wrap; gap: 0.7rem; margin-top: 1rem; }
  pre { overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>

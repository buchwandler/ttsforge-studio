<script lang="ts">
  import type { PreflightResponse } from "../lib/types";
  import { workflowBlockers } from "../lib/setup/conversion-workflow";

  export let preflight: PreflightResponse | null = null;
  export let conflict = false;
  export let busy = false;
  export let onBack: () => void;
  export let onChooseOutput: () => void;
  export let onReplaceOutput: () => void;
  export let onConfirm: () => void;

  $: blockers = preflight ? workflowBlockers(preflight) : [];
  $: outputConflict = conflict || blockers.some(({ blocker }) => blocker.code === "output_exists");
</script>

<section class="card review" aria-labelledby="review-title">
  <div class="card-title-row">
    <div>
      <p class="eyebrow">Preflight review</p>
      <h2 id="review-title">{outputConflict ? "Output already exists" : "Ready to build"}</h2>
    </div>
    <span class="status-pill" class:ok={preflight?.workflow.executable && !outputConflict}>
      {preflight?.workflow.executable && !outputConflict ? "Ready" : "Action required"}
    </span>
  </div>

  {#if outputConflict}
    <p>The selected output already exists. Choose another location or explicitly replace it.</p>
    {#if blockers.length}
      <ul>
        {#each blockers as item}
          <li><strong>{item.stage}:</strong> {item.blocker.message}</li>
        {/each}
      </ul>
    {/if}
    {#if preflight?.workflow.warnings.length}
      <ul>
        {#each preflight.workflow.warnings as warning}
          <li>{warning}</li>
        {/each}
      </ul>
    {/if}
    <div class="review-actions">
      <button class="secondary" disabled={busy} onclick={onChooseOutput}>Choose another location</button>
      <button class="danger" disabled={busy} onclick={onReplaceOutput}>Replace existing file</button>
      <button class="secondary" disabled={busy} onclick={onBack}>Cancel</button>
    </div>
  {:else if preflight}
    <div class="review-summary">
      <div>
        <h3>Output</h3>
        <p>{preflight.workflow.output || preflight.request.output || "Selected by TTSForge"}</p>
      </div>
      <div>
        <h3>Preparation</h3>
        {#if preflight.workflow.steps.length}
          <ul>
            {#each preflight.workflow.steps as step}
              <li>
                <strong>{step.stage}</strong>
                <span>{step.action}: {step.reason}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p>No additional preparation reported.</p>
        {/if}
      </div>
      {#if blockers.length}
        <div class="error-box" role="alert">
          <strong>Build blockers</strong>
          <ul>
            {#each blockers as item}
              <li>
                <strong>{item.stage}</strong>
                <span>{item.blocker.message}</span>
                {#if item.blocker.suggested_action}
                  <span>{item.blocker.suggested_action}</span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if preflight.workflow.warnings.length}
        <div class="warning-box" role="status">
          <strong>Warnings</strong>
          <ul>
            {#each preflight.workflow.warnings as warning}
              <li>{warning}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
    <div class="review-actions">
      <button class="secondary" disabled={busy} onclick={onBack}>Back</button>
      <button
        class="primary"
        disabled={busy || !preflight.workflow.executable || blockers.length > 0}
        onclick={onConfirm}
      >
        {busy ? "Starting…" : "Create audiobook"}
      </button>
    </div>
  {:else}
    <p role="alert">Preflight could not be completed. Adjust the output or settings and try again.</p>
    <div class="review-actions">
      <button class="secondary" disabled={busy} onclick={onChooseOutput}>Choose another location</button>
      <button class="secondary" disabled={busy} onclick={onBack}>Back</button>
    </div>
  {/if}
</section>

<style>
  .review-summary { display: grid; gap: 1rem; }
  .review-summary h3 { margin: 0 0 0.35rem; }
  .review-summary p { margin: 0; overflow-wrap: anywhere; }
  .review-summary ul { margin: 0.4rem 0 0; padding-left: 1.25rem; }
  .review-summary li { margin: 0.3rem 0; }
  .review-summary li span { display: block; }
  .review-actions { display: flex; flex-wrap: wrap; gap: 0.7rem; margin-top: 1.25rem; }
.warning-box {
  border: 1px solid #66552f;
  border-radius: 11px;
  padding: 12px 14px;
  color: #f0dfb1;
  background: #211c12;
}
</style>

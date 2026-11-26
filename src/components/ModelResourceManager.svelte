<script lang="ts">
  import type { EngineModelResource, ResourceOperation } from "../lib/api";
  import { checkDownloadSpace, formatBytes } from "../lib/storage";

  type ResourceAction = "install" | "update" | "verify" | "remove";
  type ResourceSelector = { engine: string; target: string; quality: string | null };

  export let resources: EngineModelResource[] = [];
  export let operations: ResourceOperation[] = [];
  export let inventoryErrors: string[] = [];
  export let operationErrors: Record<string, string> = {};
  export let availableBytes: number | null = null;
  export let loading = false;
  export let backendReady = false;
  export let resourceNotice = "";
  export let busy = false;
  export let locked = false;
  export let busyResourceKey = "";
  export let mockMode = false;
  export let onAction: (resource: EngineModelResource, action: ResourceAction) => void;
  export let onPoll: (operationId: string) => void;
  export let onRefresh: () => void;

  function resourceKey(resource: ResourceSelector): string {
    return `${resource.engine}:${resource.target}:${resource.quality ?? ""}`;
  }

  function resourceLabel(resource: EngineModelResource): string {
    return resource.label || `${resource.engine} / ${resource.target}${resource.quality ? ` / ${resource.quality}` : ""}`;
  }

  function stateLabel(state: EngineModelResource["state"]): string {
    return {
      missing: "Missing",
      ready: "Downloaded · ready",
      outdated: "Outdated",
      partial: "Partial",
      corrupt: "Corrupt",
      unavailable: "Unavailable",
      unknown: "Unknown"
    }[state];
  }

  function updateLabel(state: EngineModelResource["update_state"]): string {
    return {
      current: "Current",
      update_available: "Update available",
      unavailable: "Update status unavailable",
      unknown: "Update status unknown"
    }[state];
  }

  function operationLabel(operation: ResourceOperation): string {
    return `${operation.action} · ${operation.engine} / ${operation.target}${operation.quality ? ` / ${operation.quality}` : ""}`;
  }

  function hasActiveOperation(resource: EngineModelResource): boolean {
    const key = resourceKey(resource);
    return operations.some((operation) =>
      resourceKey(operation) === key && (operation.state === "queued" || operation.state === "running")
    );
  }
  function actionDisabled(resource: EngineModelResource, action: ResourceAction): boolean {
    return !backendReady || busy || loading || (locked && action !== "verify") || busyResourceKey === resourceKey(resource) || hasActiveOperation(resource);
  }

  function needsSpaceConfirmation(resource: EngineModelResource): boolean {
    return checkDownloadSpace(resource.bytes_download, availableBytes).state === "insufficient";
  }

  function sharedResourceCount(resource: EngineModelResource): number {
    if (!resource.storage_id) return 0;
    return resources.filter((item) =>
      item.storage_id === resource.storage_id && resourceKey(item) !== resourceKey(resource)
    ).length;
  }
</script>

<section class="card model-manager" aria-busy={loading || busy}>
  <div class="card-title-row">
    <div>
      <p class="eyebrow">Provider-owned resources</p>
      <h2>Model inventory</h2>
    </div>
    <button class="secondary" type="button" disabled={!backendReady || loading || busy} onclick={onRefresh}>
      {loading ? "Refreshing…" : "Refresh models"}
    </button>
  </div>

  {#if mockMode}
    <p class="notice" role="status">Representative provider resource states are mocked. Engine package changes remain native-only.</p>
  {/if}
  {#if locked}
    <p class="notice" role="status">Install, update, and remove are disabled while a conversion job is active. Verification remains available.</p>
  {/if}
  {#if resourceNotice}
    <p class="notice" role="status">{resourceNotice}</p>
  {/if}
  <p class="muted ownership-note">Actions are sent to the TTSForge resource API. Local model and cache paths are not shown unless the provider explicitly marks a path safe for diagnostics.</p>

  {#if !backendReady}
    <p class="muted">Connect to TTSForge to inspect provider-owned resources.</p>
  {:else if loading && resources.length === 0}
    <p class="muted" aria-live="polite">Loading model inventory…</p>
  {:else if resources.length === 0 && inventoryErrors.length === 0}
    <p class="muted">No provider model resources were returned for the available engines.</p>
  {/if}

  {#if inventoryErrors.length > 0}
    <div class="error-list" role="alert">
      {#each inventoryErrors as message (message)}<p>{message}</p>{/each}
    </div>
  {/if}

  {#if resources.length > 0}
    <div class="resource-list">
      {#each resources as resource (resourceKey(resource))}
        <article class="resource-row">
          <div class="resource-heading">
            <div>
              <p class="eyebrow">{resource.engine} · {resource.target}{resource.quality ? ` · ${resource.quality}` : ""}</p>
              <h3>{resourceLabel(resource)}</h3>
            </div>
            <span class="status-pill" class:ok={resource.state === "ready"} class:bad={resource.state === "corrupt" || resource.state === "partial"}>
              {stateLabel(resource.state)}
            </span>
          </div>

          <dl class="resource-facts">
            <div><dt>Installed version</dt><dd>{resource.local_version ?? "Unknown"}</dd></div>
            <div><dt>Provider version</dt><dd>{resource.available_version ?? "Unknown"}</dd></div>
            <div><dt>Update status</dt><dd>{updateLabel(resource.update_state)}</dd></div>
            <div><dt>Installed size</dt><dd>{formatBytes(resource.bytes_installed)}</dd></div>
            <div><dt>Download size</dt><dd>{formatBytes(resource.bytes_download)}</dd></div>
            {#if resource.language}<div><dt>Language</dt><dd>{resource.language}</dd></div>{/if}
          </dl>

          {#if resource.reason}
            <p class="muted resource-reason">{resource.reason}</p>
          {/if}

          {#if resource.bytes_download === null}
            <p class="space-note">The provider did not report a download size, so available-space requirements cannot be estimated.</p>
          {:else if availableBytes === null}
            <p class="space-note">Available space on the managed-runtime volume is unknown. The provider's model destination is not exposed.</p>
          {:else}
            {@const space = checkDownloadSpace(resource.bytes_download, availableBytes)}
            <p class="space-note" class:space-low={space.state === "insufficient"}>
              {#if space.state === "insufficient"}The managed-runtime volume has {formatBytes(availableBytes)} free, below the estimated {formatBytes(space.requiredBytes)} including the safety margin. {/if}The provider download estimate is {formatBytes(resource.bytes_download)}. The estimate includes a 10% margin with a 64 MiB minimum. This check uses the managed-runtime volume and is advisory because the provider does not expose the model destination volume.
            </p>
          {/if}

          <div class="resource-actions">
            {#if resource.installable && (!resource.installed || resource.state === "partial" || resource.state === "corrupt")}
              {#if needsSpaceConfirmation(resource)}
                <details class="space-confirm">
                  <summary>Install with space warning</summary>
                  <p>The download needs about {formatBytes(checkDownloadSpace(resource.bytes_download, availableBytes).requiredBytes)} including the safety margin on the managed-runtime volume. Provider storage may use another location.</p>
                  <button class="primary" type="button" disabled={actionDisabled(resource, "install")} onclick={() => onAction(resource, "install")}>Proceed with install</button>
                </details>
              {:else}
                <button class="primary" type="button" disabled={actionDisabled(resource, "install")} onclick={() => onAction(resource, "install")}>
                  {resource.installed ? "Retry install" : "Install"}
                </button>
              {/if}
            {/if}
            {#if resource.updatable && resource.update_state !== "current"}
              {#if needsSpaceConfirmation(resource)}
                <details class="space-confirm">
                  <summary>Update with space warning</summary>
                  <p>The download needs about {formatBytes(checkDownloadSpace(resource.bytes_download, availableBytes).requiredBytes)} including the safety margin on the managed-runtime volume. Provider storage may use another location.</p>
                  <button class="primary" type="button" disabled={actionDisabled(resource, "update")} onclick={() => onAction(resource, "update")}>Proceed with update</button>
                </details>
              {:else}
                <button class="primary" type="button" disabled={actionDisabled(resource, "update")} onclick={() => onAction(resource, "update")}>
                  {resource.update_state === "unknown" ? "Update (status unknown)" : "Update"}
                </button>
              {/if}
            {/if}
            {#if resource.verifiable}
              <button class="secondary" type="button" disabled={actionDisabled(resource, "verify")} onclick={() => onAction(resource, "verify")}>
                Verify
              </button>
            {/if}
            {#if resource.removable}
              <details class="remove-confirm">
                <summary aria-disabled={actionDisabled(resource, "remove")}>Remove</summary>
                <p>Confirm removal through the provider API. This does not uninstall an engine package or delete a guessed local path.</p>
                {#if sharedResourceCount(resource) > 0}
                  <p class="space-note">The provider reports shared storage with {sharedResourceCount(resource)} other resource(s). Removal may affect that shared data.</p>
                {/if}
                <button class="danger" type="button" disabled={actionDisabled(resource, "remove")} onclick={() => onAction(resource, "remove")}>
                  Confirm provider removal
                </button>
              </details>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}

  <p class="muted cancellation-note">The provider API does not support operation cancellation. Active actions continue until the provider reports completion or failure.</p>
</section>

{#if operations.length > 0}
  <section class="card operation-list" aria-label="Resource operations">
    <div class="card-title-row">
      <div>
        <p class="eyebrow">Provider activity</p>
        <h2>Resource operations</h2>
      </div>
    </div>
    {#each operations as operation (operation.id)}
      <article class="operation-row">
        <div class="resource-heading">
          <div>
            <h3>{operationLabel(operation)}</h3>
            {#if operation.message}<p class="muted">{operation.message}</p>{/if}
          </div>
          <span class="status-pill" class:ok={operation.state === "completed"} class:bad={operation.state === "failed"}>
            {operation.state}
          </span>
        </div>
        {#if operation.state === "queued" || operation.state === "running"}
          {#if operation.current !== null && operation.total !== null && operation.total > 0}
            <progress aria-label={`Progress for ${operationLabel(operation)}`} max={operation.total} value={operation.current}></progress>
            <p>{operation.current} / {operation.total}</p>
          {:else}
            <progress aria-label={`Indeterminate progress for ${operationLabel(operation)}`}></progress>
            <p class="muted">Progress is not reported by this provider.</p>
          {/if}
        {:else if operation.error}
          <p class="error-text">{operation.error.message}</p>
          {#if operation.error.suggested_action}
            <p class="muted">Suggested action: {operation.error.suggested_action}</p>
          {/if}
          {#if operation.error.code}
            <small>Provider error code: {operation.error.code}</small>
          {/if}
        {/if}
        {#if operationErrors[operation.id]}
          <p class="error-text" role="alert">{operationErrors[operation.id]}</p>
          <button class="secondary" type="button" onclick={() => onPoll(operation.id)}>Refresh operation status</button>
        {/if}
      </article>
    {/each}
  </section>
{/if}

<style>
  .model-manager, .operation-list { display: grid; gap: 14px; }
  .ownership-note, .cancellation-note { margin: 0; }
  .resource-list { display: grid; gap: 14px; }
  .resource-row, .operation-row { border: 1px solid #2c3341; border-radius: 14px; padding: 17px; background: #10151f; }
  .resource-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
  .resource-heading h3 { margin: 0; }
  .resource-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 18px; margin: 16px 0; }
  .resource-facts div { min-width: 0; }
  .resource-facts dt { color: #929aac; font-size: 0.8rem; }
  .resource-facts dd { overflow-wrap: anywhere; margin: 3px 0 0; }
  .resource-reason { margin: 0 0 12px; }
  .resource-actions { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; margin-top: 12px; }
  .remove-confirm { border: 1px solid #704343; border-radius: 9px; padding: 7px 10px; color: #ffd1d1; }
  .remove-confirm summary { cursor: pointer; }
  .remove-confirm p { max-width: 620px; color: #e3c6c6; }
  .space-note { color: #c5d5f3; font-size: 0.88rem; }
  .space-low { color: #ffd1a8; }
  .error-list, .error-text { color: #ffbaba; }
  .error-list p { margin: 5px 0; }
  .operation-row { display: grid; gap: 8px; margin-top: 12px; }
  .operation-row h3 { font-size: 1rem; }
  .operation-row p { margin: 4px 0; }
  progress { width: min(100%, 560px); }
  @media (max-width: 760px) { .resource-facts { grid-template-columns: 1fr 1fr; } }
</style>

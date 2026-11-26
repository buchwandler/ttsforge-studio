<script lang="ts">
  import ModelResourceManager from "./ModelResourceManager.svelte";
  import RuntimeCard from "./RuntimeCard.svelte";
  import EngineManager from "./EngineManager.svelte";
  import StorageSummary from "./StorageSummary.svelte";
  import type {
    EngineAction,
    EnginePackageStatus,
    RuntimeStatus
  } from "../lib/types";
  import type { RuntimeResponse } from "../lib/api";
  import type { EngineModelResource, ResourceOperation, ResourceOperationRequest } from "../lib/api";

  export let runtime: RuntimeStatus | null = null;
  export let runtimeDetails: RuntimeResponse | null = null;
  export let engines: EnginePackageStatus[] = [];
  export let busy = false;
  export let refreshing = false;
  export let backendReady = false;
  export let locked = false;
  export let nativeDesktop = false;
  export let mockMode = false;
  export let operation = "";
  export let resources: EngineModelResource[] = [];
  export let resourceOperations: ResourceOperation[] = [];
  export let resourceInventoryErrors: string[] = [];
  export let resourceNotice = "";
  export let resourceOperationErrors: Record<string, string> = {};
  export let resourceLoading = false;
  export let resourceBusyKey = "";
  export let onResourceAction: (resource: EngineModelResource, action: ResourceOperationRequest["action"]) => void;
  export let onPollResourceOperation: (operationId: string) => void;
  export let operationMessage = "";
  export let notice = "";
  export let onInstallRuntime: () => void;
  export let onStartBackend: () => void;
  export let onEngineAction: (engineId: string, action: EngineAction) => void;
  export let onRemoveRuntime: (resetEngineChoices: boolean) => void | Promise<void> = () => {};
  export let onRefresh: () => void;
</script>

<main class="runtime-workspace">
  <header class="workspace-heading">
    <p class="eyebrow">Management</p>
    <h1>Runtime &amp; models</h1>
    <p class="muted">Manage the desktop Python runtime and supported synthesis engine packages.</p>
  </header>

  <div class="dashboard">
    <RuntimeCard
      status={runtime}
      backendRuntime={runtimeDetails}
      {busy}
      {backendReady}
      locked={locked || busy}
      canRepair={nativeDesktop}
      canInstall={nativeDesktop}
      canRemove={nativeDesktop}
      onRemoveRuntime={onRemoveRuntime}
      onInstall={onInstallRuntime}
      onStart={onStartBackend}
    />

    <StorageSummary {runtime} {engines} resources={resources} />

    <div class="span-2">
      <EngineManager
        {engines}
        {busy}
        loading={refreshing}
        {locked}
        {nativeDesktop}
        {mockMode}
        {operation}
        operationMessage={operationMessage}
        onAction={onEngineAction}
        onRefresh={onRefresh}
      />
      {#if notice}
        <p class="notice" role="status">{notice}</p>
      {/if}
    </div>

    <div class="span-2">
      <ModelResourceManager
        resources={resources}
        operations={resourceOperations}
        inventoryErrors={resourceInventoryErrors}
        operationErrors={resourceOperationErrors}
        resourceNotice={resourceNotice}
        availableBytes={runtime?.freeBytes ?? null}
        loading={resourceLoading}
        backendReady={backendReady}
        busy={busy || !!resourceBusyKey}
        {locked}
        busyResourceKey={resourceBusyKey}
        {mockMode}
        onAction={onResourceAction}
        onPoll={onPollResourceOperation}
        onRefresh={onRefresh}
      />
    </div>
  </div>
</main>

<style>
  .runtime-workspace { display: grid; gap: 18px; }
  .workspace-heading h1 { margin: 0; font-size: clamp(1.8rem, 4vw, 2.6rem); letter-spacing: -0.04em; }
  .workspace-heading p:last-child { margin: 8px 0 0; }
</style>

<script lang="ts">
  import type { EnginePackageStatus, RuntimeStatus } from "../lib/types";
  import type { EngineModelResource } from "../lib/api";
  import { formatBytes, summarizeModelStorage } from "../lib/storage";

  export let runtime: RuntimeStatus | null = null;
  export let engines: EnginePackageStatus[] = [];
  export let resources: EngineModelResource[] = [];

  $: modelStorage = summarizeModelStorage(resources);
  $: installedEngines = engines.filter((engine) => engine.installed);
  $: sizedEngines = installedEngines.filter((engine) => engine.packageBytes !== null);
  $: unknownEngineSizes = installedEngines.length - sizedEngines.length;
  $: knownPackageBytes = sizedEngines.reduce(
    (total, engine) => total + (engine.packageBytes ?? 0),
    0
  );
  $: packageBytesLabel = installedEngines.length === 0
    ? "0 B"
    : sizedEngines.length === 0
      ? "Unknown"
      : `${unknownEngineSizes > 0 ? "At least " : ""}${formatBytes(knownPackageBytes)}`;
</script>

<section class="card storage-summary">
  <p class="eyebrow">Storage</p>
  <h2>Storage summary</h2>
  <dl class="storage-grid">
    <div>
      <dt>Managed runtime</dt>
      <dd>{formatBytes(runtime?.runtimeBytes ?? null)}</dd>
    </div>
    <div>
      <dt>Known engine package files</dt>
      <dd>{packageBytesLabel}</dd>
      {#if unknownEngineSizes > 0}
        <small>{unknownEngineSizes} installed package size(s) unknown.</small>
      {/if}
    </div>
    <div>
      <dt>Known unique provider bytes</dt>
      <dd>{formatBytes(modelStorage.knownUniqueBytes)}</dd>
      <small>{modelStorage.knownStorageCount} unique provider storage ID(s).</small>
    </div>
    <div>
      <dt>Reported bytes without shared IDs</dt>
      <dd>{formatBytes(modelStorage.nonDeduplicatedBytes)}</dd>
      {#if modelStorage.nonDeduplicatedCount > 0}
        <small>{modelStorage.nonDeduplicatedCount} resource(s) cannot be deduplicated safely.</small>
      {/if}
    </div>
    <div>
      <dt>Unknown model sizes</dt>
      <dd>{modelStorage.unknownSizeCount}</dd>
    </div>
    <div>
      <dt>Managed-runtime volume free</dt>
      <dd>{formatBytes(runtime?.freeBytes ?? null)}</dd>
    </div>
  </dl>
  <p class="muted">Provider-reported model storage is counted by stable storage ID. Unidentified resource sizes are shown separately. Provider cache totals and the model destination volume are not exposed, so managed-runtime free space is advisory only.</p>
</section>

<style>
  .storage-grid { display: grid; gap: 15px; margin: 18px 0; }
  .storage-grid dt { color: #929aac; font-size: 0.84rem; }
  .storage-grid dd { margin: 3px 0; font-size: 1.15rem; font-weight: 700; }
  .storage-grid small { color: #929aac; }
</style>

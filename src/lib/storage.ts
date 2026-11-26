import type { EngineModelResource } from "./api";
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}



export interface ModelStorageTotals {
  knownUniqueBytes: number;
  knownStorageCount: number;
  nonDeduplicatedBytes: number;
  nonDeduplicatedCount: number;
  unknownSizeCount: number;
}

export function summarizeModelStorage(resources: EngineModelResource[]): ModelStorageTotals {
  const sharedStorage = new Map<string, number | null>();
  let nonDeduplicatedBytes = 0;
  let nonDeduplicatedCount = 0;
  let unknownSizeCount = 0;

  for (const resource of resources) {
    if (!resource.installed) continue;
    if (resource.storage_id === null) {
      nonDeduplicatedCount += 1;
      if (resource.bytes_installed === null) unknownSizeCount += 1;
      else nonDeduplicatedBytes += resource.bytes_installed;
      continue;
    }

    const known = sharedStorage.get(resource.storage_id);
    if (!sharedStorage.has(resource.storage_id)) {
      sharedStorage.set(resource.storage_id, resource.bytes_installed);
    } else if (known === null && resource.bytes_installed !== null) {
      sharedStorage.set(resource.storage_id, resource.bytes_installed);
    } else if (typeof known === "number" && resource.bytes_installed !== null) {
      sharedStorage.set(resource.storage_id, Math.max(known, resource.bytes_installed));
    }
  }

  const knownUniqueBytes = [...sharedStorage.values()].reduce<number>(
    (total, bytes) => total + (bytes ?? 0),
    0
  );
  unknownSizeCount += [...sharedStorage.values()].filter((bytes) => bytes === null).length;
  return {
    knownUniqueBytes,
    knownStorageCount: sharedStorage.size,
    nonDeduplicatedBytes,
    nonDeduplicatedCount,
    unknownSizeCount
  };
}

const MINIMUM_DOWNLOAD_MARGIN = 64 * 1024 * 1024;
const DOWNLOAD_MARGIN_RATE = 0.1;

export interface DownloadSpaceCheck {
  state: "unknown" | "sufficient" | "insufficient";
  requiredBytes: number | null;
  marginBytes: number | null;
}

export function checkDownloadSpace(
  downloadBytes: number | null,
  availableBytes: number | null
): DownloadSpaceCheck {
  if (downloadBytes === null || availableBytes === null) {
    return { state: "unknown", requiredBytes: null, marginBytes: null };
  }

  const marginBytes = Math.max(
    MINIMUM_DOWNLOAD_MARGIN,
    Math.ceil(downloadBytes * DOWNLOAD_MARGIN_RATE)
  );
  const requiredBytes = downloadBytes + marginBytes;
  return {
    state: availableBytes >= requiredBytes ? "sufficient" : "insufficient",
    requiredBytes,
    marginBytes
  };
}

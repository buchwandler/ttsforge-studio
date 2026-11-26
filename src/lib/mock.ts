import type {
  BookInspection,
  EngineChoice,
  EngineOption,
  EnginePackageStatus,
  JobEvent,
  JobEventsPage,
  JobStatus,
  JobSummary,
  RuntimeStatus,
  SpacyModel,
  SpeechProfileChoice,
  TargetChoice,
  VoiceChoice
} from "./types";

import type {
  EngineModelListQuery,
  EngineModelResource,
  EngineModelStatusQuery,
  ResourceOperation,
  ResourceOperationRequest,
  RuntimeResponse
} from "./api";

const inspection: BookInspection = {
  source: "/demo/Platform Decay - Martha Wells.epub",
  kind: "book",
  title: "Platform Decay",
  author: "Martha Wells",
  language: "en-US",
  cover: null,
  chapters: Array.from({ length: 17 }, (_, index) => ({
    number: index + 1,
    title: `Chapter ${index + 1}`,
    source_id: `chapter-${index + 1}`,
    char_count: 8200 + index * 370
  }))
};

const engines: EngineChoice[] = [
  {
    id: "kokoro",
    version: "0.10.x",
    installed: true,
    runnable: true,
    features: ["voices"],
    reason: null
  },
  {
    id: "kitten",
    version: null,
    installed: false,
    runnable: false,
    features: ["voices"],
    reason: "Optional engine component is not installed."
  },
  {
    id: "piper",
    version: "1.x",
    installed: true,
    runnable: true,
    features: ["voices"],
    reason: null
  },
  {
    id: "chatterbox",
    version: "unknown",
    installed: true,
    runnable: false,
    features: ["reference"],
    reason: "Provider resource verification failed."
  },
  {
    id: "qwen3",
    version: null,
    installed: true,
    runnable: false,
    features: ["voices"],
    reason: "Provider model state is unknown."
  }
];

const targets: TargetChoice[] = [
  {
    id: "akinvox-multispeaker-v1",
    languages: ["English"],
    status: "ready",
    runtime_available: true,
    default_voice: "AV_cori",
    voice_count: 3,
    qualities: [],
    voice_mode: "named",
    sample_rate: 24000,
    features: ["voices"],
    reference_only: false
  }
];

const voices: VoiceChoice[] = [
  {
    id: "AV_cori",
    language: "en-US",
    locale: "en-US",
    language_label: "English (US)",
    gender: "female",
    default: true,
    runtime_available: true
  },
  {
    id: "AV_brody",
    language: "en-US",
    locale: "en-US",
    language_label: "English (US)",
    gender: "male",
    default: false,
    runtime_available: true
  },
  {
    id: "AV_ariala",
    language: "en-US",
    locale: "en-US",
    language_label: "English (US)",
    gender: "female",
    default: false,
    runtime_available: true
  }
];

const spacy: SpacyModel[] = [
  {
    language: "en-US",
    tier: "sm",
    model: "en_core_web_sm",
    installed: true,
    spacy_version: "3.8.0",
    model_version: "3.8.0"
  },
  {
    language: "en-US",
    tier: "md",
    model: "en_core_web_md",
    installed: false,
    spacy_version: "3.8.0",
    model_version: null
  },
  {
    language: "en-US",
    tier: "lg",
    model: "en_core_web_lg",
    installed: true,
    spacy_version: "3.8.0",
    model_version: "3.8.0"
  },
  {
    language: "en-US",
    tier: "trf",
    model: "en_core_web_trf",
    installed: false,
    spacy_version: "3.8.0",
    model_version: null
  }
];

const jobs = new Map<string, { started: number; cancelled: boolean; retryOf: string | null }>();

function jobStatus(
  id: string,
  state: JobStatus["state"],
  values: Partial<JobStatus> = {}
): JobStatus {
  return {
    id,
    state,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    project: "/demo/Platform Decay - Martha Wells.ttsforge/book.ssmd-bundle",
    output: null,
    narration_id: null,
    retry_of: jobs.get(id)?.retryOf ?? null,
    event_sequence: 0,
    progress: null,
    result: null,
    error: null,
    ...values
  };
}

export function mockInspection(source?: string): BookInspection {
  return { ...inspection, source: source || inspection.source };
}

export function mockEngines(): EngineChoice[] {
  return engines;
}

export function mockTargets(): TargetChoice[] {
  return targets;
}

export function mockVoices(): VoiceChoice[] {
  return voices;
}

export function mockSpacy(): SpacyModel[] {
  return spacy;
}

export function mockCreateJob(retryOf: string | null = null): JobStatus {
  const id = crypto.randomUUID();
  const started = Date.now();
  jobs.set(id, { started, cancelled: false, retryOf });
  return jobStatus(id, "queued", { created_at: new Date(started).toISOString() });
}

export function mockCancelJob(id: string): JobStatus {
  const job = jobs.get(id);
  if (job) job.cancelled = true;
  return jobStatus(id, "cancelled", { finished_at: new Date().toISOString() });
}

export function mockJob(id: string): JobStatus {
  const job = jobs.get(id);
  if (!job) {
    return jobStatus(id, "failed", {
      error: {
        type: "JobNotFound",
        message: "Unknown demo job.",
        category: "job",
        code: "job_not_found",
        stage: null,
        package: null,
        selector: null
      }
    });
  }

  const elapsed = (Date.now() - job.started) / 1000;
  const createdAt = new Date(job.started).toISOString();
  if (job.cancelled) {
    return jobStatus(id, "cancelled", {
      created_at: createdAt,
      finished_at: new Date().toISOString()
    });
  }

  if (elapsed < 2) {
    return jobStatus(id, "preparing", {
      created_at: createdAt,
      progress: {
        stage: "preflight",
        kind: "stage.started",
        message: "Checking workflow",
        package: "readio",
        selector: "5-17",
        current: null,
        total: null,
        elapsed_seconds: elapsed,
        details: {}
      }
    });
  }

  if (elapsed < 24) {
    const fraction = Math.min(0.99, (elapsed - 2) / 22);
    const current = Math.max(1, Math.floor(fraction * 91));
    const chapter = 5 + Math.min(12, Math.floor(fraction * 13));
    return jobStatus(id, "running", {
      created_at: createdAt,
      started_at: createdAt,
      progress: {
        stage: "render",
        kind: "stage.progress",
        message: "Rendering speech",
        package: "voicerender",
        selector: "5-17",
        current,
        total: 91,
        elapsed_seconds: elapsed,
        details: {
          chapter_number: chapter,
          chapter_title: `Chapter ${chapter}`
        }
      }
    });
  }

  return jobStatus(id, "completed", {
    created_at: createdAt,
    started_at: createdAt,
    finished_at: new Date().toISOString(),
    output: "/demo/Platform Decay - Martha Wells.m4b",
    progress: {
      stage: "export",
      kind: "stage.completed",
      message: "M4B written",
      package: "audioexport",
      selector: "5-17",
      current: 1,
      total: 1,
      elapsed_seconds: elapsed,
      details: {}
    },
    result: {
      output: "/demo/Platform Decay - Martha Wells.m4b",
      workspace: "/demo/Platform Decay - Martha Wells.ttsforge/book.ssmd-bundle",
      workspace_mode: "persistent",
      executed_stages: ["render", "compose", "export"],
      reused_stages: ["convert", "compile", "render_plan"],
      warnings: [],
      variant: "default",
      execution: null
    }
  });
}


function mockSummary(job: JobStatus): JobSummary {
  return {
    id: job.id,
    state: job.state,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    project: job.project,
    output: job.output,
    narration_id: job.narration_id,
    retry_of: job.retry_of,
    event_sequence: job.event_sequence
  };
}

export function mockListJobs(limit = 50): { jobs: JobSummary[] } {
  const recent = [...jobs.keys()]
    .map(mockJob)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, limit)
    .map(mockSummary);
  return { jobs: recent };
}

export function mockJobEvents(id: string, _after = 0): JobEventsPage {
  const job = mockJob(id);
  const events: JobEvent[] = [];
  return { first: 1, next: job.event_sequence, truncated: false, events };
}

export function mockRetryJob(id: string): JobStatus {
  return mockCreateJob(id);
}


export function mockRuntime(): RuntimeResponse {
  return {
    python: { version: "3.13", executable: "python" },
    packages: { ttsforge: "0.5.2", readio: "0.6.9" },
    audio: {
      audioexport: { available: true, version: "1.0" },
      ffmpeg: { available: true, path: null },
      ffprobe: { available: true, path: null }
    },
    ready: true,
    problems: []
  };
}

export function mockDesktopRuntimeStatus(): RuntimeStatus {
  return {
    installed: true,
    runtimeDir: "/demo/ttsforge/runtime",
    pythonVersion: "3.13.2",
    ttsforgeVersion: "0.5.2",
    readioVersion: "0.6.9",
    runtimeBytes: 1_200_000_000,
    freeBytes: 72_000_000_000,
    message: "Browser mock mode. Native package actions are disabled."
  };
}

export function mockEngineStatuses(): EnginePackageStatus[] {
  return [
    {
      engineId: "kitten",
      label: "Kitten",
      distribution: "kittensynth",
      installed: false,
      installedVersion: null,
      supportedRequirement: "kittensynth[cpu]>=0.1.9,<0.2",
      availableVersion: null,
      updateState: "unknown",
      packageBytes: null,
      catalogInstalled: false,
      catalogRunnable: false,
      catalogReason: null,
      state: "not_installed",
      message: "Engine package is not installed."
    },
    {
      engineId: "kokoro",
      label: "Kokoro",
      distribution: "pykokoro",
      installed: true,
      installedVersion: "0.10.13",
      supportedRequirement: "pykokoro>=0.10.13,<0.11",
      availableVersion: null,
      updateState: "unknown",
      packageBytes: 192_000_000,
      catalogInstalled: true,
      catalogRunnable: true,
      catalogReason: null,
      state: "ready",
      message: null
    },
    {
      engineId: "piper",
      label: "Piper",
      distribution: "pipersynth",
      installed: true,
      installedVersion: "0.2.5",
      supportedRequirement: "pipersynth>=0.2.5,<0.3",
      availableVersion: "0.2.6",
      updateState: "update_available",
      packageBytes: 84_000_000,
      catalogInstalled: true,
      catalogRunnable: true,
      catalogReason: null,
      state: "ready",
      message: null
    },
    {
      engineId: "chatterbox",
      label: "Chatterbox",
      distribution: "chatterboxsynth",
      installed: true,
      installedVersion: "0.1.1",
      supportedRequirement: "chatterboxsynth[cpu]>=0.1.1,<0.2",
      availableVersion: null,
      updateState: "unknown",
      packageBytes: 840_000_000,
      catalogInstalled: true,
      catalogRunnable: false,
      catalogReason: "A required runtime dependency is unavailable.",
      state: "broken",
      message: "A required runtime dependency is unavailable."
    },
    {
      engineId: "qwen3",
      label: "Qwen3",
      distribution: "qwen3synth",
      installed: true,
      installedVersion: "0.1.0",
      supportedRequirement: "qwen3synth[cpu]>=0.1.0,<0.2",
      availableVersion: null,
      updateState: "unknown",
      packageBytes: null,
      catalogInstalled: null,
      catalogRunnable: null,
      catalogReason: null,
      state: "unknown",
      message: "Start the TTSForge backend to check engine readiness."
    }
  ];
}

const resourceModels: EngineModelResource[] = [
  {
    engine: "kitten",
    target: "kitten-v1",
    quality: null,
    language: "en-US",
    label: "Kitten English v1",
    installed: false,
    available: true,
    state: "missing",
    local_version: null,
    available_version: "1.0",
    update_state: "unknown",
    bytes_installed: null,
    bytes_download: 270_000_000,
    storage_id: null,
    installable: true,
    updatable: false,
    removable: false,
    verifiable: false,
    reason: null
  },
  {
    engine: "kokoro",
    target: "en-us-medium",
    quality: "medium",
    language: "en-US",
    label: "Kokoro English medium",
    installed: true,
    available: true,
    state: "outdated",
    local_version: "2024.1",
    available_version: "2025.1",
    update_state: "update_available",
    bytes_installed: 900_000_000,
    bytes_download: null,
    storage_id: "kokoro-english-shared",
    installable: true,
    updatable: true,
    removable: true,
    verifiable: true,
    reason: "A newer provider revision is available."
  },
  {
    engine: "kokoro",
    target: "en-us-low",
    quality: "low",
    language: "en-US",
    label: "Kokoro English low",
    installed: true,
    available: true,
    state: "ready",
    local_version: "2025.1",
    available_version: "2025.1",
    update_state: "current",
    bytes_installed: 900_000_000,
    bytes_download: null,
    storage_id: "kokoro-english-shared",
    installable: true,
    updatable: true,
    removable: true,
    verifiable: true,
    reason: null
  },
  {
    engine: "piper",
    target: "en-us-medium",
    quality: "medium",
    language: "en-US",
    label: "Piper English medium",
    installed: true,
    available: true,
    state: "partial",
    local_version: "local-revision",
    available_version: "remote-revision",
    update_state: "unknown",
    bytes_installed: 120_000_000,
    bytes_download: 210_000_000,
    storage_id: "piper-en-us-medium",
    installable: true,
    updatable: true,
    removable: true,
    verifiable: true,
    reason: "The provider reports an incomplete download."
  },
  {
    engine: "chatterbox",
    target: "chatterbox-v1",
    quality: null,
    language: "en-US",
    label: "Chatterbox v1",
    installed: true,
    available: true,
    state: "corrupt",
    local_version: "revision-a",
    available_version: "revision-a",
    update_state: "unknown",
    bytes_installed: null,
    bytes_download: null,
    storage_id: "chatterbox-v1",
    installable: true,
    updatable: true,
    removable: true,
    verifiable: true,
    reason: "Provider verification failed."
  },
  {
    engine: "qwen3",
    target: "qwen3-v1",
    quality: null,
    language: null,
    label: "Qwen3 v1",
    installed: true,
    available: false,
    state: "unknown",
    local_version: null,
    available_version: null,
    update_state: "unknown",
    bytes_installed: null,
    bytes_download: null,
    storage_id: null,
    installable: false,
    updatable: false,
    removable: false,
    verifiable: false,
    reason: "The provider could not determine the resource state."
  }
];

export function mockEngineModels(query: EngineModelListQuery): EngineModelResource[] {
  return resourceModels.filter((model) => {
    if (model.engine !== query.engine) return false;
    if (query.language && model.language !== query.language) return false;
    if (query.installed !== undefined && query.installed !== null && model.installed !== query.installed) return false;
    if (query.available !== undefined && model.available !== query.available) return false;
    return true;
  });
}

export function mockEngineModelStatus(query: EngineModelStatusQuery): EngineModelResource {
  return resourceModels.find((model) =>
    model.engine === query.engine &&
    model.target === query.target &&
    model.quality === (query.quality ?? null)
  ) ?? {
    engine: query.engine,
    target: query.target,
    quality: query.quality ?? null,
    language: null,
    label: null,
    installed: false,
    available: false,
    state: "unknown",
    local_version: null,
    available_version: null,
    update_state: "unknown",
    bytes_installed: null,
    bytes_download: null,
    storage_id: null,
    installable: false,
    updatable: false,
    removable: false,
    verifiable: false,
    reason: "No mock resource matches this selector."
  };
}

const mockResourceOperations = new Map<string, ResourceOperation>();
let mockResourceOperationSequence = 0;

export function mockCreateResourceOperation(
  request: ResourceOperationRequest
): ResourceOperation {
  const operation: ResourceOperation = {
    id: `mock-resource-operation-${++mockResourceOperationSequence}`,
    action: request.action,
    state: "queued",
    engine: request.engine,
    target: request.target,
    quality: request.quality ?? null,
    current: null,
    total: null,
    message: null,
    result: null,
    error: null
  };
  mockResourceOperations.set(operation.id, operation);
  return operation;
}

export function mockGetResourceOperation(operationId: string): ResourceOperation {
  const operation = mockResourceOperations.get(operationId);
  if (!operation) throw new Error(`Unknown resource operation: ${operationId}`);
  if (operation.state !== "queued" && operation.state !== "running") return operation;

  const current = mockEngineModelStatus({
    engine: operation.engine,
    target: operation.target,
    quality: operation.quality
  });
  const removed = operation.action === "remove";
  const updated: EngineModelResource = {
    ...current,
    installed: !removed,
    state: removed ? "missing" : operation.action === "verify" && !current.installed ? current.state : "ready",
    local_version: removed ? null : operation.action === "install" || operation.action === "update"
      ? current.available_version ?? current.local_version
      : current.local_version,
    update_state: removed ? "unknown" : operation.action === "install" || operation.action === "update"
      ? current.available_version ? "current" : current.update_state
      : current.update_state,
    bytes_installed: removed ? null : current.bytes_download ?? current.bytes_installed,
    storage_id: removed ? null : current.storage_id ?? `mock-${current.engine}-${current.target}`
  };
  const resourceIndex = resourceModels.findIndex((resource) =>
    resource.engine === operation.engine &&
    resource.target === operation.target &&
    resource.quality === operation.quality
  );
  if (resourceIndex >= 0) resourceModels[resourceIndex] = updated;

  const completed: ResourceOperation = { ...operation, state: "completed", result: updated };
  mockResourceOperations.set(operationId, completed);
  return completed;
}

export function mockEngineOptions(): EngineOption[] {
  return [{
    name: "speed",
    value_type: "number",
    required: false,
    default: 1,
    choices: [],
    minimum: 0.5,
    maximum: 2,
    description: "Playback speed multiplier.",
    identity_affecting: false,
    runtime_only: true
  }];
}

export function mockEnsureSpacy(language: string, tier: string): SpacyModel {
  const model = spacy.find((item) => item.tier === tier) ?? spacy[0];
  return { ...model, language, installed: true };
}

export function mockSpeechProfiles(directory: string): { directory: string; profiles: SpeechProfileChoice[] } {
  return { directory, profiles: [] };
}

export function mockLibraryProjects(root: string): { root: string; projects: [] } {
  return { root, projects: [] };
}

export function mockCreateNarration(value: { display_name: string; engine: string; target: string; voice?: string | null }) {
  return {
    id: "mock-preview-narration",
    display_name: value.display_name,
    primary: false,
    output: null,
    engine: value.engine,
    target: value.target,
    voice: value.voice ?? null,
    error: null
  };
}

export function mockDeleteNarration(): { deleted: boolean } {
  return { deleted: true };
}


export function mockPreviewAudio(): Blob {
  const sampleRate = 22_050;
  const dataLength = sampleRate / 5 * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataLength, true);
  return new Blob([bytes], { type: "audio/wav" });
}

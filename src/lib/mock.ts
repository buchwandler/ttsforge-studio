import type {
  BookInspection,
  EngineChoice,
  EngineOption,
  JobEvent,
  JobEventsPage,
  JobStatus,
  JobSummary,
  SpacyModel,
  SpeechProfileChoice,
  TargetChoice,
  VoiceChoice
} from "./types";

import type { RuntimeResponse } from "./api";

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
    packages: { ttsforge: "0.5.1", readio: "0.5.1" },
    audio: {
      audioexport: { available: true, version: "1.0" },
      ffmpeg: { available: true, path: null },
      ffprobe: { available: true, path: null }
    },
    ready: true,
    problems: []
  };
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

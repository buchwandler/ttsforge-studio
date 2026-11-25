import type {
  BookInspection,
  EngineChoice,
  JobStatus,
  SpacyModel,
  TargetChoice,
  VoiceChoice
} from "./types";

const inspection: BookInspection = {
  source: "/demo/Platform Decay - Martha Wells.epub",
  kind: "book",
  title: "Platform Decay",
  author: "Martha Wells",
  language: "en-US",
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

const jobs = new Map<string, { started: number; cancelled: boolean }>();

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

export function mockCreateJob(): JobStatus {
  const id = crypto.randomUUID();
  jobs.set(id, { started: Date.now(), cancelled: false });
  return {
    id,
    state: "queued",
    progress: null,
    result: null,
    error: null
  };
}

export function mockCancelJob(id: string): JobStatus {
  const job = jobs.get(id);
  if (job) job.cancelled = true;
  return {
    id,
    state: "cancelled",
    progress: null,
    result: null,
    error: null
  };
}

export function mockJob(id: string): JobStatus {
  const job = jobs.get(id);
  if (!job) {
    return {
      id,
      state: "failed",
      progress: null,
      result: null,
      error: {
        type: "JobNotFound",
        message: "Unknown demo job."
      }
    };
  }

  if (job.cancelled) {
    return {
      id,
      state: "cancelled",
      progress: null,
      result: null,
      error: null
    };
  }

  const elapsed = (Date.now() - job.started) / 1000;

  if (elapsed < 2) {
    return {
      id,
      state: "preparing",
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
      },
      result: null,
      error: null
    };
  }

  if (elapsed < 24) {
    const fraction = Math.min(0.99, (elapsed - 2) / 22);
    const current = Math.max(1, Math.floor(fraction * 91));
    const chapter = 5 + Math.min(12, Math.floor(fraction * 13));
    return {
      id,
      state: "running",
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
      },
      result: null,
      error: null
    };
  }

  return {
    id,
    state: "completed",
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
      variant: "default"
    },
    error: null
  };
}

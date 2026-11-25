export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface RuntimeStatus {
  installed: boolean;
  runtimeDir: string | null;
  pythonVersion: string | null;
  ttsforgeVersion: string | null;
  message: string;
}

export interface BackendInfo {
  baseUrl: string;
  token: string;
}

export interface Chapter {
  number: number;
  title: string;
  source_id?: string | null;
  char_count?: number | null;
}

export interface BookInspection {
  source: string;
  kind: string;
  title: string | null;
  author: string | null;
  language: string | null;
  chapters: Chapter[];
  cover?: string | null;
}

export interface EngineChoice {
  id: string;
  version: string | null;
  installed: boolean;
  runnable: boolean;
  features: string[];
  reason: string | null;
}

export interface TargetChoice {
  id: string;
  languages: string[];
  status: string;
  runtime_available: boolean;
  default_voice: string | null;
  voice_count: number;
  qualities: string[];
  voice_mode: string | null;
  sample_rate: number | null;
  features: string[];
  reference_only: boolean;
}

export interface VoiceChoice {
  id: string;
  language: string | null;
  locale: string | null;
  language_label: string | null;
  gender: string;
  default: boolean;
  runtime_available: boolean;
}

export interface SpacyModel {
  language: string;
  tier: "sm" | "md" | "lg" | "trf";
  model: string;
  installed: boolean;
  spacy_version: string | null;
  model_version: string | null;
}

export interface ApplicationEvent {
  stage: string;
  kind: string;
  message: string | null;
  package: string | null;
  selector: string | null;
  current: number | null;
  total: number | null;
  elapsed_seconds: number | null;
  details: Record<string, JsonValue>;
}

export type JobState =
  | "queued"
  | "preparing"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobError {
  type: string;
  message: string;
  category?: string | null;
  code?: string | null;
  stage?: string | null;
  package?: string | null;
  selector?: string | null;
  details?: Record<string, JsonValue>;
}

export interface ConversionResult {
  output: string;
  workspace: string | null;
  workspace_mode: string;
  executed_stages: string[];
  reused_stages: string[];
  warnings: string[];
  variant: string | null;
}

export interface JobStatus {
  id: string;
  state: JobState;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  project?: string | null;
  output?: string | null;
  progress: ApplicationEvent | null;
  result: ConversionResult | null;
  error: JobError | null;
}

export interface ConvertRequest {
  source: string;
  project?: string | null;
  chapters?: string | null;
  output?: string | null;
  language: string;
  engine: string;
  target: string;
  voice?: string | null;
  engine_options?: Record<string, JsonValue>;
  speed?: number | null;
  spacy?: "off" | "auto" | "sm" | "md" | "lg" | "trf" | null;
  speech_profile?: string | null;
  pause_timing?: "fixed" | "natural" | "engaging" | null;
  bitrate?: string | number | null;
  target_lufs?: number | null;
  title?: string | null;
  author?: string | null;
  cover?: string | null;
  offline?: boolean;
  refresh?: boolean;
  rebuild_from?: string | null;
  replace_output?: boolean;
  fresh?: boolean;
  new_variant?: boolean;
}

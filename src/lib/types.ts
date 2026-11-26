import type { components } from "./api/generated";

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
  readioVersion: string | null;
  runtimeBytes: number | null;
  freeBytes: number | null;
  message: string;
}

export type EnginePackageState =
  | "not_installed"
  | "ready"
  | "incompatible"
  | "broken"
  | "unknown";

export type EngineUpdateState = "current" | "update_available" | "unavailable" | "unknown";
export type EngineAction = "install" | "update" | "repair" | "remove";

export interface EnginePackageStatus {
  engineId: string;
  label: string;
  distribution: string;
  installed: boolean;
  installedVersion: string | null;
  supportedRequirement: string | null;
  availableVersion: string | null;
  updateState: EngineUpdateState;
  packageBytes: number | null;
  catalogInstalled: boolean | null;
  catalogRunnable: boolean | null;
  catalogReason: string | null;
  state: EnginePackageState;
  message: string | null;
}

export interface EngineMutationResult {
  status: EnginePackageStatus;
  packageMutationSucceeded: boolean;
  backendWasRunning: boolean;
  backendRestarted: boolean;
  message: string | null;
}
export interface BackendInfo {
  baseUrl: string;
  token: string;
  apiVersion: number;
  runtimeReady: boolean;
  runtimeProblems: string[];
}

export type Chapter = components["schemas"]["BookChapterResponseModel"];
export type BookInspection = components["schemas"]["BookInspectionResponseModel"];
export type EngineChoice = components["schemas"]["EngineChoiceResponseModel"];
export type EngineOption = components["schemas"]["EngineOptionResponseModel"];
export type TargetChoice = components["schemas"]["TargetChoiceResponseModel"];
export type VoiceChoice = components["schemas"]["VoiceChoiceResponseModel"];
export type SpacyModel = components["schemas"]["SpacyModelResponseModel"];
export type ApplicationEvent = components["schemas"]["ApplicationEventResponseModel"];
export type JobState = components["schemas"]["JobStatusResponseModel"]["state"];
export type JobError = components["schemas"]["ApiErrorModel"];
export type ConversionResult = components["schemas"]["ConversionResultResponseModel"];
export type JobStatus = components["schemas"]["JobStatusResponseModel"];
export type JobEvent = components["schemas"]["JobEventResponseModel"];
export type JobSummary = components["schemas"]["JobSummaryResponseModel"];
export type JobEventsPage = components["schemas"]["JobEventsPageResponseModel"];
export type ProjectSummary = components["schemas"]["ProjectSummaryResponseModel"];
export type ProjectMetadataView = components["schemas"]["AudiobookMetadataViewResponseModel"];
export type AudiobookMetadata = components["schemas"]["AudiobookMetadataModel"];
export type ChapterStatus = components["schemas"]["ChapterStatusResponseModel"];
export type ProjectQcReport = components["schemas"]["QcReportResponseModel"];
export type SpeechProfileChoice = components["schemas"]["SpeechProfileChoiceResponseModel"];
export type ConvertRequest = components["schemas"]["AudiobookRequestModel"];
export type JobSubmission = components["schemas"]["JobSubmissionModel"];
export type SourceImport = components["schemas"]["SourceImportResponseModel"];
export type SourceImportStatus = components["schemas"]["SourceImportStatusResponseModel"];
export type SetupResolution = components["schemas"]["SetupResolutionResponseModel"];
export type PreflightResponse = components["schemas"]["PreflightResponseModel"];
export type ApiErrorResponse = components["schemas"]["ApiErrorResponseModel"];

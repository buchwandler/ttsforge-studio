import type { components, paths } from "./api/generated";
import { TTSFORGE_API_VERSION } from "./api/contract";
import {
  mockCancelJob,
  mockCreateJob,
  mockEngines,
  mockInspection,
  mockJob,
  mockSpacy,
  mockTargets,
  mockJobEvents,
  mockListJobs,
  mockRetryJob,
  mockVoices,
  mockCreateNarration,
  mockPreviewAudio,
  mockDeleteNarration,
  mockEngineOptions,
  mockEnsureSpacy,
  mockLibraryProjects,
  mockRuntime,
  mockSpeechProfiles
} from "./mock";
import type {
  BackendInfo,
  BookInspection,
  ConvertRequest,
  EngineChoice,
  JobStatus,
  JobSubmission,
  PreflightResponse,
  SetupResolution,
  SourceImport,
  SourceImportStatus,
  SpacyModel,
  TargetChoice,
  VoiceChoice
} from "./types";

let backend: BackendInfo | null = null;

type ApiPath = keyof paths & string;
type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type Operation<P extends ApiPath, M extends HttpMethod> = NonNullable<paths[P][M]>;
type MethodsFor<P extends ApiPath> = {
  [M in HttpMethod]: Operation<P, M> extends { responses: unknown } ? M : never;
}[HttpMethod];
type OperationParameters<O> = O extends { parameters: infer Parameters } ? Parameters : never;
type PathParameters<O> = OperationParameters<O> extends { path: infer Path }
  ? Path
  : never;
type QueryParameters<O> = OperationParameters<O> extends { query: infer Query }
  ? Query
  : OperationParameters<O> extends { query?: infer Query }
    ? Exclude<Query, undefined>
    : never;
type RequestContent<O> = O extends { requestBody: { content: infer Content } }
  ? Content
  : never;
type RequestBody<O> = [RequestContent<O>] extends [never]
  ? never
  : RequestContent<O> extends { "application/json": infer Body }
    ? Body
    : RequestContent<O> extends { "multipart/form-data": unknown }
      ? FormData
      : never;
type BodyOptions<O> = [RequestBody<O>] extends [never]
  ? { body?: never }
  : { body: RequestBody<O> };
type ParameterOptions<O> = ([PathParameters<O>] extends [never]
  ? { path?: never }
  : { path: PathParameters<O> }) &
  ([QueryParameters<O>] extends [never]
    ? { query?: never }
    : { query?: QueryParameters<O> });
type RequestOptions<O> = ParameterOptions<O> & BodyOptions<O> & { signal?: AbortSignal };
type RequestResult<O, R> = R extends "blob" ? Blob : SuccessfulResponse<O>;
type SuccessfulResponse<O> = O extends { responses: infer Responses }
  ? {
      [Status in keyof Responses]: Status extends number
        ? `${Status}` extends `2${string}`
          ? Responses[Status] extends { content: infer Content }
            ? Content extends { "application/json": infer Body }
              ? Body
              : void
            : void
          : never
        : never;
    }[keyof Responses]
  : never;

export type SystemResponse = components["schemas"]["SystemResponseModel"];
export type RuntimeResponse = components["schemas"]["RuntimeStatusResponseModel"];
export type EngineOptionsResponse = components["schemas"]["EngineOptionResponseModel"][];
export type Narration = components["schemas"]["NarrationResponseModel"];
export type ProjectInfo = components["schemas"]["ProjectInfoResponseModel"];
export type ProjectSummary = components["schemas"]["ProjectSummaryResponseModel"];
export type JobEventsPage = components["schemas"]["JobEventsPageResponseModel"];
export type ApiErrorModel = components["schemas"]["ApiErrorModel"];

export class TtsForgeApiError extends Error {
  readonly status: number;
  readonly apiError: ApiErrorModel;

  constructor(status: number, apiError: ApiErrorModel) {
    super(apiError.message);
    this.name = "TtsForgeApiError";
    this.status = status;
    this.apiError = apiError;
  }

  get code(): string | null {
    return this.apiError.code;
  }

  get category(): string | null {
    return this.apiError.category;
  }
}

export class ApiVersionMismatchError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`TTSForge API v${actual} is incompatible. This desktop requires API v${expected}.`);
    this.name = "ApiVersionMismatchError";
  }
}

export function configureBackend(value: BackendInfo): void {
  backend = value;
}

function mockMode(): boolean {
  return import.meta.env.VITE_TTSFORGE_MOCK === "1";
}

function withPathParameters(
  path: string,
  parameters: Record<string, string | number> | undefined
): string {
  return path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = parameters?.[name];
    if (value === undefined) throw new Error(`Missing API path parameter: ${name}`);
    return encodeURIComponent(String(value));
  });
}

function appendQuery(
  url: URL,
  query: Record<string, unknown> | undefined
): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApiError(value: unknown): value is ApiErrorModel {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.message === "string" &&
    (typeof value.category === "string" || value.category === null) &&
    (typeof value.code === "string" || value.code === null) &&
    (typeof value.stage === "string" || value.stage === null) &&
    (typeof value.package === "string" || value.package === null) &&
    (typeof value.selector === "string" || value.selector === null)
  );
}

async function responseError(response: Response): Promise<TtsForgeApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (isRecord(payload) && isApiError(payload.error)) {
    return new TtsForgeApiError(response.status, payload.error);
  }

  const detail = isRecord(payload) && typeof payload.detail === "string"
    ? payload.detail
    : `${response.status} ${response.statusText}`.trim();
  return new TtsForgeApiError(response.status, {
    type: "http_error",
    message: detail,
    category: "http",
    code: null,
    stage: null,
    package: null,
    selector: null
  });
}

async function request<P extends ApiPath, M extends MethodsFor<P>, R extends "json" | "blob" = "json">(
  path: P,
  method: M,
  options: RequestOptions<Operation<P, M>> & { responseType?: R }
): Promise<RequestResult<Operation<P, M>, R>> {
  if (!backend) throw new Error("TTSForge backend is not configured.");

  const route = withPathParameters(
    path,
    options.path as Record<string, string | number> | undefined
  );
  const baseUrl = backend.baseUrl.replace(/\/+$/, "");
  const url = new URL(`${baseUrl}${route}`);
  appendQuery(url, options.query as Record<string, unknown> | undefined);

  const headers = new Headers({ Accept: options.responseType === "blob" ? "audio/wav" : "application/json" });
  if (backend.token) headers.set("Authorization", `Bearer ${backend.token}`);
  const formData = typeof FormData !== "undefined" && options.body instanceof FormData;
  let body: BodyInit | undefined;
  if (formData) {
    body = options.body as FormData;
  } else if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(url, {
    method: method.toUpperCase(),
    headers,
    body,
    signal: options.signal
  });
  if (!response.ok) throw await responseError(response);
  if (response.status === 204) return undefined as RequestResult<Operation<P, M>, R>;
  if (options.responseType === "blob") return (await response.blob()) as RequestResult<Operation<P, M>, R>;
  return (await response.json()) as RequestResult<Operation<P, M>, R>;
}

export async function getHealth(signal?: AbortSignal) {
  return request("/api/v1/health", "get", { signal });
}

export async function getSystem(signal?: AbortSignal): Promise<SystemResponse> {
  if (mockMode()) {
    return {
      api_version: TTSFORGE_API_VERSION,
      ttsforge_version: "0.5.1",
      python_version: "3.13",
      capabilities: {
        source_inspection: true,
        synthesis_preview: true,
        m4b_export: true,
        persistent_workspace: true
      }
    };
  }
  const system = await request("/api/v1/system", "get", { signal });
  if (system.api_version !== TTSFORGE_API_VERSION) {
    throw new ApiVersionMismatchError(TTSFORGE_API_VERSION, system.api_version);
  }
  return system;
}

export async function getSystemCapabilities(signal?: AbortSignal) {
  return request("/api/v1/system/capabilities", "get", { signal });
}

export async function getSystemRuntime(signal?: AbortSignal): Promise<RuntimeResponse> {
  if (mockMode()) return mockRuntime();
  return request("/api/v1/system/runtime", "get", { signal });
}

export async function inspectSource(path: string, signal?: AbortSignal): Promise<BookInspection> {
  if (mockMode()) return mockInspection(path);
  return request("/api/v1/sources/inspect", "post", {
    body: { path },
    signal
  });
}

export async function importSource(file: File, signal?: AbortSignal): Promise<SourceImport> {
  if (mockMode()) {
    const inspection = mockInspection(file.name);
    return {
      source_id: "mock-source-import",
      path: inspection.source,
      managed: false,
      temporary: true,
      retention_days: 0,
      claimed: false,
      created_at: new Date().toISOString(),
      last_used_at: null,
      inspection
    };
  }

  const body = new FormData();
  body.set("file", file);
  return request("/api/v1/sources/import", "post", { body, signal });
}

export async function getSourceImport(
  sourceId: string,
  signal?: AbortSignal
): Promise<SourceImportStatus> {
  return request("/api/v1/sources/imports/{source_id}", "get", {
    path: { source_id: sourceId },
    signal
  });
}

export async function deleteSourceImport(sourceId: string, signal?: AbortSignal) {
  return request("/api/v1/sources/imports/{source_id}", "delete", {
    path: { source_id: sourceId },
    signal
  });
}

export async function resolveSetup(value: JobSubmission, signal?: AbortSignal): Promise<SetupResolution> {
  return request("/api/v1/setup/resolve", "post", { body: value, signal });
}

export async function preflightConversion(
  value: JobSubmission,
  signal?: AbortSignal
): Promise<PreflightResponse> {
  return request("/api/v1/conversions/preflight", "post", { body: value, signal });
}

export async function listEngines(signal?: AbortSignal): Promise<EngineChoice[]> {
  if (mockMode()) return mockEngines();
  return request("/api/v1/catalog/engines", "get", { signal });
}

export async function listTargets(
  engine: string,
  language: string,
  signal?: AbortSignal
): Promise<TargetChoice[]> {
  if (mockMode()) return mockTargets();
  return request("/api/v1/catalog/targets", "get", {
    query: { engine, language },
    signal
  });
}

export async function listVoices(
  engine: string,
  target: string,
  language: string,
  signal?: AbortSignal
): Promise<VoiceChoice[]> {
  if (mockMode()) return mockVoices();
  return request("/api/v1/catalog/voices", "get", {
    query: { engine, target, language },
    signal
  });
}

export async function listEngineOptions(
  engine: string,
  target: string,
  signal?: AbortSignal
): Promise<EngineOptionsResponse> {
  if (mockMode()) return mockEngineOptions();
  return request("/api/v1/catalog/engine-options", "get", {
    query: { engine, target },
    signal
  });
}

export async function listSpacy(language: string, signal?: AbortSignal): Promise<SpacyModel[]> {
  if (mockMode()) return mockSpacy();
  return request("/api/v1/resources/spacy", "get", {
    query: { language },
    signal
  });
}

export async function ensureSpacy(
  value: components["schemas"]["SpacyEnsureRequest"],
  signal?: AbortSignal
) {
  if (mockMode()) return mockEnsureSpacy(value.language, value.tier);
  return request("/api/v1/resources/spacy/ensure", "post", { body: value, signal });
}

export async function listSpeechProfiles(directory: string, signal?: AbortSignal) {
  if (mockMode()) return mockSpeechProfiles(directory);
  return request("/api/v1/resources/speech-profiles", "get", {
    query: { directory },
    signal
  });
}

export async function inspectSpeechProfile(
  path: string,
  signal?: AbortSignal
) {
  return request("/api/v1/resources/speech-profiles/inspect", "post", {
    body: { path },
    signal
  });
}

export async function getProjectStatus(project: string, signal?: AbortSignal) {
  return request("/api/v1/projects/status", "get", {
    query: { project },
    signal
  });
}

export async function listNarrations(project: string, signal?: AbortSignal) {
  return request("/api/v1/projects/narrations", "get", {
    query: { project },
    signal
  });
}

export async function createNarration(
  value: components["schemas"]["NarrationCreateRequestModel"],
  signal?: AbortSignal
): Promise<Narration> {
  if (mockMode()) return mockCreateNarration(value);
  return request("/api/v1/projects/narrations", "post", { body: value, signal });
}
export async function getNarration(
  project: string,
  narrationId: string,
  signal?: AbortSignal
): Promise<Narration> {
  return request("/api/v1/projects/narrations/{narration_id}", "get", {
    path: { narration_id: narrationId },
    query: { project },
    signal
  });
}
export async function deleteNarration(
  project: string,
  narrationId: string,
  signal?: AbortSignal
) {
  if (mockMode()) return mockDeleteNarration();
  return request("/api/v1/projects/narrations/{narration_id}", "delete", {
    path: { narration_id: narrationId },
    query: { project },
    signal
  });
}

export async function createPreview(
  value: components["schemas"]["PreviewRequestModel"],
  signal?: AbortSignal
): Promise<Blob> {
  if (mockMode()) return mockPreviewAudio();
  return request("/api/v1/previews", "post", { body: value, signal, responseType: "blob" });
}

export async function preflightNarration(
  project: string,
  narrationId: string,
  signal?: AbortSignal
) {
  return request("/api/v1/projects/narrations/{narration_id}/preflight", "post", {
    path: { narration_id: narrationId },
    query: { project },
    signal
  });
}

export async function createNarrationJob(
  project: string,
  narrationId: string,
  signal?: AbortSignal
) {
  return request("/api/v1/projects/narrations/{narration_id}/jobs", "post", {
    path: { narration_id: narrationId },
    query: { project },
    signal
  });
}

export async function listProjectVariants(project: string, signal?: AbortSignal) {
  return request("/api/v1/projects/variants", "get", {
    query: { project },
    signal
  });
}

export async function getProjectSetup(
  project: string,
  variant?: string | null,
  signal?: AbortSignal
) {
  return request("/api/v1/projects/setup", "get", {
    query: { project, variant },
    signal
  });
}

export async function getProjectInfo(project: string, signal?: AbortSignal): Promise<ProjectInfo> {
  return request("/api/v1/projects/info", "get", {
    query: { project },
    signal
  });
}

export async function getLibraryProjects(root: string, signal?: AbortSignal) {
  if (mockMode()) return mockLibraryProjects(root);
  return request("/api/v1/library/projects", "get", {
    query: { root },
    signal
  });
}

export async function getLibraryProject(projectId: string, signal?: AbortSignal): Promise<ProjectSummary> {
  return request("/api/v1/library/projects/{project_id}", "get", {
    path: { project_id: projectId },
    signal
  });
}

export async function getProjectMetadata(project: string, signal?: AbortSignal) {
  return request("/api/v1/projects/metadata", "get", {
    query: { project },
    signal
  });
}

export async function setProjectMetadata(
  value: components["schemas"]["ProjectMetadataSetRequestModel"],
  signal?: AbortSignal
) {
  return request("/api/v1/projects/metadata", "patch", { body: value, signal });
}

export async function validateProjectMetadata(
  value: components["schemas"]["ProjectMetadataSetRequestModel"],
  signal?: AbortSignal
) {
  return request("/api/v1/projects/metadata/validate", "post", { body: value, signal });
}

export async function getProjectChapters(project: string, signal?: AbortSignal) {
  return request("/api/v1/projects/chapters", "get", {
    query: { project },
    signal
  });
}

export async function selectProjectChapters(
  value: components["schemas"]["ChapterSelectionRequestModel"],
  signal?: AbortSignal
) {
  return request("/api/v1/projects/chapters/select", "post", { body: value, signal });
}

export async function getProjectQc(
  value: components["schemas"]["ProjectQcRequestModel"],
  signal?: AbortSignal
) {
  return request("/api/v1/projects/qc", "post", { body: value, signal });
}

export async function listJobs(
  query: paths["/api/v1/jobs"]["get"] extends { parameters: { query?: infer Query } }
    ? Query
    : never,
  signal?: AbortSignal
) {
  if (mockMode()) return mockListJobs(query.limit ?? 50);
  return request("/api/v1/jobs", "get", { query, signal });
}

export async function createJob(
  value: ConvertRequest,
  explicitFields: string[] = [],
  signal?: AbortSignal
): Promise<JobStatus> {
  if (mockMode()) return mockCreateJob();
  const created = await request("/api/v1/jobs", "post", {
    body: { request: value, explicit_fields: explicitFields },
    signal
  });
  return getJob(created.id, signal);
}

export async function getJob(id: string, signal?: AbortSignal): Promise<JobStatus> {
  if (mockMode()) return mockJob(id);
  return request("/api/v1/jobs/{job_id}", "get", {
    path: { job_id: id },
    signal
  });
}

export async function getJobEvents(
  id: string,
  after?: number,
  signal?: AbortSignal
): Promise<JobEventsPage> {
  if (mockMode()) return mockJobEvents(id, after);
  return request("/api/v1/jobs/{job_id}/events", "get", {
    path: { job_id: id },
    query: { after },
    signal
  });
}

export async function retryJob(id: string, signal?: AbortSignal): Promise<JobStatus> {
  if (mockMode()) return mockRetryJob(id);
  const created = await request("/api/v1/jobs/{job_id}/retry", "post", {
    path: { job_id: id },
    signal
  });
  return getJob(created.id, signal);
}

export async function cancelJob(id: string, signal?: AbortSignal): Promise<JobStatus> {
  if (mockMode()) return mockCancelJob(id);
  return request("/api/v1/jobs/{job_id}/cancel", "post", {
    path: { job_id: id },
    signal
  });
}

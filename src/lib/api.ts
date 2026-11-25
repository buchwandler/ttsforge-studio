import type {
  BackendInfo,
  BookInspection,
  ConvertRequest,
  EngineChoice,
  JobStatus,
  SpacyModel,
  TargetChoice,
  VoiceChoice
} from "./types";
import {
  mockCancelJob,
  mockCreateJob,
  mockEngines,
  mockInspection,
  mockJob,
  mockSpacy,
  mockTargets,
  mockVoices
} from "./mock";

let backend: BackendInfo | null = null;

function mockMode(): boolean {
  return import.meta.env.VITE_TTSFORGE_MOCK === "1";
}

export function configureBackend(value: BackendInfo): void {
  backend = value;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!backend) throw new Error("TTSForge backend is not configured.");

  const headers = new Headers(init.headers || {});
  if (backend.token) headers.set("Authorization", `Bearer ${backend.token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${backend.baseUrl}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      message = payload?.error?.message || payload?.detail || message;
    } catch {
      // Keep HTTP status text.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export async function inspectSource(path: string): Promise<BookInspection> {
  if (mockMode()) return mockInspection(path);
  return request<BookInspection>("/api/v1/sources/inspect", {
    method: "POST",
    body: JSON.stringify({ path })
  });
}

export async function importSource(file: File): Promise<BookInspection> {
  if (mockMode()) return mockInspection(file.name);

  const body = new FormData();
  body.set("file", file);
  const response = await request<{ inspection: BookInspection }>(
    "/api/v1/sources/import",
    { method: "POST", body }
  );
  return response.inspection;
}

export async function listEngines(): Promise<EngineChoice[]> {
  if (mockMode()) return mockEngines();
  return request<EngineChoice[]>("/api/v1/catalog/engines");
}

export async function listTargets(
  engine: string,
  language: string
): Promise<TargetChoice[]> {
  if (mockMode()) return mockTargets();
  const query = new URLSearchParams({ engine, language });
  return request<TargetChoice[]>(`/api/v1/catalog/targets?${query}`);
}

export async function listVoices(
  engine: string,
  target: string,
  language: string
): Promise<VoiceChoice[]> {
  if (mockMode()) return mockVoices();
  const query = new URLSearchParams({ engine, target, language });
  return request<VoiceChoice[]>(`/api/v1/catalog/voices?${query}`);
}

export async function listSpacy(language: string): Promise<SpacyModel[]> {
  if (mockMode()) return mockSpacy();
  const query = new URLSearchParams({ language });
  return request<SpacyModel[]>(`/api/v1/resources/spacy?${query}`);
}

export async function createJob(value: ConvertRequest): Promise<JobStatus> {
  if (mockMode()) return mockCreateJob();

  const explicitFields = [
    "chapters",
    "output",
    "language",
    "engine",
    "target",
    "voice",
    "spacy",
    "speech_profile",
    "pause_timing",
    "title",
    "author"
  ];

  return request<JobStatus>("/api/v1/jobs", {
    method: "POST",
    body: JSON.stringify({
      request: value,
      explicit_fields: explicitFields
    })
  });
}

export async function getJob(id: string): Promise<JobStatus> {
  if (mockMode()) return mockJob(id);
  return request<JobStatus>(`/api/v1/jobs/${encodeURIComponent(id)}`);
}

export async function cancelJob(id: string): Promise<JobStatus> {
  if (mockMode()) return mockCancelJob(id);
  return request<JobStatus>(`/api/v1/jobs/${encodeURIComponent(id)}/cancel`, {
    method: "POST"
  });
}

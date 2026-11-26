import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiVersionMismatchError,
  cancelJob,
  configureBackend,
  createPreview,
  getJobEvents,
  listJobs,
  retryJob,
  getHealth,
  getSystem,
  TtsForgeApiError
} from "../src/lib/api";

const contract = JSON.parse(
  readFileSync(new URL("../api/ttsforge-v1.openapi.json", import.meta.url), "utf8")
) as { paths: Record<string, Record<string, unknown>> };
const apiSource = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const backend = {
  baseUrl: "http://127.0.0.1:8765/",
  token: "test-token",
  apiVersion: 1,
  runtimeReady: true,
  runtimeProblems: []
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TTSForge API client", () => {
  it("sends bearer authentication and the configured base URL", async () => {
    configureBackend(backend);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);

    await getHealth();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe("http://127.0.0.1:8765/api/v1/health");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("preserves structured API errors", async () => {
    configureBackend(backend);
    const apiError = {
      type: "validation_error",
      message: "The request is invalid.",
      category: "validation",
      code: "invalid_request",
      stage: null,
      package: null,
      selector: null
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: apiError }, 422)));

    await expect(getHealth()).rejects.toMatchObject({
      name: "TtsForgeApiError",
      status: 422,
      code: "invalid_request",
      apiError
    } satisfies Partial<TtsForgeApiError>);
  });

  it("rejects an incompatible API version", async () => {
    configureBackend(backend);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      api_version: 2,
      ttsforge_version: "2.0.0",
      python_version: "3.13",
      capabilities: {}
    })));

    await expect(getSystem()).rejects.toBeInstanceOf(ApiVersionMismatchError);
  });

  it("forwards AbortSignal to fetch", async () => {
    configureBackend(backend);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await getHealth(controller.signal);

    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it("provides an authenticated client operation for every contract endpoint", () => {
    const methods = new Set(["get", "post", "put", "patch", "delete"]);
    for (const [path, pathItem] of Object.entries(contract.paths)) {
      for (const method of Object.keys(pathItem)) {
        if (!methods.has(method)) continue;
        expect(apiSource).toContain(`request(${JSON.stringify(path)}, "${method}"`);
      }
    }
  });
  it("lists jobs, reads event cursors, retries failures, and cancels active jobs", async () => {
    configureBackend(backend);
    const queuedJob = {
      id: "job-retry",
      state: "queued",
      created_at: "2025-01-01T00:00:00Z",
      started_at: null,
      finished_at: null,
      project: null,
      output: null,
      narration_id: null,
      retry_of: "job-original",
      event_sequence: 1,
      progress: null,
      result: null,
      error: null
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/job-original/retry")) {
        return jsonResponse({ id: "job-retry", state: "queued" }, 202);
      }
      if (url.pathname.endsWith("/job-retry/events")) {
        return jsonResponse({ first: 1, next: 1, truncated: false, events: [] });
      }
      if (url.pathname.endsWith("/job-retry/cancel")) {
        return jsonResponse({ ...queuedJob, state: "cancelled" });
      }
      if (url.pathname.endsWith("/job-retry")) return jsonResponse(queuedJob);
      if (url.pathname.endsWith("/jobs")) return jsonResponse({ jobs: [] });
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const retried = await retryJob("job-original");
    const events = await getJobEvents(retried.id, 0);
    const cancelled = await cancelJob(retried.id);
    const history = await listJobs({ limit: 5 });

    expect(retried.retry_of).toBe("job-original");
    expect(events.next).toBe(1);
    expect(cancelled.state).toBe("cancelled");
    expect(history.jobs).toEqual([]);
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/api/v1/jobs/job-original/retry",
      "/api/v1/jobs/job-retry",
      "/api/v1/jobs/job-retry/events",
      "/api/v1/jobs/job-retry/cancel",
      "/api/v1/jobs"
    ]);
  });
  it("returns preview audio as a binary blob", async () => {
    configureBackend(backend);
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "audio/wav" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const preview = await createPreview({ project: "/project", text: "sample" });

    expect(preview).toBeInstanceOf(Blob);
    expect(preview.type).toBe("audio/wav");
    expect([...new Uint8Array(await preview.arrayBuffer())]).toEqual([1, 2, 3]);
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get("Accept")).toBe("audio/wav");
    expect(JSON.parse(String(init?.body))).toMatchObject({ project: "/project", text: "sample" });
  });
});

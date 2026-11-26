import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TtsForgeApiError } from "../src/lib/api";
import type { JobError, JobEvent, JobStatus, JobSummary } from "../src/lib/types";
import { createJobTracker, type JobTrackerApi } from "../src/lib/jobs/tracker";
import { writeJobTracker, type JobTrackerStorage } from "../src/lib/jobs/state";

function status(id: string, state: JobStatus["state"], eventSequence = 0): JobStatus {
  return {
    id,
    state,
    created_at: "2025-01-01T00:00:00Z",
    started_at: null,
    finished_at: null,
    project: null,
    output: null,
    narration_id: null,
    retry_of: null,
    event_sequence: eventSequence,
    progress: null,
    result: null,
    error: null
  };
}

function summary(job: JobStatus): JobSummary {
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

function event(seq: number): JobEvent {
  return {
    seq,
    timestamp: `2025-01-01T00:00:${String(seq).padStart(2, "0")}Z`,
    event: { type: "job.state", state: "running" }
  };
}

function storage(): JobTrackerStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

function api(overrides: Partial<JobTrackerApi> = {}): JobTrackerApi {
  return {
    listJobs: async () => ({ jobs: [] }),
    getJob: async (id) => status(id, "running"),
    getJobEvents: async (_id, after = 0) => ({ first: 1, next: after, truncated: false, events: [] }),
    retryJob: async (id) => status(`${id}-retry`, "queued"),
    cancelJob: async (id) => status(id, "cancelled"),
    ...overrides
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("job tracker", () => {
  it("restores a persisted cursor and events, then refreshes canonical state", async () => {
    vi.useFakeTimers();
    const localStorage = storage();
    writeJobTracker({
      selectedJobId: "job-1",
      jobs: { "job-1": { cursor: 3, events: [event(2), event(3)], truncated: false } }
    }, localStorage);
    const getEvents = vi.fn(async (_id: string, after = 0) => ({
      first: 1,
      next: 4,
      truncated: false,
      events: [event(after + 1)]
    }));
    const tracker = createJobTracker({
      storage: localStorage,
      api: api({
        listJobs: async () => ({ jobs: [summary(status("job-1", "running", 4))] }),
        getJob: async (id) => status(id, "running", 4),
        getJobEvents: getEvents
      })
    });

    await tracker.refreshHistory();
    expect(get(tracker.state).cursor).toBe(3);
    await vi.advanceTimersByTimeAsync(0);

    expect(getEvents).toHaveBeenCalledWith("job-1", 3, expect.any(AbortSignal));
    expect(get(tracker.state).events.map(({ seq }) => seq)).toEqual([2, 3, 4]);
    expect(get(tracker.state).cursor).toBe(4);
    expect(get(tracker.state).job?.state).toBe("running");
    tracker.dispose();
  });

  it("backs off after transient failures and recovers from truncated events using canonical state", async () => {
    vi.useFakeTimers();
    const getEvents = vi.fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({ first: 8, next: 8, truncated: true, events: [event(8)] });
    let statusReads = 0;
    const tracker = createJobTracker({
      storage: storage(),
      api: api({
        listJobs: async () => ({ jobs: [summary(status("job-2", "completed", 8))] }),
        getJob: async (id) => status(id, statusReads++ === 0 ? "running" : "completed", 8),
        getJobEvents: getEvents
      })
    });

    await tracker.refreshHistory("job-2");
    await vi.advanceTimersByTimeAsync(0);
    expect(get(tracker.state).reconnecting).toBe(true);
    expect(get(tracker.state).trackingMessage).toBe("connection lost");
    await vi.advanceTimersByTimeAsync(749);
    expect(getEvents).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(getEvents).toHaveBeenCalledTimes(2);
    expect(get(tracker.state).reconnecting).toBe(false);
    expect(get(tracker.state).historyTruncated).toBe(true);
    expect(get(tracker.state).job?.state).toBe("completed");
    expect(get(tracker.state).cursor).toBe(8);
    tracker.dispose();
  });

  it("retries failed jobs and cancels active jobs", async () => {
    vi.useFakeTimers();
    const localStorage = storage();
    const retry = vi.fn(async () => status("job-retry", "queued"));
    const cancel = vi.fn(async (id: string) => status(id, "cancelled"));
    const tracker = createJobTracker({
      storage: localStorage,
      api: api({
        retryJob: retry,
        cancelJob: cancel,
        listJobs: async () => ({ jobs: [summary(status("job-retry", "queued"))] })
      })
    });

    tracker.adopt(status("job-failed", "failed"));
    await tracker.retry();
    expect(retry).toHaveBeenCalledWith("job-failed");
    expect(get(tracker.state).selectedJobId).toBe("job-retry");
    expect(get(tracker.state).job?.state).toBe("queued");

    tracker.adopt(status("job-running", "running"));
    await tracker.cancel();
    expect(cancel).toHaveBeenCalledWith("job-running");
    expect(get(tracker.state).job?.state).toBe("cancelled");
    expect(get(tracker.state).cancelling).toBe(false);
    expect(get(tracker.state).actionBusy).toBe(false);
    tracker.dispose();
  });

  it("retains structured API error details while reconnecting", async () => {
    vi.useFakeTimers();
    const apiError: JobError = {
      type: "BackendError",
      message: "The backend is temporarily unavailable.",
      category: "backend",
      code: "worker_unavailable",
      stage: "synthesis",
      package: "readio",
      selector: "chapter-2",
      details: { retryable: true }
    };
    const tracker = createJobTracker({
      storage: storage(),
      api: api({
        getJobEvents: async () => { throw new TtsForgeApiError(503, apiError); }
      })
    });

    tracker.adopt(status("job-3", "running"));
    await vi.advanceTimersByTimeAsync(0);

    expect(get(tracker.state).reconnecting).toBe(true);
    expect(get(tracker.state).trackingError).toEqual(apiError);
    tracker.dispose();
  });
});

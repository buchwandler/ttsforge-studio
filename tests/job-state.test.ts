import { describe, expect, it } from "vitest";
import type { JobError, JobEvent, JobEventsPage, JobState, JobSummary } from "../src/lib/types";
import {
  canRetryJob,
  appendEventPage,
  chooseJobId,
  isActiveJob,
  JOB_TRACKER_STORAGE_KEY,
  readJobTracker,
  reconnectDelay,
  serializeJobError,
  writeJobTracker
} from "../src/lib/jobs/state";

function event(seq: number, state: JobState): JobEvent {
  return {
    seq,
    timestamp: `2025-01-01T00:00:${String(seq).padStart(2, "0")}Z`,
    event: { type: "job.state", state }
  };
}

function summary(id: string, state: JobSummary["state"]): JobSummary {
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
    event_sequence: 0
  };
}

function page(events: JobEvent[], next: number, truncated = false): JobEventsPage {
  return { first: events[0]?.seq ?? 1, next, truncated, events };
}

describe("job tracking state", () => {
  it("orders and deduplicates events while advancing the event cursor", () => {
    const result = appendEventPage([event(1, "queued")], 1, page([
      event(3, "running"),
      event(2, "preparing"),
      event(3, "running")
    ], 3));

    expect(result.events.map(({ seq }) => seq)).toEqual([1, 2, 3]);
    expect(result.cursor).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("records a truncated event page so canonical state can replace the gap", () => {
    const result = appendEventPage([], 4, page([
      event(10, "preparing"),
      event(12, "running"),
      event(11, "running")
    ], 12, true));

    expect(result.events.map(({ seq }) => seq)).toEqual([10, 11, 12]);
    expect(result.cursor).toBe(12);
    expect(result.truncated).toBe(true);
  });

  it("restores selected job, event cursor, and recent events without persisting credentials", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };
    const tracker = {
      selectedJobId: "job-1",
      jobs: {
        "job-1": { cursor: 3, events: [event(2, "running"), event(3, "completed")], truncated: false }
      }
    };

    writeJobTracker(tracker, storage);

    expect(readJobTracker(storage)).toEqual(tracker);
    expect(values.get(JOB_TRACKER_STORAGE_KEY)).not.toContain("test-token");
  });

  it("restores the selected job or prefers the newest active job", () => {
    const jobs = [summary("done", "completed"), summary("active", "running")];

    expect(chooseJobId(jobs, "done")).toBe("done");
    expect(chooseJobId(jobs, null)).toBe("active");
    expect(chooseJobId([], null)).toBeNull();
  });

  it("identifies cancellable states and uses bounded reconnect backoff", () => {
    expect(isActiveJob("queued")).toBe(true);
    expect(isActiveJob("running")).toBe(true);
    expect(isActiveJob("completed")).toBe(false);
    expect(reconnectDelay(1)).toBe(750);
    expect(reconnectDelay(2)).toBe(1_500);
    expect(reconnectDelay(20)).toBe(15_000);
  });
  it("allows retry only for failed jobs and preserves structured error details", () => {
    const error: JobError = {
      type: "ConversionError",
      message: "Synthesis failed.",
      category: "conversion",
      code: "synthesis_failed",
      stage: "synthesis",
      package: "readio",
      selector: "chapter-3",
      details: { chapter: 3, recoverable: true }
    };

    expect(canRetryJob("failed")).toBe(true);
    expect(canRetryJob("completed")).toBe(false);
    expect(canRetryJob("cancelled")).toBe(false);
    expect(JSON.parse(serializeJobError(error))).toEqual(error);
  });
});

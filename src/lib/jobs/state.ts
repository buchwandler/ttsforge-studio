import type { JobEvent, JobEventsPage, JobStatus, JobSummary } from "../types";

export const JOB_TRACKER_STORAGE_KEY = "ttsforge-studio.jobs.v1";
const MAX_STORED_JOBS = 20;
const MAX_STORED_EVENTS = 100;

export interface StoredJobProgress {
  cursor: number;
  events: JobEvent[];
  truncated: boolean;
}

export interface StoredJobTracker {
  selectedJobId: string | null;
  jobs: Record<string, StoredJobProgress>;
}

export interface JobTrackerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface EventPageUpdate {
  cursor: number;
  events: JobEvent[];
  truncated: boolean;
}

const emptyTracker = (): StoredJobTracker => ({ selectedJobId: null, jobs: {} });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJobEvent(value: unknown): value is JobEvent {
  return (
    isRecord(value) &&
    typeof value.seq === "number" &&
    Number.isSafeInteger(value.seq) &&
    typeof value.timestamp === "string" &&
    isRecord(value.event) &&
    typeof value.event.type === "string"
  );
}

export function readJobTracker(
  storage: JobTrackerStorage = window.localStorage
): StoredJobTracker {
  try {
    const value: unknown = JSON.parse(storage.getItem(JOB_TRACKER_STORAGE_KEY) || "null");
    if (!isRecord(value) || !isRecord(value.jobs)) return emptyTracker();

    const jobs: Record<string, StoredJobProgress> = {};
    for (const [id, item] of Object.entries(value.jobs)) {
      if (
        !isRecord(item) ||
        typeof item.cursor !== "number" ||
        !Number.isSafeInteger(item.cursor) ||
        item.cursor < 0 ||
        !Array.isArray(item.events)
      ) {
        continue;
      }
      jobs[id] = {
        cursor: item.cursor,
        events: item.events.filter(isJobEvent).slice(-MAX_STORED_EVENTS),
        truncated: item.truncated === true
      };
    }

    return {
      selectedJobId: typeof value.selectedJobId === "string" ? value.selectedJobId : null,
      jobs
    };
  } catch {
    return emptyTracker();
  }
}

export function writeJobTracker(
  tracker: StoredJobTracker,
  storage: JobTrackerStorage = window.localStorage
): void {
  const entries = Object.entries(tracker.jobs).slice(-MAX_STORED_JOBS);
  const jobs = Object.fromEntries(entries.map(([id, progress]) => [
    id,
    {
      cursor: progress.cursor,
      events: progress.events.slice(-MAX_STORED_EVENTS),
      truncated: progress.truncated
    }
  ]));
  try {
    storage.setItem(JOB_TRACKER_STORAGE_KEY, JSON.stringify({
      selectedJobId: tracker.selectedJobId,
      jobs
    }));
  } catch {
    // Job state remains recoverable from the backend if browser storage is unavailable.
  }
}

export function chooseJobId(
  jobs: JobSummary[],
  preferredId: string | null
): string | null {
  if (preferredId && jobs.some((job) => job.id === preferredId)) return preferredId;
  const active = jobs.find((job) => isActiveJob(job.state));
  return active?.id ?? jobs[0]?.id ?? null;
}

export function isActiveJob(state: JobStatus["state"]): boolean {
  return state === "queued" || state === "preparing" || state === "running";
}


export function canRetryJob(state: JobStatus["state"]): boolean {
  return state === "failed";
}

export function serializeJobError(error: JobStatus["error"]): string {
  return JSON.stringify(error, null, 2);
}
export function appendEventPage(
  currentEvents: JobEvent[],
  cursor: number,
  page: JobEventsPage
): EventPageUpdate {
  const events = new Map(currentEvents.map((event) => [event.seq, event]));
  for (const event of page.events) {
    if (event.seq > cursor) events.set(event.seq, event);
  }
  return {
    cursor: Math.max(cursor, page.next),
    events: [...events.values()].sort((left, right) => left.seq - right.seq).slice(-MAX_STORED_EVENTS),
    truncated: page.truncated
  };
}

export function reconnectDelay(attempt: number): number {
  return Math.min(15_000, 750 * 2 ** Math.max(0, attempt - 1));
}

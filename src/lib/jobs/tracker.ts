import { get, writable, type Readable } from "svelte/store";
import {
  cancelJob,
  getJob,
  getJobEvents,
  listJobs,
  retryJob,
  TtsForgeApiError
} from "../api";
import { isAbortError, LatestRequest } from "../setup/latest-request";
import type { JobError, JobEvent, JobEventsPage, JobStatus, JobSummary } from "../types";
import {
  appendEventPage,
  canRetryJob,
  chooseJobId,
  isActiveJob,
  readJobTracker,
  reconnectDelay,
  writeJobTracker,
  type JobTrackerStorage
} from "./state";

export interface JobTrackerState {
  history: JobSummary[];
  selectedJobId: string | null;
  job: JobStatus | null;
  events: JobEvent[];
  cursor: number;
  historyTruncated: boolean;
  reconnecting: boolean;
  cancelling: boolean;
  actionBusy: boolean;
  trackingMessage: string;
  trackingError: JobError | null;
}

export interface JobTrackerApi {
  listJobs(query: { limit: number }, signal?: AbortSignal): Promise<{ jobs: JobSummary[] }>;
  getJob(id: string, signal?: AbortSignal): Promise<JobStatus>;
  getJobEvents(id: string, after?: number, signal?: AbortSignal): Promise<JobEventsPage>;
  retryJob(id: string, signal?: AbortSignal): Promise<JobStatus>;
  cancelJob(id: string, signal?: AbortSignal): Promise<JobStatus>;
}

export interface JobTrackerOptions {
  api?: JobTrackerApi;
  storage?: JobTrackerStorage;
}

const defaultApi: JobTrackerApi = {
  listJobs,
  getJob,
  getJobEvents,
  retryJob,
  cancelJob
};

const initialState = (): JobTrackerState => ({
  history: [],
  selectedJobId: null,
  job: null,
  events: [],
  cursor: 0,
  historyTruncated: false,
  reconnecting: false,
  cancelling: false,
  actionBusy: false,
  trackingMessage: "",
  trackingError: null
});

export interface JobTracker {
  state: Readable<JobTrackerState>;
  refreshHistory(preferredId?: string): Promise<void>;
  select(id: string): Promise<void>;
  adopt(job: JobStatus): void;
  cancel(): Promise<void>;
  retry(): Promise<void>;
  dispose(): void;
}

export function createJobTracker(options: JobTrackerOptions = {}): JobTracker {
  const api = options.api ?? defaultApi;
  const storage = options.storage ?? window.localStorage;
  const store = writable(initialState());
  const requests = new LatestRequest();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;

  function patch(values: Partial<JobTrackerState>): void {
    store.update((current) => ({ ...current, ...values }));
  }

  function persist(): void {
    const current = get(store);
    const tracker = readJobTracker(storage);
    const jobs = { ...tracker.jobs };
    if (current.job) {
      jobs[current.job.id] = {
        cursor: current.cursor,
        events: current.events,
        truncated: current.historyTruncated
      };
    }
    writeJobTracker({ selectedJobId: current.selectedJobId, jobs }, storage);
  }

  function schedule(delay = 1_000): void {
    const current = get(store);
    if (!current.job || current.job.id !== current.selectedJobId) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void poll(), delay);
  }

  async function select(id: string): Promise<void> {
    if (timer) clearTimeout(timer);
    const ticket = requests.begin();
    const saved = readJobTracker(storage).jobs[id];
    patch({
      selectedJobId: id,
      job: null,
      events: [],
      cursor: 0,
      historyTruncated: false,
      reconnecting: false,
      cancelling: false,
      trackingMessage: "",
      trackingError: null
    });

    const canonical = await api.getJob(id, ticket.signal);
    if (!requests.isCurrent(ticket.generation) || get(store).selectedJobId !== id) return;

    const cursor = Math.min(saved?.cursor ?? 0, canonical.event_sequence);
    patch({
      job: canonical,
      cursor,
      events: (saved?.events ?? []).filter((event) => event.seq <= cursor),
      historyTruncated: saved?.truncated ?? false
    });
    persist();
    reconnectAttempt = 0;
    schedule(0);
  }

  async function refreshHistory(preferredId?: string): Promise<void> {
    const response = await api.listJobs({ limit: 50 });
    const current = get(store);
    const stored = readJobTracker(storage);
    const history = response.jobs;
    const selectedId = chooseJobId(
      history,
      preferredId ?? current.selectedJobId ?? stored.selectedJobId
    );
    patch({ history });

    if (!selectedId) {
      if (current.job && current.selectedJobId === current.job.id) return;
      patch({ selectedJobId: null, job: null, events: [], cursor: 0 });
      persist();
      return;
    }
    if (selectedId === current.selectedJobId && current.job?.id === selectedId) {
      persist();
      return;
    }
    await select(selectedId);
  }

  function adopt(job: JobStatus): void {
    if (timer) clearTimeout(timer);
    requests.cancel();
    reconnectAttempt = 0;
    patch({
      selectedJobId: job.id,
      job,
      events: [],
      cursor: 0,
      historyTruncated: false,
      reconnecting: false,
      cancelling: false,

      trackingMessage: "",
      trackingError: null
    });
    persist();
    schedule(0);
  }

  async function poll(): Promise<void> {
    const current = get(store);
    const job = current.job;
    if (!job || job.id !== current.selectedJobId) return;
    const ticket = requests.begin();

    try {
      const page = await api.getJobEvents(job.id, current.cursor, ticket.signal);
      if (!requests.isCurrent(ticket.generation) || get(store).selectedJobId !== job.id) return;
      const update = appendEventPage(current.events, current.cursor, page);
      patch({
        events: update.events,
        cursor: update.cursor,
        historyTruncated: current.historyTruncated || update.truncated
      });

      const canonical = await api.getJob(job.id, ticket.signal);
      if (!requests.isCurrent(ticket.generation) || get(store).selectedJobId !== job.id) return;
      patch({
        job: canonical,
        reconnecting: false,
        cancelling: isActiveJob(canonical.state) && get(store).cancelling,
        trackingMessage: "",
        trackingError: null
      });
      reconnectAttempt = 0;
      persist();

      if (isActiveJob(canonical.state)) {
        schedule();
      } else {
        patch({ cancelling: false });
        void refreshHistory().catch(() => undefined);
      }
    } catch (error) {
      if (!requests.isCurrent(ticket.generation) || get(store).selectedJobId !== job.id || isAbortError(error)) return;
      reconnectAttempt += 1;
      patch({
        reconnecting: true,
        trackingError: error instanceof TtsForgeApiError ? error.apiError : null,
        trackingMessage: error instanceof Error ? error.message : String(error)
      });
      schedule(reconnectDelay(reconnectAttempt));
    }
  }

  async function cancel(): Promise<void> {
    const current = get(store);
    const job = current.job;
    if (!job || !isActiveJob(job.state) || current.actionBusy) return;
    if (timer) clearTimeout(timer);
    requests.cancel();
    patch({ actionBusy: true, cancelling: true });
    try {
      const updated = await api.cancelJob(job.id);
      if (get(store).selectedJobId !== job.id) return;
      patch({ job: updated, cancelling: isActiveJob(updated.state) });
      persist();
      schedule(0);
    } catch (error) {
      schedule(0);
      patch({ cancelling: false });
      throw error;
    } finally {
      patch({ actionBusy: false });
    }
  }

  async function retry(): Promise<void> {
    const current = get(store);
    const job = current.job;
    if (!job || !canRetryJob(job.state) || current.actionBusy) return;
    if (timer) clearTimeout(timer);
    requests.cancel();
    patch({ actionBusy: true });
    try {
      const retried = await api.retryJob(job.id);
      adopt(retried);
      await refreshHistory(retried.id);
    } catch (error) {
      schedule(0);
      throw error;
    } finally {
      patch({ actionBusy: false });
    }
  }

  function dispose(): void {
    if (timer) clearTimeout(timer);
    requests.cancel();
  }

  return {
    state: { subscribe: store.subscribe },
    refreshHistory,
    select,
    adopt,
    cancel,
    retry,
    dispose
  };
}

import { describe, expect, it, vi } from "vitest";
import { createLibraryStore, type LibraryApi, type LibraryState } from "../src/lib/library/store";
import type { AudiobookMetadata, ProjectMetadataView, ProjectSummary } from "../src/lib/types";

function project(id: string): ProjectSummary {
  return {
    project_id: id,
    title: id,
    author: null,
    source: null,
    project: `/${id}`,
    chapter_count: 1,
    selected_chapter_count: 1,
    narrations: [],
    primary_narration_id: null,
    outputs: [],
    qc_state: null,
    active_job_id: null,
    last_activity: null,
    error: null
  };
}

function metadata(path: string): ProjectMetadataView {
  return {
    project: path,
    source: path,
    source_metadata: {},
    overrides: {},
    effective: { title: path }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function currentState(store: ReturnType<typeof createLibraryStore>): LibraryState {
  let state!: LibraryState;
  const unsubscribe = store.state.subscribe((value) => { state = value; });
  unsubscribe();
  return state;
}

function api(overrides: Partial<LibraryApi> = {}): LibraryApi {
  return {
    getLibraryProjects: async (root) => ({ root, projects: [] }),
    getLibraryProject: async (id) => project(id),
    getProjectMetadata: async (path) => metadata(path),
    getProjectChapters: async (path) => ({ project: path, chapters: [] }),
    validateProjectMetadata: async () => ({ valid: true, findings: [] }),
    setProjectMetadata: async ({ project: path, metadata: value }) => ({ ...metadata(path), effective: value }),
    selectProjectChapters: async () => undefined,
    getProjectQc: async () => ({ project: "/a", narration_id: null, passed: true, findings: [] }),
    ...overrides
  };
}

describe("library store", () => {
  it("does not let an older project response overwrite the newer selection", async () => {
    const pendingA = deferred<ProjectMetadataView>();
    const getMetadata = vi.fn((path: string) => path === "/a" ? pendingA.promise : Promise.resolve(metadata(path)));
    const store = createLibraryStore(api({ getProjectMetadata: getMetadata }));

    const selectionA = store.select("a");
    await vi.waitFor(() => expect(getMetadata).toHaveBeenCalledWith("/a", expect.anything()));
    await store.select("b");
    expect(currentState(store).selectedProject?.project_id).toBe("b");

    pendingA.resolve(metadata("/a"));
    await selectionA;
    expect(currentState(store).selectedProject?.project_id).toBe("b");
    expect(currentState(store).metadata?.project).toBe("/b");
  });

  it("validates metadata with the backend before saving it", async () => {
    const setMetadata = vi.fn(async ({ project: path, metadata: value }: { project: string; metadata: AudiobookMetadata }) => ({
      ...metadata(path),
      effective: value
    }));
    const store = createLibraryStore(api({
      validateProjectMetadata: async () => ({ valid: false, findings: [{ message: "Title is required." }] }),
      setProjectMetadata: setMetadata
    }));
    await store.select("a");

    await expect(store.saveMetadata({ title: null })).rejects.toThrow("Title is required.");
    expect(setMetadata).not.toHaveBeenCalled();
  });
});

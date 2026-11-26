import { get, writable, type Readable } from "svelte/store";
import {
  getLibraryProject,
  getLibraryProjects,
  getProjectChapters,
  getProjectMetadata,
  getProjectQc,
  selectProjectChapters,
  setProjectMetadata,
  validateProjectMetadata
} from "../api";
import type {
  AudiobookMetadata,
  ChapterStatus,
  ProjectMetadataView,
  ProjectQcReport,
  ProjectSummary
} from "../types";
import { LatestRequest } from "../setup/latest-request";

export interface LibraryState {
  root: string;
  projects: ProjectSummary[];
  selectedProject: ProjectSummary | null;
  chapters: ChapterStatus[];
  metadata: ProjectMetadataView | null;
  qc: ProjectQcReport | null;
  busy: boolean;
}

export interface LibraryApi {
  getLibraryProjects(root: string, signal?: AbortSignal): Promise<{ root: string; projects: ProjectSummary[] }>;
  getLibraryProject(id: string, signal?: AbortSignal): Promise<ProjectSummary>;
  getProjectMetadata(project: string, signal?: AbortSignal): Promise<ProjectMetadataView>;
  getProjectChapters(project: string, signal?: AbortSignal): Promise<{ project: string; chapters: ChapterStatus[] }>;
  validateProjectMetadata(value: { project: string; metadata: AudiobookMetadata }, signal?: AbortSignal): Promise<{ valid: boolean; findings: { message: string }[] }>;
  setProjectMetadata(value: { project: string; metadata: AudiobookMetadata }, signal?: AbortSignal): Promise<ProjectMetadataView>;
  selectProjectChapters(value: { project: string; selection: string }, signal?: AbortSignal): Promise<unknown>;
  getProjectQc(value: { project: string; narration_id?: string | null }, signal?: AbortSignal): Promise<ProjectQcReport>;
}

export interface LibraryStore {
  state: Readable<LibraryState>;
  load(root: string): Promise<void>;
  select(projectId: string): Promise<void>;
  saveMetadata(metadata: AudiobookMetadata): Promise<void>;
  saveChapters(selection: string): Promise<void>;
  runQc(): Promise<void>;
  clear(): void;
}

const defaultApi: LibraryApi = {
  getLibraryProjects,
  getLibraryProject,
  getProjectMetadata,
  getProjectChapters,
  validateProjectMetadata,
  setProjectMetadata,
  selectProjectChapters,
  getProjectQc
};

const initialState = (): LibraryState => ({
  root: "",
  projects: [],
  selectedProject: null,
  chapters: [],
  metadata: null,
  qc: null,
  busy: false
});

export function createLibraryStore(api: LibraryApi = defaultApi): LibraryStore {
  const store = writable(initialState());
  const requests = new LatestRequest();

  function patch(values: Partial<LibraryState>): void {
    store.update((current) => ({ ...current, ...values }));
  }

  async function load(root: string): Promise<void> {
    const ticket = requests.begin();
    patch({ root, busy: true, selectedProject: null, chapters: [], metadata: null, qc: null });
    try {
      const response = await api.getLibraryProjects(root, ticket.signal);
      if (!requests.isCurrent(ticket.generation)) return;
      patch({ projects: response.projects });
    } finally {
      if (requests.isCurrent(ticket.generation)) patch({ busy: false });
    }
  }

  async function loadProject(project: ProjectSummary, generation: number, signal?: AbortSignal): Promise<void> {
    const [metadata, chapterResponse] = await Promise.all([
      api.getProjectMetadata(project.project, signal),
      api.getProjectChapters(project.project, signal)
    ]);
    if (requests.isCurrent(generation)) {
      patch({ selectedProject: project, metadata, chapters: chapterResponse.chapters, qc: null });
    }
  }

  async function select(projectId: string): Promise<void> {
    const ticket = requests.begin();
    patch({ busy: true, qc: null });
    try {
      const project = await api.getLibraryProject(projectId, ticket.signal);
      if (!requests.isCurrent(ticket.generation)) return;
      await loadProject(project, ticket.generation, ticket.signal);
    } finally {
      if (requests.isCurrent(ticket.generation)) patch({ busy: false });
    }
  }

  async function saveMetadata(metadata: AudiobookMetadata): Promise<void> {
    const project = get(store).selectedProject;
    if (!project) return;
    const ticket = requests.begin();
    patch({ busy: true });
    try {
      const request = { project: project.project, metadata };
      const validation = await api.validateProjectMetadata(request, ticket.signal);
      if (!requests.isCurrent(ticket.generation)) return;
      if (!validation.valid) throw new Error(validation.findings.map((finding) => finding.message).join(" "));
      await api.setProjectMetadata(request, ticket.signal);
      if (!requests.isCurrent(ticket.generation)) return;
      await loadProject(project, ticket.generation, ticket.signal);
      const response = await api.getLibraryProjects(get(store).root, ticket.signal);
      if (requests.isCurrent(ticket.generation)) {
        const selectedProject = response.projects.find((item) => item.project_id === project.project_id) || project;
        patch({ projects: response.projects, selectedProject });
      }
    } finally {
      if (requests.isCurrent(ticket.generation)) patch({ busy: false });
    }
  }

  async function saveChapters(selection: string): Promise<void> {
    const project = get(store).selectedProject;
    if (!project) return;
    const ticket = requests.begin();
    patch({ busy: true });
    try {
      await api.selectProjectChapters({ project: project.project, selection }, ticket.signal);
      if (!requests.isCurrent(ticket.generation)) return;
      await loadProject(project, ticket.generation, ticket.signal);
      const response = await api.getLibraryProjects(get(store).root, ticket.signal);
      if (requests.isCurrent(ticket.generation)) {
        const selectedProject = response.projects.find((item) => item.project_id === project.project_id) || project;
        patch({ projects: response.projects, selectedProject });
      }
    } finally {
      if (requests.isCurrent(ticket.generation)) patch({ busy: false });
    }
  }

  async function runQc(): Promise<void> {
    const state = get(store);
    if (!state.selectedProject) return;
    const ticket = requests.begin();
    patch({ busy: true });
    try {
      const result = await api.getProjectQc({
        project: state.selectedProject.project,
        narration_id: state.selectedProject.primary_narration_id
      }, ticket.signal);
      if (requests.isCurrent(ticket.generation)) patch({ qc: result });
    } finally {
      if (requests.isCurrent(ticket.generation)) patch({ busy: false });
    }
  }

  function clear(): void {
    requests.cancel();
    store.set(initialState());
  }

  return {
    state: { subscribe: store.subscribe },
    load,
    select,
    saveMetadata,
    saveChapters,
    runQc,
    clear
  };
}

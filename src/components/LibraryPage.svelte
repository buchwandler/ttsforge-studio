<script lang="ts">
  import type {
    AudiobookMetadata,
    ChapterStatus,
    ProjectMetadataView,
    ProjectQcReport,
    ProjectSummary
  } from "../lib/types";

  export let root = "";
  export let nativeFileActions = false;
  export let projects: ProjectSummary[] = [];
  export let selectedProject: ProjectSummary | null = null;
  export let chapters: ChapterStatus[] = [];
  export let metadata: ProjectMetadataView | null = null;
  export let qc: ProjectQcReport | null = null;
  export let busy = false;
  export let onRoot: (value: string) => void;
  export let onBrowseRoot: () => void;
  export let onRefresh: () => void;
  export let onSelectProject: (project: ProjectSummary) => void;
  export let onSaveMetadata: (metadata: AudiobookMetadata) => void;
  export let onSaveChapters: (selection: string) => void;
  export let onRunQc: () => void;
  export let onOpenOutput: (path: string) => void;

  let draft: AudiobookMetadata = {};
  let selectedNumbers: number[] = [];

  $: if (metadata) draft = { ...metadata.effective };
  $: if (chapters) selectedNumbers = chapters.filter((chapter) => chapter.selected).map((chapter) => chapter.number);

  function updateMetadata(field: keyof AudiobookMetadata, value: string): void {
    draft = { ...draft, [field]: value || null };
  }

  function toggleChapter(number: number, checked: boolean): void {
    selectedNumbers = checked
      ? [...new Set([...selectedNumbers, number])].sort((left, right) => left - right)
      : selectedNumbers.filter((item) => item !== number);
  }

  function saveChapterSelection(): void {
    if (!chapters.length || !selectedNumbers.length) return;
    const selection = selectedNumbers.length === chapters.length
      ? "all"
      : selectedNumbers.join(",");
    onSaveChapters(selection);
  }
</script>

<div class="library-layout">
  <section class="card library-list" aria-labelledby="library-title" aria-busy={busy}>
    <div class="card-title-row">
      <div>
        <p class="eyebrow">Projects</p>
        <h2 id="library-title">Library</h2>
      </div>
      <button class="secondary" type="button" disabled={busy || !root} onclick={onRefresh}>Refresh</button>
    </div>
    <p class="muted" aria-live="polite">{busy ? "Loading projects…" : `${projects.length} projects`}</p>
    <div class="library-root">
      <label for="library-root">Project folder</label>
      <div class="field-row">
        <input id="library-root" value={root} placeholder="Choose a TTSForge project folder" oninput={(event) => onRoot(event.currentTarget.value)} />
        <button class="secondary" type="button" disabled={!nativeFileActions || busy} onclick={onBrowseRoot}>Choose folder</button>
      </div>
    </div>
    {#if projects.length}
      <ul class="project-list" aria-label="Recent projects">
        {#each projects as project (project.project_id)}
          <li>
            <button
              type="button"
              class="project-entry"
              class:selected={selectedProject?.project_id === project.project_id}
              aria-pressed={selectedProject?.project_id === project.project_id}
              disabled={busy}
              onclick={() => onSelectProject(project)}
            >
              <strong>{project.title || "Untitled audiobook"}</strong>
              <span>{project.author || "Unknown author"} · {project.chapter_count} chapters</span>
              <small>{project.last_activity ? new Date(project.last_activity).toLocaleString() : project.project}</small>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">{root ? "No projects were found in this folder." : "Choose a project folder to browse recent work."}</p>
    {/if}
  </section>

  {#if selectedProject}
    <section class="card project-detail" aria-labelledby="project-title">
      <div class="card-title-row">
        <div>
          <p class="eyebrow">Audiobook project</p>
          <h2 id="project-title">{selectedProject.title || "Untitled audiobook"}</h2>
        </div>
        <button class="secondary" type="button" disabled={busy} onclick={onRunQc}>Run quality check</button>
      </div>
      <p class="muted">{selectedProject.author || "Unknown author"} · {selectedProject.selected_chapter_count} of {selectedProject.chapter_count} chapters selected</p>

      {#if metadata}
        <details open>
          <summary>Edit metadata</summary>
          <div class="metadata-grid">
            <label>Title<input value={draft.title || ""} oninput={(event) => updateMetadata("title", event.currentTarget.value)} /></label>
            <label>Subtitle<input value={draft.subtitle || ""} oninput={(event) => updateMetadata("subtitle", event.currentTarget.value)} /></label>
            <label>Author<input value={draft.author || ""} oninput={(event) => updateMetadata("author", event.currentTarget.value)} /></label>
            <label>Narrator<input value={draft.narrator || ""} oninput={(event) => updateMetadata("narrator", event.currentTarget.value)} /></label>
            <label>Series<input value={draft.series || ""} oninput={(event) => updateMetadata("series", event.currentTarget.value)} /></label>
            <label>Language<input value={draft.language || ""} oninput={(event) => updateMetadata("language", event.currentTarget.value)} /></label>
          </div>
          <button class="secondary" type="button" disabled={busy} onclick={() => onSaveMetadata(draft)}>Validate and save metadata</button>
        </details>
      {/if}

      {#if chapters.length}
        <details open>
          <summary>Chapters ({selectedNumbers.length} selected)</summary>
          <div class="chapter-list" aria-label="Book chapters">
            {#each chapters as chapter (chapter.number)}
              <label class="chapter-row">
                <input
                  type="checkbox"
                  checked={selectedNumbers.includes(chapter.number)}
                  disabled={busy}
                  onchange={(event) => toggleChapter(chapter.number, event.currentTarget.checked)}
                />
                <span><strong>{chapter.number}. {chapter.title}</strong><small>{chapter.char_count == null ? "Length unavailable" : `${chapter.char_count.toLocaleString()} characters`}</small></span>
              </label>
            {/each}
          </div>
          <button class="secondary" type="button" disabled={busy || !selectedNumbers.length} onclick={saveChapterSelection}>Save chapter selection</button>
        </details>
      {/if}

      {#if selectedProject.outputs.length}
        <div class="outputs">
          <h3>Completed outputs</h3>
          {#each selectedProject.outputs as output (output)}
            <div class="output-row"><span>{output}</span><button class="secondary" type="button" disabled={busy || !nativeFileActions} onclick={() => onOpenOutput(output)}>Open output</button></div>
          {/each}
        </div>
      {/if}

      {#if qc}
        <section class="qc-results" aria-labelledby="qc-title" aria-live="polite">
          <h3 id="qc-title">Quality check {qc.passed ? "passed" : "needs attention"}</h3>
          {#if qc.findings.length}
            <ul>
              {#each qc.findings as finding (finding.id)}
                <li><strong>{finding.severity}</strong> · {finding.message}</li>
              {/each}
            </ul>
          {:else}
            <p class="muted">No findings reported.</p>
          {/if}
        </section>
      {/if}
    </section>
  {:else}
    <section class="card project-detail"><p class="muted">Choose a project to edit metadata, select chapters, inspect quality, or open its output.</p></section>
  {/if}
</div>

<style>
  .library-layout { display: grid; grid-template-columns: minmax(17rem, 0.8fr) minmax(0, 1.7fr); gap: 1rem; align-items: start; }
  .library-root { display: grid; gap: 0.4rem; margin-bottom: 1rem; }
  .library-root label, .metadata-grid label { color: #b7bfce; font-size: 0.9rem; }
  .field-row, .output-row { display: flex; gap: 0.5rem; }
  .field-row input { min-width: 0; flex: 1; }
  .project-list { display: grid; gap: 0.5rem; max-height: 65vh; overflow: auto; list-style: none; padding: 0; margin: 0; }
  .project-entry { display: grid; width: 100%; gap: 0.25rem; text-align: left; background: #111620; border: 1px solid #353d4c; color: #e6eaf2; }
  .project-entry.selected { border-color: #7181a5; background: #171c27; }
  .project-entry span, .project-entry small, .chapter-row small { color: #929aac; }
  .metadata-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; margin: 0.8rem 0; }
  .metadata-grid label { display: grid; gap: 0.3rem; }
  .chapter-list { max-height: 26rem; overflow: auto; display: grid; margin: 0.8rem 0; }
  .chapter-row { display: grid; grid-template-columns: auto 1fr; gap: 0.7rem; align-items: start; padding: 0.5rem 0; border-bottom: 1px solid #353d4c; }
  .chapter-row span { display: grid; gap: 0.2rem; }
  .output-row { align-items: center; justify-content: space-between; margin: 0.4rem 0; }
  .output-row span { overflow-wrap: anywhere; }
  .qc-results { border-top: 1px solid #353d4c; margin-top: 1rem; padding-top: 0.5rem; }
  details { margin-top: 0.9rem; }
  summary { cursor: pointer; font-weight: 650; }
  @media (max-width: 850px) {
    .library-layout { grid-template-columns: 1fr; }
    .metadata-grid { grid-template-columns: 1fr; }
  }
</style>

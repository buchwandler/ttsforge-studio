<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import type { BookInspection } from "../lib/types";
  import { inTauri } from "../lib/runtime";

  export let inspection: BookInspection | null = null;
  export let busy = false;
  export let enabled = false;
  export let onPath: (path: string) => Promise<void>;
  export let onUpload: (file: File) => Promise<void>;

  let manualPath = "";

  async function chooseDesktop() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Books", extensions: ["epub"] }]
    });

    if (typeof selected === "string") {
      await onPath(selected);
    }
  }

  async function fileChanged(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await onUpload(file);
  }
</script>

<section class="card">
  <div class="card-title-row">
    <div>
      <p class="eyebrow">Source</p>
      <h2>Book</h2>
    </div>
    {#if inspection}
      <span class="status-pill ok">{inspection.chapters.length} chapters</span>
    {/if}
  </div>

  {#if inTauri()}
    <button class="secondary wide" disabled={!enabled || busy} onclick={chooseDesktop}>
      {busy ? "Inspecting…" : "Choose EPUB"}
    </button>
  {:else}
    <label class="file-drop" class:disabled={!enabled}>
      <input
        type="file"
        accept=".epub,application/epub+zip"
        disabled={!enabled || busy}
        onchange={fileChanged}
      />
      <span>{busy ? "Inspecting…" : "Choose an EPUB"}</span>
    </label>

    <div class="manual-path">
      <input
        placeholder="/path/to/book.epub"
        bind:value={manualPath}
        disabled={!enabled || busy}
      />
      <button
        class="secondary"
        disabled={!enabled || busy || !manualPath.trim()}
        onclick={() => onPath(manualPath.trim())}
      >
        Inspect path
      </button>
    </div>
  {/if}

  {#if inspection}
    <div class="book-summary">
      <h3>{inspection.title || "Untitled book"}</h3>
      <p>{inspection.author || "Unknown author"}</p>
      <div class="summary-grid">
        <span>Language <strong>{inspection.language || "unknown"}</strong></span>
        <span>Source <strong>{inspection.kind}</strong></span>
      </div>
    </div>
  {/if}
</section>

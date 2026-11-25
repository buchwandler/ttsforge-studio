<script lang="ts">
  import { onMount } from "svelte";
  import RuntimeCard from "./components/RuntimeCard.svelte";
  import BookPanel from "./components/BookPanel.svelte";
  import SetupPanel from "./components/SetupPanel.svelte";
  import ProgressPanel from "./components/ProgressPanel.svelte";
  import {
    cancelJob,
    configureBackend,
    createJob,
    getJob,
    importSource,
    inspectSource,
    listEngines,
    listSpacy,
    listTargets,
    listVoices
  } from "./lib/api";
  import {
    installRuntime,
    runtimeStatus,
    startBackend,
    stopBackend
  } from "./lib/runtime";
  import type {
    BookInspection,
    EngineChoice,
    JobStatus,
    RuntimeStatus,
    SpacyModel,
    TargetChoice,
    VoiceChoice
  } from "./lib/types";

  let runtime: RuntimeStatus | null = null;
  let runtimeBusy = false;
  let backendReady = false;
  let sourceBusy = false;
  let error = "";

  let inspection: BookInspection | null = null;
  let engines: EngineChoice[] = [];
  let targets: TargetChoice[] = [];
  let voices: VoiceChoice[] = [];
  let spacyModels: SpacyModel[] = [];

  let language = "en-US";
  let chapters = "all";
  let output = "";
  let engine = "";
  let target = "";
  let voice = "";
  let spacy = "lg";
  let pauseTiming = "engaging";

  let job: JobStatus | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    void (async () => {
      runtime = await runtimeStatus();
      if (import.meta.env.VITE_TTSFORGE_MOCK === "1") {
        await connectBackend();
      }
    })();

    return () => {
      if (pollTimer) clearTimeout(pollTimer);
      stopBackend().catch(() => undefined);
    };
  });

  async function run(action: () => Promise<void>) {
    error = "";
    try {
      await action();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function installManagedRuntime() {
    await run(async () => {
      runtimeBusy = true;
      try {
        runtime = await installRuntime();
      } finally {
        runtimeBusy = false;
      }
    });
  }

  async function connectBackend() {
    await run(async () => {
      runtimeBusy = true;
      try {
        const info = await startBackend();
        configureBackend(info);
        backendReady = true;
      } finally {
        runtimeBusy = false;
      }
    });
  }

  function defaultOutput(source: string): string {
    return source.toLowerCase().endsWith(".epub")
      ? source.slice(0, -5) + ".m4b"
      : source + ".m4b";
  }

  async function applyInspection(value: BookInspection) {
    inspection = value;
    language = value.language || "en-US";
    output = defaultOutput(value.source);
    chapters = "all";
    job = null;

    engines = await listEngines();
    spacyModels = await listSpacy(language);

    const preferred = engines.find((item) => item.id === "kokoro" && item.runnable)
      || engines.find((item) => item.runnable);
    engine = preferred?.id || "";
    await refreshTargets();
  }

  async function inspectPath(path: string) {
    await run(async () => {
      sourceBusy = true;
      try {
        await applyInspection(await inspectSource(path));
      } finally {
        sourceBusy = false;
      }
    });
  }

  async function upload(file: File) {
    await run(async () => {
      sourceBusy = true;
      try {
        await applyInspection(await importSource(file));
      } finally {
        sourceBusy = false;
      }
    });
  }

  async function refreshTargets() {
    targets = [];
    voices = [];
    target = "";
    voice = "";
    if (!engine || !language) return;

    targets = await listTargets(engine, language);
    const preferred = targets.find((item) => item.runtime_available && !item.reference_only);
    target = preferred?.id || "";
    if (target) await refreshVoices();
  }

  async function refreshVoices() {
    voices = [];
    voice = "";
    if (!engine || !target || !language) return;

    voices = await listVoices(engine, target, language);
    voice = voices.find((item) => item.default)?.id || voices[0]?.id || "";
  }

  async function languageChanged(value: string) {
    language = value;
    await run(async () => {
      spacyModels = await listSpacy(language);
      await refreshTargets();
    });
  }

  async function engineChanged(value: string) {
    engine = value;
    await run(refreshTargets);
  }

  async function targetChanged(value: string) {
    target = value;
    await run(refreshVoices);
  }

  async function beginConversion() {
    if (!inspection || !engine || !target) return;

    await run(async () => {
      job = await createJob({
        source: inspection!.source,
        chapters,
        output: output || null,
        language,
        engine,
        target,
        voice: voice || null,
        engine_options: {},
        spacy: spacy as "off" | "auto" | "sm" | "md" | "lg" | "trf",
        pause_timing: pauseTiming as "fixed" | "natural" | "engaging",
        title: inspection!.title,
        author: inspection!.author,
        offline: false,
        refresh: false,
        replace_output: false,
        fresh: false,
        new_variant: false
      });
      schedulePoll();
    });
  }

  function schedulePoll() {
    if (!job) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(pollJob, 750);
  }

  async function pollJob() {
    if (!job) return;
    try {
      job = await getJob(job.id);
      if (["queued", "preparing", "running"].includes(job.state)) {
        schedulePoll();
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function cancelActiveJob() {
    if (!job) return;
    await run(async () => {
      job = await cancelJob(job!.id);
      if (pollTimer) clearTimeout(pollTimer);
    });
  }

  $: canConvert =
    backendReady &&
    !!inspection &&
    !!language &&
    !!engine &&
    !!target &&
    !!output &&
    !["queued", "preparing", "running"].includes(job?.state || "");
</script>

<svelte:head>
  <title>TTSForge Studio</title>
</svelte:head>

<div class="shell">
  <header class="hero">
    <div>
      <p class="brand">TTSForge Studio</p>
      <h1>Build an audiobook locally.</h1>
      <p class="hero-copy">
        Configure TTSForge visually while keeping conversion, models and source files on this machine.
      </p>
    </div>
    <span class="mvp-badge">MVP</span>
  </header>

  {#if error}
    <div class="global-error">
      <span>{error}</span>
      <button aria-label="dismiss error" onclick={() => (error = "")}>×</button>
    </div>
  {/if}

  <main class="dashboard">
    <RuntimeCard
      status={runtime}
      busy={runtimeBusy}
      {backendReady}
      onInstall={installManagedRuntime}
      onStart={connectBackend}
    />

    <BookPanel
      {inspection}
      busy={sourceBusy}
      enabled={backendReady}
      onPath={inspectPath}
      onUpload={upload}
    />

    <div class="span-2">
      <SetupPanel
        enabled={!!inspection}
        {language}
        {chapters}
        {output}
        {engine}
        {target}
        {voice}
        {spacy}
        {pauseTiming}
        {engines}
        {targets}
        {voices}
        {spacyModels}
        onLanguage={languageChanged}
        onChapters={(v) => (chapters = v)}
        onOutput={(v) => (output = v)}
        onEngine={engineChanged}
        onTarget={targetChanged}
        onVoice={(v) => (voice = v)}
        onSpacy={(v) => (spacy = v)}
        onPause={(v) => (pauseTiming = v)}
      />

      <div class="convert-row">
        <button class="primary convert" disabled={!canConvert} onclick={beginConversion}>
          Create audiobook
        </button>
        <span class="muted">
          TTSForge will save its normal project cache beside the source.
        </span>
      </div>
    </div>

    <div class="span-2">
      <ProgressPanel {job} onCancel={cancelActiveJob} />
    </div>
  </main>

  <footer>
    CLI remains available: <code>ttsforge convert book.epub</code>
  </footer>
</div>

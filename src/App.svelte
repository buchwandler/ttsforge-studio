<script lang="ts">
  import { onMount } from "svelte";
  import RuntimeCard from "./components/RuntimeCard.svelte";
  import BookPanel from "./components/BookPanel.svelte";
  import SetupPanel from "./components/SetupPanel.svelte";
  import ProgressPanel from "./components/ProgressPanel.svelte";
  import JobHistory from "./components/JobHistory.svelte";
  import PreflightReview from "./components/PreflightReview.svelte";
  import {
  configureBackend,
  createJob,
  createNarration,
  createPreview,
  deleteNarration,
  ensureSpacy,
  getSystem,
  getSystemRuntime,
  importSource,
  inspectSource,
  listEngineOptions,
  listEngines,
  listSpacy,
  listSpeechProfiles,
  listTargets,
  listVoices,
  preflightConversion,
  resolveSetup,
  TtsForgeApiError,
  type RuntimeResponse,
  type SystemResponse
} from "./lib/api";
  import {
    inTauri,
    installRuntime,
    runtimeStatus,
    startBackend,
    stopBackend
  } from "./lib/runtime";
  import type {
    BackendInfo,
    BookInspection,
    EngineChoice,
    EngineOption,
    JobStatus,
    JsonValue,
    RuntimeStatus,
    SpacyModel,
    SpeechProfileChoice,
    TargetChoice,
    VoiceChoice
  } from "./lib/types";
  import {
    hasOutputConflict,
    prepareConversion,
    submitReviewedConversion,
    type ConversionReview
  } from "./lib/setup/conversion-workflow";
  import { isAbortError, LatestRequest } from "./lib/setup/latest-request";
  import { createJobTracker } from "./lib/jobs/tracker";
  import { isActiveJob } from "./lib/jobs/state";
  import {
    applyResolution,
    initialRequest,
    resetSetupField,
    setReplaceOutput,
    setSetupField,
    setupFromResolution,
    submissionFromSetup,
    type SetupState
  } from "./lib/setup/state";
  import {
    sourceInspection,
    sourcePath,
    type SelectedSource
  } from "./lib/source/state";
  import Navigation from "./components/Navigation.svelte";
  import LibraryPage from "./components/LibraryPage.svelte";
  import SettingsPage from "./components/SettingsPage.svelte";
  import DiagnosticsPage from "./components/DiagnosticsPage.svelte";
  import ActiveJobCloseDialog from "./components/ActiveJobCloseDialog.svelte";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { openPath } from "@tauri-apps/plugin-opener";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import type { AppPage } from "./lib/navigation";
  import { createLibraryStore } from "./lib/library/store";
  import { readSettings, writeSettings, type StudioSettings } from "./lib/settings";

  let runtime: RuntimeStatus | null = null;
  let runtimeBusy = false;
  let backendReady = false;
  let backendConnection: BackendInfo | null = null;
  let sourceBusy = false;
  let workflowBusy = false;
  let error = "";
  let inspection: BookInspection | null = null;
  let selectedSource: SelectedSource | null = null;
  let setup: SetupState | null = null;
  let conversionReview: ConversionReview | null = null;
  let preflightConflict = false;
  let engines: EngineChoice[] = [];
  let targets: TargetChoice[] = [];
  let voices: VoiceChoice[] = [];
  let spacyModels: SpacyModel[] = [];
  let activeJobId: string | null = null;
  let hasActiveJob = false;
  let job: JobStatus | null = null;
  const jobTracker = createJobTracker();
  const jobState = jobTracker.state;
  $: job = $jobState.job;
  $: activeJobId = job && isActiveJob(job.state)
    ? job.id
    : $jobState.history.find((item) => isActiveJob(item.state))?.id ?? null;
  $: hasActiveJob = activeJobId !== null;
  let currentPage: AppPage = "new";
  let closePrompt = false;
  let closeBusy = false;
  let allowWindowClose = false;
  let closeRequestUnlisten: (() => void) | null = null;
  let settings: StudioSettings = readSettings();
  const libraryStore = createLibraryStore();
  const libraryState = libraryStore.state;
  let systemInfo: SystemResponse | null = null;
  let backendRuntime: RuntimeResponse | null = null;
  let engineOptions: EngineOption[] = [];
  let speechProfiles: SpeechProfileChoice[] = [];
  let previewUrl = "";
  let previewBusy = false;
  let spacyInstallBusy = false;
  let diagnosticsBusy = false;
  const engineOptionRequests = new LatestRequest();
  const speechProfileRequests = new LatestRequest();
  let languageTimer: ReturnType<typeof setTimeout> | null = null;

  let language = "";
  let chapters = "";
  let output = "";
  let engine = "";
  let target = "";
  let voice = "";
  let spacy = "";
  let pauseTiming = "";

  let speechProfile = "";
  let engineOptionValues: Record<string, JsonValue> = {};
  const setupRequests = new LatestRequest();
  const targetRequests = new LatestRequest();
  const voiceRequests = new LatestRequest();
  const spacyRequests = new LatestRequest();

  $: language = stringField("language");
  $: chapters = stringField("chapters");
  $: output = stringField("output");
  $: engine = stringField("engine");
  $: target = stringField("target");
  $: voice = stringField("voice");
  $: spacy = stringField("spacy");
  $: pauseTiming = stringField("pause_timing");
  $: speechProfile = stringField("speech_profile");
  $: engineOptionValues = (setup?.request.engine_options ?? {}) as Record<string, JsonValue>;

  function stringField(name: "language" | "chapters" | "output" | "engine" | "target" | "voice" | "spacy" | "pause_timing" | "speech_profile"): string {
    const value = setup?.fields[name].value;
    return typeof value === "string" ? value : "";
  }

  onMount(() => {
    let disposed = false;
    if (inTauri()) {
      void getCurrentWindow().onCloseRequested((event) => {
        if (allowWindowClose || !hasActiveJob) return;
        event.preventDefault();
        closePrompt = true;
      }).then((unlisten) => {
        if (disposed) unlisten();
        else closeRequestUnlisten = unlisten;
      }).catch((e) => {
        if (!disposed) error = e instanceof Error ? e.message : String(e);
      });
    }

    void (async () => {
      runtime = await runtimeStatus();
      if (import.meta.env.VITE_TTSFORGE_MOCK === "1") await connectBackend();
    })();

    return () => {
      disposed = true;
      closeRequestUnlisten?.();
      closeRequestUnlisten = null;
      if (languageTimer) clearTimeout(languageTimer);
      setupRequests.cancel();
      targetRequests.cancel();
      voiceRequests.cancel();
      spacyRequests.cancel();
      engineOptionRequests.cancel();
      speechProfileRequests.cancel();
      libraryStore.clear();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      jobTracker.dispose();
      stopBackend().catch(() => undefined);
    };
  });

  async function run(action: () => Promise<void>) {
    error = "";
    try {
      await action();
    } catch (e) {
      if (!isAbortError(e)) error = e instanceof Error ? e.message : String(e);
    }
  }

  async function installManagedRuntime() {
    await run(async () => {
      runtimeBusy = true;
      backendReady = false;
      backendConnection = null;
      systemInfo = null;
      backendRuntime = null;
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
        backendConnection = info;
        const [system, runtimeDetails] = await Promise.all([getSystem(), getSystemRuntime()]);
        systemInfo = system;
        backendRuntime = runtimeDetails;
        backendReady = true;
        await jobTracker.refreshHistory();
        if (settings.libraryRoot) await libraryStore.load(settings.libraryRoot);
        if (settings.speechProfilesDirectory) await refreshSpeechProfiles();
      } finally {
        runtimeBusy = false;
      }
    });
  }

  async function applySource(source: SelectedSource) {
    selectedSource = source;
    inspection = sourceInspection(source);
    setup = null;
    conversionReview = null;
    preflightConflict = false;

    targets = [];
    voices = [];
    spacyModels = [];
    engineOptions = [];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    setupRequests.cancel();
    targetRequests.cancel();
    voiceRequests.cancel();
    spacyRequests.cancel();
    engineOptionRequests.cancel();
    speechProfileRequests.cancel();

    const ticket = setupRequests.begin();
    const submission = {
      request: initialRequest(sourcePath(source)),
      explicit_fields: []
    };
    const [availableEngines, resolution] = await Promise.all([
      listEngines(ticket.signal),
      resolveSetup(submission, ticket.signal)
    ]);
    if (!setupRequests.isCurrent(ticket.generation)) return;

    engines = availableEngines;
    inspection = resolution.inspection;
    setup = setupFromResolution(resolution);
    await Promise.all([refreshTargets(), refreshSpacy(), refreshEngineOptions()]);
  }

  async function inspectPath(path: string) {
    await run(async () => {
      sourceBusy = true;
      try {
        const value = await inspectSource(path);
        await applySource({ kind: "desktop-path", path, inspection: value });
      } finally {
        sourceBusy = false;
      }
    });
  }

  async function upload(file: File) {
    await run(async () => {
      sourceBusy = true;
      try {
        const imported = await importSource(file);
        await applySource({ kind: "upload", imported });
      } finally {
        sourceBusy = false;
      }
    });
  }

  async function resolveCurrentSetup() {
    if (!setup) return;
    const ticket = setupRequests.begin();
    const resolution = await resolveSetup(submissionFromSetup(setup), ticket.signal);
    if (!setupRequests.isCurrent(ticket.generation) || !setup) return;
    setup = applyResolution(setup, resolution);
    inspection = resolution.inspection;
  }

  async function refreshTargets() {
    const ticket = targetRequests.begin();
    targets = [];
    voices = [];
    const currentEngine = stringField("engine");
    const currentLanguage = stringField("language");
    const currentTarget = stringField("target");
    if (!currentEngine || !currentLanguage) return;

    try {
      const result = await listTargets(currentEngine, currentLanguage, ticket.signal);
      if (!targetRequests.isCurrent(ticket.generation)) return;
      targets = result;
      if (currentTarget) await refreshVoices();
    } catch (e) {
      if (!isAbortError(e)) throw e;
    }
  }

  async function refreshVoices() {
    const ticket = voiceRequests.begin();
    voices = [];
    const currentEngine = stringField("engine");
    const currentTarget = stringField("target");
    const currentLanguage = stringField("language");
    if (!currentEngine || !currentTarget || !currentLanguage) return;

    try {
      const result = await listVoices(currentEngine, currentTarget, currentLanguage, ticket.signal);
      if (voiceRequests.isCurrent(ticket.generation)) voices = result;
    } catch (e) {
      if (!isAbortError(e)) throw e;
    }
  }

  async function refreshSpacy() {
    const ticket = spacyRequests.begin();
    spacyModels = [];
    const currentLanguage = stringField("language");
    if (!currentLanguage) return;

    try {
      const result = await listSpacy(currentLanguage, ticket.signal);
      if (spacyRequests.isCurrent(ticket.generation)) spacyModels = result;
    } catch (e) {
      if (!isAbortError(e)) throw e;
    }
  }


  async function refreshEngineOptions() {
    const ticket = engineOptionRequests.begin();
    engineOptions = [];
    const currentEngine = stringField("engine");
    const currentTarget = stringField("target");
    if (!currentEngine || !currentTarget) return;
    try {
      const result = await listEngineOptions(currentEngine, currentTarget, ticket.signal);
      if (engineOptionRequests.isCurrent(ticket.generation)) engineOptions = result;
    } catch (e) {
      if (!isAbortError(e)) throw e;
    }
  }

  async function refreshSpeechProfiles() {
    const ticket = speechProfileRequests.begin();
    speechProfiles = [];
    if (!settings.speechProfilesDirectory) return;
    try {
      const result = await listSpeechProfiles(settings.speechProfilesDirectory, ticket.signal);
      if (speechProfileRequests.isCurrent(ticket.generation)) speechProfiles = result.profiles;
    } catch (e) {
      if (!isAbortError(e)) throw e;
    }
  }

  function languageChanged(value: string) {
    if (!setup) return;
    clearPreview();
    setup = resetSetupField(setSetupField(setup, "language", value), "target");
    conversionReview = null;
    setup = resetSetupField(setup, "engine_options");
    preflightConflict = false;
    setup = resetSetupField(setup, "voice");
    targets = [];
    voices = [];
    targetRequests.cancel();
    voiceRequests.cancel();
    spacyRequests.cancel();
    if (languageTimer) clearTimeout(languageTimer);
    languageTimer = setTimeout(() => {
      void run(async () => {
        await resolveCurrentSetup();
        await Promise.all([refreshTargets(), refreshSpacy(), refreshEngineOptions()]);
      });
    }, 250);
  }

  async function engineChanged(value: string) {
    clearPreview();
    if (!setup) return;
    setup = resetSetupField(setSetupField(setup, "engine", value), "target");
    setup = resetSetupField(setup, "engine_options");
    conversionReview = null;
    preflightConflict = false;
    targetRequests.cancel();
    voiceRequests.cancel();
    if (languageTimer) clearTimeout(languageTimer);
    setup = resetSetupField(setup, "voice");
    await run(async () => {
      await resolveCurrentSetup();
      await Promise.all([refreshTargets(), refreshEngineOptions()]);
    });
  }

  async function targetChanged(value: string) {
    clearPreview();
    if (!setup) return;
    setup = resetSetupField(setSetupField(setup, "target", value), "voice");
    setup = resetSetupField(setup, "engine_options");
    conversionReview = null;
    preflightConflict = false;
    voiceRequests.cancel();
    await run(async () => {
      await resolveCurrentSetup();
      await Promise.all([refreshVoices(), refreshEngineOptions()]);
    });
  }

  function outputChanged(value: string) {
    if (!setup) return;
    setup = setReplaceOutput(setSetupField(setup, "output", value || null), false);
    conversionReview = null;
    preflightConflict = false;
  }

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
  }

  function updateField<Name extends "chapters" | "voice" | "spacy" | "pause_timing">(
    name: Name,
    value: string
  ) {
    if (!setup) return;
    if (name === "voice") clearPreview();
    setup = setSetupField(setup, name, value as SetupState["request"][Name]);
    conversionReview = null;
    preflightConflict = false;
  }

  function updateSpeechProfile(value: string) {
    if (!setup) return;
    setup = setSetupField(setup, "speech_profile", value || null);
    conversionReview = null;
    preflightConflict = false;
  }

  function updateEngineOptions(value: Record<string, JsonValue>) {
    if (!setup) return;
    setup = setSetupField(setup, "engine_options", value);
    conversionReview = null;
    preflightConflict = false;
  }

  async function reviewConversion() {
    const currentSetup = setup;
    if (!currentSetup || workflowBusy) return;
    await run(async () => {
      workflowBusy = true;
      conversionReview = null;
      preflightConflict = false;
      try {
        const review = await prepareConversion(
          submissionFromSetup(currentSetup),
          resolveSetup,
          preflightConversion
        );
        setup = applyResolution(setup ?? currentSetup, review.resolution);
        conversionReview = review;
        preflightConflict = hasOutputConflict(review);
      } catch (e) {
        if (e instanceof TtsForgeApiError && e.code === "output_exists") {
          preflightConflict = true;
          return;
        }
        throw e;
      } finally {
        workflowBusy = false;
      }
    });
  }
  async function replaceExistingOutput() {
    if (!setup || workflowBusy) return;
    setup = setReplaceOutput(setup, true);
    await reviewConversion();
  }

  function chooseAnotherOutput() {
    if (setup) setup = setReplaceOutput(setup, false);
    conversionReview = null;
    preflightConflict = false;
  }

  function closeReview() {
    conversionReview = null;
    preflightConflict = false;
    if (setup) setup = setReplaceOutput(setup, false);
  }

  async function confirmConversion() {
    if (!conversionReview || workflowBusy) return;
    const review = conversionReview;
    await run(async () => {
      workflowBusy = true;
      try {
        const created = await submitReviewedConversion(review, true, createJob);
        if (!created) return;
        jobTracker.adopt(created);
        conversionReview = null;
        preflightConflict = false;
        await jobTracker.refreshHistory(created.id);
      } finally {
        workflowBusy = false;
      }
    });
  }

  function selectJobFromHistory(id: string) {
    void run(() => jobTracker.select(id));
  }

  async function cancelActiveJob() {
    await run(() => jobTracker.cancel());
  }


  function keepWindowOpen() {
    closePrompt = false;
  }

  async function minimizeToTray() {
    if (!inTauri()) return;
    await run(async () => {
      await getCurrentWindow().hide();
      closePrompt = false;
    });
  }

  async function cancelJobAndQuit() {
    if (closeBusy || !inTauri()) return;
    closeBusy = true;
    try {
      if (activeJobId) {
        try {
          if ($jobState.selectedJobId !== activeJobId) await jobTracker.select(activeJobId);
          await jobTracker.cancel();
        } catch {
          // Backend shutdown below is the fallback when the cancel request cannot reach the job.
        }
      }
      try {
        await stopBackend();
      } catch {
        // Closing the app still triggers Rust-side backend cleanup.
      }
      allowWindowClose = true;
      await getCurrentWindow().close();
    } catch (e) {
      allowWindowClose = false;
      error = e instanceof Error ? e.message : String(e);
    } finally {
      closeBusy = false;
    }
  }

  async function retryFailedJob() {
    await run(() => jobTracker.retry());
  }

  async function copyCompletedOutput() {
    const path = job?.result?.output || job?.output;
    if (!path) return;
    await run(async () => navigator.clipboard.writeText(path));
  }


  async function previewSelectedVoice() {
    const currentSetup = setup;
    const currentEngine = stringField("engine");
    const currentTarget = stringField("target");
    const currentVoice = stringField("voice");
    if (!currentSetup || !currentEngine || !currentTarget || !currentVoice) return;
    await run(async () => {
      previewBusy = true;
      let narrationId = "";
      try {
        const narration = await createNarration({
          project: currentSetup.project,
          display_name: "TTSForge voice preview",
          engine: currentEngine,
          target: currentTarget,
          voice: currentVoice,
          engine_options: currentSetup.request.engine_options ?? {},
          speed: currentSetup.request.speed ?? null
        });
        narrationId = narration.id;
        const audio = await createPreview({
          project: currentSetup.project,
          narration_id: narration.id,
          text: "This is a short preview of the selected narration voice."
        });
        clearPreview();
        previewUrl = URL.createObjectURL(audio);
      } finally {
        try {
          if (narrationId) await deleteNarration(currentSetup.project, narrationId);
        } finally {
          previewBusy = false;
        }
      }
    });
  }

  async function installSelectedSpacyModel() {
    const currentLanguage = stringField("language");
    const model = spacyModels.find((item) => item.tier === stringField("spacy"));
    if (!currentLanguage || !model) return;
    if (!["sm", "md", "lg", "trf"].includes(model.tier)) return;
    const tier = model.tier as "sm" | "md" | "lg" | "trf";
    await run(async () => {
      spacyInstallBusy = true;
      try {
        const installed = await ensureSpacy({ language: currentLanguage, tier, offline: false });
        spacyModels = [...spacyModels.filter((item) => item.tier !== installed.tier), installed];
      } finally {
        spacyInstallBusy = false;
      }
    });
  }

  function updateSettings(patch: Partial<StudioSettings>) {
    settings = { ...settings, ...patch };
    writeSettings(settings);
  }

  async function chooseDirectory(): Promise<string | null> {
    if (!inTauri()) throw new Error("Native folder selection is available in the TTSForge desktop app.");
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  }

  async function browseLibrary() {
    await run(async () => {
      const root = await chooseDirectory();
      if (!root) return;
      updateSettings({ libraryRoot: root });
      await libraryStore.load(root);
    });
  }

  async function refreshLibrary() {
    if (!backendReady || !settings.libraryRoot) return;
    await run(() => libraryStore.load(settings.libraryRoot));
  }

  async function browseOutputDirectory() {
    await run(async () => {
      const directory = await chooseDirectory();
      if (directory) updateSettings({ defaultOutputDirectory: directory });
    });
  }

  async function browseSpeechProfilesDirectory() {
    await run(async () => {
      const directory = await chooseDirectory();
      if (!directory) return;
      updateSettings({ speechProfilesDirectory: directory });
      if (backendReady) await refreshSpeechProfiles();
    });
  }

  async function pickOutputPath() {
    await run(async () => {
      if (!inTauri()) throw new Error("Native output selection is available in the TTSForge desktop app.");
      const filename = (inspection?.title || "Audiobook").replace(/[\\/]/g, "-");
      const defaultPath = settings.defaultOutputDirectory
        ? `${settings.defaultOutputDirectory}/${filename}.m4b`
        : `${filename}.m4b`;
      const path = await save({
        defaultPath,
        filters: [{ name: "Audiobook", extensions: ["m4b", "mp3", "opus"] }]
      });
      if (path) outputChanged(path);
    });
  }

  async function openOutput(path: string) {
    await run(async () => {
      if (!inTauri()) throw new Error("Opening local outputs is available in the TTSForge desktop app.");
      await openPath(path);
    });
  }

  async function selectLibraryProject(project: import("./lib/types").ProjectSummary) {
    await run(() => libraryStore.select(project.project_id));
  }

  async function saveProjectMetadata(metadata: import("./lib/types").AudiobookMetadata) {
    await run(() => libraryStore.saveMetadata(metadata));
  }

  async function saveProjectChapters(selection: string) {
    await run(() => libraryStore.saveChapters(selection));
  }

  async function runProjectQc() {
    await run(() => libraryStore.runQc());
  }

  async function refreshDiagnostics() {
    if (!backendReady) return;
    await run(async () => {
      diagnosticsBusy = true;
      try {
        const [system, runtimeDetails] = await Promise.all([getSystem(), getSystemRuntime()]);
        systemInfo = system;
        backendRuntime = runtimeDetails;
      } finally {
        diagnosticsBusy = false;
      }
    });
  }

  function navigate(page: AppPage) {
    currentPage = page;
    if (page === "library") void refreshLibrary();
    if (page === "diagnostics") void refreshDiagnostics();
    if (page === "new" && settings.speechProfilesDirectory) void run(refreshSpeechProfiles);
    if (page === "jobs") void run(() => jobTracker.refreshHistory());
  }

  $: canReview =
    backendReady &&
    !!inspection &&
    !!selectedSource &&
    !!setup &&
    !workflowBusy &&
    !sourceBusy &&
    !["queued", "preparing", "running"].includes(job?.state || "");
</script>

<svelte:head>
  <title>TTSForge | Local Audiobook Builder</title>
</svelte:head>

<div class="shell">
  <header class="hero">
    <div>
      <p class="brand">TTSForge</p>
      <p class="product-descriptor">Local Audiobook Builder</p>
      <h1>Build an audiobook locally.</h1>
      <p class="hero-copy">
        Configure TTSForge visually while keeping conversion, models and source files on this machine.
      </p>
    </div>
    <span class="mvp-badge">Desktop</span>
  </header>


  <Navigation active={currentPage} onNavigate={navigate} />

  {#if error}
    <div class="global-error" role="alert" aria-live="assertive">
      <span>{error}</span>
      <button aria-label="dismiss error" onclick={() => (error = "")}>×</button>
    </div>
  {/if}

  {#if currentPage === "new"}
  <main class="dashboard">
    <RuntimeCard
      status={runtime}
      busy={runtimeBusy}
      locked={hasActiveJob}
      canRepair={inTauri()}
      {backendReady}
      onInstall={installManagedRuntime}
      onStart={connectBackend}
    />

    <BookPanel
      {inspection}
      busy={sourceBusy}
      enabled={backendReady && !workflowBusy}
      onPath={inspectPath}
      onUpload={upload}
    />

    <div class="span-2">
      <SetupPanel
        enabled={!!setup && !workflowBusy && !sourceBusy}
        nativeFileActions={inTauri()}
        {language}
        {chapters}
        {output}
        {engine}
        {target}
        {voice}
        {spacy}
        {pauseTiming}
        {speechProfile}
        {engineOptions}
        {engineOptionValues}
        {speechProfiles}
        {previewUrl}
        {previewBusy}
        {spacyInstallBusy}
        {engines}
        {targets}
        {voices}
        {spacyModels}
        onLanguage={languageChanged}
        onChapters={(value) => updateField("chapters", value)}
        onOutput={outputChanged}
        onEngine={engineChanged}
        onTarget={targetChanged}
        onVoice={(value) => updateField("voice", value)}
        onSpacy={(value) => updateField("spacy", value)}
        onPause={(value) => updateField("pause_timing", value)}
        onSpeechProfile={updateSpeechProfile}
        onEngineOptions={updateEngineOptions}
        onPreviewVoice={previewSelectedVoice}
        onInstallSpacy={installSelectedSpacyModel}
        onPickOutput={pickOutputPath}
      />

      <div class="convert-row">
        <button class="primary convert" disabled={!canReview} onclick={reviewConversion}>
          {workflowBusy ? "Preparing review…" : "Review audiobook"}
        </button>
        <span class="muted">
          TTSForge selects project and output defaults unless you choose an output path.
        </span>
      </div>
    </div>


    {#if conversionReview || preflightConflict}
      <div class="span-2">
        <PreflightReview
          preflight={conversionReview?.preflight || null}
          conflict={preflightConflict}
          busy={workflowBusy}
          onBack={closeReview}
          onChooseOutput={chooseAnotherOutput}
          onReplaceOutput={replaceExistingOutput}
          onConfirm={confirmConversion}
        />
      </div>
    {/if}

    <div class="span-2">
      <JobHistory jobs={$jobState.history} selectedId={$jobState.selectedJobId} busy={$jobState.actionBusy} onSelect={selectJobFromHistory} />
    </div>

    <div class="span-2">
      <ProgressPanel
        {job}
        events={$jobState.events}
        historyTruncated={$jobState.historyTruncated}
        reconnecting={$jobState.reconnecting}
        cancelling={$jobState.cancelling}
        actionBusy={$jobState.actionBusy || workflowBusy}
        trackingMessage={$jobState.trackingMessage}
        trackingError={$jobState.trackingError}
        onCancel={cancelActiveJob}
        onRetry={retryFailedJob}
        onCopyOutput={copyCompletedOutput}
        onOpenOutput={openOutput}
        canOpenOutput={inTauri()}
      />
    </div>
  </main>

  {:else if currentPage === "library"}
    <LibraryPage
      root={$libraryState.root || settings.libraryRoot}
      nativeFileActions={inTauri()}
      projects={$libraryState.projects}
      selectedProject={$libraryState.selectedProject}
      chapters={$libraryState.chapters}
      metadata={$libraryState.metadata}
      qc={$libraryState.qc}
      busy={$libraryState.busy}
      onRoot={(value) => updateSettings({ libraryRoot: value })}
      onBrowseRoot={browseLibrary}
      onRefresh={refreshLibrary}
      onSelectProject={selectLibraryProject}
      onSaveMetadata={saveProjectMetadata}
      onSaveChapters={saveProjectChapters}
      onRunQc={runProjectQc}
      onOpenOutput={openOutput}
    />
  {:else if currentPage === "settings"}
    <SettingsPage
      nativeFileActions={inTauri()}
      libraryRoot={settings.libraryRoot}
      defaultOutputDirectory={settings.defaultOutputDirectory}
      speechProfilesDirectory={settings.speechProfilesDirectory}
      onLibraryRoot={(value) => updateSettings({ libraryRoot: value })}
      onDefaultOutputDirectory={(value) => updateSettings({ defaultOutputDirectory: value })}
      onSpeechProfilesDirectory={(value) => updateSettings({ speechProfilesDirectory: value })}
      onBrowseLibrary={browseLibrary}
      onBrowseOutput={browseOutputDirectory}
      onBrowseSpeechProfiles={browseSpeechProfilesDirectory}
    />
  {:else if currentPage === "diagnostics"}
    <DiagnosticsPage
      backend={backendConnection}
      system={systemInfo}
      runtime={backendRuntime}
      busy={diagnosticsBusy}
      onRefresh={refreshDiagnostics}
    />
  {:else if currentPage === "runtime"}
    <main class="dashboard">
      <RuntimeCard status={runtime} busy={runtimeBusy} locked={hasActiveJob} canRepair={inTauri()} {backendReady} onInstall={installManagedRuntime} onStart={connectBackend} />
    </main>
  {:else if currentPage === "jobs"}
    <main class="dashboard">
      <div class="span-2">
        <JobHistory jobs={$jobState.history} selectedId={$jobState.selectedJobId} busy={$jobState.actionBusy} onSelect={selectJobFromHistory} />
      </div>
      <div class="span-2">
        <ProgressPanel
          {job}
          events={$jobState.events}
          historyTruncated={$jobState.historyTruncated}
          reconnecting={$jobState.reconnecting}
          cancelling={$jobState.cancelling}
          actionBusy={$jobState.actionBusy || workflowBusy}
          trackingMessage={$jobState.trackingMessage}
          trackingError={$jobState.trackingError}
          onCancel={cancelActiveJob}
          onRetry={retryFailedJob}
          onCopyOutput={copyCompletedOutput}
          onOpenOutput={openOutput}
          canOpenOutput={inTauri()}
        />
      </div>
    </main>
  {/if}

  <ActiveJobCloseDialog
    open={closePrompt}
    busy={closeBusy}
    onContinue={minimizeToTray}
    onCancelAndQuit={cancelJobAndQuit}
    onKeepOpen={keepWindowOpen}
  />

  <footer>
    CLI remains available: <code>ttsforge convert book.epub</code>
  </footer>
</div>

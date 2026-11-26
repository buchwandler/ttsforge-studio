<script lang="ts">
  import type { EngineChoice, EngineOption, JsonValue, SpacyModel, SpeechProfileChoice, TargetChoice, VoiceChoice } from "../lib/types";

  export let enabled = false;
  export let nativeFileActions = false;
  export let language = "en-US";
  export let chapters = "all";
  export let output = "";
  export let engine = "";
  export let target = "";
  export let voice = "";
  export let spacy = "lg";
  export let pauseTiming = "engaging";
  export let speechProfile = "";
  export let engines: EngineChoice[] = [];
  export let targets: TargetChoice[] = [];
  export let voices: VoiceChoice[] = [];
  export let spacyModels: SpacyModel[] = [];
  export let engineOptions: EngineOption[] = [];
  export let engineOptionValues: Record<string, JsonValue> = {};
  export let speechProfiles: SpeechProfileChoice[] = [];
  export let previewUrl = "";
  export let previewBusy = false;
  export let spacyInstallBusy = false;

  export let onLanguage: (value: string) => void;
  export let onChapters: (value: string) => void;
  export let onOutput: (value: string) => void;
  export let onPickOutput: () => void;
  export let onEngine: (value: string) => void;
  export let onTarget: (value: string) => void;
  export let onVoice: (value: string) => void;
  export let onPreviewVoice: () => void;
  export let onSpacy: (value: string) => void;
  export let onInstallSpacy: () => void;
  export let onPause: (value: string) => void;
  export let onSpeechProfile: (value: string) => void;
  export let onEngineOptions: (value: Record<string, JsonValue>) => void;

  export let onManageEngines: () => void = () => {};
  $: selectedModel = spacyModels.find((item) => item.tier === spacy);

  function optionValue(option: EngineOption): JsonValue {
    return (engineOptionValues[option.name] ?? option.default) as JsonValue;
  }

  function updateOption(option: EngineOption, value: string): void {
    let parsed: JsonValue = value;
    if (option.value_type === "boolean") parsed = value === "true";
    else if (option.value_type === "number" || option.value_type === "integer") parsed = value === "" ? null : Number(value);
    else if (option.choices.length) {
      try { parsed = JSON.parse(value) as JsonValue; } catch { parsed = value; }
    }
    onEngineOptions({ ...engineOptionValues, [option.name]: parsed });
  }
</script>

<section class="card">
  <div class="card-title-row">
    <div>
      <p class="eyebrow">Configuration</p>
      <h2>Narration</h2>
    </div>
  </div>

  <div class="form-grid">
    <label>
      <span>Language</span>
      <input value={language} disabled={!enabled} oninput={(event) => onLanguage(event.currentTarget.value)} />
    </label>

    <label>
      <span>Chapters</span>
      <input value={chapters} disabled={!enabled} placeholder="all or 5-17" oninput={(event) => onChapters(event.currentTarget.value)} />
    </label>

    <label>
      <span>Engine</span>
      <select value={engine} disabled={!enabled} onchange={(event) => onEngine(event.currentTarget.value)}>
        <option value="">Select engine</option>
        {#each engines as item (item.id)}
          <option value={item.id} disabled={!item.runnable} title={item.reason || undefined}>
            {item.id}{item.installed ? "" : " (not installed)"}
          </option>
        {/each}
      </select>
    </label>

    {#if engines.some((item) => !item.installed || !item.runnable)}
      <div class="engine-management">
        <p class="muted">Some engine integrations are missing or unavailable.</p>
        <button class="secondary" type="button" onclick={onManageEngines}>Manage engines</button>
      </div>
    {/if}
    <label>
      <span>Target</span>
      <select value={target} disabled={!enabled || !engine} onchange={(event) => onTarget(event.currentTarget.value)}>
        <option value="">Select target</option>
        {#each targets as item (item.id)}
          <option value={item.id} disabled={!item.runtime_available || item.reference_only}>
            {item.id} · {item.status}
          </option>
        {/each}
      </select>
    </label>

    <label>
      <span>Voice</span>
      <select value={voice} disabled={!enabled || !target} onchange={(event) => onVoice(event.currentTarget.value)}>
        <option value="">Default voice</option>
        {#each voices as item (item.id)}
          <option value={item.id} disabled={!item.runtime_available}>
            {item.language_label || item.locale || item.language || item.id}{item.default ? " · default" : ""}
          </option>
        {/each}
      </select>
      {#if voices.length}
        <button class="secondary" type="button" disabled={!enabled || !voice || previewBusy} onclick={onPreviewVoice}>
          {previewBusy ? "Preparing preview…" : "Preview voice"}
        </button>
      {/if}
    </label>

    <label>
      <span>spaCy model</span>
      <select value={spacy} disabled={!enabled} onchange={(event) => onSpacy(event.currentTarget.value)}>
        <option value="off">off</option>
        <option value="auto">auto</option>
        {#each spacyModels as item (item.tier)}
          <option value={item.tier}>{item.tier} · {item.model}{item.installed ? " · installed" : " · missing"}</option>
        {/each}
      </select>
      {#if selectedModel && !selectedModel.installed}
        <span class="muted">{selectedModel.model} is not installed.</span>
        <button class="secondary" type="button" disabled={!enabled || spacyInstallBusy} onclick={onInstallSpacy}>
          {spacyInstallBusy ? "Installing model…" : "Install model"}
        </button>
      {/if}
    </label>

    <label>
      <span>Speech profile</span>
      <select value={speechProfile} disabled={!enabled} onchange={(event) => onSpeechProfile(event.currentTarget.value)}>
        <option value="">No profile</option>
        {#each speechProfiles as item (item.path)}
          <option value={item.path}>{item.name}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Pause timing</span>
      <select value={pauseTiming} disabled={!enabled} onchange={(event) => onPause(event.currentTarget.value)}>
        <option value="fixed">fixed</option>
        <option value="natural">natural</option>
        <option value="engaging">engaging</option>
      </select>
    </label>
  </div>

  {#if previewUrl}
    <div class="preview-player" aria-live="polite">
      <span class="muted">Voice preview</span>
      <audio controls src={previewUrl} aria-label="Voice preview audio"></audio>
    </div>
  {/if}

  {#if engineOptions.length}
    <details class="engine-options">
      <summary>Engine options ({engineOptions.length})</summary>
      <div class="form-grid">
        {#each engineOptions as option (option.name)}
          <label>
            <span>{option.name}{option.required ? " *" : ""}</span>
            {#if option.choices.length}
              <select value={JSON.stringify(optionValue(option))} disabled={!enabled} onchange={(event) => updateOption(option, event.currentTarget.value)}>
                {#each option.choices as choice (JSON.stringify(choice))}
                  <option value={JSON.stringify(choice)}>{String(choice)}</option>
                {/each}
              </select>
            {:else if option.value_type === "boolean"}
              <input type="checkbox" checked={Boolean(optionValue(option))} disabled={!enabled} onchange={(event) => updateOption(option, String(event.currentTarget.checked))} />
            {:else if option.value_type === "number" || option.value_type === "integer"}
              <input type="number" value={String(optionValue(option) ?? "")} min={option.minimum ?? undefined} max={option.maximum ?? undefined} disabled={!enabled} onchange={(event) => updateOption(option, event.currentTarget.value)} />
            {:else}
              <input value={String(optionValue(option) ?? "")} disabled={!enabled} onchange={(event) => updateOption(option, event.currentTarget.value)} />
            {/if}
            <small class="muted">{option.description}</small>
          </label>
        {/each}
      </div>
    </details>
  {/if}

  <details class="output-settings">
    <summary>Output location</summary>
    <div class="output-picker">
      <button class="secondary" type="button" disabled={!enabled || !nativeFileActions} onclick={onPickOutput}>Save audiobook as…</button>
      <span class="muted">{output || "Use the backend-selected output"}</span>
    </div>
    <label class="advanced-path">
      <span>Advanced output path</span>
      <input value={output} disabled={!enabled} placeholder="Backend default" oninput={(event) => onOutput(event.currentTarget.value)} />
    </label>
  </details>
</section>

<style>
  .engine-management { margin-top: 10px; }
  .engine-management p { margin: 0 0 6px; }
  .engine-options, .output-settings { margin-top: 1rem; }
  summary { cursor: pointer; font-weight: 650; }
  .preview-player { display: grid; gap: 0.4rem; margin-top: 1rem; }
  .preview-player audio { width: 100%; }
  .output-picker { display: flex; align-items: center; gap: 0.75rem; margin: 0.7rem 0; }
  .advanced-path { display: grid; gap: 0.35rem; color: #929aac; }
</style>

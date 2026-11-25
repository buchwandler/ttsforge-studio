<script lang="ts">
  import type {
    EngineChoice,
    SpacyModel,
    TargetChoice,
    VoiceChoice
  } from "../lib/types";

  export let enabled = false;
  export let language = "en-US";
  export let chapters = "all";
  export let output = "";
  export let engine = "";
  export let target = "";
  export let voice = "";
  export let spacy = "lg";
  export let pauseTiming = "engaging";
  export let engines: EngineChoice[] = [];
  export let targets: TargetChoice[] = [];
  export let voices: VoiceChoice[] = [];
  export let spacyModels: SpacyModel[] = [];

  export let onLanguage: (value: string) => void;
  export let onChapters: (value: string) => void;
  export let onOutput: (value: string) => void;
  export let onEngine: (value: string) => void;
  export let onTarget: (value: string) => void;
  export let onVoice: (value: string) => void;
  export let onSpacy: (value: string) => void;
  export let onPause: (value: string) => void;
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
      <input
        value={language}
        disabled={!enabled}
        oninput={(e) => onLanguage(e.currentTarget.value)}
      />
    </label>

    <label>
      <span>Chapters</span>
      <input
        value={chapters}
        disabled={!enabled}
        placeholder="all or 5-17"
        oninput={(e) => onChapters(e.currentTarget.value)}
      />
    </label>

    <label class="full">
      <span>Output</span>
      <input
        value={output}
        disabled={!enabled}
        placeholder="/path/to/book.m4b"
        oninput={(e) => onOutput(e.currentTarget.value)}
      />
    </label>

    <label>
      <span>Engine</span>
      <select
        value={engine}
        disabled={!enabled}
        onchange={(e) => onEngine(e.currentTarget.value)}
      >
        <option value="">Select engine</option>
        {#each engines as item}
          <option value={item.id} disabled={!item.runnable}>
            {item.id}{item.installed ? "" : " (not installed)"}
          </option>
        {/each}
      </select>
    </label>

    <label>
      <span>Target</span>
      <select
        value={target}
        disabled={!enabled || !engine}
        onchange={(e) => onTarget(e.currentTarget.value)}
      >
        <option value="">Select target</option>
        {#each targets as item}
          <option value={item.id} disabled={!item.runtime_available || item.reference_only}>
            {item.id}
          </option>
        {/each}
      </select>
    </label>

    <label>
      <span>Voice</span>
      <select
        value={voice}
        disabled={!enabled || !target}
        onchange={(e) => onVoice(e.currentTarget.value)}
      >
        <option value="">Default voice</option>
        {#each voices as item}
          <option value={item.id} disabled={!item.runtime_available}>
            {item.id}{item.default ? " · default" : ""}
          </option>
        {/each}
      </select>
    </label>

    <label>
      <span>spaCy</span>
      <select
        value={spacy}
        disabled={!enabled}
        onchange={(e) => onSpacy(e.currentTarget.value)}
      >
        <option value="off">off</option>
        <option value="auto">auto</option>
        {#each spacyModels as item}
          <option value={item.tier}>
            {item.tier} · {item.model}{item.installed ? " · installed" : ""}
          </option>
        {/each}
      </select>
    </label>

    <label>
      <span>Pause timing</span>
      <select
        value={pauseTiming}
        disabled={!enabled}
        onchange={(e) => onPause(e.currentTarget.value)}
      >
        <option value="fixed">fixed</option>
        <option value="natural">natural</option>
        <option value="engaging">engaging</option>
      </select>
    </label>
  </div>
</section>

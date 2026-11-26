<script lang="ts">
  export let libraryRoot = "";
  export let nativeFileActions = false;
  export let defaultOutputDirectory = "";
  export let speechProfilesDirectory = "";
  export let onLibraryRoot: (value: string) => void;
  export let onDefaultOutputDirectory: (value: string) => void;
  export let onBrowseLibrary: () => void;
  export let onBrowseOutput: () => void;
  export let onBrowseSpeechProfiles: () => void;
  export let onSpeechProfilesDirectory: (value: string) => void;
</script>

<section class="card" aria-labelledby="settings-title">
  <p class="eyebrow">Preferences</p>
  <h2 id="settings-title">Settings</h2>
  <div class="settings-grid">
    <label>
      <span>Library folder</span>
      <div class="field-row">
        <input value={libraryRoot} placeholder="Choose a TTSForge project folder" oninput={(event) => onLibraryRoot(event.currentTarget.value)} />
        <button class="secondary" type="button" disabled={!nativeFileActions} onclick={onBrowseLibrary}>Choose folder</button>
      </div>
    </label>
    <label>
      <span>Default output folder</span>
      <div class="field-row">
        <input value={defaultOutputDirectory} placeholder="Use the backend default" oninput={(event) => onDefaultOutputDirectory(event.currentTarget.value)} />
        <button class="secondary" type="button" disabled={!nativeFileActions} onclick={onBrowseOutput}>Choose folder</button>
      </div>
    </label>
    <label>
      <span>Speech profiles folder</span>
      <div class="field-row">
        <input value={speechProfilesDirectory} placeholder="Optional folder containing speech profiles" oninput={(event) => onSpeechProfilesDirectory(event.currentTarget.value)} />
        <button class="secondary" type="button" disabled={!nativeFileActions} onclick={onBrowseSpeechProfiles}>Choose folder</button>
      </div>
    </label>
  </div>
  <p class="muted">The TTSForge backend remains the source of truth for project and output defaults. These preferences only prefill folder selection.</p>
</section>


<style>
  .settings-grid { display: grid; gap: 1rem; max-width: 54rem; }
  .settings-grid label { display: grid; gap: 0.4rem; color: #b7bfce; }
  .field-row { display: flex; gap: 0.5rem; }
  .field-row input { min-width: 0; flex: 1; }
  @media (max-width: 600px) {
    .field-row { flex-direction: column; }
  }
</style>

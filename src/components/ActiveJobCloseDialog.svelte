<script lang="ts">
  export let open = false;
  export let busy = false;
  export let onContinue: () => void;
  export let onCancelAndQuit: () => void;
  export let onKeepOpen: () => void;

  let dialog: HTMLDialogElement;

  $: if (dialog) {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }
</script>

<dialog bind:this={dialog} aria-labelledby="active-job-close-title" aria-describedby="active-job-close-description" oncancel={(event) => { event.preventDefault(); onKeepOpen(); }}>
  <section class="close-card">
    <p class="eyebrow">Audiobook job in progress</p>
    <h2 id="active-job-close-title">Keep TTSForge running?</h2>
    <p id="active-job-close-description">You can hide TTSForge in the system tray and let the job continue, or cancel the job and quit.</p>
    <div class="close-actions">
      <button class="primary" type="button" disabled={busy} onclick={onContinue}>Minimize to system tray and continue</button>
      <button class="danger" type="button" disabled={busy} onclick={onCancelAndQuit}>{busy ? "Cancelling job and quitting…" : "Cancel job and quit"}</button>
      <button class="secondary" type="button" disabled={busy} onclick={onKeepOpen}>Keep TTSForge open</button>
    </div>
  </section>
</dialog>

<style>
  dialog { width: min(34rem, calc(100% - 2rem)); border: 1px solid #59657d; border-radius: 18px; padding: 0; color: #e8ecf4; background: #121722; }
  dialog::backdrop { background: rgba(4, 7, 12, 0.78); }
  .close-card { padding: 1.5rem; }
  .close-card h2 { margin: 0 0 0.75rem; }
  .close-card p:not(.eyebrow) { color: #b7bfce; line-height: 1.55; }
  .close-actions { display: grid; gap: 0.65rem; margin-top: 1.25rem; }
  .close-actions button { width: 100%; }
</style>

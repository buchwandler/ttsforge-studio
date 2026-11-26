<script lang="ts">
  import type { AppPage } from "../lib/navigation";

  export let active: AppPage = "library";
  export let onNavigate: (page: AppPage) => void;

  const pages: { id: AppPage; label: string }[] = [
    { id: "library", label: "Library" },
    { id: "new", label: "New audiobook" },
    { id: "jobs", label: "Jobs" },
    { id: "runtime", label: "Runtime & models" },
    { id: "settings", label: "Settings" },
    { id: "diagnostics", label: "Diagnostics" }
  ];
</script>

<nav aria-label="Main navigation">
  {#each pages as page (page.id)}
    <button
      type="button"
      class:active={active === page.id}
      aria-current={active === page.id ? "page" : undefined}
      onclick={() => onNavigate(page.id)}
    >
      {page.label}
    </button>
  {/each}
</nav>

<style>
  nav { display: flex; flex-wrap: wrap; gap: 0.45rem; margin: 1rem 0 1.4rem; }
  nav button { border: 1px solid transparent; background: transparent; color: #b7bfce; }
  nav button.active { border-color: #59657d; background: #1a202c; color: #fff; }
  nav button:focus-visible { outline: 2px solid var(--focus, #b8c7ff); outline-offset: 2px; }
</style>

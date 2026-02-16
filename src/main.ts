import "./styles.css";
import { initStore, getCategories, getAllMaterialsCount, getMaterialCountByCategory } from "./store";
import { initModalBackdrop, closeModal, esc } from "./ui";
import { initMaterialy, setFilterView, setFilterCategory, setSearch, onSidebarUpdate as onMatSidebarUpdate } from "./materialy";
import { initKategorie, refreshKategorie, onSidebarUpdate as onCatSidebarUpdate } from "./kategorie";
import { initRobocizny, setLaborSearch } from "./robocizny";
import { initZlecenia } from "./zlecenia";
import { initDashboard, onDashboardNavigate } from "./dashboard";
import { initUstawienia } from "./ustawienia";
import { initMojaFirma } from "./mojafirma";
import { shouldShowWizard, initWizard } from "./wizard";

// ─── State ───────────────────────────────────────────────────────
let currentPage = "dashboard";

// ─── Navigation ──────────────────────────────────────────────────
function navigateTo(page: string): void {
  currentPage = page;

  // Toggle page visibility
  document.querySelectorAll<HTMLElement>(".page").forEach((p) => p.classList.add("hidden"));
  document.getElementById(`page-${page}`)?.classList.remove("hidden");

  // Update sidebar active
  document.querySelectorAll<HTMLElement>(".sidebar-nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === page);
  });

  // Clear sidebar category selection when switching pages
  document.querySelectorAll<HTMLElement>(".sidebar-cat-item").forEach((item) => {
    item.classList.remove("active");
  });

  // Init the page module
  if (page === "dashboard") initDashboard();
  if (page === "materialy") {
    setFilterView("all");
    initMaterialy();
  }
  if (page === "robocizny") initRobocizny();
  if (page === "zlecenia") initZlecenia();
  if (page === "mojafirma") initMojaFirma();
  if (page === "kategorie") initKategorie();
  if (page === "ustawienia") initUstawienia();
}

// ─── Sidebar rendering ──────────────────────────────────────────
function renderSidebar(): void {
  const categories = getCategories();
  const counts = getAllMaterialsCount();

  // Update nav counts - just update the stats footer
  document.getElementById("sidebar-stats")!.textContent = `${counts.total} materiałów`;

  // Render category filters
  const container = document.getElementById("sidebar-categories")!;

  // "All / Favorites / Archive" quick filters
  const viewFilters = `
    <button class="sidebar-cat-item active" data-view="all">
      <i class="fa-solid fa-layer-group" style="font-size:11px;width:14px;text-align:center;color:var(--text-muted)"></i>
      Wszystkie
      <span class="sidebar-cat-count">${counts.total}</span>
    </button>
    <button class="sidebar-cat-item" data-view="favorites">
      <i class="fa-solid fa-star" style="font-size:11px;width:14px;text-align:center;color:var(--warning)"></i>
      Ulubione
      <span class="sidebar-cat-count">${counts.favorites}</span>
    </button>
    <button class="sidebar-cat-item" data-view="archived">
      <i class="fa-solid fa-box-archive" style="font-size:11px;width:14px;text-align:center;color:var(--text-muted)"></i>
      Archiwum
      <span class="sidebar-cat-count">${counts.archived}</span>
    </button>
    <div style="height:6px"></div>
  `;

  const catItems = categories
    .map((cat) => {
      const count = getMaterialCountByCategory(cat.id);
      return `
      <button class="sidebar-cat-item" data-sidebar-cat="${cat.id}">
        <span class="sidebar-cat-dot" style="background:${cat.color}"></span>
        ${esc(cat.name)}
        <span class="sidebar-cat-count">${count}</span>
      </button>
    `;
    })
    .join("");

  container.innerHTML = viewFilters + catItems;

  // Bind view filters
  container.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (currentPage !== "materialy") navigateTo("materialy");

      // Active state
      container.querySelectorAll<HTMLElement>(".sidebar-cat-item").forEach((el) => el.classList.remove("active"));
      btn.classList.add("active");

      setFilterView(btn.dataset.view as "all" | "favorites" | "archived");
    });
  });

  // Bind category filters
  container.querySelectorAll<HTMLButtonElement>("[data-sidebar-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (currentPage !== "materialy") navigateTo("materialy");

      // Active state
      container.querySelectorAll<HTMLElement>(".sidebar-cat-item").forEach((el) => el.classList.remove("active"));
      btn.classList.add("active");

      setFilterCategory(parseInt(btn.dataset.sidebarCat!));
    });
  });
}

// ─── Search ──────────────────────────────────────────────────────
function initSearch(): void {
  const input = document.getElementById("global-search") as HTMLInputElement;
  let timeout: ReturnType<typeof setTimeout>;

  input.addEventListener("input", () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (currentPage === "robocizny") {
        setLaborSearch(input.value.trim());
      } else {
        if (currentPage !== "materialy") navigateTo("materialy");
        setSearch(input.value.trim());
      }
    }, 200);
  });
}

// ─── Keyboard shortcuts ─────────────────────────────────────────
// ─── Sidebar toggle ──────────────────────────────────────────────
const SIDEBAR_KEY = "pp_sidebar_collapsed";
const THEME_KEY = "pp_theme";

function initSidebarToggle(): void {
  const app = document.querySelector(".app")!;
  const btn = document.getElementById("btn-sidebar-toggle")!;

  if (localStorage.getItem(SIDEBAR_KEY) === "1") {
    app.classList.add("sidebar-collapsed");
  }

  btn.addEventListener("click", () => {
    app.classList.toggle("sidebar-collapsed");
    const collapsed = app.classList.contains("sidebar-collapsed");
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  });
}

function initThemeToggle(): void {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(saved);

  document.getElementById("btn-theme-toggle")!.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  });
}

function applyTheme(theme: string): void {
  document.documentElement.setAttribute("data-theme", theme);
  const icon = document.querySelector("#btn-theme-toggle i");
  if (icon) {
    icon.className = theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
  }
}

function initKeyboard(): void {
  document.addEventListener("keydown", (e) => {
    // Esc closes modal
    if (e.key === "Escape") closeModal();

    // Ctrl+K → focus search
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      (document.getElementById("global-search") as HTMLInputElement).focus();
    }

    // Ctrl+N → add material (when on materialy page)
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault();
      if (currentPage === "materialy") {
        document.getElementById("btn-add-material")?.click();
      }
    }
  });
}

// ─── Init ────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initStore();
  initModalBackdrop();
  initSearch();
  initKeyboard();
  initSidebarToggle();
  initThemeToggle();

  // Sidebar nav buttons
  document.querySelectorAll<HTMLButtonElement>(".sidebar-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.page!));
  });

  // Wire sidebar update callbacks
  const updateSidebar = () => renderSidebar();
  onMatSidebarUpdate(updateSidebar);
  onCatSidebarUpdate(() => {
    renderSidebar();
  });

  // Wire dashboard navigation
  onDashboardNavigate(
    (page: string) => navigateTo(page),
    (zlecenieId: number) => {
      navigateTo("zlecenia");
      // Small delay so zlecenia page initializes first, then we open the detail
      setTimeout(() => {
        const event = new CustomEvent("open-zlecenie", { detail: zlecenieId });
        window.dispatchEvent(event);
      }, 50);
    }
  );

  // Initial render
  renderSidebar();
  navigateTo("dashboard");

  // Show wizard on first run
  if (shouldShowWizard()) {
    initWizard(() => {
      renderSidebar();
      navigateTo("dashboard");
    });
  }
});

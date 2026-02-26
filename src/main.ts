import "./styles.css";
import { initStore, getCategories, getAllMaterialsCount, getMaterialCountByCategory, getZlecenia, getMaterials, getLabor, getClients, popUndo, getGlobalNotes, saveGlobalNotes, exportDatabase } from "./store";
import { initModalBackdrop, closeModal, esc, openModal, showToast } from "./ui";
import { initMaterialy, setFilterView, setFilterCategory, setSearch, onSidebarUpdate as onMatSidebarUpdate } from "./materialy";
import { initKategorie, refreshKategorie, onSidebarUpdate as onCatSidebarUpdate } from "./kategorie";
import { initRobocizny, setLaborSearch } from "./robocizny";
import { initZlecenia } from "./zlecenia";
import { initDashboard, onDashboardNavigate } from "./dashboard";
import { initUstawienia } from "./ustawienia";
import { initMojaFirma } from "./mojafirma";
import { shouldShowWizard, initWizard } from "./wizard";
import { initAIAssistant, setAINavigateCallback, toggleAISidebar } from "./ai-assistant";
import { initContextAISidebar } from "./ai-sidebar";
import { checkForUpdates } from "./updater";
import { openSmartExcelImport } from "./excel-ai-import";
// Trade mode imports
import { getAppMode, setAppMode, seedTradeDefaults, getAllProductsCount, getOffers, getProducts } from "./store-trade";
import { initProducts, setProductFilterView, setProductFilterCategory, setProductSearch, onProductSidebarUpdate } from "./products";
import { initOffers } from "./offers";
import { initKlienci, onKlienciNavigate } from "./klienci";
import type { AppMode } from "./types";

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

  // Breadcrumbs
  const breadcrumbEl = document.getElementById("topbar-breadcrumb");
  if (breadcrumbEl) {
    const pageNames: Record<string, string> = {
      dashboard: "Dashboard", materialy: "Materiały", robocizny: "Robocizny",
      zlecenia: "Zlecenia", klienci: "Klienci", mojafirma: "Moja Firma",
      kategorie: "Kategorie", ustawienia: "Ustawienia", products: "Produkty", offers: "Oferty",
    };
    const name = pageNames[page] || page;
    breadcrumbEl.innerHTML = page === "dashboard" ? "" :
      `<span class="breadcrumb-link" data-bc-page="dashboard">Dashboard</span> <i class="fa-solid fa-chevron-right" style="font-size:8px;margin:0 6px;opacity:0.4"></i> <span class="breadcrumb-current">${name}</span>`;
    breadcrumbEl.querySelector("[data-bc-page]")?.addEventListener("click", () => navigateTo("dashboard"));
  }

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
  // Trade mode pages
  if (page === "products") {
    setProductFilterView("all");
    initProducts();
  }
  if (page === "offers") initOffers();
  if (page === "klienci") initKlienci();
}

// ─── Sidebar nav rendering (mode-aware) ─────────────────────────
function renderSidebarNav(): void {
  const mode = getAppMode();
  const nav = document.querySelector(".sidebar-nav")!;

  if (mode === "handlowy") {
    nav.innerHTML = `
      <div class="sidebar-section-label">Menu</div>
      <button class="sidebar-nav-item active" data-page="dashboard">
        <i class="fa-solid fa-chart-pie"></i>
        Dashboard
      </button>
      <button class="sidebar-nav-item" data-page="products">
        <i class="fa-solid fa-cube"></i>
        Moje Produkty
      </button>
      <button class="sidebar-nav-item" data-page="offers">
        <i class="fa-solid fa-gavel"></i>
        Oferty
      </button>
      <button class="sidebar-nav-item" data-page="klienci">
        <i class="fa-solid fa-address-book"></i>
        Klienci
      </button>
      <button class="sidebar-nav-item" data-page="mojafirma">
        <i class="fa-solid fa-briefcase"></i>
        Moja Firma
      </button>
      <button class="sidebar-nav-item" data-page="kategorie">
        <i class="fa-solid fa-tags"></i>
        Kategorie
      </button>
      <button class="sidebar-nav-item" data-page="ustawienia">
        <i class="fa-solid fa-gear"></i>
        Ustawienia
      </button>
    `;
  } else {
    nav.innerHTML = `
      <div class="sidebar-section-label">Menu</div>
      <button class="sidebar-nav-item active" data-page="dashboard">
        <i class="fa-solid fa-chart-pie"></i>
        Dashboard
      </button>
      <button class="sidebar-nav-item" data-page="materialy">
        <i class="fa-solid fa-boxes-stacked"></i>
        Materiały
      </button>
      <button class="sidebar-nav-item" data-page="robocizny">
        <i class="fa-solid fa-helmet-safety"></i>
        Robocizny
      </button>
      <button class="sidebar-nav-item" data-page="zlecenia">
        <i class="fa-solid fa-file-invoice-dollar"></i>
        Zlecenia
      </button>
      <button class="sidebar-nav-item" data-page="klienci">
        <i class="fa-solid fa-address-book"></i>
        Klienci
      </button>
      <button class="sidebar-nav-item" data-page="mojafirma">
        <i class="fa-solid fa-briefcase"></i>
        Moja Firma
      </button>
      <button class="sidebar-nav-item" data-page="kategorie">
        <i class="fa-solid fa-tags"></i>
        Kategorie
      </button>
      <button class="sidebar-nav-item" data-page="ustawienia">
        <i class="fa-solid fa-gear"></i>
        Ustawienia
      </button>
    `;
  }

  // Re-bind nav buttons
  nav.querySelectorAll<HTMLButtonElement>(".sidebar-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.page!));
  });
}

// ─── Sidebar category/filter rendering ──────────────────────────
function renderSidebar(): void {
  const mode = getAppMode();

  if (mode === "handlowy") {
    renderSidebarTrade();
  } else {
    renderSidebarService();
  }
}

function renderSidebarService(): void {
  const categories = getCategories();
  const counts = getAllMaterialsCount();

  document.getElementById("sidebar-stats")!.textContent = `${counts.total} materiałów`;

  const container = document.getElementById("sidebar-categories")!;

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
      container.querySelectorAll<HTMLElement>(".sidebar-cat-item").forEach((el) => el.classList.remove("active"));
      btn.classList.add("active");
      setFilterView(btn.dataset.view as "all" | "favorites" | "archived");
    });
  });

  // Bind category filters
  container.querySelectorAll<HTMLButtonElement>("[data-sidebar-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (currentPage !== "materialy") navigateTo("materialy");
      container.querySelectorAll<HTMLElement>(".sidebar-cat-item").forEach((el) => el.classList.remove("active"));
      btn.classList.add("active");
      setFilterCategory(parseInt(btn.dataset.sidebarCat!));
    });
  });
}

function renderSidebarTrade(): void {
  const counts = getAllProductsCount();

  document.getElementById("sidebar-stats")!.textContent = `${counts.total} produktów`;

  const container = document.getElementById("sidebar-categories")!;

  const viewFilters = `
    <button class="sidebar-cat-item active" data-pview="all">
      <i class="fa-solid fa-layer-group" style="font-size:11px;width:14px;text-align:center;color:var(--text-muted)"></i>
      Wszystkie
      <span class="sidebar-cat-count">${counts.total}</span>
    </button>
    <button class="sidebar-cat-item" data-pview="favorites">
      <i class="fa-solid fa-star" style="font-size:11px;width:14px;text-align:center;color:var(--warning)"></i>
      Ulubione
      <span class="sidebar-cat-count">${counts.favorites}</span>
    </button>
    <button class="sidebar-cat-item" data-pview="archived">
      <i class="fa-solid fa-box-archive" style="font-size:11px;width:14px;text-align:center;color:var(--text-muted)"></i>
      Archiwum
      <span class="sidebar-cat-count">${counts.archived}</span>
    </button>
  `;

  container.innerHTML = viewFilters;

  // Bind product view filters
  container.querySelectorAll<HTMLButtonElement>("[data-pview]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (currentPage !== "products") navigateTo("products");
      container.querySelectorAll<HTMLElement>(".sidebar-cat-item").forEach((el) => el.classList.remove("active"));
      btn.classList.add("active");
      setProductFilterView(btn.dataset.pview as "all" | "favorites" | "archived");
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
      const mode = getAppMode();

      if (currentPage === "klienci") {
        initKlienci(input.value.trim());
      } else if (mode === "handlowy") {
        if (currentPage !== "products") navigateTo("products");
        setProductSearch(input.value.trim());
      } else {
        if (currentPage === "robocizny") {
          setLaborSearch(input.value.trim());
        } else {
          if (currentPage !== "materialy") navigateTo("materialy");
          setSearch(input.value.trim());
        }
      }
    }, 200);
  });
}

// ─── Mode selection screen ──────────────────────────────────────
const MODE_CHOSEN_KEY = "pp_mode_chosen";

function showModeSelection(onFinish: (mode: AppMode) => void): void {
  const overlay = document.createElement("div");
  overlay.className = "wizard-overlay";
  document.body.appendChild(overlay);

  overlay.innerHTML = `
    <div class="wizard-card" style="max-width:580px">
      <img src="/logo.png" alt="Prosty Planer" class="wizard-logo" />
      <h1 class="wizard-title">Wybierz tryb pracy</h1>
      <p class="wizard-desc">Jak działa Twoja firma? Od tego zależy, jakie narzędzia zobaczysz w aplikacji.</p>

      <div class="mode-cards">
        <button class="mode-card" data-mode="uslugowy">
          <div class="mode-card-icon"><i class="fa-solid fa-wrench"></i></div>
          <div class="mode-card-title">Tryb usługowy</div>
          <div class="mode-card-desc">Świadczę usługi (budowlanka, sprzątanie, instalacje...)</div>
          <div class="mode-card-features">
            <span><i class="fa-solid fa-boxes-stacked"></i> Materiały</span>
            <span><i class="fa-solid fa-helmet-safety"></i> Robocizny</span>
            <span><i class="fa-solid fa-file-invoice-dollar"></i> Zlecenia</span>
          </div>
        </button>

        <button class="mode-card" data-mode="handlowy">
          <div class="mode-card-icon"><i class="fa-solid fa-cube"></i></div>
          <div class="mode-card-title">Tryb handlowy</div>
          <div class="mode-card-desc">Dostarczam towary (artykuły spożywcze, biurowe, techniczne...)</div>
          <div class="mode-card-features">
            <span><i class="fa-solid fa-cube"></i> Moje Produkty</span>
            <span><i class="fa-solid fa-gavel"></i> Oferty przetargowe</span>
            <span><i class="fa-solid fa-file-excel"></i> Import z Excela</span>
          </div>
        </button>
      </div>

      <p class="wizard-desc" style="font-size:11px;margin-top:16px;color:var(--text-muted)">
        <i class="fa-solid fa-circle-info"></i> Możesz zmienić tryb później w Ustawieniach / Moja Firma
      </p>
    </div>
  `;

  overlay.querySelectorAll<HTMLButtonElement>(".mode-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode as AppMode;
      localStorage.setItem(MODE_CHOSEN_KEY, "1");
      setAppMode(mode);

      if (mode === "handlowy") {
        seedTradeDefaults();
      }

      overlay.classList.add("wizard-exit");
      setTimeout(() => {
        overlay.remove();
        onFinish(mode);
      }, 300);
    });
  });
}

// ─── Command Palette (Ctrl+K) ───────────────────────────────────
let cmdPaletteOpen = false;

function openCommandPalette(): void {
  if (cmdPaletteOpen) return;
  cmdPaletteOpen = true;

  const overlay = document.createElement("div");
  overlay.className = "cmd-palette-overlay";
  overlay.innerHTML = `
    <div class="cmd-palette">
      <input class="cmd-palette-input" placeholder="Szukaj zleceń, klientów, materiałów..." autofocus />
      <div class="cmd-palette-results">
        <div class="cmd-palette-empty">Wpisz frazę żeby szukać...</div>
      </div>
      <div class="cmd-palette-hint">
        <span><kbd>↑↓</kbd> nawiguj</span>
        <span><kbd>Enter</kbd> otwórz</span>
        <span><kbd>Esc</kbd> zamknij</span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector<HTMLInputElement>(".cmd-palette-input")!;
  const results = overlay.querySelector<HTMLElement>(".cmd-palette-results")!;
  let activeIdx = -1;
  let debounceTimer: ReturnType<typeof setTimeout>;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const q = input.value.trim().toLowerCase();
      if (!q) {
        results.innerHTML = '<div class="cmd-palette-empty">Wpisz frazę żeby szukać...</div>';
        activeIdx = -1;
        return;
      }
      renderCmdResults(results, q);
      activeIdx = -1;
    }, 150);
  });

  input.addEventListener("keydown", (e) => {
    const items = results.querySelectorAll<HTMLElement>(".cmd-palette-item");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      updateCmdActive(items, activeIdx);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      updateCmdActive(items, activeIdx);
    } else if (e.key === "Enter" && activeIdx >= 0 && items[activeIdx]) {
      e.preventDefault();
      executeCmdItem(items[activeIdx]);
    } else if (e.key === "Escape") {
      closeCommandPalette();
    }
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeCommandPalette();
  });

  results.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".cmd-palette-item");
    if (item) executeCmdItem(item);
  });

  setTimeout(() => input.focus(), 50);
}

function closeCommandPalette(): void {
  cmdPaletteOpen = false;
  document.querySelector(".cmd-palette-overlay")?.remove();
}

function renderCmdResults(container: HTMLElement, q: string): void {
  const mode = getAppMode();
  interface CmdResult { icon: string; name: string; sub: string; page: string; id?: number; group: string; }
  const all: CmdResult[] = [];

  // Search zlecenia (service mode)
  if (mode === "uslugowy") {
    for (const z of getZlecenia()) {
      if (z.name.toLowerCase().includes(q) || z.client.toLowerCase().includes(q)) {
        all.push({ icon: "fa-solid fa-file-invoice-dollar", name: z.name, sub: z.client || "", page: "zlecenia", id: z.id, group: "Zlecenia" });
      }
    }
  }

  // Search offers (trade mode)
  if (mode === "handlowy") {
    for (const o of getOffers()) {
      if (o.name.toLowerCase().includes(q) || o.client.toLowerCase().includes(q) || (o.reference_number || "").toLowerCase().includes(q)) {
        all.push({ icon: "fa-solid fa-gavel", name: o.name, sub: o.client || "", page: "offers", id: o.id, group: "Oferty" });
      }
    }
  }

  // Clients
  for (const c of getClients()) {
    if (c.name.toLowerCase().includes(q) || c.nip.includes(q) || c.city.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)) {
      all.push({ icon: "fa-solid fa-user", name: c.name, sub: [c.city, c.nip].filter(Boolean).join(" • "), page: "klienci", group: "Klienci" });
    }
  }

  // Materials or Products
  if (mode === "uslugowy") {
    for (const m of getMaterials()) {
      if (m.name.toLowerCase().includes(q) || m.supplier.toLowerCase().includes(q) || m.sku.toLowerCase().includes(q)) {
        all.push({ icon: "fa-solid fa-boxes-stacked", name: m.name, sub: m.supplier || "", page: "materialy", group: "Materiały" });
      }
    }
    for (const l of getLabor()) {
      if (l.name.toLowerCase().includes(q) || l.category.toLowerCase().includes(q)) {
        all.push({ icon: "fa-solid fa-helmet-safety", name: l.name, sub: l.category || "", page: "robocizny", group: "Robocizny" });
      }
    }
  } else {
    for (const p of getProducts()) {
      if (p.name.toLowerCase().includes(q) || p.supplier.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) {
        all.push({ icon: "fa-solid fa-cube", name: p.name, sub: p.supplier || "", page: "products", group: "Produkty" });
      }
    }
  }

  if (all.length === 0) {
    container.innerHTML = '<div class="cmd-palette-empty"><i class="fa-solid fa-magnifying-glass" style="margin-right:6px"></i> Brak wyników</div>';
    return;
  }

  // Group results
  const grouped = new Map<string, CmdResult[]>();
  for (const r of all.slice(0, 30)) {
    if (!grouped.has(r.group)) grouped.set(r.group, []);
    grouped.get(r.group)!.push(r);
  }

  let html = "";
  let idx = 0;
  for (const [group, items] of grouped) {
    html += `<div class="cmd-palette-group">${esc(group)}</div>`;
    for (const item of items) {
      html += `<div class="cmd-palette-item" data-cmd-page="${item.page}" ${item.id ? `data-cmd-id="${item.id}"` : ""} data-cmd-idx="${idx}">
        <i class="${item.icon}"></i>
        <span class="cmd-palette-item-name">${esc(item.name)}</span>
        ${item.sub ? `<span class="cmd-palette-item-sub">${esc(item.sub)}</span>` : ""}
      </div>`;
      idx++;
    }
  }
  container.innerHTML = html;
}

function updateCmdActive(items: NodeListOf<HTMLElement>, idx: number): void {
  items.forEach((el, i) => el.classList.toggle("active", i === idx));
  items[idx]?.scrollIntoView({ block: "nearest" });
}

function executeCmdItem(el: HTMLElement): void {
  const page = el.dataset.cmdPage!;
  const id = el.dataset.cmdId ? parseInt(el.dataset.cmdId) : undefined;
  closeCommandPalette();
  navigateTo(page);
  if (id && page === "zlecenia") {
    setTimeout(() => window.dispatchEvent(new CustomEvent("open-zlecenie", { detail: id })), 50);
  }
  if (id && page === "offers") {
    setTimeout(() => window.dispatchEvent(new CustomEvent("open-offer", { detail: id })), 50);
  }
}

// ─── Keyboard shortcuts ─────────────────────────────────────────
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
  const saved = localStorage.getItem(THEME_KEY) || "light";
  applyTheme(saved);

  document.getElementById("btn-theme-toggle")!.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
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
    if (e.key === "Escape") closeModal();

    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      // Only undo if not in an input/textarea
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      e.preventDefault();
      const label = popUndo();
      if (label) showToast(`Cofnięto: ${label}`);
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      openCommandPalette();
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "n" && !e.shiftKey) {
      e.preventDefault();
      if (currentPage === "materialy") {
        document.getElementById("btn-add-material")?.click();
      } else if (currentPage === "products") {
        document.getElementById("btn-add-product")?.click();
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "N") {
      e.preventDefault();
      openGlobalNotesModal();
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      toggleAISidebar();
    }

    // Navigation shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key === "1") {
      e.preventDefault();
      navigateTo("dashboard");
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "2") {
      e.preventDefault();
      const mode = getAppMode();
      navigateTo(mode === "handlowy" ? "products" : "materialy");
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "3") {
      e.preventDefault();
      const mode = getAppMode();
      navigateTo(mode === "handlowy" ? "offers" : "robocizny");
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "4") {
      e.preventDefault();
      const mode = getAppMode();
      navigateTo(mode === "handlowy" ? "klienci" : "zlecenia");
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "5") {
      e.preventDefault();
      navigateTo("mojafirma");
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "e") {
      e.preventDefault();
      // Trigger CSV export if on products page
      if (currentPage === "products") {
        document.getElementById("btn-export-csv")?.click();
      }
    }

    // Ctrl+Shift+/ for keyboard shortcuts cheatsheet
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "?") {
      e.preventDefault();
      openShortcutsCheatsheet();
    }
  });
}

// ─── Global Notes Modal ──────────────────────────────────────────
function openGlobalNotesModal(): void {
  const currentNotes = getGlobalNotes();

  const html = `
    <div style="padding:20px;max-width:600px">
      <h3 style="margin:0 0 16px 0">Globalna Notatka</h3>
      <textarea
        id="global-notes-textarea"
        style="
          width: 100%;
          height: 300px;
          padding: 12px;
          border: 1px solid var(--border);
          border-radius: 6px;
          font-family: monospace;
          font-size: 13px;
          resize: vertical;
          box-sizing: border-box;
        "
        placeholder="Wpisz tutaj notatki..."
      >${esc(currentNotes)}</textarea>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" id="btn-notes-close">Zamknij</button>
        <button class="btn btn-primary" id="btn-notes-save">Zapisz</button>
      </div>
    </div>
  `;

  openModal(html);

  const textarea = document.querySelector<HTMLTextAreaElement>("#global-notes-textarea")!;
  const btnSave = document.querySelector<HTMLButtonElement>("#btn-notes-save")!;
  const btnClose = document.querySelector<HTMLButtonElement>("#btn-notes-close")!;

  function saveNotes(): void {
    saveGlobalNotes(textarea.value);
    showToast("Notatki zapisane");
  }

  // Save on button click
  btnSave.addEventListener("click", () => {
    saveNotes();
    closeModal();
  });

  // Close button
  btnClose.addEventListener("click", () => {
    closeModal();
  });

  // Auto-save on blur
  textarea.addEventListener("blur", () => {
    saveNotes();
  });

  setTimeout(() => textarea.focus(), 50);
}

// ─── Keyboard Shortcuts Cheatsheet Modal ─────────────────────────
function openShortcutsCheatsheet(): void {
  const shortcuts = [
    { keys: "Ctrl+K", desc: "Szybkie wyszukiwanie" },
    { keys: "Ctrl+Z", desc: "Cofnij ostatnią akcję" },
    { keys: "Ctrl+N", desc: "Nowy materiał / produkt" },
    { keys: "Ctrl+/", desc: "Asystent AI" },
    { keys: "Ctrl+1", desc: "Dashboard" },
    { keys: "Ctrl+2", desc: "Materiały / Produkty" },
    { keys: "Ctrl+3", desc: "Robocizny / Oferty" },
    { keys: "Ctrl+4", desc: "Zlecenia / Klienci" },
    { keys: "Ctrl+5", desc: "Moja Firma" },
    { keys: "Ctrl+E", desc: "Eksport CSV" },
    { keys: "Ctrl+Shift+N", desc: "Notatki globalne" },
    { keys: "Ctrl+?", desc: "Ta lista skrótów" },
    { keys: "Esc", desc: "Zamknij modal" },
  ];

  const shortcutsHTML = shortcuts
    .map(
      (s) =>
        `<div class="shortcuts-row">
          <div class="shortcuts-keys">
            <kbd>${esc(s.keys)}</kbd>
          </div>
          <div class="shortcuts-desc">${esc(s.desc)}</div>
        </div>`
    )
    .join("");

  const modalHtml = `
    <div style="padding:24px">
      <h2 style="margin:0 0 24px 0">Skróty klawiszowe</h2>
      <div class="shortcuts-grid">
        ${shortcutsHTML}
      </div>
      <div style="margin-top:24px;display:flex;justify-content:flex-end">
        <button class="btn btn-primary" id="btn-shortcuts-close">Zamknij</button>
      </div>
    </div>
  `;

  openModal(modalHtml, "modal-lg");

  document.getElementById("btn-shortcuts-close")!.addEventListener("click", () => {
    closeModal();
  });
}

// ─── Apply mode (switch sidebar + UI) ───────────────────────────
function applyMode(): void {
  const mode = getAppMode();

  // Update search placeholder
  const searchInput = document.getElementById("global-search") as HTMLInputElement;
  if (mode === "handlowy") {
    searchInput.placeholder = "Szukaj produktów... (Ctrl+K)";
  } else {
    searchInput.placeholder = "Szukaj materiałów... (Ctrl+K)";
  }

  // Render sidebar nav for the active mode
  renderSidebarNav();
  renderSidebar();
}

// Expose mode switch for settings page
(window as any).__ppSwitchMode = (mode: AppMode) => {
  setAppMode(mode);
  if (mode === "handlowy") seedTradeDefaults();
  applyMode();
  navigateTo("dashboard");
  showToast(`Tryb zmieniony na: ${mode === "handlowy" ? "handlowy" : "usługowy"}`);
};

// ─── Error boundary ─────────────────────────────────────────────
window.addEventListener("error", (e) => {
  console.error("Uncaught error:", e.error);
  const errorEl = document.createElement("div");
  errorEl.className = "error-boundary";
  errorEl.innerHTML = `
    <div class="error-boundary-inner">
      <i class="fa-solid fa-triangle-exclamation" style="font-size:32px;color:var(--danger);margin-bottom:12px"></i>
      <h3 style="margin:0 0 8px">Coś poszło nie tak</h3>
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 16px">Aplikacja napotkała nieoczekiwany błąd. Odśwież stronę.</p>
      <button class="btn btn-primary btn-sm" onclick="location.reload()">Odśwież</button>
    </div>
  `;
  // Only show if it's a critical error that breaks rendering
  if (!document.querySelector(".error-boundary")) {
    document.body.appendChild(errorEl);
  }
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection:", e.reason);
});

// ─── Init ────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await initStore();
  initModalBackdrop();
  initSearch();
  initKeyboard();
  initSidebarToggle();
  initThemeToggle();

  // Wire sidebar update callbacks
  const updateSidebar = () => renderSidebar();
  onMatSidebarUpdate(updateSidebar);
  onProductSidebarUpdate(updateSidebar);
  onCatSidebarUpdate(() => {
    renderSidebar();
  });

  // Wire dashboard navigation
  onDashboardNavigate(
    (page: string) => navigateTo(page),
    (zlecenieId: number) => {
      const mode = getAppMode();
      if (mode === "handlowy") {
        navigateTo("offers");
        setTimeout(() => {
          const event = new CustomEvent("open-offer", { detail: zlecenieId });
          window.dispatchEvent(event);
        }, 50);
      } else {
        navigateTo("zlecenia");
        setTimeout(() => {
          const event = new CustomEvent("open-zlecenie", { detail: zlecenieId });
          window.dispatchEvent(event);
        }, 50);
      }
    }
  );

  // Wire klienci navigation
  onKlienciNavigate(
    (page: string) => navigateTo(page),
    (zlecenieId: number) => {
      const mode = getAppMode();
      if (mode === "handlowy") {
        navigateTo("offers");
        setTimeout(() => window.dispatchEvent(new CustomEvent("open-offer", { detail: zlecenieId })), 50);
      } else {
        navigateTo("zlecenia");
        setTimeout(() => window.dispatchEvent(new CustomEvent("open-zlecenie", { detail: zlecenieId })), 50);
      }
    }
  );

  // Apply mode (sets sidebar nav, search placeholder, etc)
  applyMode();

  // Init AI assistant (general + contextual)
  initAIAssistant();
  initContextAISidebar();
  setAINavigateCallback((page: string, zlecenieId?: number) => {
    navigateTo(page);
    if (zlecenieId && page === "zlecenia") {
      setTimeout(() => {
        const event = new CustomEvent("open-zlecenie", { detail: zlecenieId });
        window.dispatchEvent(event);
      }, 50);
    }
    if (zlecenieId && page === "offers") {
      setTimeout(() => {
        const event = new CustomEvent("open-offer", { detail: zlecenieId });
        window.dispatchEvent(event);
      }, 50);
    }
  });

  // ─── Dashboard quick action events ──────────────────────────────
  window.addEventListener("dash-import-excel", () => {
    openSmartExcelImport();
  });

  window.addEventListener("toggle-ai-sidebar", () => {
    toggleAISidebar();
  });

  window.addEventListener("excel-import-done", () => {
    // Refresh current page after import
    navigateTo(currentPage);
    renderSidebar();
  });

  // Listen for "create new" events from dashboard
  window.addEventListener("dash-create-zlecenie", () => {
    // Trigger the "new zlecenie" action in zlecenia module
    document.querySelector<HTMLButtonElement>("#topbar-actions .btn-primary")?.click();
  });
  window.addEventListener("dash-create-offer", () => {
    document.querySelector<HTMLButtonElement>("#topbar-actions .btn-primary")?.click();
  });
  window.addEventListener("dash-create-material", () => {
    document.querySelector<HTMLButtonElement>("#topbar-actions .btn-primary")?.click();
  });
  window.addEventListener("dash-create-product", () => {
    document.querySelector<HTMLButtonElement>("#topbar-actions .btn-primary")?.click();
  });
  window.addEventListener("dash-create-labor", () => {
    document.querySelector<HTMLButtonElement>("#topbar-actions .btn-primary")?.click();
  });

  // Show wizard on first run, then mode selection
  const shouldChooseMode = !localStorage.getItem(MODE_CHOSEN_KEY);

  if (shouldShowWizard()) {
    initWizard(() => {
      if (shouldChooseMode) {
        showModeSelection((mode) => {
          applyMode();
          renderSidebar();
          navigateTo("dashboard");
        });
      } else {
        renderSidebar();
        navigateTo("dashboard");
      }
    });
  } else if (shouldChooseMode) {
    showModeSelection((mode) => {
      applyMode();
      renderSidebar();
      navigateTo("dashboard");
    });
  } else {
    navigateTo("dashboard");
  }

  // Check for updates 3s after startup (silent)
  setTimeout(() => checkForUpdates(true), 3000);

  // Offline indicator
  const offlineEl = document.createElement("div");
  offlineEl.className = "offline-indicator hidden";
  offlineEl.innerHTML = '<i class="fa-solid fa-wifi" style="font-size:10px"></i> Backend AI niedostępny';
  document.body.appendChild(offlineEl);

  async function checkBackendStatus() {
    try {
      const resp = await fetch("http://localhost:8000/health", { signal: AbortSignal.timeout(3000) });
      offlineEl.classList.toggle("hidden", resp.ok);
    } catch {
      offlineEl.classList.remove("hidden");
    }
  }
  checkBackendStatus();
  setInterval(checkBackendStatus, 30000);

  // Onboarding
  const ONBOARD_KEY = "pp_onboard_done";

  function initOnboarding(): void {
    if (localStorage.getItem(ONBOARD_KEY)) return;

    const steps = [
      { title: "Witaj w Prosty Planer! 👋", text: "Stwórz wyceny, zarządzaj materiałami i śledź zlecenia w jednym miejscu.", target: ".sidebar-nav", pos: "right" },
      { title: "Szybkie wyszukiwanie", text: "Naciśnij Ctrl+K żeby szybko znaleźć zlecenie, klienta lub materiał.", target: "#global-search", pos: "bottom" },
      { title: "Asystent AI", text: "Kliknij żeby otworzyć asystenta AI — pomoże z wycenami, obliczeniami i analizą.", target: "#btn-ai-toggle", pos: "left" },
      { title: "Ustawienia firmy", text: "Uzupełnij dane firmy — pojawią się na kosztorysach PDF i ofertach.", target: "[data-page='ustawienia']", pos: "right" },
    ];

    let currentStep = 0;

    function showStep(idx: number) {
      // Remove previous
      document.querySelector(".onboard-overlay")?.remove();
      document.querySelector(".onboard-tooltip")?.remove();

      if (idx >= steps.length) {
        localStorage.setItem(ONBOARD_KEY, "1");
        return;
      }

      const step = steps[idx];
      const targetEl = document.querySelector(step.target);
      if (!targetEl) { showStep(idx + 1); return; }

      const rect = targetEl.getBoundingClientRect();

      const overlay = document.createElement("div");
      overlay.className = "onboard-overlay";
      document.body.appendChild(overlay);

      const tooltip = document.createElement("div");
      tooltip.className = "onboard-tooltip";
      tooltip.innerHTML = `
        <h4>${step.title}</h4>
        <p>${step.text}</p>
        <div class="onboard-footer">
          <span class="onboard-step">${idx + 1} / ${steps.length}</span>
          <div class="onboard-btns">
            <button class="btn btn-sm" id="onboard-skip">Pomiń</button>
            <button class="btn btn-sm btn-primary" id="onboard-next">${idx === steps.length - 1 ? "Gotowe!" : "Dalej →"}</button>
          </div>
        </div>
      `;

      // Position tooltip
      const margin = 12;
      if (step.pos === "right") {
        tooltip.style.left = (rect.right + margin) + "px";
        tooltip.style.top = rect.top + "px";
      } else if (step.pos === "bottom") {
        tooltip.style.left = rect.left + "px";
        tooltip.style.top = (rect.bottom + margin) + "px";
      } else if (step.pos === "left") {
        tooltip.style.right = (window.innerWidth - rect.left + margin) + "px";
        tooltip.style.top = rect.top + "px";
      }

      document.body.appendChild(tooltip);

      tooltip.querySelector("#onboard-skip")!.addEventListener("click", () => {
        localStorage.setItem(ONBOARD_KEY, "1");
        overlay.remove();
        tooltip.remove();
      });

      tooltip.querySelector("#onboard-next")!.addEventListener("click", () => {
        currentStep++;
        showStep(currentStep);
      });

      overlay.addEventListener("click", () => {
        currentStep++;
        showStep(currentStep);
      });
    }

    // Delay to let sidebar render
    setTimeout(() => showStep(0), 500);
  }

  initOnboarding();

  // Auto-backup
  const AUTO_BACKUP_KEY = "pp_last_auto_backup";
  const AUTO_BACKUP_INTERVAL = 24 * 60 * 60 * 1000; // 24h

  function checkAutoBackup() {
    const last = parseInt(localStorage.getItem(AUTO_BACKUP_KEY) || "0", 10);
    if (Date.now() - last > AUTO_BACKUP_INTERVAL) {
      try {
        const data = exportDatabase();
        localStorage.setItem("pp_auto_backup_data", data);
        localStorage.setItem(AUTO_BACKUP_KEY, String(Date.now()));
        console.log("Auto-backup saved to localStorage");
      } catch (e) { console.error("Auto-backup failed:", e); }
    }
  }
  checkAutoBackup();
  setInterval(checkAutoBackup, 60 * 60 * 1000); // check every hour

  // LocalStorage quota check
  function checkStorageQuota() {
    try {
      let totalSize = 0;
      for (const key of Object.keys(localStorage)) {
        totalSize += localStorage.getItem(key)!.length * 2; // UTF-16
      }
      const usedMB = (totalSize / (1024 * 1024)).toFixed(1);
      const limitMB = 5;
      if (totalSize > limitMB * 1024 * 1024 * 0.8) {
        showToast(`⚠️ Baza danych: ${usedMB}MB / ${limitMB}MB — rozważ eksport i archiwizację`);
      }
    } catch {}
  }
  checkStorageQuota();

  // Remove splash screen
  const splash = document.getElementById("splash-screen");
  if (splash) {
    splash.classList.add("splash-exit");
    setTimeout(() => splash.remove(), 500);
  }
});

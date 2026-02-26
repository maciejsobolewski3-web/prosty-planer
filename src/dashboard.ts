import type { Zlecenie, ZlecenieStatus, Offer, OfferStatus } from "./types";
import {
  getZlecenia,
  getAllMaterialsCount,
  getAllLaborCount,
  getExpenses,
  getExpensesTotalByCategory,
  getClients,
} from "./store";
import {
  getAppMode,
  getOffers,
  getAllProductsCount,
  calcOfferTotals,
} from "./store-trade";
import { esc, formatPrice, brutto, showToast, openModal, closeModal } from "./ui";
import { fetchExchangeRates, getCachedRates, POPULAR_CURRENCIES, convertToPLN, formatCurrency, fetchHistoricalRates, renderCurrencyChart, bindChartHover, CHART_RANGE_DAYS, type ChartRange } from "./currency";

// ─── Status config (duplicated for independence) ─────────────────
const STATUS_CONFIG: Record<ZlecenieStatus, { label: string; color: string; icon: string }> = {
  wycena:        { label: "Wycena",        color: "#555870", icon: "fa-solid fa-pencil" },
  wyslane:       { label: "Wysłane",       color: "#667eea", icon: "fa-solid fa-paper-plane" },
  zaakceptowane: { label: "Zaakceptowane", color: "#30a46c", icon: "fa-solid fa-check" },
  odrzucone:     { label: "Odrzucone",     color: "#e5484d", icon: "fa-solid fa-xmark" },
  realizacja:    { label: "W realizacji",  color: "#f5a623", icon: "fa-solid fa-hammer" },
  zakonczone:    { label: "Zakończone",   color: "#30a46c", icon: "fa-solid fa-flag-checkered" },
};

// ─── Navigate callback (set by main.ts) ──────────────────────────
let _navigateCb: ((page: string) => void) | null = null;
let _openZlecenieCb: ((id: number) => void) | null = null;

export function onDashboardNavigate(nav: (page: string) => void, openZlecenie: (id: number) => void): void {
  _navigateCb = nav;
  _openZlecenieCb = openZlecenie;
}

// ─── Helpers ─────────────────────────────────────────────────────
function calcZlecenieBrutto(z: Zlecenie): number {
  let total = 0;
  for (const item of z.items) {
    const markupPct = item.type === "material" ? (z.markup_materials || 0) : (z.markup_labor || 0);
    const lineWithMarkup = item.price_netto * (1 + markupPct / 100) * item.quantity;
    total += brutto(lineWithMarkup, item.vat_rate);
  }
  return total;
}

// ─── Trade offer status config ──────────────────────────────────
const OFFER_STATUS_CONFIG: Record<OfferStatus, { label: string; color: string; icon: string }> = {
  robocza:    { label: "Robocza",      color: "#555870", icon: "fa-solid fa-pencil" },
  zlozona:    { label: "Złożona",      color: "#667eea", icon: "fa-solid fa-paper-plane" },
  wygrana:    { label: "Wygrana",      color: "#30a46c", icon: "fa-solid fa-trophy" },
  przegrana:  { label: "Przegrana",    color: "#e5484d", icon: "fa-solid fa-xmark" },
  realizacja: { label: "W realizacji", color: "#f5a623", icon: "fa-solid fa-truck" },
  zakonczona: { label: "Zakończona",   color: "#30a46c", icon: "fa-solid fa-flag-checkered" },
};

// ─── Render ──────────────────────────────────────────────────────
export function initDashboard(): void {
  const mode = getAppMode();
  if (mode === "handlowy") {
    initTradeDashboard();
    return;
  }

  const page = document.getElementById("page-dashboard")!;
  const zlecenia = getZlecenia();
  const matCounts = getAllMaterialsCount();
  const laborCounts = getAllLaborCount();

  document.getElementById("topbar-title")!.textContent = "Dashboard";
  document.getElementById("topbar-actions")!.innerHTML = `
    <button class="btn btn-sm btn-primary" id="dash-quick-import-excel" title="Importuj cennik z Excel">
      <i class="fa-solid fa-file-excel"></i> Import Excel
    </button>
  `;

  // Stats
  const activeZlecenia = zlecenia.filter((z) => {
    const s = z.status || "wycena";
    return s !== "odrzucone";
  });

  const totalBrutto = activeZlecenia.reduce((sum, z) => sum + calcZlecenieBrutto(z), 0);

  const statusGroups: Record<string, Zlecenie[]> = {};
  for (const z of zlecenia) {
    const s = z.status || "wycena";
    if (!statusGroups[s]) statusGroups[s] = [];
    statusGroups[s].push(z);
  }

  // Recent (last 5)
  const recent = zlecenia.slice(0, 5);

  page.innerHTML = `
    ${renderDeadlineAlerts(zlecenia)}
    <!-- Quick actions -->
    <div class="dash-quick-actions">
      <button class="dash-quick-btn" data-dash-action="new-zlecenie">
        <i class="fa-solid fa-plus"></i>
        <span>Nowe zlecenie</span>
      </button>
      <button class="dash-quick-btn" data-dash-action="new-material">
        <i class="fa-solid fa-cube"></i>
        <span>Dodaj materiał</span>
      </button>
      <button class="dash-quick-btn" data-dash-action="new-labor">
        <i class="fa-solid fa-helmet-safety"></i>
        <span>Dodaj robociznę</span>
      </button>
      <button class="dash-quick-btn" data-dash-action="import-excel">
        <i class="fa-solid fa-file-excel"></i>
        <span>Import z Excel</span>
      </button>
      <button class="dash-quick-btn" data-dash-action="ai-assistant">
        <i class="fa-solid fa-robot"></i>
        <span>AI Asystent</span>
      </button>
    </div>

    <!-- Stat cards -->
    <div class="dash-stats">
      <div class="dash-stat-card" data-dash-nav="zlecenia">
        <div class="dash-stat-icon" style="background:var(--accent-subtle);color:var(--accent)">
          <i class="fa-solid fa-file-invoice-dollar"></i>
        </div>
        <div class="dash-stat-value">${zlecenia.length}</div>
        <div class="dash-stat-label">Zleceń łącznie</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-icon" style="background:var(--success-subtle);color:var(--success)">
          <i class="fa-solid fa-coins"></i>
        </div>
        <div class="dash-stat-value">${formatPrice(totalBrutto)} <small>zł</small></div>
        <div class="dash-stat-label">Wartość aktywnych (brutto)</div>
      </div>
      <div class="dash-stat-card" data-dash-nav="materialy">
        <div class="dash-stat-icon" style="background:var(--warning-subtle);color:var(--warning)">
          <i class="fa-solid fa-boxes-stacked"></i>
        </div>
        <div class="dash-stat-value">${matCounts.total}</div>
        <div class="dash-stat-label">Materiałów w bazie</div>
      </div>
      <div class="dash-stat-card" data-dash-nav="robocizny">
        <div class="dash-stat-icon" style="background:rgba(139,92,246,0.12);color:#8b5cf6">
          <i class="fa-solid fa-helmet-safety"></i>
        </div>
        <div class="dash-stat-value">${laborCounts.total}</div>
        <div class="dash-stat-label">Robocizn w bazie</div>
      </div>
    </div>

    <!-- Status breakdown + Recent -->
    <div class="dash-columns">
      <div class="dash-section">
        <div class="dash-section-title">Statusy zleceń</div>
        <div class="dash-status-list">
          ${Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
            const count = statusGroups[key]?.length || 0;
            const value = (statusGroups[key] || []).reduce((s, z) => s + calcZlecenieBrutto(z), 0);
            return `
              <div class="dash-status-row">
                <span class="dash-status-dot" style="background:${cfg.color}"></span>
                <span class="dash-status-name">${cfg.label}</span>
                <span class="dash-status-count">${count}</span>
                <span class="dash-status-value">${count > 0 ? formatPrice(value) + " zł" : "—"}</span>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <div class="dash-section">
        <div class="dash-section-title">Ostatnio edytowane</div>
        ${recent.length === 0 ? '<div class="cell-muted" style="padding:16px">Brak zleceń</div>' :
          `<div class="dash-recent-list">${recent.map((z) => {
            const status = z.status || "wycena";
            const cfg = STATUS_CONFIG[status];
            const value = calcZlecenieBrutto(z);
            const date = new Date(z.updated_at).toLocaleDateString("pl-PL");
            return `
              <div class="dash-recent-item" data-dash-zlecenie="${z.id}">
                <div class="dash-recent-status" style="background:${cfg.color}"></div>
                <div class="dash-recent-info">
                  <div class="dash-recent-name">${esc(z.name)}</div>
                  <div class="dash-recent-meta">${cfg.label} • ${z.client ? esc(z.client) + " • " : ""}${date}</div>
                </div>
                <div class="dash-recent-value">${formatPrice(value)} zł</div>
              </div>
            `;
          }).join("")}</div>`
        }
      </div>
    </div>

    <!-- Deadline alerts -->
    ${renderDeadlineAlerts(zlecenia)}

    <!-- Financial summary -->
    ${renderFinancialSummary(zlecenia)}

    <!-- Pipeline Revenue Forecast -->
    ${renderPipelineForecast(zlecenia)}

    <!-- TOP 10 Materials Ranking -->
    ${renderMaterialRanking(zlecenia)}

    <!-- Seasonality Chart -->
    ${renderSeasonalityChart(zlecenia)}

    <!-- Timeline -->
    ${renderTimeline(zlecenia)}

    <!-- Trends chart -->
    ${renderTrendsChart(zlecenia)}

    <!-- Report button -->
    <div style="margin-top:20px">
      <button class="btn btn-sm" id="btn-open-report" style="width:100%;padding:12px">
        <i class="fa-solid fa-chart-line"></i> Zobacz raport rentowności
      </button>
    </div>
  `;

  // Bind deadline alert clicks
  page.querySelectorAll<HTMLElement>(".deadline-alert-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = parseInt(el.dataset.deadlineId!);
      _openZlecenieCb?.(id);
    });
  });

  // Bind navigation
  page.querySelectorAll<HTMLElement>("[data-dash-nav]").forEach((el) => {
    el.style.cursor = "pointer";
    el.addEventListener("click", () => {
      _navigateCb?.(el.dataset.dashNav!);
    });
  });

  page.querySelectorAll<HTMLElement>("[data-dash-zlecenie]").forEach((el) => {
    el.addEventListener("click", () => {
      _openZlecenieCb?.(parseInt(el.dataset.dashZlecenie!));
    });
  });

  // Quick action buttons
  page.querySelectorAll<HTMLButtonElement>("[data-dash-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.dashAction!;
      if (action === "new-zlecenie") {
        _navigateCb?.("zlecenia");
        setTimeout(() => window.dispatchEvent(new CustomEvent("dash-create-zlecenie")), 100);
      } else if (action === "new-material") {
        _navigateCb?.("materialy");
        setTimeout(() => window.dispatchEvent(new CustomEvent("dash-create-material")), 100);
      } else if (action === "new-labor") {
        _navigateCb?.("robocizny");
        setTimeout(() => window.dispatchEvent(new CustomEvent("dash-create-labor")), 100);
      } else if (action === "import-excel") {
        window.dispatchEvent(new CustomEvent("dash-import-excel"));
      } else if (action === "ai-assistant") {
        window.dispatchEvent(new CustomEvent("toggle-ai-sidebar"));
      }
    });
  });

  // Topbar import button
  document.getElementById("dash-quick-import-excel")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("dash-import-excel"));
  });

  // Report button
  document.getElementById("btn-open-report")?.addEventListener("click", () => {
    openProfitabilityReportModal(zlecenia, getClients(), getExpenses());
  });
}

// ═══════════════════════════════════════════════════════════════════
// TRADE MODE DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function initTradeDashboard(): void {
  const page = document.getElementById("page-dashboard")!;
  const offers = getOffers();
  const prodCounts = getAllProductsCount();

  // Fetch exchange rates
  fetchExchangeRates().then(() => {
    const currencyWidget = page.querySelector("[data-currency-widget]");
    if (currencyWidget) {
      currencyWidget.innerHTML = renderCurrencyWidgetContent();
      bindCurrencyWidgetEvents();
    }
  });

  document.getElementById("topbar-title")!.textContent = "Dashboard";
  document.getElementById("topbar-actions")!.innerHTML = `
    <button class="btn btn-sm btn-primary" id="dash-quick-import-excel" title="Importuj cennik z Excel">
      <i class="fa-solid fa-file-excel"></i> Import Excel
    </button>
  `;

  // Stats
  const activeOffers = offers.filter((o) => o.status === "robocza" || o.status === "zlozona");
  const wonOffers = offers.filter((o) => o.status === "wygrana" || o.status === "realizacja" || o.status === "zakonczona");
  const totalOffersCount = offers.filter((o) => o.status !== "robocza").length;
  const winRate = totalOffersCount > 0 ? Math.round((wonOffers.length / totalOffersCount) * 100) : 0;

  const wonValue = wonOffers.reduce((sum, o) => {
    const totals = calcOfferTotals(o.id);
    return sum + totals.totalOffer;
  }, 0);

  // Status breakdown
  const statusGroups: Record<string, Offer[]> = {};
  for (const o of offers) {
    if (!statusGroups[o.status]) statusGroups[o.status] = [];
    statusGroups[o.status].push(o);
  }

  // Upcoming deadlines (next 30 days)
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const in30days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const upcoming = offers
    .filter((o) => {
      if (!o.deadline) return false;
      if (o.status === "przegrana" || o.status === "zakonczona") return false;
      const d = new Date(o.deadline + "T00:00:00");
      return d >= now && d <= in30days;
    })
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, 6);

  // Recent (last 5 by updated_at)
  const recent = [...offers].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);

  page.innerHTML = `
    <!-- Quick actions -->
    <div class="dash-quick-actions">
      <button class="dash-quick-btn" data-dash-action="new-offer">
        <i class="fa-solid fa-plus"></i>
        <span>Nowa oferta</span>
      </button>
      <button class="dash-quick-btn" data-dash-action="new-product">
        <i class="fa-solid fa-cube"></i>
        <span>Dodaj produkt</span>
      </button>
      <button class="dash-quick-btn" data-dash-action="import-excel">
        <i class="fa-solid fa-file-excel"></i>
        <span>Import cennika z Excel</span>
      </button>
      <button class="dash-quick-btn" data-dash-action="ai-assistant">
        <i class="fa-solid fa-robot"></i>
        <span>AI Asystent</span>
      </button>
    </div>

    <!-- Stat cards -->
    <div class="dash-stats">
      <div class="dash-stat-card" data-dash-nav="products">
        <div class="dash-stat-icon" style="background:var(--warning-subtle);color:var(--warning)">
          <i class="fa-solid fa-cube"></i>
        </div>
        <div class="dash-stat-value">${prodCounts.total}</div>
        <div class="dash-stat-label">Produkty w cenniku</div>
      </div>
      <div class="dash-stat-card" data-dash-nav="offers">
        <div class="dash-stat-icon" style="background:var(--accent-subtle);color:var(--accent)">
          <i class="fa-solid fa-gavel"></i>
        </div>
        <div class="dash-stat-value">${activeOffers.length}</div>
        <div class="dash-stat-label">Oferty aktywne</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-icon" style="background:var(--success-subtle);color:var(--success)">
          <i class="fa-solid fa-trophy"></i>
        </div>
        <div class="dash-stat-value">${wonOffers.length}</div>
        <div class="dash-stat-label">Oferty wygrane</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-icon" style="background:rgba(139,92,246,0.12);color:#8b5cf6">
          <i class="fa-solid fa-chart-line"></i>
        </div>
        <div class="dash-stat-value">${winRate}<small>%</small></div>
        <div class="dash-stat-label">Win rate</div>
      </div>
    </div>

    <!-- Status breakdown + Recent -->
    <div class="dash-columns">
      <div class="dash-section">
        <div class="dash-section-title">Statusy ofert</div>
        <div class="dash-status-list">
          ${Object.entries(OFFER_STATUS_CONFIG).map(([key, cfg]) => {
            const group = statusGroups[key] || [];
            const count = group.length;
            const value = group.reduce((s, o) => {
              const t = calcOfferTotals(o.id);
              return s + t.totalOffer;
            }, 0);
            return `
              <div class="dash-status-row">
                <span class="dash-status-dot" style="background:${cfg.color}"></span>
                <span class="dash-status-name">${cfg.label}</span>
                <span class="dash-status-count">${count}</span>
                <span class="dash-status-value">${count > 0 ? formatPrice(value) + " zł" : "—"}</span>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <div class="dash-section">
        <div class="dash-section-title">Ostatnia aktywność</div>
        ${recent.length === 0 ? '<div class="cell-muted" style="padding:16px">Brak ofert</div>' :
          `<div class="dash-recent-list">${recent.map((o) => {
            const cfg = OFFER_STATUS_CONFIG[o.status];
            const totals = calcOfferTotals(o.id);
            const date = new Date(o.updated_at).toLocaleDateString("pl-PL");
            return `
              <div class="dash-recent-item" data-dash-offer="${o.id}">
                <div class="dash-recent-status" style="background:${cfg.color}"></div>
                <div class="dash-recent-info">
                  <div class="dash-recent-name">${esc(o.name)}</div>
                  <div class="dash-recent-meta">${cfg.label} • ${o.client ? esc(o.client) + " • " : ""}${date}</div>
                </div>
                <div class="dash-recent-value">${formatPrice(totals.totalOffer)} zł</div>
              </div>
            `;
          }).join("")}</div>`
        }
      </div>
    </div>

    <!-- Currency Widget -->
    ${renderCurrencyWidget()}

    <!-- Upcoming deadlines -->
    ${upcoming.length > 0 ? `
      <div class="dash-section" style="margin-top:20px">
        <div class="dash-section-title"><i class="fa-solid fa-clock" style="font-size:12px;margin-right:4px"></i> Nadchodzące terminy</div>
        <div class="dash-recent-list">
          ${upcoming.map((o) => {
            const cfg = OFFER_STATUS_CONFIG[o.status];
            const d = new Date(o.deadline + "T12:00:00");
            const diff = Math.ceil((d.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
            const dateStr = d.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
            const urgency = diff <= 3 ? "var(--danger)" : diff <= 7 ? "var(--warning)" : "var(--text-secondary)";
            return `
              <div class="dash-recent-item" data-dash-offer="${o.id}">
                <div class="dash-recent-status" style="background:${cfg.color}"></div>
                <div class="dash-recent-info">
                  <div class="dash-recent-name">${esc(o.name)}</div>
                  <div class="dash-recent-meta">${esc(o.client)} • ${cfg.label}</div>
                </div>
                <div style="text-align:right">
                  <div class="cell-mono" style="font-size:12px;color:${urgency}">${dateStr}</div>
                  <div class="cell-muted" style="font-size:10px">${diff === 0 ? "DZIŚ!" : diff === 1 ? "jutro" : `za ${diff} dni`}</div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    ` : ""}

    <!-- Trade Financial Summary -->
    ${renderTradeFinancialSummary(offers)}

    <!-- Trade Pipeline Forecast -->
    ${renderTradePipelineForecast(offers)}

    <!-- Top 10 Products Ranking -->
    ${renderProductRanking(offers)}

    <!-- Timeline for delivery periods -->
    ${renderOfferTimeline(offers)}

    <!-- Trade Trends chart -->
    ${renderTradeTrendsChart(offers)}

    <!-- Trade Report button -->
    <div style="margin-top:20px">
      <button class="btn btn-sm" id="btn-open-trade-report" style="width:100%;padding:12px">
        <i class="fa-solid fa-chart-line"></i> Zobacz raport rentowności
      </button>
    </div>
  `;

  // Bind deadline alert clicks
  page.querySelectorAll<HTMLElement>(".deadline-alert-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = parseInt(el.dataset.deadlineId!);
      _openZlecenieCb?.(id);
    });
  });

  // Bind navigation
  page.querySelectorAll<HTMLElement>("[data-dash-nav]").forEach((el) => {
    el.style.cursor = "pointer";
    el.addEventListener("click", () => {
      _navigateCb?.(el.dataset.dashNav!);
    });
  });

  page.querySelectorAll<HTMLElement>("[data-dash-offer]").forEach((el) => {
    el.addEventListener("click", () => {
      _openZlecenieCb?.(parseInt(el.dataset.dashOffer!));
    });
  });

  // Quick action buttons
  page.querySelectorAll<HTMLButtonElement>("[data-dash-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.dashAction!;
      if (action === "new-offer") {
        _navigateCb?.("offers");
        setTimeout(() => window.dispatchEvent(new CustomEvent("dash-create-offer")), 100);
      } else if (action === "new-product") {
        _navigateCb?.("products");
        setTimeout(() => window.dispatchEvent(new CustomEvent("dash-create-product")), 100);
      } else if (action === "import-excel") {
        window.dispatchEvent(new CustomEvent("dash-import-excel"));
      } else if (action === "ai-assistant") {
        window.dispatchEvent(new CustomEvent("toggle-ai-sidebar"));
      }
    });
  });

  // Topbar import button
  document.getElementById("dash-quick-import-excel")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("dash-import-excel"));
  });

  // Trade Report button
  document.getElementById("btn-open-trade-report")?.addEventListener("click", () => {
    openTradeReportModal(offers);
  });

  // Currency widget events
  bindCurrencyWidgetEvents();
}

// ─── Deadline alerts (service mode) ──────────────────────────────
function renderDeadlineAlerts(zlecenia: Zlecenie[]): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const nowMs = now.getTime();

  const alerts: { z: Zlecenie; diff: number; type: "overdue" | "soon" | "upcoming" }[] = [];

  for (const z of zlecenia) {
    if (!z.date_end) continue;
    const s = z.status || "wycena";
    if (s === "zakonczone" || s === "odrzucone") continue;

    const endDate = new Date(z.date_end + "T00:00:00");
    const diff = Math.ceil((endDate.getTime() - nowMs) / (86400000));

    if (diff < 0) {
      alerts.push({ z, diff, type: "overdue" });
    } else if (diff <= 3) {
      alerts.push({ z, diff, type: "soon" });
    } else if (diff <= 14) {
      alerts.push({ z, diff, type: "upcoming" });
    }
  }

  if (alerts.length === 0) return "";

  alerts.sort((a, b) => a.diff - b.diff);

  return `
    <div class="dash-section" style="margin-top:20px">
      <div class="dash-section-title">
        <i class="fa-solid fa-bell" style="font-size:12px;margin-right:4px;color:var(--warning)"></i> Terminy i alerty
      </div>
      <div class="dash-recent-list">
        ${alerts.map((a) => {
          const cfg = STATUS_CONFIG[a.z.status || "wycena"];
          const dateStr = new Date(a.z.date_end + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
          let urgencyColor: string;
          let urgencyLabel: string;

          if (a.type === "overdue") {
            urgencyColor = "var(--danger)";
            urgencyLabel = a.diff === -1 ? "1 dzień po terminie" : `${Math.abs(a.diff)} dni po terminie!`;
          } else if (a.type === "soon") {
            urgencyColor = "var(--warning)";
            urgencyLabel = a.diff === 0 ? "DZIŚ!" : a.diff === 1 ? "jutro" : `za ${a.diff} dni`;
          } else {
            urgencyColor = "var(--text-secondary)";
            urgencyLabel = `za ${a.diff} dni`;
          }

          return `
            <div class="dash-recent-item" data-dash-zlecenie="${a.z.id}" style="${a.type === "overdue" ? "background:rgba(229,72,77,0.06)" : ""}">
              <div class="dash-recent-status" style="background:${a.type === "overdue" ? "var(--danger)" : cfg.color}"></div>
              <div class="dash-recent-info">
                <div class="dash-recent-name">${esc(a.z.name)}</div>
                <div class="dash-recent-meta">${cfg.label}${a.z.client ? " • " + esc(a.z.client) : ""}</div>
              </div>
              <div style="text-align:right">
                <div class="cell-mono" style="font-size:12px;color:${urgencyColor};font-weight:600">${urgencyLabel}</div>
                <div class="cell-muted" style="font-size:10px">${dateStr}</div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

// ─── Financial summary (service mode) ───────────────────────────
function renderFinancialSummary(zlecenia: Zlecenie[]): string {
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);

  // Revenue from accepted/active zlecenia this month
  const activeZlecenia = zlecenia.filter((z) => {
    const s = z.status || "wycena";
    return s === "zaakceptowane" || s === "realizacja" || s === "zakonczone";
  });

  let totalRevenue = 0;
  let totalCost = 0;
  for (const z of activeZlecenia) {
    for (const item of z.items) {
      const markup = item.type === "material" ? (z.markup_materials || 0) : (z.markup_labor || 0);
      const lineBase = item.price_netto * item.quantity;
      totalCost += lineBase;
      totalRevenue += lineBase * (1 + markup / 100);
    }
  }

  const totalProfit = totalRevenue - totalCost;
  const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;

  // Expenses this month
  const expenses = getExpenses(thisMonth);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const expByCat = getExpensesTotalByCategory(thisMonth);

  // Net profit after expenses
  const netProfit = totalRevenue - totalExpenses;

  if (totalRevenue === 0 && totalExpenses === 0) return "";

  return `
    <div class="dash-section" style="margin-top:20px">
      <div class="dash-section-title">
        <i class="fa-solid fa-chart-bar" style="font-size:12px;margin-right:4px"></i> Podsumowanie finansowe
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
        <div style="background:var(--bg-secondary);padding:12px;border-radius:var(--radius)">
          <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Przychody netto</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px">${formatPrice(totalRevenue)} <small style="font-size:11px">zł</small></div>
          <div style="font-size:10px;color:var(--text-secondary)">${activeZlecenia.length} zleceń aktywnych</div>
        </div>
        <div style="background:var(--bg-secondary);padding:12px;border-radius:var(--radius)">
          <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Narzut łączny</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px;color:var(--success)">${formatPrice(totalProfit)} <small style="font-size:11px">zł</small></div>
          <div style="font-size:10px;color:var(--text-secondary)">marża ${profitMargin.toFixed(1)}%</div>
        </div>
        <div style="background:var(--bg-secondary);padding:12px;border-radius:var(--radius)">
          <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Wydatki (${now.toLocaleDateString("pl-PL", { month: "short" })})</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px;color:var(--danger)">${formatPrice(totalExpenses)} <small style="font-size:11px">zł</small></div>
          <div style="font-size:10px;color:var(--text-secondary)">${expenses.length} pozycji</div>
        </div>
        <div style="background:var(--bg-secondary);padding:12px;border-radius:var(--radius)">
          <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Zysk netto</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px;color:${netProfit >= 0 ? "var(--success)" : "var(--danger)"}">${formatPrice(netProfit)} <small style="font-size:11px">zł</small></div>
          <div style="font-size:10px;color:var(--text-secondary)">przychody − wydatki</div>
        </div>
      </div>
      ${Object.keys(expByCat).length > 0 ? `
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${Object.entries(expByCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
            return `<span class="tag" style="font-size:11px">${cat}: ${formatPrice(amt)} zł</span>`;
          }).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

// ─── Pipeline Revenue Forecast (service mode) ──────────────────
function renderPipelineForecast(zlecenia: Zlecenie[]): string {
  // Filter active zlecenia: wycena, wyslane, zaakceptowane, realizacja
  const activeZlecenia = zlecenia.filter((z) => {
    const s = z.status || "wycena";
    return s === "wycena" || s === "wyslane" || s === "zaakceptowane" || s === "realizacja";
  });

  if (activeZlecenia.length === 0) return "";

  // Group by status
  const statusBreakdown: Record<string, { count: number; value: number }> = {};
  const pipelineStatuses: ZlecenieStatus[] = ["wycena", "wyslane", "zaakceptowane", "realizacja"];

  for (const status of pipelineStatuses) {
    const items = activeZlecenia.filter((z) => (z.status || "wycena") === status);
    statusBreakdown[status] = {
      count: items.length,
      value: items.reduce((sum, z) => sum + calcZlecenieBrutto(z), 0),
    };
  }

  const totalValue = Object.values(statusBreakdown).reduce((sum, s) => sum + s.value, 0);

  // Build progress bar visualization
  const bars = pipelineStatuses.map((status) => {
    const breakdown = statusBreakdown[status];
    const cfg = STATUS_CONFIG[status];
    const pct = totalValue > 0 ? (breakdown.value / totalValue) * 100 : 0;
    return `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div style="display:flex;align-items:center;gap:6px;font-size:12px">
            <span class="dash-status-dot" style="background:${cfg.color}"></span>
            <span>${cfg.label}</span>
          </div>
          <div style="text-align:right;font-size:11px">
            <div style="font-weight:600">${breakdown.count} zleceń</div>
            <div style="color:var(--text-secondary)">${formatPrice(breakdown.value)} zł</div>
          </div>
        </div>
        <div style="width:100%;height:6px;background:var(--bg-primary);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${cfg.color};transition:width 0.3s ease"></div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="dash-section" style="margin-top:20px">
      <div class="dash-section-title">
        <i class="fa-solid fa-funnel" style="font-size:12px;margin-right:4px"></i> Pipeline przychodu
      </div>
      <div style="background:var(--bg-secondary);padding:16px;border-radius:var(--radius)">
        ${bars}
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:12px;color:var(--text-secondary)">Łącznie w pipeline</div>
          <div style="font-size:16px;font-weight:700;color:var(--accent)">${formatPrice(totalValue)} zł</div>
        </div>
      </div>
    </div>
  `;
}

// ─── TOP 10 Materials Ranking (service mode) ─────────────────────
function renderMaterialRanking(zlecenia: Zlecenie[]): string {
  // Count material names across all zlecenia items
  const materialCounts: Record<string, number> = {};

  for (const z of zlecenia) {
    for (const item of z.items) {
      if (item.type === "material") {
        const name = item.name || "—";
        materialCounts[name] = (materialCounts[name] || 0) + item.quantity;
      }
    }
  }

  const ranked = Object.entries(materialCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (ranked.length === 0) return "";

  const maxQty = Math.max(...ranked.map(([_, q]) => q), 1);

  const bars = ranked.map(([name, qty]) => {
    const pct = (qty / maxQty) * 100;
    return `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
        <div style="width:120px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</div>
        <div style="flex:1">
          <div style="width:100%;height:6px;background:var(--bg-primary);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:var(--accent);transition:width 0.3s ease"></div>
          </div>
        </div>
        <div style="width:40px;text-align:right;font-size:12px;font-weight:600">${qty}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="dash-section" style="margin-top:20px">
      <div class="dash-section-title">
        <i class="fa-solid fa-boxes-stacked" style="font-size:12px;margin-right:4px"></i> Top 10 materiałów
      </div>
      <div style="background:var(--bg-secondary);padding:16px;border-radius:var(--radius);font-size:12px">
        ${bars}
      </div>
    </div>
  `;
}

// ─── Seasonality Chart (service mode) ────────────────────────────
function renderSeasonalityChart(zlecenia: Zlecenie[]): string {
  // Get last 12 months data
  const now = new Date();
  const monthsData: { month: string; date: Date; count: number }[] = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let count = 0;

    for (const z of zlecenia) {
      const zMonth = z.created_at.slice(0, 7);
      if (zMonth === monthKey) count++;
    }

    monthsData.push({
      month: d.toLocaleDateString("pl-PL", { month: "short" }),
      date: d,
      count,
    });
  }

  const maxCount = Math.max(...monthsData.map(m => m.count), 1);
  const chartW = 360;
  const chartH = 140;
  const padding = 20;
  const innerW = chartW - padding * 2;
  const innerH = chartH - padding * 2;

  // Build line chart
  const points = monthsData.map((m, i) => {
    const x = padding + (i / (monthsData.length - 1 || 1)) * innerW;
    const y = chartH - padding - (m.count / maxCount) * innerH;
    return { x, y, count: m.count, month: m.month };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  const dots = points.map((p) => `
    <circle cx="${p.x}" cy="${p.y}" r="3" fill="var(--accent)" stroke="var(--bg-secondary)" stroke-width="2" />
  `).join("");

  // X-axis labels
  const xLabels = monthsData.map((m, i) => {
    const x = padding + (i / (monthsData.length - 1 || 1)) * innerW;
    return `<text x="${x}" y="${chartH - 2}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${m.month}</text>`;
  }).join("");

  if (monthsData.every(m => m.count === 0)) return "";

  return `
    <div class="dash-section" style="margin-top:20px">
      <div class="dash-section-title">
        <i class="fa-solid fa-chart-line" style="font-size:12px;margin-right:4px"></i> Sezonowość (12 ostatnich miesięcy)
      </div>
      <div style="background:var(--bg-secondary);padding:12px;border-radius:var(--radius);overflow:auto">
        <svg width="${chartW}" height="${chartH}" style="min-width:${chartW}px">
          <!-- Grid lines -->
          <line x1="${padding}" y1="${chartH - padding}" x2="${chartW - padding}" y2="${chartH - padding}" stroke="var(--border)" stroke-width="1" />
          <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${chartH - padding}" stroke="var(--border)" stroke-width="1" />

          <!-- Line -->
          <path d="${pathD}" stroke="var(--accent)" stroke-width="2" fill="none" />

          <!-- Dots -->
          ${dots}

          <!-- X-axis labels -->
          ${xLabels}
        </svg>
      </div>
    </div>
  `;
}

// ─── Trade Pipeline Forecast (trade mode) ──────────────────────
function renderTradePipelineForecast(offers: Offer[]): string {
  // Filter pipeline offers: robocza, zlozona
  const pipelineOffers = offers.filter((o) => o.status === "robocza" || o.status === "zlozona");

  if (pipelineOffers.length === 0) return "";

  // Group by status
  const statusBreakdown: Record<string, { count: number; value: number }> = {};
  const pipelineStatuses: OfferStatus[] = ["robocza", "zlozona"];

  for (const status of pipelineStatuses) {
    const items = pipelineOffers.filter((o) => o.status === status);
    statusBreakdown[status] = {
      count: items.length,
      value: items.reduce((sum, o) => {
        const totals = calcOfferTotals(o.id);
        return sum + totals.totalOffer;
      }, 0),
    };
  }

  const totalValue = Object.values(statusBreakdown).reduce((sum, s) => sum + s.value, 0);

  // Build progress bar visualization
  const bars = pipelineStatuses.map((status) => {
    const breakdown = statusBreakdown[status];
    const cfg = OFFER_STATUS_CONFIG[status];
    const pct = totalValue > 0 ? (breakdown.value / totalValue) * 100 : 0;
    return `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div style="display:flex;align-items:center;gap:6px;font-size:12px">
            <span class="dash-status-dot" style="background:${cfg.color}"></span>
            <span>${cfg.label}</span>
          </div>
          <div style="text-align:right;font-size:11px">
            <div style="font-weight:600">${breakdown.count} ofert</div>
            <div style="color:var(--text-secondary)">${formatPrice(breakdown.value)} zł</div>
          </div>
        </div>
        <div style="width:100%;height:6px;background:var(--bg-primary);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${cfg.color};transition:width 0.3s ease"></div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="dash-section" style="margin-top:20px">
      <div class="dash-section-title">
        <i class="fa-solid fa-funnel" style="font-size:12px;margin-right:4px"></i> Pipeline ofert
      </div>
      <div style="background:var(--bg-secondary);padding:16px;border-radius:var(--radius)">
        ${bars}
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:12px;color:var(--text-secondary)">Łącznie w pipeline</div>
          <div style="font-size:16px;font-weight:700;color:var(--accent)">${formatPrice(totalValue)} zł</div>
        </div>
      </div>
    </div>
  `;
}

// ─── Top 10 Products Ranking (trade mode) ────────────────────────
function renderProductRanking(offers: Offer[]): string {
  // Count product names across all offer items
  const productCounts: Record<string, number> = {};

  for (const o of offers) {
    for (const item of o.items) {
      const name = item.name || "—";
      productCounts[name] = (productCounts[name] || 0) + item.quantity;
    }
  }

  const ranked = Object.entries(productCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (ranked.length === 0) return "";

  const maxQty = Math.max(...ranked.map(([_, q]) => q), 1);

  const bars = ranked.map(([name, qty]) => {
    const pct = (qty / maxQty) * 100;
    return `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
        <div style="width:120px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</div>
        <div style="flex:1">
          <div style="width:100%;height:6px;background:var(--bg-primary);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:var(--accent);transition:width 0.3s ease"></div>
          </div>
        </div>
        <div style="width:40px;text-align:right;font-size:12px;font-weight:600">${qty}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="dash-section" style="margin-top:20px">
      <div class="dash-section-title">
        <i class="fa-solid fa-cube" style="font-size:12px;margin-right:4px"></i> Top 10 produktów
      </div>
      <div style="background:var(--bg-secondary);padding:16px;border-radius:var(--radius);font-size:12px">
        ${bars}
      </div>
    </div>
  `;
}

// ─── Trade Financial Summary ────────────────────────────────────
function renderTradeFinancialSummary(offers: Offer[]): string {
  // Filter for won/active offers only
  const wonOffers = offers.filter((o) => o.status === "wygrana" || o.status === "realizacja" || o.status === "zakonczona");

  if (wonOffers.length === 0) return "";

  let totalPurchase = 0;
  let totalOffer = 0;
  let totalMargin = 0;
  let totalLogistics = 0;

  for (const o of wonOffers) {
    const totals = calcOfferTotals(o.id);
    totalPurchase += totals.totalPurchase;
    totalOffer += totals.totalOffer;
    totalMargin += totals.marginAmount;
    totalLogistics += (o.transport_cost || 0) + (o.storage_cost || 0) + (o.other_costs || 0);
  }

  const netProfit = totalMargin - totalLogistics;

  return `
    <div class="dash-section" style="margin-top:20px">
      <div class="dash-section-title">
        <i class="fa-solid fa-chart-bar" style="font-size:12px;margin-right:4px"></i> Podsumowanie finansowe (Wygrane oferty)
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
        <div style="background:var(--bg-secondary);padding:12px;border-radius:var(--radius)">
          <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Wartość ofert</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px">${formatPrice(totalOffer)} <small style="font-size:11px">zł</small></div>
          <div style="font-size:10px;color:var(--text-secondary)">${wonOffers.length} ofert wygrane</div>
        </div>
        <div style="background:var(--bg-secondary);padding:12px;border-radius:var(--radius)">
          <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Zysk z marży</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px;color:var(--success)">${formatPrice(totalMargin)} <small style="font-size:11px">zł</small></div>
          <div style="font-size:10px;color:var(--text-secondary)">różnica cena sprzedaży − zakupu</div>
        </div>
        <div style="background:var(--bg-secondary);padding:12px;border-radius:var(--radius)">
          <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Koszty logistyczne</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px;color:var(--danger)">${formatPrice(totalLogistics)} <small style="font-size:11px">zł</small></div>
          <div style="font-size:10px;color:var(--text-secondary)">transport + magazyn + inne</div>
        </div>
        <div style="background:var(--bg-secondary);padding:12px;border-radius:var(--radius)">
          <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Zysk netto</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px;color:${netProfit >= 0 ? "var(--success)" : "var(--danger)"}">${formatPrice(netProfit)} <small style="font-size:11px">zł</small></div>
          <div style="font-size:10px;color:var(--text-secondary)">marża − logistyka</div>
        </div>
      </div>
    </div>
  `;
}

// ─── Offer Timeline (delivery periods) ──────────────────────────
function renderOfferTimeline(offers: Offer[]): string {
  const withDates = offers.filter((o) =>
    (o.delivery_start || o.delivery_end) &&
    o.status !== "przegrana"
  );
  if (withDates.length === 0) return "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  let minDate = todayMs;
  let maxDate = todayMs;

  for (const o of withDates) {
    const start = o.delivery_start ? new Date(o.delivery_start + "T00:00:00").getTime() : todayMs;
    const end = o.delivery_end ? new Date(o.delivery_end + "T00:00:00").getTime() : start;
    if (start < minDate) minDate = start;
    if (end > maxDate) maxDate = end;
  }

  const pad = 14 * 24 * 60 * 60 * 1000;
  minDate -= pad;
  maxDate += pad;
  const range = maxDate - minDate || 1;

  const months: { label: string; pos: number }[] = [];
  const d = new Date(minDate);
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  while (d.getTime() < maxDate) {
    const pos = ((d.getTime() - minDate) / range) * 100;
    months.push({ label: d.toLocaleDateString("pl-PL", { month: "short" }), pos });
    d.setMonth(d.getMonth() + 1);
  }

  const todayPos = ((todayMs - minDate) / range) * 100;

  const bars = withDates.map((o) => {
    const cfg = OFFER_STATUS_CONFIG[o.status];
    const start = o.delivery_start ? new Date(o.delivery_start + "T00:00:00").getTime() : todayMs;
    const end = o.delivery_end ? new Date(o.delivery_end + "T00:00:00").getTime() : start;
    const left = ((start - minDate) / range) * 100;
    const width = Math.max(((end - start) / range) * 100, 0.5);

    const startStr = o.delivery_start ? new Date(o.delivery_start + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short" }) : "";
    const endStr = o.delivery_end ? new Date(o.delivery_end + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short" }) : "";
    const dateLabel = [startStr, endStr].filter(Boolean).join(" — ");

    return `
      <div class="timeline-row" data-dash-offer="${o.id}">
        <div class="timeline-label">
          <div class="timeline-label-name">${esc(o.name)}</div>
          <div class="timeline-label-meta">${cfg.label}${o.client ? " • " + esc(o.client) : ""}</div>
        </div>
        <div class="timeline-track">
          <div class="timeline-bar" style="left:${left}%;width:${width}%;background:${cfg.color}" title="${dateLabel}">
            <span class="timeline-bar-text">${dateLabel}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="dash-section" style="margin-top:20px">
      <div class="dash-section-title"><i class="fa-solid fa-timeline" style="font-size:12px;margin-right:4px"></i> Harmonogram dostaw</div>
      <div class="timeline-container">
        <div class="timeline-months">
          ${months.map((m) => `<div class="timeline-month-mark" style="left:${m.pos}%">${m.label}</div>`).join("")}
        </div>
        <div class="timeline-today" style="left:${todayPos}%" title="Dzisiaj"></div>
        ${bars}
      </div>
    </div>
  `;
}

// ─── Timeline ────────────────────────────────────────────────────
function renderTimeline(zlecenia: Zlecenie[]): string {
  // Only zlecenia with at least one date
  const withDates = zlecenia.filter((z) => z.date_start || z.date_end);
  if (withDates.length === 0) return "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  // Calculate range: 1 month before earliest start to 1 month after latest end
  let minDate = todayMs;
  let maxDate = todayMs;

  for (const z of withDates) {
    const start = z.date_start ? new Date(z.date_start + "T00:00:00").getTime() : todayMs;
    const end = z.date_end ? new Date(z.date_end + "T00:00:00").getTime() : start;
    if (start < minDate) minDate = start;
    if (end > maxDate) maxDate = end;
  }

  // Pad range by 2 weeks on each side
  const pad = 14 * 24 * 60 * 60 * 1000;
  minDate -= pad;
  maxDate += pad;
  const range = maxDate - minDate || 1;

  // Month markers
  const months: { label: string; pos: number }[] = [];
  const d = new Date(minDate);
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  while (d.getTime() < maxDate) {
    const pos = ((d.getTime() - minDate) / range) * 100;
    months.push({
      label: d.toLocaleDateString("pl-PL", { month: "short" }),
      pos,
    });
    d.setMonth(d.getMonth() + 1);
  }

  // Today marker
  const todayPos = ((todayMs - minDate) / range) * 100;

  // Build bars
  const bars = withDates.map((z) => {
    const status = z.status || "wycena";
    const cfg = STATUS_CONFIG[status];
    const start = z.date_start ? new Date(z.date_start + "T00:00:00").getTime() : todayMs;
    const end = z.date_end ? new Date(z.date_end + "T00:00:00").getTime() : start;
    const left = ((start - minDate) / range) * 100;
    const width = Math.max(((end - start) / range) * 100, 0.5);

    const startStr = z.date_start ? new Date(z.date_start + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short" }) : "";
    const endStr = z.date_end ? new Date(z.date_end + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short" }) : "";
    const dateLabel = [startStr, endStr].filter(Boolean).join(" — ");

    return `
      <div class="timeline-row" data-dash-zlecenie="${z.id}">
        <div class="timeline-label">
          <div class="timeline-label-name">${esc(z.name)}</div>
          <div class="timeline-label-meta">${cfg.label}${z.client ? " • " + esc(z.client) : ""}</div>
        </div>
        <div class="timeline-track">
          <div class="timeline-bar" style="left:${left}%;width:${width}%;background:${cfg.color}" title="${dateLabel}">
            <span class="timeline-bar-text">${dateLabel}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="dash-section" style="margin-top:20px">
      <div class="dash-section-title"><i class="fa-solid fa-timeline" style="font-size:12px;margin-right:4px"></i> Harmonogram zleceń</div>
      <div class="timeline-container">
        <div class="timeline-months">
          ${months.map((m) => `<div class="timeline-month-mark" style="left:${m.pos}%">${m.label}</div>`).join("")}
        </div>
        <div class="timeline-today" style="left:${todayPos}%" title="Dzisiaj"></div>
        ${bars}
      </div>
    </div>
  `;
}

// ─── Currency Widget ──────────────────────────────────────────────
function renderCurrencyWidget(): string {
  const cached = getCachedRates();
  if (cached.length === 0) {
    return `<div class="dash-section" data-currency-widget>
      <div class="dash-section-title"><i class="fa-solid fa-coins" style="font-size:12px;margin-right:4px"></i> Kursy walut NBP</div>
      <div class="cell-muted" style="font-size:12px;padding:8px">Ładowanie kursów...</div>
    </div>`;
  }
  return `<div class="dash-section" data-currency-widget>${renderCurrencyWidgetContent()}</div>`;
}

function renderCurrencyWidgetContent(): string {
  const cached = getCachedRates();
  // Show top 6 currencies as quick-access tiles
  const TOP_TILES = ["EUR", "USD", "GBP", "CHF", "CZK", "SEK"];
  const tiles = cached.filter(r => TOP_TILES.includes(r.code));

  if (tiles.length === 0) {
    return `<div class="dash-section-title"><i class="fa-solid fa-coins" style="font-size:12px;margin-right:4px"></i> Kursy walut NBP</div>
      <div class="cell-muted" style="font-size:12px;padding:8px">Brak kursów</div>`;
  }

  return `<div class="dash-section-title"><i class="fa-solid fa-coins" style="font-size:12px;margin-right:4px"></i> Kursy walut NBP <span class="cell-muted" style="font-size:10px;font-weight:400;margin-left:4px">${tiles[0]?.effectiveDate || ""}</span></div>
    <div class="currency-tiles-grid">
      ${tiles.map(r => `<div class="currency-tile" data-currency-code="${r.code}">
        <div class="currency-tile-code">${r.code}</div>
        <div class="currency-tile-rate">${r.mid.toFixed(4).replace(".", ",")}</div>
        <div class="currency-tile-label">PLN</div>
      </div>`).join("")}
    </div>
    <div id="currency-charts-area"></div>
    <div class="currency-converter-row">
      <input type="number" id="curr-amount" value="1000" min="0" step="1" class="currency-converter-input" />
      <select id="curr-from" class="currency-converter-select">
        ${POPULAR_CURRENCIES.filter(c => c !== "PLN").map(c => `<option value="${c}">${c}</option>`).join("")}
      </select>
      <span class="currency-converter-arrow"><i class="fa-solid fa-arrow-right"></i></span>
      <div id="curr-result" class="currency-converter-result">—</div>
    </div>`;
}

let _activeCurrencyCode: string | null = null;
let _activeChartRange: ChartRange = "30d";

async function loadCurrencyChart(code: string, range: ChartRange = "30d"): Promise<void> {
  const chartsArea = document.getElementById("currency-charts-area");
  if (!chartsArea) return;

  _activeCurrencyCode = code;
  _activeChartRange = range;
  const days = CHART_RANGE_DAYS[range];

  // Highlight active currency tile
  document.querySelectorAll<HTMLElement>("[data-currency-code]").forEach(el => {
    el.classList.toggle("currency-tile-active", el.dataset.currencyCode === code);
  });

  chartsArea.innerHTML = `<div class="currency-chart-loading"><div class="spinner-sm"></div> Ładowanie ${code}...</div>`;

  try {
    const data = await fetchHistoricalRates(code, days);
    if (data.length > 0) {
      chartsArea.innerHTML = renderCurrencyChart(code, data, range);
      bindChartHover(chartsArea);
      // Bind range buttons
      chartsArea.querySelectorAll<HTMLButtonElement>(".chart-range-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const newRange = btn.dataset.chartRange as ChartRange;
          loadCurrencyChart(code, newRange);
        });
      });
    } else {
      chartsArea.innerHTML = '<div class="cell-muted" style="font-size:12px;padding:16px;text-align:center">Brak danych historycznych dla tej waluty</div>';
    }
  } catch {
    chartsArea.innerHTML = '<div class="cell-muted" style="font-size:12px;padding:16px;text-align:center;color:var(--danger)">Błąd wczytywania wykresu</div>';
  }
}

function bindCurrencyWidgetEvents(): void {
  const amountInput = document.getElementById("curr-amount") as HTMLInputElement | null;
  const fromSelect = document.getElementById("curr-from") as HTMLSelectElement | null;
  const resultDiv = document.getElementById("curr-result") as HTMLDivElement | null;

  if (!amountInput || !fromSelect || !resultDiv) return;

  const updateResult = () => {
    const amount = parseFloat(amountInput.value) || 0;
    const fromCurrency = fromSelect.value;
    const result = convertToPLN(amount, fromCurrency);
    resultDiv.textContent = formatCurrency(result, "PLN");
  };

  amountInput.addEventListener("input", updateResult);
  fromSelect.addEventListener("change", updateResult);
  updateResult();

  // Currency chart click handlers
  document.querySelectorAll<HTMLElement>("[data-currency-code]").forEach(el => {
    el.addEventListener("click", () => {
      const code = el.dataset.currencyCode!;
      loadCurrencyChart(code, _activeChartRange);
    });
  });

  // Auto-load EUR chart on first visit
  if (!_activeCurrencyCode) {
    loadCurrencyChart("EUR", "30d");
  }
}

// ─── Trends chart (service mode) ──────────────────────────────────
function renderTrendsChart(zlecenia: Zlecenie[]): string {
  const months: { label: string; value: number }[] = [];
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("pl-PL", { month: "short" });
    let value = 0;

    for (const z of zlecenia) {
      const zMonth = z.created_at.slice(0, 7);
      if (zMonth === monthKey) value += calcZlecenieBrutto(z);
    }

    months.push({ label, value });
  }

  const maxVal = Math.max(...months.map(m => m.value), 1);
  const barW = 40;
  const gap = 12;
  const chartW = months.length * (barW + gap);
  const chartH = 120;

  const bars = months.map((m, i) => {
    const h = (m.value / maxVal) * (chartH - 20);
    const x = i * (barW + gap);
    const y = chartH - h - 16;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="var(--accent)" opacity="0.7" />
      <text x="${x + barW/2}" y="${chartH}" text-anchor="middle" fill="var(--text-muted)" font-size="10">${m.label}</text>
      ${m.value > 0 ? `<text x="${x + barW/2}" y="${y - 4}" text-anchor="middle" fill="var(--text-primary)" font-size="9" font-weight="600">${(m.value/1000).toFixed(0)}k</text>` : ""}`;
  }).join("");

  return `<div class="dash-section">
    <div class="dash-section-title"><i class="fa-solid fa-chart-bar" style="font-size:12px;margin-right:4px"></i> Przychody — ostatnie 6 mies.</div>
    <svg width="${chartW}" height="${chartH}" style="display:block">${bars}</svg>
  </div>`;
}

// ─── Trends chart (trade mode) ───────────────────────────────────
function renderTradeTrendsChart(offers: Offer[]): string {
  const months: { label: string; value: number }[] = [];
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("pl-PL", { month: "short" });
    let value = 0;

    for (const o of offers) {
      const oMonth = o.created_at.slice(0, 7);
      if (oMonth === monthKey) {
        const totals = calcOfferTotals(o.id);
        value += totals.totalOffer;
      }
    }

    months.push({ label, value });
  }

  const maxVal = Math.max(...months.map(m => m.value), 1);
  const barW = 40;
  const gap = 12;
  const chartW = months.length * (barW + gap);
  const chartH = 120;

  const bars = months.map((m, i) => {
    const h = (m.value / maxVal) * (chartH - 20);
    const x = i * (barW + gap);
    const y = chartH - h - 16;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="var(--accent)" opacity="0.7" />
      <text x="${x + barW/2}" y="${chartH}" text-anchor="middle" fill="var(--text-muted)" font-size="10">${m.label}</text>
      ${m.value > 0 ? `<text x="${x + barW/2}" y="${y - 4}" text-anchor="middle" fill="var(--text-primary)" font-size="9" font-weight="600">${(m.value/1000).toFixed(0)}k</text>` : ""}`;
  }).join("");

  return `<div class="dash-section">
    <div class="dash-section-title"><i class="fa-solid fa-chart-bar" style="font-size:12px;margin-right:4px"></i> Wartość ofert — ostatnie 6 mies.</div>
    <svg width="${chartW}" height="${chartH}" style="display:block">${bars}</svg>
  </div>`;
}

// ─── Profitability Report Modal (Service Mode) ──────────────────
function openProfitabilityReportModal(zlecenia: Zlecenie[], clients: any[], expenses: any[]): void {
  const now = new Date();

  // Calculate revenue by month
  const monthlyData: { month: string; revenue: number; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const monthLabel = d.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
    let revenue = 0;
    let count = 0;

    for (const z of zlecenia) {
      const zMonth = z.created_at.slice(0, 7);
      if (zMonth === monthKey) {
        revenue += calcZlecenieBrutto(z);
        count++;
      }
    }

    if (revenue > 0 || i < 2) monthlyData.push({ month: monthLabel, revenue, count });
  }

  // Top clients by revenue
  const clientRevenue: Record<string, number> = {};
  for (const z of zlecenia) {
    if (z.client) clientRevenue[z.client] = (clientRevenue[z.client] || 0) + calcZlecenieBrutto(z);
  }
  const topClients = Object.entries(clientRevenue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Status distribution
  const statusDist: Record<string, number> = {};
  for (const z of zlecenia) {
    const s = z.status || "wycena";
    statusDist[s] = (statusDist[s] || 0) + 1;
  }

  // Average value
  const totalValue = zlecenia.reduce((s, z) => s + calcZlecenieBrutto(z), 0);
  const avgValue = zlecenia.length > 0 ? totalValue / zlecenia.length : 0;

  // Total expenses
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

  openModal(`
    <h2 class="modal-title"><i class="fa-solid fa-chart-line"></i> Raport rentowności</h2>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:20px 0">
      <div style="background:var(--bg-secondary);border-radius:var(--radius);padding:16px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Przychód (brutto)</div>
        <div style="font-size:24px;font-weight:700;color:var(--success)">${formatPrice(totalValue)} zł</div>
      </div>
      <div style="background:var(--bg-secondary);border-radius:var(--radius);padding:16px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Wydatki</div>
        <div style="font-size:24px;font-weight:700;color:var(--danger)">${formatPrice(totalExpenses)} zł</div>
      </div>
      <div style="background:var(--bg-secondary);border-radius:var(--radius);padding:16px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Zysk netto (przybliżony)</div>
        <div style="font-size:24px;font-weight:700;color:var(--accent)">${formatPrice(totalValue - totalExpenses)} zł</div>
      </div>
      <div style="background:var(--bg-secondary);border-radius:var(--radius);padding:16px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Średnia wartość</div>
        <div style="font-size:24px;font-weight:700">${formatPrice(avgValue)} zł</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0">
      <div>
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Top 5 klientów</h3>
        <div style="background:var(--bg-secondary);border-radius:var(--radius);overflow:hidden">
          ${topClients.length === 0 ? '<div style="padding:16px;color:var(--text-muted)">Brak danych</div>' :
            topClients.map(([client, value]) => `
              <div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between">
                <span>${esc(client)}</span>
                <span style="font-weight:600">${formatPrice(value)} zł</span>
              </div>
            `).join("")}
        </div>
      </div>

      <div>
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Rozkład statusów</h3>
        <div style="background:var(--bg-secondary);border-radius:var(--radius);overflow:hidden">
          ${Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
            const count = statusDist[key] || 0;
            const pct = zlecenia.length > 0 ? ((count / zlecenia.length) * 100).toFixed(0) : 0;
            return count > 0 ? `
              <div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
                <div style="display:flex;align-items:center;gap:8px">
                  <span class="dash-status-dot" style="background:${cfg.color}"></span>
                  <span>${cfg.label}</span>
                </div>
                <span style="font-weight:600">${count} (${pct}%)</span>
              </div>
            ` : "";
          }).join("")}
        </div>
      </div>
    </div>

    <div style="margin:20px 0">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Przychód według miesięcy</h3>
      <div style="background:var(--bg-secondary);border-radius:var(--radius);overflow:auto;max-height:300px">
        <table style="width:100%;font-size:13px">
          <thead style="background:var(--bg-primary);position:sticky;top:0">
            <tr>
              <th style="padding:10px 12px;text-align:left;font-weight:600">Miesiąc</th>
              <th style="padding:10px 12px;text-align:right;font-weight:600">Przychód</th>
              <th style="padding:10px 12px;text-align:right;font-weight:600">Zleceń</th>
            </tr>
          </thead>
          <tbody>
            ${monthlyData.map((m) => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:10px 12px">${m.month}</td>
                <td style="padding:10px 12px;text-align:right;font-weight:600">${formatPrice(m.revenue)} zł</td>
                <td style="padding:10px 12px;text-align:right">${m.count}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn" id="btn-report-close">Zamknij</button>
    </div>
  `);

  document.getElementById("btn-report-close")!.addEventListener("click", closeModal);
}

// ─── Profitability Report Modal (Trade Mode) ────────────────────
function openTradeReportModal(offers: Offer[]): void {
  const now = new Date();

  // Calculate value by month
  const monthlyData: { month: string; value: number; count: number; profit: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const monthLabel = d.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
    let value = 0;
    let profit = 0;
    let count = 0;

    for (const o of offers) {
      const oMonth = o.created_at.slice(0, 7);
      if (oMonth === monthKey) {
        const totals = calcOfferTotals(o.id);
        value += totals.totalOffer;
        profit += totals.netProfit;
        count++;
      }
    }

    if (value > 0 || i < 2) monthlyData.push({ month: monthLabel, value, count, profit });
  }

  // Top clients by offer value
  const clientValue: Record<string, number> = {};
  for (const o of offers) {
    if (o.client) {
      const totals = calcOfferTotals(o.id);
      clientValue[o.client] = (clientValue[o.client] || 0) + totals.totalOffer;
    }
  }
  const topClients = Object.entries(clientValue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Status distribution
  const statusDist: Record<string, number> = {};
  for (const o of offers) {
    statusDist[o.status] = (statusDist[o.status] || 0) + 1;
  }

  // Profitability metrics
  const totalValue = offers.reduce((s, o) => s + calcOfferTotals(o.id).totalOffer, 0);
  const totalProfit = offers.reduce((s, o) => s + calcOfferTotals(o.id).netProfit, 0);
  const avgValue = offers.length > 0 ? totalValue / offers.length : 0;
  const avgProfit = offers.length > 0 ? totalProfit / offers.length : 0;

  // Won offers metrics
  const wonOffers = offers.filter((o) => o.status === "wygrana" || o.status === "realizacja" || o.status === "zakonczona");
  const wonValue = wonOffers.reduce((s, o) => s + calcOfferTotals(o.id).totalOffer, 0);
  const winRate = offers.filter((o) => o.status !== "robocza").length > 0
    ? Math.round((wonOffers.length / offers.filter((o) => o.status !== "robocza").length) * 100)
    : 0;

  openModal(`
    <h2 class="modal-title"><i class="fa-solid fa-chart-line"></i> Raport ofert i rentowności</h2>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:20px 0">
      <div style="background:var(--bg-secondary);border-radius:var(--radius);padding:16px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Łączna wartość</div>
        <div style="font-size:24px;font-weight:700;color:var(--accent)">${formatPrice(totalValue)} zł</div>
      </div>
      <div style="background:var(--bg-secondary);border-radius:var(--radius);padding:16px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Zysk netto</div>
        <div style="font-size:24px;font-weight:700;color:var(--success)">${formatPrice(totalProfit)} zł</div>
      </div>
      <div style="background:var(--bg-secondary);border-radius:var(--radius);padding:16px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Wygrane oferty</div>
        <div style="font-size:24px;font-weight:700">${wonOffers.length} <span style="font-size:14px;color:var(--text-muted)">(${winRate}%)</span></div>
      </div>
      <div style="background:var(--bg-secondary);border-radius:var(--radius);padding:16px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Średni zysk/oferta</div>
        <div style="font-size:24px;font-weight:700">${formatPrice(avgProfit)} zł</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0">
      <div>
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Top 5 klientów</h3>
        <div style="background:var(--bg-secondary);border-radius:var(--radius);overflow:hidden">
          ${topClients.length === 0 ? '<div style="padding:16px;color:var(--text-muted)">Brak danych</div>' :
            topClients.map(([client, value]) => `
              <div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between">
                <span>${esc(client)}</span>
                <span style="font-weight:600">${formatPrice(value)} zł</span>
              </div>
            `).join("")}
        </div>
      </div>

      <div>
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Rozkład statusów</h3>
        <div style="background:var(--bg-secondary);border-radius:var(--radius);overflow:hidden">
          ${Object.entries(OFFER_STATUS_CONFIG).map(([key, cfg]) => {
            const count = statusDist[key] || 0;
            const pct = offers.length > 0 ? ((count / offers.length) * 100).toFixed(0) : 0;
            return count > 0 ? `
              <div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
                <div style="display:flex;align-items:center;gap:8px">
                  <span class="dash-status-dot" style="background:${cfg.color}"></span>
                  <span>${cfg.label}</span>
                </div>
                <span style="font-weight:600">${count} (${pct}%)</span>
              </div>
            ` : "";
          }).join("")}
        </div>
      </div>
    </div>

    <div style="margin:20px 0">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Wartość i zysk według miesięcy</h3>
      <div style="background:var(--bg-secondary);border-radius:var(--radius);overflow:auto;max-height:300px">
        <table style="width:100%;font-size:13px">
          <thead style="background:var(--bg-primary);position:sticky;top:0">
            <tr>
              <th style="padding:10px 12px;text-align:left;font-weight:600">Miesiąc</th>
              <th style="padding:10px 12px;text-align:right;font-weight:600">Wartość</th>
              <th style="padding:10px 12px;text-align:right;font-weight:600">Zysk</th>
              <th style="padding:10px 12px;text-align:right;font-weight:600">Ofert</th>
            </tr>
          </thead>
          <tbody>
            ${monthlyData.map((m) => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:10px 12px">${m.month}</td>
                <td style="padding:10px 12px;text-align:right;font-weight:600">${formatPrice(m.value)} zł</td>
                <td style="padding:10px 12px;text-align:right;font-weight:600;color:${m.profit >= 0 ? "var(--success)" : "var(--danger)"}">${formatPrice(m.profit)} zł</td>
                <td style="padding:10px 12px;text-align:right">${m.count}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn" id="btn-trade-report-close">Zamknij</button>
    </div>
  `);

  document.getElementById("btn-trade-report-close")!.addEventListener("click", closeModal);
}

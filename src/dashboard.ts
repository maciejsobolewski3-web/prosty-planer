import type { Zlecenie, ZlecenieStatus } from "./types";
import {
  getZlecenia,
  getAllMaterialsCount,
  getAllLaborCount,
} from "./store";
import { esc, formatPrice, brutto } from "./ui";

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

// ─── Render ──────────────────────────────────────────────────────
export function initDashboard(): void {
  const page = document.getElementById("page-dashboard")!;
  const zlecenia = getZlecenia();
  const matCounts = getAllMaterialsCount();
  const laborCounts = getAllLaborCount();

  document.getElementById("topbar-title")!.textContent = "Dashboard";
  document.getElementById("topbar-actions")!.innerHTML = "";

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

    <!-- Timeline -->
    ${renderTimeline(zlecenia)}
  `;

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

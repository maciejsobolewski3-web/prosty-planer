import type { Expense, ExpenseCategory } from "./types";
import {
  getExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
  getZlecenia,
  EXPENSE_CATEGORIES,
  getExpensesTotalByMonth,
  getExpensesTotalByCategory,
  getRevenueByMonth,
  type ExpenseInput,
} from "./store";
import { esc, openModal, closeModal, showToast, formatPrice } from "./ui";

// ─── State (on window to survive Vite HMR) ─────────────────────
if (!(window as any).__ppFirmaState) {
  (window as any).__ppFirmaState = {
    currentMonth: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
    filterCategory: "all",
    activeTab: "wydatki",
  };
}
const STATE = (window as any).__ppFirmaState;

/** Timezone-safe "YYYY-MM" from Date (toISOString shifts to UTC!) */
function toYM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Global month nav listener — register ONCE ever
if (!(window as any).__ppMonthNavBound) {
  (window as any).__ppMonthNavBound = true;
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const monthBtn = target.closest("[data-go-month]") as HTMLElement | null;
    if (monthBtn && monthBtn.dataset.goMonth) {
      STATE.currentMonth = monthBtn.dataset.goMonth;
      renderPage();
    }
  });
}

export function initMojaFirma(): void {
  document.getElementById("topbar-title")!.textContent = "Moja Firma";
  document.getElementById("topbar-actions")!.innerHTML = `
    <button class="btn btn-primary" id="btn-add-expense"><i class="fa-solid fa-plus"></i> Dodaj wydatek</button>
  `;
  document.getElementById("btn-add-expense")!.addEventListener("click", () => openExpenseModal());
  renderPage();
}

function renderPage(): void {
  const page = document.getElementById("page-mojafirma")!;

  // Tabs
  const tabsHtml = `
    <div class="firma-tabs">
      <button class="firma-tab${STATE.activeTab === "wydatki" ? " active" : ""}" data-ftab="wydatki"><i class="fa-solid fa-receipt"></i> Wydatki</button>
      <button class="firma-tab${STATE.activeTab === "wykresy" ? " active" : ""}" data-ftab="wykresy"><i class="fa-solid fa-chart-column"></i> Wykresy</button>
    </div>
  `;

  if (STATE.activeTab === "wykresy") {
    page.innerHTML = tabsHtml + `<div id="charts-container"></div>`;
    bindTabs(page);
    renderCharts();
  } else {
    // Keep old flow but prepend tabs
    renderExpenses(tabsHtml);
  }
}

function bindTabs(page: HTMLElement): void {
  page.querySelectorAll<HTMLButtonElement>("[data-ftab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      STATE.activeTab = btn.dataset.ftab as "wydatki" | "wykresy";
      renderPage();
    });
  });
}

function renderExpenses(tabsHtml: string = ""): void {
  const page = document.getElementById("page-mojafirma")!;
  const allExpenses = getExpenses(STATE.currentMonth);
  const expenses = STATE.filterCategory === "all" ? allExpenses : allExpenses.filter((e) => e.category === STATE.filterCategory);

  const totalMonth = allExpenses.reduce((s, e) => s + e.amount, 0);

  // Category breakdown
  const byCat: Record<string, number> = {};
  for (const e of allExpenses) {
    byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  }

  // Month nav
  const [year, month] = STATE.currentMonth.split("-").map(Number);
  const monthName = new Date(year, month - 1).toLocaleDateString("pl-PL", { year: "numeric", month: "long" });
  const prevMonthStr = toYM(new Date(year, month - 2, 1));
  const nextMonthStr = toYM(new Date(year, month, 1));

  // Category filter pills
  const catPills = `
    <button class="group-pill${STATE.filterCategory === "all" ? " active" : ""}" data-ecat="all">Wszystkie</button>
    ${Object.entries(EXPENSE_CATEGORIES).map(([key, cfg]) => {
      const count = allExpenses.filter((e) => e.category === key).length;
      if (count === 0) return "";
      return `<button class="group-pill${STATE.filterCategory === key ? " active" : ""}" data-ecat="${key}">
        <i class="${cfg.icon}" style="font-size:10px;color:${cfg.color}"></i> ${cfg.label} (${count})
      </button>`;
    }).join("")}
  `;

  page.innerHTML = tabsHtml + `
    <!-- Month nav + summary -->
    <div class="expense-header">
      <div class="expense-month-nav">
        <button class="btn btn-sm" data-go-month="${prevMonthStr}"><i class="fa-solid fa-chevron-left"></i></button>
        <span class="expense-month-label">${monthName}</span>
        <button class="btn btn-sm" data-go-month="${nextMonthStr}"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
      <div class="expense-total">
        <span class="expense-total-label">Wydatki w miesiącu:</span>
        <span class="expense-total-value">${formatPrice(totalMonth)} zł</span>
      </div>
    </div>

    <!-- Category breakdown cards -->
    <div class="expense-cats">
      ${Object.entries(EXPENSE_CATEGORIES).map(([key, cfg]) => {
        const val = byCat[key] || 0;
        const pct = totalMonth > 0 ? Math.round((val / totalMonth) * 100) : 0;
        return `
          <div class="expense-cat-card${val === 0 ? " expense-cat-empty" : ""}">
            <div class="expense-cat-icon" style="color:${cfg.color}"><i class="${cfg.icon}"></i></div>
            <div class="expense-cat-info">
              <div class="expense-cat-name">${cfg.label}</div>
              <div class="expense-cat-amount">${val > 0 ? formatPrice(val) + " zł" : "—"}</div>
            </div>
            ${val > 0 ? `<div class="expense-cat-bar"><div class="expense-cat-bar-fill" style="width:${pct}%;background:${cfg.color}"></div></div>` : ""}
          </div>
        `;
      }).join("")}
    </div>

    <!-- Filter pills -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${catPills}</div>

    <!-- Expense table -->
    ${expenses.length === 0 ? `
      <div class="empty-state" style="padding:40px">
        <div class="empty-state-icon"><i class="fa-solid fa-receipt"></i></div>
        <h3>Brak wydatków${STATE.filterCategory !== "all" ? " w tej kategorii" : ""}</h3>
        <p>Dodaj wydatek żeby śledzić koszty firmy.</p>
      </div>
    ` : `
      <table class="data-table">
        <thead><tr>
          <th>Data</th>
          <th>Kategoria</th>
          <th>Opis</th>
          <th>Kwota</th>
          <th style="width:40px"></th>
        </tr></thead>
        <tbody>
          ${expenses.map((e) => {
            const cat = EXPENSE_CATEGORIES[e.category] || EXPENSE_CATEGORIES.inne;
            const dateStr = new Date(e.date + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
            const zlecenie = e.zlecenie_id ? getZlecenia().find((z) => z.id === e.zlecenie_id) : null;

            return `<tr>
              <td><span class="cell-mono" style="font-size:12px">${dateStr}</span></td>
              <td><span class="expense-badge" style="color:${cat.color};background:${cat.color}18"><i class="${cat.icon}" style="font-size:10px"></i> ${cat.label}</span></td>
              <td>
                <strong>${esc(e.name)}</strong>
                ${e.notes ? `<div class="cell-muted" style="font-size:11px">${esc(e.notes)}</div>` : ""}
                ${zlecenie ? `<div class="cell-muted" style="font-size:11px"><i class="fa-solid fa-link" style="font-size:9px"></i> ${esc(zlecenie.name)}</div>` : ""}
              </td>
              <td><span class="cell-mono" style="font-weight:600">${formatPrice(e.amount)} zł</span></td>
              <td>
                <div class="row-actions">
                  <button class="btn-icon" title="Edytuj" data-edit-expense="${e.id}"><i class="fa-solid fa-pen" style="font-size:11px"></i></button>
                  <button class="btn-icon" title="Usuń" data-delete-expense="${e.id}" style="color:var(--danger)"><i class="fa-solid fa-xmark"></i></button>
                </div>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    `}
  `;

  // Bindings
  bindTabs(page);
  page.querySelectorAll<HTMLButtonElement>("[data-ecat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      STATE.filterCategory = btn.dataset.ecat as ExpenseCategory | "all";
      renderPage();
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-edit-expense]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const e = getExpenses().find((x) => x.id === parseInt(btn.dataset.editExpense!));
      if (e) openExpenseModal(e);
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-delete-expense]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.confirmDelete) {
        deleteExpense(parseInt(btn.dataset.deleteExpense!));
        showToast("Wydatek usunięty");
        renderPage();
      } else {
        btn.dataset.confirmDelete = "1";
        btn.innerHTML = '<span style="font-size:11px">Pewne?</span>';
        setTimeout(() => { if (btn.isConnected) { btn.innerHTML = '<i class="fa-solid fa-xmark"></i>'; delete btn.dataset.confirmDelete; } }, 3000);
      }
    });
  });
}

// ─── Expense modal ───────────────────────────────────────────────
export function openExpenseModal(expense?: Expense, presetZlecenieId?: number, onSave?: () => void): void {
  const isEdit = !!expense;
  const zlecenia = getZlecenia();
  const selectedZid = expense?.zlecenie_id ?? presetZlecenieId ?? null;
  const zlecenieOptions = zlecenia.map((z) => `<option value="${z.id}"${selectedZid === z.id ? " selected" : ""}>${esc(z.name)}</option>`).join("");

  const catOptions = Object.entries(EXPENSE_CATEGORIES).map(([key, cfg]) =>
    `<option value="${key}"${(expense?.category || "materialy") === key ? " selected" : ""}>${cfg.label}</option>`
  ).join("");

  openModal(`
    <h2 class="modal-title">${isEdit ? "Edytuj wydatek" : "Nowy wydatek"}</h2>
    <div class="field">
      <label>Opis</label>
      <input type="text" id="f-e-name" value="${esc(expense?.name ?? "")}" placeholder="np. Farba Dulux biała 10L" />
    </div>
    <div class="field-row field-row-3">
      <div class="field">
        <label>Kwota brutto (PLN)</label>
        <input type="number" step="0.01" id="f-e-amount" value="${expense?.amount ?? ""}" placeholder="0,00" />
      </div>
      <div class="field">
        <label>Kategoria</label>
        <select id="f-e-category">${catOptions}</select>
      </div>
      <div class="field">
        <label>Data</label>
        <input type="date" id="f-e-date" value="${expense?.date ?? new Date().toISOString().slice(0, 10)}" />
      </div>
    </div>
    <div class="field">
      <label>Powiązane zlecenie (opcjonalnie)</label>
      <select id="f-e-zlecenie">
        <option value="">— brak —</option>
        ${zlecenieOptions}
      </select>
    </div>
    <div class="field">
      <label>Notatki</label>
      <input type="text" id="f-e-notes" value="${esc(expense?.notes ?? "")}" placeholder="opcjonalnie" />
    </div>
    <div class="modal-footer">
      <button class="btn" id="btn-e-cancel">Anuluj</button>
      <button class="btn btn-primary" id="btn-e-save">${isEdit ? "Zapisz" : "Dodaj"}</button>
    </div>
  `);

  setTimeout(() => (document.getElementById("f-e-name") as HTMLInputElement)?.focus(), 80);
  document.getElementById("btn-e-cancel")!.addEventListener("click", closeModal);

  const save = () => {
    const name = (document.getElementById("f-e-name") as HTMLInputElement).value.trim();
    if (!name) { (document.getElementById("f-e-name") as HTMLInputElement).focus(); return; }

    const input: ExpenseInput = {
      name,
      amount: parseFloat((document.getElementById("f-e-amount") as HTMLInputElement).value) || 0,
      category: (document.getElementById("f-e-category") as HTMLSelectElement).value as ExpenseCategory,
      zlecenie_id: (document.getElementById("f-e-zlecenie") as HTMLSelectElement).value ? parseInt((document.getElementById("f-e-zlecenie") as HTMLSelectElement).value) : null,
      date: (document.getElementById("f-e-date") as HTMLInputElement).value || new Date().toISOString().slice(0, 10),
      notes: (document.getElementById("f-e-notes") as HTMLInputElement).value.trim(),
    };

    if (isEdit && expense) {
      updateExpense(expense.id, input);
      showToast("Wydatek zaktualizowany");
    } else {
      addExpense(input);
      showToast("Wydatek dodany");
    }

    closeModal();
    renderPage();
    if (onSave) onSave();
  };

  document.getElementById("btn-e-save")!.addEventListener("click", save);
  document.getElementById("modal-box")!.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") { e.preventDefault(); save(); }
  });
}

// ═══════════════════════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════════════════════
function renderCharts(): void {
  const container = document.getElementById("charts-container")!;

  const revenueByMonth = getRevenueByMonth();
  const expensesByMonth = getExpensesTotalByMonth();
  const expensesByCat = getExpensesTotalByCategory();

  // Last 6 months
  const months: string[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(toYM(d));
  }

  const revData = months.map((m) => revenueByMonth[m] || 0);
  const expData = months.map((m) => expensesByMonth[m] || 0);
  const profitData = months.map((m, i) => revData[i] - expData[i]);
  const monthLabels = months.map((m) => {
    const [y, mo] = m.split("-").map(Number);
    return new Date(y, mo - 1).toLocaleDateString("pl-PL", { month: "short" });
  });

  const totalRev = revData.reduce((a, b) => a + b, 0);
  const totalExp = expData.reduce((a, b) => a + b, 0);
  const totalProfit = totalRev - totalExp;

  container.innerHTML = `
    <!-- Summary cards -->
    <div class="chart-summary">
      <div class="chart-summary-card">
        <div class="chart-summary-icon" style="background:var(--success-subtle);color:var(--success)"><i class="fa-solid fa-arrow-trend-up"></i></div>
        <div class="chart-summary-value" style="color:var(--success)">${formatPrice(totalRev)} zł</div>
        <div class="chart-summary-label">Przychody (6 mies.)</div>
      </div>
      <div class="chart-summary-card">
        <div class="chart-summary-icon" style="background:var(--danger-subtle);color:var(--danger)"><i class="fa-solid fa-arrow-trend-down"></i></div>
        <div class="chart-summary-value" style="color:var(--danger)">${formatPrice(totalExp)} zł</div>
        <div class="chart-summary-label">Wydatki (6 mies.)</div>
      </div>
      <div class="chart-summary-card">
        <div class="chart-summary-icon" style="background:${totalProfit >= 0 ? "var(--success-subtle);color:var(--success)" : "var(--danger-subtle);color:var(--danger)"}"><i class="fa-solid fa-coins"></i></div>
        <div class="chart-summary-value" style="color:${totalProfit >= 0 ? "var(--success)" : "var(--danger)"}">${totalProfit >= 0 ? "+" : ""}${formatPrice(totalProfit)} zł</div>
        <div class="chart-summary-label">Zysk netto (6 mies.)</div>
      </div>
    </div>

    <!-- Charts grid -->
    <div class="charts-grid">
      <div class="chart-panel">
        <div class="chart-panel-title">Przychody vs Wydatki — ostatnie 6 miesięcy</div>
        <canvas id="chart-bar" width="540" height="280"></canvas>
      </div>
      <div class="chart-panel">
        <div class="chart-panel-title">Struktura wydatków</div>
        <canvas id="chart-donut" width="300" height="280"></canvas>
        <div id="chart-donut-legend" class="chart-legend"></div>
      </div>
    </div>

    <!-- Profit line -->
    <div class="chart-panel" style="margin-top:16px">
      <div class="chart-panel-title">Zysk miesięczny</div>
      <canvas id="chart-profit" width="800" height="200"></canvas>
    </div>
  `;

  // Draw after DOM
  setTimeout(() => {
    drawBarChart("chart-bar", monthLabels, revData, expData);
    drawDonutChart("chart-donut", "chart-donut-legend", expensesByCat);
    drawProfitChart("chart-profit", monthLabels, profitData);
  }, 30);
}

// ─── Bar chart ───────────────────────────────────────────────────
function drawBarChart(canvasId: string, labels: string[], revData: number[], expData: number[]): void {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext("2d")!;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const pad = { top: 20, right: 20, bottom: 36, left: 60 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  const maxVal = Math.max(...revData, ...expData, 1000);
  const scale = ch / maxVal;
  const groupW = cw / labels.length;
  const barW = groupW * 0.3;

  // Grid
  ctx.strokeStyle = getCSS("--border") || "#2a2b3d";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + ch - (ch / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = getCSS("--text-muted") || "#666";
    ctx.font = "10px system-ui";
    ctx.textAlign = "right";
    ctx.fillText(formatK((maxVal / 4) * i), pad.left - 8, y + 3);
  }

  // Bars
  labels.forEach((label, i) => {
    const x = pad.left + groupW * i + groupW * 0.15;
    const revH = revData[i] * scale;
    const expH = expData[i] * scale;

    // Revenue bar
    ctx.fillStyle = "#30a46c";
    ctx.beginPath();
    roundedRect(ctx, x, pad.top + ch - revH, barW, revH, 3);
    ctx.fill();

    // Expense bar
    ctx.fillStyle = "#e5484d";
    ctx.beginPath();
    roundedRect(ctx, x + barW + 3, pad.top + ch - expH, barW, expH, 3);
    ctx.fill();

    // Label
    ctx.fillStyle = getCSS("--text-secondary") || "#999";
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(label, x + barW + 1, h - pad.bottom + 18);
  });

  // Legend
  ctx.font = "11px system-ui";
  const ly = 12;
  ctx.fillStyle = "#30a46c";
  ctx.fillRect(w - 180, ly - 6, 10, 10);
  ctx.fillStyle = getCSS("--text-secondary") || "#999";
  ctx.textAlign = "left";
  ctx.fillText("Przychody", w - 166, ly + 3);

  ctx.fillStyle = "#e5484d";
  ctx.fillRect(w - 90, ly - 6, 10, 10);
  ctx.fillStyle = getCSS("--text-secondary") || "#999";
  ctx.fillText("Wydatki", w - 76, ly + 3);
}

// ─── Donut chart ─────────────────────────────────────────────────
function drawDonutChart(canvasId: string, legendId: string, byCat: Record<string, number>): void {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
  const legend = document.getElementById(legendId);
  if (!canvas || !legend) return;
  const ctx = canvas.getContext("2d")!;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const total = Object.values(byCat).reduce((a, b) => a + b, 0);
  if (total === 0) {
    ctx.fillStyle = getCSS("--text-muted") || "#666";
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Brak danych", w / 2, h / 2);
    return;
  }

  const cx = w / 2;
  const cy = h / 2;
  const outerR = Math.min(w, h) / 2 - 20;
  const innerR = outerR * 0.58;

  let angle = -Math.PI / 2;
  const entries = Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  let legendHtml = "";

  entries.forEach(([key, val]) => {
    const cfg = EXPENSE_CATEGORIES[key as ExpenseCategory] || EXPENSE_CATEGORIES.inne;
    const sliceAngle = (val / total) * Math.PI * 2;
    const pct = Math.round((val / total) * 100);

    ctx.beginPath();
    ctx.arc(cx, cy, outerR, angle, angle + sliceAngle);
    ctx.arc(cx, cy, innerR, angle + sliceAngle, angle, true);
    ctx.closePath();
    ctx.fillStyle = cfg.color;
    ctx.fill();

    angle += sliceAngle;

    legendHtml += `
      <div class="chart-legend-item">
        <span class="chart-legend-dot" style="background:${cfg.color}"></span>
        <span class="chart-legend-name">${cfg.label}</span>
        <span class="chart-legend-value">${formatPrice(val)} zł (${pct}%)</span>
      </div>
    `;
  });

  // Center text
  ctx.fillStyle = getCSS("--text-primary") || "#fff";
  ctx.font = "bold 18px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(formatPrice(total), cx, cy - 2);
  ctx.fillStyle = getCSS("--text-muted") || "#666";
  ctx.font = "11px system-ui";
  ctx.fillText("zł łącznie", cx, cy + 16);

  legend.innerHTML = legendHtml;
}

// ─── Profit line chart ───────────────────────────────────────────
function drawProfitChart(canvasId: string, labels: string[], data: number[]): void {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext("2d")!;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const pad = { top: 20, right: 20, bottom: 36, left: 60 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  const maxAbs = Math.max(Math.abs(Math.min(...data)), Math.abs(Math.max(...data)), 500);
  const zeroY = pad.top + ch / 2;

  // Zero line
  ctx.strokeStyle = getCSS("--text-muted") || "#555";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(pad.left, zeroY); ctx.lineTo(w - pad.right, zeroY); ctx.stroke();
  ctx.setLineDash([]);

  // Grid
  ctx.strokeStyle = getCSS("--border") || "#2a2b3d";
  ctx.lineWidth = 0.5;
  ctx.fillStyle = getCSS("--text-muted") || "#666";
  ctx.font = "10px system-ui";
  ctx.textAlign = "right";
  ctx.fillText("0", pad.left - 8, zeroY + 3);
  ctx.fillText(formatK(maxAbs), pad.left - 8, pad.top + 6);
  ctx.fillText(formatK(-maxAbs), pad.left - 8, h - pad.bottom + 3);

  // Bars
  const barW = cw / labels.length * 0.5;

  labels.forEach((label, i) => {
    const x = pad.left + (cw / labels.length) * i + (cw / labels.length) * 0.25;
    const val = data[i];
    const barH = (Math.abs(val) / maxAbs) * (ch / 2);

    if (val >= 0) {
      ctx.fillStyle = "rgba(48, 164, 108, 0.8)";
      ctx.beginPath();
      roundedRect(ctx, x, zeroY - barH, barW, barH, 3);
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(229, 72, 77, 0.8)";
      ctx.beginPath();
      roundedRect(ctx, x, zeroY, barW, barH, 3);
      ctx.fill();
    }

    // Value above/below bar
    ctx.fillStyle = getCSS("--text-primary") || "#fff";
    ctx.font = "bold 11px system-ui";
    ctx.textAlign = "center";
    const valY = val >= 0 ? zeroY - barH - 6 : zeroY + barH + 14;
    if (Math.abs(val) > 0) {
      ctx.fillText(formatK(val), x + barW / 2, valY);
    }

    // Label
    ctx.fillStyle = getCSS("--text-secondary") || "#999";
    ctx.font = "11px system-ui";
    ctx.fillText(label, x + barW / 2, h - pad.bottom + 18);
  });
}

// ─── Canvas helpers ──────────────────────────────────────────────
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (h < 1) return;
  r = Math.min(r, h / 2, w / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function formatK(val: number): string {
  if (Math.abs(val) >= 1000) return (val / 1000).toFixed(1).replace(".", ",") + "k";
  return Math.round(val).toString();
}

function getCSS(varName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}
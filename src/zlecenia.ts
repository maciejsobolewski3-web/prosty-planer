import type { Zlecenie, ZlecenieItem, ZlecenieStatus } from "./types";
import { exportPdf } from "./pdf-export";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { openExpenseModal } from "./mojafirma";
import {
  getZlecenia,
  getZlecenieById,
  addZlecenie,
  updateZlecenie,
  deleteZlecenie,
  duplicateZlecenie,
  setZlecenieStatus,
  addZlecenieItem,
  updateZlecenieItem,
  removeZlecenieItem,
  reorderZlecenieItems,
  refreshZleceniePrices,
  getExpensesForZlecenie,
  EXPENSE_CATEGORIES,
  getMaterials,
  getLabor,
  addMaterial,
  addLabor,
  getCategories,
  getLaborCategories,
  getTemplates,
  saveAsTemplate,
  createFromTemplate,
  deleteTemplate,
  type ZlecenieInput,
  type MaterialInput,
  type LaborInput,
} from "./store";
import {
  esc,
  openModal,
  closeModal,
  showToast,
  formatPrice,
  brutto,
} from "./ui";

// ─── Status config ───────────────────────────────────────────────
const STATUS_CONFIG: Record<ZlecenieStatus, { label: string; color: string; icon: string }> = {
  wycena:        { label: "Wycena",        color: "var(--text-muted)",  icon: "fa-solid fa-pencil" },
  wyslane:       { label: "Wysłane",       color: "var(--accent)",      icon: "fa-solid fa-paper-plane" },
  zaakceptowane: { label: "Zaakceptowane", color: "var(--success)",     icon: "fa-solid fa-check" },
  odrzucone:     { label: "Odrzucone",     color: "var(--danger)",      icon: "fa-solid fa-xmark" },
  realizacja:    { label: "W realizacji",  color: "var(--warning)",     icon: "fa-solid fa-hammer" },
  zakonczone:    { label: "Zakończone",   color: "var(--success)",     icon: "fa-solid fa-flag-checkered" },
};

function statusBadge(status: ZlecenieStatus): string {
  const s = STATUS_CONFIG[status] || STATUS_CONFIG.wycena;
  return `<span class="status-badge" style="color:${s.color};background:${s.color}18"><i class="${s.icon}" style="font-size:10px"></i> ${s.label}</span>`;
}

// ─── State ───────────────────────────────────────────────────────
let activeZlecenieId: number | null = null;
let filterStatus: ZlecenieStatus | "all" = "all";

export function initZlecenia(): void {
  activeZlecenieId = null;
  filterStatus = "all";
  render();

  // Listen for open-zlecenie event from dashboard
  window.addEventListener("open-zlecenie", ((e: CustomEvent) => {
    activeZlecenieId = e.detail;
    render();
  }) as EventListener);
}

function render(): void {
  if (activeZlecenieId !== null) renderDetail(activeZlecenieId);
  else renderList();
}

// ═══════════════════════════════════════════════════════════════════
// LIST VIEW
// ═══════════════════════════════════════════════════════════════════
function renderList(): void {
  const page = document.getElementById("page-zlecenia")!;
  const allZlecenia = getZlecenia();
  const zlecenia = filterStatus === "all" ? allZlecenia : allZlecenia.filter((z) => (z.status || "wycena") === filterStatus);

  document.getElementById("topbar-title")!.textContent = "Zlecenia";
  document.getElementById("topbar-actions")!.innerHTML = `
    <button class="btn" id="btn-from-template">
      <i class="fa-solid fa-bookmark"></i> Z szablonu
    </button>
    <button class="btn btn-primary" id="btn-add-zlecenie">
      <i class="fa-solid fa-plus"></i> Nowe zlecenie
    </button>
  `;
  document.getElementById("btn-add-zlecenie")!.addEventListener("click", () => openZlecenieModal());
  document.getElementById("btn-from-template")!.addEventListener("click", () => openFromTemplateModal());

  // Status filter bar
  const statusFilters = renderStatusFilters(allZlecenia);

  if (allZlecenia.length === 0) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="fa-solid fa-file-invoice-dollar"></i></div>
        <h3>Brak zleceń</h3>
        <p>Stwórz pierwsze zlecenie i zacznij wyceniać — dodawaj materiały i robociznę z bazy lub twórz nowe pozycje na miejscu.</p>
        <button class="btn btn-primary" id="btn-empty-add-zlecenie">
          <i class="fa-solid fa-plus"></i> Nowe zlecenie
        </button>
      </div>
    `;
    page.querySelector("#btn-empty-add-zlecenie")!.addEventListener("click", () => openZlecenieModal());
    return;
  }

  page.innerHTML = statusFilters + `<div class="zlecenia-grid">${zlecenia.map((z) => {
    const totals = calcTotals(z);
    const itemCount = z.items.length;
    const date = new Date(z.updated_at).toLocaleDateString("pl-PL");
    const hasMarkup = (z.markup_materials || 0) > 0 || (z.markup_labor || 0) > 0;
    const status = z.status || "wycena";

    return `
      <div class="zlecenie-card" data-zid="${z.id}">
        <div class="zlecenie-card-header">
          <div>
            <div class="zlecenie-card-title">${esc(z.name)}</div>
            <div style="margin-top:5px">${statusBadge(status)}</div>
          </div>
          <div class="zlecenie-card-actions">
            <button class="btn-icon" title="Duplikuj" data-zduplicate="${z.id}"><i class="fa-solid fa-copy"></i></button>
            <button class="btn-icon" title="Edytuj dane" data-zedit="${z.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon" title="Usuń" data-zdelete="${z.id}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        ${z.client ? `<div class="zlecenie-card-client"><i class="fa-solid fa-user" style="font-size:11px"></i> ${esc(z.client)}</div>` : ""}
        <div class="zlecenie-card-meta">
          <span>${itemCount} pozycj${itemCount === 1 ? "a" : "i"}</span>
          <span>•</span>
          <span>${date}</span>
          ${hasMarkup ? `<span>•</span><span>narzut: mat. ${z.markup_materials || 0}% / rob. ${z.markup_labor || 0}%</span>` : ""}
        </div>
        <div class="zlecenie-card-total">
          <span class="zlecenie-card-total-label">Razem brutto${hasMarkup ? " (z narzutem)" : ""}:</span>
          <span class="zlecenie-card-total-value">${formatPrice(totals.bruttoWithMarkup)} zł</span>
        </div>
      </div>
    `;
  }).join("")}</div>`;

  // Bind
  page.querySelectorAll<HTMLElement>(".zlecenie-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-zedit], [data-zdelete], [data-zduplicate]")) return;
      activeZlecenieId = parseInt(card.dataset.zid!);
      render();
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-zedit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const z = getZlecenieById(parseInt(btn.dataset.zedit!));
      if (z) openZlecenieModal(z);
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-zduplicate]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const copy = duplicateZlecenie(parseInt(btn.dataset.zduplicate!));
      if (copy) {
        showToast(`Zduplikowano: ${copy.name}`);
        render();
      }
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-zdelete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Double-click guard: first click changes label, second deletes
      if (btn.dataset.confirmDelete) {
        deleteZlecenie(parseInt(btn.dataset.zdelete!));
        showToast("Zlecenie usunięte");
        render();
      } else {
        btn.dataset.confirmDelete = "1";
        btn.innerHTML = '<span style="font-size:11px;white-space:nowrap">Na pewno?</span>';
        btn.style.width = "auto";
        btn.style.padding = "4px 8px";
        setTimeout(() => {
          if (btn.isConnected) {
            btn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            btn.style.width = "";
            btn.style.padding = "";
            delete btn.dataset.confirmDelete;
          }
        }, 3000);
      }
    });
  });

  // Status filter bindings
  page.querySelectorAll<HTMLButtonElement>("[data-status-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filterStatus = btn.dataset.statusFilter as ZlecenieStatus | "all";
      render();
    });
  });
}

// ─── Status filters ──────────────────────────────────────────────
function renderStatusFilters(allZlecenia: Zlecenie[]): string {
  const counts: Record<string, number> = { all: allZlecenia.length };
  for (const z of allZlecenia) {
    const s = z.status || "wycena";
    counts[s] = (counts[s] || 0) + 1;
  }

  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">`;
  html += `<button class="group-pill${filterStatus === "all" ? " active" : ""}" data-status-filter="all">Wszystkie (${counts.all})</button>`;

  for (const [key, cfg] of Object.entries(STATUS_CONFIG)) {
    if (counts[key]) {
      html += `<button class="group-pill${filterStatus === key ? " active" : ""}" data-status-filter="${key}">
        <i class="${cfg.icon}" style="font-size:10px;color:${cfg.color}"></i> ${cfg.label} (${counts[key]})
      </button>`;
    }
  }

  html += `</div>`;
  return html;
}

// ═══════════════════════════════════════════════════════════════════
// DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════
function renderDetail(zId: number): void {
  const page = document.getElementById("page-zlecenia")!;
  const z = getZlecenieById(zId);

  if (!z) { activeZlecenieId = null; renderList(); return; }

  document.getElementById("topbar-title")!.textContent = z.name;
  document.getElementById("topbar-actions")!.innerHTML = `
    <button class="btn" id="btn-back-list"><i class="fa-solid fa-arrow-left"></i> Lista</button>
    <button class="btn" id="btn-refresh-prices" title="Zaktualizuj ceny z bazy danych"><i class="fa-solid fa-rotate"></i> Aktualizuj ceny</button>
    <button class="btn" id="btn-export-pdf"><i class="fa-solid fa-file-pdf"></i> PDF</button>
    <button class="btn" id="btn-export-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>
    <button class="btn" id="btn-save-template"><i class="fa-solid fa-bookmark"></i> Szablon</button>
    <button class="btn" id="btn-edit-zlecenie"><i class="fa-solid fa-gear"></i> Ustawienia</button>
    <button class="btn" id="btn-add-dojazd"><i class="fa-solid fa-car"></i> Dojazd</button>
    <button class="btn btn-primary" id="btn-add-item"><i class="fa-solid fa-plus"></i> Dodaj pozycję</button>
  `;
  document.getElementById("btn-back-list")!.addEventListener("click", () => { activeZlecenieId = null; render(); });
  document.getElementById("btn-refresh-prices")!.addEventListener("click", () => refreshPrices(z.id));
  document.getElementById("btn-export-pdf")!.addEventListener("click", () => exportPdf(z));
  document.getElementById("btn-export-csv")!.addEventListener("click", () => exportCsv(z));
  document.getElementById("btn-save-template")!.addEventListener("click", () => openSaveTemplateModal(z.id));
  document.getElementById("btn-edit-zlecenie")!.addEventListener("click", () => openZlecenieModal(z));
  document.getElementById("btn-add-dojazd")!.addEventListener("click", () => openDojazdModal(z.id));
  document.getElementById("btn-add-item")!.addEventListener("click", () => openAddItemModal(z.id));

  const totals = calcTotals(z);
  const hasMarkup = (z.markup_materials || 0) > 0 || (z.markup_labor || 0) > 0;

  // Info bar
  const currentStatus = z.status || "wycena";
  const statusOptions = Object.entries(STATUS_CONFIG).map(([key, cfg]) =>
    `<option value="${key}"${key === currentStatus ? " selected" : ""}>${cfg.label}</option>`
  ).join("");

  let infoHtml = `<div class="zlecenie-info">`;
  infoHtml += `<span class="status-select-wrap">
    <select class="status-select" id="status-select" style="color:${STATUS_CONFIG[currentStatus].color}">
      ${statusOptions}
    </select>
  </span>`;
  if (z.client) infoHtml += `<span><i class="fa-solid fa-user"></i> ${esc(z.client)}</span>`;
  if (z.notes) infoHtml += `<span><i class="fa-solid fa-note-sticky"></i> ${esc(z.notes)}</span>`;
  if (z.date_start || z.date_end) {
    const ds = z.date_start ? new Date(z.date_start + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" }) : "?";
    const de = z.date_end ? new Date(z.date_end + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" }) : "?";
    infoHtml += `<span><i class="fa-solid fa-calendar"></i> ${ds} — ${de}</span>`;
  }
  if (hasMarkup) {
    infoHtml += `<span class="zlecenie-markup-badge"><i class="fa-solid fa-percent"></i> Narzut: materiały ${z.markup_materials || 0}%, robocizna ${z.markup_labor || 0}%</span>`;
  }
  infoHtml += `</div>`;

  // Items
  let itemsHtml: string;
  if (z.items.length === 0) {
    itemsHtml = `
      <div class="empty-state" style="padding:50px 40px">
        <div class="empty-state-icon"><i class="fa-solid fa-list-check"></i></div>
        <h3>Brak pozycji</h3>
        <p>Dodaj materiały lub robociznę z bazy danych albo stwórz nowe pozycje.</p>
        <button class="btn btn-primary" id="btn-empty-add-item"><i class="fa-solid fa-plus"></i> Dodaj pozycję</button>
      </div>
    `;
  } else {
    const rows = z.items.map((item, idx) => {
      const markupPct = item.type === "material" ? (z.markup_materials || 0) : (z.markup_labor || 0);
      const priceWithMarkup = item.price_netto * (1 + markupPct / 100);
      const lineNetto = priceWithMarkup * item.quantity;
      const lineBrutto = brutto(lineNetto, item.vat_rate);

      const typeIcon = item.type === "material"
        ? '<i class="fa-solid fa-boxes-stacked" style="color:var(--warning);font-size:11px" title="Materiał"></i>'
        : '<i class="fa-solid fa-helmet-safety" style="color:var(--accent-text);font-size:11px" title="Robocizna"></i>';

      const notesHtml = item.notes
        ? `<div class="item-note" data-note-item="${item.id}" title="Kliknij żeby edytować"><i class="fa-solid fa-note-sticky" style="font-size:9px;color:var(--text-muted)"></i> ${esc(item.notes)}</div>`
        : `<div class="item-note-add" data-note-item="${item.id}" title="Dodaj notatkę"><i class="fa-solid fa-plus" style="font-size:8px"></i> notatka</div>`;

      return `<tr data-item-id="${item.id}" draggable="true">
        <td class="drag-handle" title="Przeciągnij"><i class="fa-solid fa-grip-vertical"></i></td>
        <td class="cell-lp">${idx + 1}.</td>
        <td>${typeIcon}</td>
        <td>
          <strong>${esc(item.name)}</strong>
          ${notesHtml}
        </td>
        <td><span class="cell-unit">${esc(item.unit === "m2" ? "m²" : item.unit === "m3" ? "m³" : item.unit)}</span></td>
        <td><input type="number" class="inline-edit" value="${item.quantity}" min="0" step="0.1" data-qty-item="${item.id}" /></td>
        <td>
          <div class="inline-price-wrap">
            <input type="number" class="inline-edit" value="${item.price_netto}" min="0" step="0.01" data-price-item="${item.id}" />
            <span class="cell-muted" style="font-size:10px">zł/jedn.</span>
          </div>
          ${markupPct > 0 ? `<div class="cell-muted" style="font-size:10px">z narzutem: ${formatPrice(priceWithMarkup)} zł</div>` : ""}
        </td>
        <td><span class="cell-mono">${formatPrice(lineNetto)} zł</span></td>
        <td>
          <span class="cell-mono">${formatPrice(lineBrutto)} zł</span>
          <span class="cell-muted">(${item.vat_rate}%)</span>
        </td>
        <td>
          <div class="row-actions" style="opacity:1">
            <button class="btn-icon" title="Usuń" data-remove-item="${item.id}" style="color:var(--danger)"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </td>
      </tr>`;
    }).join("");

    // Totals panel
    const showMarkupDiff = hasMarkup;

    itemsHtml = `
      <table class="data-table">
        <thead><tr>
          <th style="width:20px"></th>
          <th style="width:30px">Lp.</th>
          <th style="width:28px"></th>
          <th>Nazwa</th>
          <th>Jedn.</th>
          <th style="width:90px">Ilość</th>
          <th>Cena jedn.</th>
          <th>Netto</th>
          <th>Brutto</th>
          <th style="width:40px"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="zlecenie-totals">
        ${showMarkupDiff ? `
          <div class="zlecenie-totals-row">
            <span>Netto (baza):</span>
            <span class="cell-mono">${formatPrice(totals.nettoBase)} zł</span>
          </div>
          <div class="zlecenie-totals-row" style="color:var(--success)">
            <span>Narzut:</span>
            <span class="cell-mono">+${formatPrice(totals.markupAmount)} zł</span>
          </div>
        ` : ""}
        <div class="zlecenie-totals-row">
          <span>Netto${hasMarkup ? " (z narzutem)" : ""}:</span>
          <span class="cell-mono">${formatPrice(totals.nettoWithMarkup)} zł</span>
        </div>
        <div class="zlecenie-totals-row">
          <span>VAT:</span>
          <span class="cell-mono">${formatPrice(totals.vat)} zł</span>
        </div>
        <div class="zlecenie-totals-row zlecenie-totals-final">
          <span>Razem brutto:</span>
          <span class="cell-mono">${formatPrice(totals.bruttoWithMarkup)} zł</span>
        </div>
      </div>
    `;
  }

  // ─── Profitability panel ──────────────────────────────────────
  const linkedExpenses = getExpensesForZlecenie(z.id);
  const totalExpenses = linkedExpenses.reduce((s, e) => s + e.amount, 0);
  const totalCosts = totals.costMaterials + totalExpenses;
  const revenueNetto = totals.nettoWithMarkup;
  const profit = revenueNetto - totalCosts;
  const marginPct = revenueNetto > 0 ? (profit / revenueNetto) * 100 : 0;
  const hasCosts = totalCosts > 0;

  const profitHtml = `
    <div class="profit-panel">
      <div class="profit-panel-title">
        <span><i class="fa-solid fa-chart-pie"></i> Rentowność zlecenia</span>
        <button class="btn btn-sm" id="btn-quick-expense"><i class="fa-solid fa-plus"></i> Dodaj wydatek</button>
      </div>
      <div class="profit-cards">
        <div class="profit-card">
          <div class="profit-card-label">Przychód netto</div>
          <div class="profit-card-value">${formatPrice(revenueNetto)} zł</div>
          <div class="profit-card-sub">brutto: ${formatPrice(totals.bruttoWithMarkup)} zł</div>
        </div>
        <div class="profit-card">
          <div class="profit-card-label">Koszty łącznie</div>
          <div class="profit-card-value" style="color:var(--danger)">${hasCosts ? formatPrice(totalCosts) + " zł" : "—"}</div>
          ${hasCosts ? `<div class="profit-card-sub">
            mat. ${formatPrice(totals.costMaterials)}${totalExpenses > 0 ? ` + wyd. ${formatPrice(totalExpenses)}` : ""}
          </div>` : ""}
        </div>
        <div class="profit-card">
          <div class="profit-card-label">Zysk netto</div>
          <div class="profit-card-value" style="color:${profit >= 0 ? "var(--success)" : "var(--danger)"}">${hasCosts ? (profit >= 0 ? "+" : "") + formatPrice(profit) + " zł" : "—"}</div>
        </div>
        <div class="profit-card">
          <div class="profit-card-label">Marża</div>
          <div class="profit-card-value" style="color:${marginPct >= 0 ? "var(--success)" : "var(--danger)"}">${hasCosts ? marginPct.toFixed(1).replace(".", ",") + "%" : "—"}</div>
          ${hasCosts ? `<div class="profit-bar"><div class="profit-bar-fill" style="width:${Math.min(Math.abs(marginPct), 100)}%;background:${marginPct >= 0 ? "var(--success)" : "var(--danger)"}"></div></div>` : ""}
        </div>
      </div>

      <!-- Cost breakdown -->
      ${z.items.length > 0 ? `
        <div class="profit-cost-breakdown">
          <div class="profit-expenses-title">Struktura zlecenia</div>
          ${totals.costMaterials > 0 ? `<div class="profit-expense-row">
            <span class="expense-badge" style="color:var(--accent);background:var(--accent-bg);font-size:10px"><i class="fa-solid fa-boxes-stacked" style="font-size:9px"></i> Materiały (koszt)</span>
            <span class="profit-expense-name">${z.items.filter(i => i.type === "material").length} poz.</span>
            <span></span>
            <span class="profit-expense-amount">${formatPrice(totals.costMaterials)} zł</span>
          </div>` : ""}
          ${totals.costLabor > 0 ? `<div class="profit-expense-row" style="color:var(--success)">
            <span class="expense-badge" style="color:var(--success);background:var(--success)18;font-size:10px"><i class="fa-solid fa-helmet-safety" style="font-size:9px"></i> Robocizna (zarobek)</span>
            <span class="profit-expense-name">${z.items.filter(i => i.type === "labor").length} poz.</span>
            <span></span>
            <span class="profit-expense-amount">+${formatPrice(totals.costLabor)} zł</span>
          </div>` : ""}
          ${totals.markupAmount > 0 ? `<div class="profit-expense-row" style="color:var(--success)">
            <span class="expense-badge" style="color:var(--success);background:var(--success)18;font-size:10px"><i class="fa-solid fa-percent" style="font-size:9px"></i> Narzut</span>
            <span class="profit-expense-name">mat. ${z.markup_materials || 0}% / rob. ${z.markup_labor || 0}%</span>
            <span></span>
            <span class="profit-expense-amount">+${formatPrice(totals.markupAmount)} zł</span>
          </div>` : ""}
        </div>
      ` : ""}

      <!-- Linked expenses -->
      ${linkedExpenses.length > 0 ? `
        <div class="profit-expenses">
          <div class="profit-expenses-title">Dodatkowe wydatki (${linkedExpenses.length})</div>
          ${linkedExpenses.map((e) => {
            const cat = EXPENSE_CATEGORIES[e.category] || EXPENSE_CATEGORIES.inne;
            const dateStr = new Date(e.date + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
            return `<div class="profit-expense-row">
              <span class="expense-badge" style="color:${cat.color};background:${cat.color}18;font-size:10px"><i class="${cat.icon}" style="font-size:9px"></i> ${cat.label}</span>
              <span class="profit-expense-name">${esc(e.name)}</span>
              <span class="profit-expense-date">${dateStr}</span>
              <span class="profit-expense-amount">${formatPrice(e.amount)} zł</span>
            </div>`;
          }).join("")}
        </div>
      ` : `
        <div class="profit-empty">
          <i class="fa-solid fa-circle-check" style="color:var(--success)"></i>
          Koszty materiałów i robocizny liczone automatycznie z pozycji.
          Kliknij <strong>Dodaj wydatek</strong> żeby dodać dodatkowe koszty (dojazd, narzędzia itp.).
        </div>
      `}
    </div>
  `;

  page.innerHTML = infoHtml + itemsHtml + profitHtml;

  // Quick expense from profitability panel
  page.querySelector("#btn-quick-expense")?.addEventListener("click", () => {
    openExpenseModal(undefined, z.id, () => renderDetail(z.id));
  });

  page.querySelector("#btn-empty-add-item")?.addEventListener("click", () => openAddItemModal(z.id));

  page.querySelectorAll<HTMLInputElement>("[data-qty-item]").forEach((input) => {
    input.addEventListener("change", () => {
      updateZlecenieItem(z.id, parseInt(input.dataset.qtyItem!), { quantity: parseFloat(input.value) || 0 });
      renderDetail(z.id);
    });
  });

  page.querySelectorAll<HTMLInputElement>("[data-price-item]").forEach((input) => {
    input.addEventListener("change", () => {
      updateZlecenieItem(z.id, parseInt(input.dataset.priceItem!), { price_netto: parseFloat(input.value) || 0 });
      renderDetail(z.id);
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-remove-item]").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeZlecenieItem(z.id, parseInt(btn.dataset.removeItem!));
      showToast("Pozycja usunięta");
      renderDetail(z.id);
    });
  });

  // Notes inline edit
  page.querySelectorAll<HTMLElement>("[data-note-item]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const itemId = parseInt(el.dataset.noteItem!);
      const item = z.items.find((i) => i.id === itemId);
      if (!item) return;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "inline-note-input";
      input.value = item.notes || "";
      input.placeholder = "Dodaj notatkę...";

      el.replaceWith(input);
      input.focus();

      const save = () => {
        updateZlecenieItem(z.id, itemId, { notes: input.value.trim() });
        renderDetail(z.id);
      };

      input.addEventListener("blur", save);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); save(); }
        if (ev.key === "Escape") { renderDetail(z.id); }
      });
    });
  });

  // Status change
  const statusSelect = page.querySelector<HTMLSelectElement>("#status-select");
  if (statusSelect) {
    statusSelect.addEventListener("change", () => {
      setZlecenieStatus(z.id, statusSelect.value as ZlecenieStatus);
      const cfg = STATUS_CONFIG[statusSelect.value as ZlecenieStatus];
      statusSelect.style.color = cfg.color;
      showToast(`Status: ${cfg.label}`);
    });
  }

  // Drag & drop reorder
  initDragDrop(page, z.id);
}

// ─── Refresh prices from DB ──────────────────────────────────────
function refreshPrices(zlecenieId: number): void {
  const updated = refreshZleceniePrices(zlecenieId);
  if (updated > 0) {
    showToast(`Zaktualizowano ${updated} cen${updated === 1 ? "ę" : updated < 5 ? "y" : ""}`);
    renderDetail(zlecenieId);
  } else {
    showToast("Wszystkie ceny aktualne");
  }
}

// ─── Drag & drop ─────────────────────────────────────────────────
function initDragDrop(page: HTMLElement, zlecenieId: number): void {
  const tbody = page.querySelector<HTMLTableSectionElement>("tbody");
  if (!tbody) return;

  let dragRow: HTMLTableRowElement | null = null;

  tbody.querySelectorAll<HTMLTableRowElement>("tr[data-item-id]").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      dragRow = row;
      row.classList.add("dragging");
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", row.dataset.itemId!);
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      dragRow = null;
      // Remove all drag-over classes
      tbody.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      if (dragRow && row !== dragRow) {
        tbody.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
        row.classList.add("drag-over");
      }
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-over");
    });

    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (!dragRow || row === dragRow) return;

      // Reorder in DOM
      const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>("tr[data-item-id]"));
      const fromIdx = rows.indexOf(dragRow);
      const toIdx = rows.indexOf(row);

      if (fromIdx < toIdx) {
        row.after(dragRow);
      } else {
        row.before(dragRow);
      }

      // Save new order
      const newOrder = Array.from(tbody.querySelectorAll<HTMLTableRowElement>("tr[data-item-id]"))
        .map((r) => parseInt(r.dataset.itemId!));

      reorderZlecenieItems(zlecenieId, newOrder);
      renderDetail(zlecenieId);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// ADD ITEM MODAL
// ═══════════════════════════════════════════════════════════════════
// ─── Dojazd (travel cost) modal ─────────────────────────────────
const DOJAZD_DEFAULTS_KEY = "pp_dojazd_defaults";

interface DojazdDefaults {
  spalanie: number;   // l/100km
  cenaPaliwa: number; // zł/l
}

function getDojazdDefaults(): DojazdDefaults {
  try {
    const raw = localStorage.getItem(DOJAZD_DEFAULTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { spalanie: 8, cenaPaliwa: 6.5 };
}

function saveDojazdDefaults(d: DojazdDefaults): void {
  localStorage.setItem(DOJAZD_DEFAULTS_KEY, JSON.stringify(d));
}

function openDojazdModal(zlecenieId: number): void {
  const defaults = getDojazdDefaults();

  openModal(`
    <h2 class="modal-title"><i class="fa-solid fa-car"></i> Dodaj dojazd</h2>
    <div class="form-grid-2">
      <div class="field">
        <label>Dystans (km) — w jedną stronę</label>
        <input type="number" id="f-dojazd-km" min="0" step="0.1" placeholder="np. 25" />
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="f-dojazd-roundtrip" checked style="width:auto" />
          Tam i z powrotem
        </label>
      </div>
    </div>
    <div class="form-grid-2">
      <div class="field">
        <label>Spalanie (l/100km)</label>
        <input type="number" id="f-dojazd-spalanie" min="0" step="0.1" value="${defaults.spalanie}" />
      </div>
      <div class="field">
        <label>Cena paliwa (zł/l)</label>
        <input type="number" id="f-dojazd-cena" min="0" step="0.01" value="${defaults.cenaPaliwa}" />
      </div>
    </div>
    <div class="dojazd-calc" id="dojazd-calc" style="padding:12px 0;font-size:14px;font-weight:600;color:var(--accent)"></div>
    <div class="modal-footer">
      <button class="btn" id="btn-dojazd-cancel">Anuluj</button>
      <button class="btn btn-primary" id="btn-dojazd-save"><i class="fa-solid fa-plus"></i> Dodaj do zlecenia</button>
    </div>
  `, undefined, true);

  const kmInput = document.getElementById("f-dojazd-km") as HTMLInputElement;
  const roundtripInput = document.getElementById("f-dojazd-roundtrip") as HTMLInputElement;
  const spalanieInput = document.getElementById("f-dojazd-spalanie") as HTMLInputElement;
  const cenaInput = document.getElementById("f-dojazd-cena") as HTMLInputElement;
  const calcEl = document.getElementById("dojazd-calc")!;

  function updateCalc() {
    const km = parseFloat(kmInput.value) || 0;
    const roundtrip = roundtripInput.checked;
    const totalKm = roundtrip ? km * 2 : km;
    const spalanie = parseFloat(spalanieInput.value) || 0;
    const cena = parseFloat(cenaInput.value) || 0;
    const cost = (totalKm * spalanie / 100) * cena;
    if (totalKm > 0) {
      calcEl.innerHTML = `<i class="fa-solid fa-calculator"></i> ${totalKm.toFixed(1)} km × ${spalanie} l/100km × ${formatPrice(cena)} zł/l = <strong>${formatPrice(cost)} zł netto</strong>`;
    } else {
      calcEl.innerHTML = "";
    }
  }

  kmInput.addEventListener("input", updateCalc);
  roundtripInput.addEventListener("change", updateCalc);
  spalanieInput.addEventListener("input", updateCalc);
  cenaInput.addEventListener("input", updateCalc);
  setTimeout(() => kmInput.focus(), 50);

  document.getElementById("btn-dojazd-cancel")!.addEventListener("click", closeModal);
  document.getElementById("btn-dojazd-save")!.addEventListener("click", () => {
    const km = parseFloat(kmInput.value) || 0;
    if (km <= 0) { kmInput.focus(); return; }

    const roundtrip = roundtripInput.checked;
    const totalKm = roundtrip ? km * 2 : km;
    const spalanie = parseFloat(spalanieInput.value) || 0;
    const cena = parseFloat(cenaInput.value) || 0;
    const cost = (totalKm * spalanie / 100) * cena;

    // Save defaults for next time
    saveDojazdDefaults({ spalanie, cenaPaliwa: cena });

    const label = `Dojazd — ${totalKm.toFixed(0)} km${roundtrip ? " (tam i z powrotem)" : ""}`;

    addZlecenieItem(zlecenieId, {
      type: "labor",
      source_id: null,
      name: label,
      unit: "kpl",
      quantity: 1,
      price_netto: Math.round(cost * 100) / 100,
      vat_rate: 23,
      notes: `${totalKm} km, spalanie ${spalanie} l/100km, paliwo ${cena} zł/l`,
    });

    closeModal();
    showToast(`Dodano dojazd: ${formatPrice(cost)} zł`);
    render();
  });
}

function openAddItemModal(zlecenieId: number): void {
  openModal(`
    <h2 class="modal-title">Dodaj pozycję</h2>
    <div class="item-tabs">
      <button class="item-tab active" data-itab="search"><i class="fa-solid fa-magnifying-glass"></i> Z bazy</button>
      <button class="item-tab" data-itab="new-material"><i class="fa-solid fa-boxes-stacked"></i> Nowy materiał</button>
      <button class="item-tab" data-itab="new-labor"><i class="fa-solid fa-helmet-safety"></i> Nowa robocizna</button>
    </div>
    <div id="item-tab-content"></div>
    <div class="modal-footer">
      <button class="btn" id="btn-item-cancel">Zamknij</button>
    </div>
  `);

  document.getElementById("btn-item-cancel")!.addEventListener("click", closeModal);

  document.querySelectorAll<HTMLButtonElement>(".item-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".item-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      renderTabContent(tab.dataset.itab!, zlecenieId);
    });
  });

  renderTabContent("search", zlecenieId);
}

function renderTabContent(tab: string, zlecenieId: number): void {
  const container = document.getElementById("item-tab-content")!;
  if (tab === "search") renderSearchTab(container, zlecenieId);
  else if (tab === "new-material") renderNewMaterialTab(container, zlecenieId);
  else if (tab === "new-labor") renderNewLaborTab(container, zlecenieId);
}

// ─── Search tab ──────────────────────────────────────────────────
function renderSearchTab(container: HTMLElement, zlecenieId: number): void {
  container.innerHTML = `
    <div class="field" style="margin-top:14px">
      <input type="text" id="item-search-input" placeholder="Szukaj materiałów i robocizn..." />
    </div>
    <div id="item-search-results" class="item-search-results"></div>
  `;

  const input = document.getElementById("item-search-input") as HTMLInputElement;
  const resultsEl = document.getElementById("item-search-results")!;
  renderSearchResults(resultsEl, "", zlecenieId);

  let timeout: ReturnType<typeof setTimeout>;
  input.addEventListener("input", () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => renderSearchResults(resultsEl, input.value.trim(), zlecenieId), 150);
  });
  setTimeout(() => input.focus(), 50);
}

function renderSearchResults(container: HTMLElement, query: string, zlecenieId: number): void {
  const materials = getMaterials({ search: query || undefined }).slice(0, 15);
  const labors = getLabor({ search: query || undefined }).slice(0, 15);

  if (materials.length === 0 && labors.length === 0) {
    container.innerHTML = `<div class="cell-muted" style="padding:20px;text-align:center">Brak wyników. Stwórz nową pozycję w zakładce obok.</div>`;
    return;
  }

  let html = "";

  if (materials.length > 0) {
    html += `<div class="search-section-label"><i class="fa-solid fa-boxes-stacked"></i> Materiały</div>`;
    html += materials.map((m) => `
      <div class="search-result-item" data-add-mat="${m.id}">
        <div class="search-result-name">${esc(m.name)}</div>
        <div class="search-result-details">
          <span class="cell-unit">${esc(m.unit)}</span>
          <span class="cell-mono">${formatPrice(m.price_netto)} zł</span>
          ${m.supplier ? `<span class="cell-muted">${esc(m.supplier)}</span>` : ""}
        </div>
        <button class="btn btn-sm btn-primary search-result-add"><i class="fa-solid fa-plus"></i> Dodaj</button>
      </div>
    `).join("");
  }

  if (labors.length > 0) {
    html += `<div class="search-section-label"><i class="fa-solid fa-helmet-safety"></i> Robocizny</div>`;
    html += labors.map((l) => `
      <div class="search-result-item" data-add-labor="${l.id}">
        <div class="search-result-name">${esc(l.name)}</div>
        <div class="search-result-details">
          <span class="cell-unit">${esc(l.unit === "m2" ? "m²" : l.unit)}</span>
          <span class="cell-mono">${formatPrice(l.price_netto)} zł</span>
          <span class="cell-muted">${esc(l.category)}</span>
        </div>
        <button class="btn btn-sm btn-primary search-result-add"><i class="fa-solid fa-plus"></i> Dodaj</button>
      </div>
    `).join("");
  }

  container.innerHTML = html;

  container.querySelectorAll<HTMLElement>("[data-add-mat]").forEach((el) => {
    el.addEventListener("click", () => {
      const m = getMaterials({ show_archived: true }).find((x) => x.id === parseInt(el.dataset.addMat!));
      if (!m) return;
      addZlecenieItem(zlecenieId, { type: "material", source_id: m.id, name: m.name, unit: m.unit, quantity: 1, price_netto: m.price_netto, vat_rate: m.vat_rate, notes: "" });
      showToast(`Dodano: ${m.name}`);
      renderDetail(zlecenieId);
    });
  });

  container.querySelectorAll<HTMLElement>("[data-add-labor]").forEach((el) => {
    el.addEventListener("click", () => {
      const l = getLabor({ show_archived: true }).find((x) => x.id === parseInt(el.dataset.addLabor!));
      if (!l) return;
      addZlecenieItem(zlecenieId, { type: "labor", source_id: l.id, name: l.name, unit: l.unit, quantity: 1, price_netto: l.price_netto, vat_rate: l.vat_rate, notes: "" });
      showToast(`Dodano: ${l.name}`);
      renderDetail(zlecenieId);
    });
  });
}

// ─── New material tab ────────────────────────────────────────────
function renderNewMaterialTab(container: HTMLElement, zlecenieId: number): void {
  const categories = getCategories();
  const catOptions = categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");

  container.innerHTML = `
    <div style="margin-top:14px">
      <div class="field">
        <label>Nazwa materiału</label>
        <input type="text" id="f-nm-name" placeholder="np. Kabel YDY 3x2.5" />
      </div>
      <div class="field-row field-row-3">
        <div class="field"><label>Cena netto (PLN)</label><input type="number" step="0.01" id="f-nm-price" placeholder="0,00" /></div>
        <div class="field"><label>Jednostka</label>
          <select id="f-nm-unit">${["szt", "m", "m2", "m3", "kg", "l", "opak", "kpl"].map((u) => `<option value="${u}">${u === "m2" ? "m²" : u === "m3" ? "m³" : u}</option>`).join("")}</select>
        </div>
        <div class="field"><label>VAT</label>
          <select id="f-nm-vat"><option value="23">23%</option><option value="8">8%</option><option value="5">5%</option><option value="0">0%</option></select>
        </div>
      </div>
      <div class="field-row field-row-2">
        <div class="field"><label>Kategoria</label><select id="f-nm-category"><option value="">—</option>${catOptions}</select></div>
        <div class="field"><label>Dostawca</label><input type="text" id="f-nm-supplier" placeholder="opcjonalnie" /></div>
      </div>
      <div class="field"><label>Ilość do zlecenia</label><input type="number" step="0.1" id="f-nm-qty" value="1" min="0" /></div>
      <button class="btn btn-primary" id="btn-nm-save" style="width:100%"><i class="fa-solid fa-plus"></i> Utwórz materiał i dodaj do zlecenia</button>
    </div>
  `;

  setTimeout(() => (document.getElementById("f-nm-name") as HTMLInputElement)?.focus(), 50);

  document.getElementById("btn-nm-save")!.addEventListener("click", () => {
    const name = (document.getElementById("f-nm-name") as HTMLInputElement).value.trim();
    if (!name) { (document.getElementById("f-nm-name") as HTMLInputElement).focus(); return; }

    const input: MaterialInput = {
      name,
      unit: (document.getElementById("f-nm-unit") as HTMLSelectElement).value,
      price_netto: parseFloat((document.getElementById("f-nm-price") as HTMLInputElement).value) || 0,
      vat_rate: parseInt((document.getElementById("f-nm-vat") as HTMLSelectElement).value),
      category_id: (document.getElementById("f-nm-category") as HTMLSelectElement).value ? parseInt((document.getElementById("f-nm-category") as HTMLSelectElement).value) : null,
      supplier: (document.getElementById("f-nm-supplier") as HTMLInputElement).value.trim(),
      sku: "", url: "[]", notes: "",
    };
    const qty = parseFloat((document.getElementById("f-nm-qty") as HTMLInputElement).value) || 1;
    const mat = addMaterial(input);
    addZlecenieItem(zlecenieId, { type: "material", source_id: mat.id, name: mat.name, unit: mat.unit, quantity: qty, price_netto: mat.price_netto, vat_rate: mat.vat_rate, notes: "" });
    showToast(`Utworzono i dodano: ${name}`);
    closeModal();
    renderDetail(zlecenieId);
  });
}

// ─── New labor tab ───────────────────────────────────────────────
function renderNewLaborTab(container: HTMLElement, zlecenieId: number): void {
  const existingCats = getLaborCategories();
  const catDatalist = existingCats.map((c) => `<option value="${esc(c)}">`).join("");

  container.innerHTML = `
    <div style="margin-top:14px">
      <div class="field">
        <label>Nazwa usługi</label>
        <input type="text" id="f-nl-name" placeholder="np. Malowanie ścian" />
      </div>
      <div class="field-row field-row-3">
        <div class="field"><label>Cena netto (PLN)</label><input type="number" step="0.01" id="f-nl-price" placeholder="0,00" /></div>
        <div class="field"><label>Jednostka</label>
          <select id="f-nl-unit">${["m2", "m", "mb", "m3", "szt", "kpl", "godz", "opak", "kg"].map((u) => `<option value="${u}">${u === "m2" ? "m²" : u === "m3" ? "m³" : u}</option>`).join("")}</select>
        </div>
        <div class="field"><label>VAT</label>
          <select id="f-nl-vat"><option value="23">23%</option><option value="8">8%</option><option value="5">5%</option><option value="0">0%</option></select>
        </div>
      </div>
      <div class="field">
        <label>Kategoria</label>
        <input type="text" id="f-nl-category" list="nl-cats" placeholder="np. Malowanie, Elektryka" />
        <datalist id="nl-cats">${catDatalist}</datalist>
      </div>
      <div class="field"><label>Ilość do zlecenia</label><input type="number" step="0.1" id="f-nl-qty" value="1" min="0" /></div>
      <button class="btn btn-primary" id="btn-nl-save" style="width:100%"><i class="fa-solid fa-plus"></i> Utwórz robociznę i dodaj do zlecenia</button>
    </div>
  `;

  setTimeout(() => (document.getElementById("f-nl-name") as HTMLInputElement)?.focus(), 50);

  document.getElementById("btn-nl-save")!.addEventListener("click", () => {
    const name = (document.getElementById("f-nl-name") as HTMLInputElement).value.trim();
    if (!name) { (document.getElementById("f-nl-name") as HTMLInputElement).focus(); return; }

    const input: LaborInput = {
      name,
      unit: (document.getElementById("f-nl-unit") as HTMLSelectElement).value,
      price_netto: parseFloat((document.getElementById("f-nl-price") as HTMLInputElement).value) || 0,
      vat_rate: parseInt((document.getElementById("f-nl-vat") as HTMLSelectElement).value),
      category: (document.getElementById("f-nl-category") as HTMLInputElement).value.trim() || "Ogólne",
      notes: "",
    };
    const qty = parseFloat((document.getElementById("f-nl-qty") as HTMLInputElement).value) || 1;
    const labor = addLabor(input);
    addZlecenieItem(zlecenieId, { type: "labor", source_id: labor.id, name: labor.name, unit: labor.unit, quantity: qty, price_netto: labor.price_netto, vat_rate: labor.vat_rate, notes: "" });
    showToast(`Utworzono i dodano: ${name}`);
    closeModal();
    renderDetail(zlecenieId);
  });
}

// ═══════════════════════════════════════════════════════════════════
// ZLECENIE MODAL (create / edit)
// ═══════════════════════════════════════════════════════════════════
function openZlecenieModal(z?: Zlecenie): void {
  const isEdit = !!z;

  openModal(`
    <h2 class="modal-title">${isEdit ? "Ustawienia zlecenia" : "Nowe zlecenie"}</h2>
    <div class="field">
      <label>Nazwa zlecenia</label>
      <input type="text" id="f-z-name" value="${esc(z?.name ?? "")}" placeholder="np. Wykończenie mieszkania ul. Kwiatowa 5" />
    </div>
    <div class="field">
      <label>Klient</label>
      <input type="text" id="f-z-client" value="${esc(z?.client ?? "")}" placeholder="np. Jan Kowalski" />
    </div>

    <div class="field">
      <label>Status</label>
      <select id="f-z-status">
        ${Object.entries(STATUS_CONFIG).map(([key, cfg]) =>
          `<option value="${key}"${(z?.status || "wycena") === key ? " selected" : ""}>${cfg.label}</option>`
        ).join("")}
      </select>
    </div>

    <div class="field-row field-row-2">
      <div class="field">
        <label>Narzut na materiały (%)</label>
        <input type="number" step="1" min="0" id="f-z-markup-mat" value="${z?.markup_materials ?? 0}" />
        <div class="field-hint">Doliczany do ceny bazowej materiałów</div>
      </div>
      <div class="field">
        <label>Narzut na robociznę (%)</label>
        <input type="number" step="1" min="0" id="f-z-markup-labor" value="${z?.markup_labor ?? 0}" />
        <div class="field-hint">Doliczany do stawek robocizny</div>
      </div>
    </div>

    <div class="field-row field-row-2">
      <div class="field">
        <label>Data rozpoczęcia</label>
        <input type="date" id="f-z-date-start" value="${z?.date_start ?? ""}" />
      </div>
      <div class="field">
        <label>Data zakończenia</label>
        <input type="date" id="f-z-date-end" value="${z?.date_end ?? ""}" />
      </div>
    </div>

    <div class="field">
      <label>Notatki</label>
      <textarea id="f-z-notes" placeholder="Dodatkowe informacje...">${esc(z?.notes ?? "")}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn" id="btn-z-cancel">Anuluj</button>
      <button class="btn btn-primary" id="btn-z-save">${isEdit ? "Zapisz" : "Utwórz"}</button>
    </div>
  `, undefined, true);

  setTimeout(() => (document.getElementById("f-z-name") as HTMLInputElement)?.focus(), 80);
  document.getElementById("btn-z-cancel")!.addEventListener("click", closeModal);

  const save = () => {
    const name = (document.getElementById("f-z-name") as HTMLInputElement).value.trim();
    if (!name) { (document.getElementById("f-z-name") as HTMLInputElement).focus(); return; }

    const input: ZlecenieInput = {
      name,
      client: (document.getElementById("f-z-client") as HTMLInputElement).value.trim(),
      status: (document.getElementById("f-z-status") as HTMLSelectElement).value,
      notes: (document.getElementById("f-z-notes") as HTMLTextAreaElement).value.trim(),
      markup_materials: parseFloat((document.getElementById("f-z-markup-mat") as HTMLInputElement).value) || 0,
      markup_labor: parseFloat((document.getElementById("f-z-markup-labor") as HTMLInputElement).value) || 0,
      date_start: (document.getElementById("f-z-date-start") as HTMLInputElement).value,
      date_end: (document.getElementById("f-z-date-end") as HTMLInputElement).value,
    };

    if (isEdit && z) {
      updateZlecenie(z.id, input);
      showToast("Zlecenie zaktualizowane");
    } else {
      const newZ = addZlecenie(input);
      activeZlecenieId = newZ.id;
      showToast("Zlecenie utworzone");
    }

    closeModal();
    render();
  };

  document.getElementById("btn-z-save")!.addEventListener("click", save);
  document.getElementById("modal-box")!.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") { e.preventDefault(); save(); }
  });
}

// ═══════════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════════
function openSaveTemplateModal(zlecenieId: number): void {
  openModal(`
    <h2 class="modal-title">Zapisz jako szablon</h2>
    <div class="field">
      <label>Nazwa szablonu</label>
      <input type="text" id="f-tmpl-name" placeholder="np. Wykończenie mieszkania — standard" />
      <div class="field-hint">Szablon zapisze wszystkie pozycje i ustawienia narzutu. Użyjesz go do szybkiego tworzenia nowych zleceń.</div>
    </div>
    <div class="modal-footer">
      <button class="btn" id="btn-tmpl-cancel">Anuluj</button>
      <button class="btn btn-primary" id="btn-tmpl-save"><i class="fa-solid fa-bookmark"></i> Zapisz szablon</button>
    </div>
  `, "modal-sm");

  setTimeout(() => (document.getElementById("f-tmpl-name") as HTMLInputElement)?.focus(), 80);
  document.getElementById("btn-tmpl-cancel")!.addEventListener("click", closeModal);

  const save = () => {
    const name = (document.getElementById("f-tmpl-name") as HTMLInputElement).value.trim();
    if (!name) { (document.getElementById("f-tmpl-name") as HTMLInputElement).focus(); return; }

    const tmpl = saveAsTemplate(zlecenieId, name);
    if (tmpl) {
      showToast(`Szablon "${name}" zapisany`);
      closeModal();
    }
  };

  document.getElementById("btn-tmpl-save")!.addEventListener("click", save);
  document.getElementById("modal-box")!.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
  });
}

function openFromTemplateModal(): void {
  const templates = getTemplates();

  if (templates.length === 0) {
    openModal(`
      <h2 class="modal-title">Brak szablonów</h2>
      <p style="color:var(--text-secondary);margin-bottom:16px">Nie masz jeszcze żadnych szablonów. Otwórz zlecenie i kliknij "Szablon" żeby je zapisać.</p>
      <div class="modal-footer">
        <button class="btn" id="btn-tmpl-close">Zamknij</button>
      </div>
    `, "modal-sm");
    document.getElementById("btn-tmpl-close")!.addEventListener("click", closeModal);
    return;
  }

  openModal(`
    <h2 class="modal-title">Nowe zlecenie z szablonu</h2>
    <div class="field">
      <label>Szablon</label>
      <select id="f-from-tmpl-id">
        ${templates.map((t) => `<option value="${t.id}">${esc(t.name)} (${t.items.length} poz.)</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label>Nazwa zlecenia</label>
      <input type="text" id="f-from-tmpl-name" placeholder="np. Remont ul. Lipowa 12" />
    </div>
    <div class="field">
      <label>Klient</label>
      <input type="text" id="f-from-tmpl-client" placeholder="np. Jan Kowalski" />
    </div>
    <div class="modal-footer">
      <div style="flex:1">
        <button class="btn btn-danger btn-sm" id="btn-tmpl-delete" title="Usuń wybrany szablon">
          <i class="fa-solid fa-trash"></i> Usuń szablon
        </button>
      </div>
      <button class="btn" id="btn-from-tmpl-cancel">Anuluj</button>
      <button class="btn btn-primary" id="btn-from-tmpl-create"><i class="fa-solid fa-plus"></i> Utwórz</button>
    </div>
  `);

  setTimeout(() => (document.getElementById("f-from-tmpl-name") as HTMLInputElement)?.focus(), 80);
  document.getElementById("btn-from-tmpl-cancel")!.addEventListener("click", closeModal);

  document.getElementById("btn-tmpl-delete")!.addEventListener("click", () => {
    const tmplId = parseInt((document.getElementById("f-from-tmpl-id") as HTMLSelectElement).value);
    deleteTemplate(tmplId);
    showToast("Szablon usunięty");
    closeModal();
    openFromTemplateModal();
  });

  const create = () => {
    const name = (document.getElementById("f-from-tmpl-name") as HTMLInputElement).value.trim();
    if (!name) { (document.getElementById("f-from-tmpl-name") as HTMLInputElement).focus(); return; }

    const tmplId = parseInt((document.getElementById("f-from-tmpl-id") as HTMLSelectElement).value);
    const client = (document.getElementById("f-from-tmpl-client") as HTMLInputElement).value.trim();

    const z = createFromTemplate(tmplId, name, client);
    if (z) {
      activeZlecenieId = z.id;
      showToast(`Zlecenie utworzone z szablonu`);
      closeModal();
      render();
    }
  };

  document.getElementById("btn-from-tmpl-create")!.addEventListener("click", create);
  document.getElementById("modal-box")!.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") { e.preventDefault(); create(); }
  });
}

// ─── CSV Export ──────────────────────────────────────────────────
async function exportCsv(z: Zlecenie): Promise<void> {
  const totals = calcTotals(z);
  const hasMarkup = (z.markup_materials || 0) > 0 || (z.markup_labor || 0) > 0;
  const sep = ";"; // Excel PL uses semicolons

  const csvCell = (val: string | number): string => {
    const s = String(val);
    if (s.includes(sep) || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const priceCell = (val: number): string => val.toFixed(2).replace(".", ",");

  const lines: string[] = [];

  // Header info
  lines.push(`Zlecenie:${sep}${csvCell(z.name)}`);
  if (z.client) lines.push(`Klient:${sep}${csvCell(z.client)}`);
  if (z.notes) lines.push(`Notatki:${sep}${csvCell(z.notes)}`);
  if (hasMarkup) {
    lines.push(`Narzut materiały:${sep}${z.markup_materials || 0}%`);
    lines.push(`Narzut robocizna:${sep}${z.markup_labor || 0}%`);
  }
  lines.push("");

  // Table header
  const headers = ["Lp.", "Typ", "Nazwa", "Jedn.", "Ilość", "Cena jedn. netto"];
  if (hasMarkup) headers.push("Cena z narzutem");
  headers.push("Wartość netto", "VAT %", "Wartość brutto");
  lines.push(headers.map(csvCell).join(sep));

  // Items
  z.items.forEach((item, i) => {
    const markupPct = item.type === "material" ? (z.markup_materials || 0) : (z.markup_labor || 0);
    const priceWithMarkup = item.price_netto * (1 + markupPct / 100);
    const lineNetto = priceWithMarkup * item.quantity;
    const lineBrutto = brutto(lineNetto, item.vat_rate);

    const row: string[] = [
      String(i + 1),
      item.type === "material" ? "Materiał" : "Robocizna",
      csvCell(item.name),
      item.unit === "m2" ? "m²" : item.unit === "m3" ? "m³" : item.unit,
      priceCell(item.quantity),
      priceCell(item.price_netto),
    ];
    if (hasMarkup) row.push(priceCell(priceWithMarkup));
    row.push(priceCell(lineNetto), String(item.vat_rate) + "%", priceCell(lineBrutto));
    lines.push(row.join(sep));
  });

  // Totals
  lines.push("");
  if (hasMarkup) {
    lines.push(`${sep}${sep}${sep}${sep}${sep}${sep}Netto (baza):${sep}${priceCell(totals.nettoBase)}`);
    lines.push(`${sep}${sep}${sep}${sep}${sep}${sep}Narzut:${sep}${priceCell(totals.markupAmount)}`);
  }
  lines.push(`${sep}${sep}${sep}${sep}${sep}${hasMarkup ? sep : ""}Razem netto:${sep}${priceCell(totals.nettoWithMarkup)}`);
  lines.push(`${sep}${sep}${sep}${sep}${sep}${hasMarkup ? sep : ""}VAT:${sep}${priceCell(totals.vat)}`);
  lines.push(`${sep}${sep}${sep}${sep}${sep}${hasMarkup ? sep : ""}Razem brutto:${sep}${priceCell(totals.bruttoWithMarkup)}`);

  // BOM for Excel to recognize UTF-8
  const bom = "\uFEFF";
  const csv = bom + lines.join("\r\n");
  const safeName = z.name.replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ _-]/g, "_");

  try {
    const filePath = await save({
      title: "Zapisz CSV",
      defaultPath: `${safeName}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;
    await writeTextFile(filePath, csv);
    showToast("CSV wyeksportowany");
  } catch (err) {
    console.error("CSV export error:", err);
  }
}

// ─── Totals calculation ──────────────────────────────────────────
interface ZlecenieTotals {
  nettoBase: number;
  markupAmount: number;
  nettoWithMarkup: number;
  vat: number;
  bruttoWithMarkup: number;
  // Cost breakdown (base netto by type)
  costMaterials: number;   // netto base cost of materials
  costLabor: number;       // netto base cost of labor
}

function calcTotals(z: Zlecenie): ZlecenieTotals {
  let nettoBase = 0;
  let nettoWithMarkup = 0;
  let bruttoWithMarkup = 0;
  let costMaterials = 0;
  let costLabor = 0;

  for (const item of z.items) {
    const lineBase = item.price_netto * item.quantity;
    const markupPct = item.type === "material" ? (z.markup_materials || 0) : (z.markup_labor || 0);
    const lineWithMarkup = lineBase * (1 + markupPct / 100);

    nettoBase += lineBase;
    nettoWithMarkup += lineWithMarkup;
    bruttoWithMarkup += brutto(lineWithMarkup, item.vat_rate);

    if (item.type === "material") {
      costMaterials += lineBase;
    } else {
      costLabor += lineBase;
    }
  }

  return {
    nettoBase,
    markupAmount: nettoWithMarkup - nettoBase,
    nettoWithMarkup,
    vat: bruttoWithMarkup - nettoWithMarkup,
    bruttoWithMarkup,
    costMaterials,
    costLabor,
  };
}

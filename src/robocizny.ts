import type { Labor } from "./types";
import {
  getLabor,
  addLabor,
  updateLabor,
  deleteLabor,
  toggleLaborFavorite,
  archiveLabor,
  getLaborCategories,
  type LaborFilter,
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

// ─── State ───────────────────────────────────────────────────────
let currentFilter: LaborFilter = {};
let currentGroupBy: "none" | "category" | "unit" = "none";
let filterView: "all" | "favorites" | "archived" = "all";
let filterCategory: string | null = null;

// ─── Public API ──────────────────────────────────────────────────
export function setLaborSearch(search: string): void {
  currentFilter.search = search || undefined;
  render();
}

// ─── Render ──────────────────────────────────────────────────────
function render(): void {
  const page = document.getElementById("page-robocizny")!;

  // rebuild filter
  currentFilter = {};
  if (filterView === "favorites") currentFilter.favorites_only = true;
  if (filterView === "archived") currentFilter.show_archived = true;
  if (filterCategory) currentFilter.category = filterCategory;

  const items = getLabor(currentFilter);

  // Topbar
  let title = "Robocizny";
  if (filterView === "favorites") title = "Robocizny — Ulubione";
  if (filterView === "archived") title = "Robocizny — Archiwum";
  if (filterCategory) title = filterCategory;
  document.getElementById("topbar-title")!.textContent = title;

  document.getElementById("topbar-actions")!.innerHTML = `
    <button class="btn btn-primary" id="btn-add-labor">
      <i class="fa-solid fa-plus"></i> Dodaj robociznę
    </button>
  `;
  document.getElementById("btn-add-labor")!.addEventListener("click", () => openLaborModal());

  if (items.length === 0) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="fa-solid fa-helmet-safety"></i></div>
        <h3>Brak robocizn</h3>
        <p>Dodaj usługi i stawki robocizny — malowanie, elektryka, hydraulika itp.</p>
        <button class="btn btn-primary" id="btn-empty-add-labor">
          <i class="fa-solid fa-plus"></i> Dodaj robociznę
        </button>
      </div>
    `;
    page.querySelector("#btn-empty-add-labor")!.addEventListener("click", () => openLaborModal());
    return;
  }

  page.innerHTML = renderViewFilters() + renderGroupBar() + renderTable(items);
  bindViewFilters(page);
  bindGroupBar();
  bindTableEvents(page);
}

// ─── View filters (all / favorites / archived / category) ────────
function renderViewFilters(): string {
  const cats = getLaborCategories();
  const allItems = getLabor({});
  const favCount = allItems.filter((l) => l.is_favorite).length;
  const archCount = getLabor({ show_archived: true }).filter((l) => l.is_archived).length;

  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">`;
  html += `<button class="group-pill${filterView === "all" && !filterCategory ? " active" : ""}" data-lview="all">Wszystkie (${allItems.length})</button>`;
  html += `<button class="group-pill${filterView === "favorites" ? " active" : ""}" data-lview="favorites"><i class="fa-solid fa-star" style="font-size:10px;color:var(--warning)"></i> Ulubione (${favCount})</button>`;
  html += `<button class="group-pill${filterView === "archived" ? " active" : ""}" data-lview="archived">Archiwum (${archCount})</button>`;

  for (const cat of cats) {
    const count = allItems.filter((l) => l.category === cat).length;
    html += `<button class="group-pill${filterCategory === cat ? " active" : ""}" data-lcat="${esc(cat)}">${esc(cat)} (${count})</button>`;
  }

  html += `</div>`;
  return html;
}

function bindViewFilters(page: HTMLElement): void {
  page.querySelectorAll<HTMLButtonElement>("[data-lview]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filterView = btn.dataset.lview as "all" | "favorites" | "archived";
      filterCategory = null;
      render();
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-lcat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filterCategory = btn.dataset.lcat!;
      filterView = "all";
      render();
    });
  });
}

// ─── Group bar ───────────────────────────────────────────────────
function renderGroupBar(): string {
  const pills = [
    { key: "none", label: "Brak" },
    { key: "category", label: "Kategoria" },
    { key: "unit", label: "Jednostka" },
  ];
  return `
    <div class="group-bar">
      <span class="group-bar-label">Grupuj:</span>
      ${pills.map((p) => `<button class="group-pill${currentGroupBy === p.key ? " active" : ""}" data-lgroup="${p.key}">${p.label}</button>`).join("")}
    </div>
  `;
}

function bindGroupBar(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-lgroup]").forEach((pill) => {
    pill.addEventListener("click", () => {
      currentGroupBy = pill.dataset.lgroup as "none" | "category" | "unit";
      render();
    });
  });
}

// ─── Table ───────────────────────────────────────────────────────
interface LaborGroup {
  key: string;
  label: string;
  items: Labor[];
}

function groupItems(items: Labor[]): LaborGroup[] {
  if (currentGroupBy === "none") {
    return [{ key: "_all", label: "", items }];
  }

  const map = new Map<string, LaborGroup>();
  for (const l of items) {
    let key: string, label: string;

    if (currentGroupBy === "category") {
      key = l.category || "_brak";
      label = l.category || "Brak kategorii";
    } else {
      key = l.unit;
      label = l.unit;
    }

    if (!map.has(key)) map.set(key, { key, label, items: [] });
    map.get(key)!.items.push(l);
  }

  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "pl"));
}

function renderTable(items: Labor[]): string {
  const groups = groupItems(items);
  const showHeaders = currentGroupBy !== "none";
  const colCount = 8;

  let rows = "";
  for (const group of groups) {
    if (showHeaders) {
      rows += `<tr class="group-header-row"><td colspan="${colCount}">
        <div class="group-header-label">
          ${esc(group.label)}
          <span class="group-header-count">(${group.items.length})</span>
        </div>
      </td></tr>`;
    }

    for (const l of group.items) {
      const prBrutto = brutto(l.price_netto, l.vat_rate);
      rows += `<tr data-lid="${l.id}">
        <td>
          <span class="cell-fav${l.is_favorite ? " active" : ""}" data-lfav="${l.id}">
            <i class="fa-${l.is_favorite ? "solid" : "regular"} fa-star"></i>
          </span>
        </td>
        <td><strong>${esc(l.name)}</strong></td>
        <td><span class="cell-unit">${esc(l.unit === "m2" ? "m²" : l.unit === "m3" ? "m³" : l.unit)}</span></td>
        <td><span class="cell-mono">${formatPrice(l.price_netto)} zł</span></td>
        <td>
          <span class="cell-mono">${formatPrice(prBrutto)} zł</span>
          <span class="cell-muted">(${l.vat_rate}%)</span>
        </td>
        <td><span class="cell-badge" style="background:var(--accent-subtle);color:var(--accent-text)">${esc(l.category)}</span></td>
        <td><span class="cell-muted">${esc(l.notes) || "—"}</span></td>
        <td>
          <div class="row-actions">
            <button class="btn-icon" title="Edytuj" data-ledit="${l.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon" title="Archiwizuj" data-larchive="${l.id}"><i class="fa-solid fa-box-archive"></i></button>
            <button class="btn-icon" title="Usuń" data-ldelete="${l.id}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
    }
  }

  return `
    <table class="data-table">
      <thead><tr>
        <th style="width:30px"></th>
        <th>Nazwa usługi</th>
        <th>Jedn.</th>
        <th>Netto</th>
        <th>Brutto</th>
        <th>Kategoria</th>
        <th>Notatki</th>
        <th style="width:100px"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ─── Table events ────────────────────────────────────────────────
function bindTableEvents(page: HTMLElement): void {
  page.querySelectorAll<HTMLElement>("[data-lfav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleLaborFavorite(parseInt(el.dataset.lfav!));
      render();
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-ledit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.ledit!);
      const item = getLabor({ show_archived: true }).find((l) => l.id === id);
      if (item) openLaborModal(item);
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-larchive]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      archiveLabor(parseInt(btn.dataset.larchive!));
      showToast("Robocizna zarchiwizowana");
      render();
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-ldelete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm("Na pewno usunąć tę robociznę?")) return;
      deleteLabor(parseInt(btn.dataset.ldelete!));
      showToast("Robocizna usunięta");
      render();
    });
  });

  page.querySelectorAll<HTMLTableRowElement>("tr[data-lid]").forEach((tr) => {
    tr.addEventListener("dblclick", () => {
      const id = parseInt(tr.dataset.lid!);
      const item = getLabor({ show_archived: true }).find((l) => l.id === id);
      if (item) openLaborModal(item);
    });
  });
}

// ─── Modal ───────────────────────────────────────────────────────
function openLaborModal(labor?: Labor): void {
  const isEdit = !!labor;
  const existingCats = getLaborCategories();

  const catDatalist = existingCats.map((c) => `<option value="${esc(c)}">`).join("");

  openModal(`
    <h2 class="modal-title">${isEdit ? "Edytuj robociznę" : "Dodaj robociznę"}</h2>

    <div class="field">
      <label>Nazwa usługi</label>
      <input type="text" id="f-l-name" value="${esc(labor?.name ?? "")}" placeholder="np. Malowanie ścian" />
    </div>

    <div class="field-row field-row-3">
      <div class="field">
        <label>Cena netto (PLN)</label>
        <input type="number" step="0.01" id="f-l-price" value="${labor?.price_netto ?? ""}" placeholder="0,00" />
      </div>
      <div class="field">
        <label>Jednostka</label>
        <select id="f-l-unit">
          ${["m2", "m", "mb", "m3", "szt", "kpl", "godz", "opak", "kg"].map((u) => {
            const display = u === "m2" ? "m²" : u === "m3" ? "m³" : u;
            return `<option value="${u}"${labor?.unit === u ? " selected" : ""}>${display}</option>`;
          }).join("")}
        </select>
      </div>
      <div class="field">
        <label>VAT (%)</label>
        <select id="f-l-vat">
          ${[23, 8, 5, 0].map((v) => `<option value="${v}"${labor?.vat_rate === v ? " selected" : ""}>${v}%</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="field">
      <label>Kategoria</label>
      <input type="text" id="f-l-category" list="labor-cats" value="${esc(labor?.category ?? "")}" placeholder="np. Malowanie, Elektryka, Hydraulika" />
      <datalist id="labor-cats">${catDatalist}</datalist>
      <div class="field-hint">Wpisz istniejącą lub nową kategorię</div>
    </div>

    <div class="field">
      <label>Notatki</label>
      <textarea id="f-l-notes" placeholder="Dodatkowe informacje...">${esc(labor?.notes ?? "")}</textarea>
    </div>

    <div class="modal-footer">
      <button class="btn" id="btn-l-cancel">Anuluj</button>
      <button class="btn btn-primary" id="btn-l-save">${isEdit ? "Zapisz" : "Dodaj"}</button>
    </div>
  `);

  setTimeout(() => (document.getElementById("f-l-name") as HTMLInputElement)?.focus(), 80);

  document.getElementById("btn-l-cancel")!.addEventListener("click", closeModal);

  document.getElementById("btn-l-save")!.addEventListener("click", () => {
    saveLaborFromModal(labor?.id);
  });

  document.getElementById("modal-box")!.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
      e.preventDefault();
      saveLaborFromModal(labor?.id);
    }
  });
}

function saveLaborFromModal(editId?: number): void {
  const name = (document.getElementById("f-l-name") as HTMLInputElement).value.trim();
  if (!name) {
    (document.getElementById("f-l-name") as HTMLInputElement).focus();
    return;
  }

  const input: LaborInput = {
    name,
    unit: (document.getElementById("f-l-unit") as HTMLSelectElement).value,
    price_netto: parseFloat((document.getElementById("f-l-price") as HTMLInputElement).value) || 0,
    vat_rate: parseInt((document.getElementById("f-l-vat") as HTMLSelectElement).value),
    category: (document.getElementById("f-l-category") as HTMLInputElement).value.trim() || "Ogólne",
    notes: (document.getElementById("f-l-notes") as HTMLTextAreaElement).value.trim(),
  };

  if (editId) {
    updateLabor(editId, input);
    showToast("Robocizna zaktualizowana");
  } else {
    addLabor(input);
    showToast("Robocizna dodana");
  }

  closeModal();
  render();
}

// ─── Init ────────────────────────────────────────────────────────
export function initRobocizny(): void {
  render();
}

import type { Material, MaterialLink, GroupBy } from "./types";
import {
  getMaterials,
  addMaterial,
  updateMaterial,
  deleteMaterial,
  toggleFavorite,
  archiveMaterial,
  getCategories,
  getCategoryById,
  getAllPriceHistory,
  type MaterialFilter,
  type MaterialInput,
} from "./store";
import {
  esc,
  openModal,
  closeModal,
  showToast,
  formatPrice,
  brutto,
  parseLinks,
  extractDomain,
  renderSortableHeader,
  bindSortHeaders,
  sortArray,
  checkDuplicateName,
  type SortState,
} from "./ui";

// ─── Module state ────────────────────────────────────────────────
let currentFilter: MaterialFilter = {};
let currentGroupBy: GroupBy = "none";
let filterCategoryId: number | null = null;
let filterView: "all" | "favorites" | "archived" = "all";
let modalLinks: MaterialLink[] = [];
let matSortState: SortState = { column: "name", dir: "asc" };
let selectedMaterials: Set<number> = new Set();
let selectAllChecked = false;

// ─── Public: called from main.ts on filter changes ──────────────
export function setFilterView(view: "all" | "favorites" | "archived"): void {
  filterView = view;
  filterCategoryId = null;
  rebuildFilter();
  render();
}

export function setFilterCategory(catId: number | null): void {
  filterCategoryId = catId;
  filterView = "all";
  rebuildFilter();
  render();
}

export function setSearch(search: string): void {
  currentFilter.search = search || undefined;
  render();
}

function rebuildFilter(): void {
  currentFilter = {};
  if (filterView === "favorites") currentFilter.favorites_only = true;
  if (filterView === "archived") currentFilter.show_archived = true;
  if (filterCategoryId !== null) currentFilter.category_id = filterCategoryId;
}

// ─── Render ──────────────────────────────────────────────────────
function render(): void {
  const page = document.getElementById("page-materialy")!;
  const materials = getMaterials(currentFilter);
  const categories = getCategories();

  // Topbar title
  let title = "Materiały";
  if (filterView === "favorites") title = "Ulubione";
  if (filterView === "archived") title = "Archiwum";
  if (filterCategoryId !== null) {
    const cat = getCategoryById(filterCategoryId);
    if (cat) title = cat.name;
  }
  document.getElementById("topbar-title")!.textContent = title;

  // Topbar action buttons
  document.getElementById("topbar-actions")!.innerHTML = `
    <button class="btn btn-primary" id="btn-add-material">
      <i class="fa-solid fa-plus"></i> Dodaj materiał
    </button>
    <button class="btn btn-secondary" id="btn-import-csv">
      <i class="fa-solid fa-file-import"></i> Import CSV
    </button>
    <input type="file" id="csv-file-input" accept=".csv" style="display:none" />
  `;
  document.getElementById("btn-add-material")!.addEventListener("click", () => openMaterialModal());
  document.getElementById("btn-import-csv")!.addEventListener("click", () => {
    (document.getElementById("csv-file-input") as HTMLInputElement).click();
  });
  (document.getElementById("csv-file-input") as HTMLInputElement).addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const csv = event.target?.result as string;
        importMaterialsFromCSV(csv);
      };
      reader.readAsText(file);
      (e.target as HTMLInputElement).value = "";
    }
  });

  // Page content
  if (materials.length === 0) {
    page.innerHTML = renderEmpty();
    const btn = page.querySelector("#btn-empty-add");
    if (btn) btn.addEventListener("click", () => openMaterialModal());
    return;
  }

  page.innerHTML = renderGroupBar() + renderTable(materials, categories) + renderBulkActionBar();
  bindGroupBar();
  bindTableEvents(page);
  bindBulkActionBar(page);
}

function renderEmpty(): string {
  return `
    <div class="empty-state">
      <div class="empty-state-icon"><i class="fa-solid fa-boxes-stacked"></i></div>
      <h3>Brak materiałów</h3>
      <p>Dodaj pierwszy materiał do bazy. Z czasem zbudujesz cennik, który przyspieszy wyceny zleceń.</p>
      <button class="btn btn-primary" id="btn-empty-add">
        <i class="fa-solid fa-plus"></i> Dodaj materiał
      </button>
    </div>
  `;
}

// ─── Group bar ───────────────────────────────────────────────────
function renderGroupBar(): string {
  const pills = [
    { key: "none", label: "Brak" },
    { key: "category", label: "Kategoria" },
    { key: "supplier", label: "Dostawca" },
    { key: "unit", label: "Jednostka" },
  ];
  return `
    <div class="group-bar">
      <span class="group-bar-label">Grupuj:</span>
      ${pills.map((p) => `<button class="group-pill${currentGroupBy === p.key ? " active" : ""}" data-group="${p.key}">${p.label}</button>`).join("")}
    </div>
  `;
}

function bindGroupBar(): void {
  document.querySelectorAll<HTMLButtonElement>(".group-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      currentGroupBy = pill.dataset.group as GroupBy;
      render();
    });
  });
}

// ─── Table ───────────────────────────────────────────────────────
interface MaterialGroup {
  key: string;
  label: string;
  color: string | null;
  items: Material[];
}

function groupMaterials(materials: Material[]): MaterialGroup[] {
  if (currentGroupBy === "none") {
    return [{ key: "_all", label: "", color: null, items: materials }];
  }

  const map = new Map<string, MaterialGroup>();
  const categories = getCategories();

  for (const m of materials) {
    let key: string, label: string, color: string | null = null;

    switch (currentGroupBy) {
      case "category": {
        const cat = categories.find((c) => c.id === m.category_id);
        key = String(m.category_id ?? 0);
        label = cat?.name ?? "Bez kategorii";
        color = cat?.color ?? "#555870";
        break;
      }
      case "supplier":
        key = (m.supplier || "").toLowerCase() || "_brak";
        label = m.supplier || "Brak dostawcy";
        break;
      case "unit":
        key = m.unit;
        label = m.unit;
        break;
    }

    if (!map.has(key)) map.set(key, { key, label, color, items: [] });
    map.get(key)!.items.push(m);
  }

  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "pl"));
}

function renderTable(materials: Material[], _categories: typeof getCategories extends () => infer R ? R : never): string {
  const groups = groupMaterials(materials);
  const showGroupHeaders = currentGroupBy !== "none";
  const colCount = 10;

  let rows = "";
  for (const group of groups) {
    if (showGroupHeaders) {
      rows += `<tr class="group-header-row"><td colspan="${colCount}">
        <div class="group-header-label">
          ${group.color ? `<span class="sidebar-cat-dot" style="background:${group.color}"></span>` : ""}
          ${esc(group.label)}
          <span class="group-header-count">(${group.items.length})</span>
        </div>
      </td></tr>`;
    }

    // Sort items within group
    const sortedItems = sortArray(group.items, matSortState.column, matSortState.dir, (m, col) => {
      switch (col) {
        case "name": return m.name;
        case "unit": return m.unit;
        case "price_netto": return m.price_netto;
        case "brutto": return brutto(m.price_netto, m.vat_rate);
        case "supplier": return m.supplier;
        default: return m.name;
      }
    });

    for (const m of sortedItems) {
      const cat = getCategoryById(m.category_id);
      const links = parseLinks(m.url);
      const prBrutto = brutto(m.price_netto, m.vat_rate);
      const isSelected = selectedMaterials.has(m.id);

      rows += `<tr data-id="${m.id}" class="${isSelected ? "selected" : ""}">
        <td>
          <input type="checkbox" class="material-checkbox" data-mat-id="${m.id}" ${isSelected ? "checked" : ""} />
        </td>
        <td>
          <span class="cell-fav${m.is_favorite ? " active" : ""}" data-fav="${m.id}">
            <i class="fa-${m.is_favorite ? "solid" : "regular"} fa-star"></i>
          </span>
        </td>
        <td><strong>${esc(m.name)}</strong></td>
        <td><span class="cell-unit">${esc(m.unit)}</span></td>
        <td><span class="cell-mono">${formatPrice(m.price_netto)} zł</span></td>
        <td>
          <span class="cell-mono">${formatPrice(prBrutto)} zł</span>
          <span class="cell-muted">(${m.vat_rate}%)</span>
        </td>
        <td>${cat ? `<span class="cell-badge" style="background:${cat.color}22;color:${cat.color}">${esc(cat.name)}</span>` : '<span class="cell-muted">—</span>'}</td>
        <td><span class="cell-muted">${esc(m.supplier) || "—"}</span></td>
        <td>${renderLinkChips(links)}</td>
        <td>
          <div class="row-actions">
            <button class="btn-icon" title="Edytuj" data-edit="${m.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon" title="Duplikuj" data-clone="${m.id}"><i class="fa-solid fa-copy"></i></button>
            <button class="btn-icon" title="Archiwizuj" data-archive="${m.id}"><i class="fa-solid fa-box-archive"></i></button>
            <button class="btn-icon" title="Usuń" data-delete="${m.id}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
    }
  }

  return `
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr>
          <th style="width:30px"><input type="checkbox" id="select-all-checkbox" ${selectAllChecked ? "checked" : ""} /></th>
          <th style="width:30px"></th>
          ${renderSortableHeader("Nazwa", "name", matSortState)}
          ${renderSortableHeader("Jedn.", "unit", matSortState)}
          ${renderSortableHeader("Netto", "price_netto", matSortState)}
          ${renderSortableHeader("Brutto", "brutto", matSortState)}
          <th>Kategoria</th>
          ${renderSortableHeader("Dostawca", "supplier", matSortState)}
          <th>Linki</th>
          <th style="width:100px"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderLinkChips(links: MaterialLink[]): string {
  if (links.length === 0) return '<span class="cell-muted">—</span>';
  return `<div class="link-chips">${links
    .map(
      (l) =>
        `<a class="link-chip" href="${esc(l.url)}" target="_blank" title="${esc(l.url)}" data-external-link>
          <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:9px"></i>
          ${esc(l.label || extractDomain(l.url))}
        </a>`
    )
    .join("")}</div>`;
}

// ─── Table events ────────────────────────────────────────────────
// Sort handler (must be first before other event bindings follow)
// Added inside the render() method below
function bindTableEvents(page: HTMLElement): void {
  // Sort headers
  bindSortHeaders(page, matSortState, (newState) => {
    matSortState = newState;
    render();
  });

  // Select all checkbox
  const selectAllCheckbox = page.querySelector<HTMLInputElement>("#select-all-checkbox");
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", () => {
      selectAllChecked = selectAllCheckbox.checked;
      const allMaterials = getMaterials(currentFilter);
      if (selectAllChecked) {
        allMaterials.forEach((m) => selectedMaterials.add(m.id));
      } else {
        selectedMaterials.clear();
      }
      render();
    });
  }

  // Individual material checkboxes
  page.querySelectorAll<HTMLInputElement>(".material-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = parseInt(checkbox.dataset.matId!);
      if (checkbox.checked) {
        selectedMaterials.add(id);
      } else {
        selectedMaterials.delete(id);
        selectAllChecked = false;
      }
      render();
    });
  });

  // Favorite toggle
  page.querySelectorAll<HTMLElement>("[data-fav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(parseInt(el.dataset.fav!));
      render();
      notifySidebarUpdate();
    });
  });

  // Edit
  page.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.edit!);
      const mat = getMaterials({ show_archived: true }).find((m) => m.id === id);
      if (mat) openMaterialModal(mat);
    });
  });

  // Archive
  page.querySelectorAll<HTMLButtonElement>("[data-archive]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      archiveMaterial(parseInt(btn.dataset.archive!));
      showToast("Materiał zarchiwizowany");
      render();
      notifySidebarUpdate();
    });
  });

  // Clone/Duplicate
  page.querySelectorAll<HTMLButtonElement>("[data-clone]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const mat = getMaterials({ show_archived: true }).find((m) => m.id === parseInt(btn.dataset.clone!));
      if (!mat) return;
      addMaterial({
        name: mat.name + " (kopia)",
        unit: mat.unit,
        price_netto: mat.price_netto,
        vat_rate: mat.vat_rate,
        category_id: mat.category_id,
        supplier: mat.supplier,
        sku: mat.sku,
        url: mat.url,
        notes: mat.notes,
      });
      showToast("Materiał zduplikowany");
      render();
      notifySidebarUpdate();
    });
  });

  // Delete
  page.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm("Na pewno usunąć ten materiał?")) return;
      deleteMaterial(parseInt(btn.dataset.delete!));
      showToast("Materiał usunięty");
      render();
      notifySidebarUpdate();
    });
  });

  // Double click row to edit
  page.querySelectorAll<HTMLTableRowElement>("tr[data-id]").forEach((tr) => {
    tr.addEventListener("dblclick", () => {
      const id = parseInt(tr.dataset.id!);
      const mat = getMaterials({ show_archived: true }).find((m) => m.id === id);
      if (mat) openMaterialModal(mat);
    });
  });

  // Prevent link clicks from triggering row events
  page.querySelectorAll<HTMLElement>("[data-external-link]").forEach((el) => {
    el.addEventListener("click", (e) => e.stopPropagation());
  });
}

// ─── Price history chart ────────────────────────────────────────
function renderPriceHistoryChart(materialId: number): string {
  const allHistory = getAllPriceHistory();
  const history = allHistory
    .filter(h => h.material_id === materialId)
    .sort((a, b) => a.changed_at.localeCompare(b.changed_at));

  if (history.length < 2) return "";

  const width = 300;
  const height = 100;
  const pad = { top: 8, right: 8, bottom: 20, left: 40 };
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;

  const values = history.map(h => h.price_netto);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const scaleX = (i: number) => pad.left + (i / (history.length - 1)) * cw;
  const scaleY = (v: number) => pad.top + ch - ((v - minV) / range) * ch;

  const pathD = history.map((h, i) => `${i === 0 ? "M" : "L"} ${scaleX(i)} ${scaleY(h.price_netto)}`).join(" ");
  const dots = history.map((h, i) => {
    const d = new Date(h.changed_at);
    const label = d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
    return `<circle cx="${scaleX(i)}" cy="${scaleY(h.price_netto)}" r="3" fill="var(--accent)" stroke="var(--bg-secondary)" stroke-width="1.5">
      <title>${label}: ${h.price_netto.toFixed(2)} zł</title>
    </circle>`;
  }).join("");

  // Y axis labels
  const yLabels = [minV, (minV + maxV) / 2, maxV].map(v => {
    return `<text x="${pad.left - 4}" y="${scaleY(v) + 3}" font-size="8" text-anchor="end" fill="var(--text-muted)">${v.toFixed(2)}</text>`;
  }).join("");

  return `
    <div style="margin-top:12px">
      <div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">
        <i class="fa-solid fa-chart-line" style="font-size:10px;margin-right:4px"></i> Historia cen
      </div>
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;max-width:${width}px;height:auto">
        <path d="${pathD}" stroke="var(--accent)" stroke-width="1.5" fill="none" stroke-linecap="round" />
        ${dots}
        ${yLabels}
      </svg>
    </div>
  `;
}

// ─── Material modal ──────────────────────────────────────────────
function openMaterialModal(material?: Material): void {
  const isEdit = !!material;
  const categories = getCategories();
  modalLinks = material ? parseLinks(material.url) : [];

  const catOptions = categories
    .map((c) => `<option value="${c.id}"${material?.category_id === c.id ? " selected" : ""}>${esc(c.name)}</option>`)
    .join("");

  openModal(`
    <h2 class="modal-title">${isEdit ? "Edytuj materiał" : "Dodaj materiał"}</h2>

    <div class="field">
      <label>Nazwa materiału</label>
      <input type="text" id="f-name" value="${esc(material?.name ?? "")}" placeholder="np. Kabel YDY 3x2.5" />
    </div>

    <div class="field-row field-row-3">
      <div class="field">
        <label>Cena netto (PLN)</label>
        <input type="number" step="0.01" id="f-price" value="${material?.price_netto ?? ""}" placeholder="0,00" />
      </div>
      <div class="field">
        <label>Jednostka</label>
        <select id="f-unit">
          ${["szt", "m", "m2", "m3", "kg", "l", "opak", "kpl"].map((u) => `<option value="${u}"${material?.unit === u ? " selected" : ""}>${u === "m2" ? "m²" : u === "m3" ? "m³" : u}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>VAT (%)</label>
        <select id="f-vat">
          ${[23, 8, 5, 0].map((v) => `<option value="${v}"${material?.vat_rate === v ? " selected" : ""}>${v}%</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="field-row field-row-2">
      <div class="field">
        <label>Kategoria</label>
        <select id="f-category">
          <option value="">— bez kategorii —</option>
          ${catOptions}
        </select>
      </div>
      <div class="field">
        <label>Dostawca</label>
        <input type="text" id="f-supplier" value="${esc(material?.supplier ?? "")}" placeholder="np. Castorama" />
      </div>
    </div>

    <div class="field">
      <label>SKU / Numer katalogowy</label>
      <input type="text" id="f-sku" value="${esc(material?.sku ?? "")}" placeholder="opcjonalnie" />
    </div>

    <div class="field">
      <label>Linki</label>
      <div class="field-hint">Produkt, karta katalogowa, oferta, Allegro itp.</div>
      <div class="links-editor" id="links-editor"></div>
      <button class="link-add-btn" id="btn-add-link" type="button">
        <i class="fa-solid fa-plus"></i> Dodaj link
      </button>
    </div>

    <div class="field">
      <label>Notatki</label>
      <textarea id="f-notes" placeholder="Dodatkowe informacje...">${esc(material?.notes ?? "")}</textarea>
    </div>

    ${isEdit && material ? renderPriceHistoryChart(material.id) : ""}

    <div class="modal-footer">
      <button class="btn" id="btn-modal-cancel">Anuluj</button>
      <button class="btn btn-primary" id="btn-modal-save">${isEdit ? "Zapisz" : "Dodaj"}</button>
    </div>
  `);

  renderLinksEditor();

  // Focus
  setTimeout(() => (document.getElementById("f-name") as HTMLInputElement)?.focus(), 80);

  // Bind
  document.getElementById("btn-add-link")!.addEventListener("click", () => {
    modalLinks.push({ label: "", url: "" });
    renderLinksEditor();
    const inputs = document.querySelectorAll<HTMLInputElement>(".link-url-input");
    inputs[inputs.length - 1]?.focus();
  });

  document.getElementById("btn-modal-cancel")!.addEventListener("click", closeModal);

  document.getElementById("btn-modal-save")!.addEventListener("click", () => {
    saveMaterialFromModal(material?.id);
  });

  // Enter to save (not in textarea)
  document.getElementById("modal-box")!.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
      e.preventDefault();
      saveMaterialFromModal(material?.id);
    }
  });
}

function renderLinksEditor(): void {
  const container = document.getElementById("links-editor")!;
  container.innerHTML = modalLinks
    .map(
      (link, i) => `
    <div class="link-row" data-link-idx="${i}">
      <input class="link-label-input" type="text" placeholder="Etykieta" value="${esc(link.label)}" data-link-label="${i}" />
      <input class="link-url-input" type="url" placeholder="https://..." value="${esc(link.url)}" data-link-url="${i}" />
      <button class="link-row-remove" data-link-remove="${i}" title="Usuń">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `
    )
    .join("");

  // Bind input changes
  container.querySelectorAll<HTMLInputElement>("[data-link-label]").forEach((input) => {
    input.addEventListener("input", () => {
      modalLinks[parseInt(input.dataset.linkLabel!)].label = input.value;
    });
  });

  container.querySelectorAll<HTMLInputElement>("[data-link-url]").forEach((input) => {
    input.addEventListener("input", () => {
      modalLinks[parseInt(input.dataset.linkUrl!)].url = input.value;
    });
  });

  container.querySelectorAll<HTMLButtonElement>("[data-link-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      modalLinks.splice(parseInt(btn.dataset.linkRemove!), 1);
      renderLinksEditor();
    });
  });
}

function saveMaterialFromModal(editId?: number): void {
  const name = (document.getElementById("f-name") as HTMLInputElement).value.trim();
  if (!name) {
    (document.getElementById("f-name") as HTMLInputElement).focus();
    return;
  }

  const cleanLinks = modalLinks.filter((l) => l.url.trim());
  for (const l of cleanLinks) {
    if (!l.label.trim()) l.label = extractDomain(l.url);
  }

  const input: MaterialInput = {
    name,
    unit: (document.getElementById("f-unit") as HTMLSelectElement).value,
    price_netto: parseFloat((document.getElementById("f-price") as HTMLInputElement).value) || 0,
    vat_rate: parseInt((document.getElementById("f-vat") as HTMLSelectElement).value),
    category_id: (document.getElementById("f-category") as HTMLSelectElement).value
      ? parseInt((document.getElementById("f-category") as HTMLSelectElement).value)
      : null,
    supplier: (document.getElementById("f-supplier") as HTMLInputElement).value.trim(),
    sku: (document.getElementById("f-sku") as HTMLInputElement).value.trim(),
    url: JSON.stringify(cleanLinks),
    notes: (document.getElementById("f-notes") as HTMLTextAreaElement).value.trim(),
  };

  // Check for duplicate names (but skip if editing the same material)
  if (!editId) {
    const dupName = checkDuplicateName(input.name, getMaterials({ show_archived: true }).map(m => m.name));
    if (dupName && !confirm(`Materiał o podobnej nazwie już istnieje: "${dupName}". Dodać mimo to?`)) return;
  }

  if (editId) {
    updateMaterial(editId, input);
    showToast("Materiał zaktualizowany");
  } else {
    addMaterial(input);
    showToast("Materiał dodany");
  }

  closeModal();
  render();
  notifySidebarUpdate();
}

// ─── Sidebar update callback (set by main.ts) ───────────────────
let _sidebarUpdateCb: (() => void) | null = null;

export function onSidebarUpdate(cb: () => void): void {
  _sidebarUpdateCb = cb;
}

function notifySidebarUpdate(): void {
  _sidebarUpdateCb?.();
}

// ─── Bulk action bar ─────────────────────────────────────────────
function renderBulkActionBar(): string {
  if (selectedMaterials.size === 0) return "";

  return `
    <div class="bulk-action-bar">
      <span class="bulk-action-count">Zaznaczono: ${selectedMaterials.size}</span>
      <div class="bulk-action-buttons">
        <button class="btn btn-sm" id="btn-bulk-supplier">Zmień dostawcę</button>
        <button class="btn btn-sm" id="btn-bulk-price">Zmień cenę %</button>
        <button class="btn btn-sm btn-danger" id="btn-bulk-archive">Archiwizuj</button>
      </div>
    </div>
  `;
}

function bindBulkActionBar(page: HTMLElement): void {
  const btnSupplier = page.querySelector<HTMLButtonElement>("#btn-bulk-supplier");
  const btnPrice = page.querySelector<HTMLButtonElement>("#btn-bulk-price");
  const btnArchive = page.querySelector<HTMLButtonElement>("#btn-bulk-archive");

  if (btnSupplier) {
    btnSupplier.addEventListener("click", openBulkSupplierModal);
  }

  if (btnPrice) {
    btnPrice.addEventListener("click", openBulkPriceModal);
  }

  if (btnArchive) {
    btnArchive.addEventListener("click", () => {
      if (!confirm(`Na pewno archiwizować ${selectedMaterials.size} materiałów?`)) return;
      selectedMaterials.forEach((id) => archiveMaterial(id));
      showToast(`Zarchiwizowano ${selectedMaterials.size} materiałów`);
      selectedMaterials.clear();
      selectAllChecked = false;
      render();
      notifySidebarUpdate();
    });
  }
}

function openBulkSupplierModal(): void {
  openModal(`
    <h2 class="modal-title">Zmień dostawcę (${selectedMaterials.size} materiałów)</h2>

    <div class="field">
      <label>Dostawca</label>
      <input type="text" id="bulk-supplier-input" placeholder="np. Castorama" />
    </div>

    <div class="modal-footer">
      <button class="btn" id="btn-modal-cancel">Anuluj</button>
      <button class="btn btn-primary" id="btn-modal-save">Zastosuj</button>
    </div>
  `);

  setTimeout(() => (document.getElementById("bulk-supplier-input") as HTMLInputElement)?.focus(), 80);

  document.getElementById("btn-modal-cancel")!.addEventListener("click", closeModal);
  document.getElementById("btn-modal-save")!.addEventListener("click", () => {
    const supplier = (document.getElementById("bulk-supplier-input") as HTMLInputElement).value.trim();
    const allMaterials = getMaterials({ show_archived: true });
    let count = 0;

    selectedMaterials.forEach((id) => {
      const mat = allMaterials.find((m) => m.id === id);
      if (mat) {
        updateMaterial(id, { ...mat, supplier });
        count++;
      }
    });

    showToast(`Zmieniono dostawcę dla ${count} materiałów`);
    closeModal();
    selectedMaterials.clear();
    selectAllChecked = false;
    render();
    notifySidebarUpdate();
  });
}

function openBulkPriceModal(): void {
  openModal(`
    <h2 class="modal-title">Zmień cenę % (${selectedMaterials.size} materiałów)</h2>

    <div class="field">
      <label>Zmiana ceny (%)</label>
      <div class="field-hint">Wartość dodatnia zwiększa cenę, ujemna zmniejsza</div>
      <input type="number" step="0.01" id="bulk-price-input" placeholder="np. 10 lub -5" />
    </div>

    <div class="modal-footer">
      <button class="btn" id="btn-modal-cancel">Anuluj</button>
      <button class="btn btn-primary" id="btn-modal-save">Zastosuj</button>
    </div>
  `);

  setTimeout(() => (document.getElementById("bulk-price-input") as HTMLInputElement)?.focus(), 80);

  document.getElementById("btn-modal-cancel")!.addEventListener("click", closeModal);
  document.getElementById("btn-modal-save")!.addEventListener("click", () => {
    const percentStr = (document.getElementById("bulk-price-input") as HTMLInputElement).value.trim();
    const percent = parseFloat(percentStr);

    if (isNaN(percent)) {
      (document.getElementById("bulk-price-input") as HTMLInputElement).focus();
      return;
    }

    const allMaterials = getMaterials({ show_archived: true });
    let count = 0;

    selectedMaterials.forEach((id) => {
      const mat = allMaterials.find((m) => m.id === id);
      if (mat) {
        const multiplier = 1 + percent / 100;
        const newPrice = Math.max(0, mat.price_netto * multiplier);
        updateMaterial(id, { ...mat, price_netto: newPrice });
        count++;
      }
    });

    showToast(`Zmieniono cenę dla ${count} materiałów`);
    closeModal();
    selectedMaterials.clear();
    selectAllChecked = false;
    render();
    notifySidebarUpdate();
  });
}

// ─── CSV Import ──────────────────────────────────────────────────
function detectSeparator(csvText: string): string {
  const firstLine = csvText.split("\n")[0];
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;

  if (tabCount > 0 && tabCount >= semiCount && tabCount >= commaCount) return "\t";
  if (semiCount > 0 && semiCount >= commaCount) return ";";
  return ",";
}

function parseCSVLine(line: string, separator: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === separator && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function importMaterialsFromCSV(csvText: string): void {
  const separator = detectSeparator(csvText);
  const lines = csvText.trim().split("\n");

  if (lines.length < 2) {
    showToast("Plik CSV jest pusty");
    return;
  }

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine, separator).map((h) => h.toLowerCase());

  const nameIdx = headers.findIndex(
    (h) => h === "nazwa" || h === "name" || h === "materiał" || h === "material"
  );
  const unitIdx = headers.findIndex(
    (h) => h === "jednostka" || h === "unit" || h === "jedn."
  );
  const priceIdx = headers.findIndex(
    (h) =>
      h === "cena" ||
      h === "price" ||
      h === "cena netto" ||
      h === "price_netto" ||
      h === "netto"
  );
  const vatIdx = headers.findIndex(
    (h) =>
      h === "vat" ||
      h === "stawka" ||
      h === "vat_rate" ||
      h === "stawka vat" ||
      h === "vat (%)"
  );
  const supplierIdx = headers.findIndex(
    (h) => h === "dostawca" || h === "supplier" || h === "producent"
  );
  const skuIdx = headers.findIndex((h) => h === "sku" || h === "kod" || h === "kod_produktu");
  const categoryIdx = headers.findIndex(
    (h) => h === "kategoria" || h === "category" || h === "cat"
  );

  let imported = 0;
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const values = parseCSVLine(line, separator);

      if (nameIdx === -1 || !values[nameIdx]) {
        errors.push(`Wiersz ${i + 1}: brak nazwy materiału`);
        continue;
      }

      const name = values[nameIdx];
      const unit = unitIdx !== -1 ? values[unitIdx] || "szt" : "szt";
      const priceStr = priceIdx !== -1 ? values[priceIdx] : "0";
      const price_netto = parseFloat(priceStr.replace(",", ".")) || 0;
      const vatStr = vatIdx !== -1 ? values[vatIdx] : "23";
      const vat_rate = parseInt(vatStr) || 23;
      const supplier = supplierIdx !== -1 ? values[supplierIdx] || "" : "";
      const sku = skuIdx !== -1 ? values[skuIdx] || "" : "";

      let category_id: number | null = null;
      if (categoryIdx !== -1) {
        const catName = values[categoryIdx];
        const cat = getCategories().find(
          (c) => c.name.toLowerCase() === catName.toLowerCase()
        );
        if (cat) category_id = cat.id;
      }

      addMaterial({
        name,
        unit,
        price_netto,
        vat_rate,
        category_id,
        supplier,
        sku,
        url: "",
        notes: "",
      });

      imported++;
    } catch (err) {
      errors.push(`Wiersz ${i + 1}: błąd parsowania`);
    }
  }

  let msg = `Zaimportowano ${imported} materiałów`;
  if (errors.length > 0) {
    msg += ` (${errors.length} błędów)`;
  }

  showToast(msg);
  selectedMaterials.clear();
  selectAllChecked = false;
  render();
  notifySidebarUpdate();
}

// ─── Init ────────────────────────────────────────────────────────
export function initMaterialy(): void {
  render();
}

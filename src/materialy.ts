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
} from "./ui";

// ─── Module state ────────────────────────────────────────────────
let currentFilter: MaterialFilter = {};
let currentGroupBy: GroupBy = "none";
let filterCategoryId: number | null = null;
let filterView: "all" | "favorites" | "archived" = "all";
let modalLinks: MaterialLink[] = [];

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

  // Topbar action button
  document.getElementById("topbar-actions")!.innerHTML = `
    <button class="btn btn-primary" id="btn-add-material">
      <i class="fa-solid fa-plus"></i> Dodaj materiał
    </button>
  `;
  document.getElementById("btn-add-material")!.addEventListener("click", () => openMaterialModal());

  // Page content
  if (materials.length === 0) {
    page.innerHTML = renderEmpty();
    const btn = page.querySelector("#btn-empty-add");
    if (btn) btn.addEventListener("click", () => openMaterialModal());
    return;
  }

  page.innerHTML = renderGroupBar() + renderTable(materials, categories);
  bindGroupBar();
  bindTableEvents(page);
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
  const colCount = 9;

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

    for (const m of group.items) {
      const cat = getCategoryById(m.category_id);
      const links = parseLinks(m.url);
      const prBrutto = brutto(m.price_netto, m.vat_rate);

      rows += `<tr data-id="${m.id}">
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
            <button class="btn-icon" title="Archiwizuj" data-archive="${m.id}"><i class="fa-solid fa-box-archive"></i></button>
            <button class="btn-icon" title="Usuń" data-delete="${m.id}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
    }
  }

  return `
    <table class="data-table">
      <thead><tr>
        <th style="width:30px"></th>
        <th>Nazwa</th>
        <th>Jedn.</th>
        <th>Netto</th>
        <th>Brutto</th>
        <th>Kategoria</th>
        <th>Dostawca</th>
        <th>Linki</th>
        <th style="width:100px"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
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
function bindTableEvents(page: HTMLElement): void {
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

// ─── Init ────────────────────────────────────────────────────────
export function initMaterialy(): void {
  render();
}

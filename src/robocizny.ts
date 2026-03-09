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
  showToast,
  formatPrice,
  brutto,
} from "./ui";
import {
  dpHeader,
  dpSections,
  dpFooter,
  dpCollect,
  dpValidate,
  dpBindActions,
  dpFocus,
  type DPSection,
  type DPFooterButton,
} from "./detail-page";
import { dangerModal } from "./danger-modal";
import { bindInlineEdits } from "./inline-edit";

// ─── State ───────────────────────────────────────────────────────
let currentFilter: LaborFilter = {};
let currentGroupBy: "none" | "category" | "unit" = "none";
let filterView: "all" | "favorites" | "archived" = "all";
let filterCategory: string | null = null;
let view: "list" | "detail" = "list";
let detailId: number | null = null;

// ─── Public API ──────────────────────────────────────────────────
export function setLaborSearch(search: string): void {
  currentFilter.search = search || undefined;
  render();
}

// ─── Detail Page Sections ────────────────────────────────────────
function getLaborSections(labor?: Labor): DPSection[] {
  const existingCats = getLaborCategories();
  return [
    {
      id: "section-general",
      title: "Podstawowe informacje",
      columns: 2,
      fields: [
        {
          id: "f-l-name",
          name: "name",
          label: "Nazwa usługi",
          type: "text",
          required: true,
          placeholder: "np. Malowanie ścian",
          value: labor?.name ?? "",
        },
        {
          id: "f-l-category",
          name: "category",
          label: "Kategoria",
          type: "datalist",
          placeholder: "np. Malowanie, Elektryka",
          value: labor?.category ?? "",
          hint: "Wpisz istniejącą lub nową kategorię",
          options: existingCats.map((c) => ({ value: c, label: c })),
        },
      ],
    },
    {
      id: "section-pricing",
      title: "Wycena",
      columns: 3,
      fields: [
        {
          id: "f-l-price",
          name: "price_netto",
          label: "Cena netto (PLN)",
          type: "number",
          step: 0.01,
          placeholder: "0,00",
          value: labor?.price_netto ?? "",
        },
        {
          id: "f-l-unit",
          name: "unit",
          label: "Jednostka",
          type: "select",
          value: labor?.unit ?? "m2",
          options: [
            "m2",
            "m",
            "mb",
            "m3",
            "szt",
            "kpl",
            "godz",
            "opak",
            "kg",
          ].map((u) => ({
            value: u,
            label: u === "m2" ? "m²" : u === "m3" ? "m³" : u,
          })),
        },
        {
          id: "f-l-vat",
          name: "vat_rate",
          label: "VAT (%)",
          type: "select",
          value: String(labor?.vat_rate ?? 23),
          options: [23, 8, 5, 0].map((v) => ({
            value: String(v),
            label: v + "%",
          })),
        },
      ],
    },
    {
      id: "section-notes",
      title: "Notatki",
      columns: 1,
      fields: [
        {
          id: "f-l-notes",
          name: "notes",
          label: "Notatki",
          type: "textarea",
          placeholder: "Dodatkowe informacje...",
          value: labor?.notes ?? "",
          rows: 3,
        },
      ],
    },
  ];
}

// ─── Main Render ─────────────────────────────────────────────────
function render(): void {
  if (view === "detail") {
    renderDetail();
  } else {
    renderList();
  }
}

// ─── List View ───────────────────────────────────────────────────
function renderList(): void {
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
  document.getElementById("btn-add-labor")!.addEventListener("click", () => {
    detailId = null;
    view = "detail";
    render();
  });

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
    page.querySelector("#btn-empty-add-labor")!.addEventListener("click", () => {
      detailId = null;
      view = "detail";
      render();
    });
    return;
  }

  page.innerHTML =
    renderViewFilters() + renderGroupBar() + renderTable(items);
  bindViewFilters(page);
  bindGroupBar();
  bindTableEvents(page);
  
  // Bind inline editing for price column
  bindInlineEdits(page, "[data-inline-field]", (id, field, value) => {
    const item = getLabor({ show_archived: true }).find((l) => l.id === id);
    if (!item) return;
    // Convert value to string first if it's a number, then to number
    const numValue = parseFloat(String(value)) || 0;
    updateLabor(id, { ...item, [field]: numValue });
    showToast("Zaktualizowano");
    render();
  }, {
    price_netto: { type: "number", step: 0.01, min: 0 },
  });
}

// ─── Detail View ─────────────────────────────────────────────────
function renderDetail(): void {
  const page = document.getElementById("page-robocizny")!;
  const labor =
    detailId !== null
      ? getLabor({ show_archived: true }).find((l) => l.id === detailId)
      : null;
  const title = labor ? "Edytuj robociznę" : "Dodaj robociznę";
  const sections = getLaborSections(labor ?? undefined);

  document.getElementById("topbar-title")!.textContent = title;
  document.getElementById("topbar-actions")!.innerHTML = "";

  const footerButtons: DPFooterButton[] = [
    { id: "btn-back", label: "Wróć", style: "secondary", action: "back" },
    ...(labor
      ? [
          {
            id: "btn-delete",
            label: "Usuń",
            style: "danger" as const,
            action: "delete",
            icon: "fa-solid fa-trash",
          },
        ]
      : []),
    {
      id: "btn-save",
      label: labor ? "Zapisz" : "Dodaj",
      style: "primary" as const,
      action: "save",
      icon: "fa-solid fa-check",
    },
  ];

  page.innerHTML =
    dpHeader(title) + dpSections(sections) + dpFooter(footerButtons);

  dpBindActions(page, {
    back: () => {
      view = "list";
      render();
    },
    save: () => {
      const result = dpValidate(page, sections);
      if (!result.valid) return;
      const data = dpCollect(page, sections);

      const input: LaborInput = {
        name: data.name,
        unit: data.unit,
        price_netto: parseFloat(data.price_netto) || 0,
        vat_rate: parseInt(data.vat_rate),
        category: data.category || "Ogólne",
        notes: data.notes,
      };

      if (labor) {
        updateLabor(labor.id, input);
        showToast("Robocizna zaktualizowana");
      } else {
        addLabor(input);
        showToast("Robocizna dodana");
      }
      view = "list";
      render();
    },
    delete: async () => {
      if (!labor) return;
      if (
        await dangerModal(
          "Usunąć robociznę?",
          `Na pewno usunąć "${labor.name}"?`
        )
      ) {
        deleteLabor(labor.id);
        showToast("Robocizna usunięta");
        view = "list";
        render();
      }
    },
  });

  dpFocus(page, sections);
}

// ─── View filters (all / favorites / archived / category) ────────
function renderViewFilters(): string {
  const cats = getLaborCategories();
  const allItems = getLabor({});
  const favCount = allItems.filter((l) => l.is_favorite).length;
  const archCount = getLabor({ show_archived: true }).filter(
    (l) => l.is_archived
  ).length;

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
      ${pills
        .map(
          (p) =>
            `<button class="group-pill${currentGroupBy === p.key ? " active" : ""}" data-lgroup="${p.key}">${p.label}</button>`
        )
        .join("")}
    </div>
  `;
}

function bindGroupBar(): void {
  document
    .querySelectorAll<HTMLButtonElement>("[data-lgroup]")
    .forEach((pill) => {
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

  return [...map.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "pl")
  );
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
        <td data-inline-id="${l.id}" data-inline-field="price_netto"><span class="cell-mono">${formatPrice(l.price_netto)} zł</span></td>
        <td>
          <span class="cell-mono">${formatPrice(prBrutto)} zł</span>
          <span class="cell-muted">(${l.vat_rate}%)</span>
        </td>
        <td><span class="cell-badge" style="background:var(--accent-subtle);color:var(--accent-text)">${esc(l.category)}</span></td>
        <td><span class="cell-muted">${esc(l.notes) || "—"}</span></td>
        <td>
          <div class="row-actions">
            <button class="btn-icon" title="Edytuj" data-ledit="${l.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon" title="Duplikuj" data-lclone="${l.id}"><i class="fa-solid fa-copy"></i></button>
            <button class="btn-icon" title="Archiwizuj" data-larchive="${l.id}"><i class="fa-solid fa-box-archive"></i></button>
            <button class="btn-icon" title="Usuń" data-ldelete="${l.id}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
    }
  }

  return `
    <div class="table-responsive">
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
    </div>
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
      detailId = id;
      view = "detail";
      render();
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

  // Clone
  page.querySelectorAll<HTMLButtonElement>("[data-lclone]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = getLabor({ show_archived: true }).find(
        (l) => l.id === parseInt(btn.dataset.lclone!)
      );
      if (!item) return;
      addLabor({
        name: item.name + " (kopia)",
        unit: item.unit,
        price_netto: item.price_netto,
        vat_rate: item.vat_rate,
        category: item.category,
        notes: item.notes,
      });
      showToast("Robocizna zduplikowana");
      render();
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-ldelete]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.ldelete!);
      const item = getLabor({ show_archived: true }).find((l) => l.id === id);
      if (!item) return;
      if (await dangerModal("Usunąć robociznę?", `Na pewno usunąć "${item.name}"?`)) {
        deleteLabor(id);
        showToast("Robocizna usunięta");
        render();
      }
    });
  });

  page.querySelectorAll<HTMLTableRowElement>("tr[data-lid]").forEach((tr) => {
    tr.addEventListener("dblclick", () => {
      const id = parseInt(tr.dataset.lid!);
      detailId = id;
      view = "detail";
      render();
    });
  });
}

// ─── Init ────────────────────────────────────────────────────────
export function initRobocizny(): void {
  render();
}

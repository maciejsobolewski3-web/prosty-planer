// ─── Moje Produkty (Trade mode) ─────────────────────────────────
// Analogous to materialy.ts but for supplier products

import type { Product } from "./types";
import {
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  toggleProductFavorite,
  archiveProduct,
  getAllProductsCount,
  getProductPriceHistory,
  type ProductFilter,
  type ProductInput,
} from "./store-trade";
import { getCategories, getCategoryById } from "./store";
import { dpHeader, dpSections, dpFooter, dpCollect, dpValidate, dpBindActions, dpFocus, type DPSection, type DPFooterButton } from "./detail-page";
import { dangerModal } from "./danger-modal";
import { bindInlineEdits } from "./inline-edit";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  esc,
  openModal,
  closeModal,
  showToast,
  formatPrice,
  brutto,
  renderSortableHeader,
  bindSortHeaders,
  sortArray,
  checkDuplicateName,
  type SortState,
} from "./ui";

// ─── Module state ────────────────────────────────────────────────
let currentFilter: ProductFilter = {};
let filterView: "all" | "favorites" | "archived" = "all";
let filterCategoryId: number | null = null;
let sortState: SortState = { column: "name", dir: "asc" };
let filterSupplier: string | null = null;

let view: "list" | "detail" = "list";
let detailId: number | null = null;

export function setProductFilterView(view: "all" | "favorites" | "archived"): void {
  filterView = view;
  filterCategoryId = null;
  rebuildFilter();
  render();
}

export function setProductFilterCategory(catId: number | null): void {
  filterCategoryId = catId;
  filterView = "all";
  rebuildFilter();
  render();
}

export function setProductSearch(search: string): void {
  currentFilter.search = search || undefined;
  render();
}

function rebuildFilter(): void {
  currentFilter = {};
  if (filterView === "favorites") currentFilter.favorites_only = true;
  if (filterView === "archived") currentFilter.show_archived = true;
  if (filterCategoryId !== null) currentFilter.category_id = filterCategoryId;
}

// ─── Render dispatch ─────────────────────────────────────────────
function render(): void {
  if (view === "detail") {
    renderDetail();
  } else {
    renderList();
  }
}

// ─── List view ───────────────────────────────────────────────────
function renderList(): void {
  const page = document.getElementById("page-products")!;
  let products = getProducts(currentFilter);

  // Apply supplier filter
  if (filterSupplier) {
    products = products.filter((p) => p.supplier === filterSupplier);
  }

  let title = "Moje Produkty";
  if (filterView === "favorites") title = "Ulubione produkty";
  if (filterView === "archived") title = "Archiwum produktów";
  if (filterCategoryId !== null) {
    const cat = getCategoryById(filterCategoryId);
    if (cat) title = cat.name;
  }
  document.getElementById("topbar-title")!.textContent = title;

  document.getElementById("topbar-actions")!.innerHTML = `
    <button class="btn btn-sm" id="btn-export-csv" title="Eksport CSV"><i class="fa-solid fa-file-csv"></i> CSV</button>
    <button class="btn btn-primary" id="btn-add-product">
      <i class="fa-solid fa-plus"></i> Dodaj produkt
    </button>
  `;
  document.getElementById("btn-export-csv")?.addEventListener("click", exportProductsCSV);
  document.getElementById("btn-add-product")!.addEventListener("click", () => openProductDetail());

  if (products.length === 0) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="fa-solid fa-cube"></i></div>
        <h3>Twój cennik jest pusty</h3>
        <p>Dodaj produkty ręcznie lub zaimportuj z CSV/Excel. Z czasem zbudujesz bazę, która przyspieszy składanie ofert przetargowych.</p>
        <button class="btn btn-primary" id="btn-empty-add-product">
          <i class="fa-solid fa-plus"></i> Dodaj produkt
        </button>
      </div>
    `;
    page.querySelector("#btn-empty-add-product")?.addEventListener("click", () => openProductDetail());
    return;
  }

  // Get unique suppliers for filter chips
  const allProds = getProducts(currentFilter);
  const suppliers = [...new Set(allProds.map((p) => p.supplier).filter(Boolean))].sort();

  const supplierChips = suppliers.length > 1 ? `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
      <span style="font-size:11px;color:var(--text-secondary);margin-right:4px"><i class="fa-solid fa-filter"></i> Dostawca:</span>
      <button class="tag ${!filterSupplier ? "tag-active" : ""}" data-supplier-filter="">Wszystkie</button>
      ${suppliers.map((s) => `
        <button class="tag ${filterSupplier === s ? "tag-active" : ""}" data-supplier-filter="${esc(s)}">${esc(s)}</button>
      `).join("")}
    </div>
  ` : "";

  page.innerHTML = supplierChips + renderTable(products);

  // Supplier filter events
  page.querySelectorAll<HTMLButtonElement>("[data-supplier-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.supplierFilter!;
      filterSupplier = val || null;
      renderList();
    });
  });

  bindTableEvents(page);
}

// ─── Table ───────────────────────────────────────────────────────
function renderTable(products: Product[]): string {
  // Sort (sortArray takes 4 args: array, column, direction, getter function)
  const sorted = sortArray(products, sortState.column, sortState.dir, (p, col) => {
    switch (col) {
      case "name": return p.name;
      case "unit": return p.unit;
      case "purchase_price": return p.purchase_price;
      case "catalog_price": return p.catalog_price;
      case "margin": return p.catalog_price > 0 && p.purchase_price > 0 ? (p.catalog_price - p.purchase_price) / p.purchase_price * 100 : -999;
      case "supplier": return p.supplier;
      default: return p.name;
    }
  });

  const rows = sorted.map((p) => {
    const cat = getCategoryById(p.category_id);
    const margin = p.catalog_price > 0 && p.purchase_price > 0
      ? ((p.catalog_price - p.purchase_price) / p.purchase_price * 100).toFixed(1)
      : null;

    return `<tr data-id="${p.id}">
      <td><input type="checkbox" class="bulk-check" data-product-id="${p.id}" /></td>
      <td>
        <span class="cell-fav${p.is_favorite ? " active" : ""}" data-fav="${p.id}">
          <i class="fa-${p.is_favorite ? "solid" : "regular"} fa-star"></i>
        </span>
      </td>
      <td><strong>${esc(p.name)}</strong></td>
      <td><span class="cell-unit">${esc(p.unit)}</span></td>
      <td class="inline-edit-cell" data-field="purchase_price" data-id="${p.id}" data-value="${p.purchase_price}">
        <span class="cell-mono inline-edit-display">${formatPrice(p.purchase_price)} zł</span>
        <input type="number" step="0.01" min="0" class="inline-edit-input" value="${p.purchase_price}" style="display:none" />
      </td>
      <td>
        ${p.catalog_price > 0
          ? `<span class="cell-mono">${formatPrice(p.catalog_price)} zł</span>`
          : '<span class="cell-muted">—</span>'}
      </td>
      <td>
        ${margin !== null
          ? `<span class="cell-mono" style="color:${parseFloat(margin) >= 0 ? 'var(--success)' : 'var(--danger)'}">${margin.replace(".", ",")}%</span>`
          : '<span class="cell-muted">—</span>'}
      </td>
      <td>${cat ? `<span class="cell-badge" style="background:${cat.color}22;color:${cat.color}">${esc(cat.name)}</span>` : '<span class="cell-muted">—</span>'}</td>
      <td><span class="cell-muted">${esc(p.supplier) || "—"}</span></td>
      <td>
        <div class="row-actions">
          <button class="btn-icon" title="Edytuj" data-edit="${p.id}"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon" title="Duplikuj" data-clone="${p.id}"><i class="fa-solid fa-copy"></i></button>
          <button class="btn-icon" title="Archiwizuj" data-archive="${p.id}"><i class="fa-solid fa-box-archive"></i></button>
          <button class="btn-icon" title="Usuń" data-delete="${p.id}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join("");

  return `
    <div id="bulk-toolbar-products" class="bulk-toolbar hidden">
      <span id="bulk-count-products">Zaznaczono: 0</span>
      <button class="btn btn-danger btn-sm" id="btn-bulk-delete-products">
        <i class="fa-solid fa-trash"></i> Usuń zaznaczone
      </button>
      <button class="btn btn-sm" id="btn-bulk-archive-products">
        <i class="fa-solid fa-box-archive"></i> Archiwizuj zaznaczone
      </button>
    </div>
    <table class="data-table">
      <thead><tr>
        <th style="width:30px"><input type="checkbox" id="bulk-check-all-products" /></th>
        <th style="width:30px"></th>
        ${renderSortableHeader("Nazwa", "name", sortState)}
        ${renderSortableHeader("Jedn.", "unit", sortState)}
        ${renderSortableHeader("Cena zakupu", "purchase_price", sortState)}
        ${renderSortableHeader("Cena katalog.", "catalog_price", sortState)}
        ${renderSortableHeader("Marża", "margin", sortState)}
        <th>Kategoria</th>
        ${renderSortableHeader("Dostawca", "supplier", sortState)}
        <th style="width:100px"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ─── Table events ────────────────────────────────────────────────
function bindTableEvents(page: HTMLElement): void {
  // Sort headers
  bindSortHeaders(page, sortState, (newState) => {
    sortState = newState;
    renderList();
  });

  // Inline edits for purchase_price (bindInlineEdits takes container, selector, onSave, typeMap)
  bindInlineEdits(page, "[data-field='purchase_price']", (productId: number, field: string, newValue: string | number) => {
    const value = parseFloat(String(newValue));
    if (isNaN(value) || value < 0) return;
    const prod = getProducts({ show_archived: true }).find((p) => p.id === productId);
    if (!prod) return;
    updateProduct(productId, { ...prod, [field]: value });
    showToast("Cena zaktualizowana");
    renderList();
    notifySidebarUpdate();
  });

  page.querySelectorAll<HTMLElement>("[data-fav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleProductFavorite(parseInt(el.dataset.fav!));
      renderList();
      notifySidebarUpdate();
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.edit!);
      const p = getProducts({ show_archived: true }).find((x) => x.id === id)
        || getProducts().find((x) => x.id === id);
      if (p) openProductDetail(p);
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-archive]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      archiveProduct(parseInt(btn.dataset.archive!));
      showToast("Produkt zarchiwizowany");
      renderList();
      notifySidebarUpdate();
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-clone]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const prod = getProducts({ show_archived: true }).find((x) => x.id === parseInt(btn.dataset.clone!));
      if (!prod) return;
      addProduct({
        name: prod.name + " (kopia)",
        unit: prod.unit,
        purchase_price: prod.purchase_price,
        catalog_price: prod.catalog_price,
        vat_rate: prod.vat_rate,
        category_id: prod.category_id,
        ean: prod.ean,
        sku: prod.sku,
        supplier: prod.supplier,
        min_order: prod.min_order,
        notes: prod.notes,
      });
      showToast("Produkt zduplikowany");
      renderList();
      notifySidebarUpdate();
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.delete!);
      const prod = getProducts({ show_archived: true }).find((p) => p.id === id);
      if (!prod) return;
      dangerModal(`Usunąć produkt "${esc(prod.name)}"?`, "Tej operacji nie można cofnąć.", "Usuń").then((confirmed) => {
        if (confirmed) {
          deleteProduct(id);
          showToast("Produkt usunięty");
          renderList();
          notifySidebarUpdate();
        }
      });
    });
  });

  page.querySelectorAll<HTMLTableRowElement>("tr[data-id]").forEach((tr) => {
    tr.addEventListener("dblclick", () => {
      const id = parseInt(tr.dataset.id!);
      const p = getProducts({ show_archived: true }).find((x) => x.id === id)
        || getProducts().find((x) => x.id === id);
      if (p) openProductDetail(p);
    });
  });

  // Bulk select
  const checkAllProducts = page.querySelector<HTMLInputElement>("#bulk-check-all-products");
  checkAllProducts?.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    page.querySelectorAll<HTMLInputElement>(".bulk-check").forEach((cb) => { cb.checked = checked; });
    updateProductBulkToolbar(page);
  });
  checkAllProducts?.addEventListener("click", (e) => e.stopPropagation());

  page.querySelectorAll<HTMLInputElement>(".bulk-check").forEach((cb) => {
    cb.addEventListener("change", () => updateProductBulkToolbar(page));
    cb.addEventListener("click", (e) => e.stopPropagation());
  });

  page.querySelector("#btn-bulk-delete-products")?.addEventListener("click", () => {
    const checked = page.querySelectorAll<HTMLInputElement>(".bulk-check:checked");
    const count = checked.length;
    if (count === 0) return;

    const label = count === 1 ? "produkt" : count < 5 ? "produkty" : "produktów";

    dangerModal(
      `Usunąć ${count} ${label}?`,
      "Tej operacji nie można cofnąć.",
      `Usuń ${count} ${label}`
    ).then((confirmed) => {
      if (confirmed) {
        const ids = Array.from(checked).map((cb) => parseInt(cb.dataset.productId!));
        ids.forEach((id) => deleteProduct(id));
        showToast(`Usunięto ${count} produktów`);
        renderList();
        notifySidebarUpdate();
      }
    });
  });

  page.querySelector("#btn-bulk-archive-products")?.addEventListener("click", () => {
    const checked = page.querySelectorAll<HTMLInputElement>(".bulk-check:checked");
    const count = checked.length;
    if (count === 0) return;

    const ids = Array.from(checked).map((cb) => parseInt(cb.dataset.productId!));
    ids.forEach((id) => archiveProduct(id));
    showToast(`Zarchiwizowano ${count} produktów`);
    renderList();
    notifySidebarUpdate();
  });
}

function updateProductBulkToolbar(page: HTMLElement): void {
  const checked = page.querySelectorAll<HTMLInputElement>(".bulk-check:checked");
  const toolbar = page.querySelector("#bulk-toolbar-products");
  const count = page.querySelector("#bulk-count-products");

  if (checked.length > 0) {
    toolbar?.classList.remove("hidden");
    if (count) count.textContent = `Zaznaczono: ${checked.length}`;
  } else {
    toolbar?.classList.add("hidden");
  }
}

// ─── Detail view (product form) ──────────────────────────────────
function getProductSections(product?: Product): DPSection[] {
  const categories = getCategories();
  const catOptions = [{ value: "", label: "— bez kategorii —" }, ...categories.map(c => ({ value: String(c.id), label: c.name }))];
  
  return [
    {
      id: "section-general",
      title: "Podstawowe informacje",
      columns: 2,
      fields: [
        { id: "f-p-name", name: "name", label: "Nazwa produktu", type: "text", required: true, placeholder: "np. Rękawice robocze L", value: product?.name ?? "" },
        { id: "f-p-category", name: "category_id", label: "Kategoria", type: "select", value: product?.category_id !== null ? String(product?.category_id) : "", options: catOptions },
        { id: "f-p-supplier", name: "supplier", label: "Producent / Hurtownia", type: "text", placeholder: "np. 3M", value: product?.supplier ?? "" },
        { id: "f-p-min-order", name: "min_order", label: "Min. zamówienie", type: "text", placeholder: "np. karton 12 szt", value: product?.min_order ?? "" },
      ]
    },
    {
      id: "section-pricing",
      title: "Ceny i VAT",
      columns: 3,
      fields: [
        { id: "f-p-purchase", name: "purchase_price", label: "Cena zakupu netto", type: "number", step: 0.01, min: 0, placeholder: "0,00", value: product?.purchase_price ?? "" },
        { id: "f-p-catalog", name: "catalog_price", label: "Cena katalogowa netto", type: "number", step: 0.01, min: 0, placeholder: "opcjonalnie", value: product?.catalog_price ?? "" },
        { id: "f-p-vat", name: "vat_rate", label: "VAT (%)", type: "select", value: String(product?.vat_rate ?? 23), options: [23,8,5,0].map(v => ({ value: String(v), label: v + "%" })) },
      ]
    },
    {
      id: "section-codes",
      title: "Kody i jednostki",
      columns: 3,
      fields: [
        { id: "f-p-unit", name: "unit", label: "Jednostka", type: "select", value: product?.unit ?? "szt", options: ["szt","kg","l","opak","paleta","karton","ryza","para","m","m2","m3","kpl"].map(u => ({ value: u, label: u === "m2" ? "m²" : u === "m3" ? "m³" : u })) },
        { id: "f-p-ean", name: "ean", label: "EAN (kod kreskowy)", type: "text", placeholder: "opcjonalnie", value: product?.ean ?? "" },
        { id: "f-p-sku", name: "sku", label: "SKU / Nr katalogowy", type: "text", placeholder: "opcjonalnie", value: product?.sku ?? "" },
      ]
    },
    {
      id: "section-notes",
      title: "Notatki",
      columns: 1,
      fields: [
        { id: "f-p-notes", name: "notes", label: "Notatki", type: "textarea", placeholder: "Dodatkowe informacje...", value: product?.notes ?? "", rows: 3 },
      ],
      customHtml: product ? renderProductPriceHistory(product.id) : "",
    }
  ];
}

function renderProductPriceHistory(productId: number): string {
  const history = getProductPriceHistory(productId);
  if (history.length === 0) return "";
  
  return `<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">
    <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--text-secondary)">
      <i class="fa-solid fa-clock-rotate-left" style="font-size:11px"></i> Historia cen (${history.length})
    </div>
    <div style="max-height:120px;overflow-y:auto;font-size:12px">
      ${history.slice(0, 10).map((h: any) => {
        const date = new Date(h.changed_at).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
        return `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">
          <span class="cell-muted">${date}</span>
          <span class="cell-mono">${formatPrice(h.purchase_price)} zł${h.catalog_price ? ` / kat: ${formatPrice(h.catalog_price)} zł` : ""}</span>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

function openProductDetail(product?: Product): void {
  view = "detail";
  detailId = product?.id ?? null;
  const isEdit = !!product;
  
  render();
}

function renderDetail(): void {
  const page = document.getElementById("page-products")!;
  const product = detailId ? (getProducts({ show_archived: true }).find((p) => p.id === detailId) || getProducts().find((p) => p.id === detailId)) : null;
  const isEdit = !!product;
  const sections = getProductSections(product ?? undefined);

  const footerButtons: DPFooterButton[] = [
    { id: "btn-cancel", label: "Anuluj", style: "secondary", action: "back" },
    { id: "btn-save", label: isEdit ? "Zapisz" : "Dodaj", style: "primary", action: "save" },
  ];

  page.innerHTML = `
    ${dpHeader(isEdit ? "Edytuj produkt" : "Dodaj produkt")}
    ${dpSections(sections)}
    ${dpFooter(footerButtons)}
  `;

  // Bind detail page actions (dpBindActions takes container and handlers object)
  dpBindActions(page, {
    back: () => {
      view = "list";
      detailId = null;
      renderList();
    },
    save: () => {
      const data = dpCollect(page, sections);
      const result = dpValidate(page, sections);
      
      if (!result.valid) {
        // Validation errors are already displayed by dpValidate
        return;
      }

      const input: ProductInput = {
        name: String(data.name || "").trim(),
        unit: String(data.unit || "szt"),
        purchase_price: parseFloat(String(data.purchase_price || 0)),
        catalog_price: parseFloat(String(data.catalog_price || 0)),
        vat_rate: parseInt(String(data.vat_rate || 23)),
        category_id: data.category_id ? parseInt(String(data.category_id)) : null,
        ean: String(data.ean || "").trim(),
        sku: String(data.sku || "").trim(),
        supplier: String(data.supplier || "").trim(),
        min_order: String(data.min_order || "").trim(),
        notes: String(data.notes || "").trim(),
      };

      // Check for duplicate names (but skip if editing the same product)
      if (!isEdit) {
        const dupName = checkDuplicateName(input.name, getProducts({ show_archived: true }).map(p => p.name));
        if (dupName && !confirm(`Produkt o podobnej nazwie już istnieje: "${dupName}". Dodać mimo to?`)) return;
      }

      if (isEdit && product) {
        updateProduct(product.id, input);
        showToast("Produkt zaktualizowany");
      } else {
        addProduct(input);
        showToast("Produkt dodany");
      }

      view = "list";
      detailId = null;
      renderList();
      notifySidebarUpdate();
    },
  });

  // Focus first field
  setTimeout(() => dpFocus(page, sections), 80);
}

// ─── CSV Export ──────────────────────────────────────────────────
async function exportProductsCSV(): Promise<void> {
  const allProducts = getProducts({});
  const sep = ";";

  const csvCell = (val: string | number): string => {
    const s = String(val);
    if (s.includes(sep) || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const priceCell = (val: number): string => val.toFixed(2).replace(".", ",");

  const lines: string[] = [];

  // Header
  const headers = ["Nazwa", "Jednostka", "Cena zakupu netto", "Cena katalogowa netto", "VAT %", "Dostawca", "SKU", "EAN", "Notatki"];
  lines.push(headers.map(csvCell).join(sep));

  // Rows
  allProducts.forEach((p) => {
    const row: string[] = [
      csvCell(p.name),
      csvCell(p.unit),
      priceCell(p.purchase_price),
      priceCell(p.catalog_price),
      String(p.vat_rate),
      csvCell(p.supplier || ""),
      csvCell(p.sku || ""),
      csvCell(p.ean || ""),
      csvCell(p.notes || ""),
    ];
    lines.push(row.join(sep));
  });

  // BOM for UTF-8
  const bom = "\uFEFF";
  const csv = bom + lines.join("\r\n");

  try {
    const filePath = await save({
      title: "Zapisz produkty CSV",
      defaultPath: "produkty.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;
    await writeTextFile(filePath, csv);
    showToast("CSV wyeksportowany");
  } catch (err) {
    console.error("CSV export error:", err);
  }
}

// ─── Sidebar update callback ────────────────────────────────────
let _sidebarUpdateCb: (() => void) | null = null;

export function onProductSidebarUpdate(cb: () => void): void {
  _sidebarUpdateCb = cb;
}

function notifySidebarUpdate(): void {
  _sidebarUpdateCb?.();
}

// ─── Init ────────────────────────────────────────────────────────
export function initProducts(): void {
  render();
}

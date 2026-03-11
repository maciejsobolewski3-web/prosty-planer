// ─── Cenniki — Excel Viewer / Importer with Manual Mapping ──────
// Browse saved Excel price lists, map columns, import to materials/products

import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readExcelFile, autoDetectMapping, sanitizePrice, ROLE_LABELS, ROLE_COLORS } from "./excel-reader";
import {
  getExcelFiles, getExcelFileById, addExcelFile, updateExcelFile, deleteExcelFile,
  getMappingTemplates, addMappingTemplate, deleteMappingTemplate,
  addImportHistoryEntry, getImportHistory,
  addMaterial, getMaterials, updateMaterial,
} from "./store";
import { getAppMode, addProduct, getProducts, updateProduct } from "./store-trade";
import { esc, showToast, formatPrice, openModal, closeModal } from "./ui";
import { dangerModal } from "./danger-modal";
import type { ColumnMapping, ColumnRole, SavedSheet, SavedExcelFile, MappingTemplate, PriceChangeRecord } from "./types";

// ─── Module state ───────────────────────────────────────────────
let view: "list" | "detail" = "list";
let detailId: number | null = null;
let activeSheetIdx = 0;
let currentMappings: ColumnMapping[] = [];
let selectedRows = new Set<number>();
let selectAll = true;

// ─── Public init ────────────────────────────────────────────────
export function initCenniki(): void {
  view = "list";
  detailId = null;
  render();
}

function render(): void {
  const page = document.getElementById("page-cenniki");
  if (!page) return;
  if (view === "detail" && detailId !== null) renderDetail(page);
  else renderList(page);
}

// ─── List view ──────────────────────────────────────────────────
function renderList(page: HTMLElement): void {
  const files = getExcelFiles();
  const templates = getMappingTemplates();

  page.innerHTML = `
    <div class="page-topbar">
      <div class="page-topbar-left">
        <h1 class="page-title">CENNIKI</h1>
      </div>
      <div class="page-topbar-right">
        <button class="btn btn-primary" id="cennik-add">
          <i class="fa-solid fa-plus"></i> DODAJ CENNIK
        </button>
      </div>
    </div>

    ${files.length === 0 ? `
      <div style="text-align:center;padding:80px 20px;color:var(--text-secondary)">
        <i class="fa-solid fa-file-excel" style="font-size:48px;margin-bottom:16px;opacity:0.3"></i>
        <p style="font-size:16px;font-weight:600;margin-bottom:8px">Brak cenników</p>
        <p style="font-size:13px">Dodaj cennik dostawcy (Excel/CSV), zmapuj kolumny i importuj do bazy materiałów lub produktów.</p>
      </div>
    ` : `
      <table class="data-table">
        <thead><tr>
          <th>Nazwa cennika</th>
          <th>Dostawca</th>
          <th>Pozycji</th>
          <th>Importów</th>
          <th>Ostatni import</th>
          <th>Dodano</th>
          <th style="width:80px"></th>
        </tr></thead>
        <tbody>
          ${files.map((f) => {
            const totalRows = f.sheets.reduce((sum, s) => sum + s.totalRows, 0);
            const lastImport = f.last_imported_at ? new Date(f.last_imported_at).toLocaleDateString("pl") : "—";
            const created = new Date(f.created_at).toLocaleDateString("pl");
            return `
              <tr class="clickable-row" data-cennik-id="${f.id}">
                <td><strong>${esc(f.name)}</strong><div style="font-size:10px;color:var(--text-secondary)">${esc(f.original_filename)}</div></td>
                <td>${esc(f.supplier || "—")}</td>
                <td>${totalRows}</td>
                <td>${f.import_count}</td>
                <td>${lastImport}</td>
                <td>${created}</td>
                <td>
                  <button class="btn-icon delete-cennik" data-id="${f.id}" title="Usuń"><i class="fa-solid fa-trash"></i></button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>

      ${templates.length > 0 ? `
        <div style="margin-top:32px">
          <h3 style="font-size:13px;font-weight:600;margin-bottom:12px;color:var(--text-secondary)">
            <i class="fa-solid fa-bookmark"></i> Szablony mapowań (${templates.length})
          </h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${templates.map((t) => `
              <span class="tag" style="font-size:12px;padding:6px 12px">
                ${esc(t.name)} (${t.mappings.filter((m) => m.role !== "skip").length} kolumn)
                <button class="btn-icon delete-template" data-id="${t.id}" style="margin-left:6px;font-size:10px" title="Usuń szablon"><i class="fa-solid fa-xmark"></i></button>
              </span>
            `).join("")}
          </div>
        </div>
      ` : ""}
    `}
  `;

  // Bind events
  page.querySelector("#cennik-add")?.addEventListener("click", handleAddCennik);

  page.querySelectorAll<HTMLElement>(".clickable-row[data-cennik-id]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".delete-cennik")) return;
      detailId = parseInt(row.dataset.cennikId!);
      view = "detail";
      activeSheetIdx = 0;
      render();
    });
  });

  page.querySelectorAll<HTMLElement>(".delete-cennik").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id!);
      const file = getExcelFileById(id);
      if (file && await dangerModal(`Usunąć cennik „${file.name}"?`)) {
        deleteExcelFile(id);
        render();
      }
    });
  });

  page.querySelectorAll<HTMLElement>(".delete-template").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id!);
      if (await dangerModal("Usunąć szablon mapowania?")) {
        deleteMappingTemplate(id);
        render();
      }
    });
  });
}

// ─── Add cennik (file picker) ───────────────────────────────────
async function handleAddCennik(): Promise<void> {
  const filePath = await dialogOpen({
    title: "Wybierz cennik Excel lub CSV",
    filters: [{ name: "Excel / CSV", extensions: ["xlsx", "xls", "csv", "tsv"] }],
  });
  if (!filePath) return;

  try {
    const sheets = await readExcelFile(filePath);
    if (sheets.length === 0 || sheets.every((s) => s.rows.length === 0)) {
      showToast("Plik jest pusty lub nie zawiera danych");
      return;
    }

    const filename = String(filePath).split(/[\\/]/).pop() || "cennik.xlsx";
    const baseName = filename.replace(/\.\w+$/, "");

    const file = addExcelFile({
      name: baseName,
      original_filename: filename,
      supplier: "",
      sheets,
    });

    // Auto-detect mapping for first sheet
    currentMappings = autoDetectMapping(sheets[0].headers);
    updateExcelFile(file.id, { active_mappings: currentMappings });

    detailId = file.id;
    view = "detail";
    activeSheetIdx = 0;
    selectedRows = new Set<number>();
    selectAll = true;
    render();

    const detected = currentMappings.filter((m) => m.role !== "skip").length;
    if (detected > 0) {
      showToast(`Wykryto ${detected} kolumn automatycznie — sprawdź mapowanie`);
    }
  } catch (e: any) {
    showToast(`Błąd czytania pliku: ${e.message}`);
  }
}

// ─── Detail view (viewer + mapping) ─────────────────────────────
function renderDetail(page: HTMLElement): void {
  const file = getExcelFileById(detailId!);
  if (!file) { view = "list"; render(); return; }

  const sheet = file.sheets[activeSheetIdx] || file.sheets[0];
  if (!sheet) { view = "list"; render(); return; }

  currentMappings = file.active_mappings?.length ? [...file.active_mappings] : autoDetectMapping(sheet.headers);
  const templates = getMappingTemplates();
  const mode = getAppMode();
  const targetLabel = mode === "handlowy" ? "produktów" : "materiałów";
  const history = getImportHistory(file.id);

  // Ensure mappings cover all columns
  while (currentMappings.length < sheet.headers.length) {
    currentMappings.push({ column_index: currentMappings.length, role: "skip" });
  }

  const mappedRoles = currentMappings.filter((m) => m.role !== "skip");
  const hasName = mappedRoles.some((m) => m.role === "name");
  const hasPrice = mappedRoles.some((m) => m.role === "price");

  // Determine selected count
  if (selectAll) {
    selectedRows = new Set(sheet.rows.map((_, i) => i));
  }

  page.innerHTML = `
    <div class="page-topbar">
      <div class="page-topbar-left">
        <button class="btn btn-ghost" id="cennik-back"><i class="fa-solid fa-arrow-left"></i></button>
        <h1 class="page-title" style="margin-left:8px">${esc(file.name)}</h1>
        ${file.supplier ? `<span class="tag" style="margin-left:8px">${esc(file.supplier)}</span>` : ""}
      </div>
      <div class="page-topbar-right">
        <button class="btn" id="cennik-compare" ${!hasName ? "disabled" : ""}>
          <i class="fa-solid fa-code-compare"></i> Porównaj z bazą
        </button>
        <button class="btn btn-primary" id="cennik-import" ${!(hasName && hasPrice) ? "disabled" : ""}>
          <i class="fa-solid fa-download"></i> Importuj (${selectedRows.size}) do ${targetLabel}
        </button>
      </div>
    </div>

    <!-- Sheet tabs -->
    ${file.sheets.length > 1 ? `
      <div style="display:flex;gap:4px;margin-bottom:12px">
        ${file.sheets.map((s, i) => `
          <button class="btn ${i === activeSheetIdx ? "btn-primary" : ""} sheet-tab" data-idx="${i}" style="font-size:12px;padding:4px 12px">
            ${esc(s.name)} (${s.totalRows})
          </button>
        `).join("")}
      </div>
    ` : ""}

    <!-- Mapping panel -->
    <div class="cennik-mapping-panel">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:600;color:var(--text-secondary)">MAPOWANIE:</span>
        ${mappedRoles.map((m) => `
          <span class="cennik-role-badge" style="--role-color:${ROLE_COLORS[m.role]}">
            ${ROLE_LABELS[m.role]} → kol. ${m.column_index + 1}
          </span>
        `).join("")}
        ${mappedRoles.length === 0 ? '<span style="font-size:12px;color:var(--text-secondary)">Kliknij nagłówek kolumny aby przypisać rolę</span>' : ""}
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <select id="cennik-template-select" style="font-size:12px;padding:4px 8px">
          <option value="">— Szablon —</option>
          ${templates.map((t) => `<option value="${t.id}" ${file.mapping_template_id === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}
        </select>
        <button class="btn" id="cennik-save-template" style="font-size:11px;padding:4px 10px">
          <i class="fa-solid fa-bookmark"></i> Zapisz szablon
        </button>
        <button class="btn" id="cennik-auto-detect" style="font-size:11px;padding:4px 10px">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Auto-detect
        </button>
      </div>
    </div>

    <!-- Data table -->
    <div style="overflow-x:auto;margin-top:12px">
      <table class="data-table cennik-table">
        <thead><tr>
          <th style="width:30px"><input type="checkbox" id="cennik-select-all" ${selectAll ? "checked" : ""} /></th>
          <th style="width:30px">#</th>
          ${sheet.headers.map((h, i) => {
            const mapping = currentMappings.find((m) => m.column_index === i);
            const role = mapping?.role || "skip";
            const color = ROLE_COLORS[role];
            return `
              <th class="cennik-col-header" data-col="${i}" style="cursor:pointer;position:relative">
                <div style="font-size:11px;font-weight:400;color:var(--text-secondary)">${esc(h || `Kol. ${i + 1}`)}</div>
                <div class="cennik-role-tag" style="background:${color};color:#fff;font-size:9px;padding:1px 6px;border-radius:3px;display:inline-block;margin-top:2px">
                  ${ROLE_LABELS[role]}
                </div>
              </th>
            `;
          }).join("")}
        </tr></thead>
        <tbody>
          ${sheet.rows.slice(0, 200).map((row, rIdx) => `
            <tr class="${selectedRows.has(rIdx) ? "" : "row-deselected"}">
              <td><input type="checkbox" class="cennik-row-check" data-row="${rIdx}" ${selectedRows.has(rIdx) ? "checked" : ""} /></td>
              <td style="font-size:10px;color:var(--text-secondary)">${rIdx + 1}</td>
              ${sheet.headers.map((_, cIdx) => {
                const val = row[cIdx] || "";
                const mapping = currentMappings.find((m) => m.column_index === cIdx);
                const role = mapping?.role || "skip";
                const isPriceCol = role === "price";
                return `<td class="${role !== "skip" ? "cennik-mapped-cell" : ""}" style="${isPriceCol ? "text-align:right;font-family:monospace" : ""}">${esc(val)}</td>`;
              }).join("")}
            </tr>
          `).join("")}
          ${sheet.totalRows > 200 ? `<tr><td colspan="${sheet.headers.length + 2}" style="text-align:center;padding:12px;color:var(--text-secondary);font-size:12px">Wyświetlono 200 z ${sheet.totalRows} wierszy</td></tr>` : ""}
        </tbody>
      </table>
    </div>

    ${history.length > 0 ? `
      <div style="margin-top:24px;padding:16px;background:var(--bg-secondary);border-radius:var(--radius)">
        <h3 style="font-size:13px;font-weight:600;margin-bottom:8px"><i class="fa-solid fa-clock-rotate-left"></i> Historia importów</h3>
        ${history.slice(0, 5).map((h) => `
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">
            ${new Date(h.imported_at).toLocaleString("pl")} — dodano ${h.items_added}, zaktualizowano ${h.items_updated}, pominięto ${h.items_skipped}
            ${h.price_changes.length > 0 ? `<span style="color:var(--warning)"> (${h.price_changes.length} zmian cen)</span>` : ""}
          </div>
        `).join("")}
      </div>
    ` : ""}
  `;

  bindDetailEvents(page, file, sheet);
}

// ─── Bind detail page events ────────────────────────────────────
function bindDetailEvents(page: HTMLElement, file: SavedExcelFile, sheet: SavedSheet): void {
  // Back button
  page.querySelector("#cennik-back")?.addEventListener("click", () => {
    view = "list"; render();
  });

  // Sheet tabs
  page.querySelectorAll<HTMLElement>(".sheet-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeSheetIdx = parseInt(btn.dataset.idx!);
      currentMappings = autoDetectMapping(file.sheets[activeSheetIdx].headers);
      updateExcelFile(file.id, { active_mappings: currentMappings });
      selectedRows = new Set<number>();
      selectAll = true;
      render();
    });
  });

  // Column header click → mapping dropdown
  page.querySelectorAll<HTMLElement>(".cennik-col-header").forEach((th) => {
    th.addEventListener("click", (e) => {
      const colIdx = parseInt(th.dataset.col!);
      showMappingDropdown(e, colIdx, file);
    });
  });

  // Select all checkbox
  page.querySelector("#cennik-select-all")?.addEventListener("change", (e) => {
    selectAll = (e.target as HTMLInputElement).checked;
    if (selectAll) {
      selectedRows = new Set(sheet.rows.map((_, i) => i));
    } else {
      selectedRows.clear();
    }
    render();
  });

  // Individual row checkboxes
  page.querySelectorAll<HTMLInputElement>(".cennik-row-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      const idx = parseInt(cb.dataset.row!);
      if (cb.checked) selectedRows.add(idx); else selectedRows.delete(idx);
      selectAll = selectedRows.size === sheet.rows.length;
      // Update import button count
      const importBtn = page.querySelector("#cennik-import");
      if (importBtn) {
        const mode = getAppMode();
        const label = mode === "handlowy" ? "produktów" : "materiałów";
        importBtn.innerHTML = `<i class="fa-solid fa-download"></i> Importuj (${selectedRows.size}) do ${label}`;
      }
    });
  });

  // Template select
  page.querySelector("#cennik-template-select")?.addEventListener("change", (e) => {
    const tplId = parseInt((e.target as HTMLSelectElement).value);
    if (!tplId) return;
    const tpl = getMappingTemplates().find((t) => t.id === tplId);
    if (tpl) {
      currentMappings = [...tpl.mappings];
      updateExcelFile(file.id, { active_mappings: currentMappings, mapping_template_id: tpl.id });
      render();
      showToast(`Załadowano szablon "${tpl.name}"`);
    }
  });

  // Save template
  page.querySelector("#cennik-save-template")?.addEventListener("click", () => {
    const name = prompt("Nazwa szablonu:");
    if (!name?.trim()) return;
    addMappingTemplate({ name: name.trim(), mappings: currentMappings, header_row_index: 0 });
    showToast(`Szablon "${name}" zapisany`);
    render();
  });

  // Auto-detect
  page.querySelector("#cennik-auto-detect")?.addEventListener("click", () => {
    currentMappings = autoDetectMapping(sheet.headers);
    updateExcelFile(file.id, { active_mappings: currentMappings });
    render();
    const detected = currentMappings.filter((m) => m.role !== "skip").length;
    showToast(`Auto-detect: ${detected} kolumn rozpoznanych`);
  });

  // Import
  page.querySelector("#cennik-import")?.addEventListener("click", () => {
    executeImport(file, sheet);
  });

  // Compare
  page.querySelector("#cennik-compare")?.addEventListener("click", () => {
    showComparison(file, sheet);
  });
}

// ─── Mapping dropdown ───────────────────────────────────────────
function showMappingDropdown(event: Event, colIdx: number, file: SavedExcelFile): void {
  // Remove any existing dropdown
  document.querySelector(".cennik-mapping-dropdown")?.remove();

  const th = event.currentTarget as HTMLElement;
  const rect = th.getBoundingClientRect();
  const currentRole = currentMappings.find((m) => m.column_index === colIdx)?.role || "skip";

  const roles: ColumnRole[] = ["name", "price", "unit", "vat", "supplier", "sku", "category", "notes", "skip"];

  const dropdown = document.createElement("div");
  dropdown.className = "cennik-mapping-dropdown";
  dropdown.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${rect.left}px;z-index:9999;background:var(--bg-primary);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 8px 24px rgba(0,0,0,0.3);min-width:160px;padding:4px`;

  for (const role of roles) {
    const item = document.createElement("div");
    item.style.cssText = `padding:6px 12px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:8px;border-radius:4px`;
    item.innerHTML = `
      <span style="width:8px;height:8px;border-radius:50%;background:${ROLE_COLORS[role]};display:inline-block"></span>
      ${ROLE_LABELS[role]}
      ${role === currentRole ? '<i class="fa-solid fa-check" style="margin-left:auto;font-size:10px;color:var(--accent)"></i>' : ""}
    `;
    item.addEventListener("mouseenter", () => item.style.background = "var(--bg-hover)");
    item.addEventListener("mouseleave", () => item.style.background = "transparent");
    item.addEventListener("click", () => {
      // If this role is already assigned to another column, clear it
      const existing = currentMappings.findIndex((m) => m.role === role && m.column_index !== colIdx && role !== "skip");
      if (existing >= 0) currentMappings[existing].role = "skip";

      const idx = currentMappings.findIndex((m) => m.column_index === colIdx);
      if (idx >= 0) currentMappings[idx].role = role;
      else currentMappings.push({ column_index: colIdx, role });

      updateExcelFile(file.id, { active_mappings: currentMappings });
      dropdown.remove();
      render();
    });
    dropdown.appendChild(item);
  }

  document.body.appendChild(dropdown);

  // Close on outside click
  const closeHandler = (e: MouseEvent) => {
    if (!dropdown.contains(e.target as Node)) {
      dropdown.remove();
      document.removeEventListener("click", closeHandler);
    }
  };
  setTimeout(() => document.addEventListener("click", closeHandler), 0);
}

// ─── Execute import ─────────────────────────────────────────────
function executeImport(file: SavedExcelFile, sheet: SavedSheet): void {
  const nameCol = currentMappings.find((m) => m.role === "name")?.column_index;
  const priceCol = currentMappings.find((m) => m.role === "price")?.column_index;
  const unitCol = currentMappings.find((m) => m.role === "unit")?.column_index;
  const vatCol = currentMappings.find((m) => m.role === "vat")?.column_index;
  const supplierCol = currentMappings.find((m) => m.role === "supplier")?.column_index;
  const skuCol = currentMappings.find((m) => m.role === "sku")?.column_index;
  const catCol = currentMappings.find((m) => m.role === "category")?.column_index;
  const notesCol = currentMappings.find((m) => m.role === "notes")?.column_index;

  if (nameCol == null || priceCol == null) {
    showToast("Musisz zmapować przynajmniej kolumnę Nazwa i Cena");
    return;
  }

  const mode = getAppMode();
  let added = 0, updated = 0, skipped = 0;
  const priceChanges: PriceChangeRecord[] = [];

  // Build lookup for existing items
  const existingByName = new Map<string, { price: number }>();
  if (mode === "handlowy") {
    for (const p of getProducts({})) existingByName.set(p.name.toLowerCase().trim(), { price: p.purchase_price });
  } else {
    for (const m of getMaterials({})) existingByName.set(m.name.toLowerCase().trim(), { price: m.price_netto });
  }

  for (const rowIdx of selectedRows) {
    const row = sheet.rows[rowIdx];
    if (!row) continue;

    const name = row[nameCol]?.trim();
    if (!name) { skipped++; continue; }

    const price = sanitizePrice(row[priceCol!]);
    const unit = unitCol != null ? (row[unitCol]?.trim() || "szt") : "szt";
    const vatRate = vatCol != null ? (sanitizePrice(row[vatCol]) || 23) : 23;
    const supplier = supplierCol != null ? (row[supplierCol]?.trim() || file.supplier || "") : (file.supplier || "");
    const sku = skuCol != null ? (row[skuCol]?.trim() || "") : "";
    const notes = notesCol != null ? (row[notesCol]?.trim() || "") : "";

    // Check for existing item with same name
    const existingKey = name.toLowerCase().trim();
    const existing = existingByName.get(existingKey);

    if (existing) {
      if (Math.abs(existing.price - price) > 0.01) {
        priceChanges.push({
          material_name: name,
          old_price: existing.price,
          new_price: price,
          change_pct: existing.price > 0 ? ((price - existing.price) / existing.price) * 100 : 0,
        });
        // Update price in existing item
        if (mode === "handlowy") {
          const prod = getProducts({}).find((p) => p.name.toLowerCase().trim() === existingKey);
          if (prod) {
            updateProduct(prod.id, { ...prod, purchase_price: price });
          }
        } else {
          const mat = getMaterials({}).find((m) => m.name.toLowerCase().trim() === existingKey);
          if (mat) {
            updateMaterial(mat.id, { ...mat, price_netto: price });
          }
        }
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    // Add new item
    if (mode === "handlowy") {
      addProduct({
        name, unit, purchase_price: price, catalog_price: 0, vat_rate: vatRate,
        category_id: null, ean: "", sku, supplier, min_order: "", notes,
      });
    } else {
      addMaterial({
        name, unit, price_netto: price, vat_rate: vatRate,
        category_id: null, supplier, sku, url: "", notes,
      });
    }
    added++;
    existingByName.set(existingKey, { price });
  }

  // Record import
  updateExcelFile(file.id, {
    import_count: file.import_count + 1,
    last_imported_at: new Date().toISOString(),
  });

  addImportHistoryEntry({
    excel_file_id: file.id,
    imported_at: new Date().toISOString(),
    items_added: added,
    items_updated: updated,
    items_skipped: skipped,
    price_changes: priceChanges,
  });

  let msg = `Import: ${added} dodano`;
  if (updated > 0) msg += `, ${updated} zaktualizowano ceny`;
  if (skipped > 0) msg += `, ${skipped} pominięto`;
  showToast(msg);

  // Show price changes if any
  if (priceChanges.length > 0) {
    showPriceChangesModal(priceChanges);
  }

  window.dispatchEvent(new CustomEvent("excel-import-done", { detail: { count: added + updated } }));
  render();
}

// ─── Price changes modal ────────────────────────────────────────
function showPriceChangesModal(changes: PriceChangeRecord[]): void {
  const html = `
    <div style="max-height:50vh;overflow-y:auto">
      <p style="margin-bottom:12px;font-size:13px">Zaktualizowano ceny ${changes.length} pozycji:</p>
      <table class="data-table" style="font-size:12px">
        <thead><tr><th>Nazwa</th><th>Stara cena</th><th>Nowa cena</th><th>Zmiana</th></tr></thead>
        <tbody>
          ${changes.map((c) => {
            const arrow = c.change_pct >= 0 ? "↑" : "↓";
            const color = c.change_pct >= 0 ? "var(--danger)" : "var(--success)";
            return `<tr>
              <td>${esc(c.material_name)}</td>
              <td class="cell-mono">${formatPrice(c.old_price)} zł</td>
              <td class="cell-mono">${formatPrice(c.new_price)} zł</td>
              <td style="color:${color};font-weight:600">${arrow} ${Math.abs(c.change_pct).toFixed(1)}%</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <div style="margin-top:16px;text-align:right">
      <button class="btn" id="price-changes-close">OK</button>
    </div>
  `;
  openModal('<i class="fa-solid fa-chart-line"></i> Zmiany cen', html);
  document.getElementById("price-changes-close")?.addEventListener("click", closeModal);
}

// ─── Compare with database ──────────────────────────────────────
function showComparison(file: SavedExcelFile, sheet: SavedSheet): void {
  const nameCol = currentMappings.find((m) => m.role === "name")?.column_index;
  const priceCol = currentMappings.find((m) => m.role === "price")?.column_index;

  if (nameCol == null) { showToast("Zmapuj kolumnę Nazwa"); return; }

  const mode = getAppMode();
  const existingByName = new Map<string, number>();
  if (mode === "handlowy") {
    for (const p of getProducts({})) existingByName.set(p.name.toLowerCase().trim(), p.purchase_price);
  } else {
    for (const m of getMaterials({})) existingByName.set(m.name.toLowerCase().trim(), m.price_netto);
  }

  type CompRow = { name: string; excelPrice: number; dbPrice: number | null; status: "new" | "changed" | "same" };
  const rows: CompRow[] = [];

  for (const row of sheet.rows) {
    const name = row[nameCol]?.trim();
    if (!name) continue;
    const excelPrice = priceCol != null ? sanitizePrice(row[priceCol]) : 0;
    const dbPrice = existingByName.get(name.toLowerCase().trim()) ?? null;

    let status: CompRow["status"] = "new";
    if (dbPrice !== null) {
      status = Math.abs(dbPrice - excelPrice) > 0.01 ? "changed" : "same";
    }
    rows.push({ name, excelPrice, dbPrice, status });
  }

  const newCount = rows.filter((r) => r.status === "new").length;
  const changedCount = rows.filter((r) => r.status === "changed").length;
  const sameCount = rows.filter((r) => r.status === "same").length;

  const html = `
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <span class="tag" style="background:var(--success-subtle);color:var(--success)"><i class="fa-solid fa-plus"></i> ${newCount} nowych</span>
      <span class="tag" style="background:var(--warning-subtle);color:var(--warning)"><i class="fa-solid fa-arrows-rotate"></i> ${changedCount} zmian cen</span>
      <span class="tag">${sameCount} bez zmian</span>
    </div>
    <div style="max-height:50vh;overflow-y:auto">
      <table class="data-table" style="font-size:12px">
        <thead><tr><th>Nazwa</th><th>Cena w cenniku</th><th>Cena w bazie</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.filter((r) => r.status !== "same").slice(0, 100).map((r) => {
            if (r.status === "new") {
              return `<tr><td>${esc(r.name)}</td><td class="cell-mono">${formatPrice(r.excelPrice)} zł</td><td>—</td><td style="color:var(--success)"><i class="fa-solid fa-plus-circle"></i> Nowy</td></tr>`;
            }
            const diff = r.dbPrice! > 0 ? ((r.excelPrice - r.dbPrice!) / r.dbPrice!) * 100 : 0;
            const arrow = diff >= 0 ? "↑" : "↓";
            const color = diff >= 0 ? "var(--danger)" : "var(--success)";
            return `<tr><td>${esc(r.name)}</td><td class="cell-mono">${formatPrice(r.excelPrice)} zł</td><td class="cell-mono">${formatPrice(r.dbPrice!)} zł</td><td style="color:${color};font-weight:600">${arrow} ${Math.abs(diff).toFixed(1)}%</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <div style="margin-top:16px;text-align:right">
      <button class="btn" id="compare-close">Zamknij</button>
    </div>
  `;
  openModal('<i class="fa-solid fa-code-compare"></i> Porównanie z bazą', html);
  document.getElementById("compare-close")?.addEventListener("click", closeModal);
}

// ─── Navigate to cenniki from other modules ─────────────────────
export function navigateToCenniki(): void {
  view = "list";
  detailId = null;
  window.dispatchEvent(new CustomEvent("navigate", { detail: { page: "cenniki" } }));
}

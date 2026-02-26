// ─── Smart Excel → AI Import Pipeline ────────────────────────────
// Reads any Excel/CSV file, converts it to a structured text
// representation, then sends to AI to analyze structure and propose
// which items to add to the product catalog or materials database.

import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { getAppMode, addProduct, fuzzyMatchProduct, getProducts, type ProductInput } from "./store-trade";
import { addMaterial, getMaterials, type MaterialInput } from "./store";
import { openModal, closeModal, showToast, esc, formatPrice } from "./ui";

interface ParsedSheet {
  name: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
}

interface AIImportProposal {
  items: ProposedItem[];
  message: string;
}

interface ProposedItem {
  name: string;
  unit: string;
  price: number;
  vat_rate: number;
  supplier: string;
  category: string;
  notes: string;
  // For trade mode
  purchase_price?: number;
  catalog_price?: number;
  sku?: string;
  // For matching
  already_exists: boolean;
  existing_name?: string;
}

// ─── Parse Excel to structured text for AI ──────────────────────
function sheetsToAIText(sheets: ParsedSheet[]): string {
  let text = "";
  for (const sheet of sheets) {
    text += `\n=== ARKUSZ: "${sheet.name}" (${sheet.totalRows} wierszy) ===\n`;

    // Show headers
    if (sheet.headers.length > 0) {
      text += `NAGŁÓWKI: ${sheet.headers.map((h, i) => `[${i}]"${h}"`).join(" | ")}\n`;
    }

    // Show first 50 rows as sample
    const sampleRows = sheet.rows.slice(0, 50);
    text += `\nPIERWSZE ${sampleRows.length} WIERSZY:\n`;
    for (let r = 0; r < sampleRows.length; r++) {
      const row = sampleRows[r];
      const cells = row.map((cell, i) => `[${i}]${cell}`).join(" | ");
      text += `  ${r + 1}: ${cells}\n`;
    }

    if (sheet.totalRows > 50) {
      text += `  ... (jeszcze ${sheet.totalRows - 50} wierszy)\n`;
    }
  }
  return text;
}

// ─── Read and parse Excel file ──────────────────────────────────
async function readExcelFile(filePath: string): Promise<ParsedSheet[]> {
  const fileData = await readFile(filePath);
  const XLSX = await import("xlsx");
  const wb = XLSX.read(fileData, { type: "array" });

  const sheets: ParsedSheet[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rawData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

    if (rawData.length === 0) continue;

    // Detect header row (first row with 3+ non-empty text cells)
    let headerIdx = 0;
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i] || [];
      const textCells = row.filter((c: any) => typeof c === "string" && c.trim().length > 1);
      if (textCells.length >= 3) {
        headerIdx = i;
        break;
      }
    }

    const headerRow = (rawData[headerIdx] || []).map((c: any) => String(c || "").trim());
    const dataRows = rawData.slice(headerIdx + 1)
      .filter((row: any[]) => row.some((c: any) => c !== null && c !== undefined && String(c).trim() !== ""))
      .map((row: any[]) => row.map((c: any) => String(c ?? "").trim()));

    sheets.push({
      name: sheetName,
      headers: headerRow,
      rows: dataRows,
      totalRows: dataRows.length,
    });
  }

  return sheets;
}

// ─── Call AI to analyze Excel structure ─────────────────────────
async function callAIForExcelAnalysis(excelText: string, mode: string): Promise<string> {
  const response = await fetch("https://prostyprzetarg.pl/api/planer/excel-analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      excel_text: excelText,
      mode: mode,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`AI Error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  // Backend returns the JSON directly (analysis + items), stringify it for parseAIResponse
  return JSON.stringify(data);
}

// ─── Parse AI response ──────────────────────────────────────────
function parseAIResponse(raw: string): { analysis: string; items: ProposedItem[] } {
  // Try to extract JSON from the response
  let jsonStr = raw;

  // Remove markdown code blocks if present
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];

  // Try direct parse
  try {
    const parsed = JSON.parse(jsonStr.trim());
    const items: ProposedItem[] = (parsed.items || []).map((item: any) => ({
      name: item.name || "",
      unit: item.unit || "szt",
      price: parseFloat(item.price) || 0,
      vat_rate: parseFloat(item.vat_rate) || 23,
      supplier: item.supplier || "",
      category: item.category || "",
      notes: item.notes || "",
      purchase_price: parseFloat(item.price) || 0,
      catalog_price: parseFloat(item.catalog_price) || 0,
      sku: item.sku || "",
      already_exists: false,
    }));

    // Check which items already exist
    const mode = getAppMode();
    for (const item of items) {
      if (mode === "handlowy") {
        const match = fuzzyMatchProduct(item.name);
        if (match && match.score >= 0.7) {
          item.already_exists = true;
          item.existing_name = match.product.name;
        }
      } else {
        const mats = getMaterials({});
        const lowerName = item.name.toLowerCase();
        const existing = mats.find((m) => m.name.toLowerCase().includes(lowerName) || lowerName.includes(m.name.toLowerCase()));
        if (existing) {
          item.already_exists = true;
          item.existing_name = existing.name;
        }
      }
    }

    return {
      analysis: parsed.analysis || "Plik przeanalizowany",
      items,
    };
  } catch {
    return { analysis: "Nie udało się sparsować odpowiedzi AI", items: [] };
  }
}

// ─── Render import modal ────────────────────────────────────────
function renderImportModal(analysis: string, items: ProposedItem[], onImport: (selected: ProposedItem[]) => void): void {
  const mode = getAppMode();
  const targetLabel = mode === "handlowy" ? "cennika produktów" : "bazy materiałów";
  const newItems = items.filter((i) => !i.already_exists);
  const existingItems = items.filter((i) => i.already_exists);

  const modalHtml = `
    <div style="max-height:70vh;overflow-y:auto">
      <div style="padding:12px 16px;background:var(--bg-secondary);border-radius:var(--radius);margin-bottom:16px;font-size:13px;color:var(--text-secondary)">
        <i class="fa-solid fa-robot" style="color:var(--accent);margin-right:6px"></i>
        <strong>Analiza AI:</strong> ${esc(analysis)}
      </div>

      <div style="display:flex;gap:8px;margin-bottom:16px">
        <span class="tag" style="background:var(--success-subtle);color:var(--success)">
          <i class="fa-solid fa-plus"></i> ${newItems.length} nowych
        </span>
        <span class="tag" style="background:var(--warning-subtle);color:var(--warning)">
          <i class="fa-solid fa-check"></i> ${existingItems.length} już w bazie
        </span>
        <span class="tag">Razem: ${items.length} pozycji</span>
      </div>

      ${items.length === 0 ? '<p style="color:var(--text-secondary)">AI nie znalazło produktów do zaimportowania.</p>' : `
        <div style="margin-bottom:12px">
          <label style="font-size:12px;cursor:pointer">
            <input type="checkbox" id="excel-ai-select-all" checked /> Zaznacz wszystkie nowe
          </label>
        </div>

        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th style="width:30px"><input type="checkbox" id="excel-ai-check-all" checked /></th>
            <th>Nazwa</th>
            <th>Jedn.</th>
            <th>Cena netto</th>
            <th>VAT</th>
            <th>Dostawca</th>
            <th>Status</th>
          </tr></thead>
          <tbody>
            ${items.map((item, idx) => `
              <tr style="${item.already_exists ? 'opacity:0.6' : ''}">
                <td><input type="checkbox" class="excel-ai-check" data-idx="${idx}" ${item.already_exists ? '' : 'checked'} /></td>
                <td>
                  <strong>${esc(item.name)}</strong>
                  ${item.sku ? `<div style="font-size:10px;color:var(--text-secondary)">SKU: ${esc(item.sku)}</div>` : ""}
                </td>
                <td>${esc(item.unit)}</td>
                <td class="cell-mono">${formatPrice(item.price)} zł</td>
                <td>${item.vat_rate}%</td>
                <td>${esc(item.supplier)}</td>
                <td>${item.already_exists
                  ? `<span style="color:var(--warning)" title="Dopasowano: ${esc(item.existing_name || '')}"><i class="fa-solid fa-triangle-exclamation"></i> W bazie</span>`
                  : `<span style="color:var(--success)"><i class="fa-solid fa-plus-circle"></i> Nowy</span>`
                }</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `}
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
      <button class="btn" id="excel-ai-cancel">Anuluj</button>
      <button class="btn btn-primary" id="excel-ai-import" ${items.length === 0 ? 'disabled' : ''}>
        <i class="fa-solid fa-download"></i> Importuj zaznaczone do ${targetLabel}
      </button>
    </div>
  `;

  openModal(`<i class="fa-solid fa-file-excel"></i> Import z Excel — AI Analiza`, modalHtml);

  // Bind events
  document.getElementById("excel-ai-cancel")?.addEventListener("click", closeModal);

  document.getElementById("excel-ai-check-all")?.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    document.querySelectorAll<HTMLInputElement>(".excel-ai-check").forEach((cb) => {
      cb.checked = checked;
    });
  });

  document.getElementById("excel-ai-import")?.addEventListener("click", () => {
    const selected: ProposedItem[] = [];
    document.querySelectorAll<HTMLInputElement>(".excel-ai-check:checked").forEach((cb) => {
      const idx = parseInt(cb.dataset.idx!);
      if (items[idx]) selected.push(items[idx]);
    });
    onImport(selected);
  });
}

// ─── Execute import ─────────────────────────────────────────────
function executeImport(items: ProposedItem[]): void {
  const mode = getAppMode();
  let added = 0;

  for (const item of items) {
    if (mode === "handlowy") {
      addProduct({
        name: item.name,
        unit: item.unit,
        purchase_price: item.purchase_price || item.price,
        catalog_price: item.catalog_price || 0,
        vat_rate: item.vat_rate,
        category_id: null,
        ean: "",
        sku: item.sku || "",
        supplier: item.supplier,
        min_order: "",
        notes: item.notes || "Import Excel + AI",
      });
    } else {
      addMaterial({
        name: item.name,
        unit: item.unit,
        price_netto: item.price,
        vat_rate: item.vat_rate,
        category_id: null,
        supplier: item.supplier,
        sku: item.sku || "",
        url: "",
        notes: item.notes || "Import Excel + AI",
      });
    }
    added++;
  }

  closeModal();
  showToast(`Zaimportowano ${added} pozycji`);

  // Dispatch refresh event
  window.dispatchEvent(new CustomEvent("excel-import-done", { detail: { count: added } }));
}

// ─── Main entry point ───────────────────────────────────────────
export async function openSmartExcelImport(): Promise<void> {
  // 1. Pick file
  const filePath = await dialogOpen({
    title: "Wybierz cennik Excel lub CSV",
    filters: [
      { name: "Excel / CSV", extensions: ["xlsx", "xls", "csv", "tsv"] },
    ],
  });

  if (!filePath) return;

  // 2. Show loading
  openModal(
    `<i class="fa-solid fa-file-excel"></i> Import z Excel`,
    `<div style="text-align:center;padding:40px">
      <div class="spinner" style="margin:0 auto 16px"></div>
      <p style="font-size:14px;font-weight:600">Czytam plik Excel...</p>
      <p style="font-size:12px;color:var(--text-secondary)">Parsowanie arkusza</p>
    </div>`
  );

  try {
    // 3. Parse Excel
    const sheets = await readExcelFile(filePath);

    if (sheets.length === 0 || sheets.every((s) => s.rows.length === 0)) {
      openModal("Import Excel", `<p>Plik jest pusty lub nie zawiera danych.</p><button class="btn" onclick="document.querySelector('.modal-overlay')?.click()">OK</button>`);
      return;
    }

    // 4. Convert to AI-readable text
    const aiText = sheetsToAIText(sheets);
    const mode = getAppMode();

    // Update loading message
    openModal(
      `<i class="fa-solid fa-file-excel"></i> Import z Excel`,
      `<div style="text-align:center;padding:40px">
        <div class="spinner" style="margin:0 auto 16px"></div>
        <p style="font-size:14px;font-weight:600">AI analizuje plik...</p>
        <p style="font-size:12px;color:var(--text-secondary)">
          ${sheets.map((s) => `"${s.name}" (${s.totalRows} wierszy)`).join(", ")}
        </p>
      </div>`
    );

    // 5. Ask AI to analyze
    const aiResponse = await callAIForExcelAnalysis(aiText, mode);
    const { analysis, items } = parseAIResponse(aiResponse);

    // 6. Show results modal
    renderImportModal(analysis, items, (selected) => {
      executeImport(selected);
    });

  } catch (e: any) {
    // Fallback: if AI fails, do simple column-based import
    openModal(
      `<i class="fa-solid fa-exclamation-triangle"></i> Błąd importu`,
      `<div>
        <p style="margin-bottom:12px">Nie udało się przeanalizować pliku:</p>
        <pre style="font-size:11px;background:var(--bg-secondary);padding:12px;border-radius:var(--radius);overflow:auto;max-height:200px">${esc(e.message)}</pre>
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn" id="import-err-close">Zamknij</button>
        </div>
      </div>`
    );
    document.getElementById("import-err-close")?.addEventListener("click", closeModal);
  }
}

// ─── Shared Excel/CSV reading utilities ─────────────────────────
// Used by both cenniki.ts (manual mapping) and excel-ai-import.ts (AI)

import { readFile } from "@tauri-apps/plugin-fs";
import type { SavedSheet, ColumnMapping, ColumnRole } from "./types";

export type { SavedSheet };

// ─── Read and parse Excel/CSV file ──────────────────────────────
export async function readExcelFile(filePath: string): Promise<SavedSheet[]> {
  const fileData = await readFile(filePath);

  // CSV/TSV: parse manually
  if (filePath.endsWith(".csv") || filePath.endsWith(".tsv")) {
    const text = new TextDecoder().decode(fileData);
    return [parseCSVToSheet(text, filePath.endsWith(".tsv") ? "\t" : ",")];
  }

  const XLSX = await import("xlsx");
  const wb = XLSX.read(fileData, { type: "array" });

  const sheets: SavedSheet[] = [];

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

// ─── CSV Parser ─────────────────────────────────────────────────
/** Parse a CSV line respecting quoted fields */
export function parseCSVLine(line: string, sep = ","): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === sep || (sep === "," && ch === ";")) { cols.push(current.trim()); current = ""; }
      else { current += ch; }
    }
  }
  cols.push(current.trim());
  return cols;
}

function parseCSVToSheet(text: string, sep: string): SavedSheet {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  if (lines.length === 0) return { name: "Sheet1", headers: [], rows: [], totalRows: 0 };
  const headers = parseCSVLine(lines[0], sep);
  const rows = lines.slice(1).map((l) => parseCSVLine(l, sep));
  return { name: "Sheet1", headers, rows, totalRows: rows.length };
}

// ─── Price sanitization ─────────────────────────────────────────
/** Clean price string: "12 345,67" → 12345.67, "1.234,56" → 1234.56 */
export function sanitizePrice(val: any): number {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (typeof val !== "string") return 0;
  let s = val.trim().replace(/\s/g, "");
  if (s.includes(",") && (!s.includes(".") || s.lastIndexOf(",") > s.lastIndexOf("."))) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  s = s.replace(/[^0-9.\-]/g, "");
  return parseFloat(s) || 0;
}

// ─── Auto-detect column mapping ─────────────────────────────────
const ROLE_KEYWORDS: Record<ColumnRole, string[]> = {
  name: ["nazwa", "name", "produkt", "towar", "opis", "asortyment", "artykuł", "artykul", "materiał", "material", "description"],
  price: ["cena", "price", "netto", "cena netto", "cena jm", "cena jedn", "cena jednostkowa", "wartość", "wartosc", "koszt"],
  unit: ["jm", "jedn", "jednostka", "unit", "j.m.", "j.m", "miara"],
  vat: ["vat", "stawka vat", "stawka", "vat %", "vat%"],
  supplier: ["dostawca", "supplier", "producent", "marka", "firma"],
  sku: ["kod", "sku", "indeks", "nr kat", "symbol", "kod produktu", "numer katalogowy", "ean", "nr"],
  category: ["kategoria", "category", "grupa", "dział", "dzial"],
  notes: ["uwagi", "notes", "opis dodatkowy", "komentarz"],
  skip: [],
};

export function autoDetectMapping(headers: string[]): ColumnMapping[] {
  const mappings: ColumnMapping[] = [];
  const usedRoles = new Set<ColumnRole>();

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    if (!h) continue;

    let bestRole: ColumnRole = "skip";
    let bestScore = 0;

    for (const [role, keywords] of Object.entries(ROLE_KEYWORDS) as [ColumnRole, string[]][]) {
      if (role === "skip" || usedRoles.has(role)) continue;
      for (const kw of keywords) {
        // Exact match gets highest score
        if (h === kw) {
          if (3 > bestScore) { bestScore = 3; bestRole = role; }
        }
        // Header starts with keyword
        else if (h.startsWith(kw)) {
          if (2 > bestScore) { bestScore = 2; bestRole = role; }
        }
        // Header contains keyword
        else if (h.includes(kw)) {
          if (1 > bestScore) { bestScore = 1; bestRole = role; }
        }
      }
    }

    if (bestRole !== "skip") {
      usedRoles.add(bestRole);
    }
    mappings.push({ column_index: i, role: bestRole });
  }

  return mappings;
}

// ─── Column role display helpers ────────────────────────────────
export const ROLE_LABELS: Record<ColumnRole, string> = {
  name: "Nazwa",
  price: "Cena netto",
  unit: "Jednostka",
  vat: "VAT",
  supplier: "Dostawca",
  sku: "SKU / Kod",
  category: "Kategoria",
  notes: "Uwagi",
  skip: "Pomiń",
};

export const ROLE_COLORS: Record<ColumnRole, string> = {
  name: "#22c55e",
  price: "#3b82f6",
  unit: "#a855f7",
  vat: "#f59e0b",
  supplier: "#ec4899",
  sku: "#06b6d4",
  category: "#f97316",
  notes: "#6b7280",
  skip: "#374151",
};

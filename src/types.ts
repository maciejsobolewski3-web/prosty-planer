// ─── Data types ──────────────────────────────────────────────────

export interface Category {
  id: number;
  name: string;
  color: string;
  sort_order: number;
}

export interface MaterialLink {
  label: string;
  url: string;
}

export interface Material {
  id: number;
  name: string;
  unit: string;
  price_netto: number;
  vat_rate: number;
  category_id: number | null;
  supplier: string;
  sku: string;
  url: string; // JSON stringified MaterialLink[]
  notes: string;
  is_favorite: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface PriceHistoryEntry {
  id: number;
  material_id: number;
  price_netto: number;
  changed_at: string;
}

export interface Labor {
  id: number;
  name: string;
  unit: string;          // m2, m, szt, godz, kpl, mb, opak
  price_netto: number;
  vat_rate: number;
  category: string;      // np. "Malowanie", "Elektryka", "Hydraulika"
  notes: string;
  is_favorite: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export type GroupBy = "none" | "category" | "supplier" | "unit";

// ─── Zlecenia (Orders / Quotes) ──────────────────────────────────
export type ZlecenieItemType = "material" | "labor";

export interface ZlecenieItem {
  id: number;
  type: ZlecenieItemType;
  source_id: number | null;   // ref to material.id or labor.id, null if custom
  name: string;
  unit: string;
  quantity: number;
  price_netto: number;
  vat_rate: number;
  notes: string;
}

export type ZlecenieStatus = "wycena" | "wyslane" | "zaakceptowane" | "odrzucone" | "realizacja";

// ─── Expenses ────────────────────────────────────────────────────
export type ExpenseCategory = "materialy" | "narzedzia" | "paliwo" | "podwykonawcy" | "biuro" | "inne";

export interface Expense {
  id: number;
  name: string;
  amount: number;          // brutto
  category: ExpenseCategory;
  zlecenie_id: number | null;  // optional link to zlecenie
  date: string;            // YYYY-MM-DD
  notes: string;
  created_at: string;
}

export interface Zlecenie {
  id: number;
  name: string;
  client: string;
  status: ZlecenieStatus;
  notes: string;
  markup_materials: number;
  markup_labor: number;
  date_start: string;   // YYYY-MM-DD or ""
  date_end: string;     // YYYY-MM-DD or ""
  items: ZlecenieItem[];
  created_at: string;
  updated_at: string;
}

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

export interface CommentEntry {
  id: number;
  text: string;
  created_at: string;
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

export type ZlecenieStatus = "wycena" | "wyslane" | "zaakceptowane" | "odrzucone" | "realizacja" | "zakonczone";

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
  comments?: CommentEntry[];
  tags?: string[];
  created_at: string;
  updated_at: string;
}

// ─── Klienci ─────────────────────────────────────────────────────
export interface Client {
  id: number;
  name: string;
  nip: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  contact_person: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

// ─── Tryb aplikacji ──────────────────────────────────────────────
export type AppMode = "uslugowy" | "handlowy";

// ─── Tryb handlowy — Produkty dostawcy ──────────────────────────
export interface Product {
  id: number;
  name: string;
  unit: string;              // szt, kg, l, opak, paleta, karton
  purchase_price: number;    // cena zakupu netto od producenta
  catalog_price: number;     // sugerowana cena sprzedaży netto (opcjonalna)
  vat_rate: number;
  category_id: number | null;
  ean: string;               // kod kreskowy
  sku: string;
  supplier: string;          // producent/hurtownia
  min_order: string;         // np. "karton 12 szt"
  notes: string;
  is_favorite: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Status oferty przetargowej ─────────────────────────────────
export type OfferStatus = "robocza" | "zlozona" | "wygrana" | "przegrana" | "realizacja" | "zakonczona";

// ─── Pozycja w ofercie ──────────────────────────────────────────
export interface OfferItem {
  id: number;
  product_id: number | null; // powiązanie z Moimi Produktami
  name: string;
  unit: string;
  quantity: number;
  purchase_price: number;    // cena zakupu
  offer_price: number;       // cena ofertowa (zakup + marża)
  vat_rate: number;
  margin_percent: number;    // marża % na tej pozycji
  matched: boolean;          // czy zmapowano automatycznie
  notes: string;
}

// ─── Dane źródłowego Excela (do round-trip) ─────────────────────
export interface SourceExcelData {
  filename: string;
  header_row: number;
  data_start_row: number;
  col_map: {
    lp: number;
    name: number;
    unit: number;
    quantity: number;
    unit_price_net: number;
    total_net: number;
    vat_rate: number;
    total_gross: number;
  };
  raw_data: any[][];
  sheet_name: string;
}

// ─── Wersjonowanie oferty ──────────────────────────────────────
export interface OfferVersion {
  version: number;
  label: string;
  snapshot: {
    items: OfferItem[];
    global_margin: number;
    transport_cost: number;
    storage_cost: number;
    other_costs: number;
  };
  created_at: string;
}

// ─── Oferta przetargowa ─────────────────────────────────────────
export interface Offer {
  id: number;
  name: string;              // nazwa przetargu
  client: string;            // zamawiający
  reference_number: string;  // numer BZP/TED
  status: OfferStatus;
  notes: string;
  global_margin: number;     // domyślna marża % na wszystkie pozycje
  transport_cost: number;    // koszt transportu łączny
  storage_cost: number;      // koszt magazynowania
  other_costs: number;       // inne koszty logistyczne
  deadline: string;          // termin składania ofert
  delivery_start: string;    // początek okresu dostaw
  delivery_end: string;      // koniec okresu dostaw
  items: OfferItem[];
  comments?: CommentEntry[];
  tags?: string[];
  versions?: OfferVersion[];  // historia wersji
  source_excel?: SourceExcelData;  // dane źródłowego formularza Excel
  created_at: string;
  updated_at: string;
}

// ─── Kategorie wydatków handlowych ──────────────────────────────
export type TradeExpenseCategory = "transport" | "magazyn" | "opakowania" | "wadium" | "ubezpieczenie" | "biuro" | "inne";

// ─── Price history for products ─────────────────────────────────
export interface ProductPriceHistoryEntry {
  id: number;
  product_id: number;
  purchase_price: number;
  catalog_price: number;
  changed_at: string;
}

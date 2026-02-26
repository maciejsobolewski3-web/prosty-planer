// ─── Trade Mode Store ────────────────────────────────────────────
// CRUD operations for Products and Offers (trade/tender mode)
// Uses the same Database + file persistence as store.ts

import type { Product, Offer, OfferItem, OfferStatus, AppMode, TradeExpenseCategory, CommentEntry, ProductPriceHistoryEntry } from "./types";
import { _getDb, _nextId, _scheduleSave } from "./store";

// ═══════════════════════════════════════════════════════════════════
// APP MODE
// ═══════════════════════════════════════════════════════════════════
export function getAppMode(): AppMode {
  return _getDb().app_mode || "uslugowy";
}

export function setAppMode(mode: AppMode): void {
  _getDb().app_mode = mode;
  _scheduleSave();
}

// ═══════════════════════════════════════════════════════════════════
// TRADE EXPENSE CATEGORIES
// ═══════════════════════════════════════════════════════════════════
export const TRADE_EXPENSE_CATEGORIES: Record<TradeExpenseCategory, { label: string; color: string; icon: string }> = {
  transport:      { label: "Transport",             color: "#6B7280", icon: "fa-solid fa-truck" },
  magazyn:        { label: "Magazyn",               color: "#3B82F6", icon: "fa-solid fa-warehouse" },
  opakowania:     { label: "Opakowania",            color: "#F59E0B", icon: "fa-solid fa-box" },
  wadium:         { label: "Wadium/zabezpieczenie", color: "#EF4444", icon: "fa-solid fa-shield-halved" },
  ubezpieczenie:  { label: "Ubezpieczenie towaru",  color: "#8B5CF6", icon: "fa-solid fa-umbrella" },
  biuro:          { label: "Biuro",                 color: "#10B981", icon: "fa-solid fa-building" },
  inne:           { label: "Inne",                  color: "#9CA3AF", icon: "fa-solid fa-ellipsis" },
};

// ═══════════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════════
export interface ProductFilter {
  search?: string;
  category_id?: number;
  favorites_only?: boolean;
  show_archived?: boolean;
}

export function getProducts(filter: ProductFilter = {}): Product[] {
  let items = _getDb().products || [];

  // By default hide archived
  if (!filter.show_archived) {
    items = items.filter((p) => !p.is_archived);
  } else {
    // When showing archived, only show archived items
    items = items.filter((p) => p.is_archived);
  }

  if (filter.favorites_only) {
    items = items.filter((p) => p.is_favorite);
  }

  if (filter.category_id !== undefined) {
    items = items.filter((p) => p.category_id === filter.category_id);
  }

  if (filter.search) {
    const q = filter.search.toLowerCase();
    items = items.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.supplier.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.ean.toLowerCase().includes(q)
    );
  }

  // Sort: favorites on top, then alphabetically
  items.sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    return a.name.localeCompare(b.name, "pl");
  });

  return items;
}

export function getAllProductsCount(): { total: number; favorites: number; archived: number } {
  const all = _getDb().products || [];
  return {
    total: all.filter((p) => !p.is_archived).length,
    favorites: all.filter((p) => p.is_favorite && !p.is_archived).length,
    archived: all.filter((p) => p.is_archived).length,
  };
}

export interface ProductInput {
  name: string;
  unit: string;
  purchase_price: number;
  catalog_price: number;
  vat_rate: number;
  category_id: number | null;
  ean: string;
  sku: string;
  supplier: string;
  min_order: string;
  notes: string;
}

export function addProduct(input: ProductInput): Product {
  const now = new Date().toISOString();
  const product: Product = {
    id: _nextId(),
    ...input,
    is_favorite: false,
    is_archived: false,
    created_at: now,
    updated_at: now,
  };
  _getDb().products.push(product);
  _scheduleSave();
  return product;
}

export function updateProduct(id: number, input: Partial<ProductInput>): void {
  const db = _getDb();
  const p = db.products.find((x) => x.id === id);
  if (!p) return;

  // Track price history if purchase_price or catalog_price changed
  if (input.purchase_price !== undefined || input.catalog_price !== undefined) {
    const oldPurchase = p.purchase_price;
    const oldCatalog = p.catalog_price;
    const newPurchase = input.purchase_price ?? oldPurchase;
    const newCatalog = input.catalog_price ?? oldCatalog;

    if (oldPurchase !== newPurchase || oldCatalog !== newCatalog) {
      if (!db.product_price_history) db.product_price_history = [];
      db.product_price_history.push({
        id: _nextId(),
        product_id: id,
        purchase_price: newPurchase,
        catalog_price: newCatalog,
        changed_at: new Date().toISOString(),
      });
    }
  }

  Object.assign(p, input, { updated_at: new Date().toISOString() });
  _scheduleSave();
}

export function deleteProduct(id: number): void {
  const db = _getDb();
  db.products = db.products.filter((p) => p.id !== id);
  _scheduleSave();
}

export function toggleProductFavorite(id: number): void {
  const p = _getDb().products.find((x) => x.id === id);
  if (p) {
    p.is_favorite = !p.is_favorite;
    p.updated_at = new Date().toISOString();
    _scheduleSave();
  }
}

export function archiveProduct(id: number): void {
  const p = _getDb().products.find((x) => x.id === id);
  if (p) {
    p.is_archived = !p.is_archived;
    p.updated_at = new Date().toISOString();
    _scheduleSave();
  }
}

export function getProductById(id: number): Product | undefined {
  return (_getDb().products || []).find((p) => p.id === id);
}

export function getProductPriceHistory(productId: number): any[] {
  const db = _getDb();
  if (!db.product_price_history) return [];
  return db.product_price_history.filter((h) => h.product_id === productId).sort((a, b) => b.changed_at.localeCompare(a.changed_at));
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCT CATEGORIES (reuses Category from store, but separate set)
// ═══════════════════════════════════════════════════════════════════
const TRADE_CATEGORY_KEY = "pp_trade_categories_seeded";

export function seedTradeDefaults(): void {
  const db = _getDb();

  // Seed product categories if not yet done
  if (!localStorage.getItem(TRADE_CATEGORY_KEY) && db.products.length === 0) {
    // We don't add to categories (that's for materials in service mode)
    // Instead we'll use a simple approach: product categories are just IDs we create in the main categories array
    const tradeCats = [
      { name: "Spożywcze", color: "#EF4444" },
      { name: "Chemia", color: "#3B82F6" },
      { name: "Biurowe", color: "#F59E0B" },
      { name: "Techniczne", color: "#8B5CF6" },
      { name: "Odzież robocza", color: "#10B981" },
      { name: "Inne", color: "#9CA3AF" },
    ];

    const catIds: number[] = [];
    for (const tc of tradeCats) {
      const id = _nextId();
      db.categories.push({ id, name: tc.name, color: tc.color, sort_order: 100 + catIds.length });
      catIds.push(id);
    }

    // Demo products
    const now = new Date().toISOString();
    const demoProducts: Omit<Product, "id" | "created_at" | "updated_at">[] = [
      { name: "Jajka kurze M karton 30szt", unit: "karton", purchase_price: 12.50, catalog_price: 16.00, vat_rate: 5, category_id: catIds[0], ean: "5901234560001", sku: "JAJ-M-30", supplier: "Ferma Kowalski", min_order: "paleta 20 kartonów", notes: "", is_favorite: true, is_archived: false },
      { name: "Papier A4 ryza 500 ark", unit: "ryza", purchase_price: 14.80, catalog_price: 19.90, vat_rate: 23, category_id: catIds[2], ean: "5901234560002", sku: "PAP-A4-500", supplier: "Papirus Sp. z o.o.", min_order: "karton 5 ryz", notes: "80g/m²", is_favorite: true, is_archived: false },
      { name: "Rękawice robocze lateksowe para", unit: "para", purchase_price: 3.20, catalog_price: 5.50, vat_rate: 23, category_id: catIds[4], ean: "5901234560003", sku: "REK-LAT-L", supplier: "BHP Express", min_order: "opak 12 par", notes: "Rozmiar L", is_favorite: false, is_archived: false },
      { name: "Płyn do mycia naczyń 5L", unit: "szt", purchase_price: 8.90, catalog_price: 14.50, vat_rate: 23, category_id: catIds[1], ean: "5901234560004", sku: "PLN-NAC-5L", supplier: "ChemClean", min_order: "karton 4 szt", notes: "", is_favorite: false, is_archived: false },
      { name: "Mleko UHT 2% 1L", unit: "szt", purchase_price: 2.80, catalog_price: 3.90, vat_rate: 5, category_id: catIds[0], ean: "5901234560005", sku: "MLK-UHT-1L", supplier: "Mleczarnia Łąkowa", min_order: "zgrzewka 12 szt", notes: "", is_favorite: false, is_archived: false },
      { name: "Długopis niebieski BIC", unit: "szt", purchase_price: 0.95, catalog_price: 2.50, vat_rate: 23, category_id: catIds[2], ean: "5901234560006", sku: "DLG-BIC-BLU", supplier: "Biuroserwis", min_order: "opak 50 szt", notes: "", is_favorite: false, is_archived: false },
      { name: "Worki na śmieci 120L 25szt", unit: "opak", purchase_price: 6.50, catalog_price: 11.00, vat_rate: 23, category_id: catIds[1], ean: "5901234560007", sku: "WOR-120-25", supplier: "ChemClean", min_order: "karton 20 opak", notes: "LDPE czarne", is_favorite: false, is_archived: false },
    ];

    for (const dp of demoProducts) {
      db.products.push({
        id: _nextId(),
        ...dp,
        created_at: now,
        updated_at: now,
      });
    }

    // Demo offer
    const offerId = _nextId();
    const demoItems: OfferItem[] = db.products.slice(0, 5).map((p, idx) => ({
      id: _nextId(),
      product_id: p.id,
      name: p.name,
      unit: p.unit,
      quantity: [600, 200, 500, 100, 1200][idx] || 100,
      purchase_price: p.purchase_price,
      offer_price: Math.round(p.purchase_price * 1.15 * 100) / 100,
      vat_rate: p.vat_rate,
      margin_percent: 15,
      matched: true,
      notes: "",
    }));

    db.offers.push({
      id: offerId,
      name: "Dostawa art. spożywczych i biurowych do Szkoły Podstawowej nr 7",
      client: "Szkoła Podstawowa nr 7 w Kielcach",
      reference_number: "BZP/2025/03/1234",
      status: "robocza",
      notes: "Przetarg nieograniczony, kryterium 100% cena",
      global_margin: 15,
      transport_cost: 2500,
      storage_cost: 800,
      other_costs: 300,
      deadline: "2025-04-15",
      delivery_start: "2025-05-01",
      delivery_end: "2025-12-31",
      items: demoItems,
      created_at: now,
      updated_at: now,
    });

    localStorage.setItem(TRADE_CATEGORY_KEY, "1");
    _scheduleSave();
  }
}

// ═══════════════════════════════════════════════════════════════════
// OFFERS
// ═══════════════════════════════════════════════════════════════════
export function getOffers(): Offer[] {
  const offers = _getDb().offers || [];
  // Sort by deadline (nearest first), then by updated_at
  return [...offers].sort((a, b) => {
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

export function getOfferById(id: number): Offer | undefined {
  return (_getDb().offers || []).find((o) => o.id === id);
}

export interface OfferInput {
  name: string;
  client: string;
  reference_number: string;
  status: string;
  notes: string;
  global_margin: number;
  transport_cost: number;
  storage_cost: number;
  other_costs: number;
  deadline: string;
  delivery_start: string;
  delivery_end: string;
  tags?: string[];
}

export function addOffer(input: OfferInput): Offer {
  const now = new Date().toISOString();
  const offer: Offer = {
    id: _nextId(),
    ...input,
    status: (input.status || "robocza") as OfferStatus,
    items: [],
    created_at: now,
    updated_at: now,
  };
  _getDb().offers.push(offer);
  _scheduleSave();
  return offer;
}

export function updateOffer(id: number, input: Partial<OfferInput>): void {
  const o = _getDb().offers.find((x) => x.id === id);
  if (!o) return;
  Object.assign(o, input, { updated_at: new Date().toISOString() });
  if (input.status) o.status = input.status as OfferStatus;
  _scheduleSave();
}

export function deleteOffer(id: number): void {
  const db = _getDb();
  db.offers = db.offers.filter((o) => o.id !== id);
  _scheduleSave();
}

export function duplicateOffer(id: number): Offer | null {
  const original = getOfferById(id);
  if (!original) return null;

  const now = new Date().toISOString();
  const newOffer: Offer = {
    ...JSON.parse(JSON.stringify(original)),
    id: _nextId(),
    name: original.name + " (kopia)",
    status: "robocza" as OfferStatus,
    created_at: now,
    updated_at: now,
  };
  // Regenerate item IDs
  for (const item of newOffer.items) {
    item.id = _nextId();
  }
  _getDb().offers.push(newOffer);
  _scheduleSave();
  return newOffer;
}

export function setOfferStatus(id: number, status: OfferStatus): void {
  const o = _getDb().offers.find((x) => x.id === id);
  if (o) {
    o.status = status;
    o.updated_at = new Date().toISOString();
    _scheduleSave();
  }
}

// ─── Offer Items ────────────────────────────────────────────────
export function addOfferItem(offerId: number, item: Omit<OfferItem, "id">): OfferItem {
  const o = _getDb().offers.find((x) => x.id === offerId);
  if (!o) throw new Error("Offer not found");
  const newItem: OfferItem = { id: _nextId(), ...item };
  o.items.push(newItem);
  o.updated_at = new Date().toISOString();
  _scheduleSave();
  return newItem;
}

export function updateOfferItem(offerId: number, itemId: number, updates: Partial<OfferItem>): void {
  const o = _getDb().offers.find((x) => x.id === offerId);
  if (!o) return;
  const item = o.items.find((i) => i.id === itemId);
  if (!item) return;
  Object.assign(item, updates);

  // Recalculate offer_price when margin_percent or purchase_price changes
  // but offer_price wasn't explicitly provided
  if (('margin_percent' in updates || 'purchase_price' in updates) && !('offer_price' in updates)) {
    item.offer_price = Math.round(item.purchase_price * (1 + item.margin_percent / 100) * 100) / 100;
  }

  o.updated_at = new Date().toISOString();
  _scheduleSave();
}

export function removeOfferItem(offerId: number, itemId: number): void {
  const o = _getDb().offers.find((x) => x.id === offerId);
  if (!o) return;
  o.items = o.items.filter((i) => i.id !== itemId);
  o.updated_at = new Date().toISOString();
  _scheduleSave();
}

export function reorderOfferItems(offerId: number, orderedIds: number[]): void {
  const o = _getDb().offers.find((x) => x.id === offerId);
  if (!o) return;
  const map = new Map(o.items.map((i) => [i.id, i]));
  const reordered: OfferItem[] = [];
  for (const id of orderedIds) {
    const item = map.get(id);
    if (item) reordered.push(item);
  }
  // Add any items not in the ordered list
  for (const item of o.items) {
    if (!orderedIds.includes(item.id)) reordered.push(item);
  }
  o.items = reordered;
  o.updated_at = new Date().toISOString();
  _scheduleSave();
}

// ─── Offer Comments ─────────────────────────────────────────────
export function addOfferComment(offerId: number, text: string): any {
  const db = _getDb();
  const o = db.offers.find((x) => x.id === offerId);
  if (!o) return null;
  if (!o.comments) o.comments = [];

  const comment = {
    id: _nextId(),
    text,
    created_at: new Date().toISOString(),
  };
  o.comments.push(comment);
  o.updated_at = new Date().toISOString();
  _scheduleSave();
  return comment;
}

export function deleteOfferComment(offerId: number, commentId: number): void {
  const db = _getDb();
  const o = db.offers.find((x) => x.id === offerId);
  if (!o || !o.comments) return;
  o.comments = o.comments.filter((c) => c.id !== commentId);
  o.updated_at = new Date().toISOString();
  _scheduleSave();
}

// ═══════════════════════════════════════════════════════════════════
// OFFER TEMPLATES
// ═══════════════════════════════════════════════════════════════════
export interface OfferTemplate {
  id: number;
  name: string;
  global_margin: number;
  transport_cost: number;
  storage_cost: number;
  other_costs: number;
  items: Omit<OfferItem, "id">[];
  created_at: string;
}

export function getOfferTemplates(): OfferTemplate[] {
  const db = _getDb();
  if (!db.offer_templates) db.offer_templates = [];
  return [...db.offer_templates].sort((a, b) => a.name.localeCompare(b.name, "pl"));
}

export function saveOfferAsTemplate(offerId: number, templateName: string): OfferTemplate | null {
  const o = getOfferById(offerId);
  if (!o) return null;
  const db = _getDb();
  if (!db.offer_templates) db.offer_templates = [];

  const tmpl: OfferTemplate = {
    id: _nextId(),
    name: templateName,
    global_margin: o.global_margin || 0,
    transport_cost: o.transport_cost || 0,
    storage_cost: o.storage_cost || 0,
    other_costs: o.other_costs || 0,
    items: o.items.map(({ id, ...rest }) => rest),
    created_at: new Date().toISOString(),
  };
  db.offer_templates.push(tmpl);
  _scheduleSave();
  return tmpl;
}

export function createOfferFromTemplate(templateId: number, name: string, client: string): Offer | null {
  const db = _getDb();
  if (!db.offer_templates) return null;
  const tmpl = db.offer_templates.find((t: any) => t.id === templateId);
  if (!tmpl) return null;

  const now = new Date().toISOString();
  const offer: Offer = {
    id: _nextId(),
    name,
    client,
    reference_number: "",
    status: "robocza" as OfferStatus,
    notes: "",
    global_margin: tmpl.global_margin,
    transport_cost: tmpl.transport_cost,
    storage_cost: tmpl.storage_cost,
    other_costs: tmpl.other_costs,
    deadline: "",
    delivery_start: "",
    delivery_end: "",
    items: tmpl.items.map((item: any) => ({ ...item, id: _nextId() })),
    created_at: now,
    updated_at: now,
  };
  db.offers.push(offer);
  _scheduleSave();
  return offer;
}

export function deleteOfferTemplate(id: number): void {
  const db = _getDb();
  if (!db.offer_templates) return;
  db.offer_templates = db.offer_templates.filter((t: any) => t.id !== id);
  _scheduleSave();
}

// ═══════════════════════════════════════════════════════════════════
// OFFER VERSIONING
// ═══════════════════════════════════════════════════════════════════
export function saveOfferVersion(offerId: number, label: string): void {
  const db = _getDb();
  const o = db.offers.find(x => x.id === offerId);
  if (!o) return;
  if (!o.versions) o.versions = [];
  const version = o.versions.length + 1;
  o.versions.push({
    version,
    label: label || `v${version}`,
    snapshot: {
      items: JSON.parse(JSON.stringify(o.items)),
      global_margin: o.global_margin,
      transport_cost: o.transport_cost,
      storage_cost: o.storage_cost,
      other_costs: o.other_costs,
    },
    created_at: new Date().toISOString(),
  });
  _scheduleSave();
}

export function restoreOfferVersion(offerId: number, versionNum: number): boolean {
  const db = _getDb();
  const o = db.offers.find(x => x.id === offerId);
  if (!o || !o.versions) return false;
  const ver = o.versions.find(v => v.version === versionNum);
  if (!ver) return false;
  o.items = JSON.parse(JSON.stringify(ver.snapshot.items));
  o.global_margin = ver.snapshot.global_margin;
  o.transport_cost = ver.snapshot.transport_cost;
  o.storage_cost = ver.snapshot.storage_cost;
  o.other_costs = ver.snapshot.other_costs;
  o.updated_at = new Date().toISOString();
  _scheduleSave();
  return true;
}

// ─── Global margin ──────────────────────────────────────────────
export function applyGlobalMargin(offerId: number, marginPercent: number): void {
  const o = _getDb().offers.find((x) => x.id === offerId);
  if (!o) return;
  o.global_margin = marginPercent;
  for (const item of o.items) {
    item.margin_percent = marginPercent;
    item.offer_price = Math.round(item.purchase_price * (1 + marginPercent / 100) * 100) / 100;
  }
  o.updated_at = new Date().toISOString();
  _scheduleSave();
}

// ─── Totals calculation ─────────────────────────────────────────
export interface OfferTotals {
  totalPurchase: number;    // suma zakupu
  totalOffer: number;       // suma ofertowa
  marginAmount: number;     // marża na towarze (kwota)
  marginPercent: number;    // marża na towarze (%)
  transportCost: number;
  storageCost: number;
  otherCosts: number;
  totalCosts: number;       // suma kosztów logistycznych
  netProfit: number;        // zysk netto = marża - koszty logistyczne
  monthlyProfit: number;    // zysk miesięczny
  totalOfferBrutto: number; // suma ofertowa brutto
  totalVat: number;         // suma VAT
}

export function calcOfferTotals(offerId: number): OfferTotals {
  const o = getOfferById(offerId);
  if (!o) return { totalPurchase: 0, totalOffer: 0, marginAmount: 0, marginPercent: 0, transportCost: 0, storageCost: 0, otherCosts: 0, totalCosts: 0, netProfit: 0, monthlyProfit: 0, totalOfferBrutto: 0, totalVat: 0 };

  let totalPurchase = 0;
  let totalOffer = 0;
  let totalOfferBrutto = 0;

  for (const item of o.items) {
    totalPurchase += item.purchase_price * item.quantity;
    const offerNetto = item.offer_price * item.quantity;
    totalOffer += offerNetto;
    totalOfferBrutto += Math.round(offerNetto * (1 + item.vat_rate / 100) * 100) / 100;
  }

  const marginAmount = totalOffer - totalPurchase;
  const marginPercent = totalPurchase > 0 ? (marginAmount / totalPurchase) * 100 : 0;
  const totalCosts = (o.transport_cost || 0) + (o.storage_cost || 0) + (o.other_costs || 0);
  const netProfit = marginAmount - totalCosts;

  // Monthly profit: zysk / liczba miesięcy realizacji
  let months = 1;
  if (o.delivery_start && o.delivery_end) {
    const start = new Date(o.delivery_start);
    const end = new Date(o.delivery_end);
    months = Math.max(1, Math.round((end.getTime() - start.getTime()) / (30.44 * 24 * 60 * 60 * 1000)));
  }

  return {
    totalPurchase,
    totalOffer,
    marginAmount,
    marginPercent,
    transportCost: o.transport_cost || 0,
    storageCost: o.storage_cost || 0,
    otherCosts: o.other_costs || 0,
    totalCosts,
    netProfit,
    monthlyProfit: netProfit / months,
    totalOfferBrutto,
    totalVat: totalOfferBrutto - totalOffer,
  };
}

// ─── Fuzzy matching helper ──────────────────────────────────────
// ─── Polish-aware normalization for fuzzy matching ──────────────
function normalizePL(s: string): string {
  return s
    .toLowerCase()
    .replace(/ą/g, "a").replace(/ć/g, "c").replace(/ę/g, "e")
    .replace(/ł/g, "l").replace(/ń/g, "n").replace(/ó/g, "o")
    .replace(/ś/g, "s").replace(/ź/g, "z").replace(/ż/g, "z")
    .replace(/[.,;:!?()[\]{}'"„""–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Crude Polish stem: strip common suffixes to match inflections
// e.g. "płytki" → "płytk", "gresowe" → "gresow", "ceramiczna" → "ceramiczn"
function stemPL(word: string): string {
  const w = normalizePL(word);
  // Don't stem short words or numbers
  if (w.length <= 3 || /^\d/.test(w)) return w;
  // Strip common Polish endings (order matters — longest first)
  const suffixes = [
    "owych", "owej", "owym", "owego",
    "nych", "nej", "nym", "nego",
    "ach", "ami", "owi", "iem", "iem",
    "ow", "ek", "ka", "ki", "ke", "ko",
    "ny", "na", "ne", "ni",
    "wy", "wa", "we", "wi",
    "ej", "em", "ie", "ow",
    "y", "a", "e", "i", "o", "u",
  ];
  for (const suf of suffixes) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      return w.slice(0, -suf.length);
    }
  }
  return w;
}

// Levenshtein distance for short strings
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

export function fuzzyMatchProduct(name: string): { product: Product; score: number } | null {
  const products = getProducts();
  if (products.length === 0) return null;

  const queryNorm = normalizePL(name);
  const queryStems = queryNorm.split(/\s+/).map(stemPL);
  let bestMatch: Product | null = null;
  let bestScore = 0;

  for (const p of products) {
    const pNorm = normalizePL(p.name);

    // 1. Exact normalized match → 1.0
    if (pNorm === queryNorm) return { product: p, score: 1.0 };

    // 2. One contains the other → 0.85
    if (pNorm.includes(queryNorm) || queryNorm.includes(pNorm)) {
      const lenRatio = Math.min(queryNorm.length, pNorm.length) / Math.max(queryNorm.length, pNorm.length);
      const score = 0.7 + 0.15 * lenRatio;
      if (score > bestScore) { bestScore = score; bestMatch = p; }
      continue;
    }

    // 3. Stem-based word overlap
    const pStems = pNorm.split(/\s+/).map(stemPL);
    let stemMatches = 0;
    for (const qs of queryStems) {
      // Check if any product stem starts with query stem or vice versa, or Levenshtein ≤ 2
      if (pStems.some((ps) => {
        if (ps === qs) return true;
        if (ps.startsWith(qs) || qs.startsWith(ps)) return true;
        if (Math.abs(ps.length - qs.length) <= 2 && levenshtein(ps, qs) <= 2) return true;
        return false;
      })) {
        stemMatches++;
      }
    }

    // Score: matched stems / max stems, weighted
    const totalStems = Math.max(queryStems.length, pStems.length);
    const stemScore = totalStems > 0 ? stemMatches / totalStems : 0;

    // Bonus for matching numbers (dimensions, quantities)
    const queryNums = queryNorm.match(/\d+[x×,.]?\d*/g) || [];
    const pNums = pNorm.match(/\d+[x×,.]?\d*/g) || [];
    let numBonus = 0;
    if (queryNums.length > 0 && pNums.length > 0) {
      const numMatches = queryNums.filter((qn) => pNums.some((pn) => pn.includes(qn) || qn.includes(pn))).length;
      numBonus = numMatches > 0 ? 0.1 : -0.15; // Penalty for different numbers
    }

    const finalScore = Math.min(stemScore + numBonus, 1.0);
    if (finalScore > bestScore) { bestScore = finalScore; bestMatch = p; }
  }

  if (bestMatch && bestScore >= 0.3) {
    return { product: bestMatch, score: bestScore };
  }
  return null;
}

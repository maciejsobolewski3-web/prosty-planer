import {
  getMaterials,
  getLabor,
  getCategories,
  getCategoryById,
  getZlecenia,
  getExpenses,
  getClients,
  addClient,
  updateClient,
  addZlecenie,
  addZlecenieItem,
  updateZlecenie,
  updateZlecenieItem,
  removeZlecenieItem,
  deleteZlecenie,
  addMaterial,
  updateMaterial,
  deleteMaterial,
  addLabor,
  updateLabor,
  deleteLabor,
} from "./store";
import {
  getAppMode,
  getProducts,
  getProductById,
  addProduct,
  updateProduct,
  deleteProduct,
  getOffers,
  getOfferById,
  addOffer,
  updateOffer,
  deleteOffer,
  addOfferItem,
  updateOfferItem,
  removeOfferItem,
  setOfferStatus,
  calcOfferTotals,
  applyGlobalMargin,
  fuzzyMatchProduct,
  type ProductInput,
  type OfferInput,
} from "./store-trade";
import type { OfferStatus } from "./types";
import { esc, showToast } from "./ui";

// ─── Config ──────────────────────────────────────────────────────
const API_BASE = "https://prostyprzetarg.pl";
const AI_ENDPOINT = `${API_BASE}/api/planer/ai`;
const HISTORY_KEY = "pp_ai_history";
const MAX_HISTORY = 50;

// ─── Types ───────────────────────────────────────────────────────
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  actions?: AIAction[];
  needs_confirmation?: boolean;
  confirmed?: boolean; // true = confirmed, false = cancelled, undefined = pending
  timestamp: string;
}

interface AIAction {
  type: string;
  params: Record<string, any>;
}

interface AIResponse {
  message: string;
  actions: AIAction[];
  needs_confirmation: boolean;
}

// ─── State ───────────────────────────────────────────────────────
let chatHistory: ChatMessage[] = [];
let isOpen = false;
let isLoading = false;
let lastCreatedZlecenieId: number | null = null;
let pendingActions: AIAction[] = []; // actions waiting for confirmation
const LAST_ZLECENIE_KEY = "pp_ai_last_zlecenie";

// Persist lastCreatedZlecenieId across confirmation steps
function saveLastZlecenieId(id: number | null): void {
  lastCreatedZlecenieId = id;
  if (id) localStorage.setItem(LAST_ZLECENIE_KEY, String(id));
}
function getLastZlecenieId(): number | null {
  if (lastCreatedZlecenieId) return lastCreatedZlecenieId;
  const saved = localStorage.getItem(LAST_ZLECENIE_KEY);
  return saved ? parseInt(saved) : null;
}

// Normalize Gemini response — it sometimes uses "action" instead of "type"
function normalizeActions(rawActions: any[]): AIAction[] {
  if (!rawActions || !Array.isArray(rawActions)) return [];
  return rawActions.map((a) => ({
    type: a.type || a.action || a.action_type || "unknown",
    params: a.params || a.parameters || {},
  }));
}

let onNavigate: ((page: string, zlecenieId?: number) => void) | null = null;

// ─── View context (which offer/zlecenie is currently open) ──────
interface ViewContext {
  entity_type: "offer" | "zlecenie" | null;
  entity_id: number | null;
}

let viewContext: ViewContext = { entity_type: null, entity_id: null };

export function setAIViewContext(ctx: ViewContext): void {
  viewContext = ctx;
  // Update welcome message & placeholder if sidebar is rendered
  const input = document.getElementById("ai-input") as HTMLTextAreaElement;
  if (input) {
    if (ctx.entity_type === "offer" && ctx.entity_id) {
      const offer = getOfferById(ctx.entity_id);
      input.placeholder = offer ? `Zapytaj o ofertę "${offer.name}"...` : "Opisz ofertę...";
    } else if (ctx.entity_type === "zlecenie" && ctx.entity_id) {
      input.placeholder = "Zapytaj o to zlecenie...";
    } else {
      input.placeholder = getAppMode() === "handlowy" ? "Opisz ofertę, dodaj produkty..." : "Opisz zlecenie, dodaj materiały...";
    }
  }
}

export function setAINavigateCallback(cb: (page: string, zlecenieId?: number) => void): void {
  onNavigate = cb;
}

// ─── History persistence ─────────────────────────────────────────
function loadHistory(): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(chatHistory.slice(-MAX_HISTORY)));
}

// ─── Context builder ─────────────────────────────────────────────
function buildContext() {
  const mode = getAppMode();
  const categories = getCategories();
  const expenses = getExpenses();

  const clients = getClients();
  const base: Record<string, any> = {
    mode,
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    clients: clients.map((c) => ({ id: c.id, name: c.name, nip: c.nip, city: c.city, phone: c.phone, email: c.email })),
    expenses: expenses.map((e) => ({
      id: e.id,
      name: e.name,
      amount: e.amount,
      category: e.category,
      zlecenie_id: e.zlecenie_id,
      date: e.date,
    })),
  };

  if (mode === "handlowy") {
    // Trade mode: send products + offers
    const products = getProducts();
    const offers = getOffers();
    base.products = products.map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      purchase_price: p.purchase_price,
      catalog_price: p.catalog_price,
      vat_rate: p.vat_rate,
      category: getCategoryById(p.category_id)?.name || "",
      supplier: p.supplier,
      sku: p.sku,
    }));
    base.offers = offers.map((o) => ({
      id: o.id,
      name: o.name,
      client: o.client,
      status: o.status,
      global_margin: o.global_margin,
      deadline: o.deadline,
      items: o.items.map((it) => ({
        id: it.id,
        name: it.name,
        unit: it.unit,
        quantity: it.quantity,
        purchase_price: it.purchase_price,
        offer_price: it.offer_price,
        product_id: it.product_id,
      })),
    }));
  } else {
    // Service mode: send materials + labor + zlecenia
    const materials = getMaterials({ show_archived: false });
    const labor = getLabor({ show_archived: false });
    const zlecenia = getZlecenia();
    base.materials = materials.map((m) => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      price_netto: m.price_netto,
      vat_rate: m.vat_rate,
      category: getCategoryById(m.category_id)?.name || "",
      supplier: m.supplier,
    }));
    base.labor = labor.map((l) => ({
      id: l.id,
      name: l.name,
      unit: l.unit,
      price_netto: l.price_netto,
      vat_rate: l.vat_rate,
      category: l.category,
    }));
    base.zlecenia = zlecenia.map((z) => ({
      id: z.id,
      name: z.name,
      client: z.client,
      status: z.status,
      markup_materials: z.markup_materials,
      markup_labor: z.markup_labor,
      items: z.items.map((it) => ({
        id: it.id,
        type: it.type,
        name: it.name,
        unit: it.unit,
        quantity: it.quantity,
        price_netto: it.price_netto,
        source_id: it.source_id,
      })),
    }));
  }

  // Add focused entity context
  if (viewContext.entity_type === "offer" && viewContext.entity_id) {
    const offer = getOfferById(viewContext.entity_id);
    if (offer) {
      const totals = calcOfferTotals(offer.id);
      base.focused_entity = {
        type: "offer",
        id: offer.id,
        name: offer.name,
        client: offer.client,
        status: offer.status,
        global_margin: offer.global_margin,
        deadline: offer.deadline,
        transport_cost: offer.transport_cost,
        storage_cost: offer.storage_cost,
        items: offer.items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unit: i.unit,
          purchase_price: i.purchase_price,
          offer_price: i.offer_price,
          margin_percent: i.margin_percent,
          vat_rate: i.vat_rate,
        })),
        totals: {
          totalPurchase: totals.totalPurchase,
          totalOffer: totals.totalOffer,
          marginPercent: totals.marginPercent,
          netProfit: totals.netProfit,
        },
      };
    }
  } else if (viewContext.entity_type === "zlecenie" && viewContext.entity_id) {
    const z = getZlecenia().find((zl) => zl.id === viewContext.entity_id);
    if (z) {
      base.focused_entity = {
        type: "zlecenie",
        id: z.id,
        name: z.name,
        client: z.client,
        status: z.status,
        markup_materials: z.markup_materials,
        markup_labor: z.markup_labor,
        items: z.items.map((i) => ({
          name: i.name,
          type: i.type,
          quantity: i.quantity,
          unit: i.unit,
          price_netto: i.price_netto,
          vat_rate: i.vat_rate,
        })),
      };
    }
  }

  return base;
}

// ─── Auth ────────────────────────────────────────────────────────
function getAuthToken(): string | null {
  try {
    const session = localStorage.getItem("pp_auth_session");
    if (session) {
      const parsed = JSON.parse(session);
      return parsed.token || parsed.access_token || null;
    }
  } catch {}
  return null;
}

// ─── API call ────────────────────────────────────────────────────
async function callAI(message: string): Promise<AIResponse> {
  const token = getAuthToken();
  const context = buildContext();

  const historyForAPI = chatHistory.slice(-6).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const body: Record<string, any> = {
    message,
    mode: context.mode,
    categories: context.categories,
    expenses: context.expenses,
    history: historyForAPI,
  };

  // Include mode-specific data
  if (context.mode === "handlowy") {
    body.products = context.products;
    body.offers = context.offers;
  } else {
    body.materials = context.materials;
    body.labor = context.labor;
    body.zlecenia = context.zlecenia;
  }

  // Include focused entity context
  if (context.focused_entity) {
    body.focused_entity = context.focused_entity;
  }

  const response = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Błąd serwera: ${response.status} — ${err}`);
  }

  const data: AIResponse = await response.json();
  // Normalize actions — Gemini sometimes uses "action" instead of "type"
  data.actions = normalizeActions(data.actions);
  return data;
}

// ─── Action executor ─────────────────────────────────────────────
function executeActions(actions: AIAction[]): string[] {
  const results: string[] = [];

  for (const rawAction of actions) {
    // Defensive parsing — Gemini sometimes uses "action" instead of "type"
    const action: AIAction = {
      type: rawAction.type || (rawAction as any).action || (rawAction as any).action_type || "",
      params: rawAction.params || (rawAction as any).parameters || rawAction,
    };

    // Skip if no valid type
    if (!action.type || action.type === "undefined" || action.type === "unknown") {
      console.warn("AI returned action without type:", rawAction);
      continue;
    }

    try {
      const p = action.params;
      switch (action.type) {
        // ── CREATE ──
        case "create_zlecenie": {
          const z = addZlecenie({
            name: p.name || "Nowe zlecenie",
            client: p.client || "",
            status: p.status || "wycena",
            notes: p.notes || "",
            markup_materials: p.markup_materials ?? 15,
            markup_labor: p.markup_labor ?? 0,
            date_start: p.date_start || "",
            date_end: p.date_end || "",
          });
          saveLastZlecenieId(z.id);
          results.push(`✓ Zlecenie "${z.name}"`);
          break;
        }
        case "add_zlecenie_item": {
          // Try provided ID, fallback to last created
          let targetId = p.zlecenie_id || getLastZlecenieId();
          // If Gemini provided an ID that doesn't exist, use last created
          if (targetId && !getZlecenia().find((z) => z.id === targetId)) {
            targetId = getLastZlecenieId();
          }
          if (!targetId) { results.push(`✗ Brak zlecenia`); break; }
          addZlecenieItem(targetId, {
            type: p.item_type || "material",
            source_id: p.source_id || null,
            name: p.name || "Pozycja",
            unit: p.unit || "szt",
            quantity: p.quantity ?? 1,
            price_netto: p.price_netto ?? 0,
            vat_rate: p.vat_rate ?? 23,
            notes: p.notes || "",
          });
          results.push(`✓ + ${p.name} (${p.quantity} ${p.unit})`);
          break;
        }
        case "add_material": {
          const m = addMaterial({
            name: p.name || "Materiał",
            unit: p.unit || "szt",
            price_netto: p.price_netto ?? 0,
            vat_rate: p.vat_rate ?? 23,
            category_id: p.category_id || null,
            supplier: p.supplier || "",
            sku: p.sku || "",
            url: "[]",
            notes: p.notes || "",
          });
          results.push(`✓ Materiał: ${m.name}`);
          break;
        }
        case "add_labor": {
          const l = addLabor({
            name: p.name || "Robocizna",
            unit: p.unit || "szt",
            price_netto: p.price_netto ?? 0,
            vat_rate: p.vat_rate ?? 23,
            category: p.category || "",
            notes: p.notes || "",
          });
          results.push(`✓ Robocizna: ${l.name}`);
          break;
        }

        // ── EDIT ──
        case "edit_zlecenie": {
          if (!p.zlecenie_id) { results.push(`✗ Brak ID zlecenia`); break; }
          const existing = getZlecenia().find((z) => z.id === p.zlecenie_id);
          if (!existing) { results.push(`✗ Zlecenie #${p.zlecenie_id} nie znalezione`); break; }
          updateZlecenie(p.zlecenie_id, {
            name: p.name ?? existing.name,
            client: p.client ?? existing.client,
            status: p.status ?? existing.status,
            notes: p.notes ?? existing.notes,
            markup_materials: p.markup_materials ?? existing.markup_materials,
            markup_labor: p.markup_labor ?? existing.markup_labor,
            date_start: p.date_start ?? existing.date_start,
            date_end: p.date_end ?? existing.date_end,
          });
          results.push(`✓ Zaktualizowano zlecenie "${existing.name}"`);
          break;
        }
        case "edit_zlecenie_item": {
          if (!p.zlecenie_id || !p.item_id) { results.push(`✗ Brak ID`); break; }
          const updates: Record<string, any> = {};
          if (p.name !== undefined) updates.name = p.name;
          if (p.unit !== undefined) updates.unit = p.unit;
          if (p.quantity !== undefined) updates.quantity = p.quantity;
          if (p.price_netto !== undefined) updates.price_netto = p.price_netto;
          if (p.vat_rate !== undefined) updates.vat_rate = p.vat_rate;
          if (p.notes !== undefined) updates.notes = p.notes;
          updateZlecenieItem(p.zlecenie_id, p.item_id, updates);
          results.push(`✓ Zaktualizowano pozycję ${p.name || `#${p.item_id}`}`);
          break;
        }
        case "edit_material": {
          if (!p.material_id) { results.push(`✗ Brak ID materiału`); break; }
          const allMats = getMaterials({ show_archived: true });
          const mat = allMats.find((m) => m.id === p.material_id);
          if (!mat) { results.push(`✗ Materiał #${p.material_id} nie znaleziony`); break; }
          updateMaterial(p.material_id, {
            name: p.name ?? mat.name,
            unit: p.unit ?? mat.unit,
            price_netto: p.price_netto ?? mat.price_netto,
            vat_rate: p.vat_rate ?? mat.vat_rate,
            category_id: p.category_id !== undefined ? p.category_id : mat.category_id,
            supplier: p.supplier ?? mat.supplier,
            sku: p.sku ?? mat.sku,
            url: mat.url,
            notes: p.notes ?? mat.notes,
          });
          results.push(`✓ Zaktualizowano materiał "${mat.name}"`);
          break;
        }
        case "edit_labor": {
          if (!p.labor_id) { results.push(`✗ Brak ID robocizny`); break; }
          const allLabor = getLabor({ show_archived: true });
          const lab = allLabor.find((l) => l.id === p.labor_id);
          if (!lab) { results.push(`✗ Robocizna #${p.labor_id} nie znaleziona`); break; }
          updateLabor(p.labor_id, {
            name: p.name ?? lab.name,
            unit: p.unit ?? lab.unit,
            price_netto: p.price_netto ?? lab.price_netto,
            vat_rate: p.vat_rate ?? lab.vat_rate,
            category: p.category ?? lab.category,
            notes: p.notes ?? lab.notes,
          });
          results.push(`✓ Zaktualizowano robociznę "${lab.name}"`);
          break;
        }

        // ── DELETE ──
        case "delete_zlecenie": {
          if (!p.zlecenie_id) { results.push(`✗ Brak ID`); break; }
          deleteZlecenie(p.zlecenie_id);
          results.push(`✓ Usunięto zlecenie #${p.zlecenie_id}`);
          break;
        }
        case "delete_zlecenie_item": {
          if (!p.zlecenie_id || !p.item_id) { results.push(`✗ Brak ID`); break; }
          removeZlecenieItem(p.zlecenie_id, p.item_id);
          results.push(`✓ Usunięto pozycję #${p.item_id}`);
          break;
        }
        case "delete_material": {
          if (!p.material_id) { results.push(`✗ Brak ID`); break; }
          deleteMaterial(p.material_id);
          results.push(`✓ Usunięto materiał #${p.material_id}`);
          break;
        }
        case "delete_labor": {
          if (!p.labor_id) { results.push(`✗ Brak ID`); break; }
          deleteLabor(p.labor_id);
          results.push(`✓ Usunięto robociznę #${p.labor_id}`);
          break;
        }

        // ── CLIENTS ──
        case "add_client": {
          const c = addClient({
            name: p.name || "Klient",
            nip: p.nip || "",
            phone: p.phone || "",
            email: p.email || "",
            address: p.address || "",
            city: p.city || "",
            contact_person: p.contact_person || "",
            notes: p.notes || "",
          });
          results.push(`✓ Klient: ${c.name}`);
          break;
        }
        case "edit_client": {
          if (!p.client_id) { results.push(`✗ Brak ID klienta`); break; }
          const allClients = getClients();
          const client = allClients.find((c) => c.id === p.client_id);
          if (!client) { results.push(`✗ Klient #${p.client_id} nie znaleziony`); break; }
          updateClient(p.client_id, {
            name: p.name ?? client.name,
            nip: p.nip ?? client.nip,
            phone: p.phone ?? client.phone,
            email: p.email ?? client.email,
            address: p.address ?? client.address,
            city: p.city ?? client.city,
            contact_person: p.contact_person ?? client.contact_person,
            notes: p.notes ?? client.notes,
          });
          results.push(`✓ Zaktualizowano klienta "${client.name}"`);
          break;
        }

        // ── NAVIGATE ──
        case "navigate": {
          if (onNavigate) {
            const zId = p.page === "zlecenia" && getLastZlecenieId() ? getLastZlecenieId()! : undefined;
            onNavigate(p.page, zId);
          }
          break;
        }

        // ══ TRADE MODE ACTIONS ══
        case "create_offer": {
          const o = addOffer({
            name: p.name || "Nowa oferta",
            client: p.client || "",
            reference_number: p.reference_number || "",
            status: p.status || "robocza",
            notes: p.notes || "",
            global_margin: p.global_margin ?? 15,
            transport_cost: p.transport_cost ?? 0,
            storage_cost: p.storage_cost ?? 0,
            other_costs: p.other_costs ?? 0,
            deadline: p.deadline || "",
            delivery_start: p.delivery_start || "",
            delivery_end: p.delivery_end || "",
          });
          saveLastZlecenieId(o.id);
          results.push(`✓ Oferta "${o.name}"`);
          break;
        }
        case "add_offer_item": {
          let targetId = p.offer_id || getLastZlecenieId();
          if (targetId && !getOfferById(targetId)) {
            targetId = getLastZlecenieId();
          }
          if (!targetId) { results.push(`✗ Brak oferty`); break; }
          addOfferItem(targetId, {
            product_id: p.product_id || null,
            name: p.name || "Pozycja",
            unit: p.unit || "szt",
            quantity: p.quantity ?? 1,
            purchase_price: p.purchase_price ?? 0,
            offer_price: p.offer_price ?? 0,
            vat_rate: p.vat_rate ?? 23,
            margin_percent: p.margin_percent ?? 15,
            matched: !!p.product_id,
            notes: p.notes || "",
          });
          results.push(`✓ + ${p.name} (${p.quantity ?? 1} ${p.unit || "szt"})`);
          break;
        }
        case "edit_offer": {
          if (!p.offer_id) { results.push(`✗ Brak ID oferty`); break; }
          const existing = getOfferById(p.offer_id);
          if (!existing) { results.push(`✗ Oferta #${p.offer_id} nie znaleziona`); break; }
          // If global_margin is set, use applyGlobalMargin which recalculates all item prices
          if (p.global_margin !== undefined) {
            applyGlobalMargin(p.offer_id, p.global_margin);
          }
          const updates: Partial<OfferInput> = {};
          if (p.name !== undefined) updates.name = p.name;
          if (p.client !== undefined) updates.client = p.client;
          if (p.status !== undefined) updates.status = p.status;
          if (p.notes !== undefined) updates.notes = p.notes;
          if (p.deadline !== undefined) updates.deadline = p.deadline;
          if (p.delivery_start !== undefined) updates.delivery_start = p.delivery_start;
          if (p.delivery_end !== undefined) updates.delivery_end = p.delivery_end;
          if (Object.keys(updates).length > 0) updateOffer(p.offer_id, updates);
          results.push(`✓ Zaktualizowano ofertę "${existing.name}"`);
          break;
        }
        case "edit_offer_item": {
          if (!p.offer_id || !p.item_id) { results.push(`✗ Brak ID`); break; }
          const itemUpdates: Record<string, any> = {};
          if (p.name !== undefined) itemUpdates.name = p.name;
          if (p.unit !== undefined) itemUpdates.unit = p.unit;
          if (p.quantity !== undefined) itemUpdates.quantity = p.quantity;
          if (p.purchase_price !== undefined) itemUpdates.purchase_price = p.purchase_price;
          if (p.offer_price !== undefined) itemUpdates.offer_price = p.offer_price;
          if (p.vat_rate !== undefined) itemUpdates.vat_rate = p.vat_rate;
          if (p.margin_percent !== undefined) itemUpdates.margin_percent = p.margin_percent;
          updateOfferItem(p.offer_id, p.item_id, itemUpdates);
          results.push(`✓ Zaktualizowano pozycję ${p.name || `#${p.item_id}`}`);
          break;
        }
        case "delete_offer": {
          if (!p.offer_id) { results.push(`✗ Brak ID`); break; }
          deleteOffer(p.offer_id);
          results.push(`✓ Usunięto ofertę #${p.offer_id}`);
          break;
        }
        case "delete_offer_item": {
          if (!p.offer_id || !p.item_id) { results.push(`✗ Brak ID`); break; }
          removeOfferItem(p.offer_id, p.item_id);
          results.push(`✓ Usunięto pozycję #${p.item_id}`);
          break;
        }
        case "add_product": {
          const prod = addProduct({
            name: p.name || "Produkt",
            unit: p.unit || "szt",
            purchase_price: p.purchase_price ?? 0,
            catalog_price: p.catalog_price ?? 0,
            vat_rate: p.vat_rate ?? 23,
            category_id: p.category_id || null,
            ean: p.ean || "",
            sku: p.sku || "",
            supplier: p.supplier || "",
            min_order: p.min_order || "",
            notes: p.notes || "",
          });
          results.push(`✓ Produkt: ${prod.name}`);
          break;
        }
        case "edit_product": {
          if (!p.product_id) { results.push(`✗ Brak ID produktu`); break; }
          const prod = getProductById(p.product_id);
          if (!prod) { results.push(`✗ Produkt #${p.product_id} nie znaleziony`); break; }
          updateProduct(p.product_id, {
            name: p.name ?? prod.name,
            unit: p.unit ?? prod.unit,
            purchase_price: p.purchase_price ?? prod.purchase_price,
            catalog_price: p.catalog_price ?? prod.catalog_price,
            vat_rate: p.vat_rate ?? prod.vat_rate,
            category_id: p.category_id !== undefined ? p.category_id : prod.category_id,
            ean: p.ean ?? prod.ean,
            sku: p.sku ?? prod.sku,
            supplier: p.supplier ?? prod.supplier,
            min_order: p.min_order ?? prod.min_order,
            notes: p.notes ?? prod.notes,
          });
          results.push(`✓ Zaktualizowano produkt "${prod.name}"`);
          break;
        }
        case "delete_product": {
          if (!p.product_id) { results.push(`✗ Brak ID`); break; }
          deleteProduct(p.product_id);
          results.push(`✓ Usunięto produkt #${p.product_id}`);
          break;
        }
        case "set_offer_status": {
          if (!p.offer_id || !p.status) { results.push(`✗ Brak danych`); break; }
          setOfferStatus(p.offer_id, p.status as OfferStatus);
          results.push(`✓ Status oferty → ${p.status}`);
          break;
        }
        case "save_item_to_catalog": {
          if (!p.offer_id || !p.item_id) { results.push(`✗ Brak ID`); break; }
          const srcOffer = getOfferById(p.offer_id);
          const srcItem = srcOffer?.items.find((i) => i.id === p.item_id);
          if (!srcItem) { results.push(`✗ Pozycja nie znaleziona`); break; }
          const existingMatch = fuzzyMatchProduct(srcItem.name);
          if (existingMatch && existingMatch.score >= 0.8) {
            updateProduct(existingMatch.product.id, {
              purchase_price: srcItem.purchase_price || existingMatch.product.purchase_price,
              catalog_price: srcItem.offer_price || existingMatch.product.catalog_price,
            });
            updateOfferItem(p.offer_id, srcItem.id, { product_id: existingMatch.product.id, matched: true });
            results.push(`✓ Zaktualizowano "${existingMatch.product.name}" w cenniku`);
          } else {
            const newProd = addProduct({
              name: srcItem.name, unit: srcItem.unit,
              purchase_price: srcItem.purchase_price, catalog_price: srcItem.offer_price,
              vat_rate: srcItem.vat_rate, category_id: null,
              ean: "", sku: "", supplier: "", min_order: "", notes: "Dodano przez AI",
            });
            updateOfferItem(p.offer_id, srcItem.id, { product_id: newProd.id, matched: true });
            results.push(`✓ Dodano "${srcItem.name}" do cennika`);
          }
          break;
        }
        case "add_product_to_catalog": {
          const newP = addProduct({
            name: p.name || "Produkt", unit: p.unit || "szt",
            purchase_price: p.purchase_price ?? 0, catalog_price: p.catalog_price ?? 0,
            vat_rate: p.vat_rate ?? 23, category_id: null,
            ean: p.ean || "", sku: p.sku || "",
            supplier: p.supplier || "", min_order: p.min_order || "",
            notes: p.notes || "Dodano przez AI",
          });
          results.push(`✓ Dodano "${newP.name}" do cennika`);
          break;
        }

        default:
          results.push(`? Nieznana akcja: ${action.type}`);
      }
    } catch (e: any) {
      results.push(`✗ Błąd: ${e.message}`);
    }
  }

  return results;
}

// ─── UI ──────────────────────────────────────────────────────────
export function initAIAssistant(): void {
  chatHistory = loadHistory();
  renderSidebar();
  renderToggleButton();
}

function renderToggleButton(): void {
  let fab = document.getElementById("ai-fab");
  if (!fab) {
    fab = document.createElement("button");
    fab.id = "ai-fab";
    fab.className = "ai-fab";
    fab.innerHTML = `<i class="fa-solid fa-robot"></i>`;
    fab.title = "Asystent AI (Ctrl+/)";
    fab.addEventListener("click", toggleSidebar);
    document.body.appendChild(fab);
  }
}

export function toggleAISidebar(): void {
  isOpen = !isOpen;
  const sidebar = document.getElementById("ai-sidebar");
  const fab = document.getElementById("ai-fab");
  if (sidebar) sidebar.classList.toggle("open", isOpen);
  if (fab) {
    fab.classList.toggle("active", isOpen);
    fab.innerHTML = isOpen ? `<i class="fa-solid fa-xmark"></i>` : `<i class="fa-solid fa-robot"></i>`;
  }
  if (isOpen) {
    scrollToBottom();
    setTimeout(() => (document.getElementById("ai-input") as HTMLTextAreaElement)?.focus(), 100);
  }
}

function toggleSidebar(): void {
  toggleAISidebar();
}

function renderSidebar(): void {
  let sidebar = document.getElementById("ai-sidebar");
  if (!sidebar) {
    sidebar = document.createElement("aside");
    sidebar.id = "ai-sidebar";
    sidebar.className = "ai-sidebar";
    document.querySelector(".app")!.appendChild(sidebar);
  }

  sidebar.innerHTML = `
    <div class="ai-sidebar-header">
      <div class="ai-sidebar-title">
        <i class="fa-solid fa-robot"></i>
        Asystent AI
      </div>
      <div class="ai-sidebar-actions">
        <button class="ai-header-btn" id="ai-clear-btn" title="Wyczyść historię">
          <i class="fa-solid fa-trash-can"></i>
        </button>
        <button class="ai-header-btn" id="ai-close-btn" title="Zamknij">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
    <div class="ai-messages" id="ai-messages"></div>
    <div class="ai-input-area">
      <textarea id="ai-input" class="ai-input" placeholder="${getAppMode() === "handlowy" ? "Opisz ofertę, dodaj produkty..." : "Opisz zlecenie, dodaj materiały..."}" rows="2"></textarea>
      <button class="ai-send-btn" id="ai-send-btn" title="Wyślij (Enter)">
        <i class="fa-solid fa-paper-plane"></i>
      </button>
    </div>
    <div class="ai-footer">Gemini Flash · Dane przetwarzane na serwerze ProstyPrzetarg</div>
  `;

  document.getElementById("ai-close-btn")!.addEventListener("click", toggleSidebar);
  document.getElementById("ai-clear-btn")!.addEventListener("click", clearHistory);
  document.getElementById("ai-send-btn")!.addEventListener("click", () => sendMessage());

  const input = document.getElementById("ai-input") as HTMLTextAreaElement;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  renderMessages();
}

// ─── Message rendering ───────────────────────────────────────────
function renderMessages(): void {
  const container = document.getElementById("ai-messages");
  if (!container) return;

  if (chatHistory.length === 0) {
    container.innerHTML = renderWelcome();
    bindExampleButtons();
  } else {
    container.innerHTML = chatHistory.map((msg, idx) => renderMessage(msg, idx)).join("");
    bindConfirmButtons();
    scrollToBottom();
  }
}

function renderWelcome(): string {
  const mode = getAppMode();

  if (mode === "handlowy") {
    return `
      <div class="ai-welcome">
        <div class="ai-welcome-icon"><i class="fa-solid fa-robot"></i></div>
        <div class="ai-welcome-title">Cześć! Jestem Twoim asystentem.</div>
        <div class="ai-welcome-text">Opisz ofertę przetargową, a ja pomogę ją przygotować. Najpierw pokażę plan, potem wykonam operacje.</div>
        <div class="ai-welcome-examples">
          <button class="ai-example-btn" data-msg="Mam przetarg na dostawę artykułów spożywczych do szkoły: jajka 500 kartonów, mleko 1200 szt, masło 300 szt. Klient: SP nr 3 Kielce, termin: 15 marca">
            <i class="fa-solid fa-gavel"></i> Oferta na artykuły
          </button>
          <button class="ai-example-btn" data-msg="Dodaj produkt: Ręcznik papierowy ZZ 200 listków, cena zakupu 4.50 zł/opak, dostawca Papirus">
            <i class="fa-solid fa-plus"></i> Dodaj produkt
          </button>
          <button class="ai-example-btn" data-msg="Ustaw marżę 12% na wszystkich pozycjach w ofercie na dostawę do SP nr 7">
            <i class="fa-solid fa-percent"></i> Zmień marżę
          </button>
        </div>
      </div>
    `;
  }

  return `
    <div class="ai-welcome">
      <div class="ai-welcome-icon"><i class="fa-solid fa-robot"></i></div>
      <div class="ai-welcome-title">Cześć! Jestem Twoim asystentem.</div>
      <div class="ai-welcome-text">Opisz zlecenie w naturalnym języku, a ja stworzę wycenę. Najpierw pokażę Ci plan, a po Twojej akceptacji wykonam operacje.</div>
      <div class="ai-welcome-examples">
        <button class="ai-example-btn" data-msg="Mam zlecenie na malowanie mieszkania 60m2 dla Kowalskich, ściany i sufity, plus gładzie">
          <i class="fa-solid fa-paint-roller"></i> Malowanie mieszkania
        </button>
        <button class="ai-example-btn" data-msg="Dodaj do bazy: kabel YDYp 3x1.5 po 3.20 zł/m, dostawca Elektroskandia">
          <i class="fa-solid fa-plus"></i> Dodaj materiał
        </button>
        <button class="ai-example-btn" data-msg="Instalacja elektryczna w biurze 150m2: gniazdka 40szt, oświetlenie 25 punktów, rozdzielnica, okablowanie">
          <i class="fa-solid fa-bolt"></i> Instalacja elektryczna
        </button>
      </div>
    </div>
  `;
}

function renderMessage(msg: ChatMessage, idx: number): string {
  const isUser = msg.role === "user";

  // Action tags
  const actionsHtml = msg.actions && msg.actions.length > 0
    ? `<div class="ai-msg-actions">${msg.actions.map((a) =>
        `<div class="ai-action-tag">${getActionIcon(a.type)} ${getActionLabel(a)}</div>`
      ).join("")}</div>`
    : "";

  // Confirmation buttons (only for last pending confirmation)
  let confirmHtml = "";
  if (!isUser && msg.needs_confirmation && msg.confirmed === undefined) {
    confirmHtml = `
      <div class="ai-confirm-bar">
        <button class="ai-confirm-btn ai-confirm-yes" data-idx="${idx}">
          <i class="fa-solid fa-check"></i> Potwierdź
        </button>
        <button class="ai-confirm-btn ai-confirm-no" data-idx="${idx}">
          <i class="fa-solid fa-xmark"></i> Anuluj
        </button>
      </div>
    `;
  }

  // Confirmation status badge
  let statusBadge = "";
  if (!isUser && msg.needs_confirmation && msg.confirmed === true) {
    statusBadge = `<div class="ai-confirm-status ai-status-confirmed"><i class="fa-solid fa-check"></i> Potwierdzone</div>`;
  } else if (!isUser && msg.needs_confirmation && msg.confirmed === false) {
    statusBadge = `<div class="ai-confirm-status ai-status-cancelled"><i class="fa-solid fa-xmark"></i> Anulowane</div>`;
  }

  return `
    <div class="ai-msg ${isUser ? "ai-msg-user" : "ai-msg-assistant"}">
      <div class="ai-msg-bubble">
        <div class="ai-msg-content">${formatMessage(msg.content)}</div>
        ${actionsHtml}
        ${statusBadge}
        ${confirmHtml}
      </div>
    </div>
  `;
}

function formatMessage(text: string): string {
  return esc(text).replace(/\n/g, "<br>");
}

function getActionIcon(type: string): string {
  const icons: Record<string, string> = {
    create_zlecenie: '<i class="fa-solid fa-file-invoice-dollar"></i>',
    add_zlecenie_item: '<i class="fa-solid fa-plus"></i>',
    add_material: '<i class="fa-solid fa-boxes-stacked"></i>',
    add_labor: '<i class="fa-solid fa-helmet-safety"></i>',
    edit_zlecenie: '<i class="fa-solid fa-pen"></i>',
    edit_zlecenie_item: '<i class="fa-solid fa-pen"></i>',
    edit_material: '<i class="fa-solid fa-pen"></i>',
    edit_labor: '<i class="fa-solid fa-pen"></i>',
    delete_zlecenie: '<i class="fa-solid fa-trash"></i>',
    delete_zlecenie_item: '<i class="fa-solid fa-trash"></i>',
    delete_material: '<i class="fa-solid fa-trash"></i>',
    delete_labor: '<i class="fa-solid fa-trash"></i>',
    navigate: '<i class="fa-solid fa-arrow-right"></i>',
    // Trade mode
    create_offer: '<i class="fa-solid fa-gavel"></i>',
    add_offer_item: '<i class="fa-solid fa-plus"></i>',
    edit_offer: '<i class="fa-solid fa-pen"></i>',
    edit_offer_item: '<i class="fa-solid fa-pen"></i>',
    delete_offer: '<i class="fa-solid fa-trash"></i>',
    delete_offer_item: '<i class="fa-solid fa-trash"></i>',
    add_product: '<i class="fa-solid fa-cube"></i>',
    edit_product: '<i class="fa-solid fa-pen"></i>',
    delete_product: '<i class="fa-solid fa-trash"></i>',
    set_offer_status: '<i class="fa-solid fa-flag"></i>',
    add_client: '<i class="fa-solid fa-user-plus"></i>',
    edit_client: '<i class="fa-solid fa-user-pen"></i>',
  };
  return icons[type] || '<i class="fa-solid fa-circle"></i>';
}

function getActionLabel(action: AIAction): string {
  const p = action.params;
  switch (action.type) {
    case "create_zlecenie": return `Zlecenie: ${p.name || "nowe"}`;
    case "add_zlecenie_item": return `${p.name} — ${p.quantity || 1} ${p.unit || "szt"}`;
    case "add_material": return `+ Materiał: ${p.name}`;
    case "add_labor": return `+ Robocizna: ${p.name}`;
    case "edit_zlecenie": return `Edycja zlecenia #${p.zlecenie_id}`;
    case "edit_zlecenie_item": return `Edycja pozycji: ${p.name || `#${p.item_id}`}`;
    case "edit_material": return `Edycja: ${p.name || `#${p.material_id}`}`;
    case "edit_labor": return `Edycja: ${p.name || `#${p.labor_id}`}`;
    case "delete_zlecenie": return `Usuń zlecenie #${p.zlecenie_id}`;
    case "delete_zlecenie_item": return `Usuń pozycję #${p.item_id}`;
    case "delete_material": return `Usuń materiał #${p.material_id}`;
    case "delete_labor": return `Usuń robociznę #${p.labor_id}`;
    case "navigate": return `Przejdź: ${p.page}`;
    // Trade mode
    case "create_offer": return `Oferta: ${p.name || "nowa"}`;
    case "add_offer_item": return `${p.name} — ${p.quantity || 1} ${p.unit || "szt"}`;
    case "edit_offer": return `Edycja oferty #${p.offer_id}`;
    case "edit_offer_item": return `Edycja pozycji: ${p.name || `#${p.item_id}`}`;
    case "delete_offer": return `Usuń ofertę #${p.offer_id}`;
    case "delete_offer_item": return `Usuń pozycję #${p.item_id}`;
    case "add_product": return `+ Produkt: ${p.name}`;
    case "edit_product": return `Edycja: ${p.name || `#${p.product_id}`}`;
    case "delete_product": return `Usuń produkt #${p.product_id}`;
    case "set_offer_status": return `Status → ${p.status}`;
    case "add_client": return `+ Klient: ${p.name}`;
    case "edit_client": return `Edycja klienta #${p.client_id}`;
    default: return action.type;
  }
}

// ─── Confirm / Cancel handlers ───────────────────────────────────
function bindConfirmButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".ai-confirm-yes").forEach((btn) => {
    btn.addEventListener("click", () => handleConfirm(parseInt(btn.dataset.idx!)));
  });
  document.querySelectorAll<HTMLButtonElement>(".ai-confirm-no").forEach((btn) => {
    btn.addEventListener("click", () => handleCancel(parseInt(btn.dataset.idx!)));
  });
}

async function handleConfirm(msgIdx: number): Promise<void> {
  const msg = chatHistory[msgIdx];
  if (!msg || msg.confirmed !== undefined) return;

  msg.confirmed = true;
  saveHistory();
  renderMessages();

  // Send "ok" to AI to get actions
  const input = document.getElementById("ai-input") as HTMLTextAreaElement;
  const originalValue = input.value;
  input.value = "";

  // Add user confirmation message
  chatHistory.push({
    role: "user",
    content: "OK, potwierdzone — rób.",
    timestamp: new Date().toISOString(),
  });
  saveHistory();
  renderMessages();
  addLoadingIndicator();
  isLoading = true;
  updateSendButton();

  try {
    const response = await callAI("Użytkownik potwierdził plan. Wykonaj wszystkie opisane akcje. Zwróć actions z konkretnymi operacjami.");

    let executionResults: string[] = [];
    if (response.actions && response.actions.length > 0) {
      executionResults = executeActions(response.actions);
    }

    let fullMessage = response.message;
    if (executionResults.length > 0) {
      fullMessage += "\n\n" + executionResults.join("\n");
    }

    chatHistory.push({
      role: "assistant",
      content: fullMessage,
      actions: response.actions,
      needs_confirmation: false,
      timestamp: new Date().toISOString(),
    });
    saveHistory();

    if (getLastZlecenieId() && onNavigate) {
      const mode = getAppMode();
      const page = mode === "handlowy" ? "offers" : "zlecenia";
      const toast = mode === "handlowy" ? "Oferta utworzona przez AI" : "Zlecenie utworzone przez AI";
      setTimeout(() => {
        onNavigate!(page, getLastZlecenieId()!);
        showToast(toast);
      }, 500);
    } else {
      // Refresh current view even without navigation
      window.dispatchEvent(new CustomEvent("ai-actions-executed"));
    }
  } catch (e: any) {
    chatHistory.push({
      role: "assistant",
      content: `Błąd: ${e.message}`,
      timestamp: new Date().toISOString(),
    });
    saveHistory();
  }

  isLoading = false;
  updateSendButton();
  removeLoadingIndicator();
  renderMessages();
  input.value = originalValue;
}

function handleCancel(msgIdx: number): void {
  const msg = chatHistory[msgIdx];
  if (!msg || msg.confirmed !== undefined) return;

  msg.confirmed = false;
  saveHistory();

  chatHistory.push({
    role: "assistant",
    content: "Anulowane. Powiedz co chcesz zmienić lub opisz nowe zadanie.",
    needs_confirmation: false,
    timestamp: new Date().toISOString(),
  });
  saveHistory();
  renderMessages();
}

// ─── Quick calculator ────────────────────────────────────────────
function tryQuickCalc(input: string): string | null {
  // Only if the message looks like a math expression
  const cleaned = input.trim().replace(/\s+/g, "");
  // Must contain at least one operator and be mostly math chars
  if (!/[+\-*/]/.test(cleaned)) return null;
  if (!/^[\d.,+\-*/()%\s]+$/.test(cleaned)) return null;
  // Replace comma with dot for Polish decimal separator
  const expr = cleaned.replace(/,/g, ".");
  try {
    // Safe eval using Function constructor (no access to globals)
    const result = new Function(`"use strict"; return (${expr})`)();
    if (typeof result !== "number" || !isFinite(result)) return null;
    // Format result with Polish comma
    const formatted = result.toFixed(2).replace(".", ",");
    return `${input} = ${formatted}`;
  } catch {
    return null;
  }
}

// ─── Send message ────────────────────────────────────────────────
async function sendMessage(): Promise<void> {
  const input = document.getElementById("ai-input") as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text || isLoading) return;

  // Quick calc — detect math expressions
  const mathResult = tryQuickCalc(text);
  if (mathResult !== null) {
    chatHistory.push({
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    });
    chatHistory.push({
      role: "assistant",
      content: `<div style="font-size:13px"><i class="fa-solid fa-calculator" style="margin-right:4px"></i> <strong>${mathResult}</strong></div>`,
      timestamp: new Date().toISOString(),
    });
    saveHistory();
    input.value = "";
    input.style.height = "auto";
    renderMessages();
    return;
  }

  chatHistory.push({
    role: "user",
    content: text,
    timestamp: new Date().toISOString(),
  });
  saveHistory();

  input.value = "";
  input.style.height = "auto";

  renderMessages();
  addLoadingIndicator();
  isLoading = true;
  updateSendButton();

  try {
    const response = await callAI(text);

    if (response.needs_confirmation) {
      // Plan mode — show plan, wait for confirm
      chatHistory.push({
        role: "assistant",
        content: response.message,
        needs_confirmation: true,
        confirmed: undefined,
        timestamp: new Date().toISOString(),
      });
    } else {
      // Direct response (question answer) or execution
      let executionResults: string[] = [];
      if (response.actions && response.actions.length > 0) {
        executionResults = executeActions(response.actions);
      }

      let fullMessage = response.message;
      if (executionResults.length > 0) {
        fullMessage += "\n\n" + executionResults.join("\n");
      }

      chatHistory.push({
        role: "assistant",
        content: fullMessage,
        actions: response.actions,
        needs_confirmation: false,
        timestamp: new Date().toISOString(),
      });

      if (getLastZlecenieId() && onNavigate) {
        const mode = getAppMode();
        const page = mode === "handlowy" ? "offers" : "zlecenia";
        setTimeout(() => {
          onNavigate!(page, getLastZlecenieId()!);
          showToast("Akcja AI wykonana");
        }, 500);
      }

      // Refresh current view
      window.dispatchEvent(new CustomEvent("ai-actions-executed"));
    }

    saveHistory();
  } catch (e: any) {
    chatHistory.push({
      role: "assistant",
      content: `Błąd: ${e.message}\n\nSprawdź połączenie z serwerem.`,
      timestamp: new Date().toISOString(),
    });
    saveHistory();
  }

  isLoading = false;
  updateSendButton();
  removeLoadingIndicator();
  renderMessages();
}

// ─── Helpers ─────────────────────────────────────────────────────
function bindExampleButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".ai-example-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById("ai-input") as HTMLTextAreaElement;
      input.value = btn.dataset.msg || "";
      input.focus();
    });
  });
}

function addLoadingIndicator(): void {
  const container = document.getElementById("ai-messages");
  if (!container) return;
  const loading = document.createElement("div");
  loading.id = "ai-loading";
  loading.className = "ai-msg ai-msg-assistant";
  loading.innerHTML = `<div class="ai-msg-bubble"><div class="ai-loading-dots"><span></span><span></span><span></span></div></div>`;
  container.appendChild(loading);
  scrollToBottom();
}

function removeLoadingIndicator(): void {
  document.getElementById("ai-loading")?.remove();
}

function updateSendButton(): void {
  const btn = document.getElementById("ai-send-btn");
  if (btn) {
    btn.classList.toggle("disabled", isLoading);
    btn.innerHTML = isLoading
      ? `<i class="fa-solid fa-spinner fa-spin"></i>`
      : `<i class="fa-solid fa-paper-plane"></i>`;
  }
}

function scrollToBottom(): void {
  const container = document.getElementById("ai-messages");
  if (container) {
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }
}

function clearHistory(): void {
  if (!confirm("Wyczyścić historię czatu?")) return;
  chatHistory = [];
  pendingActions = [];
  localStorage.removeItem(HISTORY_KEY);
  renderMessages();
  setTimeout(() => bindExampleButtons(), 50);
  showToast("Historia wyczyszczona");
}

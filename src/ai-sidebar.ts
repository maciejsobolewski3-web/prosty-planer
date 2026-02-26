// ─── Contextual AI Sidebar ──────────────────────────────────────
// Separate from the general AI assistant (ai-assistant.ts).
// Opens as a RIGHT-SIDE panel scoped to one specific offer/zlecenie.
// Has its own chat history per entity, resets on context change.

import {
  getOfferById,
  calcOfferTotals,
  getProducts,
  getProductById,
  addOfferItem,
  updateOfferItem,
  removeOfferItem,
  updateOffer,
  applyGlobalMargin,
  addProduct,
  updateProduct,
  fuzzyMatchProduct,
  getAppMode,
  type OfferInput,
} from "./store-trade";
import {
  getZlecenia,
  getMaterials,
  getLabor,
  getCategories,
  getCategoryById,
  addZlecenieItem,
  updateZlecenieItem,
  removeZlecenieItem,
  updateZlecenie,
  addMaterial,
  addLabor,
} from "./store";
import type { Offer, Zlecenie, OfferStatus } from "./types";
import { esc, showToast } from "./ui";

// ─── Config ──────────────────────────────────────────────────────
const API_BASE = "https://prostyprzetarg.pl";
const AI_ENDPOINT = `${API_BASE}/api/planer/ai`;

// ─── Types ───────────────────────────────────────────────────────
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  actions?: AIAction[];
  needs_confirmation?: boolean;
  confirmed?: boolean;
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

interface SidebarContext {
  entity_type: "offer" | "zlecenie";
  entity_id: number;
}

// ─── State ───────────────────────────────────────────────────────
let currentContext: SidebarContext | null = null;
let chatHistory: ChatMessage[] = [];
let isOpen = false;
let isLoading = false;
let refreshCallback: (() => void) | null = null;

// ─── Public API ──────────────────────────────────────────────────

/**
 * Open the contextual AI sidebar for a specific entity.
 * Resets chat if entity changed.
 */
export function openContextAISidebar(ctx: SidebarContext, onRefresh?: () => void): void {
  if (onRefresh) refreshCallback = onRefresh;

  // If context changed, reset chat
  if (!currentContext || currentContext.entity_type !== ctx.entity_type || currentContext.entity_id !== ctx.entity_id) {
    chatHistory = [];
    currentContext = ctx;
  }

  isOpen = true;
  ensureSidebarDOM();
  renderSidebarContent();
  updateToggleButton();

  const sidebar = document.getElementById("ctx-ai-sidebar");
  if (sidebar) sidebar.classList.add("open");
  document.body.classList.add("ctx-ai-sidebar-open");

  setTimeout(() => {
    const input = document.getElementById("ctx-ai-input") as HTMLTextAreaElement;
    if (input) input.focus();
  }, 200);
}

/**
 * Close the contextual AI sidebar.
 */
export function closeContextAISidebar(): void {
  isOpen = false;
  const sidebar = document.getElementById("ctx-ai-sidebar");
  if (sidebar) sidebar.classList.remove("open");
  document.body.classList.remove("ctx-ai-sidebar-open");
  updateToggleButton();
}

/**
 * Toggle the contextual sidebar.
 */
export function toggleContextAISidebar(): void {
  if (isOpen) closeContextAISidebar();
  else if (currentContext) openContextAISidebar(currentContext);
}

/**
 * Show the floating toggle button for a specific entity.
 * Called from offers.ts / zlecenia.ts renderDetail().
 */
export function showContextAIToggle(ctx: SidebarContext, onRefresh?: () => void): void {
  currentContext = ctx;
  if (onRefresh) refreshCallback = onRefresh;
  ensureToggleButton();
  const btn = document.getElementById("ctx-ai-toggle");
  if (btn) btn.classList.remove("hidden");
  // Hide the general AI fab so there's only one button
  const generalFab = document.getElementById("ai-fab");
  if (generalFab) generalFab.classList.add("hidden");
}

/**
 * Hide the floating toggle button (when leaving detail view).
 */
export function hideContextAIToggle(): void {
  closeContextAISidebar();
  currentContext = null;
  chatHistory = [];
  const btn = document.getElementById("ctx-ai-toggle");
  if (btn) btn.classList.add("hidden");
  // Restore the general AI fab
  const generalFab = document.getElementById("ai-fab");
  if (generalFab) generalFab.classList.remove("hidden");
}

/**
 * Initialize — called once from main.ts.
 */
export function initContextAISidebar(): void {
  ensureToggleButton();
  ensureSidebarDOM();
}

// ─── DOM setup ───────────────────────────────────────────────────

function ensureToggleButton(): void {
  let btn = document.getElementById("ctx-ai-toggle");
  if (btn) return;

  btn = document.createElement("button");
  btn.id = "ctx-ai-toggle";
  btn.className = "ctx-ai-toggle hidden";
  btn.innerHTML = `<i class="fa-solid fa-robot"></i><span>Asystent AI</span>`;
  btn.title = "Otwórz asystenta AI dla tego elementu";
  btn.addEventListener("click", () => {
    if (isOpen) closeContextAISidebar();
    else if (currentContext) openContextAISidebar(currentContext);
  });
  document.body.appendChild(btn);
}

function ensureSidebarDOM(): void {
  let sidebar = document.getElementById("ctx-ai-sidebar");
  if (sidebar) return;

  sidebar = document.createElement("aside");
  sidebar.id = "ctx-ai-sidebar";
  sidebar.className = "ctx-ai-sidebar";
  document.body.appendChild(sidebar);
}

function updateToggleButton(): void {
  const btn = document.getElementById("ctx-ai-toggle");
  if (!btn) return;
  if (isOpen) {
    btn.classList.add("active");
    btn.innerHTML = `<i class="fa-solid fa-xmark"></i><span>Zamknij</span>`;
  } else {
    btn.classList.remove("active");
    btn.innerHTML = `<i class="fa-solid fa-robot"></i><span>Asystent AI</span>`;
  }
}

// ─── Render sidebar content ──────────────────────────────────────

function getEntityLabel(): string {
  if (!currentContext) return "Asystent AI";
  if (currentContext.entity_type === "offer") {
    const o = getOfferById(currentContext.entity_id);
    return o ? `AI · ${o.name}` : "AI · Oferta";
  } else {
    const z = getZlecenia().find((zl) => zl.id === currentContext!.entity_id);
    return z ? `AI · ${z.name}` : "AI · Zlecenie";
  }
}

function getPlaceholder(): string {
  if (!currentContext) return "Opisz co chcesz zrobić...";
  if (currentContext.entity_type === "offer") {
    return "Zapytaj o tę ofertę, zmień marżę, dodaj pozycje...";
  }
  return "Zapytaj o to zlecenie, dodaj materiały, zmień ceny...";
}

function renderSidebarContent(): void {
  const sidebar = document.getElementById("ctx-ai-sidebar");
  if (!sidebar) return;

  sidebar.innerHTML = `
    <div class="ctx-ai-header">
      <div class="ctx-ai-title">
        <i class="fa-solid fa-robot"></i>
        <span>${esc(getEntityLabel())}</span>
      </div>
      <div class="ctx-ai-header-actions">
        <button class="ai-header-btn" id="ctx-ai-clear-btn" title="Wyczyść czat">
          <i class="fa-solid fa-trash-can"></i>
        </button>
        <button class="ai-header-btn" id="ctx-ai-close-btn" title="Zamknij">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
    <div class="ctx-ai-context-badge" id="ctx-ai-context-badge">${getContextBadge()}</div>
    <div class="ctx-ai-messages" id="ctx-ai-messages"></div>
    <div class="ctx-ai-input-area">
      <textarea id="ctx-ai-input" class="ai-input" placeholder="${getPlaceholder()}" rows="2"></textarea>
      <button class="ai-send-btn" id="ctx-ai-send-btn" title="Wyślij (Enter)">
        <i class="fa-solid fa-paper-plane"></i>
      </button>
    </div>
    <div class="ctx-ai-footer">Kontekst: ${currentContext?.entity_type === "offer" ? "oferta" : "zlecenie"} · Gemini Flash</div>
  `;

  // Bind events
  document.getElementById("ctx-ai-close-btn")!.addEventListener("click", closeContextAISidebar);
  document.getElementById("ctx-ai-clear-btn")!.addEventListener("click", clearChat);
  document.getElementById("ctx-ai-send-btn")!.addEventListener("click", () => sendMessage());

  const input = document.getElementById("ctx-ai-input") as HTMLTextAreaElement;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  renderMessages();
}

function getContextBadge(): string {
  if (!currentContext) return "";

  if (currentContext.entity_type === "offer") {
    const o = getOfferById(currentContext.entity_id);
    if (!o) return "";
    const totals = calcOfferTotals(o.id);
    return `
      <i class="fa-solid fa-gavel"></i>
      <span>${esc(o.name)}</span>
      <span class="ctx-badge-sep">·</span>
      <span>${o.items.length} pozycji</span>
      <span class="ctx-badge-sep">·</span>
      <span>Marża ${totals.marginPercent.toFixed(1)}%</span>
    `;
  } else {
    const z = getZlecenia().find((zl) => zl.id === currentContext!.entity_id);
    if (!z) return "";
    return `
      <i class="fa-solid fa-file-invoice-dollar"></i>
      <span>${esc(z.name)}</span>
      <span class="ctx-badge-sep">·</span>
      <span>${z.items.length} pozycji</span>
    `;
  }
}

// ─── Messages ────────────────────────────────────────────────────

function renderMessages(): void {
  const container = document.getElementById("ctx-ai-messages");
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
  if (!currentContext) return "";

  if (currentContext.entity_type === "offer") {
    const o = getOfferById(currentContext.entity_id);
    const name = o ? esc(o.name) : "tej ofercie";
    return `
      <div class="ai-welcome">
        <div class="ai-welcome-icon"><i class="fa-solid fa-robot"></i></div>
        <div class="ai-welcome-title">Asystent oferty</div>
        <div class="ai-welcome-text">Pracuję w kontekście oferty <strong>${name}</strong>. Mogę dodać pozycje, zmienić marże, przeanalizować ceny.</div>
        <div class="ai-welcome-examples">
          <button class="ctx-ai-example-btn" data-msg="Ustaw marżę 15% na wszystkich pozycjach">
            <i class="fa-solid fa-percent"></i> Zmień marżę
          </button>
          <button class="ctx-ai-example-btn" data-msg="Dodaj pozycję: mleko 2% 1L, 500 sztuk, cena zakupu 3.20 zł">
            <i class="fa-solid fa-plus"></i> Dodaj pozycję
          </button>
          <button class="ctx-ai-example-btn" data-msg="Podsumuj tę ofertę — ile zarobię, jaka jest średnia marża">
            <i class="fa-solid fa-chart-bar"></i> Podsumowanie
          </button>
        </div>
      </div>
    `;
  } else {
    const z = getZlecenia().find((zl) => zl.id === currentContext!.entity_id);
    const name = z ? esc(z.name) : "tym zleceniu";
    return `
      <div class="ai-welcome">
        <div class="ai-welcome-icon"><i class="fa-solid fa-robot"></i></div>
        <div class="ai-welcome-title">Asystent zlecenia</div>
        <div class="ai-welcome-text">Pracuję w kontekście zlecenia <strong>${name}</strong>. Mogę dodawać materiały, robociznę i analizować koszty.</div>
        <div class="ai-welcome-examples">
          <button class="ctx-ai-example-btn" data-msg="Dodaj gładź gipsową 120m2, farbę lateksową 120m2 i taśmę malarską 50 szt">
            <i class="fa-solid fa-plus"></i> Dodaj materiały
          </button>
          <button class="ctx-ai-example-btn" data-msg="Ile kosztuje to zlecenie i jaki jest zysk po narzucie?">
            <i class="fa-solid fa-calculator"></i> Podsumowanie
          </button>
          <button class="ctx-ai-example-btn" data-msg="Zaktualizuj ceny wszystkich pozycji z bazy materiałów">
            <i class="fa-solid fa-rotate"></i> Aktualizuj ceny
          </button>
        </div>
      </div>
    `;
  }
}

function renderMessage(msg: ChatMessage, idx: number): string {
  const isUser = msg.role === "user";

  const actionsHtml = msg.actions && msg.actions.length > 0
    ? `<div class="ai-msg-actions">${msg.actions.map((a) =>
        `<div class="ai-action-tag">${getActionIcon(a.type)} ${getActionLabel(a)}</div>`
      ).join("")}</div>`
    : "";

  let confirmHtml = "";
  if (!isUser && msg.needs_confirmation && msg.confirmed === undefined) {
    confirmHtml = `
      <div class="ai-confirm-bar">
        <button class="ctx-ai-confirm-yes" data-idx="${idx}">
          <i class="fa-solid fa-check"></i> Potwierdź
        </button>
        <button class="ctx-ai-confirm-no" data-idx="${idx}">
          <i class="fa-solid fa-xmark"></i> Anuluj
        </button>
      </div>
    `;
  }

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

// ─── Action icons / labels ───────────────────────────────────────

function getActionIcon(type: string): string {
  const icons: Record<string, string> = {
    add_offer_item: '<i class="fa-solid fa-plus"></i>',
    edit_offer_item: '<i class="fa-solid fa-pen"></i>',
    delete_offer_item: '<i class="fa-solid fa-trash"></i>',
    edit_offer: '<i class="fa-solid fa-pen"></i>',
    add_product: '<i class="fa-solid fa-cube"></i>',
    set_offer_status: '<i class="fa-solid fa-flag"></i>',
    add_zlecenie_item: '<i class="fa-solid fa-plus"></i>',
    edit_zlecenie_item: '<i class="fa-solid fa-pen"></i>',
    delete_zlecenie_item: '<i class="fa-solid fa-trash"></i>',
    edit_zlecenie: '<i class="fa-solid fa-pen"></i>',
  };
  return icons[type] || '<i class="fa-solid fa-circle"></i>';
}

function getActionLabel(action: AIAction): string {
  const p = action.params;
  switch (action.type) {
    case "add_offer_item": return `+ ${p.name || "pozycja"} (${p.quantity ?? 1} ${p.unit || "szt"})`;
    case "edit_offer_item": return `Edycja: ${p.name || `#${p.item_id}`}`;
    case "delete_offer_item": return `Usuń: ${p.name || `#${p.item_id}`}`;
    case "edit_offer": return `Zmiana oferty`;
    case "add_product": return `+ Produkt: ${p.name}`;
    case "set_offer_status": return `Status → ${p.status}`;
    case "save_item_to_catalog": return `→ Cennik: #${p.item_id}`;
    case "add_product_to_catalog": return `+ Cennik: ${p.name}`;
    case "add_zlecenie_item": return `+ ${p.name || "pozycja"} (${p.quantity ?? 1} ${p.unit || "szt"})`;
    case "edit_zlecenie_item": return `Edycja: ${p.name || `#${p.item_id}`}`;
    case "delete_zlecenie_item": return `Usuń: ${p.name || `#${p.item_id}`}`;
    case "edit_zlecenie": return `Zmiana zlecenia`;
    case "save_item_to_materials": return `→ Baza materiałów: ${p.name}`;
    case "save_item_to_labor": return `→ Baza robocizn: ${p.name}`;
    default: return action.type;
  }
}

// ─── Context builder (scoped to current entity) ──────────────────

function buildScopedContext(): Record<string, any> {
  if (!currentContext) return {};

  const mode = getAppMode();
  const base: Record<string, any> = { mode };

  if (currentContext.entity_type === "offer") {
    const o = getOfferById(currentContext.entity_id);
    if (!o) return base;
    const totals = calcOfferTotals(o.id);
    const products = getProducts();

    base.focused_entity = {
      type: "offer",
      id: o.id,
      name: o.name,
      client: o.client,
      status: o.status,
      reference_number: o.reference_number,
      global_margin: o.global_margin,
      deadline: o.deadline,
      delivery_start: o.delivery_start,
      delivery_end: o.delivery_end,
      transport_cost: o.transport_cost,
      storage_cost: o.storage_cost,
      other_costs: o.other_costs,
      notes: o.notes,
      items: o.items.map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        purchase_price: i.purchase_price,
        offer_price: i.offer_price,
        margin_percent: i.margin_percent,
        vat_rate: i.vat_rate,
        product_id: i.product_id,
        matched: i.matched,
        notes: i.notes,
      })),
      totals: {
        totalPurchase: totals.totalPurchase,
        totalOffer: totals.totalOffer,
        marginPercent: totals.marginPercent,
        netProfit: totals.netProfit,
      },
    };

    // Include product catalog for reference
    base.products = products.map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      purchase_price: p.purchase_price,
      catalog_price: p.catalog_price,
      supplier: p.supplier,
    }));

  } else {
    // zlecenie
    const z = getZlecenia().find((zl) => zl.id === currentContext!.entity_id);
    if (!z) return base;
    const materials = getMaterials({ show_archived: false });
    const labor = getLabor({ show_archived: false });
    const categories = getCategories();

    base.focused_entity = {
      type: "zlecenie",
      id: z.id,
      name: z.name,
      client: z.client,
      status: z.status,
      markup_materials: z.markup_materials,
      markup_labor: z.markup_labor,
      date_start: z.date_start,
      date_end: z.date_end,
      notes: z.notes,
      items: z.items.map((i) => ({
        id: i.id,
        type: i.type,
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        price_netto: i.price_netto,
        vat_rate: i.vat_rate,
        source_id: i.source_id,
        notes: i.notes,
      })),
    };

    base.materials = materials.map((m) => ({
      id: m.id, name: m.name, unit: m.unit,
      price_netto: m.price_netto, vat_rate: m.vat_rate,
      category: getCategoryById(m.category_id)?.name || "",
      supplier: m.supplier,
    }));

    base.labor = labor.map((l) => ({
      id: l.id, name: l.name, unit: l.unit,
      price_netto: l.price_netto, vat_rate: l.vat_rate,
      category: l.category,
    }));

    base.categories = categories.map((c) => ({ id: c.id, name: c.name }));
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

function normalizeActions(rawActions: any[]): AIAction[] {
  if (!rawActions || !Array.isArray(rawActions)) return [];
  return rawActions.map((a) => ({
    type: a.type || a.action || a.action_type || "unknown",
    params: a.params || a.parameters || {},
  }));
}

async function callContextAI(message: string): Promise<AIResponse> {
  const token = getAuthToken();
  const context = buildScopedContext();

  const historyForAPI = chatHistory.slice(-6).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const body: Record<string, any> = {
    message,
    mode: context.mode,
    history: historyForAPI,
    focused_entity: context.focused_entity,
    context_mode: "scoped", // tell API this is scoped to one entity
  };

  // Include reference data
  if (context.products) body.products = context.products;
  if (context.materials) body.materials = context.materials;
  if (context.labor) body.labor = context.labor;
  if (context.categories) body.categories = context.categories;

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
  data.actions = normalizeActions(data.actions);
  return data;
}

// ─── Action executor (scoped) ────────────────────────────────────

function executeScopedActions(actions: AIAction[]): string[] {
  if (!currentContext) return ["Brak kontekstu"];
  const results: string[] = [];
  const entityId = currentContext.entity_id;
  const entityType = currentContext.entity_type;

  for (const rawAction of actions) {
    const action: AIAction = {
      type: rawAction.type || (rawAction as any).action || "",
      params: rawAction.params || (rawAction as any).parameters || rawAction,
    };

    if (!action.type || action.type === "unknown") continue;

    try {
      const p = action.params;

      if (entityType === "offer") {
        switch (action.type) {
          case "add_offer_item": {
            addOfferItem(entityId, {
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
            results.push(`+ ${p.name} (${p.quantity ?? 1} ${p.unit || "szt"})`);
            break;
          }
          case "edit_offer_item": {
            if (!p.item_id) { results.push(`Brak ID pozycji`); break; }
            const updates: Record<string, any> = {};
            if (p.name !== undefined) updates.name = p.name;
            if (p.unit !== undefined) updates.unit = p.unit;
            if (p.quantity !== undefined) updates.quantity = p.quantity;
            if (p.purchase_price !== undefined) updates.purchase_price = p.purchase_price;
            if (p.offer_price !== undefined) updates.offer_price = p.offer_price;
            if (p.vat_rate !== undefined) updates.vat_rate = p.vat_rate;
            if (p.margin_percent !== undefined) updates.margin_percent = p.margin_percent;
            if (p.notes !== undefined) updates.notes = p.notes;
            updateOfferItem(entityId, p.item_id, updates);
            results.push(`Zaktualizowano: ${p.name || `#${p.item_id}`}`);
            break;
          }
          case "delete_offer_item": {
            if (!p.item_id) { results.push(`Brak ID pozycji`); break; }
            removeOfferItem(entityId, p.item_id);
            results.push(`Usunięto pozycję #${p.item_id}`);
            break;
          }
          case "edit_offer": {
            const o = getOfferById(entityId);
            if (!o) break;
            // If global_margin is set, use applyGlobalMargin which recalculates all item prices
            if (p.global_margin !== undefined) {
              applyGlobalMargin(entityId, p.global_margin);
            }
            const offerUpdates: Partial<OfferInput> = {};
            if (p.name !== undefined) offerUpdates.name = p.name;
            if (p.client !== undefined) offerUpdates.client = p.client;
            if (p.status !== undefined) offerUpdates.status = p.status;
            if (p.notes !== undefined) offerUpdates.notes = p.notes;
            if (p.deadline !== undefined) offerUpdates.deadline = p.deadline;
            if (p.transport_cost !== undefined) offerUpdates.transport_cost = p.transport_cost;
            if (p.storage_cost !== undefined) offerUpdates.storage_cost = p.storage_cost;
            if (Object.keys(offerUpdates).length > 0) updateOffer(entityId, offerUpdates);
            results.push(`Zaktualizowano ofertę`);
            break;
          }
          case "add_product": {
            addProduct({
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
            results.push(`+ Produkt: ${p.name}`);
            break;
          }
          case "set_offer_status": {
            if (p.status) {
              updateOffer(entityId, { status: p.status });
              results.push(`Status → ${p.status}`);
            }
            break;
          }
          case "save_item_to_catalog": {
            // Save an offer item to the product catalog
            if (!p.item_id) { results.push(`Brak ID pozycji`); break; }
            const offer = getOfferById(entityId);
            const offerItem = offer?.items.find((i) => i.id === p.item_id);
            if (!offerItem) { results.push(`Pozycja #${p.item_id} nie znaleziona`); break; }
            const existingProd = fuzzyMatchProduct(offerItem.name);
            if (existingProd && existingProd.score >= 0.8) {
              updateProduct(existingProd.product.id, {
                purchase_price: offerItem.purchase_price || existingProd.product.purchase_price,
                catalog_price: offerItem.offer_price || existingProd.product.catalog_price,
              });
              updateOfferItem(entityId, offerItem.id, { product_id: existingProd.product.id, matched: true });
              results.push(`Zaktualizowano "${existingProd.product.name}" w cenniku`);
            } else {
              const np = addProduct({
                name: p.name || offerItem.name,
                unit: p.unit || offerItem.unit,
                purchase_price: p.purchase_price ?? offerItem.purchase_price,
                catalog_price: p.catalog_price ?? offerItem.offer_price,
                vat_rate: p.vat_rate ?? offerItem.vat_rate,
                category_id: null, ean: "", sku: p.sku || "",
                supplier: p.supplier || "", min_order: "", notes: p.notes || "Dodano przez AI",
              });
              updateOfferItem(entityId, offerItem.id, { product_id: np.id, matched: true });
              results.push(`+ Cennik: "${offerItem.name}"`);
            }
            break;
          }
          case "add_product_to_catalog": {
            // Add a brand new product to catalog (not linked to any item)
            const np2 = addProduct({
              name: p.name || "Produkt",
              unit: p.unit || "szt",
              purchase_price: p.purchase_price ?? 0,
              catalog_price: p.catalog_price ?? 0,
              vat_rate: p.vat_rate ?? 23,
              category_id: null, ean: p.ean || "", sku: p.sku || "",
              supplier: p.supplier || "", min_order: p.min_order || "",
              notes: p.notes || "Dodano przez AI",
            });
            results.push(`+ Cennik: "${np2.name}"`);
            break;
          }
          default:
            results.push(`? ${action.type}`);
        }

      } else {
        // zlecenie
        switch (action.type) {
          case "add_zlecenie_item": {
            addZlecenieItem(entityId, {
              type: p.item_type || p.type || "material",
              source_id: p.source_id || null,
              name: p.name || "Pozycja",
              unit: p.unit || "szt",
              quantity: p.quantity ?? 1,
              price_netto: p.price_netto ?? 0,
              vat_rate: p.vat_rate ?? 23,
              notes: p.notes || "",
            });
            results.push(`+ ${p.name} (${p.quantity ?? 1} ${p.unit || "szt"})`);
            break;
          }
          case "edit_zlecenie_item": {
            if (!p.item_id) { results.push(`Brak ID pozycji`); break; }
            const updates: Record<string, any> = {};
            if (p.name !== undefined) updates.name = p.name;
            if (p.unit !== undefined) updates.unit = p.unit;
            if (p.quantity !== undefined) updates.quantity = p.quantity;
            if (p.price_netto !== undefined) updates.price_netto = p.price_netto;
            if (p.vat_rate !== undefined) updates.vat_rate = p.vat_rate;
            if (p.notes !== undefined) updates.notes = p.notes;
            updateZlecenieItem(entityId, p.item_id, updates);
            results.push(`Zaktualizowano: ${p.name || `#${p.item_id}`}`);
            break;
          }
          case "delete_zlecenie_item": {
            if (!p.item_id) { results.push(`Brak ID pozycji`); break; }
            removeZlecenieItem(entityId, p.item_id);
            results.push(`Usunięto pozycję #${p.item_id}`);
            break;
          }
          case "edit_zlecenie": {
            const z = getZlecenia().find((zl) => zl.id === entityId);
            if (!z) break;
            updateZlecenie(entityId, {
              name: p.name ?? z.name,
              client: p.client ?? z.client,
              status: p.status ?? z.status,
              notes: p.notes ?? z.notes,
              markup_materials: p.markup_materials ?? z.markup_materials,
              markup_labor: p.markup_labor ?? z.markup_labor,
              date_start: p.date_start ?? z.date_start,
              date_end: p.date_end ?? z.date_end,
            });
            results.push(`Zaktualizowano zlecenie`);
            break;
          }
          case "save_item_to_materials": {
            // Save a zlecenie item to the materials database
            const nm = addMaterial({
              name: p.name || "Materiał",
              unit: p.unit || "szt",
              price_netto: p.price_netto ?? 0,
              vat_rate: p.vat_rate ?? 23,
              category_id: null,
              supplier: p.supplier || "",
              sku: p.sku || "",
              url: p.url || "",
              notes: p.notes || "Dodano przez AI z zlecenia",
            });
            results.push(`+ Baza materiałów: "${nm.name}"`);
            break;
          }
          case "save_item_to_labor": {
            // Save a zlecenie item to the labor database
            const nl = addLabor({
              name: p.name || "Robocizna",
              unit: p.unit || "m2",
              price_netto: p.price_netto ?? 0,
              vat_rate: p.vat_rate ?? 23,
              category: p.category || "",
              notes: p.notes || "Dodano przez AI z zlecenia",
            });
            results.push(`+ Baza robocizn: "${nl.name}"`);
            break;
          }
          default:
            results.push(`? ${action.type}`);
        }
      }
    } catch (e: any) {
      results.push(`Błąd: ${e.message}`);
    }
  }

  return results;
}

// ─── Send message ────────────────────────────────────────────────

async function sendMessage(): Promise<void> {
  const input = document.getElementById("ctx-ai-input") as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text || isLoading) return;

  chatHistory.push({
    role: "user",
    content: text,
    timestamp: new Date().toISOString(),
  });

  input.value = "";
  input.style.height = "auto";

  renderMessages();
  addLoadingIndicator();
  isLoading = true;
  updateSendButton();

  try {
    const response = await callContextAI(text);

    if (response.needs_confirmation) {
      chatHistory.push({
        role: "assistant",
        content: response.message,
        actions: response.actions,
        needs_confirmation: true,
        confirmed: undefined,
        timestamp: new Date().toISOString(),
      });
    } else {
      let executionResults: string[] = [];
      if (response.actions && response.actions.length > 0) {
        executionResults = executeScopedActions(response.actions);
      }

      let fullMessage = response.message;
      if (executionResults.length > 0) {
        fullMessage += "\n\n" + executionResults.map(r => `\u2713 ${r}`).join("\n");
      }

      chatHistory.push({
        role: "assistant",
        content: fullMessage,
        actions: response.actions,
        needs_confirmation: false,
        timestamp: new Date().toISOString(),
      });

      // Refresh the detail view
      if (response.actions && response.actions.length > 0) {
        triggerRefresh();
      }
    }
  } catch (e: any) {
    chatHistory.push({
      role: "assistant",
      content: `Błąd: ${e.message}\n\nSprawdź połączenie z serwerem.`,
      timestamp: new Date().toISOString(),
    });
  }

  isLoading = false;
  updateSendButton();
  removeLoadingIndicator();
  renderMessages();
  // Update context badge (totals may have changed)
  const badge = document.getElementById("ctx-ai-context-badge");
  if (badge) badge.innerHTML = getContextBadge();
}

// ─── Confirm / cancel ────────────────────────────────────────────

function bindConfirmButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".ctx-ai-confirm-yes").forEach((btn) => {
    btn.addEventListener("click", () => handleConfirm(parseInt(btn.dataset.idx!)));
  });
  document.querySelectorAll<HTMLButtonElement>(".ctx-ai-confirm-no").forEach((btn) => {
    btn.addEventListener("click", () => handleCancel(parseInt(btn.dataset.idx!)));
  });
}

async function handleConfirm(msgIdx: number): Promise<void> {
  const msg = chatHistory[msgIdx];
  if (!msg || msg.confirmed !== undefined) return;

  msg.confirmed = true;
  renderMessages();

  // Add user confirmation
  chatHistory.push({
    role: "user",
    content: "OK, potwierdzone — rób.",
    timestamp: new Date().toISOString(),
  });
  renderMessages();
  addLoadingIndicator();
  isLoading = true;
  updateSendButton();

  try {
    const response = await callContextAI("Użytkownik potwierdził plan. Wykonaj wszystkie opisane akcje. Zwróć actions z konkretnymi operacjami.");

    let executionResults: string[] = [];
    if (response.actions && response.actions.length > 0) {
      executionResults = executeScopedActions(response.actions);
    }

    let fullMessage = response.message;
    if (executionResults.length > 0) {
      fullMessage += "\n\n" + executionResults.map(r => `\u2713 ${r}`).join("\n");
    }

    chatHistory.push({
      role: "assistant",
      content: fullMessage,
      actions: response.actions,
      needs_confirmation: false,
      timestamp: new Date().toISOString(),
    });

    if (response.actions && response.actions.length > 0) {
      triggerRefresh();
    }
  } catch (e: any) {
    chatHistory.push({
      role: "assistant",
      content: `Błąd: ${e.message}`,
      timestamp: new Date().toISOString(),
    });
  }

  isLoading = false;
  updateSendButton();
  removeLoadingIndicator();
  renderMessages();
  const badge = document.getElementById("ctx-ai-context-badge");
  if (badge) badge.innerHTML = getContextBadge();
}

function handleCancel(msgIdx: number): void {
  const msg = chatHistory[msgIdx];
  if (!msg || msg.confirmed !== undefined) return;

  msg.confirmed = false;
  chatHistory.push({
    role: "assistant",
    content: "Anulowane. Powiedz co chcesz zmienić.",
    needs_confirmation: false,
    timestamp: new Date().toISOString(),
  });
  renderMessages();
}

// ─── Helpers ─────────────────────────────────────────────────────

function triggerRefresh(): void {
  if (refreshCallback) refreshCallback();
  window.dispatchEvent(new CustomEvent("ai-actions-executed"));
  showToast("AI wykonał akcje");
}

function bindExampleButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".ctx-ai-example-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById("ctx-ai-input") as HTMLTextAreaElement;
      if (input) {
        input.value = btn.dataset.msg || "";
        input.focus();
      }
    });
  });
}

function addLoadingIndicator(): void {
  const container = document.getElementById("ctx-ai-messages");
  if (!container) return;
  const loading = document.createElement("div");
  loading.id = "ctx-ai-loading";
  loading.className = "ai-msg ai-msg-assistant";
  loading.innerHTML = `<div class="ai-msg-bubble"><div class="ai-loading-dots"><span></span><span></span><span></span></div></div>`;
  container.appendChild(loading);
  scrollToBottom();
}

function removeLoadingIndicator(): void {
  document.getElementById("ctx-ai-loading")?.remove();
}

function updateSendButton(): void {
  const btn = document.getElementById("ctx-ai-send-btn");
  if (btn) {
    btn.classList.toggle("disabled", isLoading);
    btn.innerHTML = isLoading
      ? `<i class="fa-solid fa-spinner fa-spin"></i>`
      : `<i class="fa-solid fa-paper-plane"></i>`;
  }
}

function scrollToBottom(): void {
  const container = document.getElementById("ctx-ai-messages");
  if (container) {
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }
}

function clearChat(): void {
  chatHistory = [];
  renderMessages();
  setTimeout(() => bindExampleButtons(), 50);
}

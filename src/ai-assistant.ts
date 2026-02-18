import {
  getMaterials,
  getLabor,
  getCategories,
  getCategoryById,
  getZlecenia,
  getExpenses,
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
  const materials = getMaterials({ show_archived: false });
  const labor = getLabor({ show_archived: false });
  const categories = getCategories();
  const zlecenia = getZlecenia();
  const expenses = getExpenses();

  return {
    materials: materials.map((m) => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      price_netto: m.price_netto,
      vat_rate: m.vat_rate,
      category: getCategoryById(m.category_id)?.name || "",
      supplier: m.supplier,
    })),
    labor: labor.map((l) => ({
      id: l.id,
      name: l.name,
      unit: l.unit,
      price_netto: l.price_netto,
      vat_rate: l.vat_rate,
      category: l.category,
    })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    zlecenia: zlecenia.map((z) => ({
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
    })),
    expenses: expenses.map((e) => ({
      id: e.id,
      name: e.name,
      amount: e.amount,
      category: e.category,
      zlecenie_id: e.zlecenie_id,
      date: e.date,
    })),
  };
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

  const response = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message,
      materials: context.materials,
      labor: context.labor,
      categories: context.categories,
      zlecenia: context.zlecenia,
      expenses: context.expenses,
      history: historyForAPI,
    }),
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

        // ── NAVIGATE ──
        case "navigate": {
          if (onNavigate) {
            const zId = p.page === "zlecenia" && getLastZlecenieId() ? getLastZlecenieId()! : undefined;
            onNavigate(p.page, zId);
          }
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
      <textarea id="ai-input" class="ai-input" placeholder="Opisz zlecenie, dodaj materiały..." rows="2"></textarea>
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
      setTimeout(() => {
        onNavigate!("zlecenia", getLastZlecenieId()!);
        showToast("Zlecenie utworzone przez AI", "success");
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

// ─── Send message ────────────────────────────────────────────────
async function sendMessage(): Promise<void> {
  const input = document.getElementById("ai-input") as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text || isLoading) return;

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
        setTimeout(() => {
          onNavigate!("zlecenia", getLastZlecenieId()!);
          showToast("Akcja AI wykonana", "success");
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
  showToast("Historia wyczyszczona", "success");
}

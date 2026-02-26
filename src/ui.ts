// ─── HTML escape ─────────────────────────────────────────────────
const escDiv = document.createElement("div");
export function esc(s: string): string {
  escDiv.textContent = s;
  return escDiv.innerHTML;
}

// ─── Modal ───────────────────────────────────────────────────────
const overlay = () => document.getElementById("modal-overlay")!;
const box = () => document.getElementById("modal-box")!;
let _modalLocked = false;

export function openModal(html: string, cssClass?: string, lock = false): void {
  _modalLocked = lock;
  const b = box();
  b.className = "modal-box" + (cssClass ? " " + cssClass : "");
  b.innerHTML = html;
  overlay().classList.remove("hidden");
}

export function closeModal(): void {
  _modalLocked = false;
  overlay().classList.add("hidden");
  box().innerHTML = "";
}

export function initModalBackdrop(): void {
  overlay().addEventListener("click", (e) => {
    if (e.target === overlay() && !_modalLocked) closeModal();
  });
}

// ─── Toast ───────────────────────────────────────────────────────
export function showToast(message: string): void {
  const container = document.getElementById("toast-container")!;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 250);
  }, 2500);
}

// ─── Price formatting ────────────────────────────────────────────
export function formatPrice(price: number): string {
  return price.toFixed(2).replace(".", ",");
}

export function brutto(netto: number, vatRate: number): number {
  return Math.round(netto * (1 + vatRate / 100) * 100) / 100;
}

// ─── Link parsing ────────────────────────────────────────────────
export interface LinkData {
  label: string;
  url: string;
}

export function parseLinks(urlField: string): LinkData[] {
  try {
    const parsed = JSON.parse(urlField || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

// ─── Validation helpers ──────────────────────────────────────────
export function validateNIP(nip: string): boolean {
  const cleaned = nip.replace(/[\s-]/g, "");
  if (!/^\d{10}$/.test(cleaned)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const digits = cleaned.split("").map(Number);
  const sum = weights.reduce((s, w, i) => s + w * digits[i], 0);
  return sum % 11 === digits[9];
}

export function formatNIP(nip: string): string {
  const cleaned = nip.replace(/[\s-]/g, "");
  if (cleaned.length !== 10) return nip;
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6, 8)}-${cleaned.slice(8)}`;
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s()-]/g, "");
  return /^(\+?\d{9,12})$/.test(cleaned);
}

// ─── Date helpers ────────────────────────────────────────────────
export function daysUntil(dateStr: string): number {
  if (!dateStr) return Infinity;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

export function formatDatePL(dateStr: string): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

// ─── Sortable table helper ───────────────────────────────────────
export interface SortState { column: string; dir: "asc" | "desc" }

export function renderSortableHeader(label: string, column: string, sort: SortState): string {
  const isActive = sort.column === column;
  const icon = isActive
    ? (sort.dir === "asc" ? "fa-sort-up" : "fa-sort-down")
    : "fa-sort";
  const opacity = isActive ? "1" : "0.3";
  return `<th class="sortable-th" data-sort-col="${column}" style="cursor:pointer;user-select:none">
    ${label} <i class="fa-solid ${icon}" style="font-size:10px;opacity:${opacity};margin-left:2px"></i>
  </th>`;
}

export function toggleSort(current: SortState, column: string): SortState {
  if (current.column === column) {
    return { column, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { column, dir: "asc" };
}

export function bindSortHeaders(container: HTMLElement, state: SortState, onSort: (s: SortState) => void): void {
  container.querySelectorAll<HTMLElement>("[data-sort-col]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.sortCol!;
      onSort(toggleSort(state, col));
    });
  });
}

export function sortArray<T>(arr: T[], column: string, dir: "asc" | "desc", getter: (item: T, col: string) => string | number): T[] {
  return [...arr].sort((a, b) => {
    const va = getter(a, column);
    const vb = getter(b, column);
    let cmp: number;
    if (typeof va === "number" && typeof vb === "number") {
      cmp = va - vb;
    } else {
      cmp = String(va).localeCompare(String(vb), "pl", { sensitivity: "base" });
    }
    return dir === "desc" ? -cmp : cmp;
  });
}

// ─── Duplicate name checker ────────────────────────────────────────
export function checkDuplicateName(newName: string, existingNames: string[], threshold = 0.8): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-ząćęłńóśźż0-9]/g, "").trim();
  const newNorm = norm(newName);
  if (!newNorm) return null;

  for (const existing of existingNames) {
    const exNorm = norm(existing);
    if (exNorm === newNorm) return existing;
    // Check containment
    if (exNorm.includes(newNorm) || newNorm.includes(exNorm)) {
      const ratio = Math.min(newNorm.length, exNorm.length) / Math.max(newNorm.length, exNorm.length);
      if (ratio > threshold) return existing;
    }
  }
  return null;
}

// ─── Tags ─────────────────────────────────────────────────────────
export const TAG_COLORS: Record<string, string> = {
  "pilne": "#e5484d",
  "VIP": "#f5a623",
  "powtórne": "#667eea",
  "nowy klient": "#30a46c",
  "duże zlecenie": "#8b5cf6",
  "mały budżet": "#06b6d4",
  "reklamacja": "#ec4899",
  "stały klient": "#14b8a6",
};

export function renderTagBadges(tags?: string[]): string {
  if (!tags || tags.length === 0) return "";
  return tags.map(t => {
    const color = TAG_COLORS[t] || "#888";
    return `<span class="tag-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${esc(t)}</span>`;
  }).join("");
}

export function renderTagPicker(currentTags: string[], containerId: string): string {
  const allTags = Object.keys(TAG_COLORS);
  return `<div id="${containerId}" class="tag-picker">
    ${allTags.map(t => {
      const active = currentTags.includes(t);
      const color = TAG_COLORS[t];
      return `<button type="button" class="tag-picker-item${active ? " active" : ""}" data-tag="${esc(t)}" style="--tag-color:${color}">
        ${active ? '<i class="fa-solid fa-check" style="font-size:9px"></i>' : ''} ${esc(t)}
      </button>`;
    }).join("")}
  </div>`;
}

export function bindTagPicker(containerId: string): string[] {
  const container = document.getElementById(containerId);
  if (!container) return [];
  const items = container.querySelectorAll<HTMLButtonElement>(".tag-picker-item");
  const selected = new Set<string>();
  items.forEach(btn => { if (btn.classList.contains("active")) selected.add(btn.dataset.tag!); });

  items.forEach(btn => {
    btn.addEventListener("click", () => {
      const tag = btn.dataset.tag!;
      if (selected.has(tag)) {
        selected.delete(tag);
        btn.classList.remove("active");
        btn.innerHTML = ` ${esc(tag)}`;
      } else {
        selected.add(tag);
        btn.classList.add("active");
        btn.innerHTML = `<i class="fa-solid fa-check" style="font-size:9px"></i> ${esc(tag)}`;
      }
    });
  });

  return [...selected];
}

export function getSelectedTags(containerId: string): string[] {
  const container = document.getElementById(containerId);
  if (!container) return [];
  const tags: string[] = [];
  container.querySelectorAll<HTMLButtonElement>(".tag-picker-item.active").forEach(btn => {
    tags.push(btn.dataset.tag!);
  });
  return tags;
}

// ─── Empty state ──────────────────────────────────────────────
export function renderEmptyState(icon: string, title: string, subtitle: string, actionLabel?: string, actionId?: string): string {
  return `<div class="empty-state">
    <div class="empty-state-icon"><i class="${icon}"></i></div>
    <div class="empty-state-title">${title}</div>
    <div class="empty-state-subtitle">${subtitle}</div>
    ${actionLabel && actionId ? `<button class="btn btn-primary btn-sm" id="${actionId}" style="margin-top:12px"><i class="fa-solid fa-plus"></i> ${actionLabel}</button>` : ""}
  </div>`;
}

// ─── Form validation helpers ───────────────────────────────────────
export function validateRequired(value: string, fieldName: string): string | null {
  return value.trim() ? null : `${fieldName} jest wymagane`;
}

export function validateNIPStrict(nip: string): string | null {
  if (!nip) return null; // optional
  const clean = nip.replace(/[-\s]/g, "");
  if (!/^\d{10}$/.test(clean)) return "NIP musi mieć 10 cyfr";
  // NIP checksum
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(clean[i]) * weights[i];
  return sum % 11 === parseInt(clean[9]) ? null : "Nieprawidłowy NIP";
}

export function validateEmailStrict(email: string): string | null {
  if (!email) return null; // optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : "Nieprawidłowy email";
}

export function validatePhoneStrict(phone: string): string | null {
  if (!phone) return null;
  const clean = phone.replace(/[-\s()]/g, "");
  return /^\+?\d{7,15}$/.test(clean) ? null : "Nieprawidłowy numer telefonu";
}

export function showFieldError(inputEl: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, msg: string | null): boolean {
  const wrapper = inputEl.parentElement;
  // Remove old error
  wrapper?.querySelector(".field-error")?.remove();
  inputEl.style.borderColor = msg ? "var(--danger)" : "";
  if (msg) {
    const errEl = document.createElement("div");
    errEl.className = "field-error";
    errEl.textContent = msg;
    wrapper?.appendChild(errEl);
    return false;
  }
  return true;
}

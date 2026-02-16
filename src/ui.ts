// ─── HTML escape ─────────────────────────────────────────────────
const escDiv = document.createElement("div");
export function esc(s: string): string {
  escDiv.textContent = s;
  return escDiv.innerHTML;
}

// ─── Modal ───────────────────────────────────────────────────────
const overlay = () => document.getElementById("modal-overlay")!;
const box = () => document.getElementById("modal-box")!;

export function openModal(html: string, cssClass?: string): void {
  const b = box();
  b.className = "modal-box" + (cssClass ? " " + cssClass : "");
  b.innerHTML = html;
  overlay().classList.remove("hidden");
}

export function closeModal(): void {
  overlay().classList.add("hidden");
  box().innerHTML = "";
}

export function initModalBackdrop(): void {
  overlay().addEventListener("click", (e) => {
    if (e.target === overlay()) closeModal();
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

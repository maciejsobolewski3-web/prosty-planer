// ─── Oferty przetargowe (Trade mode) ────────────────────────────
// Analogous to zlecenia.ts but for tender offers

import type { Offer, OfferItem, OfferStatus } from "./types";
import { setAIViewContext } from "./ai-assistant";
import { showContextAIToggle, hideContextAIToggle } from "./ai-sidebar";
import { getCompany, type CompanySettings } from "./store";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  getOffers,
  getOfferById,
  addOffer,
  updateOffer,
  deleteOffer,
  duplicateOffer,
  setOfferStatus,
  addOfferItem,
  updateOfferItem,
  removeOfferItem,
  reorderOfferItems,
  applyGlobalMargin,
  calcOfferTotals,
  getProducts,
  getProductById,
  addProduct,
  updateProduct,
  fuzzyMatchProduct,
  addOfferComment,
  deleteOfferComment,
  getOfferTemplates,
  saveOfferAsTemplate,
  createOfferFromTemplate,
  deleteOfferTemplate,
  type OfferInput,
  type OfferTotals,
} from "./store-trade";
import {
  esc,
  openModal,
  closeModal,
  showToast,
  formatPrice,
  brutto,
  renderTagBadges,
  renderTagPicker,
  getSelectedTags,
} from "./ui";
import { renderClientPicker, quickAddClientFromName } from "./klienci";
import { dpHeader, dpSections, dpFooter, dpCollect, dpValidate, dpBindActions, dpFocus, type DPSection, type DPFooterButton } from "./detail-page";
import { dangerModal } from "./danger-modal";

// ─── Status config ───────────────────────────────────────────────
const OFFER_STATUS_CONFIG: Record<OfferStatus, { label: string; color: string; icon: string }> = {
  robocza:    { label: "Robocza",     color: "#555870",  icon: "fa-solid fa-pencil" },
  zlozona:    { label: "Złożona",     color: "#667eea",  icon: "fa-solid fa-paper-plane" },
  wygrana:    { label: "Wygrana",     color: "#30a46c",  icon: "fa-solid fa-trophy" },
  przegrana:  { label: "Przegrana",   color: "#e5484d",  icon: "fa-solid fa-xmark" },
  realizacja: { label: "Realizacja",  color: "#f5a623",  icon: "fa-solid fa-truck" },
  zakonczona: { label: "Zakończona", color: "#30a46c",  icon: "fa-solid fa-flag-checkered" },
};

function offerStatusBadge(status: OfferStatus): string {
  const s = OFFER_STATUS_CONFIG[status] || OFFER_STATUS_CONFIG.robocza;
  return `<span class="status-badge" style="color:${s.color};background:${s.color}18"><i class="${s.icon}" style="font-size:10px"></i> ${s.label}</span>`;
}

export { OFFER_STATUS_CONFIG };

// ─── State ───────────────────────────────────────────────────────
let activeOfferId: number | null = null;
let offerFormMode: boolean = false;
let filterStatus: OfferStatus | "all" = "all";
let filterClient: string = "";

export function initOffers(): void {
  activeOfferId = null;
  offerFormMode = false;
  filterStatus = "all";
  filterClient = "";
  render();

  // Listen for open-offer event from dashboard
  window.addEventListener("open-offer", ((e: CustomEvent) => {
    activeOfferId = e.detail;
    offerFormMode = false;
    render();
  }) as EventListener);
}

function render(): void {
  if (offerFormMode) renderOfferForm();
  else if (activeOfferId !== null) renderDetail(activeOfferId);
  else renderList();
}

// ═══════════════════════════════════════════════════════════════════
// OFFER FORM (Detail Page Pattern)
// ═══════════════════════════════════════════════════════════════════
function renderOfferForm(o?: Offer): void {
  const page = document.getElementById("page-offers")!;
  const isEdit = !!o;

  document.getElementById("topbar-title")!.textContent = isEdit ? "Edytuj ofertę" : "Nowa oferta";
  document.getElementById("topbar-actions")!.innerHTML = "";

  const sections = getOfferSections(o);
  const footerButtons: DPFooterButton[] = [
    { id: "btn-of-cancel", label: "Anuluj", style: "secondary", action: "back" },
    { id: "btn-of-save", label: isEdit ? "Zapisz" : "Utwórz", style: "primary", action: "save" },
  ];

  page.innerHTML = `
    ${dpHeader(isEdit ? `Ustawienia oferty: ${esc(o!.name)}` : "Nowa oferta")}
    ${dpSections(sections)}
    ${dpFooter(footerButtons)}
  `;

  dpBindActions(page, {
    back: () => {
      offerFormMode = false;
      render();
    },
    save: () => {
      // This will be handled by the individual button listener below
    },
  });
  dpFocus(page, sections);

  // Handle save
  document.getElementById("btn-of-save")!.addEventListener("click", () => {
    const result = dpValidate(page, sections);
    if (!result.valid) {
      showToast(`Błędy: ${Object.values(result.errors).join(", ")}`);
      return;
    }

    const data = dpCollect(page, sections);
    const input: OfferInput = {
      name: data.name,
      client: data.client,
      reference_number: data.reference_number,
      status: data.status,
      notes: data.notes,
      global_margin: parseFloat(data.global_margin) || 0,
      transport_cost: o?.transport_cost || 0,
      storage_cost: o?.storage_cost || 0,
      other_costs: o?.other_costs || 0,
      deadline: data.deadline,
      delivery_start: data.delivery_start,
      delivery_end: data.delivery_end,
      tags: getSelectedTags("tag-picker-o"),
    };

    if (input.client) quickAddClientFromName(input.client);

    if (isEdit && o) {
      updateOffer(o.id, input);
      showToast("Oferta zaktualizowana");
      activeOfferId = o.id;
    } else {
      const newO = addOffer(input);
      activeOfferId = newO.id;
      showToast("Oferta utworzona");
    }

    offerFormMode = false;
    render();
  });

  // Handle cancel
  document.getElementById("btn-of-cancel")!.addEventListener("click", () => {
    offerFormMode = false;
    render();
  });
}

function getOfferSections(o?: Offer): DPSection[] {
  const statusOptions = Object.entries(OFFER_STATUS_CONFIG).map(([key, cfg]) => ({
    value: key,
    label: cfg.label,
  }));

  return [
    {
      id: "section-general",
      title: "Podstawowe informacje",
      columns: 2,
      fields: [
        {
          id: "f-o-name",
          name: "name",
          label: "Nazwa przetargu",
          type: "text",
          required: true,
          placeholder: "np. Dostawa artykułów biurowych",
          value: o?.name ?? "",
        },
        {
          id: "f-o-client",
          name: "client",
          label: "Zamawiający",
          type: "custom",
          customHtml: `<div class="field"><label>Zamawiający</label>${renderClientPicker("f-o-client", o?.client ?? "")}</div>`,
        },
        {
          id: "f-o-ref",
          name: "reference_number",
          label: "Numer referencyjny (BZP/TED)",
          type: "text",
          placeholder: "opcjonalnie",
          value: o?.reference_number ?? "",
        },
        {
          id: "f-o-status",
          name: "status",
          label: "Status",
          type: "select",
          value: o?.status ?? "robocza",
          options: statusOptions,
        },
      ],
    },
    {
      id: "section-margin",
      title: "Marża",
      columns: 1,
      fields: [
        {
          id: "f-o-margin",
          name: "global_margin",
          label: "Domyślna marża (%)",
          type: "number",
          step: 0.1,
          min: 0,
          value: o?.global_margin ?? 10,
        },
      ],
    },
    {
      id: "section-dates",
      title: "Terminy",
      columns: 3,
      fields: [
        {
          id: "f-o-deadline",
          name: "deadline",
          label: "Termin składania",
          type: "date",
          value: o?.deadline ?? "",
        },
        {
          id: "f-o-delivery-start",
          name: "delivery_start",
          label: "Początek dostaw",
          type: "date",
          value: o?.delivery_start ?? "",
        },
        {
          id: "f-o-delivery-end",
          name: "delivery_end",
          label: "Koniec dostaw",
          type: "date",
          value: o?.delivery_end ?? "",
        },
      ],
    },
    {
      id: "section-notes",
      title: "Dodatkowe informacje",
      columns: 1,
      fields: [
        {
          id: "f-o-notes",
          name: "notes",
          label: "Notatki",
          type: "textarea",
          placeholder: "Dodatkowe informacje...",
          value: o?.notes ?? "",
          rows: 3,
        },
      ],
      customHtml: `<div class="field" style="margin-top:12px"><label>Tagi</label>${renderTagPicker(o?.tags ?? [], "tag-picker-o")}</div>`,
    },
  ];
}


// ═══════════════════════════════════════════════════════════════════
// LIST VIEW
// ═══════════════════════════════════════════════════════════════════
function renderList(): void {
  const page = document.getElementById("page-offers")!;
  setAIViewContext({ entity_type: null, entity_id: null });
  hideContextAIToggle();
  const allOffers = getOffers();
  let offers = filterStatus === "all" ? allOffers : allOffers.filter((o) => o.status === filterStatus);
  if (filterClient) offers = offers.filter((o) => o.client === filterClient);

  document.getElementById("topbar-title")!.textContent = "Oferty";
  document.getElementById("topbar-actions")!.innerHTML = `
    ${allOffers.length >= 2 ? `<button class="btn" id="btn-compare-offers"><i class="fa-solid fa-scale-balanced"></i> Porównaj</button>` : ""}
    <button class="btn" id="btn-from-offer-template"><i class="fa-solid fa-bookmark"></i> Z szablonu</button>
    <button class="btn btn-primary" id="btn-add-offer">
      <i class="fa-solid fa-plus"></i> Nowa oferta
    </button>
  `;
  document.getElementById("btn-add-offer")!.addEventListener("click", () => { offerFormMode = true; render(); });
  document.getElementById("btn-compare-offers")?.addEventListener("click", () => openCompareModal(allOffers));
  document.getElementById("btn-from-offer-template")?.addEventListener("click", () => openFromOfferTemplateModal());

  // Status filter bar
  const statusFilters = renderStatusFilters(allOffers);

  if (allOffers.length === 0) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="fa-solid fa-gavel"></i></div>
        <h3>Brak ofert</h3>
        <p>Stwórz pierwszą ofertę przetargową — dodaj pozycje z cennika lub zaimportuj z Excela.</p>
        <button class="btn btn-primary" id="btn-empty-add-offer">
          <i class="fa-solid fa-plus"></i> Nowa oferta
        </button>
      </div>
    `;
    page.querySelector("#btn-empty-add-offer")!.addEventListener("click", () => { offerFormMode = true; render(); });
    return;
  }

  page.innerHTML = statusFilters + `<div class="zlecenia-grid">${offers.map((o) => {
    const totals = calcOfferTotals(o.id);
    const itemCount = o.items.length;
    const deadlineStr = o.deadline ? new Date(o.deadline + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" }) : "—";
    const isUrgent = o.deadline && new Date(o.deadline) <= new Date(Date.now() + 7 * 24 * 3600 * 1000) && o.status === "robocza";

    return `
      <div class="zlecenie-card" data-oid="${o.id}">
        <div class="zlecenie-card-header">
          <div>
            <div class="zlecenie-card-title">${esc(o.name)}</div>
            <div style="margin-top:5px">${offerStatusBadge(o.status)}</div>
          </div>
          <div class="zlecenie-card-actions">
            <button class="btn-icon" title="Duplikuj" data-oduplicate="${o.id}"><i class="fa-solid fa-copy"></i></button>
            <button class="btn-icon" title="Edytuj dane" data-oedit="${o.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon" title="Usuń" data-odelete="${o.id}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        ${o.client ? `<div class="zlecenie-card-client"><i class="fa-solid fa-building-columns" style="font-size:11px"></i> ${esc(o.client)}</div>` : ""}
        ${o.reference_number ? `<div class="cell-muted" style="font-size:11px;margin-top:2px"><i class="fa-solid fa-hashtag" style="font-size:9px"></i> ${esc(o.reference_number)}</div>` : ""}
        <div class="zlecenie-card-meta">
          <span>${itemCount} pozycj${itemCount === 1 ? "a" : "i"}</span>
          <span>•</span>
          <span${isUrgent ? ' style="color:var(--danger);font-weight:600"' : ''}>
            <i class="fa-solid fa-clock" style="font-size:10px"></i> ${deadlineStr}
          </span>
        </div>
        <div class="zlecenie-card-total">
          <span class="zlecenie-card-total-label">Wartość oferty netto:</span>
          <span class="zlecenie-card-total-value">${formatPrice(totals.totalOffer)} zł</span>
        </div>
        ${totals.marginPercent > 0 ? `<div class="cell-muted" style="font-size:11px;margin-top:2px">Marża: ${totals.marginPercent.toFixed(1).replace(".", ",")}%</div>` : ""}
        ${o.tags && o.tags.length > 0 ? `<div style="margin-top:8px">${renderTagBadges(o.tags)}</div>` : ""}
      </div>
    `;
  }).join("")}</div>`;

  // Bind
  page.querySelectorAll<HTMLElement>(".zlecenie-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-oedit], [data-odelete], [data-oduplicate]")) return;
      activeOfferId = parseInt(card.dataset.oid!);
      offerFormMode = false;
      render();
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-oedit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const o = getOfferById(parseInt(btn.dataset.oedit!));
      if (o) { offerFormMode = true; activeOfferId = o.id; render(); }
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-oduplicate]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const copy = duplicateOffer(parseInt(btn.dataset.oduplicate!));
      if (copy) { showToast(`Zduplikowano: ${copy.name}`); render(); }
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-odelete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      dangerModal(`Czy na pewno chcesz usunąć ofertę "${getOfferById(parseInt(btn.dataset.odelete!))?.name}"?`).then(async (confirmed) => {
      if (!confirmed) return;
        deleteOffer(parseInt(btn.dataset.odelete!));
        showToast("Oferta usunięta");
        render();
      });
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-status-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filterStatus = btn.dataset.statusFilter as OfferStatus | "all";
      render();
    });
  });

  page.querySelector<HTMLSelectElement>("#client-filter-select")?.addEventListener("change", (e) => {
    filterClient = (e.target as HTMLSelectElement).value;
    render();
  });
}

// ─── Status filters ──────────────────────────────────────────────
function renderStatusFilters(allOffers: Offer[]): string {
  const counts: Record<string, number> = { all: allOffers.length };
  for (const o of allOffers) {
    counts[o.status] = (counts[o.status] || 0) + 1;
  }

  const uniqueClients = [...new Set(allOffers.map(o => o.client).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pl"));

  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;align-items:center;">`;
  html += `<button class="group-pill${filterStatus === "all" ? " active" : ""}" data-status-filter="all">Wszystkie (${counts.all})</button>`;

  for (const [key, cfg] of Object.entries(OFFER_STATUS_CONFIG)) {
    if (counts[key]) {
      html += `<button class="group-pill${filterStatus === key ? " active" : ""}" data-status-filter="${key}">
        <i class="${cfg.icon}" style="font-size:10px;color:${cfg.color}"></i> ${cfg.label} (${counts[key]})
      </button>`;
    }
  }

  html += `<select id="client-filter-select" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-primary);color:var(--text-primary);font-size:12px;cursor:pointer">
    <option value="">Wszyscy klienci</option>
    ${uniqueClients.map((client) => `<option value="${esc(client)}"${filterClient === client ? " selected" : ""}>${esc(client)}</option>`).join("")}
  </select>`;

  html += `</div>`;
  return html;
}


// ═══════════════════════════════════════════════════════════════════
// DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════
function renderDetail(oId: number): void {
  const page = document.getElementById("page-offers")!;
  page.scrollTo(0, 0);
  const o = getOfferById(oId);

  if (!o) { activeOfferId = null; renderList(); return; }

  // Set AI context to this offer
  setAIViewContext({ entity_type: "offer", entity_id: oId });
  showContextAIToggle({ entity_type: "offer", entity_id: oId }, () => renderDetail(oId));

  document.getElementById("topbar-title")!.textContent = o.name;
  const hasFillExcel = !!o.source_excel;
  document.getElementById("topbar-actions")!.innerHTML = `
    <button class="btn" id="btn-back-list"><i class="fa-solid fa-arrow-left"></i> Lista</button>
    <button class="btn" id="btn-import-excel"><i class="fa-solid fa-file-excel"></i> Importuj z Excela</button>
    <button class="btn btn-primary" id="btn-fill-excel"${!hasFillExcel ? ' disabled title="Najpierw zaimportuj formularz cenowy z Excel"' : ''}>
      <i class="fa-solid fa-file-circle-check"></i> Wypełnij formularz
    </button>
    <button class="btn" id="btn-export-offer-pdf"><i class="fa-solid fa-file-pdf"></i> PDF</button>
    <button class="btn" id="btn-export-offer-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>
    <button class="btn" id="btn-email-offer"><i class="fa-solid fa-envelope"></i> E-mail</button>
    <button class="btn" id="btn-save-offer-template"><i class="fa-solid fa-bookmark"></i> Szablon</button>
    <button class="btn" id="btn-edit-offer"><i class="fa-solid fa-gear"></i> Ustawienia</button>
    <button class="btn btn-primary" id="btn-add-offer-item"><i class="fa-solid fa-plus"></i> Dodaj pozycję</button>
  `;
  document.getElementById("btn-back-list")!.addEventListener("click", () => { activeOfferId = null; offerFormMode = false; render(); });
  document.getElementById("btn-import-excel")!.addEventListener("click", () => openImportExcelModal(o.id));
  document.getElementById("btn-fill-excel")!.addEventListener("click", () => { if (hasFillExcel) fillSourceExcel(o); });
  document.getElementById("btn-export-offer-pdf")!.addEventListener("click", () => {
    openModal(`
      <h2 class="modal-title"><i class="fa-solid fa-file-pdf"></i> Eksport PDF</h2>
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">Wybierz styl dokumentu:</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        <button class="btn" id="btn-pdf-modern"><i class="fa-solid fa-palette"></i> Nowoczesny</button>
        <button class="btn" id="btn-pdf-formal"><i class="fa-solid fa-briefcase"></i> Formalny</button>
        <button class="btn" id="btn-pdf-minimal"><i class="fa-solid fa-file"></i> Minimalny</button>
      </div>
      <div class="modal-footer">
        <button class="btn" id="btn-pdf-cancel">Anuluj</button>
      </div>
    `);
    document.getElementById("btn-pdf-cancel")!.addEventListener("click", closeModal);
    document.getElementById("btn-pdf-modern")!.addEventListener("click", () => { exportOfferPdf(o, "modern"); closeModal(); });
    document.getElementById("btn-pdf-formal")!.addEventListener("click", () => { exportOfferPdf(o, "formal"); closeModal(); });
    document.getElementById("btn-pdf-minimal")!.addEventListener("click", () => { exportOfferPdf(o, "minimal"); closeModal(); });
  });
  document.getElementById("btn-export-offer-csv")!.addEventListener("click", () => exportOfferCsv(o));
  document.getElementById("btn-email-offer")!.addEventListener("click", () => openEmailOfferModal(o));
  document.getElementById("btn-save-offer-template")!.addEventListener("click", () => openSaveOfferTemplateModal(o.id));
  document.getElementById("btn-edit-offer")!.addEventListener("click", () => { offerFormMode = true; render(); });
  document.getElementById("btn-add-offer-item")!.addEventListener("click", () => openAddOfferItemModal(o.id));

  // ─── Build content ────────────────────────────────────────────
  const totals = calcOfferTotals(o.id);

  let infoHtml = `
    <div class="dash-section">
      <div class="dash-section-title"><i class="fa-solid fa-info-circle" style="font-size:12px;margin-right:4px"></i> Informacje</div>
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Status</span>
          <select id="offer-status-select" style="padding:6px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-primary);font-weight:600">
            ${Object.entries(OFFER_STATUS_CONFIG).map(([key, cfg]) =>
              `<option value="${key}"${o.status === key ? " selected" : ""} style="color:${cfg.color}">${cfg.label}</option>`
            ).join("")}
          </select>
        </div>
        <div class="info-item">
          <span class="info-label">Zamawiający</span>
          <span>${esc(o.client || "—")}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Nr referencyjny</span>
          <span>${esc(o.reference_number || "—")}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Termin składania</span>
          <span>${o.deadline ? new Date(o.deadline + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" }) : "—"}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Okres dostaw</span>
          <span>${o.delivery_start || o.delivery_end ? [
            o.delivery_start ? new Date(o.delivery_start + "T12:00:00").toLocaleDateString("pl-PL") : "",
            o.delivery_end ? new Date(o.delivery_end + "T12:00:00").toLocaleDateString("pl-PL") : ""
          ].filter(Boolean).join(" — ") : "—"}</span>
        </div>
        ${o.tags && o.tags.length > 0 ? `<div class="info-item" style="grid-column:1/-1"><span class="info-label">Tagi</span>${renderTagBadges(o.tags)}</div>` : ""}
      </div>
    </div>
  `;

  let marginHtml = `
    <div class="dash-section">
      <div class="dash-section-title"><i class="fa-solid fa-percent" style="font-size:12px;margin-right:4px"></i> Domyślna marża</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="number" id="offer-global-margin" value="${o.global_margin}" min="0" step="0.5" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:var(--radius)" />
        <span>%</span>
        <button class="btn btn-sm" id="btn-apply-margin"><i class="fa-solid fa-check"></i> Zastosuj do wszystkich</button>
      </div>
    </div>
  `;

  let itemsHtml = "";

  if (o.items.length === 0) {
    itemsHtml = `
      <div class="dash-section">
        <div class="empty-state-inline">
          <div style="font-size:40px;margin-bottom:12px"><i class="fa-solid fa-inbox"></i></div>
          <h3>Brak pozycji</h3>
          <p>Dodaj pozycje z cennika lub zaimportuj z Excela.</p>
          <button class="btn btn-primary btn-sm" id="btn-empty-add-offer-item"><i class="fa-solid fa-plus"></i> Dodaj pozycję</button>
          <button class="btn btn-sm" id="btn-empty-import"><i class="fa-solid fa-file-excel"></i> Importuj</button>
        </div>
      </div>
    `;
  } else {
    const rows = o.items.map((item, i) => {
      const valueNetto = item.offer_price * item.quantity;
      const matched = item.product_id && item.matched;
      const matchIcon = matched ? '<span style="color:var(--success)"><i class="fa-solid fa-circle-check"></i></span>' : '<span style="color:var(--muted)"><i class="fa-solid fa-circle-xmark"></i></span>';

      return `<tr data-item-id="${item.id}" draggable="true">
        <td><input type="checkbox" class="bulk-check" data-item-id="${item.id}" /></td>
        <td><i class="fa-solid fa-grip" style="cursor:grab;color:var(--muted)"></i></td>
        <td class="cell-lp">${i + 1}</td>
        <td><strong>${esc(item.name)}</strong>${item.notes ? `<div class="cell-muted" style="font-size:11px">${esc(item.notes)}</div>` : ""}</td>
        <td class="cell-unit">${esc(item.unit)}</td>
        <td><input type="number" class="inline-edit" value="${item.quantity}" min="0" step="1" data-offer-qty="${item.id}" style="width:70px" /></td>
        <td><input type="number" class="inline-edit" value="${item.purchase_price}" min="0" step="0.01" data-offer-purchase="${item.id}" style="width:90px" /></td>
        <td><input type="number" class="inline-edit" value="${item.margin_percent}" min="0" step="0.5" data-offer-margin="${item.id}" style="width:60px" /></td>
        <td><input type="number" class="inline-edit" value="${item.offer_price}" min="0" step="0.01" data-offer-price="${item.id}" style="width:90px" /></td>
        <td><span class="cell-mono">${formatPrice(valueNetto)} zł</span></td>
        <td>${matchIcon}</td>
        <td>
          <div class="row-actions" style="opacity:1;display:flex;gap:2px">
            <button class="btn-icon" title="Zapisz do cennika" data-save-to-catalog="${item.id}" style="color:var(--primary)"><i class="fa-solid fa-bookmark"></i></button>
            <button class="btn-icon" title="Duplikuj" data-dup-oitem="${item.id}"><i class="fa-solid fa-copy"></i></button>
            <button class="btn-icon" title="Usuń" data-remove-offer-item="${item.id}" style="color:var(--danger)"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </td>
      </tr>`;
    }).join("");

    itemsHtml = `
      <div id="bulk-toolbar" class="bulk-toolbar hidden">
        <span id="bulk-count">Zaznaczono: 0</span>
        <button class="btn btn-danger btn-sm" id="btn-bulk-delete">
          <i class="fa-solid fa-trash"></i> Usuń zaznaczone
        </button>
      </div>
      <table class="data-table">
        <thead><tr>
          <th style="width:30px"><input type="checkbox" id="bulk-check-all" /></th>
          <th style="width:20px"></th>
          <th style="width:30px">Lp.</th>
          <th>Nazwa</th>
          <th>Jedn.</th>
          <th style="width:80px">Ilość</th>
          <th>Cena zakupu</th>
          <th style="width:70px">Marża %</th>
          <th style="width:100px">Cena ofertowa</th>
          <th>Wartość netto</th>
          <th style="width:30px"></th>
          <th style="width:30px"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // Summary panel
  const profitColor = totals.netProfit >= 0 ? "var(--success)" : "var(--danger)";
  const summaryHtml = `
    <div class="profit-panel">
      <div class="profit-panel-title">
        <span><i class="fa-solid fa-calculator"></i> Podsumowanie oferty</span>
      </div>
      <div class="profit-cards">
        <div class="profit-card">
          <div class="profit-card-label">Wartość zakupu</div>
          <div class="profit-card-value">${formatPrice(totals.totalPurchase)} zł</div>
        </div>
        <div class="profit-card">
          <div class="profit-card-label">Wartość oferty</div>
          <div class="profit-card-value" style="color:var(--accent)">${formatPrice(totals.totalOffer)} zł</div>
          <div class="profit-card-sub">brutto: ${formatPrice(totals.totalOfferBrutto)} zł</div>
        </div>
        <div class="profit-card">
          <div class="profit-card-label">Marża na towarze</div>
          <div class="profit-card-value" style="color:${totals.marginAmount >= 0 ? 'var(--success)' : 'var(--danger)'}">
            ${totals.marginAmount >= 0 ? "+" : ""}${formatPrice(totals.marginAmount)} zł
          </div>
          <div class="profit-card-sub">${totals.marginPercent.toFixed(1).replace(".", ",")}%</div>
        </div>
        <div class="profit-card">
          <div class="profit-card-label">Zysk netto</div>
          <div class="profit-card-value" style="color:${profitColor}">
            ${totals.netProfit >= 0 ? "+" : ""}${formatPrice(totals.netProfit)} zł
          </div>
          ${totals.monthlyProfit !== totals.netProfit ? `<div class="profit-card-sub">${formatPrice(totals.monthlyProfit)} zł/mies.</div>` : ""}
          ${totals.netProfit !== 0 ? `<div class="profit-bar"><div class="profit-bar-fill" style="width:${Math.min(Math.abs(totals.marginPercent), 100)}%;background:${profitColor}"></div></div>` : ""}
        </div>
      </div>

      <div class="profit-cost-breakdown">
        <div class="profit-expenses-title">Koszty logistyczne</div>
        <div class="profit-expense-row">
          <span class="expense-badge" style="color:#6B7280;background:#6B728018;font-size:10px"><i class="fa-solid fa-truck" style="font-size:9px"></i> Transport</span>
          <span></span>
          <span></span>
          <span class="profit-expense-amount">
            <input type="number" class="inline-edit" value="${o.transport_cost}" min="0" step="1" data-cost-transport style="width:80px;text-align:right" /> zł
          </span>
        </div>
        <div class="profit-expense-row">
          <span class="expense-badge" style="color:#3B82F6;background:#3B82F618;font-size:10px"><i class="fa-solid fa-warehouse" style="font-size:9px"></i> Magazyn</span>
          <span></span>
          <span></span>
          <span class="profit-expense-amount">
            <input type="number" class="inline-edit" value="${o.storage_cost}" min="0" step="1" data-cost-storage style="width:80px;text-align:right" /> zł
          </span>
        </div>
        <div class="profit-expense-row">
          <span class="expense-badge" style="color:#9CA3AF;background:#9CA3AF18;font-size:10px"><i class="fa-solid fa-ellipsis" style="font-size:9px"></i> Inne koszty</span>
          <span></span>
          <span></span>
          <span class="profit-expense-amount">
            <input type="number" class="inline-edit" value="${o.other_costs}" min="0" step="1" data-cost-other style="width:80px;text-align:right" /> zł
          </span>
        </div>
        <div class="profit-expense-row" style="font-weight:600;border-top:1px solid var(--border);padding-top:8px;margin-top:4px">
          <span>Razem koszty:</span>
          <span></span>
          <span></span>
          <span class="profit-expense-amount">${formatPrice(totals.totalCosts)} zł</span>
        </div>
      </div>
    </div>
  `;

  // ─── Comments section ──────────────────────────────────────────
  const comments = o.comments || [];
  const commentsHtml = `
    <div class="dash-section" style="margin-top:20px">
      <div class="dash-section-title"><i class="fa-solid fa-comments" style="font-size:12px;margin-right:4px"></i> Notatki i komentarze (${comments.length})</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input type="text" id="comment-input-o" placeholder="Dodaj notatkę..." style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-secondary);color:var(--text-primary);font-size:13px" />
        <button class="btn btn-primary btn-sm" id="btn-add-comment-o"><i class="fa-solid fa-plus"></i></button>
      </div>
      ${comments.length === 0 ? '<div class="cell-muted" style="padding:8px;font-size:12px">Brak notatek. Dodaj pierwszą notatkę powyżej.</div>' :
        `<div class="dash-recent-list">${comments.map((c) => {
          const dateStr = new Date(c.created_at).toLocaleString("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
          return `<div class="dash-recent-item" style="align-items:flex-start">
            <div class="dash-recent-info" style="flex:1">
              <div style="font-size:13px">${esc(c.text)}</div>
              <div class="cell-muted" style="font-size:10px">${dateStr}</div>
            </div>
            <button class="btn-icon" data-del-comment-o="${c.id}" style="color:var(--danger);font-size:11px" title="Usuń"><i class="fa-solid fa-xmark"></i></button>
          </div>`;
        }).join("")}</div>`}
    </div>
  `;

  page.innerHTML = infoHtml + marginHtml + itemsHtml + summaryHtml + commentsHtml;

  // ─── Comment events ───────────────────────────────────────────
  const commentInputO = document.getElementById("comment-input-o") as HTMLInputElement;
  document.getElementById("btn-add-comment-o")?.addEventListener("click", () => {
    const text = commentInputO?.value.trim();
    if (!text) return;
    addOfferComment(o.id, text);
    renderDetail(o.id);
  });
  commentInputO?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const text = commentInputO.value.trim();
      if (!text) return;
      addOfferComment(o.id, text);
      renderDetail(o.id);
    }
  });
  page.querySelectorAll<HTMLButtonElement>("[data-del-comment-o]").forEach((btn) => {
    btn.addEventListener("click", () => {
      deleteOfferComment(o.id, parseInt(btn.dataset.delCommentO!));
      renderDetail(o.id);
    });
  });

  // Bind events
  page.querySelector("#btn-empty-add-offer-item")?.addEventListener("click", () => openAddOfferItemModal(o.id));
  page.querySelector("#btn-empty-import")?.addEventListener("click", () => openImportExcelModal(o.id));

  // Status change
  const statusSelect = page.querySelector<HTMLSelectElement>("#offer-status-select");
  if (statusSelect) {
    statusSelect.addEventListener("change", () => {
      setOfferStatus(o.id, statusSelect.value as OfferStatus);
      const cfg = OFFER_STATUS_CONFIG[statusSelect.value as OfferStatus];
      statusSelect.style.color = cfg.color;
      showToast(`Status: ${cfg.label}`);
    });
  }

  // Apply global margin
  document.getElementById("btn-apply-margin")?.addEventListener("click", () => {
    const val = parseFloat((document.getElementById("offer-global-margin") as HTMLInputElement).value) || 0;
    applyGlobalMargin(o.id, val);
    showToast(`Marża ${val}% zastosowana do wszystkich pozycji`);
    renderDetail(o.id);
  });

  // Inline edit: quantity
  page.querySelectorAll<HTMLInputElement>("[data-offer-qty]").forEach((input) => {
    input.addEventListener("change", () => {
      updateOfferItem(o.id, parseInt(input.dataset.offerQty!), { quantity: parseFloat(input.value) || 0 });
      renderDetail(o.id);
    });
  });

  // Inline edit: margin
  page.querySelectorAll<HTMLInputElement>("[data-offer-margin]").forEach((input) => {
    input.addEventListener("change", () => {
      const itemId = parseInt(input.dataset.offerMargin!);
      const margin = parseFloat(input.value) || 0;
      const item = o.items.find((i) => i.id === itemId);
      if (item) {
        const newPrice = Math.round(item.purchase_price * (1 + margin / 100) * 100) / 100;
        updateOfferItem(o.id, itemId, { margin_percent: margin, offer_price: newPrice });
        renderDetail(o.id);
      }
    });
  });

  // Inline edit: offer price
  page.querySelectorAll<HTMLInputElement>("[data-offer-price]").forEach((input) => {
    input.addEventListener("change", () => {
      const itemId = parseInt(input.dataset.offerPrice!);
      const price = parseFloat(input.value) || 0;
      const item = o.items.find((i) => i.id === itemId);
      if (item) {
        const margin = item.purchase_price > 0 ? ((price / item.purchase_price) - 1) * 100 : 0;
        updateOfferItem(o.id, itemId, { offer_price: price, margin_percent: Math.round(margin * 10) / 10 });
        renderDetail(o.id);
      }
    });
  });

  // Inline edit: purchase price
  page.querySelectorAll<HTMLInputElement>("[data-offer-purchase]").forEach((input) => {
    input.addEventListener("change", () => {
      const itemId = parseInt(input.dataset.offerPurchase!);
      const purchasePrice = parseFloat(input.value) || 0;
      const item = o.items.find((i) => i.id === itemId);
      if (item) {
        const newOfferPrice = Math.round(purchasePrice * (1 + item.margin_percent / 100) * 100) / 100;
        updateOfferItem(o.id, itemId, { purchase_price: purchasePrice, offer_price: newOfferPrice });
        renderDetail(o.id);
      }
    });
  });

  // Save item to product catalog
  page.querySelectorAll<HTMLButtonElement>("[data-save-to-catalog]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const itemId = parseInt(btn.dataset.saveToCatalog!);
      const item = o.items.find((i) => i.id === itemId);
      if (!item) return;

      // Check if product already exists in catalog (fuzzy)
      const existing = fuzzyMatchProduct(item.name);
      if (existing && existing.score >= 0.8) {
        // Update existing product price if our price is newer
        dangerModal(`Produkt "${existing.product.name}" już istnieje w cenniku.\nCena w cenniku: ${formatPrice(existing.product.purchase_price)} zł\nCena z oferty: ${formatPrice(item.purchase_price)} zł\n\nZaktualizować cenę w cenniku?`).then(async (confirmed) => {
          if (!confirmed) return;
          updateProduct(existing.product.id, { purchase_price: item.purchase_price, catalog_price: item.offer_price });
          updateOfferItem(o.id, itemId, { product_id: existing.product.id, matched: true });
          showToast(`Zaktualizowano "${existing.product.name}" w cenniku`);
          renderDetail(o.id);
        });
        return;
      }

      // Add new product to catalog
      const newProduct = addProduct({
        name: item.name,
        unit: item.unit,
        purchase_price: item.purchase_price,
        catalog_price: item.offer_price,
        vat_rate: item.vat_rate,
        category_id: null,
        ean: "",
        sku: "",
        supplier: "",
        min_order: "",
        notes: "Dodano z oferty",
      });
      updateOfferItem(o.id, itemId, { product_id: newProduct.id, matched: true });
      showToast(`"${item.name}" dodano do cennika`);
      renderDetail(o.id);
    });
  });

  // Duplicate item
  page.querySelectorAll<HTMLButtonElement>("[data-dup-oitem]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const itemId = parseInt(btn.dataset.dupOitem!);
      const item = o.items.find((i) => i.id === itemId);
      if (!item) return;
      addOfferItem(o.id, {
        product_id: item.product_id,
        name: item.name,
        unit: item.unit,
        quantity: item.quantity,
        purchase_price: item.purchase_price,
        offer_price: item.offer_price,
        vat_rate: item.vat_rate,
        margin_percent: item.margin_percent,
        matched: item.matched,
        notes: item.notes,
      });
      showToast("Pozycja zduplikowana");
      renderDetail(o.id);
    });
  });

  // Remove items
  page.querySelectorAll<HTMLButtonElement>("[data-remove-offer-item]").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeOfferItem(o.id, parseInt(btn.dataset.removeOfferItem!));
      showToast("Pozycja usunięta");
      renderDetail(o.id);
    });
  });

  // Logistics cost inputs
  page.querySelector<HTMLInputElement>("[data-cost-transport]")?.addEventListener("change", (e) => {
    updateOffer(o.id, { transport_cost: parseFloat((e.target as HTMLInputElement).value) || 0 });
    renderDetail(o.id);
  });
  page.querySelector<HTMLInputElement>("[data-cost-storage]")?.addEventListener("change", (e) => {
    updateOffer(o.id, { storage_cost: parseFloat((e.target as HTMLInputElement).value) || 0 });
    renderDetail(o.id);
  });
  page.querySelector<HTMLInputElement>("[data-cost-other]")?.addEventListener("change", (e) => {
    updateOffer(o.id, { other_costs: parseFloat((e.target as HTMLInputElement).value) || 0 });
    renderDetail(o.id);
  });

  // Drag & drop
  initOfferDragDrop(page, o.id);

  // Bulk select
  initBulkSelect(page, o.id);
}


// ─── Drag & drop ─────────────────────────────────────────────────
function initOfferDragDrop(page: HTMLElement, offerId: number): void {
  const tbody = page.querySelector<HTMLTableSectionElement>("tbody");
  if (!tbody) return;

  let dragRow: HTMLTableRowElement | null = null;

  tbody.querySelectorAll<HTMLTableRowElement>("tr[data-item-id]").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      dragRow = row;
      row.classList.add("dragging");
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", row.dataset.itemId!);
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      dragRow = null;
      tbody.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      if (dragRow && row !== dragRow) {
        tbody.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
        row.classList.add("drag-over");
      }
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (!dragRow || row === dragRow) return;
      const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>("tr[data-item-id]"));
      const fromIdx = rows.indexOf(dragRow);
      const toIdx = rows.indexOf(row);
      if (fromIdx < toIdx) row.after(dragRow); else row.before(dragRow);
      const newOrder = Array.from(tbody.querySelectorAll<HTMLTableRowElement>("tr[data-item-id]")).map((r) => parseInt(r.dataset.itemId!));
      reorderOfferItems(offerId, newOrder);
      renderDetail(offerId);
    });
  });
}

// ─── Bulk select ────────────────────────────────────────────────
function initBulkSelect(page: HTMLElement, offerId: number): void {
  const checkAll = page.querySelector<HTMLInputElement>("#bulk-check-all");

  checkAll?.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    page.querySelectorAll<HTMLInputElement>(".bulk-check").forEach((cb) => { cb.checked = checked; });
    updateBulkToolbar(page);
  });

  page.querySelectorAll<HTMLInputElement>(".bulk-check").forEach((cb) => {
    cb.addEventListener("change", () => updateBulkToolbar(page));
    cb.addEventListener("click", (e) => e.stopPropagation());
  });

  checkAll?.addEventListener("click", (e) => e.stopPropagation());

  page.querySelector("#btn-bulk-delete")?.addEventListener("click", () => {
    const checked = page.querySelectorAll<HTMLInputElement>(".bulk-check:checked");
    const count = checked.length;
    if (count === 0) return;

    const label = count === 1 ? "pozycję" : count < 5 ? "pozycje" : "pozycji";

    dangerModal(`Czy na pewno chcesz usunąć ${count} ${label} z oferty?`).then(async (confirmed) => {
      if (!confirmed) return;
      const ids = Array.from(checked).map((cb) => parseInt(cb.dataset.itemId!));
      ids.forEach((id) => removeOfferItem(offerId, id));
      showToast(`Usunięto ${count} pozycji`);
      renderDetail(offerId);
    });
  });
}

function updateBulkToolbar(page: HTMLElement): void {
  const checked = page.querySelectorAll<HTMLInputElement>(".bulk-check:checked");
  const toolbar = page.querySelector("#bulk-toolbar");
  const count = page.querySelector("#bulk-count");

  if (checked.length > 0) {
    toolbar?.classList.remove("hidden");
    if (count) count.textContent = `Zaznaczono: ${checked.length}`;
  } else {
    toolbar?.classList.add("hidden");
  }
}

// ═══════════════════════════════════════════════════════════════════
// ADD OFFER ITEM MODAL
// ═══════════════════════════════════════════════════════════════════
function openAddOfferItemModal(offerId: number): void {
  const o = getOfferById(offerId);
  if (!o) return;

  openModal(`
    <h2 class="modal-title">Dodaj pozycję</h2>
    <div class="item-tabs">
      <button class="item-tab active" data-oitab="search"><i class="fa-solid fa-magnifying-glass"></i> Z cennika</button>
      <button class="item-tab" data-oitab="manual"><i class="fa-solid fa-pen"></i> Ręcznie</button>
    </div>
    <div id="offer-item-tab-content"></div>
    <div class="modal-footer">
      <button class="btn" id="btn-oi-cancel">Zamknij</button>
    </div>
  `);

  document.getElementById("btn-oi-cancel")!.addEventListener("click", closeModal);

  document.querySelectorAll<HTMLButtonElement>(".item-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".item-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      renderOfferItemTab(tab.dataset.oitab!, offerId);
    });
  });

  renderOfferItemTab("search", offerId);
}

function renderOfferItemTab(tab: string, offerId: number): void {
  const container = document.getElementById("offer-item-tab-content")!;
  if (tab === "search") renderSearchProductTab(container, offerId);
  else if (tab === "manual") renderManualItemTab(container, offerId);
}

function renderSearchProductTab(container: HTMLElement, offerId: number): void {
  container.innerHTML = `
    <div class="field" style="margin-top:14px">
      <input type="text" id="offer-item-search" placeholder="Szukaj w Moich Produktach..." />
    </div>
    <div id="offer-item-results" class="item-search-results"></div>
  `;

  const input = document.getElementById("offer-item-search") as HTMLInputElement;
  const resultsEl = document.getElementById("offer-item-results")!;
  renderProductSearchResults(resultsEl, "", offerId);

  let timeout: ReturnType<typeof setTimeout>;
  input.addEventListener("input", () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => renderProductSearchResults(resultsEl, input.value.trim(), offerId), 150);
  });
  setTimeout(() => input.focus(), 50);
}

function renderProductSearchResults(container: HTMLElement, query: string, offerId: number): void {
  const products = getProducts({ search: query || undefined }).slice(0, 20);
  const o = getOfferById(offerId);
  if (!o) return;

  if (products.length === 0) {
    container.innerHTML = `<div class="cell-muted" style="padding:20px;text-align:center">Brak wyników. Dodaj pozycję ręcznie w zakładce obok.</div>`;
    return;
  }

  container.innerHTML = products.map((p) => `
    <div class="search-result-item" data-product-id="${p.id}">
      <div style="flex:1">
        <div style="font-weight:600">${esc(p.name)}</div>
        <div class="cell-muted" style="font-size:11px">${esc(p.unit)}</div>
        ${p.sku ? `<div class="cell-muted" style="font-size:10px">SKU: ${esc(p.sku)}</div>` : ""}
      </div>
      <div style="text-align:right;font-weight:600;color:var(--accent)">${formatPrice(p.purchase_price)} zł</div>
    </div>
  `).join("");

  container.querySelectorAll<HTMLElement>(".search-result-item").forEach((item) => {
    item.addEventListener("click", () => {
      const p = getProductById(parseInt(item.dataset.productId!));
      if (!p) return;
      const margin = o.global_margin || 0;
      addOfferItem(offerId, {
        product_id: p.id,
        name: p.name,
        unit: p.unit,
        quantity: 1,
        purchase_price: p.purchase_price,
        offer_price: Math.round(p.purchase_price * (1 + margin / 100) * 100) / 100,
        vat_rate: p.vat_rate,
        margin_percent: margin,
        matched: true,
        notes: "",
      });
      showToast(`Dodano: ${p.name}`);
      closeModal();
      renderDetail(offerId);
    });
  });
}

function renderManualItemTab(container: HTMLElement, offerId: number): void {
  const o = getOfferById(offerId);
  if (!o) return;

  container.innerHTML = `
    <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="field">
        <label>Nazwa*</label>
        <input type="text" id="f-oi-name" placeholder="Nazwa produktu" />
        <div id="ac-dropdown" class="autocomplete-dropdown" style="display:none;position:absolute;max-height:200px;overflow-y:auto"></div>
      </div>
      <div class="field">
        <label>Jednostka</label>
        <select id="f-oi-unit">
          <option value="szt">szt</option>
          <option value="kg">kg</option>
          <option value="l">l</option>
          <option value="m">m</option>
          <option value="m2">m²</option>
          <option value="opak">opak</option>
          <option value="godz">godz</option>
          <option value="suw">suw</option>
          <option value="kpl">kpl</option>
        </select>
      </div>
      <div class="field">
        <label>Ilość*</label>
        <input type="number" id="f-oi-qty" value="1" min="0" step="1" />
      </div>
      <div class="field">
        <label>Cena zakupu*</label>
        <input type="number" id="f-oi-purchase" value="0" min="0" step="0.01" />
      </div>
      <div class="field">
        <label>Marża (%)</label>
        <input type="number" id="f-oi-margin" value="${o.global_margin}" min="0" step="0.5" />
      </div>
      <div class="field">
        <label>VAT</label>
        <select id="f-oi-vat">
          <option value="0">0%</option>
          <option value="5">5%</option>
          <option value="8">8%</option>
          <option value="23" selected>23%</option>
        </select>
      </div>
      <div class="field" style="grid-column:1/-1">
        <label>Notatki</label>
        <textarea id="f-oi-notes" placeholder="Dodatkowe informacje..." rows="2"></textarea>
      </div>
    </div>
    <div class="modal-footer" style="margin-top:16px">
      <button class="btn" id="btn-oi-save"><i class="fa-solid fa-plus"></i> Dodaj pozycję</button>
    </div>
  `;

  const nameInput = document.getElementById("f-oi-name") as HTMLInputElement;
  const acDropdown = document.getElementById("ac-dropdown")!;

  // Autocomplete for product name
  nameInput.addEventListener("input", () => {
    const query = nameInput.value.trim().toLowerCase();
    if (query.length < 2) { acDropdown.style.display = "none"; return; }

    const matching = getProducts({ search: query }).slice(0, 5);
    if (matching.length === 0) { acDropdown.style.display = "none"; return; }

    acDropdown.innerHTML = matching.map((p) =>
      `<div class="autocomplete-item" data-ac-product="${p.id}">${esc(p.name)}<span class="cell-muted" style="font-size:10px"> (${formatPrice(p.purchase_price)} zł)</span></div>`
    ).join("");
    acDropdown.style.display = "block";

    acDropdown.querySelectorAll<HTMLElement>(".autocomplete-item").forEach((el) => {
      el.addEventListener("click", () => {
        const p = getProductById(parseInt(el.dataset.acProduct!));
        if (!p) return;
        nameInput.value = p.name;
        (document.getElementById("f-oi-unit") as HTMLSelectElement).value = p.unit;
        (document.getElementById("f-oi-purchase") as HTMLInputElement).value = String(p.purchase_price);
        (document.getElementById("f-oi-vat") as HTMLSelectElement).value = String(p.vat_rate);
        const margin = parseFloat((document.getElementById("f-oi-margin") as HTMLInputElement).value) || 0;
        const offerPrice = Math.round(p.purchase_price * (1 + margin / 100) * 100) / 100;
        (document.getElementById("f-oi-purchase") as HTMLInputElement).value = String(p.purchase_price);
        acDropdown.style.display = "none";
      });
    });
  });

  // Hide autocomplete on blur (with delay for click events)
  nameInput.addEventListener("blur", () => {
    setTimeout(() => { acDropdown.style.display = "none"; }, 200);
  });

  document.getElementById("btn-oi-save")!.addEventListener("click", () => {
    const name = (document.getElementById("f-oi-name") as HTMLInputElement).value.trim();
    if (!name) { (document.getElementById("f-oi-name") as HTMLInputElement).focus(); return; }

    const purchase = parseFloat((document.getElementById("f-oi-purchase") as HTMLInputElement).value) || 0;
    const margin = parseFloat((document.getElementById("f-oi-margin") as HTMLInputElement).value) || 0;

    addOfferItem(offerId, {
      product_id: null,
      name,
      unit: (document.getElementById("f-oi-unit") as HTMLSelectElement).value,
      quantity: parseFloat((document.getElementById("f-oi-qty") as HTMLInputElement).value) || 1,
      purchase_price: purchase,
      offer_price: Math.round(purchase * (1 + margin / 100) * 100) / 100,
      vat_rate: parseInt((document.getElementById("f-oi-vat") as HTMLSelectElement).value),
      margin_percent: margin,
      matched: false,
      notes: (document.getElementById("f-oi-notes") as HTMLInputElement).value.trim(),
    });

    showToast(`Dodano: ${name}`);
    closeModal();
    renderDetail(offerId);
  });
}


// ═══════════════════════════════════════════════════════════════════
// EXCEL IMPORT
// ═══════════════════════════════════════════════════════════════════
async function openImportExcelModal(offerId: number): Promise<void> {
  const o = getOfferById(offerId);
  if (!o) return;

  try {
    const filePath = await dialogOpen({
      title: "Wybierz plik Excel lub CSV",
      filters: [
        { name: "Excel / CSV", extensions: ["xlsx", "xls", "csv"] },
      ],
    });

    if (!filePath) return;

    // Read file as binary
    const fileData = await readFile(filePath as string);

    // Dynamically import SheetJS
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(fileData, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (rows.length < 2) {
      showToast("Plik jest pusty lub ma za mało wierszy");
      return;
    }

    // Find header row — look for common column names
    let headerIdx = 0;
    const headerPatterns = {
      lp: /^(lp\.?|l\.?p\.?|nr)$/i,
      name: /(nazwa|opis|przedmiot|asortyment|produkt)/i,
      unit: /(jednostka|jm|j\.m|jedn)/i,
      quantity: /(ilo|szacunkowa)/i,
      // Price columns for round-trip fill
      unit_price_net: /(cena\s*(jedn|netto)|cena\s*za\s*jedn)/i,
      total_net: /(warto[śs][ćc]\s*netto|warto[śs][ćc]\s*og[oó])/i,
      vat_rate: /(stawk[ae]\s*vat|vat\s*%|%\s*vat)/i,
      total_gross: /(warto[śs][ćc]\s*brutto|brutto)/i,
    };

    let colMap = { lp: -1, name: -1, unit: -1, quantity: -1, unit_price_net: -1, total_net: -1, vat_rate: -1, total_gross: -1 };

    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const row = rows[r].map((c: any) => String(c || "").trim());
      let matches = 0;
      const tmpMap = { lp: -1, name: -1, unit: -1, quantity: -1, unit_price_net: -1, total_net: -1, vat_rate: -1, total_gross: -1 };

      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (tmpMap.lp === -1 && headerPatterns.lp.test(cell)) { tmpMap.lp = c; matches++; }
        if (tmpMap.name === -1 && headerPatterns.name.test(cell)) { tmpMap.name = c; matches++; }
        if (tmpMap.unit === -1 && headerPatterns.unit.test(cell)) { tmpMap.unit = c; matches++; }
        if (tmpMap.quantity === -1 && headerPatterns.quantity.test(cell)) { tmpMap.quantity = c; matches++; }
        if (tmpMap.unit_price_net === -1 && headerPatterns.unit_price_net.test(cell)) { tmpMap.unit_price_net = c; }
        if (tmpMap.total_net === -1 && headerPatterns.total_net.test(cell)) { tmpMap.total_net = c; }
        if (tmpMap.vat_rate === -1 && headerPatterns.vat_rate.test(cell)) { tmpMap.vat_rate = c; }
        if (tmpMap.total_gross === -1 && headerPatterns.total_gross.test(cell)) { tmpMap.total_gross = c; }
      }

      if (matches >= 2) {
        headerIdx = r;
        colMap = tmpMap;
        break;
      }
    }

    // If no name column found, try first large text column
    if (colMap.name === -1) {
      showToast("Nie znaleziono kolumny z nazwami pozycji");
      return;
    }

    // Extract original filename from path
    const pathStr = String(filePath);
    const originalFilename = pathStr.split(/[/\\]/).pop() || "formularz.xlsx";

    // Store source Excel data for round-trip
    const sourceExcel: import("./types").SourceExcelData = {
      filename: originalFilename,
      header_row: headerIdx,
      data_start_row: headerIdx + 1,
      col_map: colMap,
      raw_data: rows,
      sheet_name: sheetName,
    };

    // Save source_excel on the offer
    updateOffer(offerId, {} as any);
    const offerRef = getOfferById(offerId);
    if (offerRef) {
      offerRef.source_excel = sourceExcel;
    }

    // Parse data rows
    interface ImportRow {
      lp: string;
      name: string;
      unit: string;
      quantity: number;
      match: { product: any; score: number } | null;
    }

    const importRows: ImportRow[] = [];

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const name = String(row[colMap.name] || "").trim();
      if (!name || name.length < 2) continue;

      const unit = colMap.unit >= 0 ? String(row[colMap.unit] || "").trim() : "szt";
      const quantity = colMap.quantity >= 0 ? parseFloat(String(row[colMap.quantity] || "0").replace(",", ".")) || 0 : 1;
      const lp = colMap.lp >= 0 ? String(row[colMap.lp] || "") : String(importRows.length + 1);

      const match = fuzzyMatchProduct(name);

      importRows.push({ lp, name, unit, quantity, match });
    }

    if (importRows.length === 0) {
      showToast("Nie znaleziono pozycji do zaimportowania");
      return;
    }

    // Show mapping modal
    showImportMappingModal(offerId, importRows);

  } catch (err) {
    console.error("Excel import error:", err);
    showToast("Błąd importu pliku");
  }
}

interface ImportRow {
  lp: string;
  name: string;
  unit: string;
  quantity: number;
  match: { product: any; score: number } | null;
}

function showImportMappingModal(offerId: number, importRows: ImportRow[]): void {
  const o = getOfferById(offerId);
  if (!o) return;

  const rows = importRows.map((row, idx) => {
    const matchStatus = row.match
      ? (row.match.score >= 0.8 ? "matched" : "suggested")
      : "not-found";
    const statusIcon = matchStatus === "matched"
      ? '<span style="color:var(--success)"><i class="fa-solid fa-circle-check"></i></span>'
      : matchStatus === "suggested"
        ? '<span style="color:var(--warning)"><i class="fa-solid fa-circle-question"></i></span>'
        : '<span style="color:var(--danger)"><i class="fa-solid fa-circle-xmark"></i></span>';
    const productName = row.match ? row.match.product.name : "";

    return `<tr>
      <td class="cell-lp">${esc(row.lp)}</td>
      <td><strong>${esc(row.name)}</strong></td>
      <td><span class="cell-unit">${esc(row.unit)}</span></td>
      <td class="cell-mono">${row.quantity}</td>
      <td>${statusIcon}</td>
      <td>
        <span class="cell-muted">${productName ? esc(productName) : "—"}</span>
        ${row.match ? `<span class="cell-mono" style="font-size:10px"> (${formatPrice(row.match.product.purchase_price)} zł)</span>` : ""}
        ${!row.match ? `<button class="btn btn-sm" style="font-size:10px;padding:2px 6px;margin-left:4px" data-add-to-catalog="${idx}" title="Dodaj do cennika"><i class="fa-solid fa-plus"></i></button>` : ""}
      </td>
      <td><input type="checkbox" data-import-check="${idx}" checked /></td>
    </tr>`;
  }).join("");

  const matched = importRows.filter((r) => r.match && r.match.score >= 0.8).length;
  const suggested = importRows.filter((r) => r.match && r.match.score < 0.8).length;
  const notFound = importRows.filter((r) => !r.match).length;

  openModal(`
    <h2 class="modal-title"><i class="fa-solid fa-file-excel"></i> Import z Excela — mapowanie</h2>
    <div style="display:flex;gap:12px;margin-bottom:12px;font-size:12px">
      <span style="color:var(--success)"><i class="fa-solid fa-circle-check"></i> Dopasowane: ${matched}</span>
      <span style="color:var(--warning)"><i class="fa-solid fa-circle-question"></i> Sugestie: ${suggested}</span>
      <span style="color:var(--danger)"><i class="fa-solid fa-circle-xmark"></i> Brak: ${notFound}</span>
    </div>
    <div style="max-height:70vh;overflow-y:auto">
      <table class="data-table">
        <thead><tr>
          <th>Lp.</th>
          <th>Nazwa z pliku</th>
          <th>Jedn.</th>
          <th>Ilość</th>
          <th></th>
          <th>Produkt z cennika</th>
          <th style="width:30px"><input type="checkbox" id="import-check-all" checked /></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="modal-footer">
      ${notFound > 0 ? `<button class="btn btn-sm" id="btn-add-missing-to-catalog" style="margin-right:auto"><i class="fa-solid fa-plus"></i> Dodaj brakujące do cennika (${notFound})</button>` : ""}
      <button class="btn" id="btn-import-cancel">Anuluj</button>
      <button class="btn btn-primary" id="btn-import-add"><i class="fa-solid fa-plus"></i> Dodaj do oferty</button>
    </div>
  `, "modal-lg");

  // Check all toggle
  document.getElementById("import-check-all")?.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    document.querySelectorAll<HTMLInputElement>("[data-import-check]").forEach((cb) => { cb.checked = checked; });
  });

  // Stop propagation on all checkboxes so clicks work
  document.querySelectorAll<HTMLInputElement>("[data-import-check], #import-check-all").forEach((cb) => {
    cb.addEventListener("click", (e) => e.stopPropagation());
  });

  document.getElementById("btn-import-cancel")!.addEventListener("click", closeModal);

  // Individual "add to catalog" buttons
  document.querySelectorAll<HTMLButtonElement>("[data-add-to-catalog]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.addToCatalog!);
      const row = importRows[idx];
      addProduct({
        name: row.name,
        unit: row.unit || "szt",
        purchase_price: 0,
        catalog_price: 0,
        vat_rate: 23,
        category_id: null,
        ean: "",
        sku: "",
        supplier: "",
        min_order: "",
        notes: "Uzupełnij cenę zakupu",
      });
      btn.innerHTML = '<i class="fa-solid fa-check" style="color:var(--success)"></i>';
      btn.disabled = true;
      showToast(`Dodano do cennika: ${row.name}`);
    });
  });

  // Batch "add missing to catalog"
  document.getElementById("btn-add-missing-to-catalog")?.addEventListener("click", () => {
    let addedCount = 0;
    importRows.forEach((row) => {
      if (!row.match) {
        addProduct({
          name: row.name,
          unit: row.unit || "szt",
          purchase_price: 0,
          catalog_price: 0,
          vat_rate: 23,
          category_id: null,
          ean: "",
          sku: "",
          supplier: "",
          min_order: "",
          notes: "Uzupełnij cenę zakupu",
        });
        addedCount++;
      }
    });
    showToast(`Dodano ${addedCount} produktów do cennika`);
    // Disable individual buttons
    document.querySelectorAll<HTMLButtonElement>("[data-add-to-catalog]").forEach((btn) => {
      btn.innerHTML = '<i class="fa-solid fa-check" style="color:var(--success)"></i>';
      btn.disabled = true;
    });
    const batchBtn = document.getElementById("btn-add-missing-to-catalog") as HTMLButtonElement;
    if (batchBtn) { batchBtn.disabled = true; batchBtn.textContent = "Dodano"; }
  });

  document.getElementById("btn-import-add")!.addEventListener("click", () => {
    let added = 0;
    const margin = o.global_margin || 0;

    importRows.forEach((row, idx) => {
      const cb = document.querySelector<HTMLInputElement>(`[data-import-check="${idx}"]`);
      if (!cb?.checked) return;

      if (row.match) {
        const p = row.match.product;
        addOfferItem(offerId, {
          product_id: p.id,
          name: row.name,
          unit: row.unit || p.unit,
          quantity: row.quantity || 1,
          purchase_price: p.purchase_price,
          offer_price: Math.round(p.purchase_price * (1 + margin / 100) * 100) / 100,
          vat_rate: p.vat_rate,
          margin_percent: margin,
          matched: row.match.score >= 0.8,
          notes: "",
        });
      } else {
        addOfferItem(offerId, {
          product_id: null,
          name: row.name,
          unit: row.unit || "szt",
          quantity: row.quantity || 1,
          purchase_price: 0,
          offer_price: 0,
          vat_rate: 23,
          margin_percent: margin,
          matched: false,
          notes: "Brak w cenniku — uzupełnij cenę",
        });
      }
      added++;
    });

    closeModal();
    showToast(`Zaimportowano ${added} pozycji`);
    renderDetail(offerId);
  });
}

// ═══════════════════════════════════════════════════════════════════
// FILL SOURCE EXCEL (Round-Trip)
// ═══════════════════════════════════════════════════════════════════
async function fillSourceExcel(o: Offer): Promise<void> {
  if (!o.source_excel) return;

  const XLSX = await import("xlsx");
  const src = o.source_excel;

  // Reconstruct workbook from raw data
  const ws = XLSX.utils.aoa_to_sheet(src.raw_data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, src.sheet_name);

  // Match offer items to Excel rows by name (fuzzy)
  let filled = 0;
  const totalExcelRows = src.raw_data.length - src.data_start_row;
  const dataRows = totalExcelRows > 0 ? totalExcelRows : 0;

  for (let rowIdx = src.data_start_row; rowIdx < src.raw_data.length; rowIdx++) {
    const excelRow = src.raw_data[rowIdx];
    if (!excelRow || excelRow.length === 0) continue;

    const excelName = String(excelRow[src.col_map.name] || "").trim().toLowerCase();
    if (!excelName || excelName.length < 2) continue;

    // Find best matching offer item
    let bestItem: typeof o.items[0] | null = null;
    let bestScore = 0;

    for (const item of o.items) {
      const itemName = item.name.toLowerCase();

      // Exact match
      if (itemName === excelName) { bestItem = item; bestScore = 1; break; }

      // Contains match
      if (itemName.includes(excelName) || excelName.includes(itemName)) {
        if (0.8 > bestScore) { bestScore = 0.8; bestItem = item; }
        continue;
      }

      // Word overlap
      const qWords = excelName.split(/\s+/);
      const pWords = itemName.split(/\s+/);
      let matches = 0;
      for (const qw of qWords) {
        if (pWords.some((pw) => pw.includes(qw) || qw.includes(pw))) matches++;
      }
      const score = qWords.length > 0 ? matches / Math.max(qWords.length, pWords.length) : 0;
      if (score > bestScore) { bestScore = score; bestItem = item; }
    }

    if (!bestItem || bestScore < 0.3) continue;

    // Fill price columns
    if (src.col_map.unit_price_net >= 0) {
      ws[XLSX.utils.encode_cell({ r: rowIdx, c: src.col_map.unit_price_net })] = {
        t: "n", v: bestItem.offer_price,
      };
    }

    if (src.col_map.total_net >= 0) {
      ws[XLSX.utils.encode_cell({ r: rowIdx, c: src.col_map.total_net })] = {
        t: "n", v: bestItem.offer_price * bestItem.quantity,
      };
    }

    if (src.col_map.vat_rate >= 0) {
      ws[XLSX.utils.encode_cell({ r: rowIdx, c: src.col_map.vat_rate })] = {
        t: "n", v: bestItem.vat_rate || 23,
      };
    }

    if (src.col_map.total_gross >= 0) {
      const vatRate = bestItem.vat_rate || 23;
      const bruttoVal = bestItem.offer_price * bestItem.quantity * (1 + vatRate / 100);
      ws[XLSX.utils.encode_cell({ r: rowIdx, c: src.col_map.total_gross })] = {
        t: "n", v: Math.round(bruttoVal * 100) / 100,
      };
    }

    filled++;
  }

  // Set column widths from ref
  if (ws["!ref"]) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    ws["!cols"] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      ws["!cols"].push({ wch: 15 });
    }
  }

  // Save via Tauri dialog
  const defaultName = src.filename.replace(/\.xlsx?$/i, "_wypelniony.xlsx");

  try {
    const filePath = await save({
      title: "Zapisz wypełniony formularz",
      defaultPath: defaultName,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });

    if (!filePath) return;

    const xlsxData = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const buffer = new Uint8Array(xlsxData);
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(filePath, buffer);

    const notFilled = dataRows - filled;

    openModal(`
      <h2 class="modal-title"><i class="fa-solid fa-file-circle-check" style="color:var(--success)"></i> Formularz wypełniony</h2>
      <p>Wypełniono <strong>${filled}</strong> z <strong>${dataRows}</strong> pozycji cenowych.</p>
      ${notFilled > 0 ? `<p class="cell-muted" style="font-size:12px">${notFilled} pozycji nie znaleziono w ofercie — pozostawiono puste.</p>` : ""}
      <p class="cell-muted" style="font-size:12px;margin-top:8px">Plik zapisano jako: ${esc(defaultName)}</p>
      <div class="modal-footer">
        <button class="btn btn-primary" id="btn-fill-ok">OK</button>
      </div>
    `);
    document.getElementById("btn-fill-ok")!.addEventListener("click", closeModal);

    showToast(`Zapisano: ${filePath}`);
  } catch (err) {
    console.error("Fill Excel error:", err);
    showToast("Błąd zapisu pliku");
  }
}


// ═══════════════════════════════════════════════════════════════════
// PDF EXPORT
// ═══════════════════════════════════════════════════════════════════
async function exportOfferPdf(o: Offer, pdfStyle: string = "modern"): Promise<void> {
  const company = getCompany();
  const totals = calcOfferTotals(o.id);
  const today = new Date().toLocaleDateString("pl-PL", { year: "numeric", month: "long", day: "numeric" });

  const html = buildOfferPdfHtml(o, company, totals, today, pdfStyle);

  const safeName = o.name.replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ _-]/g, "").replace(/\s+/g, "_");
  const defaultName = `Oferta_${safeName}_${new Date().toISOString().slice(0, 10)}`;

  try {
    const filePath = await save({
      title: "Zapisz ofertę cenową",
      defaultPath: `${defaultName}.html`,
      filters: [{ name: "Dokument HTML (otwórz → Drukuj → PDF)", extensions: ["html"] }],
    });
    if (!filePath) return;
    await writeTextFile(filePath, html);
    await shellOpen(filePath);
  } catch (err) {
    console.error("PDF export error:", err);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "width=800,height=1100");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function buildOfferPdfHtml(o: Offer, company: CompanySettings, totals: OfferTotals, today: string, pdfStyle: string = "modern"): string {
  const escH = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const itemRows = o.items.map((item, i) => {
    const lineNetto = item.offer_price * item.quantity;
    const lineBrutto = Math.round(lineNetto * (1 + item.vat_rate / 100) * 100) / 100;

    return `<tr>
      <td class="mono right">${i + 1}</td>
      <td><strong>${escH(item.name)}</strong></td>
      <td>${escH(item.unit)}</td>
      <td class="mono right">${item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(2).replace(".", ",")}</td>
      <td class="mono right">${formatPrice(item.offer_price)}</td>
      <td class="mono right">${formatPrice(lineNetto)}</td>
      <td class="right">${item.vat_rate}%</td>
      <td class="mono right"><strong>${formatPrice(lineBrutto)}</strong></td>
    </tr>`;
  }).join("");

  const companyDetails: string[] = [];
  if (company.nip) companyDetails.push(`NIP: ${company.nip}`);
  const addr = [company.address, [company.zip, company.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (addr) companyDetails.push(addr);
  const contact = [company.phone, company.email].filter(Boolean).join(" • ");
  if (contact) companyDetails.push(contact);
  if (company.website) companyDetails.push(company.website);

  // Style-specific colors and styling
  let accentColor = "#667eea";
  let headerBg = "#667eea";
  let infoBg = "#f7f8fc";
  let infoAccent = "#667eea";

  if (pdfStyle === "formal") {
    accentColor = "#2c3e50";
    headerBg = "#2c3e50";
    infoBg = "#ecf0f1";
    infoAccent = "#34495e";
  } else if (pdfStyle === "minimal") {
    accentColor = "#333333";
    headerBg = "#333333";
    infoBg = "#fafafa";
    infoAccent = "#666666";
  }
  // "modern" uses default values

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<title>Oferta cenowa — ${escH(o.name)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm 16mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', -apple-system, Arial, sans-serif; font-size: 10px; line-height: 1.45; color: #1a1a2e; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid ${headerBg}; }
  .header-left { max-width: 55%; }
  .header-right { text-align: right; max-width: 40%; }
  .company-logo { max-width: 140px; max-height: 60px; object-fit: contain; margin-bottom: 6px; }
  .company-name { font-size: 16px; font-weight: 700; color: #1a1a2e; }
  .company-detail { font-size: 9px; color: #555; line-height: 1.6; }
  .doc-title { font-size: 20px; font-weight: 700; color: ${accentColor}; margin-bottom: 4px; }
  .doc-date { font-size: 9px; color: #777; }
  .doc-number { font-size: 9px; color: #777; margin-top: 2px; }
  .info-box { display: flex; gap: 24px; margin-bottom: 20px; }
  .info-card { flex: 1; background: ${infoBg}; border-radius: 6px; padding: 12px 14px; }
  .info-label { font-size: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 4px; }
  .info-value { font-size: 11px; font-weight: 500; }
  .info-sub { font-size: 9px; color: #666; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  thead th { background: ${headerBg}; color: #fff; font-weight: 600; padding: 7px 8px; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.04em; text-align: left; }
  thead th:first-child { border-radius: 4px 0 0 0; }
  thead th:last-child { border-radius: 0 4px 0 0; }
  thead th.right { text-align: right; }
  tbody td { padding: 6px 8px; font-size: 9.5px; border-bottom: 1px solid #eee; vertical-align: top; }
  tbody tr:nth-child(even) { background: ${pdfStyle === "minimal" ? "#fafafa" : "#fafbfe"}; }
  .mono { font-family: 'SF Mono', 'Cascadia Mono', 'Consolas', monospace; }
  .right { text-align: right; }
  .totals-wrap { display: flex; justify-content: flex-end; }
  .totals { width: 280px; }
  .totals-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 10px; }
  .totals-row.sub { color: #666; font-size: 9px; }
  .totals-final { border-top: 2px solid #1a1a2e; padding-top: 8px; margin-top: 4px; font-size: 13px; font-weight: 700; }
  .footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; }
  .footer-col { font-size: 8.5px; color: #888; line-height: 1.6; }
  .footer-col strong { color: #555; }
  .notes { margin-top: 20px; padding: 10px 14px; background: ${infoBg}; border-radius: 6px; font-size: 9px; color: #555; }
  .notes-label { font-weight: 600; font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin-bottom: 3px; }
  .print-banner { background: ${accentColor}; color: #fff; padding: 12px 24px; text-align: center; font-size: 13px; margin-bottom: 20px; border-radius: 6px; }
  .print-banner a { color: #fff; font-weight: 700; text-decoration: underline; cursor: pointer; }
  @media print { .print-banner { display: none; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>

<div class="print-banner">
  Aby zapisać jako PDF: <a onclick="window.print()">Kliknij tutaj</a> lub użyj <strong>Ctrl+P</strong> → "Zapisz jako PDF"
</div>

<div class="header">
  <div class="header-left">
    ${company.logo ? `<img src="${company.logo}" class="company-logo" /><br>` : ""}
    ${company.name ? `<div class="company-name">${escH(company.name)}</div>` : ""}
    ${companyDetails.length ? `<div class="company-detail">${companyDetails.map(l => escH(l)).join("<br>")}</div>` : ""}
  </div>
  <div class="header-right">
    <div class="doc-title">OFERTA CENOWA</div>
    <div class="doc-date">${today}</div>
    <div class="doc-number">Nr: PP/${o.id}/${new Date().getFullYear()}</div>
  </div>
</div>

<div class="info-box">
  <div class="info-card">
    <div class="info-label">Przetarg</div>
    <div class="info-value">${escH(o.name)}</div>
    ${o.reference_number ? `<div class="info-sub">Nr ref.: ${escH(o.reference_number)}</div>` : ""}
  </div>
  <div class="info-card">
    <div class="info-label">Zamawiający</div>
    <div class="info-value">${escH(o.client || "—")}</div>
  </div>
  <div class="info-card">
    <div class="info-label">Wartość brutto</div>
    <div class="info-value" style="color:${infoAccent};font-size:14px">${formatPrice(totals.totalOfferBrutto)} zł</div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:28px">Lp.</th>
      <th>Nazwa</th>
      <th style="width:40px">Jedn.</th>
      <th class="right" style="width:50px">Ilość</th>
      <th class="right" style="width:75px">Cena jedn. netto</th>
      <th class="right" style="width:80px">Wartość netto</th>
      <th class="right" style="width:36px">VAT</th>
      <th class="right" style="width:80px">Wartość brutto</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
</table>

<div class="totals-wrap">
  <div class="totals">
    <div class="totals-row">
      <span>Razem netto:</span>
      <span class="mono">${formatPrice(totals.totalOffer)} zł</span>
    </div>
    <div class="totals-row sub">
      <span>VAT:</span>
      <span class="mono">${formatPrice(totals.totalVat)} zł</span>
    </div>
    <div class="totals-row totals-final">
      <span>RAZEM BRUTTO:</span>
      <span class="mono">${formatPrice(totals.totalOfferBrutto)} zł</span>
    </div>
  </div>
</div>

${(o.delivery_start || o.delivery_end || o.deadline) ? `
<div class="info-box" style="margin-top:16px">
  ${o.deadline ? `<div class="info-card">
    <div class="info-label">Termin składania ofert</div>
    <div class="info-value">${new Date(o.deadline + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" })}</div>
  </div>` : ""}
  ${(o.delivery_start || o.delivery_end) ? `<div class="info-card">
    <div class="info-label">Okres dostaw</div>
    <div class="info-value">${[
      o.delivery_start ? new Date(o.delivery_start + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" }) : "",
      o.delivery_end ? new Date(o.delivery_end + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" }) : ""
    ].filter(Boolean).join(" — ")}</div>
  </div>` : ""}
  ${(o.transport_cost + o.storage_cost + o.other_costs > 0) ? `<div class="info-card">
    <div class="info-label">Koszty logistyczne</div>
    <div class="info-value">${formatPrice(o.transport_cost + o.storage_cost + o.other_costs)} zł netto</div>
    <div class="info-sub">${[
      o.transport_cost ? "Transport: " + formatPrice(o.transport_cost) + " zł" : "",
      o.storage_cost ? "Magazyn: " + formatPrice(o.storage_cost) + " zł" : "",
      o.other_costs ? "Inne: " + formatPrice(o.other_costs) + " zł" : ""
    ].filter(Boolean).join(" • ")}</div>
  </div>` : ""}
</div>` : ""}

${o.notes ? `<div class="notes"><div class="notes-label">Uwagi</div>${escH(o.notes)}</div>` : ""}

${company.name || company.phone || company.email ? `
<div class="footer">
  <div class="footer-col">
    ${company.name ? `<strong>${escH(company.name)}</strong><br>` : ""}
    ${company.nip ? `NIP: ${escH(company.nip)}<br>` : ""}
    ${addr || ""}
  </div>
  ${(company.phone || company.email || company.website) ? `<div class="footer-col">
    ${company.phone ? `tel. ${escH(company.phone)}<br>` : ""}
    ${company.email ? `${escH(company.email)}<br>` : ""}
    ${company.website ? `${escH(company.website)}` : ""}
  </div>` : ""}
  ${(company.bank_name || company.bank_account) ? `<div class="footer-col">
    <strong>Dane do przelewu:</strong><br>
    ${company.bank_name ? `${escH(company.bank_name)}<br>` : ""}
    ${company.bank_account ? escH(company.bank_account) : ""}
  </div>` : ""}
</div>
` : ""}

</body>
</html>`;
}

// ─── CSV Export ──────────────────────────────────────────────────
async function exportOfferCsv(o: Offer): Promise<void> {
  const totals = calcOfferTotals(o.id);
  const sep = ";";

  const csvCell = (val: string | number): string => {
    const s = String(val);
    if (s.includes(sep) || s.includes('"') || s.includes("\n")) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const priceCell = (val: number): string => val.toFixed(2).replace(".", ",");

  const lines: string[] = [];
  lines.push(`Oferta:${sep}${csvCell(o.name)}`);
  if (o.client) lines.push(`Zamawiający:${sep}${csvCell(o.client)}`);
  if (o.reference_number) lines.push(`Nr ref.:${sep}${csvCell(o.reference_number)}`);
  lines.push("");

  const headers = ["Lp.", "Nazwa", "Jedn.", "Ilość", "Cena jedn. netto", "Wartość netto", "VAT %", "Wartość brutto"];
  lines.push(headers.map(csvCell).join(sep));

  o.items.forEach((item, i) => {
    const lineNetto = item.offer_price * item.quantity;
    const lineBrutto = Math.round(lineNetto * (1 + item.vat_rate / 100) * 100) / 100;
    lines.push([
      String(i + 1), csvCell(item.name), item.unit, priceCell(item.quantity),
      priceCell(item.offer_price), priceCell(lineNetto), `${item.vat_rate}%`, priceCell(lineBrutto),
    ].join(sep));
  });

  lines.push("");
  lines.push(`${sep}${sep}${sep}${sep}${sep}Razem netto:${sep}${priceCell(totals.totalOffer)}`);
  lines.push(`${sep}${sep}${sep}${sep}${sep}VAT:${sep}${priceCell(totals.totalVat)}`);
  lines.push(`${sep}${sep}${sep}${sep}${sep}Razem brutto:${sep}${priceCell(totals.totalOfferBrutto)}`);

  const bom = "\uFEFF";
  const csv = bom + lines.join("\r\n");
  const safeName = o.name.replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ _-]/g, "_");

  try {
    const filePath = await save({
      title: "Zapisz CSV",
      defaultPath: `${safeName}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;
    await writeTextFile(filePath, csv);
    showToast("CSV wyeksportowany");
  } catch (err) {
    console.error("CSV export error:", err);
  }
}


// ═══════════════════════════════════════════════════════════════════
// OFFER COMPARISON
// ═══════════════════════════════════════════════════════════════════
function openCompareModal(allOffers: Offer[]): void {
  const offerOptions = allOffers.map((o) =>
    `<option value="${o.id}">${esc(o.name)}</option>`
  ).join("");

  openModal(`
    <h2 class="modal-title"><i class="fa-solid fa-scale-balanced"></i> Porównanie ofert</h2>
    <div class="field-row field-row-2">
      <div class="field">
        <label>Oferta A</label>
        <select id="cmp-offer-a">${offerOptions}</select>
      </div>
      <div class="field">
        <label>Oferta B</label>
        <select id="cmp-offer-b">${allOffers.length > 1 ? allOffers.map((o, i) =>
          `<option value="${o.id}"${i === 1 ? " selected" : ""}>${esc(o.name)}</option>`
        ).join("") : offerOptions}</select>
      </div>
    </div>
    <div id="cmp-result" style="margin-top:16px"></div>
    <div class="modal-footer">
      <button class="btn" id="btn-cmp-close">Zamknij</button>
      <button class="btn btn-primary" id="btn-cmp-run"><i class="fa-solid fa-scale-balanced"></i> Porównaj</button>
    </div>
  `, "modal-lg");

  document.getElementById("btn-cmp-close")!.addEventListener("click", closeModal);
  document.getElementById("btn-cmp-run")!.addEventListener("click", () => {
    const aId = parseInt((document.getElementById("cmp-offer-a") as HTMLSelectElement).value);
    const bId = parseInt((document.getElementById("cmp-offer-b") as HTMLSelectElement).value);
    renderComparison(aId, bId);
  });

  // Auto-run comparison
  if (allOffers.length >= 2) {
    renderComparison(allOffers[0].id, allOffers[1].id);
  }
}

function renderComparison(aId: number, bId: number): void {
  const a = getOfferById(aId);
  const b = getOfferById(bId);
  if (!a || !b) return;

  const ta = calcOfferTotals(aId);
  const tb = calcOfferTotals(bId);

  const cmpCell = (va: number, vb: number, isCost = false): string => {
    const diff = va - vb;
    const better = isCost ? diff < 0 : diff > 0;
    const colorA = diff === 0 ? "" : (better ? "color:var(--success);font-weight:600" : "color:var(--danger)");
    const colorB = diff === 0 ? "" : (!better ? "color:var(--success);font-weight:600" : "color:var(--danger)");
    return `<td class="cell-mono" style="${colorA}">${formatPrice(va)} zł</td>
            <td class="cell-mono" style="${colorB}">${formatPrice(vb)} zł</td>`;
  };

  const result = document.getElementById("cmp-result")!;
  result.innerHTML = `
    <div style="overflow-x:auto">
      <table class="data-table" style="font-size:12px">
        <thead><tr>
          <th>Parametr</th>
          <th style="min-width:140px">${esc(a.name.slice(0, 30))}</th>
          <th style="min-width:140px">${esc(b.name.slice(0, 30))}</th>
        </tr></thead>
        <tbody>
          <tr><td>Pozycje</td><td>${a.items.length}</td><td>${b.items.length}</td></tr>
          <tr><td>Klient</td><td>${esc(a.client || "—")}</td><td>${esc(b.client || "—")}</td></tr>
          <tr><td>Marża globalna</td><td>${a.global_margin}%</td><td>${b.global_margin}%</td></tr>
          <tr><td>Wartość zakupu netto</td>${cmpCell(ta.totalPurchase, tb.totalPurchase, true)}</tr>
          <tr><td>Wartość oferty netto</td>${cmpCell(ta.totalOffer, tb.totalOffer)}</tr>
          <tr><td>Wartość brutto</td>${cmpCell(ta.totalOfferBrutto, tb.totalOfferBrutto)}</tr>
          <tr><td>Marża (kwota)</td>${cmpCell(ta.marginAmount, tb.marginAmount)}</tr>
          <tr><td>Marża (%)</td>
            <td class="cell-mono">${ta.marginPercent.toFixed(1)}%</td>
            <td class="cell-mono">${tb.marginPercent.toFixed(1)}%</td>
          </tr>
          <tr><td>Koszty logistyczne</td>${cmpCell(ta.totalCosts, tb.totalCosts, true)}</tr>
          <tr><td><strong>Zysk netto</strong></td>${cmpCell(ta.netProfit, tb.netProfit)}</tr>
          <tr><td>Zysk miesięczny</td>${cmpCell(ta.monthlyProfit, tb.monthlyProfit)}</tr>
          <tr><td>Status</td>
            <td>${offerStatusBadge(a.status)}</td>
            <td>${offerStatusBadge(b.status)}</td>
          </tr>
          <tr><td>Termin</td>
            <td>${a.deadline || "—"}</td>
            <td>${b.deadline || "—"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
// OFFER TEMPLATES
// ═══════════════════════════════════════════════════════════════════
function openSaveOfferTemplateModal(offerId: number): void {
  openModal(`
    <h2 class="modal-title"><i class="fa-solid fa-bookmark"></i> Zapisz jako szablon oferty</h2>
    <div class="field">
      <label>Nazwa szablonu</label>
      <input type="text" id="f-otmpl-name" placeholder="np. Dostawa art. spożywczych — standard" />
      <div class="field-hint">Szablon zapisze pozycje, marżę i koszty logistyczne.</div>
    </div>
    <div class="modal-footer">
      <button class="btn" id="btn-otmpl-cancel">Anuluj</button>
      <button class="btn btn-primary" id="btn-otmpl-save"><i class="fa-solid fa-bookmark"></i> Zapisz</button>
    </div>
  `, "modal-sm");

  setTimeout(() => (document.getElementById("f-otmpl-name") as HTMLInputElement)?.focus(), 80);
  document.getElementById("btn-otmpl-cancel")!.addEventListener("click", closeModal);

  const save = () => {
    const name = (document.getElementById("f-otmpl-name") as HTMLInputElement).value.trim();
    if (!name) { (document.getElementById("f-otmpl-name") as HTMLInputElement).focus(); return; }
    const tmpl = saveOfferAsTemplate(offerId, name);
    if (tmpl) {
      showToast(`Szablon "${name}" zapisany`);
      closeModal();
    }
  };

  document.getElementById("btn-otmpl-save")!.addEventListener("click", save);
  document.getElementById("modal-box")!.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
  });
}

function openFromOfferTemplateModal(): void {
  const templates = getOfferTemplates();

  if (templates.length === 0) {
    openModal(`
      <h2 class="modal-title">Brak szablonów ofert</h2>
      <p style="color:var(--text-secondary);margin-bottom:16px">Nie masz jeszcze szablonów. Otwórz ofertę i kliknij "Szablon" żeby ją zapisać.</p>
      <div class="modal-footer"><button class="btn" id="btn-otmpl-close">Zamknij</button></div>
    `, "modal-sm");
    document.getElementById("btn-otmpl-close")!.addEventListener("click", closeModal);
    return;
  }

  openModal(`
    <h2 class="modal-title">Nowa oferta z szablonu</h2>
    <div class="field">
      <label>Szablon</label>
      <select id="f-from-otmpl-id">
        ${templates.map((t) => `<option value="${t.id}">${esc(t.name)} (${t.items.length} poz.)</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label>Nazwa oferty</label>
      <input type="text" id="f-from-otmpl-name" placeholder="np. Dostawa do SP nr 12" />
    </div>
    <div class="field">
      <label>Zamawiający</label>
      ${renderClientPicker("f-from-otmpl-client", "")}
    </div>
    <div class="modal-footer">
      <div style="flex:1">
        <button class="btn btn-danger btn-sm" id="btn-otmpl-delete"><i class="fa-solid fa-trash"></i> Usuń szablon</button>
      </div>
      <button class="btn" id="btn-from-otmpl-cancel">Anuluj</button>
      <button class="btn btn-primary" id="btn-from-otmpl-create"><i class="fa-solid fa-plus"></i> Utwórz</button>
    </div>
  `);

  setTimeout(() => (document.getElementById("f-from-otmpl-name") as HTMLInputElement)?.focus(), 80);
  document.getElementById("btn-from-otmpl-cancel")!.addEventListener("click", closeModal);

  document.getElementById("btn-otmpl-delete")!.addEventListener("click", () => {
    const tmplId = parseInt((document.getElementById("f-from-otmpl-id") as HTMLSelectElement).value);
    deleteOfferTemplate(tmplId);
    showToast("Szablon usunięty");
    closeModal();
    openFromOfferTemplateModal();
  });

  const create = () => {
    const name = (document.getElementById("f-from-otmpl-name") as HTMLInputElement).value.trim();
    if (!name) { (document.getElementById("f-from-otmpl-name") as HTMLInputElement).focus(); return; }
    const tmplId = parseInt((document.getElementById("f-from-otmpl-id") as HTMLSelectElement).value);
    const client = (document.getElementById("f-from-otmpl-client") as HTMLInputElement).value.trim();
    if (client) quickAddClientFromName(client);
    const newO = createOfferFromTemplate(tmplId, name, client);
    if (newO) {
      activeOfferId = newO.id;
      offerFormMode = false;
      showToast("Oferta utworzona z szablonu");
      closeModal();
      render();
    }
  };

  document.getElementById("btn-from-otmpl-create")!.addEventListener("click", create);
  document.getElementById("modal-box")!.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") { e.preventDefault(); create(); }
  });
}

// ─── Email offer generation ──────────────────────────────────────
function openEmailOfferModal(o: Offer): void {
  const totals = calcOfferTotals(o.id);
  const company = getCompany();

  const subject = `Oferta: ${o.name}${o.reference_number ? ` (${o.reference_number})` : ""}`;

  const body = `Szanowni Państwo,

W odpowiedzi na zapytanie${o.reference_number ? ` nr ${o.reference_number}` : ""} przesyłam ofertę na: ${o.name}.

Wartość oferty netto: ${formatPrice(totals.totalOffer)} zł
Wartość brutto: ${formatPrice(totals.totalOfferBrutto)} zł
Liczba pozycji: ${o.items.length}
${o.deadline ? `Termin składania: ${new Date(o.deadline + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" })}` : ""}
${o.delivery_start && o.delivery_end ? `Okres dostaw: ${new Date(o.delivery_start + "T12:00:00").toLocaleDateString("pl-PL")} — ${new Date(o.delivery_end + "T12:00:00").toLocaleDateString("pl-PL")}` : ""}

Szczegółowa oferta w załączniku.

Z poważaniem,
${company.name || ""}
${company.phone || ""}
${company.email || ""}`.trim();

  openModal(`
    <h2 class="modal-title"><i class="fa-solid fa-envelope"></i> E-mail oferty</h2>
    <div class="field">
      <label>Temat</label>
      <input type="text" id="email-subject" value="${esc(subject)}" />
    </div>
    <div class="field">
      <label>Treść</label>
      <textarea id="email-body" rows="14" style="font-family:monospace;font-size:12px;line-height:1.5">${esc(body)}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn" id="btn-email-cancel">Zamknij</button>
      <button class="btn btn-primary" id="btn-email-copy"><i class="fa-solid fa-copy"></i> Kopiuj do schowka</button>
    </div>
  `);

  document.getElementById("btn-email-cancel")!.addEventListener("click", closeModal);
  document.getElementById("btn-email-copy")!.addEventListener("click", () => {
    const subj = (document.getElementById("email-subject") as HTMLInputElement).value;
    const bodyText = (document.getElementById("email-body") as HTMLTextAreaElement).value;
    navigator.clipboard.writeText(`Temat: ${subj}\n\n${bodyText}`);
    showToast("Skopiowano do schowka");
  });
}


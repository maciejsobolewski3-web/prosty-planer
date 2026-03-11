// ─── Moduł: Baza Klientów ──────────────────────────────────────
import type { Client } from "./types";
import {
  getClients,
  getClientById,
  addClient,
  updateClient,
  deleteClient,
  getZlecenia,
  type ClientInput,
} from "./store";
import { getOffers } from "./store-trade";
import {
  esc,
  showToast,
  formatPrice,
  brutto,
  formatNIP,
  validateNIPStrict,
  validateEmailStrict,
  validatePhoneStrict,
} from "./ui";
import {
  dpHeader,
  dpSections,
  dpFooter,
  dpCollect,
  dpValidate,
  dpBindActions,
  dpFocus,
  type DPSection,
  type DPFooterButton,
} from "./detail-page";
import { dangerModal } from "./danger-modal";

let _navigateCb: ((page: string) => void) | null = null;
let _openZlecenieCb: ((id: number) => void) | null = null;

// ─── State management ──────────────────────────────────────────
let view: "list" | "detail" | "edit" = "list";
let detailId: number | null = null;
let currentSearch: string = "";

export function onKlienciNavigate(
  nav: (page: string) => void,
  openZlecenie: (id: number) => void
): void {
  _navigateCb = nav;
  _openZlecenieCb = openZlecenie;
}

// ─── Main render dispatcher ───────────────────────────────────
export function initKlienci(search?: string): void {
  currentSearch = search ?? "";
  view = "list";
  detailId = null;
  render();
}

function render(): void {
  _clientStatsCache = null; // invalidate on each render
  if (view === "edit") {
    renderEdit();
  } else if (view === "detail" && detailId !== null) {
    renderClientDetailPage();
  } else {
    renderList();
  }
}

// ─── List view ────────────────────────────────────────────────
function renderList(): void {
  const page = document.getElementById("page-klienci")!;
  const clients = getClients(currentSearch);

  document.getElementById("topbar-title")!.textContent = "Klienci";
  document.getElementById("topbar-actions")!.innerHTML = `
    <label class="btn btn-sm" style="cursor:pointer">
      <i class="fa-solid fa-file-csv"></i> Import CSV
      <input type="file" id="f-import-clients-csv" accept=".csv,.txt" style="display:none" />
    </label>
    <button class="btn btn-sm btn-primary" id="btn-add-client">
      <i class="fa-solid fa-plus"></i> Dodaj klienta
    </button>
  `;

  // CSV import handler
  document.getElementById("f-import-clients-csv")?.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      importClientsFromCSV(text);
    };
    reader.readAsText(file);
  });

  if (clients.length === 0 && !currentSearch) {
    page.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-address-book" style="font-size:48px;color:var(--text-secondary);margin-bottom:16px"></i>
        <h3 style="margin-bottom:8px">Baza klientów jest pusta</h3>
        <p style="color:var(--text-secondary);margin-bottom:16px">Dodaj swoich klientów, żeby szybciej tworzyć zlecenia i oferty.<br>Nie musisz za każdym razem wpisywać danych od nowa.</p>
        <button class="btn btn-primary" id="btn-add-client-empty"><i class="fa-solid fa-plus"></i> Dodaj pierwszego klienta</button>
      </div>
    `;
    document.getElementById("btn-add-client-empty")?.addEventListener("click", () => {
      detailId = null;
      view = "edit";
      render();
    });
  } else {
    page.innerHTML = `
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nazwa / Firma</th>
              <th>Osoba kontaktowa</th>
              <th>Telefon</th>
              <th>Email</th>
              <th>Miasto</th>
              <th>NIP</th>
              <th>Zlecenia</th>
              <th style="width:80px"></th>
            </tr>
          </thead>
          <tbody>
            ${clients
              .map((c) => {
                const stats = getClientStats(c.name);
                return `
                <tr class="clickable-row" data-client-id="${c.id}">
                  <td><strong>${esc(c.name)}</strong></td>
                  <td>${esc(c.contact_person)}</td>
                  <td class="cell-mono">${c.phone ? esc(c.phone) : '<span class="cell-muted">—</span>'}</td>
                  <td>${c.email ? `<a href="mailto:${esc(c.email)}" class="link" onclick="event.stopPropagation()">${esc(c.email)}</a>` : '<span class="cell-muted">—</span>'}</td>
                  <td>${esc(c.city)}</td>
                  <td class="cell-mono">${c.nip ? esc(c.nip) : '<span class="cell-muted">—</span>'}</td>
                  <td>
                    <span class="tag">${stats.count} zleceń</span>
                    ${stats.value > 0 ? `<span class="cell-mono" style="font-size:11px;margin-left:4px">${formatPrice(stats.value)} zł</span>` : ""}
                  </td>
                  <td class="row-actions">
                    <button class="btn-icon" data-edit-client="${c.id}" title="Edytuj"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-icon btn-icon-danger" data-del-client="${c.id}" title="Usuń"><i class="fa-solid fa-trash"></i></button>
                  </td>
                </tr>
              `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;

    // Row click → detail
    page.querySelectorAll<HTMLElement>("[data-client-id]").forEach((row) => {
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".row-actions")) return;
        const id = parseInt(row.dataset.clientId!);
        detailId = id;
        view = "detail";
        render();
      });
    });

    // Edit button
    page.querySelectorAll<HTMLElement>("[data-edit-client]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        detailId = parseInt(btn.dataset.editClient!);
        view = "edit";
        render();
      });
    });

    // Delete button
    page.querySelectorAll<HTMLElement>("[data-del-client]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.delClient!);
        const client = getClientById(id);
        if (!client) return;
        if (
          await dangerModal(
            "Usunąć klienta?",
            `Na pewno usunąć "${client.name}"?`
          )
        ) {
          deleteClient(id);
          showToast("Klient usunięty");
          render();
        }
      });
    });
  }

  // Top bar add button
  document.getElementById("btn-add-client")?.addEventListener("click", () => {
    detailId = null;
    view = "edit";
    render();
  });
}

// ─── Client stats (zlecenia + offers count & value) ────────────
// Pre-compute stats for all clients in one pass (O(n) instead of O(n*m))
function buildAllClientStats(): Map<string, { count: number; value: number }> {
  const map = new Map<string, { count: number; value: number }>();
  const getOrCreate = (name: string) => {
    const key = name.toLowerCase().trim();
    if (!map.has(key)) map.set(key, { count: 0, value: 0 });
    return map.get(key)!;
  };

  for (const z of getZlecenia()) {
    if (!z.client) continue;
    const stats = getOrCreate(z.client);
    stats.count++;
    for (const item of z.items) {
      const markup = item.type === "material" ? z.markup_materials || 0 : z.markup_labor || 0;
      stats.value += brutto((item.price_netto * (1 + markup / 100) * item.quantity), item.vat_rate);
    }
  }

  for (const o of getOffers()) {
    if (!o.client) continue;
    const stats = getOrCreate(o.client);
    stats.count++;
    for (const item of o.items) {
      stats.value += item.offer_price * item.quantity * (1 + item.vat_rate / 100);
    }
  }

  return map;
}

let _clientStatsCache: Map<string, { count: number; value: number }> | null = null;
function getClientStats(clientName: string): { count: number; value: number } {
  if (!_clientStatsCache) _clientStatsCache = buildAllClientStats();
  return _clientStatsCache.get(clientName.toLowerCase().trim()) || { count: 0, value: 0 };
}

/** Call this when data changes to invalidate the cache */
export function invalidateClientStatsCache(): void {
  _clientStatsCache = null;
}

// ─── Client detail page ────────────────────────────────────────
function renderClientDetailPage(): void {
  const page = document.getElementById("page-klienci")!;
  const client = getClientById(detailId!);
  if (!client) {
    view = "list";
    render();
    return;
  }

  document.getElementById("topbar-title")!.textContent = client.name;
  document.getElementById("topbar-actions")!.innerHTML = "";

  const content = buildClientDetailContent(client);

  page.innerHTML =
    dpHeader(client.name) +
    content +
    dpFooter([
      { id: "btn-back", label: "Wróć", style: "secondary", action: "back" },
      {
        id: "btn-delete",
        label: "Usuń",
        style: "danger",
        action: "delete",
        icon: "fa-solid fa-trash",
      },
      {
        id: "btn-edit",
        label: "Edytuj",
        style: "primary",
        action: "edit",
        icon: "fa-solid fa-pen",
      },
    ]);

  dpBindActions(page, {
    back: () => {
      view = "list";
      detailId = null;
      render();
    },
    edit: () => {
      view = "edit";
      render();
    },
    delete: async () => {
      if (
        await dangerModal(
          "Usunąć klienta?",
          `Na pewno usunąć "${client.name}"?`
        )
      ) {
        deleteClient(client.id);
        showToast("Klient usunięty");
        view = "list";
        detailId = null;
        render();
      }
    },
    "open-zlecenie": (e) => {
      const el = (e.target as HTMLElement).closest(
        "[data-zlecenie-id]"
      ) as HTMLElement;
      if (el) _openZlecenieCb?.(parseInt(el.dataset.zlecenieId!));
    },
  });
}

// ─── Build detail page content ─────────────────────────────────
function buildClientDetailContent(client: Client): string {
  const zlecenia = getZlecenia().filter(
    (z) =>
      z.client.toLowerCase().trim() === client.name.toLowerCase().trim()
  );
  const offers = getOffers().filter(
    (o) =>
      o.client.toLowerCase().trim() === client.name.toLowerCase().trim()
  );

  // Calculate statistics
  let totalValue = 0;
  let firstOrderDate: string | null = null;

  for (const z of zlecenia) {
    for (const item of z.items) {
      const markup =
        item.type === "material" ? z.markup_materials || 0 : z.markup_labor || 0;
      totalValue +=
        brutto(
          (item.price_netto * (1 + markup / 100) * item.quantity),
          item.vat_rate
        );
    }
    const createdDate = new Date(z.created_at);
    if (!firstOrderDate || createdDate < new Date(firstOrderDate)) {
      firstOrderDate = z.created_at;
    }
  }

  for (const o of offers) {
    for (const item of o.items) {
      totalValue +=
        item.offer_price * item.quantity * (1 + item.vat_rate / 100);
    }
    const createdDate = new Date(o.created_at);
    if (!firstOrderDate || createdDate < new Date(firstOrderDate)) {
      firstOrderDate = o.created_at;
    }
  }

  const totalCount = zlecenia.length + offers.length;
  const firstOrderDateStr = firstOrderDate
    ? new Date(firstOrderDate).toLocaleDateString("pl-PL")
    : "—";

  const infoHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div>
        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:2px">Telefon</div>
        <div>${client.phone ? esc(client.phone) : "—"}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:2px">Email</div>
        <div>${client.email ? `<a href="mailto:${esc(client.email)}" class="link">${esc(client.email)}</a>` : "—"}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:2px">NIP</div>
        <div class="cell-mono">${client.nip || "—"}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:2px">Osoba kontaktowa</div>
        <div>${client.contact_person || "—"}</div>
      </div>
      <div style="grid-column:span 2">
        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:2px">Adres</div>
        <div>${[client.address, client.city].filter(Boolean).join(", ") || "—"}</div>
      </div>
      ${
        client.notes
          ? `
        <div style="grid-column:span 2">
          <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:2px">Notatki</div>
          <div style="white-space:pre-wrap;font-size:13px">${esc(client.notes)}</div>
        </div>
      `
          : ""
      }
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;padding:16px;background:var(--bg-secondary);border-radius:var(--radius)">
      <div style="text-align:center">
        <div style="font-size:20px;font-weight:700;color:var(--accent)">${
          zlecenia.length + offers.length
        }</div>
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Zleceń/Ofert</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:20px;font-weight:700;color:var(--success)">${formatPrice(totalValue)} zł</div>
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Łączna wartość</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:20px;font-weight:700">${
          totalCount > 0 ? formatPrice(totalValue / totalCount) : "0,00"
        } zł</div>
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Średnia wartość</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:20px;font-weight:700">${firstOrderDateStr}</div>
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Współpraca od</div>
      </div>
    </div>

    ${
      zlecenia.length > 0 || offers.length > 0
        ? `
      <div style="border-top:1px solid var(--border);padding-top:16px">
        <div style="font-weight:600;font-size:13px;margin-bottom:8px">Historia współpracy</div>
        ${zlecenia
          .map(
            (z) => `
          <div class="dash-recent-item" style="cursor:pointer" data-zlecenie-id="${z.id}">
            <div class="dash-recent-status" style="background:var(--accent)"></div>
            <div class="dash-recent-info">
              <div class="dash-recent-name">${esc(z.name)}</div>
              <div class="dash-recent-meta">Zlecenie • ${z.status} • ${new Date(z.created_at).toLocaleDateString("pl-PL")}</div>
            </div>
          </div>
        `
          )
          .join("")}
        ${offers
          .map(
            (o) => `
          <div class="dash-recent-item" style="cursor:pointer" data-zlecenie-id="${o.id}">
            <div class="dash-recent-status" style="background:var(--warning)"></div>
            <div class="dash-recent-info">
              <div class="dash-recent-name">${esc(o.name)}</div>
              <div class="dash-recent-meta">Oferta • ${o.status} • ${new Date(o.created_at).toLocaleDateString("pl-PL")}</div>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    `
        : '<div class="cell-muted" style="text-align:center;padding:16px">Brak zleceń/ofert dla tego klienta</div>'
    }
  `;

  return `<div class="dp-body">${infoHtml}</div>`;
}

// ─── Form sections ────────────────────────────────────────────
function getClientSections(c?: Client): DPSection[] {
  return [
    {
      id: "section-company",
      title: "Dane firmy",
      columns: 2,
      fields: [
        {
          id: "f-c-name",
          name: "name",
          label: "Nazwa firmy / klienta",
          type: "text",
          required: true,
          placeholder: "np. ABC Sp. z o.o.",
          value: c?.name ?? "",
        },
        {
          id: "f-c-nip",
          name: "nip",
          label: "NIP",
          type: "text",
          placeholder: "000-000-00-00",
          value: c?.nip ?? "",
          validation: validateNIPStrict,
        },
        {
          id: "f-c-address",
          name: "address",
          label: "Adres",
          type: "text",
          placeholder: "ul. Kwiatowa 5",
          value: c?.address ?? "",
        },
        {
          id: "f-c-city",
          name: "city",
          label: "Miasto",
          type: "text",
          placeholder: "Warszawa",
          value: c?.city ?? "",
        },
      ],
    },
    {
      id: "section-contact",
      title: "Kontakt",
      columns: 2,
      fields: [
        {
          id: "f-c-contact",
          name: "contact_person",
          label: "Osoba kontaktowa",
          type: "text",
          placeholder: "Jan Kowalski",
          value: c?.contact_person ?? "",
        },
        {
          id: "f-c-phone",
          name: "phone",
          label: "Telefon",
          type: "tel",
          placeholder: "+48 123 456 789",
          value: c?.phone ?? "",
          validation: validatePhoneStrict,
        },
        {
          id: "f-c-email",
          name: "email",
          label: "Email",
          type: "email",
          placeholder: "kontakt@firma.pl",
          value: c?.email ?? "",
          validation: validateEmailStrict,
        },
      ],
    },
    {
      id: "section-notes",
      title: "Notatki",
      columns: 1,
      fields: [
        {
          id: "f-c-notes",
          name: "notes",
          label: "Notatki",
          type: "textarea",
          placeholder: "Dodatkowe informacje...",
          value: c?.notes ?? "",
          rows: 3,
        },
      ],
    },
  ];
}

// ─── Edit view ────────────────────────────────────────────────
function renderEdit(): void {
  const page = document.getElementById("page-klienci")!;
  const client =
    detailId !== null ? getClientById(detailId) : null;
  const title = client ? "Edytuj klienta" : "Nowy klient";
  const sections = getClientSections(client ?? undefined);

  document.getElementById("topbar-title")!.textContent = title;
  document.getElementById("topbar-actions")!.innerHTML = "";

  const footerButtons: DPFooterButton[] = [
    { id: "btn-back", label: "Wróć", style: "secondary", action: "back" },
    ...(client
      ? [
          {
            id: "btn-delete",
            label: "Usuń",
            style: "danger" as const,
            action: "delete",
            icon: "fa-solid fa-trash",
          },
        ]
      : []),
    {
      id: "btn-save",
      label: client ? "Zapisz" : "Dodaj klienta",
      style: "primary" as const,
      action: "save",
      icon: "fa-solid fa-check",
    },
  ];

  page.innerHTML =
    dpHeader(title) + dpSections(sections) + dpFooter(footerButtons);

  dpBindActions(page, {
    back: () => {
      if (client) {
        view = "detail";
      } else {
        view = "list";
        detailId = null;
      }
      render();
    },
    save: () => {
      const result = dpValidate(page, sections);
      if (!result.valid) return;
      const data = dpCollect(page, sections);

      const input: ClientInput = {
        name: data.name,
        nip: data.nip,
        phone: data.phone,
        email: data.email,
        address: data.address,
        city: data.city,
        contact_person: data.contact_person,
        notes: data.notes,
      };

      // NIP formatting
      if (input.nip) input.nip = formatNIP(input.nip);

      if (client) {
        updateClient(client.id, input);
        showToast("Klient zaktualizowany");
        view = "detail";
      } else {
        const newClient = addClient(input);
        detailId = newClient.id;
        showToast("Klient dodany");
        view = "detail";
      }
      render();
    },
    delete: async () => {
      if (!client) return;
      if (
        await dangerModal(
          "Usunąć klienta?",
          `Na pewno usunąć "${client.name}"?`
        )
      ) {
        deleteClient(client.id);
        showToast("Klient usunięty");
        view = "list";
        detailId = null;
        render();
      }
    },
  });

  dpFocus(page, sections);
}

// ─── Client picker (datalist autocomplete for forms) ──────────
export function renderClientPicker(
  fieldId: string,
  currentValue: string
): string {
  const clients = getClients();
  return `
    <input class="form-input" id="${fieldId}" name="client" value="${esc(currentValue)}" list="${fieldId}-list" placeholder="Wpisz lub wybierz klienta..." autocomplete="off" />
    <datalist id="${fieldId}-list">
      ${clients.map((c) => `<option value="${esc(c.name)}">${c.nip ? `NIP: ${esc(c.nip)}` : ""} ${c.city ? `• ${esc(c.city)}` : ""}</option>`).join("")}
    </datalist>
  `;
}

// ─── Quick add client from any form ────────────────────────────
export function quickAddClientFromName(name: string): Client | null {
  if (!name.trim()) return null;
  const existing = getClients().find(
    (c) => c.name.toLowerCase() === name.toLowerCase().trim()
  );
  if (existing) return existing;
  // Auto-create stub client
  return addClient({
    name: name.trim(),
    nip: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    contact_person: "",
    notes: "",
  });
}

// ─── Bulk CSV import ──────────────────────────────────────────
function importClientsFromCSV(text: string): void {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    showToast("Plik jest pusty");
    return;
  }

  // Detect separator: semicolon or comma
  const sep = lines[0].includes(";") ? ";" : ",";
  const header = lines[0]
    .split(sep)
    .map((h) => h.trim().toLowerCase().replace(/^"/, "").replace(/"$/, ""));

  // Map columns: try to auto-detect
  const colMap: Record<string, number> = {};
  const mappings: Record<string, string[]> = {
    name: ["nazwa", "firma", "name", "company", "klient", "nazwa firmy"],
    nip: ["nip", "tax_id", "nip firmy"],
    phone: ["telefon", "phone", "tel", "nr telefonu"],
    email: ["email", "e-mail", "mail"],
    address: ["adres", "address", "ulica"],
    city: ["miasto", "city"],
    contact_person: ["osoba", "contact", "osoba kontaktowa", "kontakt"],
    notes: ["notatki", "notes", "uwagi"],
  };

  for (const [field, aliases] of Object.entries(mappings)) {
    const idx = header.findIndex((h) => aliases.some((a) => h.includes(a)));
    if (idx >= 0) colMap[field] = idx;
  }

  if (colMap.name === undefined) {
    // Fallback: first column is name
    colMap.name = 0;
  }

  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]
      .split(sep)
      .map((p) => p.trim().replace(/^"/, "").replace(/"$/, ""));
    const name = parts[colMap.name] || "";
    if (!name) continue;

    // Check if already exists
    const existing = getClients().find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      skipped++;
      continue;
    }

    addClient({
      name,
      nip: parts[colMap.nip] || "",
      phone: parts[colMap.phone] || "",
      email: parts[colMap.email] || "",
      address: parts[colMap.address] || "",
      city: parts[colMap.city] || "",
      contact_person: parts[colMap.contact_person] || "",
      notes: parts[colMap.notes] || "",
    });
    imported++;
  }

  showToast(
    `Zaimportowano ${imported} klientów${
      skipped > 0 ? `, pominięto ${skipped} duplikatów` : ""
    }`
  );
  initKlienci();
}

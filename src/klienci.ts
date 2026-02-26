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
import { esc, openModal, closeModal, showToast, formatPrice, brutto, validateNIP, formatNIP, validateEmail } from "./ui";

let _navigateCb: ((page: string) => void) | null = null;
let _openZlecenieCb: ((id: number) => void) | null = null;

export function onKlienciNavigate(nav: (page: string) => void, openZlecenie: (id: number) => void): void {
  _navigateCb = nav;
  _openZlecenieCb = openZlecenie;
}

// ─── List view ──────────────────────────────────────────────────
export function initKlienci(search?: string): void {
  const page = document.getElementById("page-klienci")!;
  const clients = getClients(search);

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

  if (clients.length === 0 && !search) {
    page.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-address-book" style="font-size:48px;color:var(--text-secondary);margin-bottom:16px"></i>
        <h3 style="margin-bottom:8px">Baza klientów jest pusta</h3>
        <p style="color:var(--text-secondary);margin-bottom:16px">Dodaj swoich klientów, żeby szybciej tworzyć zlecenia i oferty.<br>Nie musisz za każdym razem wpisywać danych od nowa.</p>
        <button class="btn btn-primary" id="btn-add-client-empty"><i class="fa-solid fa-plus"></i> Dodaj pierwszego klienta</button>
      </div>
    `;
    document.getElementById("btn-add-client-empty")?.addEventListener("click", () => openClientModal());
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
            ${clients.map((c) => {
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
            }).join("")}
          </tbody>
        </table>
      </div>
    `;

    // Row click → detail
    page.querySelectorAll<HTMLElement>("[data-client-id]").forEach((row) => {
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".row-actions")) return;
        const id = parseInt(row.dataset.clientId!);
        openClientDetail(id);
      });
    });

    // Edit
    page.querySelectorAll<HTMLElement>("[data-edit-client]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openClientModal(parseInt(btn.dataset.editClient!));
      });
    });

    // Delete
    page.querySelectorAll<HTMLElement>("[data-del-client]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.delClient!);
        const client = getClientById(id);
        if (!client) return;
        openModal("Usuń klienta", `
          <p>Na pewno usunąć klienta <strong>${esc(client.name)}</strong>?</p>
          <p style="color:var(--text-secondary);font-size:12px;margin-top:8px">Zlecenia i oferty przypisane do tego klienta nie zostaną usunięte.</p>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
            <button class="btn" id="modal-cancel">Anuluj</button>
            <button class="btn btn-danger" id="modal-confirm">Usuń</button>
          </div>
        `);
        document.getElementById("modal-cancel")?.addEventListener("click", closeModal);
        document.getElementById("modal-confirm")?.addEventListener("click", () => {
          deleteClient(id);
          closeModal();
          showToast("Klient usunięty");
          initKlienci(search);
        });
      });
    });
  }

  // Top bar add button
  document.getElementById("btn-add-client")?.addEventListener("click", () => openClientModal());
}

// ─── Client stats (zlecenia + offers count & value) ─────────────
function getClientStats(clientName: string): { count: number; value: number } {
  const lower = clientName.toLowerCase().trim();
  let count = 0;
  let value = 0;

  for (const z of getZlecenia()) {
    if (z.client.toLowerCase().trim() === lower) {
      count++;
      for (const item of z.items) {
        const markup = item.type === "material" ? (z.markup_materials || 0) : (z.markup_labor || 0);
        value += brutto(item.price_netto * (1 + markup / 100) * item.quantity, item.vat_rate);
      }
    }
  }

  for (const o of getOffers()) {
    if (o.client.toLowerCase().trim() === lower) {
      count++;
      for (const item of o.items) {
        value += item.offer_price * item.quantity * (1 + item.vat_rate / 100);
      }
    }
  }

  return { count, value };
}

// ─── Client detail (modal showing history) ──────────────────────
function openClientDetail(id: number): void {
  const client = getClientById(id);
  if (!client) return;

  const zlecenia = getZlecenia().filter((z) => z.client.toLowerCase().trim() === client.name.toLowerCase().trim());
  const offers = getOffers().filter((o) => o.client.toLowerCase().trim() === client.name.toLowerCase().trim());

  // Calculate statistics
  let totalValue = 0;
  let firstOrderDate: string | null = null;

  for (const z of zlecenia) {
    for (const item of z.items) {
      const markup = item.type === "material" ? (z.markup_materials || 0) : (z.markup_labor || 0);
      totalValue += brutto(item.price_netto * (1 + markup / 100) * item.quantity, item.vat_rate);
    }
    const createdDate = new Date(z.created_at);
    if (!firstOrderDate || createdDate < new Date(firstOrderDate)) {
      firstOrderDate = z.created_at;
    }
  }

  for (const o of offers) {
    for (const item of o.items) {
      totalValue += item.offer_price * item.quantity * (1 + item.vat_rate / 100);
    }
    const createdDate = new Date(o.created_at);
    if (!firstOrderDate || createdDate < new Date(firstOrderDate)) {
      firstOrderDate = o.created_at;
    }
  }

  const totalCount = zlecenia.length + offers.length;
  const firstOrderDateStr = firstOrderDate ? new Date(firstOrderDate).toLocaleDateString("pl-PL") : "—";

  const html = `
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
      ${client.notes ? `
        <div style="grid-column:span 2">
          <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:2px">Notatki</div>
          <div style="white-space:pre-wrap;font-size:13px">${esc(client.notes)}</div>
        </div>
      ` : ""}
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;padding:16px;background:var(--bg-secondary);border-radius:var(--radius)">
      <div style="text-align:center">
        <div style="font-size:20px;font-weight:700;color:var(--accent)">${zlecenia.length + offers.length}</div>
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Zleceń/Ofert</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:20px;font-weight:700;color:var(--success)">${formatPrice(totalValue)} zł</div>
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Łączna wartość</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:20px;font-weight:700">${totalCount > 0 ? formatPrice(totalValue / totalCount) : "0,00"} zł</div>
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Średnia wartość</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:20px;font-weight:700">${firstOrderDateStr}</div>
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Współpraca od</div>
      </div>
    </div>

    ${(zlecenia.length > 0 || offers.length > 0) ? `
      <div style="border-top:1px solid var(--border);padding-top:16px">
        <div style="font-weight:600;font-size:13px;margin-bottom:8px">Historia współpracy</div>
        ${zlecenia.map((z) => `
          <div class="dash-recent-item" style="cursor:pointer" data-detail-zlecenie="${z.id}">
            <div class="dash-recent-status" style="background:var(--accent)"></div>
            <div class="dash-recent-info">
              <div class="dash-recent-name">${esc(z.name)}</div>
              <div class="dash-recent-meta">Zlecenie • ${z.status} • ${new Date(z.created_at).toLocaleDateString("pl-PL")}</div>
            </div>
          </div>
        `).join("")}
        ${offers.map((o) => `
          <div class="dash-recent-item" style="cursor:pointer" data-detail-offer="${o.id}">
            <div class="dash-recent-status" style="background:var(--warning)"></div>
            <div class="dash-recent-info">
              <div class="dash-recent-name">${esc(o.name)}</div>
              <div class="dash-recent-meta">Oferta • ${o.status} • ${new Date(o.created_at).toLocaleDateString("pl-PL")}</div>
            </div>
          </div>
        `).join("")}
      </div>
    ` : '<div class="cell-muted" style="text-align:center;padding:16px">Brak zleceń/ofert dla tego klienta</div>'}

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
      <button class="btn" id="detail-close">Zamknij</button>
      <button class="btn btn-primary" id="detail-edit">
        <i class="fa-solid fa-pen"></i> Edytuj
      </button>
    </div>
  `;

  openModal(`<i class="fa-solid fa-user"></i> ${esc(client.name)}`, html);

  document.getElementById("detail-close")?.addEventListener("click", closeModal);
  document.getElementById("detail-edit")?.addEventListener("click", () => {
    closeModal();
    openClientModal(id);
  });

  // Click on zlecenie/offer → navigate
  document.querySelectorAll<HTMLElement>("[data-detail-zlecenie]").forEach((el) => {
    el.addEventListener("click", () => {
      closeModal();
      _openZlecenieCb?.(parseInt(el.dataset.detailZlecenie!));
    });
  });
  document.querySelectorAll<HTMLElement>("[data-detail-offer]").forEach((el) => {
    el.addEventListener("click", () => {
      closeModal();
      _navigateCb?.("offers");
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("open-offer", { detail: { id: parseInt(el.dataset.detailOffer!) } }));
      }, 100);
    });
  });
}

// ─── Add/Edit modal ─────────────────────────────────────────────
function openClientModal(editId?: number): void {
  const existing = editId ? getClientById(editId) : null;
  const title = existing ? "Edytuj klienta" : "Nowy klient";

  const html = `
    <form id="client-form" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="grid-column:span 2">
        <label class="form-label">Nazwa firmy / klienta *</label>
        <input class="form-input" name="name" value="${esc(existing?.name || "")}" required placeholder="np. ABC Sp. z o.o." />
      </div>
      <div class="form-group">
        <label class="form-label">NIP</label>
        <input class="form-input" name="nip" value="${esc(existing?.nip || "")}" placeholder="000-000-00-00" />
      </div>
      <div class="form-group">
        <label class="form-label">Osoba kontaktowa</label>
        <input class="form-input" name="contact_person" value="${esc(existing?.contact_person || "")}" placeholder="Jan Kowalski" />
      </div>
      <div class="form-group">
        <label class="form-label">Telefon</label>
        <input class="form-input" name="phone" type="tel" value="${esc(existing?.phone || "")}" placeholder="+48 123 456 789" />
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" name="email" type="email" value="${esc(existing?.email || "")}" placeholder="kontakt@firma.pl" />
      </div>
      <div class="form-group">
        <label class="form-label">Adres</label>
        <input class="form-input" name="address" value="${esc(existing?.address || "")}" placeholder="ul. Kwiatowa 5" />
      </div>
      <div class="form-group">
        <label class="form-label">Miasto</label>
        <input class="form-input" name="city" value="${esc(existing?.city || "")}" placeholder="Warszawa" />
      </div>
      <div class="form-group" style="grid-column:span 2">
        <label class="form-label">Notatki</label>
        <textarea class="form-input" name="notes" rows="3" placeholder="Dodatkowe informacje...">${esc(existing?.notes || "")}</textarea>
      </div>
      <div style="grid-column:span 2;display:flex;gap:8px;justify-content:flex-end;padding-top:8px;border-top:1px solid var(--border)">
        <button type="button" class="btn" id="client-cancel">Anuluj</button>
        <button type="submit" class="btn btn-primary">
          <i class="fa-solid fa-check"></i> ${existing ? "Zapisz" : "Dodaj klienta"}
        </button>
      </div>
    </form>
  `;

  openModal(title, html);

  document.getElementById("client-cancel")?.addEventListener("click", closeModal);

  document.getElementById("client-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const fd = new FormData(form);

    const input: ClientInput = {
      name: (fd.get("name") as string || "").trim(),
      nip: (fd.get("nip") as string || "").trim(),
      phone: (fd.get("phone") as string || "").trim(),
      email: (fd.get("email") as string || "").trim(),
      address: (fd.get("address") as string || "").trim(),
      city: (fd.get("city") as string || "").trim(),
      contact_person: (fd.get("contact_person") as string || "").trim(),
      notes: (fd.get("notes") as string || "").trim(),
    };

    if (!input.name) {
      showToast("Podaj nazwę klienta");
      return;
    }

    // Validate NIP if provided
    if (input.nip && !validateNIP(input.nip)) {
      showToast("Nieprawidłowy NIP — sprawdź numer");
      return;
    }
    if (input.nip) input.nip = formatNIP(input.nip);

    // Validate email if provided
    if (input.email && !validateEmail(input.email)) {
      showToast("Nieprawidłowy adres email");
      return;
    }

    if (existing) {
      updateClient(existing.id, input);
      showToast("Klient zaktualizowany");
    } else {
      addClient(input);
      showToast("Klient dodany");
    }

    closeModal();
    initKlienci();
  });
}

// ─── Client picker (datalist autocomplete for forms) ────────────
export function renderClientPicker(fieldId: string, currentValue: string): string {
  const clients = getClients();
  return `
    <input class="form-input" id="${fieldId}" name="client" value="${esc(currentValue)}" list="${fieldId}-list" placeholder="Wpisz lub wybierz klienta..." autocomplete="off" />
    <datalist id="${fieldId}-list">
      ${clients.map((c) => `<option value="${esc(c.name)}">${c.nip ? `NIP: ${esc(c.nip)}` : ""} ${c.city ? `• ${esc(c.city)}` : ""}</option>`).join("")}
    </datalist>
  `;
}

// ─── Quick add client from any form ─────────────────────────────
export function quickAddClientFromName(name: string): Client | null {
  if (!name.trim()) return null;
  const existing = getClients().find((c) => c.name.toLowerCase() === name.toLowerCase().trim());
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

// ─── Bulk CSV import ────────────────────────────────────────────
function importClientsFromCSV(text: string): void {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    showToast("Plik jest pusty");
    return;
  }

  // Detect separator: semicolon or comma
  const sep = lines[0].includes(";") ? ";" : ",";
  const header = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/^"/, "").replace(/"$/, ""));

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
    const idx = header.findIndex(h => aliases.some(a => h.includes(a)));
    if (idx >= 0) colMap[field] = idx;
  }

  if (colMap.name === undefined) {
    // Fallback: first column is name
    colMap.name = 0;
  }

  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(sep).map(p => p.trim().replace(/^"/, "").replace(/"$/, ""));
    const name = parts[colMap.name] || "";
    if (!name) continue;

    // Check if already exists
    const existing = getClients().find(c => c.name.toLowerCase() === name.toLowerCase());
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

  showToast(`Zaimportowano ${imported} klientów${skipped > 0 ? `, pominięto ${skipped} duplikatów` : ""}`);
  initKlienci();
}

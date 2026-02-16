import { getCompany, saveCompany, type CompanySettings } from "./store";
import { esc, showToast } from "./ui";

export function initUstawienia(): void {
  const page = document.getElementById("page-ustawienia")!;
  const c = getCompany();

  document.getElementById("topbar-title")!.textContent = "Ustawienia firmy";
  document.getElementById("topbar-actions")!.innerHTML = "";

  page.innerHTML = `
    <div class="settings-layout">
      <div class="settings-main">
        <div class="settings-section">
          <div class="settings-section-title">Dane firmy</div>
          <div class="settings-section-body">
            <div class="field">
              <label>Nazwa firmy</label>
              <input type="text" id="f-c-name" value="${esc(c.name)}" placeholder="np. BudMat Usługi Budowlane" />
            </div>
            <div class="field">
              <label>NIP</label>
              <input type="text" id="f-c-nip" value="${esc(c.nip)}" placeholder="np. 123-456-78-90" />
            </div>
            <div class="field">
              <label>Adres</label>
              <input type="text" id="f-c-address" value="${esc(c.address)}" placeholder="np. ul. Budowlana 15/3" />
            </div>
            <div class="field-row" style="display:grid;grid-template-columns:120px 1fr;gap:12px">
              <div class="field">
                <label>Kod pocztowy</label>
                <input type="text" id="f-c-zip" value="${esc(c.zip)}" placeholder="00-000" />
              </div>
              <div class="field">
                <label>Miasto</label>
                <input type="text" id="f-c-city" value="${esc(c.city)}" placeholder="np. Warszawa" />
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Kontakt</div>
          <div class="settings-section-body">
            <div class="field-row field-row-2">
              <div class="field">
                <label>Telefon</label>
                <input type="text" id="f-c-phone" value="${esc(c.phone)}" placeholder="np. +48 123 456 789" />
              </div>
              <div class="field">
                <label>E-mail</label>
                <input type="text" id="f-c-email" value="${esc(c.email)}" placeholder="np. biuro@budmat.pl" />
              </div>
            </div>
            <div class="field">
              <label>Strona www</label>
              <input type="text" id="f-c-website" value="${esc(c.website)}" placeholder="np. www.budmat.pl" />
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Dane bankowe</div>
          <div class="settings-section-body">
            <div class="field">
              <label>Nazwa banku</label>
              <input type="text" id="f-c-bank-name" value="${esc(c.bank_name)}" placeholder="np. PKO BP" />
            </div>
            <div class="field">
              <label>Numer konta</label>
              <input type="text" id="f-c-bank-account" value="${esc(c.bank_account)}" placeholder="np. PL 12 3456 7890 1234 5678 9012 3456" />
            </div>
          </div>
        </div>

        <button class="btn btn-primary" id="btn-save-company" style="width:100%;margin-top:8px">
          <i class="fa-solid fa-floppy-disk"></i> Zapisz ustawienia
        </button>
      </div>

      <div class="settings-sidebar">
        <div class="settings-section">
          <div class="settings-section-title">Logo firmy</div>
          <div class="settings-section-body" style="text-align:center">
            <div class="logo-preview" id="logo-preview">
              ${c.logo
                ? `<img src="${c.logo}" alt="Logo" />`
                : `<div class="logo-placeholder"><i class="fa-solid fa-image"></i><span>Brak logo</span></div>`
              }
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;justify-content:center">
              <label class="btn btn-sm" style="cursor:pointer">
                <i class="fa-solid fa-upload"></i> Wgraj logo
                <input type="file" id="f-c-logo" accept="image/png,image/jpeg,image/svg+xml" style="display:none" />
              </label>
              ${c.logo ? `<button class="btn btn-sm btn-danger" id="btn-remove-logo"><i class="fa-solid fa-trash"></i></button>` : ""}
            </div>
            <div class="field-hint" style="margin-top:8px">PNG, JPG lub SVG. Pojawi się na kosztorysach PDF.</div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Podgląd</div>
          <div class="settings-section-body">
            <div class="company-preview" id="company-preview">
              ${renderPreview(c)}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Backup section -->
    <div class="settings-section" style="margin-top:20px">
      <div class="settings-section-title"><i class="fa-solid fa-database" style="margin-right:6px"></i> Dane aplikacji</div>
      <div class="settings-section-body">
        <div class="backup-row">
          <div class="backup-info">
            <strong>Eksportuj kopię zapasową</strong>
            <div class="field-hint">Zapisz wszystkie dane (materiały, robocizny, zlecenia, wydatki, ustawienia) jako plik JSON. Użyj do backupu lub przeniesienia na inny komputer.</div>
          </div>
          <button class="btn" id="btn-export-backup"><i class="fa-solid fa-download"></i> Eksportuj .json</button>
        </div>
        <div class="backup-divider"></div>
        <div class="backup-row">
          <div class="backup-info">
            <strong>Importuj kopię zapasową</strong>
            <div class="field-hint">Wczytaj plik JSON z danymi. <span style="color:var(--danger);font-weight:500">Uwaga: nadpisze wszystkie obecne dane!</span></div>
          </div>
          <label class="btn" style="cursor:pointer">
            <i class="fa-solid fa-upload"></i> Importuj .json
            <input type="file" id="f-import-backup" accept=".json,application/json" style="display:none" />
          </label>
        </div>
        <div class="backup-divider"></div>
        <div class="backup-row">
          <div class="backup-info">
            <strong>Wyczyść dane</strong>
            <div class="field-hint">Usuń wszystkie dane aplikacji i zacznij od nowa.</div>
          </div>
          <button class="btn btn-danger-outline" id="btn-reset-data"><i class="fa-solid fa-triangle-exclamation"></i> Resetuj</button>
        </div>
      </div>
    </div>
  `;

  // Save
  document.getElementById("btn-save-company")!.addEventListener("click", () => {
    const settings = collectForm();
    saveCompany(settings);
    showToast("Ustawienia zapisane");
    updatePreview(settings);
  });

  // Logo upload
  document.getElementById("f-c-logo")!.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      showToast("Logo za duże — max 2 MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const current = collectForm();
      current.logo = dataUrl;
      saveCompany(current);
      showToast("Logo wgrane");
      initUstawienia(); // re-render
    };
    reader.readAsDataURL(file);
  });

  // Remove logo
  document.getElementById("btn-remove-logo")?.addEventListener("click", () => {
    const current = collectForm();
    current.logo = "";
    saveCompany(current);
    showToast("Logo usunięte");
    initUstawienia();
  });

  // Live preview on input
  page.querySelectorAll<HTMLInputElement>("input[id^='f-c-']").forEach((input) => {
    input.addEventListener("input", () => {
      updatePreview(collectForm());
    });
  });

  // ─── Backup: Export ──────────────────────────────────────────
  document.getElementById("btn-export-backup")!.addEventListener("click", () => {
    const keys = [
      "pp_materials", "pp_labor", "pp_categories",
      "pp_zlecenia", "pp_templates", "pp_expenses",
      "pp_company", "pp_id_counter", "pp_wizard_done",
      "pp_theme", "pp_sidebar_collapsed",
    ];

    const data: Record<string, unknown> = {
      _meta: {
        app: "ProstyPlaner",
        version: "1.0",
        exported_at: new Date().toISOString(),
      },
    };

    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        try { data[key] = JSON.parse(raw); } catch { data[key] = raw; }
      }
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prosty-planer-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Kopia zapasowa pobrana");
  });

  // ─── Backup: Import ──────────────────────────────────────────
  document.getElementById("f-import-backup")!.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);

        if (!data._meta || data._meta.app !== "ProstyPlaner") {
          showToast("Nieprawidłowy plik — to nie jest backup Prosty Planer");
          return;
        }

        // Confirm
        const ok = confirm(
          "Na pewno chcesz wczytać kopię zapasową?\n\n" +
          "Wszystkie obecne dane zostaną nadpisane!\n" +
          `Backup z: ${data._meta.exported_at?.slice(0, 10) || "nieznana data"}`
        );
        if (!ok) return;

        const keys = Object.keys(data).filter((k) => k !== "_meta");
        for (const key of keys) {
          const val = typeof data[key] === "string" ? data[key] : JSON.stringify(data[key]);
          localStorage.setItem(key, val);
        }

        showToast("Dane wczytane — odświeżam");
        setTimeout(() => location.reload(), 500);
      } catch {
        showToast("Błąd wczytywania pliku");
      }
    };
    reader.readAsText(file);
  });

  // ─── Reset ───────────────────────────────────────────────────
  document.getElementById("btn-reset-data")!.addEventListener("click", () => {
    const ok = confirm(
      "Na pewno chcesz usunąć WSZYSTKIE dane?\n\n" +
      "Materiały, robocizny, zlecenia, wydatki, ustawienia firmy — wszystko zostanie skasowane.\n\n" +
      "Ta operacja jest nieodwracalna!"
    );
    if (!ok) return;

    const confirm2 = confirm("Ostatnie ostrzeżenie — kliknij OK żeby wyczyścić dane.");
    if (!confirm2) return;

    const keys = [
      "pp_materials", "pp_labor", "pp_categories",
      "pp_zlecenia", "pp_templates", "pp_expenses",
      "pp_company", "pp_id_counter", "pp_wizard_done",
      "pp_theme", "pp_sidebar_collapsed",
    ];
    for (const key of keys) localStorage.removeItem(key);

    showToast("Dane usunięte — odświeżam");
    setTimeout(() => location.reload(), 500);
  });
}

function collectForm(): CompanySettings {
  const existing = getCompany();
  return {
    name: (document.getElementById("f-c-name") as HTMLInputElement).value.trim(),
    nip: (document.getElementById("f-c-nip") as HTMLInputElement).value.trim(),
    address: (document.getElementById("f-c-address") as HTMLInputElement).value.trim(),
    city: (document.getElementById("f-c-city") as HTMLInputElement).value.trim(),
    zip: (document.getElementById("f-c-zip") as HTMLInputElement).value.trim(),
    phone: (document.getElementById("f-c-phone") as HTMLInputElement).value.trim(),
    email: (document.getElementById("f-c-email") as HTMLInputElement).value.trim(),
    website: (document.getElementById("f-c-website") as HTMLInputElement).value.trim(),
    bank_name: (document.getElementById("f-c-bank-name") as HTMLInputElement).value.trim(),
    bank_account: (document.getElementById("f-c-bank-account") as HTMLInputElement).value.trim(),
    logo: existing.logo, // logo is managed separately
  };
}

function updatePreview(c: CompanySettings): void {
  const el = document.getElementById("company-preview");
  if (el) el.innerHTML = renderPreview(c);
}

function renderPreview(c: CompanySettings): string {
  const hasAny = c.name || c.nip || c.address || c.phone || c.email;
  if (!hasAny) {
    return `<div class="cell-muted" style="padding:12px;text-align:center;font-size:12px">Wypełnij dane żeby zobaczyć podgląd</div>`;
  }

  let html = `<div class="preview-card">`;
  if (c.logo) {
    html += `<img src="${c.logo}" alt="Logo" class="preview-logo" />`;
  }
  if (c.name) html += `<div class="preview-name">${esc(c.name)}</div>`;
  if (c.nip) html += `<div class="preview-line">NIP: ${esc(c.nip)}</div>`;
  if (c.address || c.zip || c.city) {
    const addr = [c.address, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    html += `<div class="preview-line">${esc(addr)}</div>`;
  }
  if (c.phone || c.email) {
    const contact = [c.phone, c.email].filter(Boolean).join(" • ");
    html += `<div class="preview-line">${esc(contact)}</div>`;
  }
  if (c.website) html += `<div class="preview-line">${esc(c.website)}</div>`;
  if (c.bank_name || c.bank_account) {
    html += `<div class="preview-line preview-bank">${esc([c.bank_name, c.bank_account].filter(Boolean).join(": "))}</div>`;
  }
  html += `</div>`;
  return html;
}

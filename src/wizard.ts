import { saveCompany, getCompany, type CompanySettings } from "./store";
import { showToast } from "./ui";

const WIZARD_DONE_KEY = "pp_wizard_done";

export function shouldShowWizard(): boolean {
  return !localStorage.getItem(WIZARD_DONE_KEY);
}

export function markWizardDone(): void {
  localStorage.setItem(WIZARD_DONE_KEY, "1");
}

export function initWizard(onFinish: () => void): void {
  let step = 0;

  const overlay = document.createElement("div");
  overlay.className = "wizard-overlay";
  document.body.appendChild(overlay);

  function render(): void {
    overlay.innerHTML = `
      <div class="wizard-card">
        <div class="wizard-progress">
          ${[0, 1, 2].map((i) => `<div class="wizard-dot${i === step ? " active" : ""}${i < step ? " done" : ""}"></div>`).join("")}
        </div>
        ${step === 0 ? renderStep0() : step === 1 ? renderStep1() : renderStep2()}
      </div>
    `;
    bindStep();
  }

  // ─── Step 0: Welcome ─────────────────────────────────────────
  function renderStep0(): string {
    return `
      <img src="/logo.png" alt="Prosty Planer" class="wizard-logo" />
      <h1 class="wizard-title">Witaj w Prosty Planer!</h1>
      <p class="wizard-desc">
        Szybkie kosztorysy budowlane — materiały, robocizna, narzuty, PDF.<br>
        Skonfigurujmy Twoje konto w 2 minuty.
      </p>
      <div class="wizard-features">
        <div class="wizard-feature"><i class="fa-solid fa-boxes-stacked"></i> Baza materiałów i robocizny</div>
        <div class="wizard-feature"><i class="fa-solid fa-file-invoice-dollar"></i> Zlecenia z narzutem i VAT</div>
        <div class="wizard-feature"><i class="fa-solid fa-file-pdf"></i> Eksport kosztorysu do PDF</div>
        <div class="wizard-feature"><i class="fa-solid fa-chart-column"></i> Wykresy i rentowność</div>
      </div>
      <div class="wizard-actions">
        <button class="btn btn-primary wizard-btn" id="wiz-next">Zaczynamy <i class="fa-solid fa-arrow-right"></i></button>
      </div>
      <button class="wizard-skip" id="wiz-skip">Pomiń konfigurację</button>
    `;
  }

  // ─── Step 1: Company info ────────────────────────────────────
  function renderStep1(): string {
    const c = getCompany();
    return `
      <div class="wizard-step-icon"><i class="fa-solid fa-building"></i></div>
      <h2 class="wizard-title">Dane Twojej firmy</h2>
      <p class="wizard-desc">Pojawią się na kosztorysach PDF. Możesz uzupełnić później w Ustawieniach.</p>
      <div class="wizard-form">
        <div class="field">
          <label>Nazwa firmy</label>
          <input type="text" id="wiz-name" value="${esc(c.name)}" placeholder="np. BudMat Usługi Budowlane" autofocus />
        </div>
        <div class="wiz-field-row">
          <div class="field">
            <label>NIP</label>
            <input type="text" id="wiz-nip" value="${esc(c.nip)}" placeholder="123-456-78-90" />
          </div>
          <div class="field">
            <label>Telefon</label>
            <input type="text" id="wiz-phone" value="${esc(c.phone)}" placeholder="+48 ..." />
          </div>
        </div>
        <div class="wiz-field-row">
          <div class="field">
            <label>Email</label>
            <input type="text" id="wiz-email" value="${esc(c.email)}" placeholder="firma@email.pl" />
          </div>
          <div class="field">
            <label>Miasto</label>
            <input type="text" id="wiz-city" value="${esc(c.city)}" placeholder="np. Warszawa" />
          </div>
        </div>
      </div>
      <div class="wizard-actions">
        <button class="btn" id="wiz-back"><i class="fa-solid fa-arrow-left"></i> Wstecz</button>
        <button class="btn btn-primary wizard-btn" id="wiz-next">Dalej <i class="fa-solid fa-arrow-right"></i></button>
      </div>
    `;
  }

  // ─── Step 2: Ready ───────────────────────────────────────────
  function renderStep2(): string {
    return `
      <div class="wizard-icon wizard-icon-success"><i class="fa-solid fa-check"></i></div>
      <h2 class="wizard-title">Wszystko gotowe!</h2>
      <p class="wizard-desc">Twoje konto jest skonfigurowane. Oto co możesz teraz zrobić:</p>
      <div class="wizard-next-steps">
        <div class="wizard-next-step">
          <div class="wizard-next-num">1</div>
          <div>
            <strong>Dodaj materiały i robociznę</strong>
            <div class="wizard-next-hint">Zbuduj bazę cenową — to fundament każdego kosztorysu</div>
          </div>
        </div>
        <div class="wizard-next-step">
          <div class="wizard-next-num">2</div>
          <div>
            <strong>Utwórz zlecenie</strong>
            <div class="wizard-next-hint">Wybierz pozycje z bazy, ustaw narzut, gotowa wycena</div>
          </div>
        </div>
        <div class="wizard-next-step">
          <div class="wizard-next-num">3</div>
          <div>
            <strong>Wyeksportuj PDF</strong>
            <div class="wizard-next-hint">Profesjonalny kosztorys z logo firmy jednym klikiem</div>
          </div>
        </div>
      </div>
      <div class="wizard-actions">
        <button class="btn btn-primary wizard-btn wizard-btn-go" id="wiz-finish"><i class="fa-solid fa-rocket"></i> Otwórz Prosty Planer</button>
      </div>
    `;
  }

  // ─── Bindings ────────────────────────────────────────────────
  function bindStep(): void {
    overlay.querySelector("#wiz-next")?.addEventListener("click", () => {
      if (step === 1) saveStep1();
      step++;
      render();
    });

    overlay.querySelector("#wiz-back")?.addEventListener("click", () => {
      step--;
      render();
    });

    overlay.querySelector("#wiz-skip")?.addEventListener("click", finish);
    overlay.querySelector("#wiz-finish")?.addEventListener("click", finish);
  }

  function saveStep1(): void {
    const c = getCompany();
    c.name = (overlay.querySelector("#wiz-name") as HTMLInputElement)?.value.trim() || c.name;
    c.nip = (overlay.querySelector("#wiz-nip") as HTMLInputElement)?.value.trim() || c.nip;
    c.phone = (overlay.querySelector("#wiz-phone") as HTMLInputElement)?.value.trim() || c.phone;
    c.email = (overlay.querySelector("#wiz-email") as HTMLInputElement)?.value.trim() || c.email;
    c.city = (overlay.querySelector("#wiz-city") as HTMLInputElement)?.value.trim() || c.city;
    saveCompany(c);
  }

  function finish(): void {
    markWizardDone();
    overlay.classList.add("wizard-exit");
    setTimeout(() => {
      overlay.remove();
      onFinish();
    }, 300);
  }

  render();
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

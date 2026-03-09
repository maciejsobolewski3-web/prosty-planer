import {
  getCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  getMaterialCountByCategory,
} from "./store";
import { esc, showToast } from "./ui";
import { dpHeader, dpSections, dpFooter, dpCollect, dpValidate, dpBindActions, dpFocus, type DPSection, type DPFooterButton } from "./detail-page";
import { dangerModal } from "./danger-modal";

// ─── State ───────────────────────────────────────────────────────
let view: 'list' | 'detail' = 'list';
let detailId: number | null = null;

// ─── Category form sections ──────────────────────────────────────
function getCategorySections(cat?: { name: string; color: string }): DPSection[] {
  return [{
    id: "section-cat",
    title: "Kategoria",
    columns: 1,
    fields: [
      { id: "f-cat-name", name: "name", label: "Nazwa", type: "text", required: true, placeholder: "np. Instalacja elektryczna", value: cat?.name ?? "" },
      { id: "f-cat-color", name: "color", label: "Kolor", type: "color", value: cat?.color ?? "#667eea" },
    ]
  }];
}

// ─── Render ──────────────────────────────────────────────────────
function render(): void {
  if (view === 'detail') {
    renderDetail();
  } else {
    renderList();
  }
}

function renderList(): void {
  const page = document.getElementById("page-kategorie")!;
  const categories = getCategories();

  document.getElementById("topbar-title")!.textContent = "Kategorie";
  document.getElementById("topbar-actions")!.innerHTML = `
    <button class="btn btn-primary" id="btn-add-category">
      <i class="fa-solid fa-plus"></i> Nowa kategoria
    </button>
  `;
  document.getElementById("btn-add-category")!.addEventListener("click", () => {
    detailId = null;
    view = 'detail';
    render();
  });

  if (categories.length === 0) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="fa-solid fa-tags"></i></div>
        <h3>Brak kategorii</h3>
        <p>Dodaj pierwszą kategorię, żeby organizować materiały.</p>
        <button class="btn btn-primary" id="btn-empty-add-cat">
          <i class="fa-solid fa-plus"></i> Dodaj kategorię
        </button>
      </div>
    `;
    document.getElementById("btn-empty-add-cat")!.addEventListener("click", () => {
      detailId = null;
      view = 'detail';
      render();
    });
    return;
  }

  page.innerHTML = `<div class="cat-grid">${categories
    .map((cat) => {
      const count = getMaterialCountByCategory(cat.id);
      return `
      <div class="cat-card" data-cat-id="${cat.id}">
        <div class="cat-card-dot" style="background:${cat.color}"></div>
        <div class="cat-card-info">
          <div class="cat-card-name">${esc(cat.name)}</div>
          <div class="cat-card-count">${count} materiał${count === 1 ? "" : "ów"}</div>
        </div>
        <div class="cat-card-actions">
          <button class="btn-icon" title="Edytuj" data-cat-edit="${cat.id}"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon" title="Usuń" data-cat-delete="${cat.id}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `;
    })
    .join("")}</div>`;

  // Bind events
  page.querySelectorAll<HTMLButtonElement>("[data-cat-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.catEdit!);
      detailId = id;
      view = 'detail';
      render();
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-cat-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = parseInt(btn.dataset.catDelete!);
      const count = getMaterialCountByCategory(id);
      const msg = count > 0
        ? `Ta kategoria ma ${count} materiałów. Materiały stracą kategorię.`
        : undefined;
      if (await dangerModal("Usunąć kategorię?", msg)) {
        deleteCategory(id);
        showToast("Kategoria usunięta");
        render();
        notifySidebarUpdate();
      }
    });
  });
}

function renderDetail(): void {
  const page = document.getElementById("page-kategorie")!;
  const cat = detailId !== null ? getCategories().find(c => c.id === detailId) : null;
  const title = cat ? "Edytuj kategorię" : "Nowa kategoria";
  const sections = getCategorySections(cat ?? undefined);
  
  const footerButtons: DPFooterButton[] = [
    { id: "btn-back", label: "Wróć", style: "secondary", action: "back" },
    ...(cat ? [{ id: "btn-delete", label: "Usuń", style: "danger" as const, action: "delete", icon: "fa-solid fa-trash" }] : []),
    { id: "btn-save", label: cat ? "Zapisz" : "Dodaj", style: "primary" as const, action: "save", icon: "fa-solid fa-check" },
  ];
  
  // Update topbar
  document.getElementById("topbar-title")!.textContent = title;
  document.getElementById("topbar-actions")!.innerHTML = "";
  
  page.innerHTML = dpHeader(title) + dpSections(sections) + dpFooter(footerButtons);
  
  dpBindActions(page, {
    back: () => { view = 'list'; render(); },
    save: () => {
      const result = dpValidate(page, sections);
      if (!result.valid) return;
      const data = dpCollect(page, sections);
      
      if (cat) {
        updateCategory(cat.id, data.name, data.color);
        showToast("Kategoria zaktualizowana");
      } else {
        addCategory(data.name, data.color);
        showToast("Kategoria dodana");
      }
      view = 'list';
      render();
      notifySidebarUpdate();
    },
    delete: async () => {
      if (!cat) return;
      const count = getMaterialCountByCategory(cat.id);
      const msg = count > 0
        ? `Ta kategoria ma ${count} materiałów. Materiały stracą kategorię.`
        : undefined;
      if (await dangerModal("Usunąć kategorię?", msg)) {
        deleteCategory(cat.id);
        showToast("Kategoria usunięta");
        view = 'list';
        render();
        notifySidebarUpdate();
      }
    },
  });
  
  dpFocus(page, sections);
}

// ─── Sidebar update callback ─────────────────────────────────────
let _sidebarUpdateCb: (() => void) | null = null;

export function onSidebarUpdate(cb: () => void): void {
  _sidebarUpdateCb = cb;
}

function notifySidebarUpdate(): void {
  _sidebarUpdateCb?.();
}

// ─── Init ────────────────────────────────────────────────────────
export function initKategorie(): void {
  view = 'list';
  detailId = null;
  render();
}

export function refreshKategorie(): void {
  const page = document.getElementById("page-kategorie")!;
  if (!page.classList.contains("hidden")) {
    if (view === 'detail') {
      render();
    } else {
      render();
    }
  }
}

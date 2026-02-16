import {
  getCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  getMaterialCountByCategory,
} from "./store";
import { esc, openModal, closeModal, showToast } from "./ui";

// ─── Render ──────────────────────────────────────────────────────
function render(): void {
  const page = document.getElementById("page-kategorie")!;
  const categories = getCategories();

  document.getElementById("topbar-title")!.textContent = "Kategorie";
  document.getElementById("topbar-actions")!.innerHTML = `
    <button class="btn btn-primary" id="btn-add-category">
      <i class="fa-solid fa-plus"></i> Nowa kategoria
    </button>
  `;
  document.getElementById("btn-add-category")!.addEventListener("click", () => openCategoryModal());

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
    document.getElementById("btn-empty-add-cat")!.addEventListener("click", () => openCategoryModal());
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
      const cat = getCategories().find((c) => c.id === id);
      if (cat) openCategoryModal(cat);
    });
  });

  page.querySelectorAll<HTMLButtonElement>("[data-cat-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.catDelete!);
      const count = getMaterialCountByCategory(id);
      const msg = count > 0
        ? `Ta kategoria ma ${count} materiałów. Materiały stracą kategorię. Usunąć?`
        : "Na pewno usunąć tę kategorię?";
      if (!confirm(msg)) return;
      deleteCategory(id);
      showToast("Kategoria usunięta");
      render();
      notifySidebarUpdate();
    });
  });
}

// ─── Category modal ──────────────────────────────────────────────
function openCategoryModal(cat?: { id: number; name: string; color: string }): void {
  const isEdit = !!cat;

  openModal(
    `
    <h2 class="modal-title">${isEdit ? "Edytuj kategorię" : "Nowa kategoria"}</h2>
    <div class="field">
      <label>Nazwa</label>
      <input type="text" id="f-cat-name" value="${esc(cat?.name ?? "")}" placeholder="np. Instalacja elektryczna" />
    </div>
    <div class="field">
      <label>Kolor</label>
      <input type="color" id="f-cat-color" value="${cat?.color ?? "#667eea"}" style="height:38px;padding:4px;cursor:pointer;" />
    </div>
    <div class="modal-footer">
      <button class="btn" id="btn-cat-cancel">Anuluj</button>
      <button class="btn btn-primary" id="btn-cat-save">${isEdit ? "Zapisz" : "Dodaj"}</button>
    </div>
  `,
    "modal-sm"
  );

  setTimeout(() => (document.getElementById("f-cat-name") as HTMLInputElement)?.focus(), 80);

  document.getElementById("btn-cat-cancel")!.addEventListener("click", closeModal);

  const save = () => {
    const name = (document.getElementById("f-cat-name") as HTMLInputElement).value.trim();
    if (!name) return;
    const color = (document.getElementById("f-cat-color") as HTMLInputElement).value;

    if (isEdit && cat) {
      updateCategory(cat.id, name, color);
      showToast("Kategoria zaktualizowana");
    } else {
      addCategory(name, color);
      showToast("Kategoria dodana");
    }

    closeModal();
    render();
    notifySidebarUpdate();
  };

  document.getElementById("btn-cat-save")!.addEventListener("click", save);
  document.getElementById("modal-box")!.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
  });
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
  render();
}

export function refreshKategorie(): void {
  const page = document.getElementById("page-kategorie")!;
  if (!page.classList.contains("hidden")) render();
}

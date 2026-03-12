// ─── Danger Modal ────────────────────────────────────────────────
// The ONLY modal remaining in the app — used for confirming destructive actions.
// Returns a Promise<boolean>: true if confirmed, false if cancelled.

import { esc, openModal, closeModal } from "./ui";

export async function dangerModal(
  title: string,
  message?: string,
  confirmLabel: string = "Usuń",
  cancelLabel: string = "Anuluj"
): Promise<boolean> {
  return new Promise((resolve) => {
    const html = `
      <h2 class="modal-title" style="color:var(--danger)">
        <i class="fa-solid fa-triangle-exclamation" style="margin-right:6px"></i>
        ${esc(title)}
      </h2>
      ${message ? `<p style="color:var(--text-secondary);margin:12px 0 0;font-size:13px;line-height:1.6">${message}</p>` : ""}
      <div class="modal-footer" style="margin-top:20px">
        <button class="btn" id="dm-cancel">${esc(cancelLabel)}</button>
        <button class="btn btn-danger" id="dm-confirm">
          <i class="fa-solid fa-trash" style="margin-right:4px"></i> ${esc(confirmLabel)}
        </button>
      </div>
    `;

    openModal(html, "modal-sm");

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cleanup(false);
    };

    const cleanup = (result: boolean) => {
      document.removeEventListener("keydown", onKey);
      closeModal();
      resolve(result);
    };

    document.getElementById("dm-cancel")!.addEventListener("click", () => cleanup(false));
    document.getElementById("dm-confirm")!.addEventListener("click", () => cleanup(true));
    document.addEventListener("keydown", onKey);
  });
}

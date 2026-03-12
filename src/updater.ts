/**
 * Auto-updater for Prosty Planer (Tauri v2)
 *
 * Sprawdza aktualizacje przy starcie apki.
 * Jeśli jest nowa wersja → pokazuje dialog → user klika → auto-instalacja + restart.
 *
 * UWAGA: "dialog": true w tauri.conf.json MUSI być usunięte!
 * Ten plik sam obsługuje dialog przez @tauri-apps/plugin-dialog.
 */

import { check } from "@tauri-apps/plugin-updater";
import { ask, message } from "@tauri-apps/plugin-dialog";

export async function checkForUpdates(silent: boolean = true): Promise<void> {
  try {
    console.log("[updater] Sprawdzam aktualizacje...");
    const update = await check();

    if (!update) {
      console.log("[updater] Brak dostępnych aktualizacji");
      if (!silent) {
        await message("Masz najnowszą wersję Prosty Planer!", {
          title: "Aktualizacja",
          kind: "info",
        });
      }
      return;
    }

    console.log(`[updater] Nowa wersja: ${update.version} (aktualna: ${update.currentVersion})`);
    console.log(`[updater] Data: ${update.date || "brak"}`);
    console.log(`[updater] Body: ${update.body || "brak"}`);

    const shouldUpdate = await ask(
      `Dostępna nowa wersja ${update.version}!\n\n` +
        `Aktualna wersja: ${update.currentVersion}\n\n` +
        `Czy chcesz zaktualizować teraz?\n` +
        `(Aplikacja zostanie zrestartowana)`,
      {
        title: "Aktualizacja Prosty Planer",
        kind: "info",
        okLabel: "Aktualizuj",
        cancelLabel: "Później",
      }
    );

    if (!shouldUpdate) {
      console.log("[updater] Użytkownik odrzucił aktualizację");
      return;
    }

    console.log("[updater] Rozpoczynam pobieranie i instalację...");

    // Po kliknięciu "Aktualizuj" ZAWSZE pokazuj błędy (niezależnie od silent)
    try {
      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            console.log(`[updater] Pobieranie rozpoczęte, rozmiar: ${contentLength} bajtów`);
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              const pct = Math.round((downloaded / contentLength) * 100);
              console.log(`[updater] Pobrano ${pct}% (${downloaded}/${contentLength})`);
            }
            break;
          case "Finished":
            console.log("[updater] Pobieranie zakończone, instaluję...");
            break;
        }
      });

      console.log("[updater] Instalacja zakończona, restartuję...");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (dlError: any) {
      console.error("[updater] Błąd pobierania/instalacji:", dlError);
      await message(
        `Nie udało się pobrać aktualizacji:\n\n${dlError?.message || dlError}\n\nSprawdź połączenie z internetem i spróbuj ponownie.`,
        { title: "Błąd aktualizacji", kind: "error" }
      );
    }
  } catch (error: any) {
    console.error("[updater] Błąd:", error);
    if (!silent) {
      await message(
        `Nie udało się sprawdzić aktualizacji:\n\n${error?.message || error}\n\nSprawdź połączenie z internetem i spróbuj ponownie.`,
        { title: "Błąd aktualizacji", kind: "error" }
      );
    }
  }
}

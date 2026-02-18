/**
 * Auto-updater for Prosty Planer (Tauri v2)
 *
 * Sprawdza aktualizacje przy starcie apki.
 * Jeśli jest nowa wersja → pokazuje dialog → user klika → auto-instalacja + restart.
 *
 * Wymaga:
 *   npm install @tauri-apps/plugin-updater @tauri-apps/plugin-dialog
 *   W Cargo.toml (src-tauri): tauri-plugin-updater, tauri-plugin-dialog
 */

import { check } from "@tauri-apps/plugin-updater";
import { ask } from "@tauri-apps/plugin-dialog";

export async function checkForUpdates(silent: boolean = true): Promise<void> {
  try {
    const update = await check();

    if (!update) {
      // No update available
      if (!silent) {
        await ask("Masz najnowszą wersję Prosty Planer!", {
          title: "Aktualizacja",
          kind: "info",
        });
      }
      return;
    }

    console.log(`Nowa wersja dostępna: ${update.version} (aktualna: ${update.currentVersion})`);

    const shouldUpdate = await ask(
      `Dostępna nowa wersja ${update.version}!\n\n` +
        `Aktualna wersja: ${update.currentVersion}\n\n` +
        `Czy chcesz zaktualizować teraz?`,
      {
        title: "Aktualizacja Prosty Planer",
        kind: "info",
        okLabel: "Aktualizuj",
        cancelLabel: "Później",
      }
    );

    if (shouldUpdate) {
      console.log("Pobieram aktualizację...");
      // Download and install
      await update.downloadAndInstall();
      // Restart the app
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    }
  } catch (error) {
    console.error("Błąd sprawdzania aktualizacji:", error);
    // Silently fail on auto-check, show error on manual check
    if (!silent) {
      await ask(`Nie udało się sprawdzić aktualizacji: ${error}`, {
        title: "Błąd",
        kind: "error",
      });
    }
  }
}

/**
 * Call this on app startup in main.ts:
 *
 *   import { checkForUpdates } from "./updater";
 *   checkForUpdates(true); // silent=true, no popup if up to date
 *
 * For manual "check for updates" button:
 *
 *   checkForUpdates(false); // shows "you're up to date" if no update
 */

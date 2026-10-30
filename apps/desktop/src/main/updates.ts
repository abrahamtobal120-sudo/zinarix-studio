import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { AppEvent } from '../shared/api.js';

/** How often an open app looks for a new version. */
const EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Automatic updates from the GitHub releases (the "publish" config of electron-builder):
 * an installed app downloads a new version in the background and offers to restart into
 * it. Development runs (`pnpm desktop`) and portable copies without an update feed skip
 * it; failures (offline, an unsigned macOS build) are logged and never shown as errors.
 */
export function startUpdates(
  emit: (ev: AppEvent) => void,
): { install(): void; check(): Promise<boolean> } | undefined {
  if (!app.isPackaged || process.env.ZINARIX_NO_UPDATES) return undefined;
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('update-available', (info) =>
    emit({ type: 'update', state: 'available', version: info.version }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    emit({ type: 'update', state: 'ready', version: info.version }),
  );
  // Offline, no release yet, an unsigned macOS build: not worth bothering the user.
  autoUpdater.on('error', () => undefined);
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  setTimeout(check, 10_000);
  setInterval(check, EVERY_MS).unref();
  return {
    install: () => autoUpdater.quitAndInstall(false, true),
    /** true when a newer version was found (it downloads and announces itself). */
    check: async () => {
      try {
        const r = await autoUpdater.checkForUpdates();
        return Boolean(r?.isUpdateAvailable);
      } catch {
        return false;
      }
    },
  };
}

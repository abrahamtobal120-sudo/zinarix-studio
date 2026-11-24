import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { AppEvent } from '../shared/api.js';
import { logInfo, logWarn } from './log.js';

/** How often an open app looks for a new version. */
const EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Automatic updates from the GitHub releases (the "publish" config of electron-builder):
 * an installed app downloads a new version in the background and offers to restart into
 * it. Development runs (`pnpm desktop`) and portable copies without an update feed skip
 * it; failures (offline, an unsigned macOS build) go to the log file and are never shown as
 * errors.
 */
export function startUpdates(
  /** The edition's update feed (`latest`, `pro`, `ai`, `proai`): each app updates itself. */
  channel: string,
  emit: (ev: AppEvent) => void,
): { install(): void; check(): Promise<boolean> } | undefined {
  if (!app.isPackaged || process.env.ZINARIX_NO_UPDATES) return undefined;
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  if (channel !== 'latest') {
    autoUpdater.channel = channel;
    // Setting a channel turns downgrades on; an edition only ever moves forward.
    autoUpdater.allowDowngrade = false;
  }
  autoUpdater.on('update-available', (info) =>
    emit({ type: 'update', state: 'available', version: info.version }),
  );
  autoUpdater.on('update-downloaded', (info) => {
    logInfo('updates', `downloaded ${info.version}`);
    emit({ type: 'update', state: 'ready', version: info.version });
  });
  // Offline, no release yet, an unsigned macOS build: not worth bothering the user, but the
  // reason is kept in the log (an app that silently never updates is a security problem).
  const failed = (e: unknown) => logWarn('updates', e instanceof Error ? e.message : String(e));
  autoUpdater.on('error', failed);
  const check = () => void autoUpdater.checkForUpdates().catch(failed);
  setTimeout(check, 10_000);
  setInterval(check, EVERY_MS).unref();
  return {
    install: () => autoUpdater.quitAndInstall(false, true),
    /** true when a newer version was found (it downloads and announces itself). */
    check: async () => {
      try {
        const r = await autoUpdater.checkForUpdates();
        return Boolean(r?.isUpdateAvailable);
      } catch (e) {
        failed(e);
        return false;
      }
    },
  };
}

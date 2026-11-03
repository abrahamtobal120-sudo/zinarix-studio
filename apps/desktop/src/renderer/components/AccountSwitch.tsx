import type { ReactNode } from 'react';
import { t } from '../i18n';

/**
 * Account bar of a service panel: the active account (a picker when there are several),
 * "+ Add account" and disconnect. Switching and adding remount the panel, so nothing of the
 * previous account stays on screen.
 */
export function AccountSwitch({
  icon,
  label,
  title,
  accounts,
  active,
  busy,
  onUse,
  onAdd,
  onLogout,
}: {
  icon: ReactNode;
  label: string;
  title?: string;
  accounts: { id: string; label: string }[];
  active: string | null;
  busy: boolean;
  onUse: (id: string) => void;
  /** Missing: this account can't be added to from the app (e.g. a CLI login). */
  onAdd?: () => void;
  /** Missing: nothing to disconnect here. */
  onLogout?: () => void;
}) {
  return (
    <div className="git-branchbar">
      {accounts.length > 1 && active ? (
        <select
          className="git-branch acct-select"
          title={t('acctSwitch')}
          value={active}
          disabled={busy}
          onChange={(e) => onUse(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id === active ? label : a.label || a.id}
            </option>
          ))}
        </select>
      ) : (
        <span className="git-branch" title={title}>
          {icon} {label}
        </span>
      )}
      <span className="spacer" />
      {onAdd && (
        <button className="link" title={t('acctAddTitle')} disabled={busy} onClick={onAdd}>
          {t('acctAdd')}
        </button>
      )}
      {onLogout && (
        <button className="link" disabled={busy} onClick={onLogout}>
          {t('vcLogout')}
        </button>
      )}
    </div>
  );
}

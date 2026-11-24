import { Component, type ErrorInfo, type ReactNode } from 'react';
import { api } from '../store';
import { t } from '../i18n';

interface Props {
  /** Name of the area, for the log ("chat", "editor", "sidebar:git"…). */
  scope: string;
  /** Changing it clears the error (e.g. the side bar showing another panel). */
  resetKey?: unknown;
  /** The whole app failed: offer to reload the window instead of retrying one area. */
  root?: boolean;
  /** Areas that are not a visible box (dialogs, floating helpers) show nothing when they fail. */
  silent?: boolean;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Sends an error of the interface to the app's log file. Never throws. */
export function reportError(scope: string, error: unknown, extra = ''): void {
  try {
    const text =
      error instanceof Error ? error.stack || `${error.name}: ${error.message}` : String(error);
    void api()
      .app.logError(scope.slice(0, 60), `${text}${extra}`.slice(0, 16_000))
      .catch(() => undefined);
  } catch {
    // no bridge (tests): nothing to log to
  }
}

/**
 * C1: an error while rendering one area (a panel, the chat, the editor) stays in that area:
 * the rest of the app keeps working, the error goes to the log file, and the user can retry.
 * Without it React unmounts the whole tree and the window goes blank, unsaved files included.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(this.props.scope, error, info.componentStack ?? '');
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.silent) return null;
    return (
      <div
        className={this.props.root ? 'error-boundary error-boundary-root' : 'error-boundary'}
        role="alert"
      >
        <div className="error-boundary-title">{t(this.props.root ? 'appCrash' : 'panelCrash')}</div>
        <div className="error-boundary-hint">{t('panelCrashHint')}</div>
        <pre className="error-boundary-detail">{error.message}</pre>
        <div className="error-boundary-actions">
          {this.props.root ? (
            <button className="primary" onClick={() => location.reload()}>
              {t('panelReload')}
            </button>
          ) : (
            <button className="primary" onClick={() => this.setState({ error: null })}>
              {t('panelRetry')}
            </button>
          )}
          <button
            onClick={() =>
              void api()
                .app.exportDiagnostics()
                .catch(() => undefined)
            }
          >
            {t('exportDiagnostics')}
          </button>
        </div>
      </div>
    );
  }
}

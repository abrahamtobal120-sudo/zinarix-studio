import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './monaco';
import './ui/tokens.css';
import './styles';
import { App } from './App';
import { ErrorBoundary, reportError } from './components/ErrorBoundary';
import { lang } from './i18n';

// index.html says "es"; the page takes the language the UI is actually shown in.
document.documentElement.lang = lang;

// Errors outside React's render (event handlers, promises) leave a trace in the log file.
window.addEventListener('error', (e) => reportError('window', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportError('promise', e.reason));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary scope="app" root>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

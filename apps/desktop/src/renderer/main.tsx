import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './monaco';
import './styles.css';
import { App } from './App';
import { lang } from './i18n';

// index.html says "es"; the page takes the language the UI is actually shown in.
document.documentElement.lang = lang;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

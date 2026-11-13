import tls from 'node:tls';

/**
 * Makes Node's TLS (fetch, https) also trust the operating system's certificate store, like
 * Chromium does. Antivirus, corporate proxies and inspection tools install their own root
 * certificate in Windows/macOS; without this every API call from the main process fails with
 * UNABLE_TO_GET_ISSUER_CERT_LOCALLY (tokens can't be verified, so nothing gets saved).
 * Imported first by main.ts so it runs before any connection is opened.
 */
try {
  const system = tls.getCACertificates('system');
  if (system.length)
    tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...system])]);
} catch (e) {
  // Older runtime or unreadable store: keep Node's bundled list.
  console.warn('[system-ca] could not load the system certificate store:', e);
}

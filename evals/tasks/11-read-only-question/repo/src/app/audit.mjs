import { auditMetrics } from '../infra/metrics.mjs';

// Text summary for the admin page. Does not touch the disk.
export function auditSummary(events) {
  for (const e of events) auditMetrics(e.kind);
  return events.map((e) => e.kind + ': ' + e.detail).join('\n');
}

export function writeAuditHeader(title) {
  return '== ' + title + ' ==';
}

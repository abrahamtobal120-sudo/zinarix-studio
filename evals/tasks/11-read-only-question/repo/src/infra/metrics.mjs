// Counters kept in memory only.
const counters = new Map();

export function auditMetrics(kind) {
  counters.set(kind, (counters.get(kind) ?? 0) + 1);
  return counters.get(kind);
}

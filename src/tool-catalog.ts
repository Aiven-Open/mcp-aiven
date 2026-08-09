import { createHash } from 'node:crypto';
import type { ToolDefinition } from './types.js';

export interface CatalogSummary {
  count: number;
  /** Short hash of the sorted tool names — same tools always give the same value. */
  fingerprint: string;
  names: string[];
}

/**
 * Summarise a tool list so two processes can be compared with a single value.
 *
 * The catalog depends on env that is resolved once at startup (e.g. the docs tools
 * are skipped when AIVEN_DOCS_* is unset), so instances can legitimately disagree
 * without any code or config difference. The fingerprint makes that visible.
 */
export function summarizeCatalog(tools: readonly ToolDefinition[]): CatalogSummary {
  const names = tools.map((t) => t.name).sort();
  const fingerprint = createHash('sha256').update(names.join(',')).digest('hex').slice(0, 8);
  return { count: names.length, fingerprint, names };
}

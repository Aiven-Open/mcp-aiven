/**
 * Tag-based operation categorization
 *
 * Includes all operations whose tags match core/pg/kafka.
 * Overlay descriptions are optional enrichment, not a gate.
 */

import type { ParsedOperation } from './parser.js';

export const SERVICE_CATEGORIES = ['core', 'pg', 'kafka'] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export type CategorizedOperations = {
  [K in ServiceCategory]?: ParsedOperation[];
};

export enum ApiTag {
  ServicePostgreSQL = 'Service:_PostgreSQL',
  ServiceKafka = 'Service:_Kafka',
  Project = 'Project',
  Service = 'Service',
  CloudPlatforms = 'Cloud_platforms',
}

const TAG_TO_CATEGORY: Record<ApiTag, ServiceCategory> = {
  [ApiTag.ServicePostgreSQL]: 'pg',
  [ApiTag.ServiceKafka]: 'kafka',
  [ApiTag.Project]: 'core',
  [ApiTag.Service]: 'core',
  [ApiTag.CloudPlatforms]: 'core',
};

export function categorizeOperations(operations: ParsedOperation[]): CategorizedOperations {
  const result: CategorizedOperations = {};
  let excludedCount = 0;

  for (const op of operations) {
    if (op.excluded) {
      excludedCount++;
      continue;
    }

    if (op.category && SERVICE_CATEGORIES.includes(op.category as ServiceCategory)) {
      const cat = op.category as ServiceCategory;
      if (!result[cat]) result[cat] = [];
      result[cat].push(op);
      continue;
    }

    let matched = false;
    for (const tag of op.tags) {
      const normalized = tag.replace(/\s+/g, '_');
      const category =
        normalized in TAG_TO_CATEGORY ? TAG_TO_CATEGORY[normalized as ApiTag] : undefined;
      if (category) {
        if (!result[category]) result[category] = [];
        result[category].push(op);
        matched = true;
        break;
      }
    }

    if (!matched) {
      excludedCount++;
    }
  }

  for (const [category, ops] of Object.entries(result)) {
    if (ops.length > 0) {
      console.log(`  ${category}: ${ops.length} operations`);
    }
  }
  if (excludedCount > 0) {
    console.log(`  excluded: ${excludedCount} operations`);
  }

  return result;
}

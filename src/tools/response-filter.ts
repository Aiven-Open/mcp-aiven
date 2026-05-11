import { z } from 'zod';
import type { ResponseFilterConfig } from '../types.js';

const SEARCH_PARAMS = new Set(['search', 'limit', 'offset']);
export const DEFAULT_LIST_LIMIT = 15;
const AUTO_RETURN_ALL_THRESHOLD = 30;

export function extendSchemaWithSearch(
  baseSchema: z.ZodType,
  config: ResponseFilterConfig
): z.ZodType {
  if (!(baseSchema instanceof z.ZodObject)) return baseSchema;
  const extra: Record<string, z.ZodType> = {};

  if (config.search_fields?.length) {
    const fieldList = config.search_fields.join('`, `');
    extra['search'] = z
      .string()
      .optional()
      .describe(
        `Case-insensitive substring filter. Matches against \`${fieldList}\`. ` +
          'Only items containing this string are returned.'
      );
    extra['limit'] = z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(`Max items to return. Do NOT set this unless the user explicitly asked for a specific number of results.`);
    extra['offset'] = z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(`Number of items to skip for pagination. Use the value from the \`next_offset\` field in a previous response to fetch the next page.`);
  }

  if (Object.keys(extra).length === 0) return baseSchema;
  return baseSchema.extend(extra).passthrough();
}

export function stripSearchParams(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(([key]) => !SEARCH_PARAMS.has(key))
  );
}

function pickFields(
  item: Record<string, unknown>,
  allowlist: Set<string>
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([key]) => allowlist.has(key)));
}

export function applyResponseFilter(
  data: Record<string, unknown>,
  config: ResponseFilterConfig,
  search: string | undefined,
  limit: number | undefined,
  offset: number | undefined
): Record<string, unknown> {
  const value = data[config.key];

  // Field filtering on a single object (e.g. aiven_service_create response)
  if (config.fields && !Array.isArray(value) && typeof value === 'object' && value !== null) {
    const allowlist = new Set(config.fields);
    return { [config.key]: pickFields(value as Record<string, unknown>, allowlist) };
  }

  if (!Array.isArray(value)) return data;

  let items = value;

  // Field filtering: strip columns
  if (config.fields) {
    const allowlist = new Set(config.fields);
    items = items.map((item: Record<string, unknown>) => pickFields(item, allowlist));
  }

  // If no search capabilities configured, return field-filtered data as-is
  if (!config.search_fields && config.default_limit === undefined) {
    return { ...data, [config.key]: items };
  }

  const isStringArray = items.length > 0 && typeof items[0] === 'string';

  // Search filtering: match rows
  let filtered = items;
  if (search && config.search_fields && config.search_fields.length) {
    const needle = search.toLowerCase();
    const searchFields = config.search_fields;
    filtered = isStringArray
      ? items.filter((item: string) => item.toLowerCase().includes(needle))
      : items.filter((item: Record<string, unknown>) =>
          searchFields.some((field) => {
            const val = item[field];
            return typeof val === 'string' && val.toLowerCase().includes(needle);
          })
        );
  }

  // total = after all filtering, before pagination
  const total = filtered.length;
  const cap = Math.min(limit ?? config.default_limit ?? (total <= AUTO_RETURN_ALL_THRESHOLD ? total : DEFAULT_LIST_LIMIT), 100);
  const pageStart = offset ?? 0;
  const sliced = filtered.slice(pageStart, pageStart + cap);
  const hasMore = pageStart + sliced.length < total;

  const result: Record<string, unknown> = {
    showing: sliced.length,
    total,
    ...(offset !== undefined && offset > 0 && { offset }),
    [config.key]: sliced,
  };

  if (hasMore) {
    const nextOffset = pageStart + sliced.length;
    result['next_offset'] = nextOffset;
    const largeWarning = total > 100
      ? ` WARNING: ${total} items exist — fetching all would flood the context. Do NOT offer to fetch all or increase the limit.`
      : '';
    result['hint'] = search
      ? `Showing ${sliced.length} of ${total} matches. Offer the user to refine the search or see the next page (\`offset: ${nextOffset}\`). Do NOT fetch more pages automatically.${largeWarning}`
      : `Showing items ${pageStart + 1}–${pageStart + sliced.length} of ${total}. Ask the user what they are looking for, or offer to show the next page (\`offset: ${nextOffset}\`). Do NOT auto-paginate or increase limit without being asked.${largeWarning}`;
  }

  return result;
}

import { z } from 'zod';
import type { ApiToolConfig } from '../types.js';

/**
 * Cloud filtering and sorting for `aiven_service_type_plans`.
 *
 * Each plan's `regions` maps every cloud that offers it to disk, node, and price details.
 * `regions` is returned only when `cloud` is set: plans are narrowed to matching clouds,
 * each keeping `price_usd`, and plans with no match are dropped. This runs before the
 * response filter, so `search`, `total`, and pagination see the narrowed list.
 */

const PLANS_TOOL_NAME = 'aiven_service_type_plans';
const CLOUD_PARAM = 'cloud';
const SORT_BY_PARAM = 'sort_by';
const SORT_ORDER_PARAM = 'sort_order';
const REGION_FIELDS = ['price_usd'] as const;

const plansFilterSchema = z.object({
  [CLOUD_PARAM]: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      'Case-insensitive substring(s) of cloud names, e.g. `google-europe-west1` or ' +
        '`["aws-eu-", "google-europe-", "upcloud-"]`. A string that is a JSON array of strings ' +
        'is read as that array. When set, each plan includes `regions` with matching clouds and ' +
        'their hourly `price_usd`, and plans offered in none of them are omitted. When omitted, ' +
        '`regions` is not returned.'
    ),
  [SORT_BY_PARAM]: z
    .literal('min_price')
    .optional()
    .describe(
      'Sort plans before pagination by their lowest price in the matching regions. ' +
        '`min_price` requires at least one `cloud` filter and returns an error without it.'
    ),
  [SORT_ORDER_PARAM]: z
    .enum(['asc', 'desc'])
    .default('asc')
    .describe('Sort direction. Defaults to `asc`.'),
});

export function plansConfigOverrides(
  toolName: string,
  baseSchema: z.ZodType
): Partial<Pick<ApiToolConfig, 'inputSchema' | 'preFilter' | 'clientOnlyParams'>> {
  if (toolName !== PLANS_TOOL_NAME) return {};
  return {
    inputSchema: extendPlansSchema(baseSchema),
    preFilter: preparePlansResponse,
    clientOnlyParams: [CLOUD_PARAM, SORT_BY_PARAM, SORT_ORDER_PARAM],
  };
}

function extendPlansSchema(baseSchema: z.ZodType): z.ZodType {
  if (!(baseSchema instanceof z.ZodObject)) return baseSchema;
  return baseSchema.extend(plansFilterSchema.shape).passthrough();
}

export function preparePlansResponse(
  data: Record<string, unknown>,
  args: Record<string, unknown>
): Record<string, unknown> {
  const plans = data['service_plans'];
  if (!Array.isArray(plans)) return data;

  const { cloud, sort_by: sortBy, sort_order: sortOrder } = plansFilterSchema.parse(args);
  const cloudFilters = normalizeCloudFilters(cloud);
  if (sortBy === 'min_price' && cloudFilters.length === 0) {
    throw new Error('`sort_by: "min_price"` requires at least one `cloud` filter.');
  }

  if (cloudFilters.length === 0) {
    return {
      ...data,
      service_plans: plans.filter(isRecord).map(withoutRegions),
    };
  }

  const filtered: Record<string, unknown>[] = [];
  for (const plan of plans) {
    if (!isRecord(plan)) continue;
    const { regions, ...rest } = plan;
    const matched = matchingRegions(regions, cloudFilters);
    if (Object.keys(matched).length === 0) continue;
    filtered.push({ ...rest, regions: matched });
  }

  return {
    ...data,
    service_plans:
      sortBy === 'min_price' ? sortPlansByMinimumPrice(filtered, sortOrder) : filtered,
  };
}

function withoutRegions(plan: Record<string, unknown>): Record<string, unknown> {
  const result = { ...plan };
  delete result['regions'];
  return result;
}

function normalizeCloudFilters(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : cloudFiltersFromString(value);
  return values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '');
}

/** A JSON array of strings is a real filter list. Any other string stays one substring. */
function cloudFiltersFromString(value: string | undefined): string[] {
  if (value === undefined) return [];
  const trimmed = value.trim();
  // A normal cloud substring, not a JSON array.
  if (!trimmed.startsWith('[')) return [value];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Not JSON. Keep the original string, including its brackets.
    return [value];
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    // JSON, but not an array of strings. Keep the original string.
    return [value];
  }
  return parsed;
}

function matchingRegions(
  regions: unknown,
  cloudFilters: string[]
): Record<string, Record<string, unknown>> {
  const matched: Record<string, Record<string, unknown>> = {};
  if (!isRecord(regions)) return matched;
  for (const [cloud, details] of Object.entries(regions)) {
    if (!isRecord(details)) continue;
    const name = cloud.toLowerCase();
    if (!cloudFilters.some((filter) => name.includes(filter))) continue;
    matched[cloud] = Object.fromEntries(
      REGION_FIELDS.filter((field) => field in details).map((field) => [field, details[field]])
    );
  }
  return matched;
}

function minimumRegionPrice(regions: unknown): number | undefined {
  if (!isRecord(regions)) return undefined;
  let minimum: number | undefined;
  for (const details of Object.values(regions)) {
    if (!isRecord(details)) continue;
    const price = details['price_usd'];
    if (typeof price !== 'string' && typeof price !== 'number') continue;
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice)) continue;
    if (minimum === undefined || numericPrice < minimum) minimum = numericPrice;
  }
  return minimum;
}

function sortPlansByMinimumPrice(
  plans: Record<string, unknown>[],
  sortOrder: 'asc' | 'desc'
): Record<string, unknown>[] {
  return [...plans].sort((left, right) => {
    const leftPrice = minimumRegionPrice(left['regions']);
    const rightPrice = minimumRegionPrice(right['regions']);
    if (leftPrice === undefined && rightPrice === undefined) {
      return getPlanName(left).localeCompare(getPlanName(right));
    }
    if (leftPrice === undefined) return 1;
    if (rightPrice === undefined) return -1;
    const comparison = leftPrice - rightPrice;
    if (comparison !== 0) return sortOrder === 'desc' ? -comparison : comparison;
    return getPlanName(left).localeCompare(getPlanName(right));
  });
}

function getPlanName(plan: Record<string, unknown>): string {
  return typeof plan['service_plan'] === 'string' ? plan['service_plan'] : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

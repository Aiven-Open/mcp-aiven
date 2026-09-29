import { z } from 'zod';
import type { ApiToolConfig } from '../types.js';

/**
 * Region filtering for `aiven_service_type_plans`.
 *
 * Each plan's `regions` maps every cloud that offers it (~150 in production) to disk, node,
 * and price details — several KB per plan, and projects have hundreds of plans. `regions` is
 * therefore returned only when `region` is set: plans are narrowed to the matching clouds,
 * each keeping `price_usd`, and plans with no match are dropped. This runs before the
 * response filter, so `search`, `total`, and pagination see the narrowed list.
 */

const PLANS_TOOL_NAME = 'aiven_service_type_plans';
const REGION_PARAM = 'region';
const REGION_FIELDS = ['price_usd'] as const;

export function plansConfigOverrides(
  toolName: string,
  baseSchema: z.ZodType
): Partial<Pick<ApiToolConfig, 'inputSchema' | 'preFilter' | 'clientOnlyParams'>> {
  if (toolName !== PLANS_TOOL_NAME) return {};
  return {
    inputSchema: extendPlansSchema(baseSchema),
    preFilter: filterPlansByRegion,
    clientOnlyParams: [REGION_PARAM],
  };
}

function extendPlansSchema(baseSchema: z.ZodType): z.ZodType {
  if (!(baseSchema instanceof z.ZodObject)) return baseSchema;
  return baseSchema
    .extend({
      [REGION_PARAM]: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          'Case-insensitive substring(s) of cloud names, e.g. `google-europe-west1` or ' +
            '`["aws-eu-", "google-europe-", "upcloud-"]`. When set, each plan includes `regions` ' +
            'with the matching clouds and their hourly `price_usd`, and plans offered in none of ' +
            'them are omitted. When omitted, `regions` is not returned.'
        ),
    })
    .passthrough();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function regionNeedles(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v !== '');
}

function matchingRegions(
  regions: unknown,
  needles: string[]
): Record<string, Record<string, unknown>> {
  const matched: Record<string, Record<string, unknown>> = {};
  if (!isRecord(regions)) return matched;
  for (const [cloud, details] of Object.entries(regions)) {
    if (!isRecord(details)) continue;
    const name = cloud.toLowerCase();
    if (!needles.some((needle) => name.includes(needle))) continue;
    matched[cloud] = Object.fromEntries(
      REGION_FIELDS.filter((field) => field in details).map((field) => [field, details[field]])
    );
  }
  return matched;
}

export function filterPlansByRegion(
  data: Record<string, unknown>,
  args: Record<string, unknown>
): Record<string, unknown> {
  const plans = data['service_plans'];
  if (!Array.isArray(plans)) return data;

  const needles = regionNeedles(args[REGION_PARAM]);
  const filtered: unknown[] = [];
  for (const plan of plans) {
    if (!isRecord(plan)) continue;
    const { regions, ...rest } = plan;
    if (needles.length === 0) {
      filtered.push(rest);
      continue;
    }
    const matched = matchingRegions(regions, needles);
    if (Object.keys(matched).length > 0) filtered.push({ ...rest, regions: matched });
  }

  return { ...data, service_plans: filtered };
}

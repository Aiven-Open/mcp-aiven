import { z } from 'zod';
import type { ApiToolConfig } from '../types.js';

/**
 * Response shaping for `aiven_service_type_plans`.
 *
 * The plans API returns every cloud inside `regions`, with disk, node, and price fields.
 * This override keeps each region as hourly `price_usd`. `plan` and `region` narrow the list
 * when the user already named a plan or a cloud. Both arguments stay off the Aiven request.
 */

const PLANS_TOOL_NAME = 'aiven_service_type_plans';
const PLAN_PARAM = 'plan';
const REGION_PARAM = 'region';

const plansFilterSchema = z.object({
  [PLAN_PARAM]: z
    .string()
    .optional()
    .catch(undefined)
    .describe(
      'Case-insensitive substring of the plan name (for example `business`). ' +
        'Set when the user has said which plan they would prefer. Otherwise omit.'
    ),
  [REGION_PARAM]: z
    .string()
    .optional()
    .catch(undefined)
    .describe(
      'Case-insensitive substring of a cloud name (for example `aws-eu-north` or `google-europe`). ' +
        'Set when the user has given a cloud constraint. Matching regions are kept with hourly `price_usd`. Otherwise omit.'
    ),
});

export function plansConfigOverrides(
  toolName: string,
  baseSchema: z.ZodType
): Partial<Pick<ApiToolConfig, 'inputSchema' | 'postProcess' | 'clientOnlyParams'>> {
  if (toolName !== PLANS_TOOL_NAME) return {};
  return {
    inputSchema: extendPlansSchema(baseSchema),
    postProcess: shapePlansResponse,
    clientOnlyParams: [PLAN_PARAM, REGION_PARAM],
  };
}

function extendPlansSchema(baseSchema: z.ZodType): z.ZodType {
  if (!(baseSchema instanceof z.ZodObject)) return baseSchema;
  return baseSchema.extend(plansFilterSchema.shape).passthrough();
}

export function shapePlansResponse(
  data: Record<string, unknown>,
  args: Record<string, unknown>
): Record<string, unknown> {
  const plans = data['service_plans'];
  if (!Array.isArray(plans)) return data;

  const { plan: planQuery, region: regionQuery } = plansFilterSchema.parse(args);

  const shaped: Record<string, unknown>[] = [];
  for (const plan of plans as Record<string, unknown>[]) {
    if (!planMatchesSearch(plan, planQuery)) continue;
    const filtered = filterPlanClouds(plan, regionQuery);
    if (filtered) shaped.push(filtered);
  }

  return { ...data, service_plans: shaped };
}

function planMatchesSearch(plan: Record<string, unknown>, planQuery: string | undefined): boolean {
  if (!planQuery) return true;
  const name = plan['service_plan'];
  return typeof name === 'string' && name.toLowerCase().includes(planQuery.toLowerCase());
}

/** Keep every region, or only those whose name contains `regionQuery`. Each entry is hourly `price_usd`. */
function filterPlanClouds(
  plan: Record<string, unknown>,
  regionQuery: string | undefined
): Record<string, unknown> | undefined {
  const regions: Record<string, unknown> = {};
  for (const [key, value] of regionEntries(plan)) {
    if (regionQuery && !key.toLowerCase().includes(regionQuery.toLowerCase())) continue;
    const price = regionPrice(value);
    if (price) regions[key] = price;
  }
  if (regionQuery && Object.keys(regions).length === 0) return undefined;
  return { ...plan, regions };
}

function regionEntries(plan: Record<string, unknown>): [string, unknown][] {
  const regions = plan['regions'];
  if (typeof regions !== 'object' || regions === null || Array.isArray(regions)) return [];
  return Object.entries(regions as Record<string, unknown>);
}

function regionPrice(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const price = (value as Record<string, unknown>)['price_usd'];
  return typeof price === 'string' ? { price_usd: price } : {};
}

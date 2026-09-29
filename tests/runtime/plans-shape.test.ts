import { describe, it, expect, vi } from 'vitest';
import { loadApiTools } from '../../src/tools/registry.js';
import type { AivenClient } from '../../src/client.js';
import type { ToolDefinition, ToolResult } from '../../src/types.js';

const PROVIDERS = ['aws-eu-', 'google-europe-', 'azure-', 'do-', 'upcloud-'];
const CLOUDS = PROVIDERS.flatMap((prefix) =>
  Array.from({ length: 30 }, (_, i) => `${prefix}${String(i + 1)}`)
);

function regionDetails(cloud: string, plan: number): Record<string, unknown> {
  return {
    disk_space_mb: 81920,
    node_cpu_count: 2,
    node_memory_mb: 4096,
    price_usd: `0.${String(100 + plan)}${String(cloud.length)}`,
  };
}

/** Plan `i` is `startup-i` for even `i`, else `business-i`. Every third plan runs only on `do-*`. */
function planFixture(count: number): Record<string, unknown> {
  return {
    service_plans: Array.from({ length: count }, (_, i) => {
      const clouds = i % 3 === 0 ? CLOUDS.filter((c) => c.startsWith('do-')) : CLOUDS;
      return {
        service_plan: `${i % 2 === 0 ? 'startup' : 'business'}-${String(i)}`,
        service_type: 'pg',
        node_count: 1,
        backup_config: { interval: 24 },
        regions: Object.fromEntries(clouds.map((c) => [c, regionDetails(c, i)])),
      };
    }),
  };
}

function createClient(data: unknown): AivenClient {
  return {
    get: vi.fn().mockResolvedValue(data),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    request: vi.fn(),
  } as unknown as AivenClient;
}

function plansTool(client: AivenClient): ToolDefinition {
  const tool = loadApiTools(client).find((t) => t.name === 'aiven_service_type_plans');
  if (!tool) throw new Error('aiven_service_type_plans not loaded');
  return tool;
}

function resultText(result: ToolResult): string {
  const first = result.content[0];
  return first?.type === 'text' ? first.text : '';
}

function parse(result: ToolResult): Record<string, unknown> {
  const match = resultText(result).match(
    /<untrusted-aiven-response-[^>]+>\n([\s\S]*?)\n<\/untrusted-aiven-response-/
  );
  return JSON.parse(match?.[1] ?? '') as Record<string, unknown>;
}

function planNames(body: Record<string, unknown>): string[] {
  return (body['service_plans'] as Record<string, unknown>[]).map((p) => String(p['service_plan']));
}

const baseArgs = { project: 'my-project', service_type: 'pg' };

describe('aiven_service_type_plans', () => {
  it('paginates plan names without regions when region is omitted', async () => {
    const tool = plansTool(createClient(planFixture(300)));

    const result = await tool.handler(baseArgs);
    const body = parse(result);

    expect(body['total']).toBe(300);
    expect(body['showing']).toBe(15);
    expect(body['next_offset']).toBe(15);
    expect(body['service_plans']).toEqual(
      Array.from({ length: 15 }, (_, i) => ({
        service_plan: `${i % 2 === 0 ? 'startup' : 'business'}-${String(i)}`,
      }))
    );
    expect(resultText(result).length).toBeLessThan(3000);
  });

  it('keeps search and offset paging over plan names', async () => {
    const tool = plansTool(createClient(planFixture(300)));

    const body = parse(await tool.handler({ ...baseArgs, search: 'business', offset: 15 }));

    expect(body['total']).toBe(150);
    expect(body['offset']).toBe(15);
    expect(planNames(body)[0]).toBe('business-31');
    expect(body['next_offset']).toBe(30);
  });

  it('filters plans by region before paginating and keeps only price_usd per matching cloud', async () => {
    const tool = plansTool(createClient(planFixture(300)));

    const result = await tool.handler({ ...baseArgs, region: ['AWS-EU-', 'google-europe-'] });
    const body = parse(result);

    expect(body['total']).toBe(200);
    expect(body['showing']).toBe(15);
    expect(body['next_offset']).toBe(15);
    const plans = body['service_plans'] as Record<string, unknown>[];
    expect(planNames(body).slice(0, 3)).toEqual(['business-1', 'startup-2', 'startup-4']);
    for (const plan of plans) {
      expect(Object.keys(plan).sort()).toEqual(['regions', 'service_plan']);
      const regions = plan['regions'] as Record<string, Record<string, unknown>>;
      expect(Object.keys(regions)).toHaveLength(60);
      expect(Object.keys(regions).every((c) => /^(aws-eu-|google-europe-)/.test(c))).toBe(true);
      expect(Object.values(regions).every((r) => Object.keys(r).join() === 'price_usd')).toBe(true);
    }
    expect(resultText(result)).not.toContain('Trimmed');
  });

  it('accepts a single region string and combines it with search', async () => {
    const tool = plansTool(createClient(planFixture(300)));

    const body = parse(await tool.handler({ ...baseArgs, search: 'startup', region: 'do-1' }));

    expect(body['total']).toBe(150);
    const first = (body['service_plans'] as Record<string, unknown>[])[0];
    expect(first).toEqual({
      service_plan: 'startup-0',
      regions: Object.fromEntries(
        CLOUDS.filter((c) => c.startsWith('do-1')).map((c) => [
          c,
          { price_usd: regionDetails(c, 0)['price_usd'] },
        ])
      ),
    });
  });

  it('returns an empty list when no plan runs in the requested clouds', async () => {
    const tool = plansTool(createClient(planFixture(30)));

    const body = parse(await tool.handler({ ...baseArgs, region: 'exoscale-' }));

    expect(body['total']).toBe(0);
    expect(body['service_plans']).toEqual([]);
  });

  it('does not forward region, search, limit or offset to the Aiven API', async () => {
    const client = createClient(planFixture(30));
    const tool = plansTool(client);

    await tool.handler({ ...baseArgs, region: ['aws-eu-'], search: 'startup', limit: 5, offset: 5 });

    expect(client.get).toHaveBeenCalledWith(
      '/project/my-project/service-types/pg/plans',
      expect.not.objectContaining({ query: expect.anything() as unknown })
    );
  });
});

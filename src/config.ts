import { createRequire } from 'node:module';
import type { AivenConfig } from './types.js';
import { ServiceCategory } from './types.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
export const VERSION = pkg.version;
// export const API_ORIGIN = process.env['AIVEN_API_ORIGIN'] ?? 'https://api.aiven.io';
export const API_ORIGIN = 'https://public-aiven-rest-aiven-public-yonatan-dvir-test.a.avns.net';
export const API_BASE_URL = `${API_ORIGIN}/v1`;
export const HOST = process.env['MCP_HOST'] ?? 'https://mcp.aiven.live';

/** HTTP POST /mcp rate limit (per bearer token hash, else per client IP). */
export interface HttpMcpRateLimitConfig {
  windowMs: number;
  limit: number;
}

function parsePositiveIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

export function loadHttpMcpRateLimit(): HttpMcpRateLimitConfig {
  return {
    windowMs: parsePositiveIntEnv('MCP_HTTP_RATE_LIMIT_WINDOW_MS', 60_000),
    limit: parsePositiveIntEnv('MCP_HTTP_RATE_LIMIT_MAX', 100),
  };
}

/** When true, Express honors X-Forwarded-For for req.ip (use behind a reverse proxy). */
export function httpTrustProxyEnabled(): boolean {
  const v = process.env['MCP_TRUST_PROXY'];
  return v === '1' || v === 'true';
}

/**
 * User-selectable scope names. Maps to ServiceCategory; `core` is always implicitly included
 * because every other category depends on `aiven_project_list` / `aiven_service_get` etc.
 */
const SCOPE_TO_CATEGORY: Record<string, ServiceCategory> = {
  core: ServiceCategory.Core,
  pg: ServiceCategory.Pg,
  kafka: ServiceCategory.Kafka,
  application: ServiceCategory.Application,
  integrations: ServiceCategory.Integrations,
};

export const VALID_SCOPES = Object.freeze(['all', ...Object.keys(SCOPE_TO_CATEGORY)]);

export function parseScopes(
  raw: string | undefined
): { categories: ReadonlySet<ServiceCategory> | undefined } | { error: string } {
  if (raw === undefined) return { categories: undefined };

  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (parts.length === 0) {
    return { error: `Empty scope list. Valid scopes: ${VALID_SCOPES.join(', ')}` };
  }

  if (parts.includes('all')) {
    if (parts.length > 1) {
      return { error: `'all' cannot be combined with other scopes` };
    }
    return { categories: undefined };
  }

  const unknown = parts.filter((p) => !(p in SCOPE_TO_CATEGORY));
  if (unknown.length > 0) {
    return {
      error: `Unknown scope(s): ${unknown.join(', ')}. Valid scopes: ${VALID_SCOPES.join(', ')}`,
    };
  }

  const set = new Set<ServiceCategory>();
  set.add(ServiceCategory.Core);
  for (const p of parts) {
    const cat = SCOPE_TO_CATEGORY[p];
    if (cat) set.add(cat);
  }
  return { categories: set };
}

export function isMaintenanceMode(): boolean {
  return process.env['MAINTENANCE_MODE'] === 'true';
}

export function loadConfig(transport: 'stdio' | 'http' = 'stdio'): AivenConfig {
  const token = process.env['AIVEN_TOKEN'];

  if (!token && transport !== 'http') {
    throw new Error(
      'AIVEN_TOKEN environment variable is required.\n' +
        'Get your token from: https://console.aiven.io/profile/auth'
    );
  }

  const readOnly = process.env['AIVEN_READ_ONLY'] === 'true';

  const parsed = parseScopes(process.env['AIVEN_SERVICES_SCOPE']);
  if ('error' in parsed) {
    throw new Error(`AIVEN_SERVICES_SCOPE: ${parsed.error}`);
  }

  return { token, readOnly, transport, categories: parsed.categories };
}

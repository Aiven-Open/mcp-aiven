import { createRequire } from 'node:module';
import type { AivenConfig } from './types.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
export const VERSION = pkg.version;
export const API_ORIGIN = process.env['AIVEN_API_ORIGIN'] ?? 'https://api.aiven.io';
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

export function loadConfig(transport: 'stdio' | 'http' = 'stdio'): AivenConfig {
  const token = process.env['AIVEN_TOKEN'];

  if (!token && transport !== 'http') {
    throw new Error(
      'AIVEN_TOKEN environment variable is required.\n' +
        'Get your token from: https://console.aiven.io/profile/auth'
    );
  }

  const readOnly = process.env['AIVEN_READ_ONLY'] === 'true';

  return { token, readOnly, transport };
}

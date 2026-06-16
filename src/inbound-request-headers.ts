import type { Request } from 'express';
import { normalizePeerIp } from './cloudflare-ips.js';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-edge-auth',
  'x-mcp-acorn-authorization',
]);

function headerValue(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw.join(', ') : raw;
}

/** Inbound request headers safe for logs (secrets redacted, keys sorted). */
export function inboundHeadersForLog(headers: Request['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(headers)) {
    const key = name.toLowerCase();
    const value = headerValue(raw);
    if (value === undefined || value.length === 0) continue;
    out[key] = SENSITIVE_HEADERS.has(key) ? `[REDACTED len=${value.length}]` : value;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export function logInboundMcpRequestHeaders(req: Request): void {
  const peer = normalizePeerIp(req.socket?.remoteAddress) ?? 'unknown';
  console.error(`mcp-aiven: POST /mcp inbound headers peer=${peer}`, inboundHeadersForLog(req.headers));
}

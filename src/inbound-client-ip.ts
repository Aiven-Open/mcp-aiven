import { isIP } from 'node:net';
import { isCloudflareAddress } from './cloudflare-ips.js';

function headerValue(headers: Record<string, string | undefined>, name: string): string | undefined {
  const direct = headers[name];
  if (typeof direct === 'string') return direct;
  const lower = headers[name.toLowerCase()];
  return typeof lower === 'string' ? lower : undefined;
}

function parseValidIp(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const ip = raw.trim();
  return ip.length > 0 && isIP(ip) !== 0 ? ip : undefined;
}

/** Leftmost hop in X-Forwarded-For (original client when appended by trusted proxies). */
export function clientIpFromForwardedFor(xForwardedFor: string): string | undefined {
  const firstHop = xForwardedFor.split(',')[0]?.trim();
  return parseValidIp(firstHop);
}

export type InboundMcpClientIpSource = 'x-forwarded-for' | 'cf-connecting-ip';

export interface InboundMcpClientIpResolution {
  clientIp?: string;
  source?: InboundMcpClientIpSource;
}

/**
 * Real end-user IP from inbound Streamable HTTP `/mcp` request headers.
 *
 * Prefer X-Forwarded-For (original client). Fall back to CF-Connecting-IP only when it
 * is not a Cloudflare edge address — some Worker paths expose the edge IP there instead
 * of the user.
 */
export function resolveInboundMcpClientIpFromHeaders(
  headers: Record<string, string | undefined>
): InboundMcpClientIpResolution {
  const fromForwardedFor = headerValue(headers, 'x-forwarded-for');
  if (fromForwardedFor !== undefined) {
    const clientIp = clientIpFromForwardedFor(fromForwardedFor);
    if (clientIp !== undefined) {
      return { clientIp, source: 'x-forwarded-for' };
    }
  }

  const cfConnectingIp = parseValidIp(headerValue(headers, 'cf-connecting-ip'));
  if (cfConnectingIp !== undefined && !isCloudflareAddress(cfConnectingIp)) {
    return { clientIp: cfConnectingIp, source: 'cf-connecting-ip' };
  }

  return {};
}

function logInboundMcpClientIpResolution(resolution: InboundMcpClientIpResolution): void {
  if (resolution.clientIp !== undefined && resolution.source !== undefined) {
    console.error(
      `mcp-aiven: X-MCP-Client-IP source=${resolution.source} ip=${resolution.clientIp}`
    );
    return;
  }
  console.error('mcp-aiven: X-MCP-Client-IP source=none (no usable x-forwarded-for or cf-connecting-ip)');
}

export function inboundMcpClientIpFromHeaders(headers: Record<string, string | undefined>): string | undefined {
  const resolution = resolveInboundMcpClientIpFromHeaders(headers);
  logInboundMcpClientIpResolution(resolution);
  return resolution.clientIp;
}

/** Streamable HTTP: inbound `/mcp` real client IP (SDK `requestInfo.headers`). */
export function inboundMcpClientIpFromRequestInfo(requestInfo: unknown): string | undefined {
  if (!requestInfo || typeof requestInfo !== 'object' || !('headers' in requestInfo)) {
    return undefined;
  }
  const headersRaw = (requestInfo as { headers: unknown }).headers;
  if (!headersRaw || typeof headersRaw !== 'object') {
    return undefined;
  }
  return inboundMcpClientIpFromHeaders(headersRaw as Record<string, string | undefined>);
}

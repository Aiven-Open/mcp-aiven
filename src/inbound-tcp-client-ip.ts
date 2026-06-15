import { isIP } from 'node:net';
import type { Request } from 'express';
import { normalizePeerIp } from './cloudflare-ips.js';

/** Real client IP from the inbound TCP peer on POST /mcp (req.socket.remoteAddress). */
export function inboundMcpClientIpFromTcpPeer(remoteAddress: string | undefined): string | undefined {
  const ip = normalizePeerIp(remoteAddress);
  if (ip === undefined) return undefined;
  return isIP(ip) !== 0 ? ip : undefined;
}

export function inboundMcpClientIpFromRequest(req: Request): string | undefined {
  return inboundMcpClientIpFromTcpPeer(req.socket.remoteAddress);
}

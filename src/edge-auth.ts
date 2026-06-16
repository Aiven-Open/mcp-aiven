import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { logInboundMcpRequestHeaders } from './inbound-request-headers.js';

/** Header set by Cloudflare Transform Rules on the path to this server. */
export const EDGE_AUTH_HEADER = 'x-edge-auth';

function secureCompare(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function hasValidEdgeAuth(req: Request, expectedSecret: string): boolean {
  const header = req.headers[EDGE_AUTH_HEADER];
  if (typeof header !== 'string' || header.length === 0) return false;
  return secureCompare(header, expectedSecret);
}

export function edgeAuthRejectionReason(req: Request): 'missing' | 'invalid' {
  const header = req.headers[EDGE_AUTH_HEADER];
  if (typeof header !== 'string' || header.length === 0) return 'missing';
  return 'invalid';
}

export function createEdgeAuthMiddleware(edgeAuthSecret: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!edgeAuthSecret) {
      next();
      return;
    }
    if (!hasValidEdgeAuth(req, edgeAuthSecret)) {
      const reason = edgeAuthRejectionReason(req);
      const header = req.headers[EDGE_AUTH_HEADER];
      const headerLen = typeof header === 'string' ? header.length : 0;
      console.warn(
        `mcp-aiven: rejected request: X-Edge-Auth ${reason}` +
          ` (headerLen=${headerLen} expectedLen=${edgeAuthSecret.length}) ${req.method} ${req.path}`
      );
      logInboundMcpRequestHeaders(req);
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}

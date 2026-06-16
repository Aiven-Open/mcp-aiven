import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/** Header set by Cloudflare Transform Rules (`X-Edge-Auth`); compared to `MCP_EDGE_AUTH_SECRET`. */
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

export function createEdgeAuthMiddleware(
  extraProtection: boolean,
  edgeAuthSecret: string | undefined
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!extraProtection) {
      next();
      return;
    }
    if (req.method === 'GET' && req.path === '/health') {
      next();
      return;
    }
    if (!edgeAuthSecret || !hasValidEdgeAuth(req, edgeAuthSecret)) {
      console.warn(
        `mcp-aiven: rejected request: missing or invalid X-Edge-Auth ${req.method} ${req.path}`
      );
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}

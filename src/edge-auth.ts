import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/** Header set by Cloudflare Transform Rules (`X-Edge-Auth`); compared to `MCP_EDGE_AUTH_SECRET`. */
export const EDGE_AUTH_HEADER = 'x-edge-auth';

/** Min interval between misconfig warnings while rejections continue. */
export const EDGE_AUTH_MISCONFIG_WARN_COOLDOWN_MS = 15 * 60 * 1000;

let lastMisconfigWarnAt = 0;

/** Resets deduped misconfig warning state (for tests). */
export function resetEdgeAuthMisconfigWarnCooldown(): void {
  lastMisconfigWarnAt = 0;
}

function secureCompare(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function shouldLogMisconfigWarn(now: number): boolean {
  return (
    lastMisconfigWarnAt === 0 || now - lastMisconfigWarnAt >= EDGE_AUTH_MISCONFIG_WARN_COOLDOWN_MS
  );
}

function logEdgeAuthMisconfig(req: Request): void {
  const now = Date.now();
  if (!shouldLogMisconfigWarn(now)) return;

  lastMisconfigWarnAt = now;
  console.warn(
    `mcp-aiven: EXTRA_PROTECTION is enabled but X-Edge-Auth is missing or invalid — ` +
      `verify MCP_EDGE_AUTH_SECRET matches the Cloudflare Transform Rule (${req.method} ${req.path}); ` +
      `further warnings suppressed for ${String(EDGE_AUTH_MISCONFIG_WARN_COOLDOWN_MS / 60_000)}m`
  );
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
      logEdgeAuthMisconfig(req);
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    lastMisconfigWarnAt = 0;
    next();
  };
}

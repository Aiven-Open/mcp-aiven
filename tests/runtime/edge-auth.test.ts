import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  createEdgeAuthMiddleware,
  hasValidEdgeAuth,
  resetEdgeAuthMisconfigWarnCooldown,
  EDGE_AUTH_MISCONFIG_WARN_COOLDOWN_MS,
} from '../../src/edge-auth.js';

function makeReq(headers: Record<string, string | undefined> = {}): Request {
  return { headers, method: 'POST', path: '/mcp' } as unknown as Request;
}

function runMiddleware(
  extraProtection: boolean,
  secret: string | undefined,
  req: Request
): { status?: number; body?: unknown; next: boolean } {
  const middleware = createEdgeAuthMiddleware(extraProtection, secret);
  let status: number | undefined;
  let body: unknown;
  let next = false;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
    },
  } as unknown as Response;
  const nextFn = vi.fn(() => {
    next = true;
  }) as NextFunction;
  middleware(req, res, nextFn);
  return { status, body, next };
}

describe('hasValidEdgeAuth', () => {
  it('accepts matching X-Edge-Auth', () => {
    expect(hasValidEdgeAuth(makeReq({ 'x-edge-auth': 'my-secret' }), 'my-secret')).toBe(true);
  });

  it('rejects missing header', () => {
    expect(hasValidEdgeAuth(makeReq({}), 'my-secret')).toBe(false);
  });

  it('rejects wrong secret', () => {
    expect(hasValidEdgeAuth(makeReq({ 'x-edge-auth': 'wrong' }), 'my-secret')).toBe(false);
  });
});

describe('createEdgeAuthMiddleware', () => {
  beforeEach(() => {
    resetEdgeAuthMisconfigWarnCooldown();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetEdgeAuthMisconfigWarnCooldown();
  });

  it('passes through when EXTRA_PROTECTION is off', () => {
    const result = runMiddleware(false, undefined, makeReq({}));
    expect(result.next).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('rejects when EXTRA_PROTECTION is on and header is missing', () => {
    const result = runMiddleware(true, 'secret', makeReq({}));
    expect(result.next).toBe(false);
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'Forbidden' });
  });

  it('rejects when EXTRA_PROTECTION is on and header is wrong', () => {
    const result = runMiddleware(true, 'secret', makeReq({ 'x-edge-auth': 'bad' }));
    expect(result.next).toBe(false);
    expect(result.status).toBe(403);
  });

  it('passes when EXTRA_PROTECTION is on and header matches MCP_EDGE_AUTH_SECRET', () => {
    const result = runMiddleware(true, 'secret', makeReq({ 'x-edge-auth': 'secret' }));
    expect(result.next).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('passes GET /health without X-Edge-Auth when EXTRA_PROTECTION is on', () => {
    const req = { headers: {}, method: 'GET', path: '/health' } as unknown as Request;
    const result = runMiddleware(true, 'secret', req);
    expect(result.next).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('logs misconfig warning once, then suppresses until cooldown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const req = makeReq({});
    runMiddleware(true, 'secret', req);
    runMiddleware(true, 'secret', req);

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('EXTRA_PROTECTION is enabled but X-Edge-Auth is missing or invalid')
    );

    vi.advanceTimersByTime(EDGE_AUTH_MISCONFIG_WARN_COOLDOWN_MS);
    runMiddleware(true, 'secret', req);

    expect(console.warn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('logs again immediately after a valid request if misconfig returns', () => {
    runMiddleware(true, 'secret', makeReq({}));
    expect(console.warn).toHaveBeenCalledTimes(1);

    runMiddleware(true, 'secret', makeReq({ 'x-edge-auth': 'secret' }));
    runMiddleware(true, 'secret', makeReq({}));

    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});

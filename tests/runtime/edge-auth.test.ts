import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { hasValidEdgeAuth, createEdgeAuthMiddleware } from '../../src/edge-auth.js';

function makeReq(headers: Record<string, string | undefined> = {}): Request {
  return { headers, method: 'POST', path: '/mcp' } as unknown as Request;
}

describe('hasValidEdgeAuth', () => {
  it('accepts matching X-Edge-Auth', () => {
    expect(hasValidEdgeAuth(makeReq({ 'x-edge-auth': 'secret' }), 'secret')).toBe(true);
  });

  it('rejects missing header', () => {
    expect(hasValidEdgeAuth(makeReq(), 'secret')).toBe(false);
  });

  it('rejects wrong value', () => {
    expect(hasValidEdgeAuth(makeReq({ 'x-edge-auth': 'wrong' }), 'secret')).toBe(false);
  });

  it('rejects empty header', () => {
    expect(hasValidEdgeAuth(makeReq({ 'x-edge-auth': '' }), 'secret')).toBe(false);
  });
});

describe('createEdgeAuthMiddleware', () => {
  it('passes through when secret is unset', () => {
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    createEdgeAuthMiddleware(undefined)(makeReq(), res, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when secret is set but header is missing', () => {
    const next = vi.fn();
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json } as unknown as Response;
    createEdgeAuthMiddleware('secret')(makeReq(), res, next as NextFunction);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Forbidden' });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes when secret and header match', () => {
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    createEdgeAuthMiddleware('secret')(makeReq({ 'x-edge-auth': 'secret' }), res, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });
});

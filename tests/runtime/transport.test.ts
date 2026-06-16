import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { parseMcpQueryParams, bearerRateLimitKey, inboundMcpClientIpFromRequest } from '../../src/transport.js';
import { ServiceCategory } from '../../src/types.js';

function makeReq(opts: {
  ip?: string;
  headers?: Record<string, string | undefined>;
  peerIp?: string;
}): Request {
  return {
    ip: opts.ip,
    headers: opts.headers ?? {},
    socket: { remoteAddress: opts.peerIp },
  } as unknown as Request;
}

const NON_CF_PEER = '10.0.0.1';
const EDGE_SECRET = 'test-edge-secret';

function withEdgeAuth(
  headers: Record<string, string | undefined> = {},
  clientIp?: string
): Record<string, string | undefined> {
  return {
    ...headers,
    'x-edge-auth': EDGE_SECRET,
    ...(clientIp !== undefined ? { 'x-client-ip': clientIp } : {}),
  };
}

describe('inboundMcpClientIpFromRequest', () => {
  const ipOpts = { extraProtection: true, edgeAuthSecret: EDGE_SECRET };

  it('returns X-Client-IP when edge auth is valid', () => {
    const userIp = '198.51.100.42';
    const ip = inboundMcpClientIpFromRequest(
      makeReq({
        peerIp: NON_CF_PEER,
        headers: withEdgeAuth(
          { 'x-forwarded-for': '2a05:d018:1182:5a02:de60:1638:edd0:6975' },
          userIp
        ),
      }),
      ipOpts
    );
    expect(ip).toBe(userIp);
  });

  it('returns X-Client-IP from internal TCP peer when edge auth is valid', () => {
    const userIp = '203.0.113.7';
    const ip = inboundMcpClientIpFromRequest(
      makeReq({
        peerIp: '10.1.2.3',
        headers: withEdgeAuth({ 'x-forwarded-for': '10.1.2.3' }, userIp),
      }),
      ipOpts
    );
    expect(ip).toBe(userIp);
  });

  it('returns undefined for localhost', () => {
    expect(inboundMcpClientIpFromRequest(makeReq({ peerIp: '127.0.0.1', ip: '127.0.0.1' }))).toBeUndefined();
  });

  it('normalizes IPv4-mapped IPv6 peer address', () => {
    const plain = inboundMcpClientIpFromRequest(
      makeReq({ peerIp: '203.0.113.7', ip: '203.0.113.7' })
    );
    const mapped = inboundMcpClientIpFromRequest(
      makeReq({ peerIp: '::ffff:203.0.113.7', ip: '203.0.113.7' })
    );
    expect(mapped).toBe(plain);
  });

  it('ignores forged X-Client-IP without valid X-Edge-Auth', () => {
    const ip = inboundMcpClientIpFromRequest(
      makeReq({
        peerIp: NON_CF_PEER,
        ip: NON_CF_PEER,
        headers: { 'x-client-ip': '203.0.113.7' },
      })
    );
    expect(ip).toBe(NON_CF_PEER);
  });
});

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

describe('parseMcpQueryParams', () => {
  describe('valid inputs', () => {
    it('returns readOnly=false and undefined categories when no query params', () => {
      const result = parseMcpQueryParams({}, false);
      expect(result).toEqual({ options: { readOnly: false, categories: undefined } });
    });

    it('returns readOnly=true when read_only=true', () => {
      const result = parseMcpQueryParams({ read_only: 'true' }, false);
      expect(result).toEqual({ options: { readOnly: true, categories: undefined } });
    });

    it('returns readOnly=false when read_only=false', () => {
      const result = parseMcpQueryParams({ read_only: 'false' }, false);
      expect(result).toEqual({ options: { readOnly: false, categories: undefined } });
    });
  });

  describe('server-level enforcement (env var)', () => {
    it('cannot override server readOnly=true with read_only=false', () => {
      const result = parseMcpQueryParams({ read_only: 'false' }, true);
      expect(result).toEqual({ options: { readOnly: true, categories: undefined } });
    });

    it('server readOnly=true with no query param stays true', () => {
      const result = parseMcpQueryParams({}, true);
      expect(result).toEqual({ options: { readOnly: true, categories: undefined } });
    });

    it('server readOnly=true with read_only=true stays true', () => {
      const result = parseMcpQueryParams({ read_only: 'true' }, true);
      expect(result).toEqual({ options: { readOnly: true, categories: undefined } });
    });
  });

  describe('rejects invalid inputs', () => {
    it('rejects unknown query parameters', () => {
      const result = parseMcpQueryParams({ read_only: 'true', foo: 'bar' }, false);
      expect(result).toEqual({ error: 'Unknown query parameter(s): foo' });
    });

    it('rejects multiple unknown query parameters', () => {
      const result = parseMcpQueryParams({ foo: 'bar', baz: '1' }, false);
      expect(result).toEqual({ error: 'Unknown query parameter(s): foo, baz' });
    });

    it('rejects array values (duplicate param injection)', () => {
      const result = parseMcpQueryParams({ read_only: ['true', 'false'] }, false);
      expect(result).toEqual({ error: 'Duplicate query parameter: read_only' });
    });

    it('rejects invalid read_only value "1"', () => {
      const result = parseMcpQueryParams({ read_only: '1' }, false);
      expect(result).toEqual({ error: 'Invalid value for read_only: must be "true" or "false"' });
    });

    it('rejects invalid read_only value "yes"', () => {
      const result = parseMcpQueryParams({ read_only: 'yes' }, false);
      expect(result).toEqual({ error: 'Invalid value for read_only: must be "true" or "false"' });
    });

    it('rejects invalid read_only value "TRUE" (case sensitive)', () => {
      const result = parseMcpQueryParams({ read_only: 'TRUE' }, false);
      expect(result).toEqual({ error: 'Invalid value for read_only: must be "true" or "false"' });
    });
  });

  describe('services scoping', () => {
    it('parses ?services=kafka and implicitly includes core', () => {
      const result = parseMcpQueryParams({ services_scope: 'kafka' }, false);
      expect(result).toEqual({
        options: {
          readOnly: false,
          categories: new Set([ServiceCategory.Core, ServiceCategory.Kafka]),
        },
      });
    });

    it('parses comma-separated scopes with whitespace', () => {
      const result = parseMcpQueryParams({ services_scope: 'kafka, pg' }, false);
      expect(result).toEqual({
        options: {
          readOnly: false,
          categories: new Set([
            ServiceCategory.Core,
            ServiceCategory.Kafka,
            ServiceCategory.Pg,
          ]),
        },
      });
    });

    it('rejects unknown scope names', () => {
      const result = parseMcpQueryParams({ services_scope: 'postgres' }, false);
      expect(result).toMatchObject({ error: expect.stringContaining('Unknown scope(s): postgres') });
    });

    it('rejects empty services value', () => {
      const result = parseMcpQueryParams({ services_scope: '' }, false);
      expect(result).toMatchObject({ error: expect.stringContaining('Empty scope list') });
    });

    it('rejects array values for services_scope', () => {
      const result = parseMcpQueryParams({ services_scope: ['kafka', 'pg'] }, false);
      expect(result).toEqual({ error: 'Duplicate query parameter: services_scope' });
    });
  });

  describe('tenant isolation', () => {
    it('produces independent results for different inputs (no shared state)', () => {
      const orgA = parseMcpQueryParams({ read_only: 'true' }, false);
      const orgB = parseMcpQueryParams({}, false);

      expect(orgA).toEqual({ options: { readOnly: true, categories: undefined } });
      expect(orgB).toEqual({ options: { readOnly: false, categories: undefined } });
    });
  });
});

describe('bearerRateLimitKey', () => {
  it('uses sha256(token) when a Bearer token is present', () => {
    const key = bearerRateLimitKey(
      makeReq({
        ip: '10.0.0.1',
        headers: { authorization: 'Bearer secret-token-abc' },
      })
    );
    expect(key).toBe(sha('secret-token-abc'));
  });

  it('does not log the raw token (key is a hex hash, not the token itself)', () => {
    const key = bearerRateLimitKey(
      makeReq({ headers: { authorization: 'Bearer secret-token-abc' } })
    );
    expect(key).not.toContain('secret-token-abc');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different tokens produce different bucket keys', () => {
    const k1 = bearerRateLimitKey(makeReq({ headers: { authorization: 'Bearer t1' } }));
    const k2 = bearerRateLimitKey(makeReq({ headers: { authorization: 'Bearer t2' } }));
    expect(k1).not.toBe(k2);
  });

  it('uses a shared key when Authorization header is missing', () => {
    const key = bearerRateLimitKey(
      makeReq({
        peerIp: NON_CF_PEER,
        headers: withEdgeAuth({}, '203.0.113.7'),
      })
    );
    expect(key).toBe('__no_bearer__');
  });

  it('uses a shared key when Authorization scheme is not Bearer', () => {
    const key = bearerRateLimitKey(
      makeReq({
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      })
    );
    expect(key).toBe('__no_bearer__');
  });

  it('uses a shared key when Bearer token is empty', () => {
    const key = bearerRateLimitKey(
      makeReq({ headers: { authorization: 'Bearer ' } })
    );
    expect(key).toBe('__no_bearer__');
  });

  it('uses a shared key when Bearer token is whitespace-only', () => {
    const key = bearerRateLimitKey(
      makeReq({ headers: { authorization: 'Bearer    ' } })
    );
    expect(key).toBe('__no_bearer__');
  });
});

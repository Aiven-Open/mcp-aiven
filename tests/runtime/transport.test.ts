import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { parseMcpQueryParams, clientIpKey, bearerOrIpKey } from '../../src/transport.js';
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

const CF_EDGE_IP = '162.158.1.1';
const NON_CF_PEER = '10.0.0.1';

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

describe('clientIpKey', () => {
  describe('peer is a Cloudflare edge IP (header is trusted)', () => {
    it('uses CF-Connecting-IP when peer is in CF range', () => {
      const key = clientIpKey(
        makeReq({
          peerIp: CF_EDGE_IP,
          ip: CF_EDGE_IP,
          headers: { 'cf-connecting-ip': '203.0.113.7' },
        })
      );
      expect(key).toContain('203.0.113.7');
      expect(key).not.toContain(CF_EDGE_IP);
    });

    it('different real client IPs from same CF edge produce different keys', () => {
      const userA = clientIpKey(
        makeReq({
          peerIp: CF_EDGE_IP,
          headers: { 'cf-connecting-ip': '198.51.100.1' },
        })
      );
      const userB = clientIpKey(
        makeReq({
          peerIp: CF_EDGE_IP,
          headers: { 'cf-connecting-ip': '198.51.100.2' },
        })
      );
      expect(userA).not.toBe(userB);
    });

    it('same real client IP via different CF edges produces the same key', () => {
      const viaEdge1 = clientIpKey(
        makeReq({
          peerIp: '162.158.1.1',
          headers: { 'cf-connecting-ip': '198.51.100.1' },
        })
      );
      const viaEdge2 = clientIpKey(
        makeReq({
          peerIp: '104.16.0.1',
          headers: { 'cf-connecting-ip': '198.51.100.1' },
        })
      );
      expect(viaEdge1).toBe(viaEdge2);
    });

    it('peer in CF IPv6 range is also accepted', () => {
      const key = clientIpKey(
        makeReq({
          peerIp: '2606:4700::1',
          headers: { 'cf-connecting-ip': '203.0.113.7' },
        })
      );
      expect(key).toContain('203.0.113.7');
    });

    it('IPv4-mapped IPv6 peer (::ffff:CF_IP) is recognized as CF', () => {
      const key = clientIpKey(
        makeReq({
          peerIp: `::ffff:${CF_EDGE_IP}`,
          headers: { 'cf-connecting-ip': '203.0.113.7' },
        })
      );
      expect(key).toContain('203.0.113.7');
    });

    it('CF-Connecting-IP that is not a valid IP is ignored even if peer is CF', () => {
      const key = clientIpKey(
        makeReq({
          peerIp: CF_EDGE_IP,
          ip: '203.0.113.99',
          headers: { 'cf-connecting-ip': 'not-an-ip' },
        })
      );
      expect(key).toContain('203.0.113.99');
      expect(key).not.toContain('not-an-ip');
    });

    it('empty CF-Connecting-IP is ignored even if peer is CF', () => {
      const key = clientIpKey(
        makeReq({
          peerIp: CF_EDGE_IP,
          ip: '203.0.113.99',
          headers: { 'cf-connecting-ip': '' },
        })
      );
      expect(key).toContain('203.0.113.99');
    });
  });

  describe('peer is NOT a Cloudflare edge IP (header is ignored)', () => {
    it('forged CF-Connecting-IP from non-CF peer is ignored — uses req.ip', () => {
      const key = clientIpKey(
        makeReq({
          peerIp: NON_CF_PEER,
          ip: NON_CF_PEER,
          headers: { 'cf-connecting-ip': '203.0.113.7' },
        })
      );
      expect(key).toContain(NON_CF_PEER);
      expect(key).not.toContain('203.0.113.7');
    });

    it('attacker rotating fake CF-Connecting-IP gets same bucket every time', () => {
      const k1 = clientIpKey(
        makeReq({
          peerIp: NON_CF_PEER,
          ip: NON_CF_PEER,
          headers: { 'cf-connecting-ip': '1.1.1.1' },
        })
      );
      const k2 = clientIpKey(
        makeReq({
          peerIp: NON_CF_PEER,
          ip: NON_CF_PEER,
          headers: { 'cf-connecting-ip': '2.2.2.2' },
        })
      );
      const k3 = clientIpKey(
        makeReq({
          peerIp: NON_CF_PEER,
          ip: NON_CF_PEER,
          headers: { 'cf-connecting-ip': '3.3.3.3' },
        })
      );
      expect(k1).toBe(k2);
      expect(k2).toBe(k3);
    });

    it('peer just outside CF range (e.g., 173.245.47.255 — one below 173.245.48.0/20) is rejected', () => {
      const key = clientIpKey(
        makeReq({
          peerIp: '173.245.47.255',
          ip: '173.245.47.255',
          headers: { 'cf-connecting-ip': '203.0.113.7' },
        })
      );
      expect(key).toContain('173.245.47.255');
      expect(key).not.toContain('203.0.113.7');
    });
  });

  describe('local / self-hosted (no proxy)', () => {
    it('localhost IPv4 uses req.ip', () => {
      const key = clientIpKey(makeReq({ peerIp: '127.0.0.1', ip: '127.0.0.1' }));
      expect(key).toContain('127.0.0.1');
    });

    it('localhost IPv6 uses req.ip', () => {
      const key = clientIpKey(makeReq({ peerIp: '::1', ip: '::1' }));
      expect(key.length).toBeGreaterThan(0);
    });

    it('public client direct (no CF) uses req.ip', () => {
      const key = clientIpKey(makeReq({ peerIp: '203.0.113.7', ip: '203.0.113.7' }));
      expect(key).toContain('203.0.113.7');
    });

    it('falls back to peer IP when req.ip is missing', () => {
      const key = clientIpKey(makeReq({ peerIp: '203.0.113.7' }));
      expect(key).toContain('203.0.113.7');
    });

    it('falls back to 0.0.0.0 when both req.ip and peer are missing', () => {
      const key = clientIpKey(makeReq({}));
      expect(key).toBe('0.0.0.0');
    });
  });

  describe('hardening', () => {
    it('does not read X-Forwarded-For (legacy XFF must not affect bucket key)', () => {
      const key = clientIpKey(
        makeReq({
          peerIp: NON_CF_PEER,
          ip: NON_CF_PEER,
          headers: { 'x-forwarded-for': '203.0.113.7' },
        })
      );
      expect(key).toContain(NON_CF_PEER);
      expect(key).not.toContain('203.0.113.7');
    });

    it('does not trust X-Real-IP', () => {
      const key = clientIpKey(
        makeReq({
          peerIp: NON_CF_PEER,
          ip: NON_CF_PEER,
          headers: { 'x-real-ip': '203.0.113.7' },
        })
      );
      expect(key).not.toContain('203.0.113.7');
    });

    it('does not trust True-Client-IP', () => {
      const key = clientIpKey(
        makeReq({
          peerIp: NON_CF_PEER,
          ip: NON_CF_PEER,
          headers: { 'true-client-ip': '203.0.113.7' },
        })
      );
      expect(key).not.toContain('203.0.113.7');
    });
  });
});

describe('bearerOrIpKey', () => {
  it('uses sha256(token) when a Bearer token is present', () => {
    const key = bearerOrIpKey(
      makeReq({
        ip: '10.0.0.1',
        headers: { authorization: 'Bearer secret-token-abc' },
      })
    );
    expect(key).toBe(sha('secret-token-abc'));
  });

  it('does not log the raw token (key is a hex hash, not the token itself)', () => {
    const key = bearerOrIpKey(
      makeReq({ headers: { authorization: 'Bearer secret-token-abc' } })
    );
    expect(key).not.toContain('secret-token-abc');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different tokens produce different bucket keys', () => {
    const k1 = bearerOrIpKey(makeReq({ headers: { authorization: 'Bearer t1' } }));
    const k2 = bearerOrIpKey(makeReq({ headers: { authorization: 'Bearer t2' } }));
    expect(k1).not.toBe(k2);
  });

  it('falls back to clientIpKey (CF-Connecting-IP) when Authorization header missing and peer is CF', () => {
    const key = bearerOrIpKey(
      makeReq({
        peerIp: CF_EDGE_IP,
        headers: { 'cf-connecting-ip': '203.0.113.7' },
      })
    );
    expect(key).toContain('203.0.113.7');
  });

  it('falls back to clientIpKey when Authorization scheme is not Bearer', () => {
    const key = bearerOrIpKey(
      makeReq({
        peerIp: CF_EDGE_IP,
        ip: NON_CF_PEER,
        headers: {
          authorization: 'Basic dXNlcjpwYXNz',
          'cf-connecting-ip': '203.0.113.7',
        },
      })
    );
    expect(key).toContain('203.0.113.7');
    expect(key).not.toMatch(/^[0-9a-f]{64}$/);
  });

  it('falls back to clientIpKey when Bearer token is empty', () => {
    const key = bearerOrIpKey(
      makeReq({
        peerIp: CF_EDGE_IP,
        headers: { authorization: 'Bearer ', 'cf-connecting-ip': '203.0.113.7' },
      })
    );
    expect(key).toContain('203.0.113.7');
  });

  it('falls back to clientIpKey when Bearer token is whitespace-only', () => {
    const key = bearerOrIpKey(
      makeReq({
        peerIp: CF_EDGE_IP,
        headers: { authorization: 'Bearer    ', 'cf-connecting-ip': '203.0.113.7' },
      })
    );
    expect(key).toContain('203.0.113.7');
  });

  it('the bearer-keyed bucket is independent from the IP-keyed bucket', () => {
    const bearerKey = bearerOrIpKey(
      makeReq({
        peerIp: CF_EDGE_IP,
        headers: { authorization: 'Bearer t1', 'cf-connecting-ip': '203.0.113.7' },
      })
    );
    const ipKey = clientIpKey(
      makeReq({ peerIp: CF_EDGE_IP, headers: { 'cf-connecting-ip': '203.0.113.7' } })
    );
    expect(bearerKey).not.toBe(ipKey);
  });
});

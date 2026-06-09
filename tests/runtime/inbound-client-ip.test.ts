import { describe, it, expect } from 'vitest';
import {
  clientIpFromForwardedFor,
  inboundMcpClientIpFromHeaders,
  inboundMcpClientIpFromRequestInfo,
  resolveInboundMcpClientIpFromHeaders,
} from '../../src/inbound-client-ip.js';

describe('clientIpFromForwardedFor', () => {
  it('returns leftmost valid IP', () => {
    expect(clientIpFromForwardedFor('203.0.113.50, 172.70.153.179')).toBe('203.0.113.50');
  });

  it('returns IPv6 leftmost hop', () => {
    expect(clientIpFromForwardedFor('2a0d:6fc0:22f5:4100:e817:53de:8957:a8ae')).toBe(
      '2a0d:6fc0:22f5:4100:e817:53de:8957:a8ae'
    );
  });

  it('ignores invalid leftmost hop', () => {
    expect(clientIpFromForwardedFor('not-an-ip, 203.0.113.50')).toBeUndefined();
  });
});

describe('resolveInboundMcpClientIpFromHeaders', () => {
  it('records x-forwarded-for as source', () => {
    expect(
      resolveInboundMcpClientIpFromHeaders({
        'x-forwarded-for': '203.0.113.50',
        'cf-connecting-ip': '172.70.153.179',
      })
    ).toEqual({ clientIp: '203.0.113.50', source: 'x-forwarded-for' });
  });

  it('records cf-connecting-ip as source when x-forwarded-for is absent', () => {
    expect(resolveInboundMcpClientIpFromHeaders({ 'cf-connecting-ip': '203.0.113.50' })).toEqual({
      clientIp: '203.0.113.50',
      source: 'cf-connecting-ip',
    });
  });

  it('returns empty when only cloudflare edge cf-connecting-ip is present', () => {
    expect(resolveInboundMcpClientIpFromHeaders({ 'cf-connecting-ip': '172.70.153.179' })).toEqual({});
  });
});

describe('inboundMcpClientIpFromHeaders', () => {
  it('prefers x-forwarded-for over cloudflare edge cf-connecting-ip', () => {
    const ip = inboundMcpClientIpFromHeaders({
      'x-forwarded-for': '2a0d:6fc0:22f5:4100:e817:53de:8957:a8ae',
      'cf-connecting-ip': '172.70.153.179',
    });
    expect(ip).toBe('2a0d:6fc0:22f5:4100:e817:53de:8957:a8ae');
  });

  it('uses cf-connecting-ip when it is the end-user address', () => {
    const ip = inboundMcpClientIpFromHeaders({
      'cf-connecting-ip': '203.0.113.50',
    });
    expect(ip).toBe('203.0.113.50');
  });

  it('ignores cf-connecting-ip when it is only a cloudflare edge address', () => {
    const ip = inboundMcpClientIpFromHeaders({
      'cf-connecting-ip': '172.70.153.179',
    });
    expect(ip).toBeUndefined();
  });
});

describe('inboundMcpClientIpFromRequestInfo', () => {
  it('reads headers from MCP SDK requestInfo', () => {
    const ip = inboundMcpClientIpFromRequestInfo({
      headers: {
        'x-forwarded-for': '203.0.113.7',
        'cf-connecting-ip': '172.70.153.179',
      },
    });
    expect(ip).toBe('203.0.113.7');
  });
});

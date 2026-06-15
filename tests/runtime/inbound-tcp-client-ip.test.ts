import { describe, it, expect } from 'vitest';
import {
  inboundMcpClientIpFromTcpPeer,
} from '../../src/inbound-tcp-client-ip.js';

describe('inboundMcpClientIpFromTcpPeer', () => {
  it('returns normalized IPv4 peer address', () => {
    expect(inboundMcpClientIpFromTcpPeer('203.0.113.7')).toBe('203.0.113.7');
  });

  it('strips IPv4-mapped IPv6 peer prefix', () => {
    expect(inboundMcpClientIpFromTcpPeer('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('returns undefined for invalid peer address', () => {
    expect(inboundMcpClientIpFromTcpPeer(undefined)).toBeUndefined();
    expect(inboundMcpClientIpFromTcpPeer('not-an-ip')).toBeUndefined();
  });
});

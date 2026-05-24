import { describe, it, expect } from 'vitest';
import { isCloudflareAddress, normalizePeerIp } from '../../src/cloudflare-ips.js';

describe('isCloudflareAddress', () => {
  describe('IPv4 — inside Cloudflare ranges', () => {
    it.each([
      ['173.245.48.1', '173.245.48.0/20'],
      ['103.21.244.50', '103.21.244.0/22'],
      ['141.101.64.0', '141.101.64.0/18'],
      ['162.158.255.255', '162.158.0.0/15'],
      ['104.16.0.0', '104.16.0.0/13'],
      ['172.64.1.1', '172.64.0.0/13'],
    ])('accepts %s (in %s)', (ip) => {
      expect(isCloudflareAddress(ip)).toBe(true);
    });
  });

  describe('IPv4 — outside Cloudflare ranges', () => {
    it.each([
      '173.245.47.255', // one below 173.245.48.0/20
      '173.245.64.0', // one above 173.245.48.0/20
      '8.8.8.8', // Google DNS
      '1.1.1.1', // Cloudflare DNS — public service IP, NOT in edge ranges
      '127.0.0.1', // localhost
      '10.0.0.1', // private
      '192.168.1.1', // private
      '0.0.0.0',
      '255.255.255.255',
    ])('rejects %s', (ip) => {
      expect(isCloudflareAddress(ip)).toBe(false);
    });
  });

  describe('IPv6 — inside Cloudflare ranges', () => {
    it.each([
      ['2400:cb00::1', '2400:cb00::/32'],
      ['2606:4700::1', '2606:4700::/32'],
      ['2a06:98c0::1', '2a06:98c0::/29'],
    ])('accepts %s (in %s)', (ip) => {
      expect(isCloudflareAddress(ip)).toBe(true);
    });
  });

  describe('IPv6 — outside Cloudflare ranges', () => {
    it.each([
      '2001:db8::1', // documentation range
      '::1', // loopback
      'fe80::1', // link-local
      '2607:f8b0::1', // Google
    ])('rejects %s', (ip) => {
      expect(isCloudflareAddress(ip)).toBe(false);
    });
  });

  describe('invalid inputs', () => {
    it.each([undefined, '', 'not-an-ip', '999.999.999.999', '173.245.48', '::ffff:not-ip'])(
      'rejects %s',
      (ip) => {
        expect(isCloudflareAddress(ip)).toBe(false);
      }
    );
  });
});

describe('normalizePeerIp', () => {
  it('strips ::ffff: prefix from IPv4-mapped IPv6', () => {
    expect(normalizePeerIp('::ffff:173.245.48.1')).toBe('173.245.48.1');
  });

  it('handles uppercase ::FFFF: prefix', () => {
    expect(normalizePeerIp('::FFFF:1.2.3.4')).toBe('1.2.3.4');
  });

  it('leaves non-mapped IPv6 unchanged', () => {
    expect(normalizePeerIp('2606:4700::1')).toBe('2606:4700::1');
  });

  it('leaves IPv4 unchanged', () => {
    expect(normalizePeerIp('173.245.48.1')).toBe('173.245.48.1');
  });

  it('returns undefined for undefined', () => {
    expect(normalizePeerIp(undefined)).toBeUndefined();
  });

  it('does not strip ::ffff: when remainder is not a valid IPv4', () => {
    expect(normalizePeerIp('::ffff:not-an-ip')).toBe('::ffff:not-an-ip');
  });
});

describe('integration: normalizePeerIp + isCloudflareAddress', () => {
  it('IPv4-mapped IPv6 of a CF IP is accepted after normalization', () => {
    const peer = normalizePeerIp('::ffff:162.158.1.1');
    expect(isCloudflareAddress(peer)).toBe(true);
  });

  it('IPv4-mapped IPv6 of a non-CF IP is rejected after normalization', () => {
    const peer = normalizePeerIp('::ffff:8.8.8.8');
    expect(isCloudflareAddress(peer)).toBe(false);
  });
});

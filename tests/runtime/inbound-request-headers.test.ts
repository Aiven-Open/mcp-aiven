import { describe, it, expect } from 'vitest';
import { inboundHeadersForLog } from '../../src/inbound-request-headers.js';

describe('inboundHeadersForLog', () => {
  it('redacts sensitive headers and sorts keys', () => {
    expect(
      inboundHeadersForLog({
        'CF-Connecting-IP': '203.0.113.7',
        Authorization: 'Bearer secret-token',
        'X-Edge-Auth': '12345',
        'User-Agent': 'claude',
      })
    ).toEqual({
      authorization: '[REDACTED len=19]',
      'cf-connecting-ip': '203.0.113.7',
      'user-agent': 'claude',
      'x-edge-auth': '[REDACTED len=5]',
    });
  });

  it('joins array header values', () => {
    expect(inboundHeadersForLog({ 'x-forwarded-for': ['1.2.3.4', '5.6.7.8'] })).toEqual({
      'x-forwarded-for': '1.2.3.4, 5.6.7.8',
    });
  });
});

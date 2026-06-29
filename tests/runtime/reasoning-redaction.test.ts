import { describe, it, expect } from 'vitest';
import { scrubReasoning } from '../../src/security.js';
import { redactReasoningField } from '../../src/observability.js';

describe('scrubReasoning - positive redaction', () => {
  it('redacts embedded credential URIs', () => {
    expect(scrubReasoning('use postgres://admin:s3cr3t@db.host:5432/main to query')).toBe(
      'use [REDACTED_URI] to query'
    );
  });

  it('redacts email addresses', () => {
    expect(scrubReasoning('notify alice.smith@example.com about it')).toBe(
      'notify [REDACTED_EMAIL] about it'
    );
  });

  it('redacts JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(scrubReasoning(`token is ${jwt} here`)).toBe('token is [REDACTED_JWT] here');
  });

  it('redacts provider/Aiven tokens', () => {
    // Tokens are assembled at runtime so no literal secret is committed (avoids
    // tripping secret-scanning push protection on the fake test values).
    const tokens = [
      ['AVNS', 'examplenotarealsecret1234'].join('_'),
      'ghp' + '_' + 'examplenotarealtoken0123456789abcdef',
      'xoxb' + '-' + 'examplenotarealslacktoken123',
      'AKIA' + 'EXAMPLENOTREAL12',
      'sk' + '-' + 'examplenotarealopenaikey0123456789',
      'AIza' + 'examplenotarealgooglekey0123456789a',
    ];
    for (const token of tokens) {
      expect(scrubReasoning(`key ${token} leaked`)).toBe('key [REDACTED_TOKEN] leaked');
    }
  });

  it('redacts IPv4 addresses', () => {
    expect(scrubReasoning('host at 192.168.1.100 down')).toBe('host at [REDACTED_IP] down');
  });

  it('redacts UUIDs', () => {
    expect(scrubReasoning('service 550e8400-e29b-41d4-a716-446655440000 failing')).toBe(
      'service [REDACTED_UUID] failing'
    );
  });

  it('redacts Luhn-valid credit card numbers', () => {
    expect(scrubReasoning('card 4242 4242 4242 4242 charged')).toBe('card [REDACTED_CARD] charged');
    expect(scrubReasoning('card 4242-4242-4242-4242 charged')).toBe('card [REDACTED_CARD] charged');
  });

  it('redacts PEM private key and certificate blocks', () => {
    const key = '-----BEGIN PRIVATE KEY-----\nMIIBVwIBADANBg\n-----END PRIVATE KEY-----';
    expect(scrubReasoning(`secret ${key} end`)).toBe('secret [REDACTED_KEY] end');
    const cert = '-----BEGIN CERTIFICATE-----\nMIICertData\n-----END CERTIFICATE-----';
    expect(scrubReasoning(`cert ${cert} end`)).toBe('cert [REDACTED_CERTIFICATE] end');
  });

  it('redacts high-entropy secrets', () => {
    expect(scrubReasoning('apikey aB3xZ9qL7mN2pR5tV8wY1cD4eF6gH0j here')).toBe(
      'apikey [REDACTED_SECRET] here'
    );
  });

  it('redacts multiple secrets in one string', () => {
    const result = scrubReasoning('email bob@corp.io from 10.0.0.5');
    expect(result).toBe('email [REDACTED_EMAIL] from [REDACTED_IP]');
  });
});

describe('scrubReasoning - false-positive guards', () => {
  it('leaves ordinary prose untouched', () => {
    const text = 'The user wants to list all running PostgreSQL services in the project.';
    expect(scrubReasoning(text)).toBe(text);
  });

  it('preserves URLs without credentials', () => {
    expect(scrubReasoning('see https://api.aiven.io/v1/project for docs')).toBe(
      'see https://api.aiven.io/v1/project for docs'
    );
  });

  it('keeps non-Luhn digit sequences', () => {
    expect(scrubReasoning('order 1234 5678 9012 3456 placed')).toBe(
      'order 1234 5678 9012 3456 placed'
    );
  });

  it('keeps invalid IPs (octet > 255)', () => {
    expect(scrubReasoning('version 999.888.777.666 of the spec')).toBe(
      'version 999.888.777.666 of the spec'
    );
  });

  it('keeps version-like and short alphanumeric tokens', () => {
    expect(scrubReasoning('upgrade to business-8 plan v1.11.0')).toBe(
      'upgrade to business-8 plan v1.11.0'
    );
  });

  it('does not treat a long low-entropy repeated string as a secret', () => {
    const repeated = 'a'.repeat(40);
    expect(scrubReasoning(`pattern ${repeated} repeats`)).toBe(`pattern ${repeated} repeats`);
  });
});

describe('redactReasoningField integration', () => {
  it('scrubs secrets embedded in object reasoning', () => {
    const result = redactReasoningField({ note: 'contact admin@corp.io' });
    expect(result).toBe('{"note":"contact [REDACTED_EMAIL]"}');
  });
});

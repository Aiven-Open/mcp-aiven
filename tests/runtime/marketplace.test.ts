import { describe, it, expect } from 'vitest';
import { resolveAuthorizationServer, buildResourceUrl } from '../../src/marketplace.js';

describe('resolveAuthorizationServer', () => {
  const API = 'https://api.aiven.io';

  it('advertises a tenant-scoped issuer for gcp', () => {
    expect(resolveAuthorizationServer('gcp', API)).toBe('https://api.aiven.io/gcp');
  });

  it('advertises a tenant-scoped issuer for aws', () => {
    expect(resolveAuthorizationServer('aws', API)).toBe('https://api.aiven.io/aws');
  });

  it('advertises a tenant-scoped issuer for azure', () => {
    expect(resolveAuthorizationServer('azure', API)).toBe('https://api.aiven.io/azure');
  });

  it('falls back to the default issuer when marketplace is absent', () => {
    expect(resolveAuthorizationServer(undefined, API)).toBe(API);
  });

  it('falls back to the default issuer for the aiven tenant (no dedicated console path)', () => {
    expect(resolveAuthorizationServer('aiven', API)).toBe(API);
  });

  it('falls back to the default issuer for unknown values (no path injection)', () => {
    expect(resolveAuthorizationServer('../evil', API)).toBe(API);
    expect(resolveAuthorizationServer('not-a-tenant', API)).toBe(API);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveAuthorizationServer('  GCP  ', API)).toBe('https://api.aiven.io/gcp');
  });

  it('ignores a non-string (duplicated/array) value', () => {
    expect(resolveAuthorizationServer(['gcp', 'aws'], API)).toBe(API);
  });
});

describe('buildResourceUrl', () => {
  const HOST = 'https://mcp.aiven.live/mcp';

  it('returns the host unchanged when there is no tenant', () => {
    expect(buildResourceUrl(HOST, undefined)).toBe('https://mcp.aiven.live/mcp');
  });

  it('appends the tenant without doubling the /mcp path segment', () => {
    expect(buildResourceUrl(HOST, 'gcp')).toBe('https://mcp.aiven.live/mcp/gcp');
  });
});

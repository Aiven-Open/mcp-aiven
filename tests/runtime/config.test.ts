import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadConfig,
  loadHttpMcpRateLimit,
  httpTrustProxyEnabled,
  parseScopes,
} from '../../src/config.js';
import { ServiceCategory } from '../../src/types.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should throw error when AIVEN_TOKEN is missing in stdio mode', () => {
    delete process.env['AIVEN_TOKEN'];

    expect(() => loadConfig()).toThrow('AIVEN_TOKEN environment variable is required');
    expect(() => loadConfig('stdio')).toThrow('AIVEN_TOKEN environment variable is required');
  });

  it('should allow missing AIVEN_TOKEN in http mode', () => {
    delete process.env['AIVEN_TOKEN'];

    const config = loadConfig('http');

    expect(config.token).toBeUndefined();
  });

  it('should use AIVEN_TOKEN in http mode when provided', () => {
    process.env['AIVEN_TOKEN'] = 'test-token';

    const config = loadConfig('http');

    expect(config.token).toBe('test-token');
  });

  it('should load config with required token', () => {
    process.env['AIVEN_TOKEN'] = 'test-token';

    const config = loadConfig();

    expect(config.token).toBe('test-token');
    expect(config.readOnly).toBe(false);
  });

  it('should disable read-only mode by default when AIVEN_READ_ONLY is unset', () => {
    process.env['AIVEN_TOKEN'] = 'test-token';
    delete process.env['AIVEN_READ_ONLY'];

    const config = loadConfig();

    expect(config.readOnly).toBe(false);
  });

  it('should enable read-only mode when AIVEN_READ_ONLY is "true"', () => {
    process.env['AIVEN_TOKEN'] = 'test-token';
    process.env['AIVEN_READ_ONLY'] = 'true';

    const config = loadConfig();

    expect(config.readOnly).toBe(true);
  });

  it('should disable read-only mode when AIVEN_READ_ONLY is "false"', () => {
    process.env['AIVEN_TOKEN'] = 'test-token';
    process.env['AIVEN_READ_ONLY'] = 'false';

    const config = loadConfig();

    expect(config.readOnly).toBe(false);
  });

  it('should leave categories undefined when AIVEN_SERVICES_SCOPE is unset', () => {
    process.env['AIVEN_TOKEN'] = 'test-token';
    delete process.env['AIVEN_SERVICES_SCOPE'];

    const config = loadConfig();

    expect(config.categories).toBeUndefined();
  });

  it('should parse AIVEN_SERVICES_SCOPE into a category set with implicit core', () => {
    process.env['AIVEN_TOKEN'] = 'test-token';
    process.env['AIVEN_SERVICES_SCOPE'] = 'kafka';

    const config = loadConfig();

    expect(config.categories).toEqual(new Set([ServiceCategory.Core, ServiceCategory.Kafka]));
  });

  it('should throw on unknown scope in AIVEN_SERVICES_SCOPE', () => {
    process.env['AIVEN_TOKEN'] = 'test-token';
    process.env['AIVEN_SERVICES_SCOPE'] = 'postgres';

    expect(() => loadConfig()).toThrow(/AIVEN_SERVICES_SCOPE.*Unknown scope/);
  });
});

describe('parseScopes', () => {
  it('returns undefined categories when input is undefined', () => {
    expect(parseScopes(undefined)).toEqual({ categories: undefined });
  });

  it('parses single scope and includes core', () => {
    expect(parseScopes('pg')).toEqual({
      categories: new Set([ServiceCategory.Core, ServiceCategory.Pg]),
    });
  });

  it('parses multiple scopes', () => {
    expect(parseScopes('kafka,pg,application,integrations')).toEqual({
      categories: new Set([
        ServiceCategory.Core,
        ServiceCategory.Kafka,
        ServiceCategory.Pg,
        ServiceCategory.Application,
        ServiceCategory.Integrations,
      ]),
    });
  });

  it('trims whitespace around entries', () => {
    expect(parseScopes(' kafka , pg ')).toEqual({
      categories: new Set([ServiceCategory.Core, ServiceCategory.Kafka, ServiceCategory.Pg]),
    });
  });

  it('rejects empty string', () => {
    const r = parseScopes('');
    expect(r).toMatchObject({ error: expect.stringContaining('Empty scope list') });
  });

  it('rejects unknown scope', () => {
    const r = parseScopes('postgres');
    expect(r).toMatchObject({ error: expect.stringContaining('Unknown scope(s): postgres') });
  });

  it('rejects mix of known and unknown, listing only the unknown', () => {
    const r = parseScopes('pg,postgres,foo');
    expect(r).toMatchObject({ error: expect.stringContaining('postgres, foo') });
  });

  it('returns undefined categories for explicit "all"', () => {
    expect(parseScopes('all')).toEqual({ categories: undefined });
  });

  it('rejects "all" combined with other scopes', () => {
    const r = parseScopes('all,kafka');
    expect(r).toMatchObject({ error: expect.stringContaining(`'all' cannot be combined`) });
  });
});

describe('loadHttpMcpRateLimit', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['MCP_HTTP_RATE_LIMIT_WINDOW_MS'];
    delete process.env['MCP_HTTP_RATE_LIMIT_MAX'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use defaults when env is unset', () => {
    expect(loadHttpMcpRateLimit()).toEqual({ windowMs: 60_000, limit: 100 });
  });

  it('should read MCP_HTTP_RATE_LIMIT_WINDOW_MS and MCP_HTTP_RATE_LIMIT_MAX', () => {
    process.env['MCP_HTTP_RATE_LIMIT_WINDOW_MS'] = '30000';
    process.env['MCP_HTTP_RATE_LIMIT_MAX'] = '60';

    expect(loadHttpMcpRateLimit()).toEqual({ windowMs: 30_000, limit: 60 });
  });

  it('should fall back to defaults for invalid env values', () => {
    process.env['MCP_HTTP_RATE_LIMIT_WINDOW_MS'] = '0';
    process.env['MCP_HTTP_RATE_LIMIT_MAX'] = '-1';

    expect(loadHttpMcpRateLimit()).toEqual({ windowMs: 60_000, limit: 100 });
  });
});

describe('httpTrustProxyEnabled', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['MCP_TRUST_PROXY'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should be false when MCP_TRUST_PROXY is unset', () => {
    expect(httpTrustProxyEnabled()).toBe(false);
  });

  it('should be true when MCP_TRUST_PROXY is 1 or true', () => {
    process.env['MCP_TRUST_PROXY'] = '1';
    expect(httpTrustProxyEnabled()).toBe(true);

    process.env['MCP_TRUST_PROXY'] = 'true';
    expect(httpTrustProxyEnabled()).toBe(true);
  });
});

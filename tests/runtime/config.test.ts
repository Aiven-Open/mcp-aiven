import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config.js';

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
});

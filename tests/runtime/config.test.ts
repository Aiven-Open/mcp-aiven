import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { parseServices, isServiceCategory, isAllServices } from '../../src/types.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should throw error when AIVEN_TOKEN is missing', () => {
    delete process.env['AIVEN_TOKEN'];

    expect(() => loadConfig()).toThrow('AIVEN_TOKEN environment variable is required');
  });

  it('should load config with required token', () => {
    process.env['AIVEN_TOKEN'] = 'test-token';

    const config = loadConfig();

    expect(config.token).toBe('test-token');
    expect(config.baseUrl).toBe('https://api.aiven.io/v1');
    expect(config.services).toEqual(['all']);
  });

  it('should use custom base URL when provided', () => {
    process.env['AIVEN_TOKEN'] = 'test-token';
    process.env['AIVEN_BASE_URL'] = 'https://custom.api.aiven.io';

    const config = loadConfig();

    expect(config.baseUrl).toBe('https://custom.api.aiven.io');
  });

  it('should parse services from environment', () => {
    process.env['AIVEN_TOKEN'] = 'test-token';
    process.env['AIVEN_SERVICES'] = 'core,pg';

    const config = loadConfig();

    expect(config.services).toContain('core');
    expect(config.services).toContain('pg');
  });
});

describe('parseServices', () => {
  it('should return all for undefined input', () => {
    expect(parseServices(undefined)).toEqual(['all']);
  });

  it('should return all for empty string', () => {
    expect(parseServices('')).toEqual(['all']);
  });

  it('should return all for "all" string', () => {
    expect(parseServices('all')).toEqual(['all']);
  });

  it('should parse comma-separated services', () => {
    const result = parseServices('pg,kafka');

    expect(result).toContain('core'); // core is always added
    expect(result).toContain('pg');
    expect(result).toContain('kafka');
  });

  it('should handle whitespace', () => {
    const result = parseServices(' pg , kafka ');

    expect(result).toContain('pg');
    expect(result).toContain('kafka');
  });

  it('should add core automatically if not specified', () => {
    const result = parseServices('pg');

    expect(result[0]).toBe('core');
    expect(result).toContain('pg');
  });

  it('should not duplicate core if already specified', () => {
    const result = parseServices('core,pg');

    const coreCount = result.filter((s) => s === 'core').length;
    expect(coreCount).toBe(1);
  });

  it('should ignore invalid service names', () => {
    const result = parseServices('pg,invalid,kafka');

    expect(result).toContain('pg');
    expect(result).toContain('kafka');
    expect(result).not.toContain('invalid');
  });
});

describe('isServiceCategory', () => {
  it('should return true for valid categories', () => {
    expect(isServiceCategory('core')).toBe(true);
    expect(isServiceCategory('pg')).toBe(true);
    expect(isServiceCategory('kafka')).toBe(true);
  });

  it('should return false for invalid categories', () => {
    expect(isServiceCategory('invalid')).toBe(false);
    expect(isServiceCategory('postgresql')).toBe(false);
    expect(isServiceCategory('')).toBe(false);
  });
});

describe('isAllServices', () => {
  it('should return true when services includes all', () => {
    expect(isAllServices(['all'])).toBe(true);
    expect(isAllServices(['all', 'pg'])).toBe(true);
  });

  it('should return false when services does not include all', () => {
    expect(isAllServices(['core', 'pg'])).toBe(false);
    expect(isAllServices([])).toBe(false);
  });
});

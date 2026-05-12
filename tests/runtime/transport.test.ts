import { describe, it, expect } from 'vitest';
import { parseMcpQueryParams } from '../../src/transport.js';
import { ServiceCategory } from '../../src/types.js';

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

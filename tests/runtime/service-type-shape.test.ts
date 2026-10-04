import { describe, it, expect } from 'vitest';
import {
  serviceTypeConfigOverrides,
  shapeServiceTypeResponse,
} from '../../src/tools/service-type-shape.js';

interface Shaped {
  service_type?: string;
  default_version: unknown;
  available_versions: string[];
  latest_available_version: unknown;
  version_config_key?: string;
  description?: string;
  note: string;
}

/** Mirrors GET /project/{project}/service-types/{service_type}. */
function makeResponse(
  serviceType: string,
  versions: unknown[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    default_version: '18',
    latest_available_version: '18.6',
    description: 'PostgreSQL - High-performance relational database',
    user_config_schema: {
      type: 'object',
      properties: {
        [`${serviceType}_version`]: { type: ['string', 'null'], enum: versions },
        ip_filter: { type: 'array' },
        admin_username: { type: 'string' },
      },
    },
    ...extra,
  };
}

function shape(data: Record<string, unknown>, serviceType: string): Shaped {
  return shapeServiceTypeResponse(data, { project: 'p', service_type: serviceType }) as unknown as Shaped;
}

describe('serviceTypeConfigOverrides', () => {
  it('wires postProcess for aiven_service_type_get only', () => {
    expect(serviceTypeConfigOverrides('aiven_service_type_get').postProcess).toBe(
      shapeServiceTypeResponse
    );
  });

  it('is a no-op for every other tool', () => {
    expect(serviceTypeConfigOverrides('aiven_service_create')).toEqual({});
    expect(serviceTypeConfigOverrides('aiven_service_type_plans')).toEqual({});
  });
});

describe('shapeServiceTypeResponse', () => {
  it('lifts the version enum out and drops user_config_schema', () => {
    const result = shape(makeResponse('pg', ['15', '16', '17', '18']), 'pg');

    expect(result.default_version).toBe('18');
    expect(result.available_versions).toEqual(['15', '16', '17', '18']);
    expect(result.latest_available_version).toBe('18.6');
    expect(result.version_config_key).toBe('pg_version');
    expect(result.service_type).toBe('pg');
    expect(result).not.toHaveProperty('user_config_schema');
  });

  it('keeps default_version distinct from latest_available_version', () => {
    const result = shape(makeResponse('pg', ['17', '18']), 'pg');
    // "18" (major) must not be replaced by "18.6" (full version).
    expect(result.default_version).toBe('18');
    expect(result.default_version).not.toBe(result.latest_available_version);
  });

  it('does not infer the default from the newest available version', () => {
    // Aiven does not guarantee default == newest; the field must be passed through verbatim.
    const data = makeResponse('pg', ['15', '16', '17', '18'], { default_version: '17' });
    expect(shape(data, 'pg').default_version).toBe('17');
  });

  it('is generic across engines, not PG-specific', () => {
    const cases: [string, string[], string][] = [
      ['kafka', ['3.9', '4.2'], 'kafka_version'],
      ['opensearch', ['2.19', '3.3', '3.6'], 'opensearch_version'],
      ['clickhouse', ['25.8', '26.3'], 'clickhouse_version'],
      ['valkey', ['8.1', '9.1'], 'valkey_version'],
      ['flink', ['1.19', '1.20'], 'flink_version'],
    ];
    for (const [serviceType, versions, expectedKey] of cases) {
      const result = shape(makeResponse(serviceType, versions), serviceType);
      expect(result.version_config_key).toBe(expectedKey);
      expect(result.available_versions).toEqual(versions);
    }
  });

  it('sorts versions numerically, not lexically', () => {
    // A plain string sort puts "10" before "9" and "1.20" before "1.19".
    expect(shape(makeResponse('pg', ['9', '10', '15']), 'pg').available_versions).toEqual([
      '9',
      '10',
      '15',
    ]);
    expect(shape(makeResponse('flink', ['1.20', '1.19']), 'flink').available_versions).toEqual([
      '1.19',
      '1.20',
    ]);
  });

  it('drops null and empty entries from the enum', () => {
    // karapace_version carries a null in its enum.
    const result = shape(makeResponse('kafka', ['6.2.1', null, '', '6.2.2'], {}), 'kafka');
    expect(result.available_versions).toEqual(['6.2.1', '6.2.2']);
  });

  it('handles unversioned service types without erroring', () => {
    const data = {
      default_version: null,
      latest_available_version: '0.41.0',
      user_config_schema: { type: 'object', properties: { ip_filter: { type: 'array' } } },
    };
    const result = shape(data, 'thanos');

    expect(result.available_versions).toEqual([]);
    expect(result.default_version).toBeNull();
    expect(result.note).toContain('not versioned');
  });

  it('tolerates a missing or malformed user_config_schema', () => {
    expect(shape({ default_version: '18' }, 'pg').available_versions).toEqual([]);
    expect(shape({ default_version: '18', user_config_schema: null }, 'pg').available_versions).toEqual([]);
    expect(
      shape({ default_version: '18', user_config_schema: { properties: { pg_version: {} } } }, 'pg')
        .available_versions
    ).toEqual([]);
  });

  it('returns non-service-type payloads unchanged', () => {
    const errorPayload = { errors: [{ message: 'nope' }], message: 'nope' };
    expect(shapeServiceTypeResponse(errorPayload, { service_type: 'pg' })).toBe(errorPayload);
  });

  it('still shapes when service_type is absent from args', () => {
    const result = shapeServiceTypeResponse(makeResponse('pg', ['17', '18']), {}) as unknown as Shaped;
    expect(result.default_version).toBe('18');
    expect(result.available_versions).toEqual([]);
    expect(result).not.toHaveProperty('version_config_key');
    expect(result).not.toHaveProperty('user_config_schema');
  });

  it('tells the model to report the version it will create', () => {
    const result = shape(makeResponse('pg', ['17', '18']), 'pg');
    expect(result.note).toContain('pg_version');
    expect(result.note).toContain('18');
  });
});

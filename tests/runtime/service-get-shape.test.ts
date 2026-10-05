import { describe, it, expect } from 'vitest';
import { reorderServiceFields, shapeServiceGetResponse } from '../../src/tools/service-get-shape.js';

describe('service-get-shape', () => {
  it('places core fields before bulky arrays regardless of input key order', () => {
    const service = {
      acl: [{ id: 'a' }, { id: 'b' }],
      backups: [{ name: 'b1' }],
      components: [{ component: 'kafka' }],
      plan: 'business-4',
      service_name: 'kafka-1',
      service_type: 'kafka',
      state: 'RUNNING',
      topics: [{ topic_name: 't1' }],
      users: [{ username: 'avnadmin' }],
    };

    const keys = Object.keys(reorderServiceFields(service));
    expect(keys.indexOf('state')).toBeLessThan(keys.indexOf('acl'));
    expect(keys.indexOf('plan')).toBeLessThan(keys.indexOf('topics'));
    expect(keys.indexOf('service_name')).toBe(0);
    expect(keys.slice(-5)).toEqual(['acl', 'backups', 'components', 'topics', 'users']);
  });

  it('preserves non-core, non-bulky keys in original order between core and bulky sections', () => {
    const service = {
      zebra: 1,
      service_name: 'pg-1',
      alpha: 2,
      state: 'RUNNING',
      backups: [],
    };

    const keys = Object.keys(reorderServiceFields(service));
    expect(keys).toEqual(['service_name', 'state', 'zebra', 'alpha', 'backups']);
  });

  it('wraps the service object on full tool responses', () => {
    const shaped = shapeServiceGetResponse({
      service: { acl: [1], state: 'RUNNING', plan: 'startup-2' },
    });
    const service = shaped['service'] as Record<string, unknown>;
    expect(Object.keys(service)).toEqual(['state', 'plan', 'acl']);
  });

  it('serializes core fields at the start of JSON text', () => {
    const bulkyAcl = Array.from({ length: 200 }, (_, i) => ({ permission: `p${i}`, topic: 'x' }));
    const service = reorderServiceFields({
      acl: bulkyAcl,
      plan: 'business-4',
      service_name: 'kafka-big',
      state: 'RUNNING',
    });
    const json = JSON.stringify({ service });
    expect(json.indexOf('"state"')).toBeLessThan(json.indexOf('"acl"'));
    expect(json.indexOf('"plan"')).toBeLessThan(json.indexOf('"acl"'));
  });
});

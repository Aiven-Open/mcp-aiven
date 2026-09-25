import { describe, it, expect } from 'vitest';
import { shapePlansResponse } from '../../src/tools/plans-shape.js';

const plans = {
  service_plans: [
    {
      service_plan: 'startup-4',
      node_count: 1,
      regions: {
        'aws-eu-west-1': { price_usd: '0.026', disk_space_mb: 8192 },
        'google-europe-west1': { price_usd: '0.030', disk_space_mb: 8192 },
      },
    },
    {
      service_plan: 'business-4',
      regions: {
        'google-us-east1': { price_usd: '0.260', disk_space_mb: 16384 },
      },
    },
  ],
};

describe('shapePlansResponse', () => {
  it('returns every region price when no filter is set', () => {
    const result = shapePlansResponse(plans, {});

    expect(result['service_plans']).toEqual([
      {
        service_plan: 'startup-4',
        node_count: 1,
        regions: {
          'aws-eu-west-1': { price_usd: '0.026' },
          'google-europe-west1': { price_usd: '0.030' },
        },
      },
      {
        service_plan: 'business-4',
        regions: { 'google-us-east1': { price_usd: '0.260' } },
      },
    ]);
    expect(result['hint']).toBeUndefined();
  });

  it('keeps matching regions and their hourly price', () => {
    const result = shapePlansResponse(plans, { region: 'eu-west' });

    expect(result['service_plans']).toEqual([
      {
        service_plan: 'startup-4',
        node_count: 1,
        regions: { 'aws-eu-west-1': { price_usd: '0.026' } },
      },
    ]);
    expect(result['hint']).toBeUndefined();
  });

  it('filters plan names and clouds together', () => {
    const result = shapePlansResponse(plans, { plan: 'business', region: 'google' });

    expect(result['service_plans']).toEqual([
      {
        service_plan: 'business-4',
        regions: { 'google-us-east1': { price_usd: '0.260' } },
      },
    ]);
  });
});

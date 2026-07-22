import { describe, it, expect } from 'vitest';
import { shapeMetricsResponse } from '../../src/tools/metrics-shape.js';

interface RawGroup {
  data: {
    cols: { label: string; type: string }[];
    rows: unknown[][];
  };
}

interface Overview {
  available_metrics: string[];
  overview: Record<
    string,
    {
      time_range: [string, string] | null;
      series: { series: string; points: number; min: number | null; avg: number | null; max: number | null; latest: number | null }[];
    }
  >;
  note: string;
}

interface Detail {
  metrics: Record<string, RawGroup>;
  returned_metrics: string[];
  unmatched_requested?: string[];
  note: string;
}

function makeGroup(cols: string[], dataRows: (string | number)[][]): RawGroup {
  const colDefs = cols.map((label, i) => ({ label, type: i === 0 ? 'date' : 'number' }));
  return {
    data: {
      cols: colDefs,
      // The real API echoes the column defs as the first row; shaping must skip it.
      rows: [colDefs, ...dataRows],
    },
  };
}

function sample(): { metrics: Record<string, RawGroup> } {
  return {
    metrics: {
      cpu_usage: makeGroup(
        ['time', 'node-a (master)', 'node-b (standby)'],
        [
          ['Date(2026,6,22,10,0,0)', 5, 7],
          ['Date(2026,6,22,10,1,0)', 15, 9],
          ['Date(2026,6,22,10,2,0)', 10, 11],
        ]
      ),
      mem_usage: makeGroup(
        ['time', 'node-a (master)'],
        [
          ['Date(2026,6,22,10,0,0)', 41.2],
          ['Date(2026,6,22,10,2,0)', 43.9],
        ]
      ),
    },
  };
}

describe('shapeMetricsResponse — overview (no metrics arg)', () => {
  it('returns available names and per-series stats', () => {
    const out = shapeMetricsResponse(sample(), {}) as unknown as Overview;

    expect(out.available_metrics).toEqual(['cpu_usage', 'mem_usage']);
    const cpu = out.overview.cpu_usage;
    expect(cpu.time_range).toEqual(['Date(2026,6,22,10,0,0)', 'Date(2026,6,22,10,2,0)']);
    expect(cpu.series[0]).toMatchObject({
      series: 'node-a (master)',
      points: 3,
      min: 5,
      avg: 10,
      max: 15,
      latest: 10,
    });
    expect(out.note).toContain('cpu_usage');
  });

  it('stays small for a large multi-group payload', () => {
    const groups: Record<string, RawGroup> = {};
    for (const name of ['cpu_usage', 'mem_usage', 'diskio_read', 'net_send']) {
      const rows: (string | number)[][] = [];
      for (let i = 0; i < 120; i++) rows.push([`Date(2026,6,22,10,${String(i)},0)`, i * 0.5, i * 0.25]);
      groups[name] = makeGroup(['time', 'node-a', 'node-b'], rows);
    }
    const raw = { metrics: groups };
    const out = shapeMetricsResponse(raw, {});
    expect(JSON.stringify(out).length).toBeLessThan(2_500);
    expect(JSON.stringify(raw).length).toBeGreaterThan(10_000);
  });

  it('handles empty series without throwing', () => {
    const out = shapeMetricsResponse(
      { metrics: { cpu_usage: makeGroup(['time', 'node-a'], []) } },
      {}
    ) as unknown as Overview;
    expect(out.overview.cpu_usage.time_range).toBeNull();
    expect(out.overview.cpu_usage.series[0]).toMatchObject({ points: 0, min: null });
  });
});

describe('shapeMetricsResponse — detail (metrics arg set)', () => {
  it('returns the FULL untouched series for requested metrics only', () => {
    const out = shapeMetricsResponse(sample(), { metrics: ['cpu_usage'] }) as unknown as Detail;

    expect(out.returned_metrics).toEqual(['cpu_usage']);
    expect(Object.keys(out.metrics)).toEqual(['cpu_usage']);
    const rows = out.metrics.cpu_usage.data.rows;
    expect(rows).toHaveLength(4); // header echo + 3 data rows, untouched
    expect(rows[2]).toEqual(['Date(2026,6,22,10,1,0)', 15, 9]);
    expect(out.note).toContain('mem_usage'); // other metrics still discoverable
  });

  it('is case-insensitive and reports unmatched names', () => {
    const out = shapeMetricsResponse(sample(), {
      metrics: ['CPU_USAGE', 'bogus'],
    }) as unknown as Detail;
    expect(out.returned_metrics).toEqual(['cpu_usage']);
    expect(out.unmatched_requested).toEqual(['bogus']);
  });

  it('returns the available list when nothing matches', () => {
    const out = shapeMetricsResponse(sample(), { metrics: ['bogus'] }) as unknown as {
      metrics: Record<string, unknown>;
      available_metrics: string[];
    };
    expect(out.metrics).toEqual({});
    expect(out.available_metrics).toEqual(['cpu_usage', 'mem_usage']);
  });
});

describe('shapeMetricsResponse — passthrough', () => {
  it('leaves non-metrics responses unchanged', () => {
    expect(shapeMetricsResponse({ foo: 'bar' }, {})).toEqual({ foo: 'bar' });
    expect(shapeMetricsResponse({ metrics: 'nope' }, {})).toEqual({ metrics: 'nope' });
    const noTable = { metrics: { weird: { something: 1 } } };
    expect(shapeMetricsResponse(noTable, {})).toEqual(noTable);
  });
});

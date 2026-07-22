import { z } from 'zod';
import type { ApiToolConfig } from '../types.js';

/**
 * Response shaping for `aiven_service_metrics_fetch`.
 *
 * The Aiven metrics API returns a DataTable per metric group:
 *   metrics.{group}.data = { cols: [{label,type}, ...], rows: [[time, n, n], ...] }
 * A single `hour`/`day` request over a multi-host service returns hundreds of points across
 * ~9 groups (~100KB) — past the tool-result size cap, so the tail gets truncated and data is
 * silently lost.
 *
 * Instead of truncating, the tool serves the two real intents explicitly:
 *   - `metrics` omitted  → overview: available metric names + per-series
 *                          min/avg/max/first/latest. Small enough to always fit (~3KB).
 *   - `metrics` provided → the FULL, untouched per-point series for exactly those groups,
 *                          so every spike is visible. One group ≈ 16KB — fits.
 */

const METRICS_FETCH_TOOL_NAME = 'aiven_service_metrics_fetch';

/** The one client-side input param: which metric groups to return in full detail. */
const METRICS_PARAM = 'metrics';

/**
 * Config overrides that wire the metrics shaping into the one tool that needs it.
 * Returns an empty object for every other tool, so the registry can spread it unconditionally.
 */
export function metricsConfigOverrides(
  toolName: string,
  baseSchema: z.ZodType
): Partial<Pick<ApiToolConfig, 'inputSchema' | 'postProcess' | 'clientOnlyParams'>> {
  if (toolName !== METRICS_FETCH_TOOL_NAME) return {};
  return {
    inputSchema: extendMetricsSchema(baseSchema),
    postProcess: shapeMetricsResponse,
    clientOnlyParams: [METRICS_PARAM],
  };
}

/** Add the `metrics` selector to the tool's input schema. */
function extendMetricsSchema(baseSchema: z.ZodType): z.ZodType {
  if (!(baseSchema instanceof z.ZodObject)) return baseSchema;
  return baseSchema
    .extend({
      [METRICS_PARAM]: z
        .array(z.string())
        .optional()
        .describe(
          'Metric groups to return with full per-point detail (e.g. ["cpu_usage", "mem_usage"]). ' +
            'When omitted, the response is an overview of all available metrics with ' +
            'min/avg/max/latest per series; the overview lists the exact names accepted here.'
        ),
    })
    .passthrough();
}

interface DataTableCol {
  label?: string;
}

/** Shape established by {@link isMetricGroup} — `cols` and `rows` are verified arrays. */
interface MetricGroup {
  data: {
    cols: DataTableCol[];
    rows: unknown[][];
  };
}

interface SeriesSummary {
  series: string;
  points: number;
  min: number | null;
  avg: number | null;
  max: number | null;
  latest: number | null;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function isMetricGroup(value: unknown): value is MetricGroup {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = (value as { data?: { cols?: unknown; rows?: unknown } }).data;
  return Array.isArray(data?.cols) && Array.isArray(data.rows);
}

/** Rows whose first cell is a time value (the API echoes the column defs as the first row). */
function dataRowsOf(group: MetricGroup): unknown[][] {
  return group.data.rows.filter((r): r is unknown[] => {
    if (!Array.isArray(r)) return false;
    const first: unknown = r[0];
    return typeof first === 'string' || typeof first === 'number';
  });
}

function summarizeGroup(group: MetricGroup): Record<string, unknown> {
  const cols = group.data.cols;
  const rows = dataRowsOf(group);

  const series: SeriesSummary[] = [];
  for (let i = 1; i < cols.length; i++) {
    const values: number[] = [];
    for (const row of rows) {
      const v: unknown = row[i];
      if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
    }
    const label = cols[i]?.label ?? `series_${String(i)}`;
    if (values.length === 0) {
      series.push({ series: label, points: 0, min: null, avg: null, max: null, latest: null });
      continue;
    }
    let min = values[0] as number;
    let max = min;
    let sum = 0;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    series.push({
      series: label,
      points: values.length,
      min: round(min),
      avg: round(sum / values.length),
      max: round(max),
      latest: round(values[values.length - 1] as number),
    });
  }

  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const timeRange =
    firstRow && lastRow ? [String(firstRow[0]), String(lastRow[0])] : null;

  return { time_range: timeRange, series };
}

/**
 * Shape the metrics response by the caller's requested scope. Returns the input unchanged
 * when it is not a metrics payload, so it is safe on error responses.
 */
export function shapeMetricsResponse(
  data: Record<string, unknown>,
  args: Record<string, unknown>
): Record<string, unknown> {
  const metrics = data['metrics'];
  if (metrics === null || typeof metrics !== 'object' || Array.isArray(metrics)) return data;
  const groups = metrics as Record<string, unknown>;
  const names = Object.keys(groups).filter((n) => isMetricGroup(groups[n]));
  if (names.length === 0) return data;

  const rawRequested = args[METRICS_PARAM];
  const requested = Array.isArray(rawRequested)
    ? rawRequested.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    : [];

  // Detail mode: full untouched series for the requested groups only.
  if (requested.length > 0) {
    const byLowerName = new Map(names.map((n) => [n.toLowerCase(), n]));
    const selected: Record<string, unknown> = {};
    const matched: string[] = [];
    const unmatched: string[] = [];
    for (const req of requested) {
      const name = byLowerName.get(req.trim().toLowerCase());
      if (name === undefined) {
        unmatched.push(req);
      } else if (!(name in selected)) {
        selected[name] = groups[name];
        matched.push(name);
      }
    }

    if (matched.length === 0) {
      return {
        metrics: {},
        available_metrics: names,
        note: `No requested metric matched. Available metrics: ${names.join(', ')}.`,
      };
    }
    return {
      metrics: selected,
      returned_metrics: matched,
      ...(unmatched.length > 0 && { unmatched_requested: unmatched }),
      note:
        'Full per-point time series for the requested metric(s). ' +
        `Other available metrics: ${names.filter((n) => !matched.includes(n)).join(', ')}.`,
    };
  }

  // Overview mode: per-series stats for every group. Nothing is truncated.
  const overview: Record<string, unknown> = {};
  for (const name of names) {
    overview[name] = summarizeGroup(groups[name] as MetricGroup);
  }
  return {
    available_metrics: names,
    overview,
    note:
      'Overview: min/avg/max/latest per series, in each metric’s native unit. The full ' +
      'per-point time series of any metric (including individual spikes) is available via the ' +
      '`metrics` parameter, e.g. metrics: ["cpu_usage"].',
  };
}

import { describe, it, expect, afterEach } from 'vitest';
import { applyToolResultCharCap } from '../../src/tool-result-limit.js';

const ENV_KEY = 'MCP_MAX_TOOL_RESULT_CHARS';
const savedEnv = process.env[ENV_KEY];

afterEach(() => {
  if (savedEnv === undefined) delete process.env['MCP_MAX_TOOL_RESULT_CHARS'];
  else process.env[ENV_KEY] = savedEnv;
});

describe('applyToolResultCharCap', () => {
  it('returns text unchanged when under the cap', () => {
    process.env[ENV_KEY] = '1000';
    const text = 'short response';
    expect(applyToolResultCharCap(text, 'tool')).toBe(text);
  });

  it('returns text unchanged when the cap is disabled (0)', () => {
    process.env[ENV_KEY] = '0';
    const text = 'x'.repeat(500_000);
    expect(applyToolResultCharCap(text, 'tool')).toBe(text);
  });

  it('truncates a large JSON payload into a still-parseable prefix', () => {
    process.env[ENV_KEY] = '3000';
    // Pretty-printed JSON like wrapUntrustedResponse produces (JSON.stringify(data, null, 2)).
    const rows: unknown[][] = [];
    for (let i = 0; i < 400; i++) {
      rows.push([`Date(2026,6,22,10,${String(i)},30)`, 5.7567 + i * 0.001, 5.6922 + i * 0.001]);
    }
    const text = JSON.stringify({ metrics: { cpu_usage: { data: { rows } } } }, null, 2);
    expect(text.length).toBeGreaterThan(3000);

    const out = applyToolResultCharCap(text, 'aiven_service_metrics_fetch');
    expect(out.length).toBeLessThanOrEqual(3000);

    // Body is everything before the trim notice; it must be valid JSON despite truncation.
    const body = out.split('\n\n---\n')[0] ?? out;
    const parsed = JSON.parse(body) as { metrics: { cpu_usage: { data: { rows: unknown[] } } } };
    // Some rows were dropped, but the structure is intact and parseable.
    const kept = parsed.metrics.cpu_usage.data.rows;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(400);
  });

  it('closes an open string when the cut lands inside a quoted value', () => {
    process.env[ENV_KEY] = '80';
    const text = JSON.stringify({ items: ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'] }, null, 2);
    const out = applyToolResultCharCap(text, 'tool');
    const body = out.split('\n\n---\n')[0] ?? out;
    expect(() => JSON.parse(body) as unknown).not.toThrow();
  });

  it('falls back to a hard slice when there is no newline to back off to', () => {
    process.env[ENV_KEY] = '500';
    const text = 'x'.repeat(5000); // single line, no newline
    const out = applyToolResultCharCap(text, 'tool');
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out).toContain('**Trimmed:**');
  });
});

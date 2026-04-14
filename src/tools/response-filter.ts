import type { ResponseFilterConfig } from '../types.js';

function pickFields(
  item: Record<string, unknown>,
  allowlist: Set<string>
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([key]) => allowlist.has(key)));
}

export function applyResponseFilter(
  data: Record<string, unknown>,
  config: ResponseFilterConfig
): Record<string, unknown> {
  const value = data[config.key];
  const allowlist = new Set(config.fields);

  if (Array.isArray(value)) {
    return {
      [config.key]: value.map((item: Record<string, unknown>) => pickFields(item, allowlist)),
    };
  }

  if (typeof value === 'object' && value !== null) {
    return {
      [config.key]: pickFields(value as Record<string, unknown>, allowlist),
    };
  }

  return data;
}

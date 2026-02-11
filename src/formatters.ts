type Formatter = (data: unknown) => unknown;

function pick<T extends Record<string, unknown>>(obj: T, keys: string[]): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in obj) {
      // eslint-disable-next-line security/detect-object-injection
      result[key] = obj[key];
    }
  }
  return result as Partial<T>;
}

const SERVICE_LIST_FIELDS = ['service_name', 'service_type', 'state', 'plan'];

function formatServiceList(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const obj = data as Record<string, unknown>;
  const services = obj['services'];

  if (!Array.isArray(services)) return data;

  return {
    services: (services as Record<string, unknown>[]).map((svc) => pick(svc, SERVICE_LIST_FIELDS)),
  };
}

const FORMATTERS: Record<string, Formatter> = {
  service_list: formatServiceList,
};

export function formatResponse(name: string, data: unknown): unknown {
  // eslint-disable-next-line security/detect-object-injection
  const fn = FORMATTERS[name];
  return fn ? fn(data) : data;
}

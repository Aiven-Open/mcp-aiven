/** Matches Aiven Console: newly created services report REBUILDING during initial provisioning. */
export const INITIAL_BUILD_WINDOW_MS = 30 * 60 * 1000;

export function isInitialProvisioning(
  state: string,
  createTime: string | undefined,
  options?: { assumeRecent?: boolean }
): boolean {
  if (state !== 'REBUILDING') return false;
  if (options?.assumeRecent) return true;
  if (!createTime) return false;
  const created = new Date(createTime).getTime();
  if (Number.isNaN(created)) return false;
  return Date.now() - created < INITIAL_BUILD_WINDOW_MS;
}

/**
 * Adds `state_display` when API `state` is REBUILDING but the service is still in its initial build.
 * Raw `state` is left unchanged so it stays aligned with the Aiven API.
 */
export function enrichServiceRecord(
  service: Record<string, unknown>,
  options?: { assumeRecent?: boolean }
): Record<string, unknown> {
  const state = typeof service['state'] === 'string' ? service['state'] : undefined;
  const createTime = typeof service['create_time'] === 'string' ? service['create_time'] : undefined;
  if (!state || !isInitialProvisioning(state, createTime, options)) {
    return service;
  }
  return {
    ...service,
    state_display: 'BUILDING',
  };
}

export function enrichServiceResponse(
  data: Record<string, unknown>,
  options?: { assumeRecent?: boolean }
): Record<string, unknown> {
  const service = data['service'];
  if (service && typeof service === 'object') {
    return { ...data, service: enrichServiceRecord(service as Record<string, unknown>, options) };
  }
  const services = data['services'];
  if (Array.isArray(services)) {
    return {
      ...data,
      services: services.map((item) =>
        item && typeof item === 'object'
          ? enrichServiceRecord(item as Record<string, unknown>, options)
          : item
      ),
    };
  }
  return data;
}

const MARKETPLACE_TENANTS = new Set(['aws', 'azure', 'gcp']);

export function resolveAuthorizationServer(marketplace: unknown, apiOrigin: string): string {
  const tenant = typeof marketplace === 'string' ? marketplace.trim().toLowerCase() : undefined;
  if (tenant && MARKETPLACE_TENANTS.has(tenant)) {
    return `${apiOrigin}/${tenant}`;
  }
  return apiOrigin;
}

export function buildResourceUrl(host: string, tenant: string | undefined): string {
  return tenant ? `${host}/${tenant}` : host;
}

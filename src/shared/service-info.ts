import type { AivenClient } from '../client.js';
import type { ServiceConnectionInfo } from '../types.js';

interface ServiceUriParams {
  host: string;
  port: string;
  user: string;
  password: string;
  dbname?: string;
}

interface ServiceResponse {
  service: {
    service_uri_params?: ServiceUriParams;
  };
}

interface CaCertResponse {
  certificate?: string;
}

export async function getProjectCaCert(
  client: AivenClient,
  project: string,
  token?: string
): Promise<string | undefined> {
  try {
    const opts = token ? { token } : undefined;
    const data = await client.get<CaCertResponse>(
      `/project/${encodeURIComponent(project)}/kms/ca`,
      opts
    );
    return data.certificate;
  } catch {
    return undefined;
  }
}

export async function getServiceConnectionInfo(
  client: AivenClient,
  project: string,
  serviceName: string,
  token?: string
): Promise<ServiceConnectionInfo> {
  const opts = token ? { token } : undefined;
  const data = await client.get<ServiceResponse>(
    `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}`,
    opts
  );

  const params = data.service.service_uri_params;
  if (!params) {
    throw new Error(`No connection info available for service ${serviceName}. Ensure the service is running.`);
  }

  const { host, port: portStr, user, password, dbname = 'defaultdb' } = params;
  const port = Number(portStr);

  if (!host || !port || !user || !password) {
    throw new Error(`Incomplete connection details for service ${serviceName}. Ensure the service is running.`);
  }

  return { host, port, user, password, dbname };
}

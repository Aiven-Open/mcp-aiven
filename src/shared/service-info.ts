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
): Promise<string> {
  const opts = token ? { token } : undefined;
  const data = await client.get<CaCertResponse>(
    `/project/${encodeURIComponent(project)}/kms/ca`,
    opts
  );
  if (!data.certificate) {
    throw new Error(
      `Failed to retrieve the CA certificate for project "${project}". ` +
        'A valid CA certificate is required to securely connect to PostgreSQL. ' +
        'Refusing to connect without TLS verification.'
    );
  }
  return data.certificate;
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

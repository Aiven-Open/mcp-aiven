import pg from 'pg';
import type { AivenClient } from '../../client.js';
import { getServiceConnectionInfo, getProjectCaCert } from '../../shared/service-info.js';

const CONNECTION_TIMEOUT_MS = 10000;

export async function connectToService(
  client: AivenClient,
  project: string,
  serviceName: string,
  database?: string,
  token?: string
): Promise<pg.Client> {
  const connInfo = await getServiceConnectionInfo(client, project, serviceName, token);
  const caCert = await getProjectCaCert(client, project, token);

  const pgClient = new pg.Client({
    host: connInfo.host,
    port: connInfo.port,
    user: connInfo.user,
    password: connInfo.password,
    database: database ?? connInfo.dbname,
    ssl: { rejectUnauthorized: true, ca: caCert },
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });

  try {
    await pgClient.connect();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown connection error';
    const hint = /authentication failed/i.test(msg)
      ? '\nHint: Your token lacks permission for this operation. Check your user role and permissions.'
      : '';
    throw new Error(`PostgreSQL connection error: ${msg}${hint}`);
  }

  return pgClient;
}

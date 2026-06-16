import type { AivenClient } from '../../client.js';
import type { RequestOptions } from '../../types.js';

export function pgRunQueryPath(project: string, serviceName: string): string {
  return `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}/pg-editor/run-query`;
}

export interface PgRunQueryBody {
  query: string;
  database: string;
  schema_name: string;
  expect_readonly: boolean;
}

export async function postPgRunQuery(
  client: AivenClient,
  project: string,
  serviceName: string,
  body: PgRunQueryBody,
  opts?: RequestOptions
): Promise<Record<string, unknown>> {
  return client.post<Record<string, unknown>>(pgRunQueryPath(project, serviceName), body, {
    ...opts,
    mcpAcornAuth: true,
  });
}

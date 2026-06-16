import type { AivenClient } from '../../client.js';
import type { RequestOptions } from '../../types.js';

export function pgEditorRunQueryPath(project: string, serviceName: string): string {
  return `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}/pg-editor/run-query`;
}

export interface PgEditorRunQueryBody {
  query: string;
  database: string;
  schema_name: string;
  expect_readonly: boolean;
}

export async function postPgEditorRunQuery(
  client: AivenClient,
  project: string,
  serviceName: string,
  body: PgEditorRunQueryBody,
  opts?: RequestOptions
): Promise<Record<string, unknown>> {
  return client.post<Record<string, unknown>>(pgEditorRunQueryPath(project, serviceName), body, {
    ...opts,
    mcpAcornAuth: true,
  });
}

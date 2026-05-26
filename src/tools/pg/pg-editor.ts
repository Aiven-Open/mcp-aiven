import type { AivenClient } from '../../client.js';
import type { RequestOptions } from '../../types.js';

export function pgEditorServicePath(project: string, serviceName: string): string {
  return `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}`;
}

export function pgEditorRunQueryPath(project: string, serviceName: string): string {
  return `${pgEditorServicePath(project, serviceName)}/pg-editor/run-query`;
}

export function pgEditorSchemasPath(project: string, serviceName: string): string {
  return `${pgEditorServicePath(project, serviceName)}/pg-editor/schemas`;
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

interface ServiceWithDatabases {
  service?: {
    databases?: Array<string | { database_name?: string; name?: string }>;
  };
}

export async function fetchPgDatabaseNames(
  client: AivenClient,
  project: string,
  serviceName: string,
  opts?: RequestOptions
): Promise<string[]> {
  const data = await client.get<ServiceWithDatabases>(
    pgEditorServicePath(project, serviceName),
    opts
  );

  const databases = data.service?.databases;
  if (!Array.isArray(databases) || databases.length === 0) {
    throw new Error(
      `No databases found for service ${serviceName}. Ensure the PostgreSQL service is running.`
    );
  }

  const names: string[] = [];
  for (const entry of databases) {
    if (typeof entry === 'string') {
      names.push(entry);
      continue;
    }
    const name = entry.database_name ?? entry.name;
    if (typeof name === 'string' && name.length > 0) {
      names.push(name);
    }
  }

  if (names.length === 0) {
    throw new Error(
      `No database names found for service ${serviceName}. Ensure the PostgreSQL service is running.`
    );
  }

  return names;
}

export async function fetchPgSchemaNames(
  client: AivenClient,
  project: string,
  serviceName: string,
  database: string,
  opts?: RequestOptions
): Promise<string[]> {
  const data = await client.get<Record<string, unknown>>(pgEditorSchemasPath(project, serviceName), {
    ...opts,
    query: { database },
  });

  const raw =
    data['schemas'] ??
    data['schema_list'] ??
    data['schema_names'] ??
    (Array.isArray(data) ? data : undefined);

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `No schemas found for database "${database}" on service ${serviceName}. ` +
        'Verify the database name with aiven_pg_list_databases.'
    );
  }

  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      names.push(entry);
      continue;
    }
    if (entry && typeof entry === 'object') {
      const obj = entry as { schema_name?: string; name?: string };
      const name = obj.schema_name ?? obj.name;
      if (typeof name === 'string' && name.length > 0) {
        names.push(name);
      }
    }
  }

  if (names.length === 0) {
    throw new Error(`No schema names found for database "${database}" on service ${serviceName}.`);
  }

  return names;
}

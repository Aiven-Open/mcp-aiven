import { z } from 'zod';
import type { AivenClient } from '../../client.js';
import type { ToolDefinition, ToolResult, HandlerContext } from '../../types.js';
import {
  PgToolName,
  PgQueryMode,
  READ_ONLY_ANNOTATIONS,
  WRITE_DML_ANNOTATIONS,
  ServiceCategory,
  toolSuccess,
  toolError,
} from '../../types.js';
import { errorMessage } from '../../errors.js';
import { redactSensitiveData } from '../../security.js';
import { wrapUntrustedResponse } from '../../untrusted.js';
import { executePgQuery } from './query.js';
import {
  optimizeQueryInput,
  pgQueryInput,
  pgExecuteQueryInput,
  pgListDatabasesInput,
  pgListSchemasInput,
} from './schemas.js';
import {
  OPTIMIZE_QUERY_DESCRIPTION,
  PG_READ_DESCRIPTION,
  PG_WRITE_DESCRIPTION,
  PG_LIST_DATABASES_DESCRIPTION,
  PG_LIST_SCHEMAS_DESCRIPTION,
} from './descriptions.js';
import { fetchPgDatabaseNames, fetchPgSchemaNames } from './pg-editor.js';

function requestOpts(context: HandlerContext | undefined, toolName: string) {
  return {
    token: context?.token,
    mcpClient: context?.mcpClient,
    clientIp: context?.clientIp,
    toolName,
    requestId: context?.requestId,
    toolReasoning: context?.toolReasoning,
  };
}

export function createPgCustomTools(client: AivenClient): ToolDefinition[] {
  return [
    {
      name: PgToolName.OptimizeQuery,
      category: ServiceCategory.Pg,
      definition: {
        title: 'AI Query Optimization (EverSQL)',
        description: OPTIMIZE_QUERY_DESCRIPTION,
        inputSchema: optimizeQueryInput,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        try {
          const typedParams = params as z.infer<typeof optimizeQueryInput>;
          const encodedQuery = Buffer.from(typedParams.query).toString('base64');

          const data = await client.post<Record<string, unknown>>(
            `/account/${typedParams.account_id}/pg/query/optimize`,
            {
              query: encodedQuery,
              pg_version: typedParams.pg_version,
              flags: [],
            },
            requestOpts(context, PgToolName.OptimizeQuery)
          );

          return toolSuccess(wrapUntrustedResponse(redactSensitiveData(data)));
        } catch (err) {
          return toolError(errorMessage(err));
        }
      },
    },

    {
      name: PgToolName.ListDatabases,
      category: ServiceCategory.Pg,
      definition: {
        title: 'List PostgreSQL Databases',
        description: PG_LIST_DATABASES_DESCRIPTION,
        inputSchema: pgListDatabasesInput,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        try {
          const { project, service_name: serviceName } = params as z.infer<typeof pgListDatabasesInput>;
          const databases = await fetchPgDatabaseNames(
            client,
            project,
            serviceName,
            requestOpts(context, PgToolName.ListDatabases)
          );
          return toolSuccess(wrapUntrustedResponse({ databases }));
        } catch (err) {
          return toolError(errorMessage(err));
        }
      },
    },

    {
      name: PgToolName.ListSchemas,
      category: ServiceCategory.Pg,
      definition: {
        title: 'List PostgreSQL Schemas',
        description: PG_LIST_SCHEMAS_DESCRIPTION,
        inputSchema: pgListSchemasInput,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        try {
          const { project, service_name: serviceName, database } = params as z.infer<
            typeof pgListSchemasInput
          >;
          const schemas = await fetchPgSchemaNames(
            client,
            project,
            serviceName,
            database,
            requestOpts(context, PgToolName.ListSchemas)
          );
          return toolSuccess(wrapUntrustedResponse({ schemas }));
        } catch (err) {
          return toolError(errorMessage(err));
        }
      },
    },

    {
      name: PgToolName.Read,
      category: ServiceCategory.Pg,
      definition: {
        title: 'Run Read-Only SQL Query',
        description: PG_READ_DESCRIPTION,
        inputSchema: pgQueryInput,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const { project, service_name, query, database, schema, limit, offset } = params as z.infer<
          typeof pgQueryInput
        >;
        return executePgQuery(client, {
          project,
          service_name,
          query,
          database,
          schema,
          mode: PgQueryMode.ReadOnly,
          limit,
          offset,
          token: context?.token,
          mcpClient: context?.mcpClient,
          clientIp: context?.clientIp,
          toolName: PgToolName.Read,
          requestId: context?.requestId,
          toolReasoning: context?.toolReasoning,
        });
      },
    },

    {
      name: PgToolName.Write,
      category: ServiceCategory.Pg,
      definition: {
        title: 'Execute SQL Write Statement',
        description: PG_WRITE_DESCRIPTION,
        inputSchema: pgExecuteQueryInput,
        annotations: WRITE_DML_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const { project, service_name, query, database, schema, limit, offset } = params as z.infer<
          typeof pgExecuteQueryInput
        >;

        return executePgQuery(client, {
          project,
          service_name,
          query,
          database,
          schema,
          mode: PgQueryMode.ReadWrite,
          limit,
          offset,
          token: context?.token,
          mcpClient: context?.mcpClient,
          clientIp: context?.clientIp,
          toolName: PgToolName.Write,
          requestId: context?.requestId,
          toolReasoning: context?.toolReasoning,
        });
      },
    },
  ];
}

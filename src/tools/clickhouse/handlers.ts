import { z } from 'zod';
import type { AivenClient } from '../../client.js';
import type { ToolDefinition, ToolResult, HandlerContext } from '../../types.js';
import {
  ClickHouseToolName,
  ClickHouseQueryMode,
  READ_ONLY_ANNOTATIONS,
  WRITE_DML_ANNOTATIONS,
  ServiceCategory,
} from '../../types.js';
import { executeClickHouseQuery } from './query.js';
import { clickHouseQueryInput, clickHouseWriteQueryInput } from './schemas.js';
import { CLICKHOUSE_READ_DESCRIPTION, CLICKHOUSE_WRITE_DESCRIPTION } from './descriptions.js';

export function createClickHouseCustomTools(client: AivenClient): ToolDefinition[] {
  return [
    {
      name: ClickHouseToolName.Read,
      category: ServiceCategory.ClickHouse,
      definition: {
        title: 'Run Read-Only ClickHouse Query',
        description: CLICKHOUSE_READ_DESCRIPTION,
        inputSchema: clickHouseQueryInput,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const { project, service_name, query, database, limit, offset } = params as z.infer<
          typeof clickHouseQueryInput
        >;
        return executeClickHouseQuery(client, {
          project,
          service_name,
          query,
          database,
          mode: ClickHouseQueryMode.ReadOnly,
          limit,
          offset,
          token: context?.token,
          mcpClient: context?.mcpClient,
          toolName: ClickHouseToolName.Read,
        });
      },
    },

    {
      name: ClickHouseToolName.Write,
      category: ServiceCategory.ClickHouse,
      definition: {
        title: 'Execute ClickHouse Write Statement',
        description: CLICKHOUSE_WRITE_DESCRIPTION,
        inputSchema: clickHouseWriteQueryInput,
        annotations: WRITE_DML_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const { project, service_name, query, database, limit, offset } = params as z.infer<
          typeof clickHouseWriteQueryInput
        >;
        return executeClickHouseQuery(client, {
          project,
          service_name,
          query,
          database,
          mode: ClickHouseQueryMode.ReadWrite,
          limit,
          offset,
          token: context?.token,
          mcpClient: context?.mcpClient,
          toolName: ClickHouseToolName.Write,
        });
      },
    },
  ];
}

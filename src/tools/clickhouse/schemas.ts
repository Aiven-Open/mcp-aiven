import { z } from 'zod';
import { MAX_ROWS, DEFAULT_LIMIT } from './query.js';

export const clickHouseQueryInput = z
  .object({
    project: z.string().describe('Aiven project name — use aiven_project_list to get valid names'),
    service_name: z.string().describe('Aiven ClickHouse service name'),
    query: z
      .string()
      .describe(
        'Read-only SQL query to execute. Only SELECT, SHOW, DESCRIBE, EXPLAIN, and similar read operations are allowed.'
      ),
    database: z
      .string()
      .optional()
      .describe('Database name to run the query against (default: "default")'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_ROWS)
      .optional()
      .describe(
        `Maximum number of rows to return per page (default: ${DEFAULT_LIMIT}, max: ${MAX_ROWS}). Use with offset for pagination.`
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Number of rows to skip before returning results (default: 0). Use with limit for pagination.'
      ),
  })
  .strict();

export const clickHouseWriteQueryInput = z
  .object({
    project: z.string().describe('Aiven project name — use aiven_project_list to get valid names'),
    service_name: z.string().describe('Aiven ClickHouse service name'),
    query: z
      .string()
      .describe(
        'SQL statement to execute. Allows DML (INSERT), DDL (CREATE TABLE, ALTER TABLE), and read queries. Blocks DROP, TRUNCATE, GRANT, REVOKE, and SYSTEM commands.'
      ),
    database: z
      .string()
      .optional()
      .describe('Database name to run the query against (default: "default")'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_ROWS)
      .optional()
      .describe(
        `Maximum number of rows to return per page (default: ${DEFAULT_LIMIT}, max: ${MAX_ROWS}). Use with offset for pagination.`
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Number of rows to skip before returning results (default: 0). Use with limit for pagination.'
      ),
  })
  .strict();

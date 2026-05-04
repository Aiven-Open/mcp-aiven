import { z } from 'zod';
import { MAX_ROWS, DEFAULT_LIMIT } from './query.js';

export const optimizeQueryInput = z
  .object({
    account_id: z
      .string()
      .describe('Aiven account ID. Get this from get_project response at project.account_id'),
    query: z
      .string()
      .describe('SQL query to optimize (plain text, will be base64 encoded automatically)'),
    pg_version: z
      .enum(['18', '17', '16', '15', '14', '13', '12', '11', '10', '9'])
      .default('16')
      .describe('PostgreSQL version'),
    reasoning: z.string().min(1).describe('Brief explanation of why you are making this call. Used for audit logs and debugging.'),
  })
  .strict();

export const pgQueryInput = z
  .object({
    project: z.string().describe('Aiven project name — use aiven_project_list to get valid names'),
    service_name: z.string().describe('Aiven PostgreSQL service name'),
    query: z
      .string()
      .describe(
        'Read-only SQL query to execute. Only SELECT and similar read operations are allowed.'
      ),
    database: z
      .string()
      .optional()
      .describe('Database name to connect to (default: service default, usually "defaultdb")'),
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
    reasoning: z.string().min(1).describe('Brief explanation of why you are making this call. Used for audit logs and debugging.'),
  })
  .strict();

export const pgExecuteQueryInput = z
  .object({
    project: z.string().describe('Aiven project name — use aiven_project_list to get valid names'),
    service_name: z.string().describe('Aiven PostgreSQL service name'),
    query: z
      .string()
      .describe(
        'SQL statement to execute. Allows DML (INSERT, UPDATE, DELETE) and DDL (CREATE TABLE, ALTER TABLE, CREATE INDEX). Blocks DROP, TRUNCATE, GRANT, and REVOKE.'
      ),
    database: z
      .string()
      .optional()
      .describe('Database name to connect to (default: service default, usually "defaultdb")'),
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
    reasoning: z.string().min(1).describe('Brief explanation of why you are making this call. Used for audit logs and debugging.'),
  })
  .strict();

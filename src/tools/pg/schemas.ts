import { z } from 'zod';
import { MAX_ROWS, DEFAULT_LIMIT } from './helpers.js';

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
  })
  .strict();

export const pgQueryInput = z
  .object({
    project: z.string().describe('Aiven project name'),
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
  })
  .strict();

export const pgExecuteQueryInput = z
  .object({
    project: z.string().describe('Aiven project name'),
    service_name: z.string().describe('Aiven PostgreSQL service name'),
    query: z
      .string()
      .describe(
        'DML SQL statement to execute: INSERT, UPDATE, DELETE, or SELECT. DDL (CREATE, DROP, ALTER, etc.) is blocked.'
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
  })
  .strict();

export const pgServiceInput = z
  .object({
    project: z.string().describe('Aiven project name'),
    service_name: z.string().describe('Aiven PostgreSQL service name'),
    database: z
      .string()
      .optional()
      .describe('Database name to connect to (default: service default, usually "defaultdb")'),
  })
  .strict();

export const pgSchemaInput = pgServiceInput.extend({
  schema: z.string().default('public').describe('Schema name (default: public)'),
});

export const pgTableInput = pgSchemaInput.extend({
  table: z.string().describe('Table name'),
});

export const pgExplainInput = z
  .object({
    project: z.string().describe('Aiven project name'),
    service_name: z.string().describe('Aiven PostgreSQL service name'),
    query: z.string().describe('SQL query to analyze with EXPLAIN ANALYZE'),
    database: z
      .string()
      .optional()
      .describe('Database name to connect to (default: service default, usually "defaultdb")'),
  })
  .strict();

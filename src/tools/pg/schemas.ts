import { z } from 'zod';
import { MAX_ROWS, DEFAULT_LIMIT } from './query.js';
import { reasoningField, SQL_QUERY_MAX_LENGTH } from '../shared-schemas.js';

export const optimizeQueryInput = z
  .object({
    account_id: z
      .string()
      .describe('Aiven account ID. Get this from get_project response at project.account_id'),
    query: z
      .string()
      .max(SQL_QUERY_MAX_LENGTH)
      .describe('SQL query to optimize (plain text, will be base64 encoded automatically)'),
    pg_version: z
      .enum(['18', '17', '16', '15', '14', '13', '12', '11', '10', '9'])
      .default('16')
      .describe('PostgreSQL version'),
    reasoning: reasoningField,
  })
  .strict();

const pgTargetFields = {
  project: z.string().describe('Aiven project name — use aiven_project_list to get valid names'),
  service_name: z.string().describe('Aiven PostgreSQL service name'),
  database: z
    .string()
    .describe(
      'Database name. Call aiven_pg_list_databases first if the user has not specified one.'
    ),
  schema: z
    .string()
    .describe(
      'PostgreSQL schema name (e.g. "public"). Call aiven_pg_list_schemas for the chosen database if unknown.'
    ),
};

export const pgListDatabasesInput = z
  .object({
    project: pgTargetFields.project,
    service_name: pgTargetFields.service_name,
    reasoning: reasoningField,
  })
  .strict();

export const pgListSchemasInput = z
  .object({
    project: pgTargetFields.project,
    service_name: pgTargetFields.service_name,
    database: pgTargetFields.database,
    reasoning: reasoningField,
  })
  .strict();

export const pgQueryInput = z
  .object({
    ...pgTargetFields,
    query: z
      .string()
      .max(SQL_QUERY_MAX_LENGTH)
      .describe(
        'Read-only SQL query to execute. Only SELECT and similar read operations are allowed.'
      ),
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
    reasoning: reasoningField,
  })
  .strict();

export const pgExecuteQueryInput = z
  .object({
    ...pgTargetFields,
    query: z
      .string()
      .max(SQL_QUERY_MAX_LENGTH)
      .describe(
        'SQL statement to execute. Allows DML (INSERT, UPDATE, DELETE) and DDL (CREATE TABLE, ALTER TABLE, CREATE INDEX). Blocks DROP, TRUNCATE, GRANT, and REVOKE.'
      ),
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
    reasoning: reasoningField,
  })
  .strict();

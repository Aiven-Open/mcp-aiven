import { UNTRUSTED_DATA_SUFFIX } from '../../prompts.js';
import { MAX_ROWS, DEFAULT_LIMIT } from './query.js';

export const OPTIMIZE_QUERY_DESCRIPTION = `Get AI-powered query optimization using EverSQL.

**IMPORTANT:** Requires account_id. Get it by calling get_project first -
the account_id is in the response at project.account_id.

Analyzes your SQL query and returns:
- Optimized query rewrites
- Index recommendations with CREATE INDEX statements
- Detailed explanations

Works best with SELECT queries but also helps with INSERT/UPDATE/DELETE.

**Example workflow:**
1. Call get_project(project="my-project") -> get account_id from response
2. Call optimize_query(account_id="...", query="SELECT * FROM orders WHERE status = 'pending'")`;

export const PG_LIST_DATABASES_DESCRIPTION = `List PostgreSQL databases on an Aiven service.

Call this before \`aiven_pg_read\` or \`aiven_pg_write\` when the user has not specified which database to use.
Present the options and confirm the choice before running SQL.

${UNTRUSTED_DATA_SUFFIX}`;

export const PG_LIST_SCHEMAS_DESCRIPTION = `List PostgreSQL schemas in a database on an Aiven service.

Call this after choosing a database (via \`aiven_pg_list_databases\`) when the user has not specified a schema.
Present the options and confirm the choice (often \`public\`) before running SQL.

${UNTRUSTED_DATA_SUFFIX}`;

const PG_QUERY_COMMON = `Queries run via the PG Editor API (\`POST …/pg-editor/run-query\`) on Aiven's side (same path as Console PG Studio). Your client IP must be allowed on the service IP filter when using remote HTTP MCP.

**Workflow:** If \`database\` or \`schema\` is unknown, call \`aiven_pg_list_databases\` then \`aiven_pg_list_schemas\` and ask the user to pick before executing SQL.

Results are capped at ${MAX_ROWS} rows. Large cell values are truncated.
Supports pagination via \`limit\` (default ${DEFAULT_LIMIT}) and \`offset\` (default 0).
Response metadata includes \`hasMore\`, \`offset\`, and \`limit\` to assist with paging.`;

export const PG_READ_DESCRIPTION = `Execute a read-only SQL query against an Aiven PostgreSQL service.

${PG_QUERY_COMMON}

Only SELECT and EXPLAIN are allowed. INSERT, UPDATE, DELETE, CREATE, DROP, and other write operations are rejected before the API is called.

**Example:**
\`\`\`
aiven_pg_read(
  project="my-project",
  service_name="my-pg",
  database="defaultdb",
  schema="public",
  query="SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
)
\`\`\`

${UNTRUSTED_DATA_SUFFIX}`;

export const PG_WRITE_DESCRIPTION = `Execute a write SQL statement against an Aiven PostgreSQL service.

${PG_QUERY_COMMON}

Allows DML (INSERT, UPDATE, DELETE) and DDL (CREATE TABLE, ALTER TABLE, CREATE INDEX, etc.).

**Blocked operations:** DROP, TRUNCATE, GRANT, REVOKE, REASSIGN, SECURITY LABEL, DO, CREATE FUNCTION, and CREATE PROCEDURE are rejected before the API is called.

**IMPORTANT:** Only ONE statement per call. Multiple statements separated by semicolons are rejected.

**Examples:**
\`\`\`
aiven_pg_write(project="my-project", service_name="my-pg", database="defaultdb", schema="public", query="CREATE TABLE orders (id serial PRIMARY KEY)")
aiven_pg_write(project="my-project", service_name="my-pg", database="defaultdb", schema="public", query="INSERT INTO users (name) VALUES ('Alice') RETURNING id")
\`\`\`

${UNTRUSTED_DATA_SUFFIX}`;

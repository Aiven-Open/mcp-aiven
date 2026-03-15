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

export const PG_READ_DESCRIPTION = `Execute a read-only SQL query against an Aiven PostgreSQL service.

The connection is made in read-only mode with a 30-second timeout.
Only SELECT and other read operations are allowed. INSERT, UPDATE, DELETE,
CREATE, DROP, and other write operations will be rejected by PostgreSQL.

Results are capped at ${MAX_ROWS} rows. Large cell values are truncated.
Supports pagination via \`limit\` (default ${DEFAULT_LIMIT}) and \`offset\` (default 0).
Response metadata includes \`hasMore\`, \`offset\`, and \`limit\` to assist with paging.

**Tip:** Before querying data, check the table structure first:
\`\`\`
SELECT tablename FROM pg_tables WHERE schemaname = 'public'
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'my_table'
\`\`\`

**Example:**
\`\`\`
aiven_pg_read(project="my-project", service_name="my-pg", query="SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
\`\`\`

${UNTRUSTED_DATA_SUFFIX}`;

export const PG_WRITE_DESCRIPTION = `Execute a write SQL statement against an Aiven PostgreSQL service.

Allows DML (INSERT, UPDATE, DELETE) and DDL (CREATE TABLE, ALTER TABLE, CREATE INDEX, etc.).

**Blocked operations:** DROP, TRUNCATE, GRANT, REVOKE, REASSIGN, SECURITY LABEL, DO, CREATE FUNCTION, and CREATE PROCEDURE are rejected by this tool.

**IMPORTANT:** Only ONE statement per call. Multiple statements separated by semicolons are rejected. Call this tool once per statement.

A 30-second statement timeout is enforced. Results are capped at ${MAX_ROWS} rows.
Supports pagination via \`limit\` (default ${DEFAULT_LIMIT}) and \`offset\` (default 0).
Response metadata includes \`hasMore\`, \`offset\`, and \`limit\` to assist with paging.

**Examples:**
\`\`\`
aiven_pg_write(project="my-project", service_name="my-pg", query="CREATE TABLE orders (id serial PRIMARY KEY, status text, created_at timestamptz DEFAULT now())")
aiven_pg_write(project="my-project", service_name="my-pg", query="INSERT INTO users (name) VALUES ('Alice') RETURNING id, name")
aiven_pg_write(project="my-project", service_name="my-pg", query="ALTER TABLE orders ADD COLUMN total numeric")
\`\`\`

${UNTRUSTED_DATA_SUFFIX}`;

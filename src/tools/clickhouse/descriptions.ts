import { UNTRUSTED_DATA_SUFFIX } from '../../prompts.js';
import { MAX_ROWS, DEFAULT_LIMIT } from './query.js';

export const CLICKHOUSE_READ_DESCRIPTION = `Execute a read-only SQL query against an Aiven ClickHouse service.

The query is executed via the Aiven API as the main service user.
Only SELECT, SHOW, DESCRIBE, EXPLAIN, and similar read operations are allowed.
INSERT, CREATE, ALTER, DROP, and other write operations will be rejected.

Results are capped at ${MAX_ROWS} rows. Large cell values are truncated.
Supports pagination via \`limit\` (default ${DEFAULT_LIMIT}) and \`offset\` (default 0).
Response metadata includes \`hasMore\`, \`offset\`, and \`limit\` to assist with paging.

**Tip:** Before querying data, check the schema first:
\`\`\`
SHOW DATABASES
SHOW TABLES FROM my_database
DESCRIBE TABLE my_database.my_table
\`\`\`

**Example:**
\`\`\`
aiven_clickhouse_read(project="my-project", service_name="my-ch", query="SELECT * FROM my_table LIMIT 10", database="default")
\`\`\`

${UNTRUSTED_DATA_SUFFIX}`;

export const CLICKHOUSE_WRITE_DESCRIPTION = `Execute a write SQL statement against an Aiven ClickHouse service.

Allows DML (INSERT), DDL (CREATE TABLE, ALTER TABLE, CREATE VIEW, etc.), and read queries.

**Blocked operations:** DROP, TRUNCATE, GRANT, REVOKE, SYSTEM, KILL, DETACH, and ATTACH are rejected by this tool.

**IMPORTANT:** Only ONE statement per call. Multiple statements separated by semicolons may not work as expected. Call this tool once per statement.

Results are capped at ${MAX_ROWS} rows.
Supports pagination via \`limit\` (default ${DEFAULT_LIMIT}) and \`offset\` (default 0).
Response metadata includes \`hasMore\`, \`offset\`, and \`limit\` to assist with paging.

**Examples:**
\`\`\`
aiven_clickhouse_write(project="my-project", service_name="my-ch", query="CREATE TABLE events (id UInt64, name String, timestamp DateTime) ENGINE = MergeTree() ORDER BY id", database="default")
aiven_clickhouse_write(project="my-project", service_name="my-ch", query="INSERT INTO events (id, name, timestamp) VALUES (1, 'click', now())", database="default")
aiven_clickhouse_write(project="my-project", service_name="my-ch", query="ALTER TABLE events ADD COLUMN category String DEFAULT ''", database="default")
\`\`\`

${UNTRUSTED_DATA_SUFFIX}`;

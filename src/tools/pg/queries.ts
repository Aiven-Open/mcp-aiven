/**
 * Predefined SQL queries for PostgreSQL schema exploration tools.
 * All queries use pg_catalog and are read-only.
 */

export const LIST_SCHEMAS = `\
SELECT
  n.nspname AS schema_name,
  COUNT(c.relname) FILTER (WHERE c.relkind = 'r') AS table_count,
  COUNT(c.relname) FILTER (WHERE c.relkind = 'v') AS view_count
FROM pg_namespace n
LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r', 'v')
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
  AND n.nspname NOT LIKE 'pg_toast_temp_%'
GROUP BY n.nspname
ORDER BY n.nspname`;

export const LIST_TABLES = `\
SELECT
  c.relname AS table_name,
  pg_stat_get_live_tuples(c.oid) AS estimated_row_count,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  pg_size_pretty(pg_relation_size(c.oid)) AS data_size,
  obj_description(c.oid, 'pg_class') AS description
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND c.relkind IN ('r', 'p')
ORDER BY c.relname`;

export const DESCRIBE_COLUMNS = `\
SELECT
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  NOT a.attnotnull AS is_nullable,
  pg_get_expr(d.adbin, d.adrelid) AS default_value,
  col_description(a.attrelid, a.attnum) AS description
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = $1 AND c.relname = $2
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY a.attnum`;

export const DESCRIBE_CONSTRAINTS = `\
SELECT
  con.conname AS constraint_name,
  CASE con.contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'c' THEN 'CHECK'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'x' THEN 'EXCLUSION'
  END AS constraint_type,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2
ORDER BY con.contype, con.conname`;

export const DESCRIBE_INDEXES = `\
SELECT
  i.relname AS index_name,
  am.amname AS index_type,
  pg_get_indexdef(i.oid) AS definition
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_am am ON am.oid = i.relam
WHERE n.nspname = $1 AND t.relname = $2
ORDER BY i.relname`;

export const LIST_INDEXES = `\
SELECT
  i.relname AS index_name,
  am.amname AS index_type,
  pg_get_indexdef(i.oid) AS definition,
  pg_size_pretty(pg_relation_size(i.oid)) AS size,
  s.idx_scan AS scans,
  s.idx_tup_read AS tuples_read,
  s.idx_tup_fetch AS tuples_fetched
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_am am ON am.oid = i.relam
LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.oid
WHERE n.nspname = $1 AND t.relname = $2
ORDER BY i.relname`;

export const FOREIGN_KEYS_OUTGOING = `\
SELECT
  c.conname AS constraint_name,
  a.attname AS column_name,
  cn.nspname || '.' || cf.relname AS referenced_table,
  af.attname AS referenced_column,
  CASE c.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_update,
  CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class cf ON cf.oid = c.confrelid
JOIN pg_namespace cn ON cn.oid = cf.relnamespace
CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS u(local_attnum, foreign_attnum, ord)
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.local_attnum
JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = u.foreign_attnum
WHERE n.nspname = $1 AND t.relname = $2
  AND c.contype = 'f'
ORDER BY c.conname, u.ord`;

export const FOREIGN_KEYS_INCOMING = `\
SELECT
  c.conname AS constraint_name,
  rn.nspname || '.' || rt.relname AS referencing_table,
  a.attname AS referencing_column,
  af.attname AS local_column
FROM pg_constraint c
JOIN pg_class rt ON rt.oid = c.conrelid
JOIN pg_namespace rn ON rn.oid = rt.relnamespace
JOIN pg_class t ON t.oid = c.confrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS u(local_attnum, foreign_attnum, ord)
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.local_attnum
JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = u.foreign_attnum
WHERE n.nspname = $1 AND t.relname = $2
  AND c.contype = 'f'
ORDER BY c.conname, u.ord`;

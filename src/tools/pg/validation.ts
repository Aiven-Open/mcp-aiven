import { loadModule, parseSync } from 'libpg-query';

interface PgAst {
  stmts: Array<{ stmt: Record<string, unknown> }>;
}

// WASM module must be loaded once before parseSync can be used
let moduleLoaded = false;
async function ensurePgQueryLoaded(): Promise<void> {
  if (!moduleLoaded) {
    await loadModule();
    moduleLoaded = true;
  }
}

// Read-only tool: only allow SELECT and EXPLAIN
const READONLY_ALLOWED = new Set(['SelectStmt', 'ExplainStmt']);

// Write tool: block dangerous DDL + SET/transaction injection
const WRITE_BLOCKED = new Set([
  'DropStmt',
  'DropRoleStmt',
  'DropdbStmt',
  'DropTableSpaceStmt',
  'DropSubscriptionStmt',
  'DropOwnedStmt',
  'TruncateStmt',
  'GrantStmt', // also covers REVOKE
  'ReassignOwnedStmt',
  'SecLabelStmt',
  'DoStmt',
  'CreateFunctionStmt',
  'VariableSetStmt',
  'TransactionStmt',
]);

// Read-only tool: node types that modify data, wherever they appear in the tree
// (e.g. `EXPLAIN ANALYZE DELETE …` or `WITH d AS (DELETE … RETURNING *) SELECT …`)
const READONLY_NESTED_BLOCKED = new Set(['InsertStmt', 'UpdateStmt', 'DeleteStmt', 'MergeStmt']);

export type SqlValidationResult =
  | { valid: true; stmtType: string }
  | { valid: false; error: string };

// Returns an error message for the first write found anywhere in the statement, or undefined.
function findNestedWrite(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findNestedWrite(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (READONLY_NESTED_BLOCKED.has(key)) {
      return `${key} is not allowed in read-only mode, including inside EXPLAIN or WITH.`;
    }
    // Checked as bare keys: set-operation branches (UNION larg/rarg) are unwrapped select bodies
    if (key === 'intoClause' && value) {
      return 'SELECT INTO creates a table and is not allowed in read-only mode.';
    }
    if (key === 'lockingClause' && value) {
      return 'SELECT … FOR UPDATE/SHARE takes row locks and is not allowed in read-only mode.';
    }
    const found = findNestedWrite(value);
    if (found) return found;
  }
  return undefined;
}

function extractStmt(query: string): { stmtType: string; stmt: Record<string, unknown> } {
  let ast: PgAst;
  try {
    ast = parseSync(query) as PgAst;
  } catch {
    throw new Error('SQL parse error: the query could not be parsed as valid PostgreSQL.');
  }

  if (ast.stmts.length !== 1) {
    throw new Error('Multiple SQL statements are not allowed. Please send one query at a time.');
  }

  const stmt = ast.stmts[0]?.stmt ?? {};
  const stmtType = Object.keys(stmt)[0];
  if (!stmtType) {
    throw new Error('Empty statement.');
  }

  return { stmtType, stmt };
}

export async function validateReadQuery(query: string): Promise<SqlValidationResult> {
  await ensurePgQueryLoaded();
  let parsed: { stmtType: string; stmt: Record<string, unknown> };
  try {
    parsed = extractStmt(query);
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
  const { stmtType, stmt } = parsed;
  if (!READONLY_ALLOWED.has(stmtType)) {
    return {
      valid: false,
      error: `Only SELECT and EXPLAIN statements are allowed in read-only mode.`,
    };
  }
  const nestedWrite = findNestedWrite(stmt);
  if (nestedWrite) {
    return { valid: false, error: nestedWrite };
  }
  return { valid: true, stmtType };
}

export async function validateWriteQuery(query: string): Promise<SqlValidationResult> {
  await ensurePgQueryLoaded();
  let stmtType: string;
  try {
    stmtType = extractStmt(query).stmtType;
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
  if (WRITE_BLOCKED.has(stmtType)) {
    return {
      valid: false,
      error: `Blocked statement type: ${stmtType}. DROP, TRUNCATE, GRANT, REVOKE, DO, CREATE FUNCTION, SET, and transaction control statements are not allowed through this tool.`,
    };
  }
  return { valid: true, stmtType };
}

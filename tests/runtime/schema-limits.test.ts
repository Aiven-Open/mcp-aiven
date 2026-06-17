import { describe, it, expect } from 'vitest';
import {
  REASONING_MAX_LENGTH,
  SQL_QUERY_MAX_LENGTH,
  reasoningField,
} from '../../src/tools/shared-schemas.js';
import {
  optimizeQueryInput,
  pgQueryInput,
  pgExecuteQueryInput,
} from '../../src/tools/pg/schemas.js';
import {
  createConnectorInput,
  editConnectorInput,
} from '../../src/tools/kafka/schemas.js';
import {
  redeployApplicationInput,
  vcsIntegrationListInput,
  vcsIntegrationRepositoryListInput,
  applicationBuildLogsGetInput,
} from '../../src/tools/applications/schemas.js';

const validReasoning = 'because tests';

const baseConnector = {
  project: 'p',
  service_name: 's',
  connector_class: 'io.example.Connector',
  name: 'c',
};

const basePgQuery = {
  project: 'p',
  service_name: 's',
  query: 'SELECT 1',
  reasoning: validReasoning,
};

describe('reasoningField', () => {
  it('rejects empty strings', () => {
    expect(reasoningField.safeParse('').success).toBe(false);
  });

  it('accepts strings up to REASONING_MAX_LENGTH', () => {
    const atLimit = 'a'.repeat(REASONING_MAX_LENGTH);
    expect(reasoningField.safeParse(atLimit).success).toBe(true);
  });

  it('rejects strings over REASONING_MAX_LENGTH', () => {
    const overLimit = 'a'.repeat(REASONING_MAX_LENGTH + 1);
    const result = reasoningField.safeParse(overLimit);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe('too_big');
    }
  });
});

describe('reasoning enforcement across schemas', () => {
  const overLimitReasoning = 'a'.repeat(REASONING_MAX_LENGTH + 1);

  it('pgQueryInput rejects over-limit reasoning', () => {
    const result = pgQueryInput.safeParse({
      ...basePgQuery,
      reasoning: overLimitReasoning,
    });
    expect(result.success).toBe(false);
  });

  it('pgExecuteQueryInput rejects over-limit reasoning', () => {
    const result = pgExecuteQueryInput.safeParse({
      ...basePgQuery,
      reasoning: overLimitReasoning,
    });
    expect(result.success).toBe(false);
  });

  it('optimizeQueryInput rejects over-limit reasoning', () => {
    const result = optimizeQueryInput.safeParse({
      account_id: 'acc-1',
      query: 'SELECT 1',
      reasoning: overLimitReasoning,
    });
    expect(result.success).toBe(false);
  });

  it('createConnectorInput rejects over-limit reasoning', () => {
    const result = createConnectorInput.safeParse({
      ...baseConnector,
      reasoning: overLimitReasoning,
    });
    expect(result.success).toBe(false);
  });

  it('editConnectorInput rejects over-limit reasoning', () => {
    const result = editConnectorInput.safeParse({
      ...baseConnector,
      connector_name: 'c',
      reasoning: overLimitReasoning,
    });
    expect(result.success).toBe(false);
  });

  it('redeployApplicationInput rejects over-limit reasoning', () => {
    const result = redeployApplicationInput.safeParse({
      project: 'p',
      service_name: 's',
      reasoning: overLimitReasoning,
    });
    expect(result.success).toBe(false);
  });

  it('vcsIntegrationListInput rejects over-limit reasoning', () => {
    const result = vcsIntegrationListInput.safeParse({
      project: 'p',
      reasoning: overLimitReasoning,
    });
    expect(result.success).toBe(false);
  });

  it('vcsIntegrationRepositoryListInput rejects over-limit reasoning', () => {
    const result = vcsIntegrationRepositoryListInput.safeParse({
      organization_id: 'org-1',
      vcs_integration_id: 'vcs-1',
      reasoning: overLimitReasoning,
    });
    expect(result.success).toBe(false);
  });

  it('applicationBuildLogsGetInput rejects over-limit reasoning', () => {
    const result = applicationBuildLogsGetInput.safeParse({
      project: 'p',
      service_name: 's',
      reasoning: overLimitReasoning,
    });
    expect(result.success).toBe(false);
  });
});

describe('applicationBuildLogsGetInput', () => {
  const base = { project: 'p', service_name: 's', reasoning: validReasoning };

  it('accepts valid input with no optional fields', () => {
    expect(applicationBuildLogsGetInput.safeParse(base).success).toBe(true);
  });

  it('accepts limit within bounds', () => {
    expect(applicationBuildLogsGetInput.safeParse({ ...base, limit: 1 }).success).toBe(true);
    expect(applicationBuildLogsGetInput.safeParse({ ...base, limit: 500 }).success).toBe(true);
  });

  it('rejects limit below 1', () => {
    expect(applicationBuildLogsGetInput.safeParse({ ...base, limit: 0 }).success).toBe(false);
  });

  it('rejects limit above 500', () => {
    expect(applicationBuildLogsGetInput.safeParse({ ...base, limit: 501 }).success).toBe(false);
  });

  it('accepts valid sort_order values', () => {
    expect(applicationBuildLogsGetInput.safeParse({ ...base, sort_order: 'asc' }).success).toBe(true);
    expect(applicationBuildLogsGetInput.safeParse({ ...base, sort_order: 'desc' }).success).toBe(true);
  });

  it('rejects invalid sort_order', () => {
    expect(applicationBuildLogsGetInput.safeParse({ ...base, sort_order: 'newest' }).success).toBe(false);
  });

  it('accepts an offset cursor string', () => {
    expect(applicationBuildLogsGetInput.safeParse({ ...base, offset: '2026-06-17T10:26:56.554647+00:00' }).success).toBe(true);
  });

  it('rejects unknown keys (strict mode)', () => {
    expect(applicationBuildLogsGetInput.safeParse({ ...base, unknown_field: 'x' }).success).toBe(false);
  });
});

describe('SQL query length enforcement', () => {
  const atLimitQuery = 'a'.repeat(SQL_QUERY_MAX_LENGTH);
  const overLimitQuery = 'a'.repeat(SQL_QUERY_MAX_LENGTH + 1);

  it('pgQueryInput accepts a query at SQL_QUERY_MAX_LENGTH', () => {
    const result = pgQueryInput.safeParse({
      ...basePgQuery,
      query: atLimitQuery,
    });
    expect(result.success).toBe(true);
  });

  it('pgQueryInput rejects a query over SQL_QUERY_MAX_LENGTH', () => {
    const result = pgQueryInput.safeParse({
      ...basePgQuery,
      query: overLimitQuery,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const queryIssue = result.error.issues.find((i) => i.path[0] === 'query');
      expect(queryIssue?.code).toBe('too_big');
    }
  });

  it('pgExecuteQueryInput rejects a query over SQL_QUERY_MAX_LENGTH', () => {
    const result = pgExecuteQueryInput.safeParse({
      ...basePgQuery,
      query: overLimitQuery,
    });
    expect(result.success).toBe(false);
  });

  it('optimizeQueryInput rejects a query over SQL_QUERY_MAX_LENGTH', () => {
    const result = optimizeQueryInput.safeParse({
      account_id: 'acc-1',
      query: overLimitQuery,
      reasoning: validReasoning,
    });
    expect(result.success).toBe(false);
  });
});

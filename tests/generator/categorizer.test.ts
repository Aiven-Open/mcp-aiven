import { describe, it, expect } from 'vitest';
import { categorizeOperations } from '../../generator/src/categorizer.js';
import type { ParsedOperation } from '../../generator/src/parser.js';

function createOperation(overrides: Partial<ParsedOperation>): ParsedOperation {
  return {
    operationId: 'test_operation',
    path: '/v1/test',
    method: 'GET',
    tags: [],
    parameters: [],
    ...overrides,
  };
}

describe('categorizeOperations', () => {
  it('should categorize PostgreSQL operations by tag', () => {
    const operations: ParsedOperation[] = [
      createOperation({
        operationId: 'list_pg_databases',
        path: '/v1/project/{project}/service/{service}/pg/db',
        tags: ['Service: PostgreSQL'],
      }),
    ];

    const result = categorizeOperations(operations);

    expect(result['pg']).toHaveLength(1);
  });

  it('should categorize Kafka operations by tag', () => {
    const operations: ParsedOperation[] = [
      createOperation({
        operationId: 'list_topics',
        path: '/v1/project/{project}/service/{service}/topic',
        tags: ['Service: Kafka'],
      }),
    ];

    const result = categorizeOperations(operations);

    expect(result['kafka']).toHaveLength(1);
  });

  it('should categorize Project operations as core', () => {
    const operations: ParsedOperation[] = [
      createOperation({
        operationId: 'list_projects',
        path: '/v1/project',
        tags: ['Project'],
      }),
    ];

    const result = categorizeOperations(operations);

    expect(result['core']).toHaveLength(1);
  });

  it('should categorize Service operations as core', () => {
    const operations: ParsedOperation[] = [
      createOperation({
        operationId: 'list_services',
        path: '/v1/project/{project}/service',
        tags: ['Service'],
      }),
    ];

    const result = categorizeOperations(operations);

    expect(result['core']).toHaveLength(1);
  });

  it('should exclude operations with no matching tag', () => {
    const operations: ParsedOperation[] = [
      createOperation({
        operationId: 'admin_operation',
        path: '/v1/admin/something',
        tags: ['Admin'],
      }),
    ];

    const result = categorizeOperations(operations);

    expect(Object.values(result).flat()).toHaveLength(0);
  });

  it('should exclude operations marked as excluded', () => {
    const operations: ParsedOperation[] = [
      createOperation({
        operationId: 'excluded_op',
        path: '/v1/test',
        tags: ['Project'],
        excluded: true,
      }),
    ];

    const result = categorizeOperations(operations);

    expect(Object.values(result).flat()).toHaveLength(0);
  });

  it('should respect explicit category from overlay', () => {
    const operations: ParsedOperation[] = [
      createOperation({
        operationId: 'custom_operation',
        path: '/v1/custom',
        category: 'kafka',
      }),
    ];

    const result = categorizeOperations(operations);

    expect(result['kafka']).toHaveLength(1);
  });

  it('should categorize Cloud_platforms as core', () => {
    const operations: ParsedOperation[] = [
      createOperation({
        operationId: 'list_clouds',
        path: '/clouds',
        tags: ['Cloud platforms'],
      }),
    ];

    const result = categorizeOperations(operations);

    expect(result['core']).toHaveLength(1);
  });

  it('should handle multiple operations in different categories', () => {
    const operations: ParsedOperation[] = [
      createOperation({
        operationId: 'list_projects',
        path: '/v1/project',
        tags: ['Project'],
      }),
      createOperation({
        operationId: 'list_pg_databases',
        path: '/v1/project/{project}/service/{service}/pg/db',
        tags: ['Service: PostgreSQL'],
      }),
      createOperation({
        operationId: 'list_topics',
        path: '/v1/project/{project}/service/{service}/topic',
        tags: ['Service: Kafka'],
      }),
    ];

    const result = categorizeOperations(operations);

    expect(result['core']).toHaveLength(1);
    expect(result['pg']).toHaveLength(1);
    expect(result['kafka']).toHaveLength(1);
  });
});

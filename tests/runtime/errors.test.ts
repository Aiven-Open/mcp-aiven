import { describe, it, expect } from 'vitest';
import { formatError, createErrorFromException } from '../../src/errors.js';
import type { AivenError } from '../../src/types.js';

describe('formatError', () => {
  it('should format basic error message', () => {
    const error: AivenError = {
      message: 'Something went wrong',
      status: 500,
    };

    const result = formatError(error);

    expect(result).toContain('Aiven API Error (500)');
    expect(result).toContain('Something went wrong');
  });

  it('should include hint for 401 errors', () => {
    const error: AivenError = {
      message: 'Unauthorized',
      status: 401,
    };

    const result = formatError(error);

    expect(result).toContain('AIVEN_TOKEN');
    expect(result).toContain('console.aiven.io');
  });

  it('should include hint for 403 errors', () => {
    const error: AivenError = {
      message: 'Forbidden',
      status: 403,
    };

    const result = formatError(error);

    expect(result).toContain('permission');
  });

  it('should include hint for 404 errors', () => {
    const error: AivenError = {
      message: 'Not found',
      status: 404,
    };

    const result = formatError(error);

    expect(result).toContain('Verify');
    expect(result).toContain('exists');
  });

  it('should include hint for 409 errors', () => {
    const error: AivenError = {
      message: 'Conflict',
      status: 409,
    };

    const result = formatError(error);

    expect(result).toContain('already exist');
  });

  it('should include error code when present', () => {
    const error: AivenError = {
      message: 'Error',
      status: 400,
      errorCode: 'INVALID_REQUEST',
    };

    const result = formatError(error);

    expect(result).toContain('INVALID_REQUEST');
  });

  it('should include more info link when present', () => {
    const error: AivenError = {
      message: 'Error',
      status: 400,
      moreInfo: 'https://docs.aiven.io/errors/123',
    };

    const result = formatError(error);

    expect(result).toContain('https://docs.aiven.io/errors/123');
  });
});

describe('createErrorFromException', () => {
  it('should handle Error instances', () => {
    const error = new Error('Test error message');

    const result = createErrorFromException(error);

    expect(result.message).toBe('Test error message');
    expect(result.status).toBe(0);
  });

  it('should handle non-Error values', () => {
    const result = createErrorFromException('string error');

    expect(result.message).toBe('Unknown error occurred');
    expect(result.status).toBe(0);
  });

  it('should handle null', () => {
    const result = createErrorFromException(null);

    expect(result.message).toBe('Unknown error occurred');
  });
});

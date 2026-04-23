import { describe, it, expect } from 'vitest';
import { AivenError } from '../../src/errors.js';

describe('AivenError', () => {
  it('should format basic error message', () => {
    const error = new AivenError(500, 'Something went wrong');

    expect(error.message).toContain('Aiven API Error (500)');
    expect(error.message).toContain('Something went wrong');
  });

  it('should include hint for 401 errors', () => {
    const error = new AivenError(401, 'Unauthorized');

    expect(error.message).toContain('Reauthenticate via /mcp');
  });

  it('should include hint for 403 errors', () => {
    const error = new AivenError(403, 'Forbidden');

    expect(error.message).toContain('permission');
  });

  it('should include hint for 404 errors', () => {
    const error = new AivenError(404, 'Not found');

    expect(error.message).toContain('Verify');
    expect(error.message).toContain('exists');
  });

  it('should include hint for 409 errors', () => {
    const error = new AivenError(409, 'Conflict');

    expect(error.message).toContain('already exist');
  });

  it('should include error code when present', () => {
    const error = new AivenError(400, 'Error', 'INVALID_REQUEST');

    expect(error.message).toContain('INVALID_REQUEST');
    expect(error.errorCode).toBe('INVALID_REQUEST');
  });

  it('should include more info link when present', () => {
    const error = new AivenError(400, 'Error', undefined, 'https://docs.aiven.io/errors/123');

    expect(error.message).toContain('https://docs.aiven.io/errors/123');
    expect(error.moreInfo).toBe('https://docs.aiven.io/errors/123');
  });

  it('should be an instance of Error', () => {
    const error = new AivenError(500, 'test');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AivenError');
  });

  it('should store status', () => {
    const error = new AivenError(404, 'Not found');

    expect(error.status).toBe(404);
  });
});

import { describe, it, expect } from 'vitest';
import { sanitizeMcpClient } from '../../src/mcp-client-header.js';

describe('sanitizeMcpClient', () => {
  it('returns undefined for missing or blank input', () => {
    expect(sanitizeMcpClient(undefined)).toBeUndefined();
    expect(sanitizeMcpClient('')).toBeUndefined();
    expect(sanitizeMcpClient('   ')).toBeUndefined();
  });

  it('keeps a single name token', () => {
    expect(sanitizeMcpClient('cursor-vscode')).toBe('cursor-vscode');
    expect(sanitizeMcpClient('Claude_Desktop')).toBe('Claude_Desktop');
  });

  it('keeps a single name/version token', () => {
    expect(sanitizeMcpClient('mcp-aiven/1.15.0')).toBe('mcp-aiven/1.15.0');
    expect(sanitizeMcpClient('client/2.0.0-rc1')).toBe('client/2.0.0-rc1');
    expect(sanitizeMcpClient('client/1.0.0-beta.1+build.1')).toBe('client/1.0.0-beta.1+build.1');
  });

  it('takes only the first token of a multi-token User-Agent', () => {
    expect(sanitizeMcpClient('lovable/1.0.0 Lovable MCP Client/1.0.0')).toBe('lovable/1.0.0');
    expect(sanitizeMcpClient('node/22.1.0 (darwin; arm64)')).toBe('node/22.1.0');
    expect(sanitizeMcpClient('foo/1.0 bar/2.0 baz/3.0')).toBe('foo/1.0');
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(sanitizeMcpClient('  foo/1.0  ')).toBe('foo/1.0');
  });

  it('drops an invalid version but keeps the name', () => {
    expect(sanitizeMcpClient('foo/01.2 extra')).toBe('foo');
    expect(sanitizeMcpClient('foo/1.2.3.4.5.6.7.8.9')).toBe('foo');
  });

  it('falls back to the original value when no token can be extracted', () => {
    expect(sanitizeMcpClient('@#$%')).toBe('@#$%');
    expect(sanitizeMcpClient('(comment only)')).toBe('(comment only)');
  });
});

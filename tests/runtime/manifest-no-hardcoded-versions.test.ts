import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A hardcoded engine version in a tool description rots silently: nothing fails when Aiven's
 * default moves on, but every service created through the MCP is pinned to a stale major.
 * That shipped once — `aiven_service_create` recommended `pg_version: "17"` well after the
 * platform default became 18.
 *
 * Tool descriptions must therefore name no concrete engine version. The version comes from
 * `aiven_service_type_get` (`default_version` / `available_versions`) at call time instead.
 */

const MANIFEST_DIR = join(process.cwd(), 'src', 'manifests');

/** `pg_version: "17"`, `kafka_version: '3.9'`, `opensearch_version: "2.19"`, ... */
const HARDCODED_VERSION = /(\w+_version)"?'?\s*:\s*"?'?(\d[\d.]*)/g;

function manifestFiles(): string[] {
  return readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.yaml'));
}

describe('tool manifests', () => {
  it('has manifests to check', () => {
    expect(manifestFiles().length).toBeGreaterThan(0);
  });

  it.each(manifestFiles())('%s names no concrete engine version', (file) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted internal path
    const content = readFileSync(join(MANIFEST_DIR, file), 'utf-8');

    const found = [...content.matchAll(HARDCODED_VERSION)].map(
      ([, key, version]) => `${key}: ${version}`
    );

    expect(
      found,
      `${file} hardcodes an engine version. Descriptions must not name a version — ` +
        'the model should read `default_version` / `available_versions` from ' +
        '`aiven_service_type_get` instead. Use a placeholder such as "<major>" in examples.'
    ).toEqual([]);
  });

  it('detects a hardcoded version when one is introduced', () => {
    // Guards the regex itself: if this stops matching, the check above silently passes forever.
    const regression = 'For PostgreSQL, set `user_config: {"pg_version": "17"}`.';
    expect([...regression.matchAll(HARDCODED_VERSION)]).toHaveLength(1);

    const placeholder = 'set `user_config: {"pg_version": "<major>"}`';
    expect([...placeholder.matchAll(HARDCODED_VERSION)]).toHaveLength(0);
  });
});

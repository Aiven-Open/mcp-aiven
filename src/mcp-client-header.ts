/**
 * Sanitizes the value forwarded as `X-MCP-Client` to a single `Name` or
 * `Name/Version` product token. Inbound User-Agent strings routinely carry
 * several tokens and platform comments (e.g. `aiven/1.0.0 node/22 (darwin)`),
 * so only the first valid token is kept.
 */

const NAME_MAX = 48;
const VERSION_MAX = 64;
const VERSION_PARTS_MAX = 8;

// First product token at the start of the string: Name with optional /Version.
// Name: letter first, then letters/digits/._-
// Version: dotted numeric core with optional SemVer -pre/+build.
const FIRST_TOKEN_RE = new RegExp(
  '^([A-Za-z][A-Za-z0-9._-]{0,47})' +
    '(?:/(\\d+(?:\\.\\d+)*' +
    '(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?' +
    '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?))?' +
    '(?:\\s|$)'
);

/** Version must have a numeric dotted core, at most 8 parts, no leading zeros. */
function versionOk(version: string): boolean {
  if (version.length > VERSION_MAX || version.includes('..')) return false;
  const coreEnd = version.search(/[-+]/);
  const core = coreEnd === -1 ? version : version.slice(0, coreEnd);
  const parts = core.split('.');
  if (parts.length === 0 || parts.length > VERSION_PARTS_MAX) return false;
  return parts.every((p) => /^\d+$/.test(p) && (p.length === 1 || !p.startsWith('0')));
}

/**
 * Returns the first `Name` or `Name/Version` product token of `raw`.
 * Falls back to the original value when no valid token can be extracted.
 */
export function sanitizeMcpClient(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;

  const match = FIRST_TOKEN_RE.exec(value);
  if (!match) return value;

  const name = match[1];
  const version = match[2];
  if (!name || name.length > NAME_MAX || name.includes('..')) return value;
  if (version === undefined) return name;
  if (!versionOk(version)) return name;
  return `${name}/${version}`;
}

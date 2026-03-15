import { createRequire } from 'node:module';
import type { AivenConfig } from './types.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
export const VERSION = pkg.version;
//export const API_ORIGIN = process.env['AIVEN_API_ORIGIN'] ?? 'https://api.aiven.io';
export const API_ORIGIN = 'https://public-aiven-rest-aiven-public-roman-pozdnyak-test.a.avns.net';
export const API_BASE_URL = `${API_ORIGIN}/v1`;

export function loadConfig(transport: 'stdio' | 'http' = 'stdio'): AivenConfig {
  const token = process.env['AIVEN_TOKEN'];

  if (!token && transport !== 'http') {
    throw new Error(
      'AIVEN_TOKEN environment variable is required.\n' +
        'Get your token from: https://console.aiven.io/profile/auth'
    );
  }

  const readOnly = process.env['AIVEN_READ_ONLY'] === 'true';

  return { token, readOnly };
}

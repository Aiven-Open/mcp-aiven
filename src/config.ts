import { type AivenConfig, DEFAULT_CONFIG, parseServices } from './types.js';

/**
 * Load configuration from environment variables
 * @throws Error if required AIVEN_TOKEN is missing
 */
export function loadConfig(): AivenConfig {
  const token = process.env['AIVEN_TOKEN'];

  if (!token) {
    throw new Error(
      'AIVEN_TOKEN environment variable is required.\n' +
        'Get your token from: https://console.aiven.io/profile/auth'
    );
  }

  const baseUrl = process.env['AIVEN_BASE_URL'] ?? DEFAULT_CONFIG.baseUrl;
  const services = parseServices(process.env['AIVEN_SERVICES']);

  return {
    token,
    baseUrl,
    services,
  };
}

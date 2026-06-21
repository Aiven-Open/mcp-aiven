import { GoogleAuth, type AuthClient } from 'google-auth-library';

/**
 * Google Model Armor scanning for tool input/output. Fails closed.
 *
 * Env: MODEL_ARMOR_ENABLED ("true" to enable), MODEL_ARMOR_SA_JSON (service-account JSON),
 *      MODEL_ARMOR_LOCATION (default "eu"), MODEL_ARMOR_TEMPLATE (default "mcp-armor"),
 *      MODEL_ARMOR_DEBUG ("true" logs sent text + verdict).
 */

const MAX_BYTES = 4 * 1024 * 1024; // Model Armor's content cap; over this we can't scan

let auth: GoogleAuth | null = null;
let base = '';

function init(): GoogleAuth {
  if (auth) return auth;
  const sa = process.env['MODEL_ARMOR_SA_JSON'];
  if (!sa) throw new Error('MODEL_ARMOR_ENABLED is true but MODEL_ARMOR_SA_JSON is not set');
  let credentials: { project_id?: string };
  try {
    credentials = JSON.parse(sa) as { project_id?: string };
  } catch {
    throw new Error('MODEL_ARMOR_SA_JSON is not valid JSON');
  }
  const loc = process.env['MODEL_ARMOR_LOCATION'] ?? 'eu';
  const tmpl = process.env['MODEL_ARMOR_TEMPLATE'] ?? 'mcp-armor';
  base = `https://modelarmor.${loc}.rep.googleapis.com/v1/projects/${credentials.project_id}/locations/${loc}/templates/${tmpl}`;
  auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return auth;
}

/** Scan text. Returns a block reason if unsafe (fails closed), or null if safe/disabled. */
export async function scan(text: string, kind: 'input' | 'output' = 'input'): Promise<string | null> {
  if (process.env['MODEL_ARMOR_ENABLED'] !== 'true' || text.trim() === '') return null;

  const block = (reason: string): string => {
    console.error(`[Model Armor] ${kind} blocked: ${reason}`);
    return `Request blocked by security scan (${kind})`;
  };

  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return block('payload too large to scan (>4MB)');

  try {
    const client: AuthClient = await init().getClient();
    const method = kind === 'input' ? 'sanitizeUserPrompt' : 'sanitizeModelResponse';
    const field = kind === 'input' ? 'userPromptData' : 'modelResponseData';
    const res = await client.request<{ sanitizationResult: { filterMatchState: string } }>({
      url: `${base}:${method}`,
      method: 'POST',
      data: { [field]: { text } },
    });
    const state = res.data.sanitizationResult.filterMatchState;

    if (process.env['MODEL_ARMOR_DEBUG'] === 'true') {
      console.error(`[Model Armor] ${kind} (${text.length} chars) → ${state}\n${text.slice(0, 2000)}`);
    }

    if (state === 'MATCH_FOUND') return block('flagged as unsafe');
    if (state === 'NO_MATCH_FOUND' || state === 'FILTER_MATCH_STATE_UNSPECIFIED') return null;
    return block(`unexpected response (filterMatchState=${state})`);
  } catch (err) {
    return block(`scan failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

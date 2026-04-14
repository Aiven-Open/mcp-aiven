/**
 * Assemble a tool's JSON Schema input from its parameters and request body.
 */

import type { JsonSchema, ParsedParameter } from './parser.js';

/**
 * Build a JSON Schema for a tool's input from its parameters and request body.
 */
export function buildInputJsonSchema(
  parameters: ParsedParameter[],
  requestBody?: JsonSchema
): { schema: JsonSchema; strict: boolean } {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const seen = new Set<string>();

  // Path and query parameters
  for (const param of parameters) {
    if (seen.has(param.name)) continue;
    seen.add(param.name);
    properties[param.name] = param.schema;
    if (param.required) required.push(param.name);
  }

  // Request body properties
  if (requestBody?.type === 'object' && requestBody.properties) {
    const requiredSet = new Set(requestBody.required ?? []);
    for (const [name, prop] of Object.entries(requestBody.properties)) {
      if (seen.has(name)) continue;
      seen.add(name);
      properties[name] = prop;
      if (requiredSet.has(name)) required.push(name);
    }
  }

  const schema: JsonSchema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;

  // Strict mode: no extra fields allowed. Passthrough: allow extra fields.
  const allowExtra = requestBody?.type === 'object' && requestBody.additionalProperties !== false;
  const strict = !allowExtra;

  return { schema, strict };
}

/**
 * Parse OpenAPI spec — resolve $refs, extract parameters and request bodies,
 * and output JSON Schema objects ready for api-schemas.json.
 */

import type { OpenApiSpec, ParameterObject, SchemaObject } from './fetch.js';

export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
  nullable?: boolean;
  additionalProperties?: boolean;
  oneOf?: JsonSchema[];
  format?: string;
}

export interface ParsedParameter {
  name: string;
  required: boolean;
  schema: JsonSchema;
}

export interface ParsedOperation {
  path: string;
  method: string;
  summary?: string;
  description?: string;
  parameters: ParsedParameter[];
  requestBody?: JsonSchema;
}

// --- $ref resolution ---

function resolveRef(spec: OpenApiSpec, ref: string): unknown {
  const parts = ref.replace('#/', '').split('/');
  let current: unknown = spec;

  for (const part of parts) {
    if (typeof current === 'object' && current !== null && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

// --- Schema conversion (OpenAPI SchemaObject → JSON Schema) ---

export function toJsonSchema(spec: OpenApiSpec, schema: SchemaObject): JsonSchema {
  if (schema.$ref) {
    const resolved = resolveRef(spec, schema.$ref) as SchemaObject | undefined;
    if (resolved) return toJsonSchema(spec, resolved);
    return {};
  }

  if (schema.oneOf ?? schema.anyOf) {
    const variants = (schema.oneOf ?? schema.anyOf ?? []).map((s) => toJsonSchema(spec, s));
    if (variants.length === 1) {
      const first = variants[0];
      if (first !== undefined) return first;
    }
    const result: JsonSchema = { oneOf: variants };
    if (schema.description) result.description = schema.description;
    return result;
  }

  if (schema.allOf) {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const sub of schema.allOf) {
      const parsed = toJsonSchema(spec, sub);
      if (parsed.properties) Object.assign(properties, parsed.properties);
      if (parsed.required) required.push(...parsed.required);
    }
    const result: JsonSchema = { type: 'object', properties };
    if (required.length > 0) result.required = required;
    if (schema.description) result.description = schema.description;
    return result;
  }

  if (schema.enum) {
    const result: JsonSchema = { enum: schema.enum };
    if (schema.description) result.description = schema.description;
    return result;
  }

  switch (schema.type) {
    case 'string': {
      const result: JsonSchema = { type: 'string' };
      if (schema.description) result.description = schema.description;
      if (schema.format) result.format = schema.format;
      if (schema.minLength !== undefined) result.minLength = schema.minLength;
      if (schema.maxLength !== undefined) result.maxLength = schema.maxLength;
      if (schema.pattern) result.pattern = schema.pattern;
      if (schema.default !== undefined) result.default = schema.default;
      if (schema.nullable) result.nullable = true;
      return result;
    }

    case 'integer':
    case 'number': {
      const result: JsonSchema = { type: schema.type };
      if (schema.description) result.description = schema.description;
      if (schema.format) result.format = schema.format;
      if (schema.minimum !== undefined) result.minimum = schema.minimum;
      if (schema.maximum !== undefined) result.maximum = schema.maximum;
      if (schema.default !== undefined) result.default = schema.default;
      return result;
    }

    case 'boolean': {
      const result: JsonSchema = { type: 'boolean' };
      if (schema.description) result.description = schema.description;
      if (schema.default !== undefined) result.default = schema.default;
      return result;
    }

    case 'array': {
      const result: JsonSchema = { type: 'array' };
      if (schema.description) result.description = schema.description;
      if (schema.items) result.items = toJsonSchema(spec, schema.items);
      return result;
    }

    case 'object':
    default: {
      if (!schema.properties || Object.keys(schema.properties).length === 0) {
        return { type: 'object', additionalProperties: true };
      }
      const properties: Record<string, JsonSchema> = {};
      for (const [name, prop] of Object.entries(schema.properties)) {
        properties[name] = toJsonSchema(spec, prop);
      }
      const result: JsonSchema = { type: 'object', properties };
      if (schema.description) result.description = schema.description;
      if (schema.required) result.required = schema.required;
      if (schema.additionalProperties === false) result.additionalProperties = false;
      return result;
    }
  }
}

function parseParameter(spec: OpenApiSpec, param: ParameterObject): ParsedParameter | null {
  const resolved = param.$ref
    ? ((resolveRef(spec, param.$ref) as ParameterObject | undefined) ?? param)
    : param;

  if (!resolved.name || !resolved.in) return null;

  return {
    name: resolved.name,
    required: resolved.required ?? false,
    schema: resolved.schema ? toJsonSchema(spec, resolved.schema) : { type: 'string' },
  };
}

export function parseOpenApiSpec(spec: OpenApiSpec): ParsedOperation[] {
  const operations: ParsedOperation[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const pathParams = pathItem.parameters ?? [];

    for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;

      const parameters: ParsedParameter[] = [];
      for (const param of [...pathParams, ...(operation.parameters ?? [])]) {
        const parsed = parseParameter(spec, param);
        if (parsed) parameters.push(parsed);
      }

      let requestBody: JsonSchema | undefined;
      if (operation.requestBody?.content?.['application/json']?.schema) {
        requestBody = toJsonSchema(spec, operation.requestBody.content['application/json'].schema);
      }

      const result: ParsedOperation = { path, method: method.toUpperCase(), parameters };
      if (operation.summary !== undefined) result.summary = operation.summary;
      if (operation.description !== undefined) result.description = operation.description;
      if (requestBody !== undefined) result.requestBody = requestBody;

      operations.push(result);
    }
  }

  console.log(`Parsed ${operations.length} operations from OpenAPI spec`);
  return operations;
}

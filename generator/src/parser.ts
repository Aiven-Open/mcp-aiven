/**
 * Parse OpenAPI spec into internal representation
 */

import type { HttpMethod } from '../../src/types.js';
import type { OpenApiSpec, Operation, ParameterObject, SchemaObject } from './fetch.js';

export interface ParsedOperation {
  operationId: string;
  path: string;
  method: HttpMethod;
  summary?: string;
  description?: string;
  tags: string[];
  parameters: ParsedParameter[];
  requestBody?: ParsedSchema;
  responseSchema?: ParsedSchema;
  // MCP overlay fields
  category?: string;
  toolName?: string;
  mcpDescription?: string;
  formatter?: string;
  formatterField?: string;
  formatterNeedsInput?: string;
  excluded?: boolean;
}

export interface ParsedParameter {
  name: string;
  location: 'path' | 'query' | 'header';
  description?: string;
  required: boolean;
  schema: ParsedSchema;
}

export interface ParsedSchema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'enum' | 'ref' | 'union';
  description?: string;
  format?: string;
  enumValues?: string[];
  items?: ParsedSchema;
  properties?: Record<string, ParsedSchema>;
  required?: string[];
  nullable?: boolean;
  additionalProperties?: boolean;
  ref?: string;
  union?: ParsedSchema[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  default?: unknown;
}

/**
 * Resolve a $ref to the actual object
 */
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

/**
 * Resolve parameter, handling $ref
 */
function resolveParameter(spec: OpenApiSpec, param: ParameterObject): ParameterObject {
  if (param.$ref) {
    const resolved = resolveRef(spec, param.$ref) as ParameterObject | undefined;
    if (resolved) {
      return resolved;
    }
  }
  return param;
}

/**
 * Helper to create a schema object with optional description
 */
function withDescription<T extends object>(obj: T, description: string | undefined): T {
  if (description !== undefined) {
    return { ...obj, description };
  }
  return obj;
}

/**
 * Parse an OpenAPI schema into internal representation
 */
export function parseSchema(spec: OpenApiSpec, schema: SchemaObject): ParsedSchema {
  // Handle $ref
  if (schema.$ref) {
    const resolved = resolveRef(spec, schema.$ref) as SchemaObject | undefined;
    if (resolved) {
      return parseSchema(spec, resolved);
    }
    return withDescription({ type: 'ref' as const, ref: schema.$ref }, schema.description);
  }

  // Handle oneOf/anyOf
  if (schema.oneOf ?? schema.anyOf) {
    const schemas = schema.oneOf ?? schema.anyOf ?? [];
    return withDescription(
      { type: 'union' as const, union: schemas.map((s) => parseSchema(spec, s)) },
      schema.description
    );
  }

  // Handle allOf (merge schemas)
  if (schema.allOf) {
    const merged: ParsedSchema = withDescription(
      { type: 'object' as const, properties: {}, required: [] as string[] },
      schema.description
    );

    for (const sub of schema.allOf) {
      const parsed = parseSchema(spec, sub);
      if (parsed.properties) {
        merged.properties = { ...merged.properties, ...parsed.properties };
      }
      if (parsed.required) {
        merged.required = [...(merged.required ?? []), ...parsed.required];
      }
    }

    return merged;
  }

  // Handle enum
  if (schema.enum) {
    return withDescription({ type: 'enum' as const, enumValues: schema.enum }, schema.description);
  }

  // Handle by type
  switch (schema.type) {
    case 'string': {
      const result: ParsedSchema = { type: 'string' };
      if (schema.description !== undefined) result.description = schema.description;
      if (schema.format !== undefined) result.format = schema.format;
      if (schema.minLength !== undefined) result.minLength = schema.minLength;
      if (schema.maxLength !== undefined) result.maxLength = schema.maxLength;
      if (schema.pattern !== undefined) result.pattern = schema.pattern;
      if (schema.default !== undefined) result.default = schema.default;
      if (schema.nullable === true) result.nullable = true;
      return result;
    }

    case 'integer':
    case 'number': {
      const result: ParsedSchema = { type: schema.type === 'integer' ? 'integer' : 'number' };
      if (schema.description !== undefined) result.description = schema.description;
      if (schema.format !== undefined) result.format = schema.format;
      if (schema.minimum !== undefined) result.minimum = schema.minimum;
      if (schema.maximum !== undefined) result.maximum = schema.maximum;
      if (schema.default !== undefined) result.default = schema.default;
      return result;
    }

    case 'boolean': {
      const result: ParsedSchema = { type: 'boolean' };
      if (schema.description !== undefined) result.description = schema.description;
      if (schema.default !== undefined) result.default = schema.default;
      return result;
    }

    case 'array': {
      const result: ParsedSchema = { type: 'array' };
      if (schema.description !== undefined) result.description = schema.description;
      if (schema.items) result.items = parseSchema(spec, schema.items);
      return result;
    }

    case 'object':
    default: {
      const properties: Record<string, ParsedSchema> = {};
      if (schema.properties) {
        for (const [name, prop] of Object.entries(schema.properties)) {
          properties[name] = parseSchema(spec, prop);
        }
      }
      const result: ParsedSchema = { type: 'object', properties };
      if (schema.description !== undefined) result.description = schema.description;
      if (schema.required !== undefined) result.required = schema.required;
      if (schema.additionalProperties === false) result.additionalProperties = false;
      return result;
    }
  }
}

/**
 * Parse a parameter into internal representation
 */
function parseParameter(spec: OpenApiSpec, param: ParameterObject): ParsedParameter | null {
  // Resolve $ref if present
  const resolved = resolveParameter(spec, param);

  // Skip if we couldn't resolve or missing required fields
  if (!resolved.name || !resolved.in) {
    return null;
  }

  const result: ParsedParameter = {
    name: resolved.name,
    location: resolved.in === 'cookie' ? 'header' : resolved.in,
    required: resolved.required ?? false,
    schema: resolved.schema ? parseSchema(spec, resolved.schema) : { type: 'string' },
  };
  if (resolved.description !== undefined) {
    result.description = resolved.description;
  }
  return result;
}

/**
 * Parse an operation into internal representation
 */
function parseOperation(
  spec: OpenApiSpec,
  path: string,
  method: string,
  operation: Operation,
  pathParams: ParameterObject[]
): ParsedOperation | null {
  // Skip excluded operations
  if (operation['x-mcp-exclude']) {
    return null;
  }

  // Generate operationId if not present
  const operationId =
    operation.operationId ?? `${method.toLowerCase()}_${path.replace(/[{}/]/g, '_')}`;

  // Collect parameters
  const parameters: ParsedParameter[] = [];
  for (const param of [...pathParams, ...(operation.parameters ?? [])]) {
    const parsed = parseParameter(spec, param);
    if (parsed) {
      parameters.push(parsed);
    }
  }

  // Parse request body
  let requestBody: ParsedSchema | undefined;
  if (operation.requestBody?.content?.['application/json']?.schema) {
    requestBody = parseSchema(spec, operation.requestBody.content['application/json'].schema);
  }

  // Parse success response schema
  let responseSchema: ParsedSchema | undefined;
  const successResponse =
    operation.responses['200'] ?? operation.responses['201'] ?? operation.responses['204'];
  if (successResponse?.content?.['application/json']?.schema) {
    responseSchema = parseSchema(spec, successResponse.content['application/json'].schema);
  }

  const result: ParsedOperation = {
    operationId,
    path,
    method: method.toUpperCase() as ParsedOperation['method'],
    tags: operation.tags ?? [],
    parameters,
  };

  // Standard OpenAPI fields
  if (operation.summary !== undefined) result.summary = operation.summary;
  if (operation.description !== undefined) result.description = operation.description;
  if (requestBody !== undefined) result.requestBody = requestBody;
  if (responseSchema !== undefined) result.responseSchema = responseSchema;

  // MCP overlay fields
  if (operation['x-aiven-service'] !== undefined) {
    result.category = operation['x-aiven-service'];
  }
  if (operation['x-mcp-tool-name'] !== undefined) {
    result.toolName = operation['x-mcp-tool-name'];
  }
  if (operation['x-mcp-description'] !== undefined) {
    result.mcpDescription = operation['x-mcp-description'];
  }
  if (operation['x-mcp-formatter'] !== undefined) {
    result.formatter = operation['x-mcp-formatter'];
  }
  if (operation['x-mcp-formatter-field'] !== undefined) {
    result.formatterField = operation['x-mcp-formatter-field'];
  }
  if (operation['x-mcp-formatter-needs-input'] !== undefined) {
    result.formatterNeedsInput = operation['x-mcp-formatter-needs-input'];
  }
  if (operation['x-mcp-exclude'] !== undefined) {
    result.excluded = operation['x-mcp-exclude'];
  }

  return result;
}

/**
 * Parse all operations from an OpenAPI spec
 */
export function parseOpenApiSpec(spec: OpenApiSpec): ParsedOperation[] {
  const operations: ParsedOperation[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const pathParams = pathItem.parameters ?? [];

    for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;

      const parsed = parseOperation(spec, path, method, operation, pathParams);
      if (parsed) {
        operations.push(parsed);
      }
    }
  }

  console.log(`Parsed ${operations.length} operations from OpenAPI spec`);
  return operations;
}

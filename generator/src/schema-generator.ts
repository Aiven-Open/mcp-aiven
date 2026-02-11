/**
 * Generate Zod schema code from parsed schemas
 */

import type { ParsedSchema } from './parser.js';

interface ParameterInfo {
  name: string;
  required: boolean;
  schema: ParsedSchema;
}

/**
 * Check if a property name needs to be quoted
 */
function needsQuotes(name: string): boolean {
  // Valid JS identifier: starts with letter/underscore/$, contains only alphanumeric/_/$
  return !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

/**
 * Format property name, quoting if necessary
 */
function formatPropName(name: string): string {
  return needsQuotes(name) ? JSON.stringify(name) : name;
}

/**
 * Generate Zod schema code for a parsed schema
 */
export function generateZodSchema(schema: ParsedSchema): string {
  return schemaToZod(schema);
}

function schemaToZod(schema: ParsedSchema): string {
  switch (schema.type) {
    case 'string': {
      let code = 'z.string()';
      if (schema.minLength !== undefined) code += `.min(${schema.minLength})`;
      if (schema.maxLength !== undefined) code += `.max(${schema.maxLength})`;
      if (schema.pattern !== undefined) code += `.regex(/${schema.pattern}/)`;
      if (schema.description !== undefined)
        code += `.describe(${JSON.stringify(schema.description)})`;
      if (schema.default !== undefined) code += `.default(${JSON.stringify(schema.default)})`;
      if (schema.nullable) code += '.nullable()';
      return code;
    }

    case 'integer': {
      let code = 'z.number().int()';
      if (schema.minimum !== undefined) code += `.min(${schema.minimum})`;
      if (schema.maximum !== undefined) code += `.max(${schema.maximum})`;
      if (schema.description !== undefined)
        code += `.describe(${JSON.stringify(schema.description)})`;
      if (schema.default !== undefined) code += `.default(${JSON.stringify(schema.default)})`;
      return code;
    }

    case 'number': {
      let code = 'z.number()';
      if (schema.minimum !== undefined) code += `.min(${schema.minimum})`;
      if (schema.maximum !== undefined) code += `.max(${schema.maximum})`;
      if (schema.description !== undefined)
        code += `.describe(${JSON.stringify(schema.description)})`;
      if (schema.default !== undefined) code += `.default(${JSON.stringify(schema.default)})`;
      return code;
    }

    case 'boolean': {
      let code = 'z.boolean()';
      if (schema.description !== undefined)
        code += `.describe(${JSON.stringify(schema.description)})`;
      if (schema.default !== undefined) code += `.default(${JSON.stringify(schema.default)})`;
      return code;
    }

    case 'array': {
      const itemsCode = schema.items ? schemaToZod(schema.items) : 'z.unknown()';
      let code = `z.array(${itemsCode})`;
      if (schema.description !== undefined)
        code += `.describe(${JSON.stringify(schema.description)})`;
      return code;
    }

    case 'enum': {
      if (schema.enumValues && schema.enumValues.length > 0) {
        const values = schema.enumValues.map((v) => JSON.stringify(v)).join(', ');
        let code = `z.enum([${values}])`;
        if (schema.description !== undefined)
          code += `.describe(${JSON.stringify(schema.description)})`;
        return code;
      }
      return 'z.string()';
    }

    case 'union': {
      if (schema.union && schema.union.length > 0) {
        const unionTypes = schema.union.map(schemaToZod).join(', ');
        return `z.union([${unionTypes}])`;
      }
      return 'z.unknown()';
    }

    case 'object':
    default: {
      if (!schema.properties || Object.keys(schema.properties).length === 0) {
        return 'z.record(z.unknown())';
      }

      const requiredSet = new Set(schema.required ?? []);
      const props: string[] = [];

      for (const [name, prop] of Object.entries(schema.properties)) {
        let propCode = schemaToZod(prop);
        if (!requiredSet.has(name)) {
          propCode += '.optional()';
        }
        props.push(`    ${formatPropName(name)}: ${propCode}`);
      }

      return `z.object({\n${props.join(',\n')}\n  })`;
    }
  }
}

/**
 * Generate input schema code for tool parameters and request body
 */
export function generateInputSchema(
  parameters: ParameterInfo[],
  requestBody?: ParsedSchema
): string {
  const props: string[] = [];
  const seen = new Set<string>();

  // Add path and query parameters
  for (const param of parameters) {
    if (seen.has(param.name)) continue;
    seen.add(param.name);

    let propCode = schemaToZod(param.schema);
    if (!param.required) {
      propCode += '.optional()';
    }
    props.push(`  ${formatPropName(param.name)}: ${propCode}`);
  }

  // Add request body properties
  if (requestBody?.type === 'object' && requestBody.properties) {
    const requiredSet = new Set(requestBody.required ?? []);

    for (const [name, prop] of Object.entries(requestBody.properties)) {
      if (seen.has(name)) continue;
      seen.add(name);

      let propCode = schemaToZod(prop);
      if (!requiredSet.has(name)) {
        propCode += '.optional()';
      }
      props.push(`  ${formatPropName(name)}: ${propCode}`);
    }
  }

  if (props.length === 0) {
    return 'z.object({}).strict()';
  }

  // If the request body doesn't explicitly forbid additional properties,
  // use .passthrough() to allow arbitrary extra fields (e.g. connector configs).
  const allowExtra = requestBody?.type === 'object' && requestBody.additionalProperties !== false;
  const suffix = allowExtra ? '.passthrough()' : '.strict()';

  return `z.object({\n${props.join(',\n')}\n})${suffix}`;
}

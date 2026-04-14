import { z } from 'zod';
import type { JsonSchema } from '../types.js';

export function jsonSchemaToZod(schema: JsonSchema, strict: boolean = true): z.ZodType {
  return convert(schema, strict, true);
}

function convert(schema: JsonSchema, strict: boolean, isRoot: boolean): z.ZodType {
  if (schema.enum) {
    if (schema.enum.length === 0) return withDescription(z.string(), schema.description);
    const enumSchema = z.enum(schema.enum as [string, ...string[]]);
    return withMeta(enumSchema, schema);
  }

  if (schema.oneOf ?? schema.anyOf) {
    const variants = (schema.oneOf ?? schema.anyOf ?? []).map((s) => convert(s, true, false));
    if (variants.length === 0) return z.unknown();
    if (variants.length === 1) {
      const first = variants[0];
      if (first !== undefined) return first;
    }
    return z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }

  switch (schema.type) {
    case 'string':
      return buildString(schema);

    case 'integer':
      return buildInteger(schema);

    case 'number':
      return buildNumber(schema);

    case 'boolean':
      return buildBoolean(schema);

    case 'array':
      return buildArray(schema, strict);

    case 'object':
    default:
      return buildObject(schema, strict, isRoot);
  }
}

function buildString(schema: JsonSchema): z.ZodType {
  let s = z.string();
  if (schema.minLength !== undefined) s = s.min(schema.minLength);
  if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
  // eslint-disable-next-line security/detect-non-literal-regexp -- pattern comes from trusted OpenAPI schema
  if (schema.pattern !== undefined) s = s.regex(new RegExp(schema.pattern));
  let result: z.ZodType = s;
  if (schema.default !== undefined) result = s.default(schema.default as string);
  if (schema.nullable) result = result.nullable();
  return withDescription(result, schema.description);
}

function buildInteger(schema: JsonSchema): z.ZodType {
  let n = z.number().int();
  if (schema.minimum !== undefined) n = n.min(schema.minimum);
  if (schema.maximum !== undefined) n = n.max(schema.maximum);
  let result: z.ZodType = n;
  if (schema.default !== undefined) result = n.default(schema.default as number);
  return withDescription(result, schema.description);
}

function buildNumber(schema: JsonSchema): z.ZodType {
  let n = z.number();
  if (schema.minimum !== undefined) n = n.min(schema.minimum);
  if (schema.maximum !== undefined) n = n.max(schema.maximum);
  let result: z.ZodType = n;
  if (schema.default !== undefined) result = n.default(schema.default as number);
  return withDescription(result, schema.description);
}

function buildBoolean(schema: JsonSchema): z.ZodType {
  let b: z.ZodType = z.boolean();
  if (schema.default !== undefined) b = z.boolean().default(schema.default as boolean);
  return withDescription(b, schema.description);
}

function buildArray(schema: JsonSchema, strict: boolean): z.ZodType {
  const items = schema.items ? convert(schema.items, strict, false) : z.unknown();
  const result = z.array(items);
  return withDescription(result, schema.description);
}

function buildObject(schema: JsonSchema, strict: boolean, isRoot: boolean): z.ZodType {
  if (!schema.properties || Object.keys(schema.properties).length === 0) {
    return z.record(z.unknown());
  }

  const requiredSet = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodType> = {};

  for (const [name, prop] of Object.entries(schema.properties)) {
    let field = convert(prop, true, false);
    if (!requiredSet.has(name)) {
      field = field.optional();
    }
    shape[name] = field;
  }

  const obj = z.object(shape);

  if (isRoot) {
    return strict ? obj.strict() : obj.passthrough();
  }

  return obj;
}

function withDescription(schema: z.ZodType, description: string | undefined): z.ZodType {
  if (description) return schema.describe(description);
  return schema;
}

function withMeta(schema: z.ZodType, jsonSchema: JsonSchema): z.ZodType {
  let result = schema;
  if (jsonSchema.description) result = result.describe(jsonSchema.description);
  return result;
}

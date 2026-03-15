import { describe, it, expect } from 'vitest';
import { toJsonSchema } from '../../generator/src/parser.js';
import type { JsonSchema } from '../../generator/src/parser.js';
import { buildInputJsonSchema } from '../../generator/src/json-schema-output.js';
import type { OpenApiSpec, SchemaObject } from '../../generator/src/fetch.js';

// Minimal spec stub — most tests don't need $ref resolution
const emptySpec = { openapi: '3.0.0', info: { title: '', version: '' }, paths: {} } as OpenApiSpec;

describe('toJsonSchema', () => {
  it('should convert string schema', () => {
    const result = toJsonSchema(emptySpec, { type: 'string' });
    expect(result).toEqual({ type: 'string' });
  });

  it('should convert string schema with constraints', () => {
    const schema: SchemaObject = {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      description: 'A name',
    };
    const result = toJsonSchema(emptySpec, schema);

    expect(result.type).toBe('string');
    expect(result.minLength).toBe(1);
    expect(result.maxLength).toBe(64);
    expect(result.description).toBe('A name');
  });

  it('should convert integer schema', () => {
    const result = toJsonSchema(emptySpec, { type: 'integer', minimum: 1, maximum: 100 });

    expect(result.type).toBe('integer');
    expect(result.minimum).toBe(1);
    expect(result.maximum).toBe(100);
  });

  it('should convert boolean schema with default', () => {
    const result = toJsonSchema(emptySpec, { type: 'boolean', default: true });

    expect(result.type).toBe('boolean');
    expect(result.default).toBe(true);
  });

  it('should convert enum schema', () => {
    const result = toJsonSchema(emptySpec, { enum: ['read', 'write', 'admin'] });

    expect(result.enum).toEqual(['read', 'write', 'admin']);
  });

  it('should convert array schema', () => {
    const result = toJsonSchema(emptySpec, { type: 'array', items: { type: 'string' } });

    expect(result.type).toBe('array');
    expect(result.items).toEqual({ type: 'string' });
  });

  it('should convert object schema', () => {
    const result = toJsonSchema(emptySpec, {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
      },
      required: ['name'],
    });

    expect(result.type).toBe('object');
    expect(result.properties?.name).toEqual({ type: 'string' });
    expect(result.properties?.age).toEqual({ type: 'integer' });
    expect(result.required).toEqual(['name']);
  });

  it('should handle empty object', () => {
    const result = toJsonSchema(emptySpec, { type: 'object' });

    expect(result.type).toBe('object');
    expect(result.additionalProperties).toBe(true);
  });

  it('should resolve $ref', () => {
    const spec = {
      ...emptySpec,
      components: {
        schemas: {
          MyType: { type: 'string', description: 'resolved' },
        },
      },
    } as OpenApiSpec;

    const result = toJsonSchema(spec, { $ref: '#/components/schemas/MyType' });

    expect(result.type).toBe('string');
    expect(result.description).toBe('resolved');
  });

  it('should merge allOf schemas', () => {
    const result = toJsonSchema(emptySpec, {
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'integer' } } },
      ],
    });

    expect(result.type).toBe('object');
    expect(result.properties?.a).toEqual({ type: 'string' });
    expect(result.properties?.b).toEqual({ type: 'integer' });
    expect(result.required).toEqual(['a']);
  });

  it('should handle oneOf', () => {
    const result = toJsonSchema(emptySpec, {
      oneOf: [{ type: 'string' }, { type: 'integer' }],
    });

    expect(result.oneOf).toEqual([{ type: 'string' }, { type: 'integer' }]);
  });
});

describe('buildInputJsonSchema', () => {
  it('should build schema for parameters', () => {
    const params = [
      {
        name: 'project',
        required: true,
        schema: { type: 'string', description: 'Project name' } as JsonSchema,
      },
      { name: 'limit', required: false, schema: { type: 'integer' } as JsonSchema },
    ];

    const { schema, strict } = buildInputJsonSchema(params);

    expect(schema.type).toBe('object');
    expect(schema.properties?.project).toEqual({ type: 'string', description: 'Project name' });
    expect(schema.properties?.limit).toEqual({ type: 'integer' });
    expect(schema.required).toEqual(['project']);
    expect(strict).toBe(true);
  });

  it('should build empty schema when no parameters', () => {
    const { schema, strict } = buildInputJsonSchema([]);

    expect(schema.type).toBe('object');
    expect(schema.properties).toEqual({});
    expect(strict).toBe(true);
  });

  it('should include request body properties', () => {
    const params = [{ name: 'project', required: true, schema: { type: 'string' } as JsonSchema }];
    const requestBody: JsonSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        size: { type: 'integer' },
      },
      required: ['name'],
    };

    const { schema } = buildInputJsonSchema(params, requestBody);

    expect(schema.properties?.project).toEqual({ type: 'string' });
    expect(schema.properties?.name).toEqual({ type: 'string' });
    expect(schema.properties?.size).toEqual({ type: 'integer' });
    expect(schema.required).toContain('project');
    expect(schema.required).toContain('name');
  });
});

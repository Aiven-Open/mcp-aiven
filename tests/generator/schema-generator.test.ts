import { describe, it, expect } from 'vitest';
import { generateZodSchema, generateInputSchema } from '../../generator/src/schema-generator.js';
import type { ParsedSchema } from '../../generator/src/parser.js';

describe('generateZodSchema', () => {
  it('should generate string schema', () => {
    const schema: ParsedSchema = { type: 'string' };
    const result = generateZodSchema(schema);

    expect(result).toBe('z.string()');
  });

  it('should generate string schema with constraints', () => {
    const schema: ParsedSchema = {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      description: 'A name',
    };
    const result = generateZodSchema(schema);

    expect(result).toContain('z.string()');
    expect(result).toContain('.min(1)');
    expect(result).toContain('.max(64)');
    expect(result).toContain('.describe("A name")');
  });

  it('should generate integer schema', () => {
    const schema: ParsedSchema = {
      type: 'integer',
      minimum: 1,
      maximum: 100,
    };
    const result = generateZodSchema(schema);

    expect(result).toContain('z.number().int()');
    expect(result).toContain('.min(1)');
    expect(result).toContain('.max(100)');
  });

  it('should generate boolean schema', () => {
    const schema: ParsedSchema = {
      type: 'boolean',
      default: true,
    };
    const result = generateZodSchema(schema);

    expect(result).toContain('z.boolean()');
    expect(result).toContain('.default(true)');
  });

  it('should generate enum schema', () => {
    const schema: ParsedSchema = {
      type: 'enum',
      enumValues: ['read', 'write', 'admin'],
    };
    const result = generateZodSchema(schema);

    expect(result).toContain('z.enum(');
    expect(result).toContain('"read"');
    expect(result).toContain('"write"');
    expect(result).toContain('"admin"');
  });

  it('should generate array schema', () => {
    const schema: ParsedSchema = {
      type: 'array',
      items: { type: 'string' },
    };
    const result = generateZodSchema(schema);

    expect(result).toBe('z.array(z.string())');
  });

  it('should generate object schema', () => {
    const schema: ParsedSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
      },
      required: ['name'],
    };
    const result = generateZodSchema(schema);

    expect(result).toContain('z.object({');
    expect(result).toContain('name: z.string()');
    expect(result).toContain('age: z.number().int().optional()');
    expect(result).toContain('})');
  });

  it('should handle empty object', () => {
    const schema: ParsedSchema = {
      type: 'object',
    };
    const result = generateZodSchema(schema);

    expect(result).toContain('z.record(z.unknown())');
  });
});

describe('generateInputSchema', () => {
  it('should generate schema for parameters', () => {
    const params = [
      {
        name: 'project',
        required: true,
        schema: { type: 'string' as const, description: 'Project name' },
      },
      {
        name: 'limit',
        required: false,
        schema: { type: 'integer' as const },
      },
    ];

    const result = generateInputSchema(params);

    expect(result).toContain('z.object({');
    expect(result).toContain('project: z.string()');
    expect(result).toContain('limit: z.number().int().optional()');
    expect(result).toContain('}).strict()');
  });

  it('should generate empty schema when no parameters', () => {
    const result = generateInputSchema([]);

    expect(result).toBe('z.object({}).strict()');
  });

  it('should include request body properties', () => {
    const params = [{ name: 'project', required: true, schema: { type: 'string' as const } }];
    const requestBody: ParsedSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        size: { type: 'integer' },
      },
      required: ['name'],
    };

    const result = generateInputSchema(params, requestBody);

    expect(result).toContain('project: z.string()');
    expect(result).toContain('name: z.string()');
    expect(result).toContain('size: z.number().int().optional()');
  });
});

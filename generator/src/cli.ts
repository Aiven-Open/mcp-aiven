#!/usr/bin/env node
/**
 * Generate MCP tool schemas from OpenAPI specification.
 *
 * Reads manifests from src/manifests/*.yaml, matches each entry to the
 * OpenAPI spec, and writes generator/schemas/api-schemas.json.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { fetchOpenApiSpec } from './fetch.js';
import { parseOpenApiSpec } from './parser.js';
import { buildInputJsonSchema } from './json-schema-output.js';

interface ManifestEntry {
  name: string;
  method: string;
  path: string;
  category: string;
  description?: string;
  readOnly?: boolean;
  exclude_params?: string[];
}

const OUTPUT_FILE = path.join(process.cwd(), 'generator', 'schemas', 'api-schemas.json');

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildTitle(name: string): string {
  return name
    .replace(/^aiven_/, '')
    .replace(/^(core|pg|kafka)_/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function main(): Promise<void> {
  const spec = await fetchOpenApiSpec();
  const operations = parseOpenApiSpec(spec);

  const opMap = new Map(operations.map((op) => [`${op.method} ${op.path}`, op]));

  const manifestDir = path.join(process.cwd(), 'src', 'manifests');
  const files = (await fs.readdir(manifestDir)).filter((f) => f.endsWith('.yaml')).sort();

  const manifest: ManifestEntry[] = [];
  for (const file of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted internal path
    const content = await fs.readFile(path.join(manifestDir, file), 'utf-8');
    const parsed = (parseYaml(content) as { tools: ManifestEntry[] }).tools;
    manifest.push(...parsed);
  }

  const schemas: Record<
    string,
    { schema: Record<string, unknown>; strict: boolean; title: string; description: string }
  > = {};
  let matched = 0;

  for (const entry of manifest) {
    const op = opMap.get(`${entry.method.toUpperCase()} ${entry.path}`);
    if (!op) {
      console.warn(`WARNING: No operation for ${entry.method} ${entry.path} (${entry.name})`);
      continue;
    }
    matched++;

    const params = entry.exclude_params
      ? op.parameters.filter((p) => !entry.exclude_params?.includes(p.name))
      : op.parameters;
    const { schema, strict } = buildInputJsonSchema(params, op.requestBody);

    // Description: prefer manifest override, fall back to OpenAPI summary + description
    let description: string;
    if (entry.description) {
      description = entry.description.trim();
    } else {
      const summary = op.summary ?? 'No description available';
      const cleaned = op.description ? stripHtml(op.description) : '';
      description = cleaned && cleaned !== summary ? `${summary}\n\n${cleaned}` : summary;
    }

    schemas[entry.name] = {
      schema: schema as Record<string, unknown>,
      strict,
      title: buildTitle(entry.name),
      description,
    };
  }

  // Write output
  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(schemas, null, 2) + '\n');

  console.log(`Generated ${matched}/${manifest.length} tool schemas → ${OUTPUT_FILE}`);
}

main().catch((error: unknown) => {
  console.error('Generation failed:', error);
  process.exit(1);
});

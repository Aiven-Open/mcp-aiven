import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AivenClient } from '../client.js';
import type {
  ToolDefinition,
  ToolAnnotations,
  HttpMethod,
  ToolResult,
  JsonSchema,
  ResponseFilterConfig,
  HandlerContext,
} from '../types.js';
import {
  ServiceCategory,
  READ_ONLY_ANNOTATIONS,
  CREATE_ANNOTATIONS,
  UPDATE_ANNOTATIONS,
  DELETE_ANNOTATIONS,
} from '../types.js';
import { jsonSchemaToZod } from './json-schema-to-zod.js';
import { createApiTool } from './api-tool.js';
import { createRequire } from 'node:module';
import { TOOL_LIST_PICKER_SUFFIX } from '../prompts.js';

interface ManifestEntry {
  name: string;
  method: string;
  path: string;
  category: string;
  description?: string;
  append_list_picker_hint?: boolean;
  readOnly?: boolean;
  destructive?: boolean;
  defaults?: Record<string, unknown>;
  response_filter?: ResponseFilterConfig;
}

interface ManifestFile {
  tools: ManifestEntry[];
}

interface SchemaEntry {
  schema: JsonSchema;
  strict: boolean;
  title: string;
  description: string;
}

type SchemaMap = Record<string, SchemaEntry>;

const CATEGORY_MAP: Record<string, ServiceCategory> = {
  core: ServiceCategory.Core,
  pg: ServiceCategory.Pg,
  kafka: ServiceCategory.Kafka,
};

function toCategory(cat: string): ServiceCategory {
  const mapped = CATEGORY_MAP[cat];
  if (!mapped) throw new Error(`Unknown category: ${cat}`);
  return mapped;
}

function deriveAnnotations(
  method: string,
  readOnly?: boolean,
  destructive?: boolean
): ToolAnnotations {
  if (readOnly) return READ_ONLY_ANNOTATIONS;
  const base = ((): ToolAnnotations => {
    switch (method.toUpperCase()) {
      case 'GET':
        return READ_ONLY_ANNOTATIONS;
      case 'DELETE':
        return DELETE_ANNOTATIONS;
      case 'PUT':
      case 'PATCH':
        return UPDATE_ANNOTATIONS;
      default:
        return CREATE_ANNOTATIONS;
    }
  })();
  if (destructive && !base.destructiveHint) {
    return { ...base, destructiveHint: true };
  }
  return base;
}

function loadManifests(): ManifestEntry[] {
  const manifestDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'manifests');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted internal path
  const files = fs
    .readdirSync(manifestDir)
    .filter((f) => f.endsWith('.yaml'))
    .sort();

  const entries: ManifestEntry[] = [];
  for (const file of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted internal path
    const content = fs.readFileSync(path.join(manifestDir, file), 'utf-8');
    const manifest = parseYaml(content) as ManifestFile;
    entries.push(...manifest.tools);
  }
  return entries;
}

function loadSchemas(): SchemaMap {
  const require = createRequire(import.meta.url);
  return require('../../generator/schemas/api-schemas.json') as SchemaMap;
}

async function resolveFreePlanCloud(
  params: Record<string, unknown>,
  client: AivenClient,
  token?: string
): Promise<void> {
  if (typeof params['plan'] !== 'string' || !params['plan'].startsWith('free')) return;

  try {
    const opts = token ? { token } : undefined;
    const res = await client.get<{
      free_plan_cloud_providers: string[];
      free_plan_cloud_preferences: Array<{ cloud_name: string; weight: number }>;
    }>('/console/free-plan-availability', opts);

    const providers = res.free_plan_cloud_providers;
    const cloud = params['cloud'] as string | undefined;
    const isValid = cloud && providers.some((p: string) => cloud.startsWith(`${p}-`));

    if (!isValid && res.free_plan_cloud_preferences.length > 0) {
      params['cloud'] = res.free_plan_cloud_preferences.reduce((a, b) =>
        b.weight > a.weight ? b : a
      ).cloud_name;
    }
  } catch {
    // ignore free-plan availability lookup failures
  }
}

export function loadApiTools(client: AivenClient): ToolDefinition[] {
  const manifests = loadManifests();
  const schemas = loadSchemas();

  const tools: ToolDefinition[] = [];

  for (const entry of manifests) {
    const category = toCategory(entry.category);

    const schemaEntry = schemas[entry.name];
    if (!schemaEntry) {
      console.error(`mcp-aiven: No schema found for tool ${entry.name}, skipping`);
      continue;
    }

    let description = entry.description ?? schemaEntry.description;
    if (entry.append_list_picker_hint) {
      description = `${description}\n\n${TOOL_LIST_PICKER_SUFFIX}`;
    }
    const inputSchema = jsonSchemaToZod(schemaEntry.schema, schemaEntry.strict);

    const tool = createApiTool(
      {
        name: entry.name,
        title: schemaEntry.title,
        description,
        category,
        method: entry.method as HttpMethod,
        path: entry.path,
        inputSchema,
        annotations: deriveAnnotations(entry.method, entry.readOnly, entry.destructive),
        defaults: entry.defaults,
        responseFilter: entry.response_filter,
      },
      client
    );

    // Resolve free plan cloud for aiven_service_create
    if (entry.name === 'aiven_service_create') {
      const originalHandler = tool.handler;
      tool.handler = async (params, context?: HandlerContext): Promise<ToolResult> => {
        const args = params as Record<string, unknown>;
        await resolveFreePlanCloud(args, client, context?.token);
        return originalHandler(params, context);
      };
    }

    tools.push(tool);
  }

  return tools;
}

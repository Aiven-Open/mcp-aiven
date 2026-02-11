/**
 * Apply YAML overlay modifications to OpenAPI spec
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { JSONPath } from 'jsonpath-plus';
import type { OpenApiSpec } from './fetch.js';

export interface Overlay {
  overlay: string;
  info: {
    title: string;
    version: string;
  };
  actions: OverlayAction[];
}

export interface OverlayAction {
  target: string;
  description?: string;
  update?: Record<string, unknown>;
  remove?: boolean;
}

/**
 * Load overlay from YAML file
 */
export async function loadOverlay(overlayPath: string): Promise<Overlay> {
  const content = await fs.readFile(overlayPath, 'utf-8');
  return parseYaml(content) as Overlay;
}

/**
 * Load all overlays from a directory
 */
export async function loadOverlays(overlayDir: string): Promise<Overlay[]> {
  const overlays: Overlay[] = [];

  try {
    const files = await fs.readdir(overlayDir);
    for (const file of files) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const overlay = await loadOverlay(path.join(overlayDir, file));
        overlays.push(overlay);
        console.log(`Loaded overlay: ${overlay.info.title} v${overlay.info.version}`);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    console.log('No overlay directory found, skipping overlays');
  }

  return overlays;
}

/**
 * Apply a single overlay action to the spec
 */
function applyAction(spec: OpenApiSpec, action: OverlayAction): number {
  let matchCount = 0;

  // Find all matching paths (resultType: 'all' yields { value, parent, parentProperty })
  type JsonPathMatch = {
    value: unknown;
    parent: Record<string, unknown>;
    parentProperty: string;
  };
  const matches: JsonPathMatch[] = JSONPath({
    path: action.target,
    json: spec,
    resultType: 'all',
  });

  for (const match of matches) {
    matchCount++;

    if (action.remove) {
      Reflect.deleteProperty(match.parent, match.parentProperty);
    } else if (action.update && typeof match.value === 'object' && match.value !== null) {
      // Merge update into matched element
      Object.assign(match.value, action.update);
    }
  }

  return matchCount;
}

/**
 * Apply all overlays to the OpenAPI spec
 */
export function applyOverlays(spec: OpenApiSpec, overlays: Overlay[]): OpenApiSpec {
  // Deep clone spec to avoid mutations
  const result = JSON.parse(JSON.stringify(spec)) as OpenApiSpec;

  for (const overlay of overlays) {
    console.log(`Applying overlay: ${overlay.info.title}`);

    for (const action of overlay.actions) {
      const matchCount = applyAction(result, action);
      if (action.description) {
        console.log(`  ${action.description}: ${matchCount} matches`);
      }
    }
  }

  return result;
}

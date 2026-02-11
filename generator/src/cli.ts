#!/usr/bin/env node
/**
 * CLI for generating MCP tools from OpenAPI specification
 */

import * as path from 'node:path';
import { fetchOpenApiSpec } from './fetch.js';
import { loadOverlays, applyOverlays } from './overlay.js';
import { parseOpenApiSpec } from './parser.js';
import { categorizeOperations } from './categorizer.js';
import { generateToolFiles } from './codegen.js';

function shouldRefresh(): boolean {
  return process.argv.includes('--refresh') || process.argv.includes('-r');
}

async function main(): Promise<void> {
  console.log('=== MCP-Aiven Tool Generator ===\n');

  const refresh = shouldRefresh();
  if (refresh) console.log('Forcing refresh of OpenAPI spec\n');

  try {
    console.log('Step 1: Fetching OpenAPI specification...');
    const spec = await fetchOpenApiSpec({ refresh });
    console.log();

    console.log('Step 2: Loading overlays...');
    const overlayDir = path.join(process.cwd(), 'generator', 'overlays');
    const overlays = await loadOverlays(overlayDir);
    const modifiedSpec = applyOverlays(spec, overlays);
    console.log();

    console.log('Step 3: Parsing operations...');
    const operations = parseOpenApiSpec(modifiedSpec);
    console.log();

    console.log('Step 4: Categorizing operations...');
    const categorized = categorizeOperations(operations);
    console.log();

    console.log('Step 5: Generating tool manifest...');
    await generateToolFiles(categorized);
    console.log();

    console.log('=== Generation complete ===');
  } catch (error) {
    console.error('Generation failed:', error);
    process.exit(1);
  }
}

void main();

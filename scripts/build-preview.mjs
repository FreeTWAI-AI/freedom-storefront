#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { renderPreview, templates } from '../packages/templates/index.mjs';

const usage = 'Usage: npm run build -- --template <master-store|catalog-store|single-product|service-offer> --input <snapshot.json> --output <private-preview.html> [--store-id <id>] [--listing-id <id>]';
const flags = new Set(['--template', '--input', '--output', '--store-id', '--listing-id']);

async function main() {
  const args = process.argv.slice(2), options = {};
  if (args.length === 0 || args.includes('--help')) { process.stdout.write(`${usage}\n`); return; }
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!flags.has(key) || !value || value.startsWith('--') || options[key] !== undefined) throw new Error(`Invalid argument ${key}.\n${usage}`);
    options[key] = value;
  }
  if (!templates[options['--template']] || !options['--input'] || !options['--output']) throw new Error(usage);
  const input = await readFile(resolve(options['--input']), 'utf8');
  if (Buffer.byteLength(input) > 5_000_000) throw new Error('Snapshot exceeds the 5 MB preview limit.');
  const html = renderPreview(options['--template'], JSON.parse(input), { storeId: options['--store-id'], listingId: options['--listing-id'] });
  const output = resolve(options['--output']);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  // Exclusive creation avoids clobbering previous snapshots. Generated files are private.
  await writeFile(output, html, { mode: 0o600, flag: 'wx' });
  process.stdout.write(`Created private local preview: ${output}\nNo deployment or publication was performed.\n`);
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

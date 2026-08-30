#!/usr/bin/env node
// Diff the previous committed catalogue against the freshly built one and emit a
// human-readable summary. This is what turns `git log data/models.json` into a
// changelog of the model industry - the thing nobody currently publishes.
//
// Usage: node src/changelog.mjs            (compares against git HEAD)
//        node src/changelog.mjs old.json   (compares against a file)

import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'data/models.json';

function loadOld(arg) {
  if (arg) return JSON.parse(execSync(`cat ${JSON.stringify(arg)}`, { encoding: 'utf8' }));
  try {
    return JSON.parse(execSync(`git show HEAD:${REL}`, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
}

const oldDoc = loadOld(process.argv[2]);
const newDoc = JSON.parse(await readFile(join(ROOT, REL), 'utf8'));

if (!oldDoc) {
  console.log(`Initial catalogue: ${newDoc.models.length} models.`);
  process.exit(0);
}

const oldById = new Map(oldDoc.models.map((m) => [m.id, m]));
const newById = new Map(newDoc.models.map((m) => [m.id, m]));

const added = [...newById.keys()].filter((k) => !oldById.has(k));
const removed = [...oldById.keys()].filter((k) => !newById.has(k));

const money = (v) => (v == null ? '-' : `$${v}`);
const priceChanges = [];
const capChanges = [];
const lifecycleChanges = [];

for (const [id, next] of newById) {
  const prev = oldById.get(id);
  if (!prev) continue;

  for (const mode of new Set([...Object.keys(prev.pricing?.modes ?? {}), ...Object.keys(next.pricing?.modes ?? {})])) {
    const a = prev.pricing?.modes?.[mode] ?? {};
    const b = next.pricing?.modes?.[mode] ?? {};
    for (const field of ['input', 'output', 'cache_read', 'cache_write_5m', 'reasoning']) {
      if (a[field] !== b[field]) {
        const pct = a[field] && b[field] ? ` (${(((b[field] - a[field]) / a[field]) * 100).toFixed(0)}%)` : '';
        priceChanges.push(`${id} ${mode}.${field}: ${money(a[field])} -> ${money(b[field])}${pct}`);
      }
    }
  }

  for (const bag of ['params', 'features']) {
    for (const k of new Set([...Object.keys(prev[bag] ?? {}), ...Object.keys(next[bag] ?? {})])) {
      const a = prev[bag]?.[k] ?? 'unknown';
      const b = next[bag]?.[k] ?? 'unknown';
      if (a !== b) capChanges.push(`${id} ${bag}.${k}: ${a} -> ${b}`);
    }
  }

  for (const k of ['status', 'shutdown_date', 'deprecation_announced', 'successor']) {
    const a = prev.lifecycle?.[k] ?? null;
    const b = next.lifecycle?.[k] ?? null;
    if (a !== b) lifecycleChanges.push(`${id} ${k}: ${a ?? '-'} -> ${b ?? '-'}`);
  }
}

const total = added.length + removed.length + priceChanges.length + capChanges.length + lifecycleChanges.length;
if (total === 0) {
  console.log('No catalogue changes.');
  process.exit(0);
}

const section = (title, items, limit = 30) => {
  if (!items.length) return;
  console.log(`\n${title} (${items.length})`);
  for (const i of items.slice(0, limit)) console.log(`  - ${i}`);
  if (items.length > limit) console.log(`  ... and ${items.length - limit} more`);
};

// Lifecycle first: a shutdown date is the only change that can break production
// on a deadline you did not choose.
section('Lifecycle', lifecycleChanges);
section('Price changes', priceChanges);
section('Capability changes', capChanges);
section('Added', added);
section('Removed', removed);

#!/usr/bin/env node
// Invariant checks on data/models.json. No dependencies.
// These guard the two things that make the dataset worth depending on:
// internally-consistent prices, and claims that are traceable to a source.

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = JSON.parse(await readFile(join(ROOT, 'data', 'models.json'), 'utf8'));

const SUPPORT = new Set(['supported', 'rejected', 'ignored', 'unknown']);
const errors = [];
const warnings = [];
const seen = new Set();

const err = (id, msg) => errors.push(`${id}: ${msg}`);
const warn = (id, msg) => warnings.push(`${id}: ${msg}`);

for (const m of doc.models) {
  const id = m.id ?? '<missing id>';

  if (!m.id) err(id, 'missing id');
  if (seen.has(m.id)) err(id, 'duplicate id');
  seen.add(m.id);

  if (!m.provenance?.length) err(id, 'no provenance - every record must be traceable');

  const std = m.pricing?.modes?.standard;
  if (!std) { err(id, 'missing pricing.modes.standard'); continue; }

  // Price sanity. Output is dearer than input on essentially every commercial
  // model; an inversion is far more likely a parse bug than a real tariff.
  if (std.input != null && std.output != null && std.output < std.input) {
    warn(id, `output ($${std.output}) cheaper than input ($${std.input}) - verify upstream parse`);
  }
  if (std.cache_read != null && std.input != null && std.cache_read > std.input) {
    err(id, `cache_read ($${std.cache_read}) exceeds input ($${std.input}) - caching would be a loss`);
  }
  if (std.cache_write_5m != null && std.input != null && std.cache_write_5m < std.input
      && m.pricing.cache_model === 'unknown') {
    // A "write" cheaper than a read almost always means the upstream field is a
    // per-hour storage rent, not a per-token write fee - a different unit
    // flattened into the same column. Flag it rather than price it wrongly.
    warn(id, `cache_write ($${std.cache_write_5m}) < input ($${std.input}) - likely per-hour storage, not a write fee; cache_model unresolved`);
  }

  for (const [mode, row] of Object.entries(m.pricing.modes)) {
    if (mode === 'standard') continue;
    if (row?.input == null || std.input == null) continue;
    if (mode === 'batch' && row.input > std.input) {
      // Not a parse bug. For open-weight models served by many hosts, the
      // standard price is the cheapest router hop while the batch price is one
      // specific host's. "Batch is always cheaper" is false in practice.
      warn(id, `batch input ($${row.input}) exceeds standard ($${std.input}) - batch is dearer than standard here`);
    }
    if (mode === 'fast' && row.input < std.input) {
      err(id, `fast input ($${row.input}) below standard ($${std.input})`);
    }
  }

  for (const [k, v] of Object.entries({ ...(m.params ?? {}), ...(m.features ?? {}) })) {
    if (!SUPPORT.has(v)) err(id, `${k} has invalid support value "${v}"`);
  }

  // Integrity rule that protects the whole premise: "rejected" is a strong claim
  // - it says this request errors. Reseller catalogues cannot establish that.
  // It must be backed by a first-party overlay.
  const rejects = Object.entries({ ...(m.params ?? {}), ...(m.features ?? {}) })
    .filter(([, v]) => v === 'rejected')
    .map(([k]) => k);
  if (rejects.length) {
    const firstParty = m.provenance.some((p) => p.confidence && p.confidence !== 'unverified');
    if (!firstParty) {
      err(id, `claims rejected for [${rejects.join(', ')}] with no first-party provenance`);
    }
  }

  const shutdown = m.lifecycle?.shutdown_date;
  if (shutdown && Number(String(shutdown).slice(0, 4)) >= 2090) {
    err(id, `shutdown_date "${shutdown}" is a sentinel, not a real date`);
  }
}

const known = doc.coverage?.param_cells_known_pct ?? 0;
console.log(`models          : ${doc.models.length}`);
console.log(`param coverage  : ${known}%`);
console.log(`errors          : ${errors.length}`);
console.log(`warnings        : ${warnings.length}`);
if (warnings.length) {
  console.log('\n--- warnings ---');
  for (const w of warnings.slice(0, 25)) console.log('  ' + w);
  if (warnings.length > 25) console.log(`  ... and ${warnings.length - 25} more`);
}
if (errors.length) {
  console.log('\n--- errors ---');
  for (const e of errors.slice(0, 40)) console.log('  ' + e);
  process.exit(1);
}
console.log('\nOK');

#!/usr/bin/env node
// Build data/models.json from the OpenRouter spine + hand-verified overlays.
// Zero API spend: one unauthenticated GET, plus local JSON.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_ID, SOURCE_URL, normalise, PARAM_UNIVERSE } from './sources/openrouter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'openrouter.json');
const OUT = join(ROOT, 'data', 'models.json');
const OVERLAY_DIR = join(ROOT, 'data', 'overlays');

const OFFLINE = process.argv.includes('--offline');

// Resellers list a model's pricing MODES as if they were separate models:
// `claude-opus-5`, `claude-opus-5:batch` and `claude-opus-5-fast` are one set of
// weights at three prices. Left unfolded, every downstream leaderboard counts
// that model three times and picks whichever price flatters its ranking.
// We only fold when the base model exists, so genuinely distinct models that
// happen to end in `-fast` (e.g. morph/morph-v3-fast) are left alone.
const VARIANT_SUFFIXES = [
  { suffix: ':batch', mode: 'batch' },
  { suffix: '-fast', mode: 'fast' },
];

function foldVariants(models) {
  const byId = new Map(models.map((m) => [m.id, m]));
  const dropped = [];
  for (const m of models) {
    for (const { suffix, mode } of VARIANT_SUFFIXES) {
      if (!m.id.endsWith(suffix)) continue;
      const base = byId.get(m.id.slice(0, -suffix.length));
      if (!base) continue; // distinct model, not a mode
      base.pricing.modes[mode] = m.pricing.modes.standard;
      base.notes.push(`Priced separately in ${mode} mode; upstream lists it as a distinct model (${m.id}).`);
      dropped.push(m.id);
      break;
    }
  }
  const gone = new Set(dropped);
  return { models: models.filter((m) => !gone.has(m.id)), foldedCount: dropped.length };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Deep merge `patch` onto `base`, returning the list of dotted field paths the
// patch actually changed. That path list becomes the overlay's provenance.
function mergeTracked(base, patch, prefix = '', touched = []) {
  for (const [k, v] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && isPlainObject(base[k])) {
      mergeTracked(base[k], v, path, touched);
    } else if (Array.isArray(v) && Array.isArray(base[k])) {
      const before = base[k].length;
      base[k] = [...new Set([...base[k], ...v])];
      if (base[k].length !== before) touched.push(path);
    } else {
      if (JSON.stringify(base[k]) !== JSON.stringify(v)) touched.push(path);
      base[k] = v;
    }
  }
  return touched;
}

async function loadSpine() {
  if (OFFLINE || (existsSync(CACHE) && process.env.MODELDIFF_USE_CACHE === '1')) {
    if (!existsSync(CACHE)) throw new Error('--offline requested but no cache at .cache/openrouter.json');
    const cached = JSON.parse(await readFile(CACHE, 'utf8'));
    return { payload: cached.payload, fetchedAt: cached.fetchedAt, live: false };
  }
  const res = await fetch(SOURCE_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${SOURCE_ID} returned HTTP ${res.status}`);
  const payload = await res.json();
  const fetchedAt = new Date().toISOString();
  await mkdir(dirname(CACHE), { recursive: true });
  await writeFile(CACHE, JSON.stringify({ fetchedAt, payload }));
  return { payload, fetchedAt, live: true };
}

async function loadOverlays() {
  if (!existsSync(OVERLAY_DIR)) return [];
  const files = (await readdir(OVERLAY_DIR)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(
    files.map(async (f) => ({ file: f, ...JSON.parse(await readFile(join(OVERLAY_DIR, f), 'utf8')) })),
  );
}

const { payload, fetchedAt, live } = await loadSpine();
const rawModels = normalise(payload, fetchedAt);
const { models, foldedCount } = foldVariants(rawModels);
const byId = new Map(models.map((m) => [m.id, m]));

const sources = [
  { id: SOURCE_ID, url: SOURCE_URL, fetched_at: fetchedAt,
    note: 'Reseller catalogue. Wide coverage, unverified against first-party list price.' },
];

let patched = 0;
let created = 0;
for (const overlay of await loadOverlays()) {
  const src = overlay.source ?? {};
  sources.push({
    id: src.id ?? overlay.file,
    url: src.url ?? '',
    fetched_at: src.as_of ?? fetchedAt,
    note: src.note ?? `Hand-verified overlay (${overlay.file})`,
  });

  for (const [id, patch] of Object.entries(overlay.models ?? {})) {
    let target = byId.get(id);
    if (!target) {
      // Overlay-only model: not carried by the spine.
      target = { id, provider: id.split('/')[0], notes: [], provenance: [], params: {}, features: {} };
      byId.set(id, target);
      created += 1;
    } else {
      patched += 1;
    }
    const merged = { ...(overlay.defaults ?? {}), ...patch };
    const touched = mergeTracked(target, merged);
    if (touched.length) {
      target.provenance.push({
        source: src.id ?? overlay.file,
        fields: touched,
        confidence: src.confidence ?? 'verified',
        as_of: src.as_of ?? null,
      });
    }
  }
}

const out = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));

// Coverage: how much of the capability matrix is actually known? This number is
// the project's honesty metric and its contribution invitation - every 'unknown'
// cell is a PR someone can send.
let known = 0;
let total = 0;
for (const m of out) {
  for (const p of PARAM_UNIVERSE) {
    total += 1;
    if (m.params?.[p] && m.params[p] !== 'unknown') known += 1;
  }
}
const coverage = total ? +((known / total) * 100).toFixed(1) : 0;

const doc = {
  schema_version: '0.1',
  generated_at: new Date().toISOString(),
  coverage: {
    models: out.length,
    upstream_entries: rawModels.length,
    folded_price_variants: foldedCount,
    param_cells: total,
    param_cells_known: known,
    param_cells_known_pct: coverage,
    priced_with_cache_read: out.filter((m) => m.pricing?.modes?.standard?.cache_read != null).length,
    priced_with_cache_write: out.filter((m) => m.pricing?.modes?.standard?.cache_write_5m != null).length,
    with_shutdown_date: out.filter((m) => m.lifecycle?.shutdown_date).length,
    tokenizer_families: [...new Set(out.map((m) => m.tokenizer?.family).filter(Boolean))].length,
    tokenizers_measured: out.filter((m) => m.tokenizer?.tokens_per_1k_chars != null).length,
  },
  sources,
  models: out,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(doc, null, 2) + '\n');

console.log(`${live ? 'fetched' : 'cached '} spine   : ${rawModels.length} upstream entries`);
console.log(`folded variants   : ${foldedCount} price-mode aliases merged -> ${models.length} real models`);
console.log(`overlays          : ${patched} patched, ${created} created`);
console.log(`param coverage    : ${known}/${total} cells known (${coverage}%)`);
console.log(`cache_read priced : ${doc.coverage.priced_with_cache_read}/${out.length}`);
console.log(`cache_write priced: ${doc.coverage.priced_with_cache_write}/${out.length}`);
console.log(`tokenizer families: ${doc.coverage.tokenizer_families}  (measured: ${doc.coverage.tokenizers_measured})`);
console.log(`shutdown dates    : ${doc.coverage.with_shutdown_date}/${out.length}`);
console.log(`wrote ${OUT}`);

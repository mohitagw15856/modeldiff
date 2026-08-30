# modeldiff

[![models](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/mohitagw15856/modeldiff/main/data/badges/models.json)](data/models.json) [![coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/mohitagw15856/modeldiff/main/data/badges/coverage.json)](FINDINGS.md) [![tokenizers](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/mohitagw15856/modeldiff/main/data/badges/tokenizers.json)](FINDINGS.md) [![measured](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/mohitagw15856/modeldiff/main/data/badges/measured.json)](CONTRIBUTING.md) [![spend](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/mohitagw15856/modeldiff/main/data/badges/spend.json)](#how-it-stays-true)

**Machine-readable price, capability and breaking-change data for every frontier LLM.**

> Claude Opus 5 costs **$2.50, $5.00 or $10.00 per million input tokens** depending on how
> you call it. Same weights. Every leaderboard prints one of those three numbers and calls
> it *the price*.

Not a leaderboard. There are already good ones — Artificial Analysis, LLM Stats, BenchLM — and they all answer *"which model is best?"*

This answers the question that actually costs you a weekend: **"what breaks if I switch?"**

📊 **[See what fell out of the data →](FINDINGS.md)** — the batch tax, phantom tariffs,
Schrödinger's cache, and 18 mutually incomparable tokenizers.

---

## Four things the leaderboards get wrong

*(Full auto-generated breakdown in [FINDINGS.md](FINDINGS.md), rebuilt on every refresh.)*

Every number below is computed by `src/build.mjs` from the current catalogue. Rebuild and check them.

### 1. `$/Mtok` is not a comparable unit

The catalogue spans **18 distinct tokenizer families** — GPT, Claude-4.7+, Claude-pre-4.7, Gemini, Qwen3, Mistral, DeepSeek, Llama3 and more. A token is a different amount of text in each one.

Anthropic's own migration notes say the tokenizer introduced at Opus 4.7 consumes **~1.0×–1.35× as many tokens** as the previous one *for identical input*. So a model with a lower sticker price can produce a higher bill on your actual corpus.

Every leaderboard ranks by sticker price. None of them normalise for this. `tokenizer.cost_index` is the field that fixes it.

### 2. One model is not one price

Upstream catalogues list **396 entries** for what are really **352 models**. The other **44 are pricing modes of a model already in the list** — the same weights at a different tariff.

Claude Opus 5 appears three times: `claude-opus-5` at $5/$25, `:batch` at $2.50/$12.50, and `-fast` at $10/$50. Same model. **2× the price for fast mode; 4× between the cheapest and dearest way to call it.** Any ranking built on the raw feed counts it three times and quotes whichever price flatters the chart.

modeldiff folds these into one record with a `pricing.modes` map.

And the folk wisdom is wrong in both directions: **11 models are more expensive in batch mode than standard**, because the "standard" price is the cheapest routed host while batch is one specific host's.

### 3. Cache pricing is measured in incompatible units

Cache economics dominate real agent cost — and the data is a mess. Of 352 models, **198 publish a cache read price, only 58 publish a cache write price**, and 154 publish nothing at all.

Worse, the ones that do publish aren't using the same unit. Anthropic charges a **one-off write premium** (~1.25× input) with cheap reads. Gemini-family pricing behaves like **per-hour storage rent** — which is why its "cache write" reads *cheaper than input*, an impossible shape for a write fee. Reseller catalogues flatten both into one column.

**190 models** have a cache price whose billing model is still unresolved. `pricing.cache_model` records which is which; the validator flags every unit mismatch instead of silently mispricing it.

### 4. Nobody tracks what *errors* when you switch

This is the real migration pain, and it is completely unserved.

Moving between recent Claude models alone: `temperature`, `top_p` and `top_k` now return **HTTP 400**. Assistant prefill returns **400**. `thinking.budget_tokens` was removed and returns **400**.

Worse than the errors are the silences. Omitting `thinking` on Opus 5 runs adaptive thinking; the identical request on Opus 4.8 runs with thinking **off**. Same code, different behaviour, different bill, no error.

modeldiff models this with a support value that distinguishes the cases leaderboards collapse into a checkbox:

| value | meaning |
|---|---|
| `supported` | works |
| `rejected` | **the request errors** — a hard break on migration |
| `ignored` | accepted and silently does nothing — the dangerous one |
| `unknown` | not yet verified. Never inferred. |

Only **3 of 352 models publish a shutdown date**, and upstream sentinel values like `2098-12-31` are stripped rather than passed through as real dates.

---

## Using it

> Not yet published to npm — clone and `import` from `data/models.json`, or read the
> raw file from GitHub. The package manifest is ready for a `0.1.0` publish.

```js
import catalogue from './data/models.json' with { type: 'json' };

const opus = catalogue.models.find(m => m.id === 'anthropic/claude-opus-5');

opus.pricing.modes.standard.input   // 5
opus.pricing.modes.fast.input       // 10  - same weights, double the price
opus.params.temperature             // 'rejected'  - this 400s
opus.features.assistant_prefill     // 'rejected'
opus.tokenizer.family               // 'Claude-4.7+'
```

Find every model where a parameter you depend on will break:

```js
catalogue.models.filter(m => m.params.temperature === 'rejected')
```

Or build it yourself — one unauthenticated GET, no API keys, no inference spend:

```bash
node src/build.mjs      # fetch upstream, fold variants, apply overlays
node src/validate.mjs   # invariant checks
node src/changelog.mjs  # human-readable diff vs the last commit
```

## How it stays true

Two sources, kept deliberately separate:

- **The spine** — a reseller catalogue. Wide coverage, free, unauthenticated. Every field it supplies is marked `unverified`.
- **Overlays** (`data/overlays/*.json`) — hand-transcribed first-party documentation. These override the spine and carry their own source URL, date and confidence.

Every record carries per-field `provenance`, so you can see which source claimed what and when. **The catalogue never infers a capability from absence.** If upstream doesn't list `temperature`, that is recorded as `unknown`, not `rejected` — a reseller's silence cannot establish that a request errors. Only a first-party overlay may make that claim, and `validate.mjs` fails the build if a `rejected` appears without one.

A daily GitHub Action rebuilds, validates, and opens a PR **only when something actually changed**, with the diff as the commit message. `git log data/models.json` is the changelog of the model industry that nobody else publishes.

## Coverage, honestly

| | |
|---|---|
| Models | 352 |
| Capability cells known | 4,535 / 9,152 (**49.6%**) |
| Models with first-party provenance | **8** |
| Cache billing model resolved | 8 / 198 priced |
| Tokenizers actually measured | **0 / 18 families** |

**Half this dataset is `unknown`, and the tokenizer study is not built yet.** Those gaps are stated in the data rather than papered over — `coverage` is a field in `models.json`, not a marketing claim.

Every `unknown` cell is a pull request someone can send. That is the point.

## Contributing

The highest-value contributions, in order:

1. **First-party overlays.** Pick a provider, transcribe its pricing and migration docs into `data/overlays/<provider>.json`, cite the URL. This is what turns `unknown` into knowledge.
2. **Tokenizer measurements.** Run the shared corpus through a tokenizer locally, fill in `tokens_per_1k_chars`. No API key needed. This is the highest-leverage work in the repo.
3. **Shutdown dates.** Providers bury these. Three are known. There are far more.
4. **Corrections.** If a price is wrong, open an issue with the source URL. Provenance means we can tell exactly which source was wrong and when.

See `CONTRIBUTING.md`.

## What this is not

- Not a benchmark. It makes no claim about which model is *better*.
- Not a proxy or a router. It does not call any model.
- Not authoritative on price. Always confirm against the provider's own page before committing spend — that is what `provenance` is for.

MIT.

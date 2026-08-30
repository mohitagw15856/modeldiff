# Contributing

## The one rule

**Never infer a capability from absence.**

If a source doesn't mention a parameter, that is `unknown`. It is not `rejected`.

`rejected` is a strong claim — it says *this request returns an error*. It may only
come from first-party documentation or a reproducible error, cited in the overlay's
`source.url`. `validate.mjs` fails the build on any `rejected` without first-party
provenance, and that check is not negotiable: it is the only thing separating this
dataset from a confident guess.

## Adding a provider overlay

Create `data/overlays/<provider>.json`:

```json
{
  "source": {
    "id": "openai-first-party",
    "url": "https://platform.openai.com/docs/pricing",
    "as_of": "2026-08-30",
    "confidence": "verified",
    "note": "Transcribed from the official pricing page."
  },
  "models": {
    "openai/gpt-5.6": {
      "provider_model_id": "gpt-5.6",
      "pricing": {
        "cache_model": "automatic",
        "modes": { "standard": { "input": 0, "output": 0, "cache_read": 0 } }
      },
      "params": { "temperature": "supported" },
      "features": { "assistant_prefill": "unknown" },
      "notes": ["Anything that errors or silently changes behaviour on migration."]
    }
  }
}
```

Only include fields you actually verified. Partial overlays are welcome and expected —
the build deep-merges them onto the spine and records exactly which paths you touched.

`confidence` values: `verified` (you read the provider's live page today),
`cached` (transcribed from documentation of a known date), `derived` (computed from
other verified fields), `unverified` (reseller data).

## Measuring a tokenizer

The highest-leverage contribution, and it needs no API key.

1. Run the shared corpus through the tokenizer locally (`tiktoken`, `tokenizers`,
   a published vocab file — whatever the provider ships).
2. Record `tokens_per_1k_chars` in the overlay.
3. Leave `cost_index` alone; the build derives it against the reference tokenizer.

Cite which tokenizer build you used. Vocabularies change between model generations —
that is the entire finding.

## Before opening a PR

```bash
node src/build.mjs && node src/validate.mjs
```

Both must pass. Warnings are acceptable and often interesting; errors are not.

Do not hand-edit `data/models.json` — it is generated. Edit an overlay.

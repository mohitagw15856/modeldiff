// OpenRouter's public model endpoint: free, unauthenticated, ~400 models.
// It is the widest machine-readable spine available at zero cost, but it is a
// RESELLER's view. Two things it cannot tell us, which overlays must supply:
//   1. First-party list price (OpenRouter may mark up, discount, or route).
//   2. Whether an absent parameter is *rejected* by the provider or merely
//      not surfaced by OpenRouter. We never infer rejection from absence.

export const SOURCE_ID = 'openrouter';
export const SOURCE_URL = 'https://openrouter.ai/api/v1/models';

// Sentinel far-future dates used as "no expiry". Treating these as real
// shutdown dates would poison the deprecation feed.
const SENTINEL_YEAR = 2090;

// The parameter universe we track. Absent from this list => not tracked.
export const PARAM_UNIVERSE = [
  'temperature', 'top_p', 'top_k', 'min_p', 'top_a',
  'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'logit_bias',
  'seed', 'stop', 'max_tokens', 'max_completion_tokens',
  'logprobs', 'top_logprobs',
  'tools', 'tool_choice', 'parallel_tool_calls',
  'response_format', 'structured_outputs',
  'reasoning', 'reasoning_effort', 'include_reasoning', 'verbosity',
  'prediction', 'web_search_options',
];

const PRICE_MAP = {
  prompt: 'input',
  completion: 'output',
  input_cache_read: 'cache_read',
  input_cache_write: 'cache_write_5m',
  input_cache_write_1h: 'cache_write_1h',
  internal_reasoning: 'reasoning',
  image: 'image_input',
  audio: 'audio_input',
};

// OpenRouter quotes USD per single token as a string. Convert to USD per 1M.
function perMillion(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Round to 6dp to kill float noise like 0.8340000000000001
  return Math.round(n * 1e6 * 1e6) / 1e6;
}

function shutdownDate(raw) {
  if (!raw) return null;
  const year = Number(String(raw).slice(0, 4));
  if (!Number.isFinite(year) || year >= SENTINEL_YEAR) return null;
  return raw;
}

export function normalise(payload, fetchedAt) {
  const rows = payload?.data ?? [];
  return rows.map((m) => {
    const arch = m.architecture ?? {};
    const top = m.top_provider ?? {};
    const reasoning = m.reasoning ?? {};

    const standard = {};
    for (const [from, to] of Object.entries(PRICE_MAP)) {
      standard[to] = perMillion(m.pricing?.[from]);
    }

    const declared = new Set(m.supported_parameters ?? []);
    const params = {};
    for (const p of PARAM_UNIVERSE) {
      // Present => the provider accepts it. Absent => we genuinely do not know
      // whether it 400s or is silently ignored. Only a first-party overlay may
      // promote 'unknown' to 'rejected'.
      params[p] = declared.has(p) ? 'supported' : 'unknown';
    }

    const features = {
      reasoning: reasoning.mandatory
        ? 'supported'
        : declared.has('reasoning')
          ? 'supported'
          : 'unknown',
      tool_use: declared.has('tools') ? 'supported' : 'unknown',
      structured_outputs: declared.has('structured_outputs') ? 'supported' : 'unknown',
      prompt_caching: standard.cache_read !== null ? 'supported' : 'unknown',
    };

    const notes = [];
    if (reasoning.mandatory) notes.push('Reasoning is always on and cannot be disabled.');
    if (standard.reasoning !== null) {
      notes.push('Internal reasoning tokens are billed as a separate line item, not as output.');
    }
    if (standard.cache_read !== null && standard.cache_write_5m === null) {
      notes.push('Cache reads are priced but cache writes are not published; true cache economics are unknown.');
    }

    return {
      id: m.id,
      provider: m.id.split('/')[0],
      display_name: m.name ?? m.id,
      lifecycle: {
        status: /preview|-beta|:free/.test(m.id) ? 'preview' : 'ga',
        released: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null,
        knowledge_cutoff: m.knowledge_cutoff ?? null,
        deprecation_announced: null,
        shutdown_date: shutdownDate(m.expiration_date),
        successor: null,
      },
      context: {
        input_max: m.context_length ?? top.context_length ?? null,
        output_max: top.max_completion_tokens ?? null,
      },
      pricing: {
        currency: 'USD',
        unit: 'usd_per_1m_tokens',
        // Only a first-party overlay may assert this; the reseller field is ambiguous.
        cache_model: 'unknown',
        modes: { standard },
      },
      tokenizer: {
        family: arch.tokenizer ?? 'Unknown',
        encoding: null,
        tokens_per_1k_chars: null,
        cost_index: null,
      },
      params,
      features,
      notes,
      provenance: [
        {
          source: SOURCE_ID,
          fields: ['pricing.modes.standard', 'context', 'tokenizer.family', 'params', 'features'],
          confidence: 'unverified',
          as_of: fetchedAt,
        },
      ],
    };
  });
}

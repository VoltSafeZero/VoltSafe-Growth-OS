/**
 * openai-compat.ts
 *
 * Compatibility helpers for OpenAI API parameter differences between model
 * generations.
 *
 * o-series, gpt-5*, gpt-4.1*, and any model whose name starts with "o":
 *   - Use `max_completion_tokens` instead of the legacy `max_tokens`.
 *   - Do NOT support custom `temperature`, `top_p`, `frequency_penalty`, or
 *     `presence_penalty` values. Sending any of these causes a 400 error.
 *
 * Preferred usage — one spread at each call site:
 *
 *   openai.chat.completions.create({
 *     model,
 *     messages,
 *     ...buildOpenAIModelParams(model, { tokenLimit: 1200, temperature: 0.4 }),
 *   });
 */

function isNewerModel(model: string): boolean {
  const n = (model || "").toLowerCase();
  return (
    n.startsWith("o") ||
    n.includes("gpt-5") ||
    n.includes("gpt-4.1") ||
    n.includes("reasoning")
  );
}

// ── Legacy individual helpers (kept for backward compatibility) ────────────────

/**
 * Returns the correct token-limit parameter object for a given model.
 * Prefer `buildOpenAIModelParams` for new code.
 */
export function getTokenLimitParam(
  model: string,
  value: number | undefined,
): { max_completion_tokens: number } | { max_tokens: number } | Record<string, never> {
  if (!value) return {};
  return isNewerModel(model)
    ? { max_completion_tokens: value }
    : { max_tokens: value };
}

/**
 * Returns true when the model accepts a custom temperature value.
 * Newer/reasoning models only support the default temperature (1).
 */
export function supportsCustomTemperature(model: string): boolean {
  return !isNewerModel(model);
}

/**
 * Returns `{ temperature: value }` for models that support it, or `{}`.
 * Prefer `buildOpenAIModelParams` for new code.
 */
export function getTemperatureParam(
  model: string,
  value?: number,
): { temperature: number } | Record<string, never> {
  if (value === undefined || value === null) return {};
  if (!supportsCustomTemperature(model)) return {};
  return { temperature: value };
}

// ── Unified helper ─────────────────────────────────────────────────────────────

export interface OpenAIModelOptions {
  /** Maps to max_completion_tokens (newer) or max_tokens (legacy). */
  tokenLimit?: number;
  /** Omitted entirely for newer models that only accept the default (1). */
  temperature?: number;
  /** Omitted for newer models. */
  topP?: number;
  /** Omitted for newer models. */
  frequencyPenalty?: number;
  /** Omitted for newer models. */
  presencePenalty?: number;
}

/**
 * Builds the generation-parameter object for an OpenAI chat completion call,
 * automatically omitting or renaming params that are unsupported by newer
 * model families.
 *
 * Spread directly into `openai.chat.completions.create({...})`:
 *
 *   openai.chat.completions.create({
 *     model,
 *     messages,
 *     ...buildOpenAIModelParams(model, { tokenLimit: 1200, temperature: 0.4 }),
 *   });
 *
 * For gpt-5*, o-series, gpt-4.1*, reasoning:
 *   - tokenLimit  → max_completion_tokens
 *   - temperature, topP, frequencyPenalty, presencePenalty → omitted
 *
 * For legacy models (gpt-4o, gpt-3.5, etc.):
 *   - tokenLimit  → max_tokens
 *   - all sampling params passed through as-is
 */
export function buildOpenAIModelParams(
  model: string,
  options: OpenAIModelOptions = {},
): Record<string, number> {
  const newer = isNewerModel(model);
  const result: Record<string, number> = {};

  // Token limit
  if (options.tokenLimit) {
    if (newer) {
      result.max_completion_tokens = options.tokenLimit;
    } else {
      result.max_tokens = options.tokenLimit;
    }
  }

  // Sampling params — not supported on newer models
  if (!newer) {
    if (options.temperature !== undefined && options.temperature !== null) {
      result.temperature = options.temperature;
    }
    if (options.topP !== undefined && options.topP !== null) {
      result.top_p = options.topP;
    }
    if (options.frequencyPenalty !== undefined && options.frequencyPenalty !== null) {
      result.frequency_penalty = options.frequencyPenalty;
    }
    if (options.presencePenalty !== undefined && options.presencePenalty !== null) {
      result.presence_penalty = options.presencePenalty;
    }
  }

  return result;
}

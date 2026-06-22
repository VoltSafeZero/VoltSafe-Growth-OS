/**
 * openai-compat.ts
 *
 * Compatibility helpers for OpenAI API parameter differences between model
 * generations.
 *
 * o-series, gpt-5*, gpt-4.1*, and any model whose name starts with "o":
 *   - Use `max_completion_tokens` instead of the legacy `max_tokens`.
 *   - Do NOT support custom `temperature` values (only the default of 1 is
 *     accepted). Sending any other value causes a 400 error.
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

/**
 * Returns the correct token-limit parameter object for a given model.
 *
 * Usage:
 *   openai.chat.completions.create({
 *     model,
 *     messages,
 *     ...getTokenLimitParam(model, 1200),
 *   });
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
 * Returns `{ temperature: value }` for models that support it, or `{}` for
 * models that only accept the default.
 *
 * Usage:
 *   openai.chat.completions.create({
 *     model,
 *     messages,
 *     ...getTemperatureParam(model, 0.4),
 *   });
 */
export function getTemperatureParam(
  model: string,
  value?: number,
): { temperature: number } | Record<string, never> {
  if (value === undefined || value === null) return {};
  if (!supportsCustomTemperature(model)) return {};
  return { temperature: value };
}

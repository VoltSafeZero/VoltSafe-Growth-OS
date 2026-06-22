/**
 * openai-compat.ts
 *
 * Compatibility helpers for OpenAI API parameter differences between model
 * generations.
 *
 * o-series, gpt-5*, gpt-4.1*, and any model whose name starts with "o" use
 * `max_completion_tokens` instead of the legacy `max_tokens`.  Passing the
 * wrong parameter causes a 400 error.
 */

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
  const usesMaxCompletionTokens =
    model.startsWith("o") ||
    model.includes("gpt-5") ||
    model.includes("gpt-4.1") ||
    model.includes("reasoning");
  return usesMaxCompletionTokens
    ? { max_completion_tokens: value }
    : { max_tokens: value };
}

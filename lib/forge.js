/**
 * "炼化" — turn a rough request into a reusable, structured prompt.
 *
 * The forge is a single non-streaming-to-the-user model call whose only job is
 * to return the rewritten prompt. It deliberately has no tools and no session
 * history: a refined prompt must be self-contained to be reusable.
 *
 * @module dsh-quickprompt/forge
 */

/** Default instruction used when the plugin config does not override it. */
export const DEFAULT_FORGE_SYSTEM_PROMPT = [
  '你是一位提示词工程师。把用户的一句粗糙需求，炼化成一段可以直接交给 AI 执行的高质量 Prompt。',
  '要求：',
  '1. 只输出最终 Prompt 本身，不要解释、不要寒暄、不要 Markdown 代码围栏。',
  '2. 结构清晰，按需包含：角色、目标、背景/输入、执行步骤、约束与边界、输出格式。',
  '3. 保留用户原话里的关键事实与专有名词；不臆造用户没提供的信息，缺失处用 {{占位符}} 标注。',
  '4. 用中文书写，除非用户需求本身指定了其他语言。',
  '5. 控制在 400 字以内，避免空话和套话，让执行者读完就能直接开工。',
].join('\n')

/**
 * Build the request body sent to the model.
 * @param {string} rough - the user's raw request.
 * @returns {Array<{role: 'user', content: Array<{type: 'text', text: string}>}>} chat messages.
 */
export function buildForgeMessages(rough) {
  return [{ role: 'user', content: [{ type: 'text', text: String(rough ?? '').trim() }] }]
}

/**
 * Aggregate a `ctx.llm.stream()` iterable into one string.
 *
 * Text deltas are concatenated; a terminal error chunk throws so the caller can
 * surface a real failure instead of an empty prompt.
 *
 * @param {AsyncIterable<object>} stream - chunks from `ctx.llm.stream`.
 * @returns {Promise<string>} the accumulated text.
 */
export async function collectForgeText(stream) {
  let text = ''
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
      text += chunk.text
      continue
    }
    if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
      const failure = chunk.reason.error
      const message = failure?.message ?? failure?.code ?? '模型调用失败'
      throw new Error(String(message))
    }
  }
  return text.trim()
}

/**
 * Pure prompt-template helpers for QuickPrompt.
 *
 * A template is ordinary text with `{{name}}` or `{{name:default}}` slots.
 * `\{{` escapes a slot so it stays literal. Nothing here touches the Host,
 * so the whole module is unit-tested with plain `node --test`.
 *
 * @module dsh-quickprompt/render
 */

/** Matches an optional escape backslash followed by one slot. */
const SLOT_PATTERN = /\\?\{\{\s*([A-Za-z0-9_.\-\u4e00-\u9fa5]+)\s*(?::\s*([^}]*))?\}\}/g

/**
 * List the slots a template declares, in first-appearance order.
 * @param {string} body - template text.
 * @returns {Array<{name: string, defaultValue: string | undefined}>} declared slots.
 */
export function parseVariables(body) {
  const seen = new Set()
  const declared = []
  const source = String(body ?? '')
  SLOT_PATTERN.lastIndex = 0
  let match
  while ((match = SLOT_PATTERN.exec(source)) !== null) {
    if (match[0].startsWith('\\')) continue
    const name = match[1]
    if (seen.has(name)) continue
    seen.add(name)
    declared.push({ name, defaultValue: match[2] })
  }
  return declared
}

/**
 * Fill a template from a value map.
 *
 * Missing slots without a default are reported instead of being guessed, and
 * the returned text keeps the original placeholder so the caller can show it.
 *
 * @param {string} body - template text.
 * @param {Record<string, string>} [values] - slot values by name.
 * @returns {{ok: boolean, text: string, missing: string[]}} render outcome.
 */
export function renderTemplate(body, values = {}) {
  const missing = []
  const source = String(body ?? '')
  SLOT_PATTERN.lastIndex = 0
  const text = source.replace(SLOT_PATTERN, (whole, name, defaultValue) => {
    if (whole.startsWith('\\')) return whole.slice(1)
    const supplied = values[name]
    if (supplied !== undefined && supplied !== '') return supplied
    if (defaultValue !== undefined) return defaultValue
    if (!missing.includes(name)) missing.push(name)
    return whole
  })
  return { ok: missing.length === 0, text, missing }
}

/**
 * Split command arguments into named and positional parts.
 *
 * Quoted segments stay whole (and may sit on either side of `k=`). `k=v`
 * becomes named; everything else is positional in the order it appeared.
 *
 * @param {string} raw - argument text after the command name.
 * @returns {{named: Record<string, string>, positional: string[]}} parsed arguments.
 */
export function parseArgs(raw) {
  const named = {}
  const positional = []
  const source = String(raw ?? '')
  let index = 0
  while (index < source.length) {
    while (index < source.length && /\s/u.test(source[index])) index += 1
    if (index >= source.length) break
    let token = ''
    while (index < source.length && !/\s/u.test(source[index])) {
      const quote = source[index]
      if (quote === '"' || quote === "'") {
        index += 1
        while (index < source.length && source[index] !== quote) {
          token += source[index]
          index += 1
        }
        index += 1
        continue
      }
      token += source[index]
      index += 1
    }
    if (!token) continue
    const equals = token.indexOf('=')
    if (equals > 0) named[token.slice(0, equals)] = token.slice(equals + 1)
    else positional.push(token)
  }
  return { named, positional }
}

/**
 * Map positional arguments onto declared slots in order, letting `k=v` win.
 * @param {Array<{name: string}>} declared - slots from {@link parseVariables}.
 * @param {{named: Record<string, string>, positional: string[]}} parsed - from {@link parseArgs}.
 * @returns {{values: Record<string, string>, consumed: number}} slot values and how many positional arguments were used.
 */
export function bindArguments(declared, parsed) {
  const values = { ...parsed.named }
  let consumed = 0
  for (const slot of declared) {
    if (values[slot.name] !== undefined) continue
    if (consumed >= parsed.positional.length) break
    values[slot.name] = parsed.positional[consumed]
    consumed += 1
  }
  return { values, consumed }
}

/**
 * Turn a human name into a slash-command suffix.
 * @param {string} name - prompt name or title.
 * @returns {string} a command-safe slug, possibly empty.
 */
export function toCommandSlug(name) {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[/\\:#]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

/**
 * Render one saved prompt for display or execution.
 * @param {{name: string, body: string}} record - saved prompt.
 * @param {string} rawArgs - argument text after the command.
 * @param {{appendExtra?: boolean}} [options] - append unmatched positional text as context.
 * @returns {{ok: boolean, text: string, missing: string[]}} render outcome.
 */
export function renderPrompt(record, rawArgs, options = {}) {
  const body = String(record?.body ?? '')
  const declared = parseVariables(body)
  const parsed = parseArgs(rawArgs)
  const { values, consumed } = bindArguments(declared, parsed)
  const rendered = renderTemplate(body, values)
  const extra = parsed.positional.slice(consumed).join(' ')
  if (rendered.ok && extra && options.appendExtra !== false) {
    return { ...rendered, text: `${rendered.text}\n\n${extra}` }
  }
  return rendered
}

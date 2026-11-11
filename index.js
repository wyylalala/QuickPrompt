/**
 * QuickPrompt — 炼化 Prompt 并一键执行。
 *
 * One `/qp` command family owns a small prompt library stored as JSON under
 * `$DSH_HOME/quickprompt/prompts.json`. Saved prompts become their own
 * `${prefix}-<slug>` slash commands, so running one is a keystroke instead of
 * copy-paste. The model can read and write the same library through the
 * `quick_prompt` tool.
 *
 * @module dsh-quickprompt
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import { createFileStore } from './lib/store.js'
import { DEFAULT_FORGE_SYSTEM_PROMPT, buildForgeMessages, collectForgeText } from './lib/forge.js'
import { parseVariables, renderPrompt } from './lib/render.js'

/** Cordis plugin name. */
export const name = 'quickprompt'

/** Services this plugin cannot work without. */
export const inject = ['commands', 'tools', 'llm']

/** Command-name grammar enforced by the command registry. */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u

/** Default prefix for every command this plugin owns. */
const DEFAULT_PREFIX = 'qp'

/**
 * Read one plugin config value with a default.
 * @param {Record<string, unknown>} config - plugin row config.
 * @param {string} key - config key.
 * @param {unknown} fallback - value used when the key is absent.
 * @returns {unknown} the configured value.
 */
function readConfig(config, key, fallback) {
  const value = config?.[key]
  return value === undefined || value === null ? fallback : value
}

/**
 * Render a compact list of saved prompts.
 * @param {object[]} records - library records.
 * @param {string} prefix - command prefix.
 * @returns {string} human-readable list.
 */
function formatList(records, prefix) {
  if (records.length === 0) {
    return [
      `库还是空的。`,
      `用法：/${prefix} forge <一句粗糙需求> 炼化，然后 /${prefix} save <英文slug> 保存。`,
      `保存后会得到一条专属命令，例如 /${prefix}-weekly。`,
    ].join('\n')
  }
  const lines = records.map((record) => {
    const slots = parseVariables(record.body)
    const used = record.usageCount ? ` · 用过 ${record.usageCount} 次` : ''
    const vars = slots.length ? ` · 变量: ${slots.map((slot) => slot.name).join(', ')}` : ''
    return `/${prefix}-${record.name}  ${record.title}${vars}${used}`
  })
  return ['已保存的提示词：', ...lines, '', '直接输入其中一条命令即可执行；/qp show <slug> 查看原文。'].join('\n')
}

/**
 * Build the help text.
 * @param {string} prefix - command prefix.
 * @returns {string} usage text.
 */
function formatHelp(prefix) {
  return [
    'QuickPrompt — 炼化 Prompt 并一键执行',
    '',
    `/${prefix} list                 列出已保存的提示词`,
    `/${prefix} show <slug>          查看原文与变量`,
    `/${prefix} forge <粗糙需求>     调用模型炼化成结构化 Prompt`,
    `/${prefix} save <slug> [--title=标题] [--desc=描述]   保存最近一次炼化`,
    `/${prefix} run <slug> [k=v ...] 渲染并立即执行`,
    `/${prefix} rm <slug> --yes      删除`,
    `/${prefix} path                 显示库文件位置`,
    '',
    `也可以直接把需求写在命令后面：/${prefix} 帮我写一份周报（等价于 /${prefix} forge 帮我写一份周报）。`,
    `保存后会自动生成 /${prefix}-<slug>，例如 /${prefix}-weekly，直接执行即可。`,
    '模板支持 {{变量}} 与 {{变量:默认值}}；参数既可写 主题=Q4 也可按顺序给。',
  ].join('\n')
}

/**
 * Resolve the library path from config or the harness home.
 * @param {Record<string, unknown>} config - plugin config.
 * @returns {string} absolute path.
 */
function resolveLibraryPath(config) {
  const configured = readConfig(config, 'libraryPath', '')
  if (typeof configured === 'string' && configured.trim()) return configured
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'quickprompt', 'prompts.json')
}

/**
 * Register commands, tools, and the prompt library.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {Record<string, unknown>} config - plugin row config.
 */
export function apply(ctx, config = {}) {
  const prefix = (() => {
    const candidate = String(readConfig(config, 'commandPrefix', DEFAULT_PREFIX)).toLowerCase()
    return COMMAND_NAME.test(candidate) ? candidate : DEFAULT_PREFIX
  })()
  const autoRun = readConfig(config, 'autoRun', true) !== false
  const maxPromptChars = Number(readConfig(config, 'maxPromptChars', 8000)) || 8000
  const maxPromptCommands = Number(readConfig(config, 'maxPromptCommands', 50)) || 50
  const forgeSystemPrompt = String(readConfig(config, 'forgeSystemPrompt', DEFAULT_FORGE_SYSTEM_PROMPT))
  const forgeModel = readConfig(config, 'forgeModel', undefined)

  const store = createFileStore({ file: resolveLibraryPath(config), logger: ctx.logger })
  try {
    store.load()
  } catch (error) {
    ctx.logger?.warn?.(`quickprompt: 载入库失败: ${error?.message ?? error}`)
  }

  /** Most recent forge result per session, so `/qp save` never needs retyping. */
  const lastForged = new Map()
  /** Disposers of the per-prompt commands, rebuilt whenever the library changes. */
  const dynamicCommands = new Map()

  /**
   * Report one prompt execution without failing the command.
   * @param {string} slug - prompt name.
   */
  function markUsed(slug) {
    try {
      store.markUsed(slug)
    } catch (error) {
      ctx.logger?.warn?.(`quickprompt: 记录使用次数失败: ${error?.message ?? error}`)
    }
  }

  /**
   * Deliver one rendered prompt into the calling session and wake it.
   * @param {{followup: Function}} agent - calling agent.
   * @param {string} text - rendered prompt.
   */
  function deliver(agent, text) {
    if (!agent || typeof agent.followup !== 'function') {
      throw new Error('当前会话不可用，无法执行 Prompt')
    }
    agent.followup({
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    })
  }

  /**
   * Run one saved prompt with the raw argument string.
   * @param {object} invocation - command invocation.
   * @param {string} slug - prompt name.
   * @param {string} rawInput - argument text.
   * @returns {{kind: string, text: string}} command result.
   */
  function runPrompt(invocation, slug, rawInput) {
    const record = store.get(slug)
    if (!record) return { kind: 'error', text: `没有名为 ${slug} 的提示词，先 /${prefix} list 看看。` }
    const rendered = renderPrompt(record, rawInput)
    if (!rendered.ok) {
      return {
        kind: 'error',
        text: `缺少变量：${rendered.missing.join(', ')}。用法：/${prefix}-${slug} ${rendered.missing.map((item) => `${item}=...`).join(' ')}`,
      }
    }
    if (!autoRun) {
      markUsed(slug)
      return { kind: 'success', text: `autoRun 已关闭，下面是渲染结果：\n\n${rendered.text}` }
    }
    try {
      deliver(invocation.agent, rendered.text)
    } catch (error) {
      return { kind: 'error', text: `发送失败：${error?.message ?? error}` }
    }
    markUsed(slug)
    const count = rendered.text.length
    return { kind: 'success', text: `已发送「${record.title || slug}」（${count} 字），会话已开始执行。` }
  }

  /**
   * Forge one rough request into a structured prompt.
   * @param {string} rough - user's raw request.
   * @param {AbortSignal} [signal] - cancellation.
   * @returns {Promise<string>} the refined prompt.
   */
  async function forge(rough, signal) {
    const trimmed = String(rough ?? '').trim()
    if (!trimmed) throw new Error('先给一句粗糙需求，例如：/qp forge 帮我写一份周报')
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.() ?? {}
    const provider = forgeModel?.provider || selection.provider
    const model = forgeModel?.model || selection.model
    if (!provider || !model) throw new Error('没有可用的默认模型，请先在设置里选择一个模型')
    const stream = ctx.llm.stream({
      provider,
      model,
      system: forgeSystemPrompt,
      messages: buildForgeMessages(trimmed),
      temperature: 0.4,
      ...(signal ? { signal } : {}),
    })
    const text = await collectForgeText(stream)
    if (!text) throw new Error('模型没有返回内容，请重试')
    return text.length > maxPromptChars ? text.slice(0, maxPromptChars) : text
  }

  /**
   * Save the most recently forged prompt under a slug.
   * @param {{agent?: {id: string}}} invocation - command invocation.
   * @param {string} slug - ASCII prompt name.
   * @param {{title?: string, description?: string}} meta - display metadata.
   * @returns {{kind: string, text: string}} command result.
   */
  function saveLastForged(invocation, slug, meta = {}) {
    const key = invocation?.agent?.id ?? 'default'
    const last = lastForged.get(key)
    if (!last) {
      return { kind: 'error', text: `还没有可保存的内容。先 /${prefix} forge <一句粗糙需求> 炼化一次。` }
    }
    const normalized = String(slug ?? '').trim().toLowerCase()
    if (!COMMAND_NAME.test(normalized)) {
      return { kind: 'error', text: `slug 只能用英文小写字母开头，包含 a-z 0-9 - _，例如 weekly 或 baogao-1。` }
    }
    if (!COMMAND_NAME.test(`${prefix}-${normalized}`)) {
      return { kind: 'error', text: `slug 过长或含非法字符。` }
    }
    try {
      store.save({
        name: normalized,
        title: meta.title || last.rough.slice(0, 24),
        description: meta.description || `炼化自：${last.rough.slice(0, 60)}`,
        body: last.text,
      })
    } catch (error) {
      return { kind: 'error', text: `保存失败：${error?.message ?? error}` }
    }
    refreshDynamicCommands()
    lastForged.delete(key)
    return {
      kind: 'success',
      text: `已保存「${meta.title || normalized}」。以后输入 /${prefix}-${normalized} 即可一键执行。`,
    }
  }

  /** Tear down and rebuild one command per saved prompt. */
  function refreshDynamicCommands() {
    for (const dispose of dynamicCommands.values()) {
      try {
        dispose()
      } catch {
        /* already disposed with the registry */
      }
    }
    dynamicCommands.clear()
    const records = store.list().slice(0, maxPromptCommands)
    for (const record of records) {
      const commandName = `${prefix}-${record.name}`
      if (!COMMAND_NAME.test(commandName) || dynamicCommands.has(commandName)) continue
      try {
        const dispose = ctx.commands.register({
          name: commandName,
          description: record.description || record.title || `QuickPrompt: ${record.name}`,
          input: { hint: parseVariables(record.body).map((slot) => `${slot.name}=...`).join(' ') || '(无参数)' },
          handler: (invocation) => runPrompt(invocation, record.name, invocation.rawInput),
        })
        dynamicCommands.set(commandName, dispose)
      } catch (error) {
        ctx.logger?.warn?.(`quickprompt: 注册 ${commandName} 失败: ${error?.message ?? error}`)
      }
    }
  }

  /** Parse `--key=value` flags out of the argument text. */
  function readFlags(rawInput) {
    const flags = {}
    const tokens = String(rawInput ?? '').match(/--[a-z-]+=[^\s]*|"[^"]*"|'[^']*'|\S+/giu) ?? []
    const rest = []
    for (const token of tokens) {
      const match = /^--([a-z-]+)=([\s\S]*)$/iu.exec(token)
      if (match) {
        flags[match[1]] = match[2].replace(/^["']|["']$/g, '')
        continue
      }
      rest.push(token)
    }
    return { flags, rest: rest.join(' ') }
  }

  /**
   * Forge one request and report it, saving immediately when `--save` was given.
   * @param {object} invocation - command invocation.
   * @param {string} argument - the raw request text.
   * @param {Record<string, string>} [flags] - parsed `--key=value` flags.
   * @returns {Promise<{kind: string, text: string}>} command result.
   */
  async function forgeAndReport(invocation, argument, flags = {}) {
    try {
      const text = await forge(argument, invocation.signal)
      lastForged.set(invocation.agent?.id ?? 'default', { text, rough: argument, at: Date.now() })
      const saveAs = typeof flags.save === 'string' ? flags.save : ''
      if (saveAs) {
        return saveLastForged(invocation, saveAs, { title: typeof flags.title === 'string' ? flags.title : undefined })
      }
      return {
        kind: 'success',
        text: `炼化完成：\n\n${text}\n\n下一步：/${prefix} save <slug> 保存为快捷命令，或 /${prefix} run <slug> 使用已保存的条目。`,
      }
    } catch (error) {
      return { kind: 'error', text: `炼化失败：${error?.message ?? error}` }
    }
  }

  // The manager command.
  ctx.effect(() => ctx.commands.register({
    name: prefix,
    description: '炼化 Prompt 并一键执行：保存常用提示词为快捷命令',
    input: { hint: '<一句需求> | list | show <slug> | forge <需求> | save <slug> | run <slug> | rm <slug> | path' },
    handler: async (invocation) => {
      const { flags, rest } = readFlags(invocation.rawInput)
      const trimmed = rest.trim()
      const [subcommand, ...tail] = trimmed.split(/\s+/u)
      const argument = tail.join(' ')
      const known = ['help', 'list', 'show', 'forge', 'save', 'run', 'rm', 'remove', 'path']
      const key = (subcommand ?? '').toLowerCase()
      // 直接把一句需求写在 /qp 后面时，等价于 /qp forge <需求>。
      if (trimmed.length > 0 && !known.includes(key)) {
        return forgeAndReport(invocation, trimmed, flags)
      }
      switch (key || 'help') {
        case 'help':
          return { kind: 'success', text: formatHelp(prefix) }
        case 'list':
          return { kind: 'success', text: formatList(store.list(), prefix) }
        case 'show': {
          const record = store.get(argument.trim())
          if (!record) return { kind: 'error', text: `没有名为 ${argument.trim()} 的提示词。` }
          const slots = parseVariables(record.body)
          return {
            kind: 'success',
            text: [
              `# ${record.title} (/${prefix}-${record.name})`,
              record.description ? `> ${record.description}` : '',
              slots.length ? `变量：${slots.map((slot) => slot.name).join(', ')}` : '变量：无',
              '',
              record.body,
            ].filter((line) => line !== '').join('\n'),
          }
        }
        case 'forge':
          return forgeAndReport(invocation, argument, flags)

        case 'save': {
          const slug = (tail[0] ?? '').trim()
          if (!slug) return { kind: 'error', text: `用法：/${prefix} save <slug> [--title=标题] [--desc=描述]` }
          return saveLastForged(invocation, slug, {
            title: typeof flags.title === 'string' ? flags.title : undefined,
            description: typeof flags.desc === 'string' ? flags.desc : undefined,
          })
        }
        case 'run': {
          const slug = (tail[0] ?? '').trim()
          if (!slug) return { kind: 'error', text: `用法：/${prefix} run <slug> [变量=值 ...]` }
          return runPrompt(invocation, slug, tail.slice(1).join(' '))
        }
        case 'rm':
        case 'remove': {
          const slug = (tail[0] ?? '').trim()
          if (!slug) return { kind: 'error', text: `用法：/${prefix} rm <slug> --yes` }
          if (flags.yes === undefined) return { kind: 'error', text: `确认删除请加 --yes：/${prefix} rm ${slug} --yes` }
          const removed = store.remove(slug)
          if (!removed) return { kind: 'error', text: `没有名为 ${slug} 的提示词。` }
          refreshDynamicCommands()
          return { kind: 'success', text: `已删除 ${slug}，对应命令 /${prefix}-${slug} 已移除。` }
        }
        case 'path':
          return { kind: 'success', text: `库文件：${store.file}` }
        default:
          return { kind: 'error', text: `未知子命令 ${subcommand}。\n\n${formatHelp(prefix)}` }
      }
    },
  }), 'quickprompt manager command')

  // One command per saved prompt, rebuilt on every library change.
  ctx.effect(() => {
    refreshDynamicCommands()
    return () => {
      for (const dispose of dynamicCommands.values()) {
        try {
          dispose()
        } catch {
          /* registry cleanup is idempotent */
        }
      }
      dynamicCommands.clear()
    }
  }, 'quickprompt dynamic commands')

  // Model-facing access to the same library.
  ctx.effect(() => ctx.tools.register({
    name: 'quick_prompt',
    description: [
      'Read and manage the user\'s saved QuickPrompt library: list prompts, read one, save a new prompt, delete one, run a saved prompt in the current session, or forge a rough request into a structured prompt.',
      'Use `run` when the user asks to execute one of their saved prompts; the rendered prompt is delivered to the user\'s session and starts a turn.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'save', 'delete', 'run', 'forge'],
          description: 'Operation to perform on the prompt library.',
        },
        name: {
          type: 'string',
          description: 'Prompt slug (ASCII a-z 0-9 - _) for get/save/delete/run.',
        },
        title: {
          type: 'string',
          description: 'Human-readable title shown in listings (save).',
        },
        body: {
          type: 'string',
          description: 'Prompt template text, may contain {{variable}} slots (save).',
        },
        args: {
          type: 'string',
          description: 'Space-separated k=v values for the template slots (run).',
        },
        request: {
          type: 'string',
          description: 'Rough user request to refine into a structured prompt (forge).',
        },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', description: 'Human-readable result.' },
        },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: String(value.text ?? '') }],
    },
    async execute(args, exec) {
      switch (args?.action) {
        case 'list':
          return { text: formatList(store.list(), prefix) }
        case 'get': {
          const record = store.get(args?.name)
          if (!record) return { text: `没有名为 ${args?.name} 的提示词。` }
          return { text: record.body }
        }
        case 'save': {
          const slug = String(args?.name ?? '').trim().toLowerCase()
          if (!COMMAND_NAME.test(slug)) return { text: 'slug 必须以小写字母开头，只含 a-z 0-9 - _。' }
          if (typeof args?.body !== 'string' || !args.body.trim()) return { text: 'body 不能为空。' }
          store.save({
            name: slug,
            title: args?.title || slug,
            description: `由 quick_prompt 工具保存`,
            body: args.body,
          })
          refreshDynamicCommands()
          return { text: `已保存 /${prefix}-${slug}。` }
        }
        case 'delete': {
          const removed = store.remove(args?.name)
          if (!removed) return { text: `没有名为 ${args?.name} 的提示词。` }
          refreshDynamicCommands()
          return { text: `已删除 ${args?.name}。` }
        }
        case 'run': {
          const record = store.get(args?.name)
          if (!record) return { text: `没有名为 ${args?.name} 的提示词。` }
          const rendered = renderPrompt(record, args?.args ?? '')
          if (!rendered.ok) return { text: `缺少变量：${rendered.missing.join(', ')}` }
          markUsed(record.name)
          return {
            text: `已渲染「${record.title || record.name}」，请按下面的提示词直接执行：\n\n${rendered.text}`,
            ...(exec?.agent ? {} : {}),
          }
        }
        case 'forge': {
          try {
            return { text: await forge(args?.request, undefined) }
          } catch (error) {
            return { text: `炼化失败：${error?.message ?? error}` }
          }
        }
        default:
          return { text: `未知 action：${String(args?.action)}` }
      }
    },
  }), 'quickprompt tool')
}

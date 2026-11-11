import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply } from '../index.js'

/** Minimal Host surface used by the plugin, with real registries we can inspect. */
function createHarness({ file, forged = '角色：周报助手\n主题：{{主题}}' } = {}) {
  const commands = new Map()
  const tools = new Map()
  const sent = []
  const ctx = {
    logger: { warn() {} },
    effect(callback) {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }) }
      }
      return undefined
    },
    commands: {
      register(definition) {
        if (commands.has(definition.name)) throw new Error(`duplicate command ${definition.name}`)
        commands.set(definition.name, definition)
        return () => commands.delete(definition.name)
      },
    },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    llm: {
      async *stream() {
        yield { type: 'text-delta', text: forged }
        yield { type: 'finish', reason: { kind: 'complete' } }
      },
    },
  }
  const agent = {
    id: 'session-1',
    followup(message) {
      sent.push(message)
    },
  }
  const signal = new AbortController().signal
  return { ctx, commands, tools, agent, sent, signal, file }
}

test('a plain request after /qp forges and runs it, --dry only forges', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quickprompt-plugin-'))
  const file = join(directory, 'prompts.json')
  try {
    const harness = createHarness({ file })
    apply(harness.ctx, { libraryPath: file })
    const manager = harness.commands.get('qp')

    const ran = await manager.handler({ agent: harness.agent, rawInput: '帮我写份周报', signal: harness.signal })
    assert.equal(ran.kind, 'success')
    assert.match(ran.text, /已炼化并开始执行/)
    assert.equal(harness.sent.length, 1)
    assert.match(harness.sent[0].content[0].text, /角色：周报助手/)

    const saved = await manager.handler({ agent: harness.agent, rawInput: 'save weekly', signal: harness.signal })
    assert.equal(saved.kind, 'success')
    assert.ok(harness.commands.has('qp-weekly'))

    const dry = await manager.handler({ agent: harness.agent, rawInput: '帮我写份周报 --dry', signal: harness.signal })
    assert.match(dry.text, /角色：周报助手/)
    assert.equal(harness.sent.length, 1, '--dry must not send')

    const removed = await manager.handler({ agent: harness.agent, rawInput: 'rm weekly --yes', signal: harness.signal })
    assert.equal(removed.kind, 'success')
    assert.equal(harness.commands.has('qp-weekly'), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('forge → save → dynamic command → run delivers one user message', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quickprompt-plugin-'))
  const file = join(directory, 'prompts.json')
  try {
    const harness = createHarness({ file })
    apply(harness.ctx, { libraryPath: file })

    const manager = harness.commands.get('qp')
    assert.ok(manager, '/qp must be registered')

    const forged = await manager.handler({ agent: harness.agent, rawInput: 'forge 帮我写周报', signal: harness.signal })
    assert.equal(forged.kind, 'success')
    assert.match(forged.text, /角色：周报助手/)

    const saved = await manager.handler({ agent: harness.agent, rawInput: 'save weekly --title=周报', signal: harness.signal })
    assert.equal(saved.kind, 'success')
    assert.ok(harness.commands.has('qp-weekly'), 'saving must register /qp-weekly')

    const listed = await manager.handler({ agent: harness.agent, rawInput: 'list', signal: harness.signal })
    assert.match(listed.text, /qp-weekly/)
    assert.match(listed.text, /周报/)

    const dynamic = harness.commands.get('qp-weekly')
    const executed = await dynamic.handler({ agent: harness.agent, rawInput: '主题="Q4 复盘"', signal: harness.signal })
    assert.equal(executed.kind, 'success')
    assert.equal(harness.sent.length, 1)
    assert.equal(harness.sent[0].role, 'user')
    assert.equal(harness.sent[0].source.kind, 'user')
    assert.match(harness.sent[0].content[0].text, /主题：Q4 复盘/)

    const stored = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(stored.prompts.weekly.usageCount, 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('missing variables refuse to send and name the slots', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quickprompt-plugin-'))
  const file = join(directory, 'prompts.json')
  try {
    const harness = createHarness({ file })
    apply(harness.ctx, { libraryPath: file })
    const manager = harness.commands.get('qp')
    await manager.handler({ agent: harness.agent, rawInput: 'forge 帮我写周报', signal: harness.signal })
    await manager.handler({ agent: harness.agent, rawInput: 'save weekly', signal: harness.signal })

    const dynamic = harness.commands.get('qp-weekly')
    const result = await dynamic.handler({ agent: harness.agent, rawInput: '', signal: harness.signal })
    assert.equal(result.kind, 'error')
    assert.match(result.text, /主题/)
    assert.equal(harness.sent.length, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('autoRun=false renders instead of sending', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quickprompt-plugin-'))
  const file = join(directory, 'prompts.json')
  try {
    const harness = createHarness({ file })
    apply(harness.ctx, { libraryPath: file, autoRun: false })
    const manager = harness.commands.get('qp')
    await manager.handler({ agent: harness.agent, rawInput: 'forge 帮我写周报', signal: harness.signal })
    await manager.handler({ agent: harness.agent, rawInput: 'save weekly', signal: harness.signal })

    const dynamic = harness.commands.get('qp-weekly')
    const result = await dynamic.handler({ agent: harness.agent, rawInput: '主题=进展', signal: harness.signal })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /主题：进展/)
    assert.equal(harness.sent.length, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the tool exposes the same library', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quickprompt-plugin-'))
  const file = join(directory, 'prompts.json')
  try {
    const harness = createHarness({ file })
    apply(harness.ctx, { libraryPath: file })
    const tool = harness.tools.get('quick_prompt')
    assert.ok(tool, 'quick_prompt tool must be registered')

    const saved = await tool.execute({ action: 'save', name: 'standup', body: '站会要点：{{要点}}', title: '站会' })
    assert.match(saved.text, /已保存/)

    const list = await tool.execute({ action: 'list' })
    assert.match(list.text, /qp-standup/)

    const rendered = await tool.execute({ action: 'run', name: 'standup', args: '要点=卡点' })
    assert.match(rendered.text, /站会要点：卡点/)

    const removed = await tool.execute({ action: 'delete', name: 'standup' })
    assert.match(removed.text, /已删除/)
    assert.equal(harness.commands.has('qp-standup'), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

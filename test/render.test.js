import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  bindArguments,
  findIllegalSlots,
  parseArgs,
  parseVariables,
  renderPrompt,
  renderTemplate,
  toCommandSlug,
} from '../lib/render.js'
import { createFileStore } from '../lib/store.js'

test('parseVariables lists slots once, in order, with defaults', () => {
  const declared = parseVariables('给 {{受众}} 写一份关于 {{主题:Q4 复盘}} 的周报，受众仍是 {{受众}}')
  assert.deepEqual(declared, [
    { name: '受众', defaultValue: undefined },
    { name: '主题', defaultValue: 'Q4 复盘' },
  ])
})

test('parseVariables ignores escaped slots', () => {
  assert.deepEqual(parseVariables('字面量 \\{{不是变量}} 和 {{真实}}'), [
    { name: '真实', defaultValue: undefined },
  ])
})

test('renderTemplate fills values and keeps unresolved slots', () => {
  const ok = renderTemplate('你好 {{名字}}', { 名字: '小明' })
  assert.equal(ok.ok, true)
  assert.equal(ok.text, '你好 小明')

  const missing = renderTemplate('你好 {{名字}}，主题 {{主题}}', { 名字: '小明' })
  assert.equal(missing.ok, false)
  assert.deepEqual(missing.missing, ['主题'])
  assert.equal(missing.text, '你好 小明，主题 {{主题}}')
})

test('renderTemplate uses defaults and unescapes literal braces', () => {
  const rendered = renderTemplate('{{标题:周报}} / \\{{原样}}', {})
  assert.equal(rendered.ok, true)
  assert.equal(rendered.text, '周报 / {{原样}}')
})

test('parseArgs separates named, quoted, and positional arguments', () => {
  const parsed = parseArgs('主题="Q4 复盘" 受众=老板 额外上下文')
  assert.deepEqual(parsed.named, { 主题: 'Q4 复盘', 受众: '老板' })
  assert.deepEqual(parsed.positional, ['额外上下文'])
})

test('bindArguments prefers k=v and fills the rest positionally', () => {
  const declared = parseVariables('{{a}} {{b}} {{c:d}}')
  const bound = bindArguments(declared, parseArgs('b=2 x'))
  assert.deepEqual(bound.values, { b: '2', a: 'x' })
  assert.equal(bound.consumed, 1)
})

test('renderPrompt appends surplus positional text as context', () => {
  const record = { name: 'weekly', body: '主题：{{主题}}' }
  const rendered = renderPrompt(record, '主题=进展 补充说明')
  assert.equal(rendered.ok, true)
  assert.equal(rendered.text, '主题：进展\n\n补充说明')
})

test('renderPrompt reports missing required slots', () => {
  const rendered = renderPrompt({ name: 'weekly', body: '主题：{{主题}}' }, '')
  assert.equal(rendered.ok, false)
  assert.deepEqual(rendered.missing, ['主题'])
})

test('toCommandSlug produces a registry-safe suffix', () => {
  assert.equal(toCommandSlug('Weekly Report'), 'Weekly-Report')
  assert.equal(toCommandSlug('a/b:c#d'), 'a-b-c-d')
  assert.equal(toCommandSlug('  '), '')
})

test('file store persists, updates, and removes records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'quickprompt-'))
  try {
    const store = createFileStore({ file: join(directory, 'prompts.json') })
    store.save({ name: 'weekly', body: '主题：{{主题}}', title: '周报' })
    assert.equal(store.get('weekly').title, '周报')
    assert.equal(store.list().length, 1)

    store.save({ name: 'weekly', body: '主题：{{主题}} v2' })
    assert.match(store.get('weekly').body, /v2/)
    assert.equal(store.markUsed('weekly').usageCount, 1)

    const reopened = createFileStore({ file: join(directory, 'prompts.json') })
    assert.equal(reopened.get('weekly').usageCount, 1)
    assert.equal(reopened.remove('weekly'), true)
    assert.equal(createFileStore({ file: join(directory, 'prompts.json') }).list().length, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('illegal slot fragments are reported before a save', () => {
  assert.deepEqual(findIllegalSlots('字数：{{500}} 左右'), ['{{500}}'])
  assert.deepEqual(findIllegalSlots('日期：{{日期，如 2025-01-01}}'), ['{{日期，如 2025-01-01}}'])
  assert.deepEqual(findIllegalSlots('空槽：{{}}'), ['{{}}'])
  assert.deepEqual(findIllegalSlots('嵌套：{{a{b}}'), ['{{a{b}}'])
  assert.deepEqual(findIllegalSlots('合法：{{主题}} 与 {{字数:500}} 与 {{a.b-c}}'), [])
  assert.deepEqual(findIllegalSlots('转义：\\{{字面量}}'), [])
  assert.deepEqual(findIllegalSlots('无槽位'), [])
})

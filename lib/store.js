/**
 * Durable prompt library for QuickPrompt.
 *
 * The library is one small JSON file owned by the plugin, so it survives
 * restarts and stays readable with any text editor. Writes are atomic
 * (temporary file + rename) and a malformed file is preserved as a
 * `.corrupt-<timestamp>` sibling instead of being silently dropped.
 *
 * @module dsh-quickprompt/store
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Current on-disk format version. */
const FORMAT_VERSION = 1

/** Longest accepted prompt body, in characters. */
const MAX_BODY = 40000

/**
 * Normalize one stored record, dropping anything the library cannot use.
 * @param {unknown} value - candidate record.
 * @returns {object | undefined} a clean record, or undefined when unusable.
 */
function normalizeRecord(value) {
  if (value === null || typeof value !== 'object') return undefined
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const body = typeof value.body === 'string' ? value.body : ''
  if (!name || !body) return undefined
  const createdAt = Number.isFinite(value.createdAt) ? value.createdAt : Date.now()
  return {
    name,
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : name,
    description: typeof value.description === 'string' ? value.description : '',
    body: body.slice(0, MAX_BODY),
    tags: Array.isArray(value.tags) ? value.tags.filter((tag) => typeof tag === 'string') : [],
    createdAt,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : createdAt,
    usageCount: Number.isFinite(value.usageCount) ? value.usageCount : 0,
    ...(Number.isFinite(value.lastUsedAt) ? { lastUsedAt: value.lastUsedAt } : {}),
  }
}

/**
 * Create a file-backed prompt store. Nothing is read until {@link load}.
 * @param {{file: string, logger?: {warn: Function}}} options - absolute file path and optional logger.
 * @returns {object} store handle.
 */
export function createFileStore({ file, logger } = {}) {
  /** @type {Map<string, object>} */
  let prompts = new Map()
  let loaded = false

  /**
   * Read the file once. A missing file is an empty library; an unreadable or
   * malformed file is moved aside so the user can inspect it.
   */
  function load() {
    if (loaded) return
    loaded = true
    if (!existsSync(file)) return
    let raw
    try {
      raw = readFileSync(file, 'utf8')
    } catch (error) {
      logger?.warn?.(`quickprompt: 无法读取库文件 ${file}: ${error?.message ?? error}`)
      return
    }
    try {
      const parsed = JSON.parse(raw)
      const records = parsed?.prompts
      const entries = Array.isArray(records)
        ? records.map((record) => [record?.name, record])
        : Object.entries(records ?? {})
      for (const [key, value] of entries) {
        const record = normalizeRecord(value)
        if (record) prompts.set(record.name || String(key), record)
      }
    } catch (error) {
      const backup = `${file}.corrupt-${Date.now()}`
      try {
        renameSync(file, backup)
      } catch {
        /* keep the original file when the backup rename fails */
      }
      logger?.warn?.(`quickprompt: 库文件损坏，已备份到 ${backup}: ${error?.message ?? error}`)
      prompts = new Map()
    }
  }

  /** Persist the whole map atomically. */
  function flush() {
    mkdirSync(dirname(file), { recursive: true })
    const payload = {
      version: FORMAT_VERSION,
      updatedAt: Date.now(),
      prompts: Object.fromEntries(prompts),
    }
    const temporary = join(dirname(file), `.${Date.now()}-${process.pid}.tmp`)
    writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    renameSync(temporary, file)
  }

  return {
    /** Absolute library path. */
    file,
    /** Read the file once (idempotent). */
    load,
    /** @returns {object[]} records sorted by last use, then name. */
    list() {
      load()
      return [...prompts.values()].sort((left, right) => {
        const recentLeft = left.lastUsedAt ?? 0
        const recentRight = right.lastUsedAt ?? 0
        if (recentLeft !== recentRight) return recentRight - recentLeft
        return left.name.localeCompare(right.name)
      })
    },
    /**
     * @param {string} name - prompt name.
     * @returns {object | undefined} the record.
     */
    get(name) {
      load()
      return prompts.get(String(name ?? ''))
    },
    /**
     * Insert or replace one record.
     * @param {object} input - record fields; `name` and `body` are required.
     * @returns {object} the stored record.
     */
    save(input) {
      load()
      const existing = prompts.get(input?.name)
      const now = Date.now()
      const record = normalizeRecord({
        ...input,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        usageCount: existing?.usageCount ?? input?.usageCount ?? 0,
        lastUsedAt: existing?.lastUsedAt ?? input?.lastUsedAt,
      })
      if (!record) throw new Error('提示词需要非空的 name 和 body')
      prompts.set(record.name, record)
      flush()
      return record
    },
    /**
     * @param {string} name - prompt name.
     * @returns {boolean} whether a record was removed.
     */
    remove(name) {
      load()
      const removed = prompts.delete(String(name ?? ''))
      if (removed) flush()
      return removed
    },
    /**
     * Record one execution without changing the body.
     * @param {string} name - prompt name.
     * @returns {object | undefined} the updated record.
     */
    markUsed(name) {
      load()
      const record = prompts.get(String(name ?? ''))
      if (!record) return undefined
      const updated = { ...record, usageCount: (record.usageCount ?? 0) + 1, lastUsedAt: Date.now() }
      prompts.set(updated.name, updated)
      flush()
      return updated
    },
  }
}

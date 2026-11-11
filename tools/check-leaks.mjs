#!/usr/bin/env node
/**
 * Machine-path leak check for QuickPrompt.
 *
 * Every text file in the repository must stay free of traces of the machine it
 * was written on: absolute Windows paths, the home directory or account name,
 * the local workspace folder name, and loopback addresses with a port. Docs and
 * examples use generic placeholders (`<本仓库路径>`, `%DSH_HOME%`, `<profile>`)
 * instead, so leaking any of the patterns below is a documentation bug.
 *
 * File selection goes through `git ls-files`: the scan covers exactly the files
 * git tracks, so ignored output, caches and build leftovers never fail the check.
 * Commit a file first and it is covered from then on. When git cannot be spawned
 * (some sandboxed sessions deny child processes) it falls back to walking the
 * tree and skips the usual junk directories instead.
 *
 * Exit code: 0 when clean, 1 when anything matched.
 *
 * Usage:
 *   node tools/check-leaks.mjs
 *   npm run check:leaks
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root (this file lives in `<root>/tools/`). */
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** This file spells the patterns out, so it can never pass its own scan. */
const SELF = relative(ROOT, fileURLToPath(import.meta.url)).split('\\').join('/')

/**
 * Patterns that must not appear in repository text files.
 * `test` is a plain (non-global) RegExp: `lastIndex` never carries between lines.
 */
const RULES = [
  { id: 'windows-path', test: /[A-Za-z]:\\/, hint: 'Windows 盘符路径' },
  { id: 'home-profile', test: /Users\\wyt/i, hint: '本机用户目录' },
  { id: 'workspace-name', test: /DSHworkspace/i, hint: '本机工作区目录名' },
  { id: 'account-name', test: /\bwyt\b/i, hint: '本机账号名' },
  { id: 'loopback-address', test: /127\.0\.0\.1:/, hint: '本机回环地址与端口' },
]

/** Extensions treated as binary and skipped without reading. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico', '.icns',
  '.pdf', '.zip', '.gz', '.tgz', '.tar', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.wav', '.flac', '.mp4', '.mov', '.webm',
  '.wasm', '.node', '.exe', '.dll', '.so', '.dylib', '.asar', '.bin',
])

/** Directories that never contain repository text worth scanning. */
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'coverage', '.npm-cache', '.quickprompt'])

/** Files larger than this are skipped as data blobs, not source. */
const MAX_BYTES = 2 * 1024 * 1024

/**
 * List candidate files, preferring the git index so ignored files stay out.
 * @returns {string[]} repository-relative paths using `/` separators.
 */
function listFiles() {
  try {
    const output = execFileSync(
      'git',
      ['ls-files', '-z'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return output.split('\0').filter(Boolean)
  } catch (error) {
    console.warn(`check-leaks: 无法使用 git（${error?.message ?? error}），改用目录遍历`)
    return walk(ROOT)
  }
}

/**
 * Recursively collect files, skipping VCS and dependency directories.
 * @param {string} directory - absolute directory to walk.
 * @param {string[]} [files] - accumulator.
 * @returns {string[]} repository-relative paths.
 */
function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.git') || SKIP_DIRECTORIES.has(entry.name)) continue
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      walk(full, files)
      continue
    }
    if (entry.isFile()) files.push(relative(ROOT, full).split('\\').join('/'))
  }
  return files
}

/**
 * Read one file as text, or return undefined when it is binary, too large,
 * unreadable, or inside a skipped directory.
 * @param {string} file - repository-relative path.
 * @returns {{ path: string, text: string } | undefined} readable text file.
 */
function readTextFile(file) {
  const parts = file.split('/')
  if (parts.some((part) => part === '.git' || part === 'node_modules')) return undefined
  if (file === SELF) return undefined
  if (BINARY_EXTENSIONS.has(extname(file).toLowerCase())) return undefined

  const full = join(ROOT, file)
  let stats
  try {
    stats = statSync(full)
  } catch {
    return undefined
  }
  if (!stats.isFile() || stats.size > MAX_BYTES) return undefined

  let text
  try {
    text = readFileSync(full, 'utf8')
  } catch {
    return undefined
  }
  // A NUL byte in decoded UTF-8 means binary content under a text extension.
  if (text.includes('\0')) return undefined
  return { path: file, text }
}

/** Collect every match as `{ file, line, id, hint, excerpt }`. */
const hits = []
let scanned = 0

for (const file of listFiles()) {
  const readable = readTextFile(file)
  if (!readable) continue
  scanned += 1
  const lines = readable.text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    for (const rule of RULES) {
      if (!rule.test.test(line)) continue
      hits.push({
        file: readable.path,
        line: index + 1,
        id: rule.id,
        hint: rule.hint,
        excerpt: line.trim().slice(0, 180),
      })
    }
  }
}

if (hits.length === 0) {
  console.log('no leaks')
  console.log(`(${scanned} 个文本文件已扫描)`)
} else {
  for (const hit of hits) {
    console.log(`${hit.file}:${hit.line}: ${hit.id} (${hit.hint}) ${hit.excerpt}`)
  }
  console.log(`\n${hits.length} 处命中，${scanned} 个文本文件已扫描。请改成通用占位符（<本仓库路径>、%DSH_HOME%、<profile>、<slug>）。`)
  process.exitCode = 1
}

/**
 * dsh-plugin-soul · 自我升级（改自己的代码）
 *
 * 分两步走，任何一步都不让模型"直接改生产文件"：
 *   proposeUpgrade  把「要改哪些文件、改成什么、为什么」落成一份提案目录（含改前快照）
 *   applyUpgrade    人确认后（confirm === 'APPLY'）才写；写完逐个 node --check，
 *                   任何一个文件语法不过 → 立刻整体还原并报错
 *
 * 硬护栏：
 *   - 只允许 lib/**.js 与 templates/**.md（package.json / patch / README 一律禁改）
 *   - 路径必须 resolve 回插件目录内（防 ../）
 *   - 改前快照留在提案目录，rollbackUpgrade 可一键还原
 *   - 改完要重启 DSH 才生效（这里只提示，绝不自己重启）
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { DEFAULT_ROOT } from './soul-store.js'

export const UPGRADES_DIR = 'upgrades'
/** 允许自改的范围 */
const ALLOWED_RE = /^(lib|templates)\/[A-Za-z0-9._/-]+\.(js|md)$/
/** 必须通过 node --check 的扩展名 */
const CHECK_EXT = new Set(['.js'])

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}

function exec(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    return { ok: true, out: String(out).trim() }
  } catch (err) {
    return { ok: false, error: String(err && err.stderr ? err.stderr : err && err.message ? err.message : err).trim() }
  }
}

function rootOf(pluginRoot) {
  return path.join(pluginRoot, 'lib')
}

/** 校验相对路径：白名单 + 不许逃出插件目录 */
export function assertWritableRel(rel) {
  const clean = String(rel || '').replace(/\\/g, '/').trim()
  if (!ALLOWED_RE.test(clean)) {
    throw new Error(`不允许改这个文件：${rel}（只允许 lib/**.js 与 templates/**.md）`)
  }
  if (clean.split('/').includes('..')) throw new Error(`路径不许包含 ..：${rel}`)
  return clean
}

function slug(title) {
  return String(title || 'upgrade')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'upgrade'
}

function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

function lineDiff(before, after) {
  const a = new Set((before ?? '').split('\n'))
  const b = new Set((after ?? '').split('\n'))
  let removed = 0
  let added = 0
  for (const l of (before ?? '').split('\n')) if (!b.has(l)) removed += 1
  for (const l of (after ?? '').split('\n')) if (!a.has(l)) added += 1
  return { added, removed }
}

/**
 * 落一份升级提案（不写业务文件）。
 * @param {object} opts
 * @param {string} opts.pluginRoot 插件目录（~/www/dsh-plugin-soul）
 * @param {string} opts.title 一句话标题
 * @param {string} opts.why 为什么改（基于什么事实/需求）
 * @param {Array<{path:string, content:string}>} opts.files
 * @param {string} [opts.root] 自我目录
 */
export function proposeUpgrade({ pluginRoot, title, why, files, root = DEFAULT_ROOT }) {
  const reason = String(why || '').trim()
  if (reason.length < 4) throw new Error('why 必填（≥4 字符）')
  if (!Array.isArray(files) || files.length === 0) throw new Error('files 不能为空')
  if (files.length > 6) throw new Error('一次提案最多 6 个文件')

  const id = `${stamp()}-${slug(title)}`
  const dir = path.join(root, UPGRADES_DIR, id)
  const rows = []
  for (const f of files) {
    const rel = assertWritableRel(f.path)
    const abs = path.join(pluginRoot, rel)
    if (!fs.existsSync(abs)) throw new Error(`文件不存在：${rel}（自我升级只改已有文件）`)
    const before = readIfExists(abs) ?? ''
    const after = String(f.content ?? '')
    if (after === before) continue
    write(path.join(dir, 'files', rel), after)
    write(path.join(dir, 'before', rel), before)
    const d = lineDiff(before, after)
    rows.push(`- \`${rel}\`：+${d.added} / -${d.removed} 行，${before.length} → ${after.length} 字符`)
  }
  if (rows.length === 0) throw new Error('所有文件内容都没变，提案为空')

  write(
    path.join(dir, 'proposal.md'),
    [
      `# 升级提案 ${id}`,
      '',
      `- 标题：${title}`,
      `- 原因：${reason}`,
      `- 插件：${pluginRoot}`,
      `- 生成：${new Date().toISOString()}`,
      '',
      '## 改动清单',
      ...rows,
      '',
      '## 应用方式',
      '调 `soul_apply_upgrade({ id, confirm: "APPLY" })`。应用前会逐文件 `node --check`，',
      '任何一个语法不过就整体还原；应用后需要**重启 DSH** 才生效。',
      '',
      '## 回滚',
      `调 \`soul_upgrade_rollback({ id: "${id}" })\`，从本目录 before/ 还原。`,
      '',
    ].join('\n'),
  )
  write(path.join(dir, 'status.json'), JSON.stringify({ id, state: 'proposed', at: new Date().toISOString() }, null, 2) + '\n')
  return { id, dir, rows }
}

function listProposalFiles(dir) {
  const out = []
  const base = path.join(dir, 'files')
  const walk = (rel) => {
    const abs = rel ? path.join(base, rel) : base
    if (!fs.existsSync(abs)) return
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(next)
      else out.push(next)
    }
  }
  walk('')
  return out
}

/** 找提案目录 */
function proposalDir(root, id) {
  const clean = String(id || '').trim()
  if (!/^[A-Za-z0-9\u4e00-\u9fa5._-]+$/.test(clean)) throw new Error(`非法提案 id：${id}`)
  const dir = path.join(root, UPGRADES_DIR, clean)
  if (!fs.existsSync(path.join(dir, 'proposal.md'))) throw new Error(`提案不存在：${clean}`)
  return dir
}

/**
 * 应用提案。confirm 必须是字符串 'APPLY'。
 */
export function applyUpgrade({ pluginRoot, id, confirm, root = DEFAULT_ROOT }) {
  if (confirm !== 'APPLY') throw new Error('必须显式确认：confirm 传字符串 "APPLY"')
  const dir = proposalDir(root, id)
  const status = JSON.parse(readIfExists(path.join(dir, 'status.json')) || '{"state":"proposed"}')
  if (status.state === 'applied') throw new Error(`提案已应用过：${id}（要重来先 rollback）`)

  const rels = listProposalFiles(dir)
  if (rels.length === 0) throw new Error('提案里没有可应用的文件')

  const written = []
  const failures = []
  try {
    for (const rel of rels) {
      assertWritableRel(rel)
      const abs = path.join(pluginRoot, rel)
      const next = readIfExists(path.join(dir, 'files', rel))
      if (next == null) continue
      write(abs, next)
      written.push(rel)
      if (CHECK_EXT.has(path.extname(rel))) {
        const check = exec(process.execPath, ['--check', abs])
        if (!check.ok) {
          failures.push(`${rel}: ${check.error}`)
          break
        }
      }
    }
  } finally {
    if (failures.length > 0) {
      // 整体还原
      for (const rel of written) {
        const before = readIfExists(path.join(dir, 'before', rel))
        if (before != null) write(path.join(pluginRoot, rel), before)
      }
      write(
        path.join(dir, 'status.json'),
        JSON.stringify({ id, state: 'rejected', at: new Date().toISOString(), error: failures.join('\n') }, null, 2) + '\n',
      )
    }
  }
  if (failures.length > 0) throw new Error(`语法检查失败，已整体还原：\n${failures.join('\n')}`)

  // git（插件目录若已初始化仓库）
  let commit = 'no-git'
  if (fs.existsSync(path.join(pluginRoot, '.git'))) {
    exec('git', ['-C', pluginRoot, 'add', '-A'])
    const c = exec('git', ['-C', pluginRoot, '-c', 'user.name=dsh-soul', '-c', 'user.email=soul@localhost', 'commit', '-q', '-m', `soul: 自我升级 ${id}`])
    if (c.ok) {
      const rev = exec('git', ['-C', pluginRoot, 'rev-parse', '--short', 'HEAD'])
      commit = rev.ok ? rev.out : 'no-git'
    }
  }
  write(
    path.join(dir, 'status.json'),
    JSON.stringify({ id, state: 'applied', at: new Date().toISOString(), commit, needsRestart: true }, null, 2) + '\n',
  )
  return { id, files: written, commit, needsRestart: true }
}

/** 从 before/ 还原 */
export function rollbackUpgrade({ pluginRoot, id, root = DEFAULT_ROOT }) {
  const dir = proposalDir(root, id)
  const rels = listProposalFiles(dir)
  const restored = []
  const failures = []
  for (const rel of rels) {
    assertWritableRel(rel)
    const before = readIfExists(path.join(dir, 'before', rel))
    if (before == null) continue
    const abs = path.join(pluginRoot, rel)
    write(abs, before)
    restored.push(rel)
    if (CHECK_EXT.has(path.extname(rel))) {
      const check = exec(process.execPath, ['--check', abs])
      if (!check.ok) failures.push(`${rel}: ${check.error}`)
    }
  }
  write(
    path.join(dir, 'status.json'),
    JSON.stringify({ id, state: 'rolled-back', at: new Date().toISOString(), restoreFailed: failures }, null, 2) + '\n',
  )
  if (failures.length > 0) throw new Error(`已还原但语法仍有问题：\n${failures.join('\n')}`)
  return { id, restored, needsRestart: true }
}

/** 列提案 */
export function listUpgrades(root = DEFAULT_ROOT) {
  const dir = path.join(root, UPGRADES_DIR)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      let status = { state: 'unknown' }
      try {
        status = JSON.parse(readIfExists(path.join(dir, e.name, 'status.json')) || '{}')
      } catch {
        /* ignore */
      }
      return { id: e.name, state: status.state ?? 'unknown', at: status.at ?? null, commit: status.commit ?? null }
    })
    .sort((a, b) => String(b.id).localeCompare(String(a.id)))
}

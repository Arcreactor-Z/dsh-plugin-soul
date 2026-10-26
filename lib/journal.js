/**
 * dsh-plugin-soul · 日志与候选池（light 阶段）
 *
 * 分工（照 OpenClaw 梦境的思路，但全部确定性、可解释）：
 *   journal/YYYY-MM-DD.md   日间随手记的观察（便宜、不限次）
 *   .candidates.json        从观察里聚合出来的候选：出现次数、跨天、证据行号
 *
 * 原则：
 *   - light 阶段不调模型，只做归一化 + 计数 + 证据收集；
 *   - "能不能升格"由确定性闸门决定（次数 + 跨天 + 未被丢弃），模型只负责后续措辞；
 *   - 每次统计都可回指到具体文件行号，不做黑箱打分。
 */

import fs from 'node:fs'
import path from 'node:path'

export const JOURNAL_DIR = 'journal'
/** 候选升格闸门：至少出现几次 */
export const MIN_CANDIDATE_COUNT = 3
/** 至少跨几天 */
export const MIN_CANDIDATE_DAYS = 2
/** 每条观察最多保留多少字符 */
const MAX_OBSERVATION_CHARS = 400
/** 候选池文件 */
const CANDIDATES = '.candidates.json'

function pad(n) {
  return String(n).padStart(2, '0')
}

export function dayStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function clock(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

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

/**
 * 追加一条观察。
 * @param {object} opts
 * @param {string} opts.text 观察内容（一句话，基于事实）
 * @param {string} [opts.tag] 分类标签，默认 observe
 * @param {string} [opts.root]
 * @param {Date}   [opts.now]
 */
export function appendJournal({ text, tag = 'observe', root, now = new Date() }) {
  const clean = String(text == null ? '' : text).trim()
  if (clean.length < 2) throw new Error('观察内容太短（≥2 字符）')
  if (clean.length > MAX_OBSERVATION_CHARS) throw new Error(`观察太长（≤${MAX_OBSERVATION_CHARS} 字符），拆成几条`)
  const label = String(tag || 'observe').trim().replace(/\s+/g, '-').slice(0, 24) || 'observe'
  const day = dayStamp(now)
  const file = path.join(root, JOURNAL_DIR, `${day}.md`)
  const head = readIfExists(file)
  const line = `- ${clock(now)} [${label}] ${clean}`
  if (head == null) {
    write(file, `# journal ${day}\n\n${line}\n`)
  } else {
    write(file, head.endsWith('\n') ? `${head}${line}\n` : `${head}\n${line}\n`)
  }
  return { file: path.relative(root, file), line, day }
}

/** 读出全部观察（带文件与行号） */
export function collectObservations(root) {
  const dir = path.join(root, JOURNAL_DIR)
  let names = []
  try {
    names = fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort()
  } catch {
    return []
  }
  const rows = []
  for (const name of names) {
    const day = name.slice(0, 10)
    const rel = `${JOURNAL_DIR}/${name}`
    const lines = (readIfExists(path.join(dir, name)) ?? '').split('\n')
    lines.forEach((raw, idx) => {
      const m = raw.match(/^\s*-\s*(\d{2}:\d{2})\s*\[([^\]]+)\]\s*(.+)$/)
      if (!m) return
      rows.push({ day, time: m[1], tag: m[2], text: m[3].trim(), file: rel, line: idx + 1 })
    })
  }
  return rows
}

/** 归一化：去掉标点、空白、大小写差异，取前 80 字符作为合并键 */
export function normalizeKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s，。、；：！？,.;:!?`"'“”‘’（）()【】\[\]<>《》…—\-+*/\\|]/g, '')
    .slice(0, 80)
}

function readPool(root) {
  const raw = readIfExists(path.join(root, CANDIDATES))
  if (!raw) return { version: 1, updatedAt: null, entries: {} }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') return parsed
  } catch {
    /* 坏文件重建 */
  }
  return { version: 1, updatedAt: null, entries: {} }
}

function writePool(root, pool) {
  pool.version = 1
  pool.updatedAt = new Date().toISOString()
  write(path.join(root, CANDIDATES), JSON.stringify(pool, null, 2) + '\n')
}

/**
 * light 阶段：把 journal 重新聚合成候选池。
 *
 * 保留已有候选的 status（promoted / dropped 不会被统计覆盖），只刷新 counts 与证据。
 */
export function refreshCandidates(root, { now = new Date() } = {}) {
  const observations = collectObservations(root)
  const pool = readPool(root)
  const grouped = new Map()
  for (const ob of observations) {
    const key = normalizeKey(ob.text)
    if (!key) continue
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(ob)
  }
  const fresh = {}
  for (const [key, list] of grouped) {
    const days = [...new Set(list.map((o) => o.day))].sort()
    const prev = pool.entries[key]
    fresh[key] = {
      key,
      text: list[list.length - 1].text,
      count: list.length,
      days,
      firstSeen: `${days[0]} ${list[0].time}`,
      lastSeen: `${days[days.length - 1]} ${list[list.length - 1].time}`,
      evidence: list.slice(-5).map((o) => `${o.file}#L${o.line}`),
      tags: [...new Set(list.map((o) => o.tag))].sort(),
      status: prev && (prev.status === 'promoted' || prev.status === 'dropped') ? prev.status : 'staged',
      ...prev && prev.promotedAt ? { promotedAt: prev.promotedAt } : {},
      ...prev && prev.dropReason ? { dropReason: prev.dropReason } : {},
      ...prev && prev.stagedAt ? { stagedAt: prev.stagedAt } : { stagedAt: now.toISOString() },
    }
  }
  // 已从 journal 里消失的候选也保留（可审计），但标成 gone
  for (const [key, prev] of Object.entries(pool.entries)) {
    if (!fresh[key]) fresh[key] = { ...prev, status: prev.status === 'promoted' ? 'promoted' : 'gone' }
  }
  pool.entries = fresh
  writePool(root, pool)
  return listCandidates(root)
}

/** 是否够格升格 */
export function isEligible(candidate) {
  return (
    candidate.status === 'staged' &&
    candidate.count >= MIN_CANDIDATE_COUNT &&
    candidate.days.length >= MIN_CANDIDATE_DAYS
  )
}

/** 按 eligibility → count → lastSeen 排序返回候选 */
export function listCandidates(root, { includeClosed = false } = {}) {
  const pool = readPool(root)
  const rows = Object.values(pool.entries)
    .filter((c) => includeClosed || c.status === 'staged')
    .sort((a, b) => {
      const ea = isEligible(a) ? 1 : 0
      const eb = isEligible(b) ? 1 : 0
      if (ea !== eb) return eb - ea
      if (a.count !== b.count) return b.count - a.count
      return String(b.lastSeen).localeCompare(String(a.lastSeen))
    })
  return rows
}

/** 标记状态（promoted / dropped） */
export function markCandidate(root, key, status, extra = {}) {
  const pool = readPool(root)
  const entry = pool.entries[key]
  if (!entry) throw new Error(`候选不存在：${key}`)
  entry.status = status
  Object.assign(entry, extra)
  writePool(root, pool)
  return entry
}

/** 候选池摘要文本 */
export function describeCandidates(root) {
  const rows = listCandidates(root, { includeClosed: true })
  if (rows.length === 0) return '候选池空：先往 journal 里记点观察（soul_journal）。'
  const eligible = rows.filter(isEligible)
  const lines = [
    `候选 ${rows.length} 条｜够格升格 ${eligible.length} 条（闸门：≥${MIN_CANDIDATE_COUNT} 次且跨 ≥${MIN_CANDIDATE_DAYS} 天）`,
  ]
  for (const c of rows.slice(0, 20)) {
    const flag = isEligible(c) ? '✅' : c.status === 'staged' ? '  ' : c.status === 'promoted' ? '📌' : '✂️'
    lines.push(`${flag} [${c.status}] ${c.count}次/${c.days.length}天 ${c.text.slice(0, 70)}`)
    lines.push(`     证据：${c.evidence.join('，')}`)
  }
  if (rows.length > 20) lines.push(`…还有 ${rows.length - 20} 条，用 soul_candidates 看全`)
  return lines.join('\n')
}

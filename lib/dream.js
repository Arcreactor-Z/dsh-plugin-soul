/**
 * dsh-plugin-soul · 反思（梦境）
 *
 * 一次 dream = light + deep + 记录：
 *   light  重算候选池（确定性统计，不调模型）
 *   deep   够格的候选合并成**一次**对 SOUL.md 的追加（受四道写入约束），并标记 promoted
 *   记录   追加 DREAMS.md：本次统计、升格了谁、谁还不够格
 *
 * 为什么合并不是一条一条写：单次变更 ≤800 字符、每日 ≤3 次，
 * 一条一条写会瞬间把额度烧光，还会把 SOUL 写成流水账。
 */

import fs from 'node:fs'
import path from 'node:path'
import { updateFile, readFile, FILES, DEFAULT_ROOT } from './soul-store.js'
import {
  MIN_CANDIDATE_COUNT,
  MIN_CANDIDATE_DAYS,
  isEligible,
  listCandidates,
  markCandidate,
  refreshCandidates,
} from './journal.js'

export const DREAMS_FILE = 'DREAMS.md'
const DREAM_STATE = '.dream-state.json'
/** SOUL 里沉淀反思的小节标题 */
const REFLECT_SECTION = '## 反思沉淀'
/** 一次 dream 最多升格几条（合并成一次写入） */
export const MAX_PROMOTE_PER_DREAM = 3

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

function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`
}

function appendDreams(root, block) {
  const file = path.join(root, DREAMS_FILE)
  const head = readIfExists(file) ?? '# DREAMS — 我的反思记录\n\n（每次 dream 一段：统计、升格了什么、什么还不够格）\n\n'
  write(file, `${head}${block}\n`)
}

function readDreamState(root) {
  const raw = readIfExists(path.join(root, DREAM_STATE))
  if (!raw) return { version: 1, lastDream: null }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    /* 坏文件重建 */
  }
  return { version: 1, lastDream: null }
}

function writeDreamState(root, state) {
  write(path.join(root, DREAM_STATE), JSON.stringify({ version: 1, ...state }, null, 2) + '\n')
}

/** 把候选拼成要追加到 SOUL 的一段（含证据，便于人类核对） */
function buildReflectionBlock(candidates, now = new Date()) {
  const day = stamp(now).slice(0, 10)
  const lines = [`### ${day}`, '']
  for (const c of candidates) {
    const ev = c.evidence && c.evidence.length ? `（证据：${c.evidence.join('，')}）` : ''
    lines.push(`- ${c.text}${ev}`)
  }
  return lines.join('\n') + '\n'
}

/** 把反思块并进 SOUL：有 `## 反思沉淀` 就追加其下，否则新建小节 */
function mergeIntoReflectionSection(soul, block) {
  const idx = soul.indexOf(REFLECT_SECTION)
  if (idx === -1) {
    return `${soul.replace(/\s+$/, '')}\n\n${REFLECT_SECTION}\n\n${block}`
  }
  const rest = soul.slice(0, idx + REFLECT_SECTION.length)
  const tail = soul.slice(idx + REFLECT_SECTION.length)
  return `${rest}\n\n${block}${tail.replace(/^\n+/, '\n')}`
}

/**
 * 跑一次反思。
 *
 * @param {object} opts
 * @param {string} [opts.root] 自我目录
 * @param {boolean} [opts.apply] true 才真的改 SOUL；false 只出预览
 * @param {Date} [opts.now]
 * @returns {{at:string, staged:number, eligible:number, promoted:number, summary:string}}
 */
export function runDream({ root = DEFAULT_ROOT, apply = false, narrative, now = new Date() } = {}) {
  const staged = refreshCandidates(root, { now })
  const all = listCandidates(root, { includeClosed: true })
  const eligible = staged.filter(isEligible).slice(0, MAX_PROMOTE_PER_DREAM)
  const lines = []
  let promoted = 0

  lines.push(`候选 ${all.length} 条｜够格 ${staged.filter(isEligible).length} 条（闸门 ≥${MIN_CANDIDATE_COUNT} 次且跨 ≥${MIN_CANDIDATE_DAYS} 天）`)

  if (eligible.length === 0) {
    lines.push('本次没有够格的候选 → 不动 SOUL，只记一笔。')
  } else if (!apply) {
    lines.push(`预览：将升格 ${eligible.length} 条到 SOUL.md（加 --apply 才写）`)
    for (const c of eligible) lines.push(`  · ${c.text}（${c.count}次/${c.days.length}天）`)
  } else {
    const block = buildReflectionBlock(eligible, now)
    const soul = readFile(root, 'SOUL.md')
    const why = `dream：${eligible.map((c) => `${c.count}次/${c.days.length}天`).join('、')}`
    try {
      const result = updateFile({
        name: 'SOUL.md',
        content: mergeIntoReflectionSection(soul, block),
        why,
        root,
      })
      promoted = eligible.length
      for (const c of eligible) markCandidate(root, c.key, 'promoted', { promotedAt: now.toISOString() })
      lines.push(`已升格 ${promoted} 条 → SOUL.md（Δ${result.delta} 字符，提交 ${result.commit}）`)
    } catch (err) {
      lines.push(`升格失败（未改动 SOUL）：${err && err.message ? err.message : err}`)
      lines.push('→ 通常是因为撞了预算/单次上限/每日次数；等下一次 dream，或先压缩 SOUL。')
    }
  }

  const notYet = staged.filter((c) => !isEligible(c))
  if (notYet.length > 0) {
    lines.push(`未够格 ${notYet.length} 条：${notYet.slice(0, 5).map((c) => `${c.count}次/${c.days.length}天`).join('、')}`)
  }

  const summary = lines.join('\n')
  // 叙事由调用方（模型自己）给，插件不代写、不调模型：确定性优先，且省一次调用
  const story = typeof narrative === 'string' && narrative.trim() ? narrative.trim().slice(0, 1200) : ''
  appendDreams(root, `## ${stamp(now)}\n\n${summary}\n${story ? `\n### 叙事\n\n${story}\n` : ''}`)
  writeDreamState(root, {
    lastDream: {
      at: now.toISOString(),
      apply: apply === true,
      staged: staged.length,
      eligible: eligible.length,
      promoted,
    },
  })
  return { at: now.toISOString(), staged: staged.length, eligible: eligible.length, promoted, summary }
}

/** 读最近一次 dream 记录 */
export function lastDream(root = DEFAULT_ROOT) {
  return readDreamState(root).lastDream ?? null
}

/** 读 DREAMS.md 全文（给 UI / 工具） */
export function readDreams(root = DEFAULT_ROOT) {
  return readIfExists(path.join(root, DREAMS_FILE)) ?? ''
}

/** 自我文件清单（UI 用） */
export function fileSummaries(root = DEFAULT_ROOT) {
  return Object.entries(FILES).map(([name, meta]) => {
    const content = readIfExists(path.join(root, name)) ?? ''
    return {
      name,
      label: meta.label,
      writable: meta.writable,
      chars: content.length,
      budget: meta.budget,
      overBudget: content.length > meta.budget,
      content,
    }
  })
}

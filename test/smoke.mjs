/**
 * dsh-plugin-soul 冒烟测试（零依赖，node test/smoke.mjs）
 *
 * 只测存储层真实行为：播种、注入文本、四道写入约束、git 提交与回滚。
 * 不测宿主注入（那要真跑 DSH）。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {
  FILES,
  MAX_DIFF_CHARS,
  MAX_WRITES_PER_DAY,
  describeStatus,
  ensureSeed,
  readAll,
  readNumbered,
  renderSoulBlock,
  rollback,
  updateFile,
} from '../lib/soul-store.js'

let pass = 0
let fail = 0
function check(label, fn) {
  try {
    fn()
    pass += 1
    console.log(`  ok   ${label}`)
  } catch (err) {
    fail += 1
    console.log(`  FAIL ${label}\n       ${err && err.message ? err.message : err}`)
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-smoke-'))
console.log(`临时自我目录：${dir}\n`)

// --- 播种 ---
const seeded = ensureSeed(dir)
check('ensureSeed 播种 4 份文件', () => {
  assert.equal(seeded.created.length, Object.keys(FILES).length)
  for (const name of Object.keys(FILES)) assert.ok(fs.existsSync(path.join(dir, name)), name)
  assert.ok(fs.existsSync(path.join(dir, '.git')), 'git 仓库应已初始化')
})

// --- 注入文本 ---
check('renderSoulBlock 含四份文件标题', () => {
  const block = renderSoulBlock(dir)
  assert.match(block, /\[SELF/)
  for (const name of Object.keys(FILES)) assert.ok(block.includes(name), `缺 ${name}`)
})

check('renderSoulBlock 中和双花括号', () => {
  fs.writeFileSync(path.join(dir, 'SOUL.md'), '# SOUL\n\nJSX 例子：style={{ color: "red" }}\n', 'utf8')
  const block = renderSoulBlock(dir)
  assert.ok(!block.includes('{{'), '不应包含 {{')
  assert.ok(block.includes('{ {'), '应替换为 { {')
})

check('readNumbered 带行号', () => {
  const text = readNumbered(dir, 'SOUL.md')
  assert.match(text, /^\s*1\| /m)
  assert.match(text, /2\| /)
})

// --- 写入约束（拒绝路径不消耗当日次数）---
check('RULES.md 拒写', () => {
  assert.throws(() => updateFile({ name: 'RULES.md', append: 'x', why: '试探', root: dir }), /只读锚点/)
})

check('未知文件拒写', () => {
  assert.throws(() => updateFile({ name: 'HACK.md', append: 'x', why: '试探', root: dir }), /未知文件/)
})

check('why 太短拒写', () => {
  assert.throws(() => updateFile({ name: 'SOUL.md', append: 'x', why: 'a', root: dir }), /why/)
})

check(`单次变更 > ${MAX_DIFF_CHARS} 字符拒写`, () => {
  const big = 'B'.repeat(MAX_DIFF_CHARS + 50)
  assert.throws(() => updateFile({ name: 'SOUL.md', append: big, why: '压力测试', root: dir }), /单次变更过大/)
})

check('超预算拒写', () => {
  const huge = 'C'.repeat(FILES['IDENTITY.md'].budget + 10)
  assert.throws(() => updateFile({ name: 'IDENTITY.md', content: huge, why: '压力测试', root: dir }), /超出预算/)
})

// --- 三次正常写入（第 3 次改 SOUL，方便回滚验证）---
check('第 1 次写入：SOUL 第一版 + 落 git', () => {
  const r = updateFile({ name: 'SOUL.md', content: '# SOUL\n\n第一版。\n', why: '冒烟测试第一次', root: dir })
  assert.equal(r.writesToday, 1)
  assert.ok(fs.readFileSync(path.join(dir, 'SOUL.md'), 'utf8').includes('第一版'))
  assert.ok(fs.existsSync(path.join(dir, 'CHANGELOG.md')), '应生成 CHANGELOG')
})

check('第 2 次写入：USER append 模式', () => {
  const r = updateFile({ name: 'USER.md', append: '\n- 追加一条。\n', why: '冒烟测试第二次', root: dir })
  assert.equal(r.writesToday, 2)
  assert.ok(fs.readFileSync(path.join(dir, 'USER.md'), 'utf8').includes('追加一条'))
})

check('第 3 次写入：SOUL 第二版', () => {
  const r = updateFile({ name: 'SOUL.md', content: '# SOUL\n\n第二版。\n', why: '冒烟测试第三次', root: dir })
  assert.equal(r.writesToday, MAX_WRITES_PER_DAY)
  assert.ok(fs.readFileSync(path.join(dir, 'SOUL.md'), 'utf8').includes('第二版'))
})

check(`第 ${MAX_WRITES_PER_DAY + 1} 次撞每日上限`, () => {
  assert.throws(
    () => updateFile({ name: 'SOUL.md', append: '\n再改。\n', why: '冒烟测试第四次', root: dir }),
    /上限/,
  )
})

// --- 回滚：SOUL 从第二版回到第一版 ---
check('rollback 回到上一提交', () => {
  const r = rollback({ name: 'SOUL.md', root: dir })
  assert.equal(r.sha, 'HEAD~1')
  const back = fs.readFileSync(path.join(dir, 'SOUL.md'), 'utf8')
  assert.ok(back.includes('第一版'), '应回到第一版')
  assert.ok(!back.includes('第二版'), '不应残留第二版')
})

// --- 状态 ---
check('describeStatus 输出四行文件与计数', () => {
  const text = describeStatus(dir)
  for (const name of Object.keys(FILES)) assert.ok(text.includes(name), `状态缺 ${name}`)
  assert.match(text, /今日自改：\d+\/3/)
})

check('readAll 标记只读与预算', () => {
  const rows = readAll(dir)
  const rules = rows.find((r) => r.name === 'RULES.md')
  assert.equal(rules.writable, false)
  assert.equal(rows.find((r) => r.name === 'SOUL.md').writable, true)
  assert.ok(rows.every((r) => r.chars <= r.budget), '播种模板不应超预算')
})

check('CHANGELOG 记录了 why', () => {
  const log = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8')
  assert.match(log, /冒烟测试第一次/)
  assert.match(log, /冒烟测试第三次/)
  assert.match(log, /rollback SOUL\.md/)
})

console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail > 0) process.exitCode = 1

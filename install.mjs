#!/usr/bin/env node
/**
 * dsh-plugin-soul 安装脚本（幂等、可回滚预演）
 *
 *   node install.mjs --dry    只打印将要做什么（默认）
 *   node install.mjs --apply  真正写入
 *
 * 做三件事：
 *   1. 在 profile 的 node_modules 里给插件建符号链接（不跑 pnpm、不动 lockfile）
 *   2. 在 profile 的 cordis.patch.yml 末尾追加 soul 行（已存在则跳过）
 *   3. 打印"接下来只需重启 DSH"
 *
 * 两个文件改动前都备份成 .bak-<时间戳>。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const APPLY = process.argv.includes('--apply')
const PLUGIN_DIR = path.dirname(new URL(import.meta.url).pathname)
const PROFILE_DIR = path.join(os.homedir(), '.dsh', 'profiles', 'desktop')
const PATCH = path.join(PROFILE_DIR, 'cordis.patch.yml')
const MODULES = path.join(PROFILE_DIR, 'node_modules')
const LINK = path.join(MODULES, 'dsh-plugin-soul')

const ROW_ID = 'soul'
const BLOCK = `
# dsh-plugin-soul：每轮注入可写自我（~/.dsh/soul）。安装脚本 install.mjs 自动追加。
- insert:
    - id: ${ROW_ID}
      name: dsh-plugin-soul
      config: {}
`

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function main() {
  const actions = []

  if (!fs.existsSync(PROFILE_DIR)) {
    console.error(`找不到 profile：${PROFILE_DIR}`)
    process.exit(1)
  }

  // 1) 符号链接
  let linkState = 'already'
  if (!fs.existsSync(LINK)) {
    linkState = 'create'
    actions.push(`创建符号链接：${LINK} -> ${PLUGIN_DIR}`)
  } else {
    const target = fs.lstatSync(LINK).isSymbolicLink() ? fs.readlinkSync(LINK) : '(实目录)'
    actions.push(`符号链接已存在：${LINK} -> ${target}`)
  }

  // 2) patch 行
  const patchText = fs.readFileSync(PATCH, 'utf8')
  const hasRow = new RegExp(`^\\s*-\\s*id:\\s*${ROW_ID}\\s*$`, 'm').test(patchText)
  actions.push(hasRow ? 'patch 里已有 soul 行（跳过）' : '在 cordis.patch.yml 末尾追加 soul insert 块')

  console.log(`模式：${APPLY ? 'APPLY（会写入）' : 'DRY（只看）'}`)
  console.log(`插件：${PLUGIN_DIR}`)
  console.log(`profile：${PROFILE_DIR}\n`)
  for (const a of actions) console.log(`- ${a}`)

  if (!APPLY) {
    console.log('\n预演结束。确认无误后跑：node install.mjs --apply')
    return
  }

  const tag = stamp()
  fs.copyFileSync(PATCH, `${PATCH}.bak-soul-${tag}`)

  if (linkState === 'create') {
    if (!fs.existsSync(MODULES)) fs.mkdirSync(MODULES, { recursive: true })
    fs.symlinkSync(PLUGIN_DIR, LINK, 'dir')
  }
  if (!hasRow) fs.appendFileSync(PATCH, BLOCK, 'utf8')

  console.log(`\n已写入。备份：${PATCH}.bak-soul-${tag}`)
  console.log('接下来只剩一步：重启 DSH（插件行只在重启后加载）。')
}

main()

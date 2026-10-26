# dsh-plugin-soul

> A writable, git-versioned **self** for DeepSeek Harness — persona files injected every turn, gated self-editing, journal→dream reflection, and a **Settings › 人格** tab.

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）一个**可写、可回滚、每轮在场**的自我：不是一个设定一次的人格，而是能长的那种。

## 为什么不用 `@deepseek-ai/dsh-persona`

官方 persona 插件的 config 只有 `prefix / suffix / complete / includeRuntimeContext`，**全是静态字符串**——改一次人格要动 profile patch 并重启。

而 `dsh-system-prompt` 的 `section.text` 支持**函数**（每次 assembly 求值）。本插件就是吃这个口子：**每轮重新读文件**，所以改 Markdown 立刻生效，不用重启。

## 四层能力

| 层 | 做什么 |
|---|---|
| **注入** | 每轮把 `~/.dsh/soul/*.md` 读进 system prompt（约 2.1k 字符 ≈ 535 tok） |
| **自改** | `soul_update` 改可写文件：RULES 只读 / 单次 ≤800 字符 / 每日 ≤3 次 / `why` 必填；每次落 git + CHANGELOG，可回滚 |
| **反思** | `soul_journal` 记观察 → `soul_candidates` 聚合（≥3 次且跨 ≥2 天才够格）→ `soul_dream` 合并升格进 SOUL，并写 `DREAMS.md` |
| **升级** | `soul_propose_upgrade` 落提案（含改前快照）→ `soul_apply_upgrade` 必须 `confirm:"APPLY"`；白名单 + 逐个 `node --check`，语法不过整体还原 |

外加设置页一个 **「人格」tab**：看四份配置、就地编辑（带 why）、看候选池 / 提交 / diff。

## 安装

**推荐：DSH 内置安装器**

设置 → 插件 → 添加插件，填：

```
CC19990113/dsh-plugin-soul
```

或完整仓库地址 `https://github.com/CC19990113/dsh-plugin-soul`。装完**重启 DSH**。

**手动（开发用）**

```bash
git clone https://github.com/CC19990113/dsh-plugin-soul ~/www/dsh-plugin-soul
cd ~/www/dsh-plugin-soul
node install.mjs          # 预演：建 symlink + 追加 patch 行（自动备份）
node install.mjs --apply
```

然后重启 DSH。卸载：删 symlink + patch 里 `id: soul` 那段。

## 首次使用

首次加载会在 `~/.dsh/soul/` 播种四份文件并 `git init`：

```
~/.dsh/soul/
  IDENTITY.md   名字 / 化身 / 口癖          （可写，1200 字符预算）
  SOUL.md       声音 / 立场 / 边界          （可写，4000）
  USER.md       对用户的模型（指令式）      （可写，2500）
  RULES.md      硬规则（只读锚点）          （2000，agent 改不了）
  journal/      日间观察
  DREAMS.md     反思记录
  CHANGELOG.md  每次自改的 why
```

直接说人话就行：

- 「把 `IDENTITY.md` 里的名字定成 XX」
- 「以后都用中文，记到 USER.md」
- 「跑一次 soul_dream 看看有什么值得沉淀的」

## 工具

| 工具 | 用途 |
|---|---|
| `soul_status` | 文件字符/预算、今日额度、候选数、最近反思 |
| `soul_read` | 读原文（带行号），也支持 `DREAMS.md` / `CHANGELOG.md` |
| `soul_history` | 最近提交、某文件 diff、升级提案 |
| `soul_update` | 改可写文件（`content` 或 `append`，`why` 必填） |
| `soul_rollback` | 回到历史提交 |
| `soul_journal` | 记一条观察（便宜、不限次） |
| `soul_candidates` | 看候选池（是否够格、证据行号） |
| `soul_dream` | 跑反思；默认预览，`apply:true` 才写 SOUL；可传 `narrative` |
| `soul_propose_upgrade` | 落升级提案（含 before 快照） |
| `soul_apply_upgrade` | `confirm:"APPLY"` 才写；语法不过整体还原 |
| `soul_upgrade_rollback` | 从提案 `before/` 还原 |

## 设置页「人格」tab

客户端插件注册 `settings.section`（`id: soul`、`order: 25`、`label: () => "人格"`），数据走同源 HTTP：

```
GET  /dsh-plugin-soul/api/state        文件 + 候选 + 提交 + lastDream
GET  /dsh-plugin-soul/api/file?name=   原文
POST /dsh-plugin-soul/api/file         写（同一套四道校验）
POST /dsh-plugin-soul/api/dream        跑一次反思
GET  /dsh-plugin-soul/api/diff?name=   相对上一提交的 diff
GET  /dsh-plugin-soul/api/dreams       DREAMS.md 全文
```

浏览器半侧是 CJS factory（`window.__ModuleLoader__.load`），只 `require("react")`，没有构建步骤。

## 自动反思（可选）

本插件不自带定时器。想要每晚自己反思一次，用 DSH 的 `schedule_create` 建一个 daily 任务，prompt 例如：

```
夜间自我反思：1) soul_candidates 看候选；2) 用 80-180 字写一段第一人称自省；
3) soul_dream({apply:true, narrative:"<那段>"})，然后一句话汇报。
```

## 设计取舍

- **确定性管资格，模型管措辞**：能不能升格由次数/跨天/证据决定，不是模型自觉。
- **写入是安全边界**：`RULES.md` 只读；升级只允许 `lib/**.js`、`templates/**.md`；`package.json`、patch、README 一律改不了。
- **攒着改**：每次改自我都会让 system prompt 的 KV cache 前缀失效（成本略涨），所以按天/按次收敛，而不是每轮追加。
- **自我升级必须重启才生效**，插件不会自己重启 DSH。

## 开发

```bash
npm test        # 30 项：存储 17 + 反思/升级 13
```

```
lib/index.js      入口：注入段 + 11 工具 + HTTP API
lib/soul-store.js 存储：播种/预算/四道校验/git/CHANGELOG/回滚
lib/journal.js    日志与候选池：归一化、跨天计数、证据、闸门
lib/dream.js      反思：light 重算 → deep 合并升格 → DREAMS.md
lib/upgrade.js    自我升级：提案、白名单、node --check、整体还原
lib/client.js     设置页「人格」tab
templates/*.md    首次播种的初版人格
test/*.mjs        smoke + features
install.mjs       幂等安装（--dry / --apply）
```

## 已知边界

- **真实浏览器渲染**：客户端用 vm mock + 最小 React 桩验证过加载/注册/交互分支，但没在真实浏览器里逐像素看过。
- **通过仓库地址安装**：走的是 DSH 官方安装器路径，本机开发用的是 symlink 安装；GitHub 安装形态未在本仓库实测。
- **版本兼容**：对 DSH `0.2.1-rc.2` 标 `unknown`（本机验证过，但没做跨版本矩阵）。
- **Windows**：未测。
- `/diff` 是 `git diff HEAD~1 -- <file>`，不是"那次提交"的差异。

## License

MIT

# dsh-plugin-soul

给 DSH 一个**可写、可回滚、每轮在场**的自我。不是设定一次的人格，是能长的那种。

## 四层能力

| 层 | 做什么 | 关键点 |
|---|---|---|
| **注入** | 每轮把 `~/.dsh/soul/*.md` 重新读一遍进 system prompt | `section.text` 是函数、每次 assembly 求值 → **改文件即生效，不用重启** |
| **自改** | `soul_update` 改可写文件 | 四道约束 + git + CHANGELOG + 可回滚 |
| **反思** | `soul_journal` 记观察 → `soul_dream` 把够格候选升格进 SOUL | 确定性闸门，不靠模型打分 |
| **升级** | `soul_propose_upgrade` → `soul_apply_upgrade` | 白名单 + `node --check` + 整体还原 |

外加设置页一个 **「人格」tab**：看四份配置、就地编辑（带 why）、看候选池/提交/diff。

## 为什么另做一个

`@deepseek-ai/dsh-persona` 的 config 只有 `prefix/suffix/complete/includeRuntimeContext`，**静态字符串**，改一次要动 patch + 重启。而 `dsh-system-prompt` 的 `section.text` 支持函数（`lib/index.js:187`，每次 assembly 求值）——这才是自迭代的接缝。

## 目录

```
lib/index.js      入口：注入段 + 11 个工具 + 设置页 HTTP API
lib/soul-store.js 存储：播种/预算/四道校验/git/CHANGELOG/回滚
lib/journal.js    日志与候选池：归一化、跨天计数、证据行号、升格闸门
lib/dream.js      反思：light 重算 → deep 合并升格 → 写 DREAMS.md
lib/upgrade.js    自我升级：提案目录、白名单、node --check、整体还原
lib/client.js     设置页「人格」tab（浏览器半侧）
templates/*.md    首次播种的初版人格
test/smoke.mjs    存储层 17 项
test/features.mjs 反思+升级 13 项
install.mjs       幂等安装（--dry / --apply）
```

## 工具（11 个）

| 工具 | 用途 |
|---|---|
| `soul_status` | 各文件字符/预算、今日额度、候选数、最近反思 |
| `soul_read` | 读原文（带行号），也支持 `DREAMS.md` / `CHANGELOG.md` |
| `soul_history` | 最近提交、某文件 diff、升级提案列表 |
| `soul_update` | 改可写文件（`content` 全量 或 `append` 追加，`why` 必填） |
| `soul_rollback` | 回到历史提交 |
| `soul_journal` | 记一条观察（便宜、不限次） |
| `soul_candidates` | 看候选池（是否够格、证据） |
| `soul_dream` | 跑反思；默认预览，`apply:true` 才写 SOUL |
| `soul_propose_upgrade` | 落升级提案（含改前快照） |
| `soul_apply_upgrade` | `confirm:"APPLY"` 才写；语法不过整体还原 |
| `soul_upgrade_rollback` | 从提案 `before/` 还原 |

## 约束

| 约束 | 值 | 为什么 |
|---|---|---|
| `RULES.md` | 只读（工具拒写） | 红线不随自迭代漂移 |
| 单次变更 | ≤ 800 字符 | 防一次改崩 |
| 每日自改 | ≤ 3 次 | 防刷屏式重写 |
| `why` | 必填 ≥4 字符 | 必须基于外部事实 |
| 升格闸门 | ≥3 次 且 跨 ≥2 天 | 防一次冲动就沉淀 |
| 注入预算 | 7000 字符（现约 2.1k ≈ 535 tok） | 每轮成本 |
| 升级范围 | 仅 `lib/**.js`、`templates/**.md` | package.json/patch/README 禁改 |

## 设置页「人格」tab

客户端插件注册 `settings.section`（`id: soul`, `order: 25`, `label: () => "人格"`），数据走同源 HTTP：

```
GET  /dsh-plugin-soul/api/state        文件+候选+提交+lastDream
GET  /dsh-plugin-soul/api/file?name=   原文
POST /dsh-plugin-soul/api/file         写（同一套四道校验）
POST /dsh-plugin-soul/api/dream        跑一次反思
GET  /dsh-plugin-soul/api/diff?name=   相对上一提交的 diff
```

## 安装

```bash
cd ~/www/dsh-plugin-soul
node install.mjs          # 预演
node install.mjs --apply  # 建 symlink + 追加 patch 行（自动备份）
```

然后**重启 DSH**（插件行只在重启后加载）。客户端 tab 改动刷页面（⌘R）即可。

> 当前状态（2026-10-26 10:5x）：host 侧已装（symlink + patch 行 + YAML 校验 30 项），`~/.dsh/soul/` 已播种（首提交 `738ca0b`）；`lib/client.js` 已就位并通过 mock 验证（`settings.section` id `soul` / order 25 / label 人格）；夜间反思已挂 daily 03:00（`schedule-a64d0c18`）。**重启 DSH 一次，工具、注入、设置页 tab 一起生效。**

## 数据

- 自我文件：`~/.dsh/soul/`（git 仓库，`git log` 即人格演化史）
- 候选池：`.candidates.json`｜反思记录：`DREAMS.md` 与 `.dream-state.json`
- 升级提案：`upgrades/<时间戳>-<slug>/{proposal.md,files/,before/,status.json}`
- 每日计数：`.state.json`｜临时换目录：`DSH_SOUL_DIR` 或插件 config `root`

## 坑

1. 注入文本会被宿主当模板插值，正文出现 `{{` 会整轮失败 → 渲染时已中和成 `{ {`。
2. **每次改自我都会打破 system prompt 的 KV cache 前缀**，成本略涨；所以"攒着改"，别每轮追加。
3. 客户端插件 `exports.inject` 只写 `["slots"]`；把插槽所属包名或不存在服务写进去 → 整个客户端插件不激活、tab 消失。
4. 注册 `slots.register` 必须包 try/catch：抛错会让 DSH 判 web failed、弹「应用文件缺失或损坏」。
5. 升级后**必须重启**才生效；本插件不会自己重启。

## 许可

私有项目，未发布。

# Pi harness 增强：官方参照与交互语义

**核查日期：2026-10-12（UTC）**  
**范围：** `/btw`、清空后恢复草稿、doctor / prompt-audit、完成时间、usage / skill-doctor、按块复制。仅研究与设计，不修改运行时代码。仓库原有 `docs/theme-palette-audit.md` 采用结论、证据、来源的结构；本记录沿用该结构，按任务要求放在 `docs/research/`。

## 结论

1. 六项需求都能找到明确的一方参照，但不是同一个产品、同一种实现，也不是所有旧版本都具有。
2. **`/skill-doctor` 现在是 Claude Code 官方命令**，不能笼统归为第三方插件。另有同名第三方项目，功能不同。当前官方文档给出的最低版本是 **v2.1.252**，且依赖 feature-flag fetching；第三方文章中的不同版本号不应覆盖官方文档。[C1][C3][T1]
3. **`/usage` 不等于 skills token 审计。** Claude Code 的 `/usage` 是成本、套餐额度与活动统计；Codex 当前源码的 `/usage` 是账户用量/额度重置，`/status` 才包含当前会话配置与 token 用量。skills 清单的上下文成本应单列。[C1][O1]
4. **`/doctor prompt-audit` 是 Claude Code 当前官方入口**；另有 `/claude-api prompt-audit`。审计目标是过时、冲突、失真的指令，不是机械缩短提示词。[C1][C3][A1]
5. **完成时间已经是 Claude Code 官方界面语义**：例如 `Cooked for 1m 6s · done 6:05 PM`。旧 issue 的功能请求不是“今天仍未实现”的证据。[C4][I1]
6. Pi 本身已有 `/copy`、Ctrl+C 清空/再次退出、会话 usage 展示。增强应补充缺少的语义，而非平行重建这些入口。[P1][P2]

## 证据边界

- Claude Code 以当前官方文档为准；记录最低版本及连接限制，不推断所有账号都会出现某命令。
- Codex 以官方仓库 `main` 源码为准。本次核查时 `main` 为 `97239fd052db455bd08c41afcdab738e0fe83b87`；下列源码链接固定到该提交。**源码存在不等于用户安装的稳定版已经发布。** 未进行本地 Claude Code / Codex 的实际操作验证。
- 搜索摘要仅作线索，结论均回到页面正文或源码；用户 issue 只证明请求/报告，不能证明官方已交付。
- Pi 依据本机已安装包的完整 README 及 `usage.md`、`keybindings.md`、`skills.md`、`extensions.md`、`tui.md`。在线 Pi 链接便于复查，但 `main` 可能与安装版本不同。这里只核查扩展能力，不承诺某个扩展已经实现。
- 下文“建议语义”是 Pi 设计选择，不冒充上游产品事实。

## 1. `/btw`：旁问，而不是悄悄追加主对话

### 已核实的官方语义

Claude Code `/btw`：

- 能在主任务运行时独立回答，不中断主 turn；看到已有对话、答复和工具结果，但看不到正在生成的答复。
- **没有工具访问**；不能靠它读取新文件、执行命令或搜索。
- 问答不进入主对话历史。终端以可关闭 overlay 展示；旁问线程在内存中，退出即丢失。
- 后续旁问可以看到此前旁问，当前文档规定重放最新 **20** 组；`x` 清除旁问线程，空参数 `/btw` 可重新打开最近结果。
- `c` 复制答案的原始 Markdown；当前版本可用 `f` 将问答 fork 给具有工具权限的后台子代理。[C2]

Codex 当前官方源码也有 `/side`、`/btw`，描述是 **“start a side conversation in an ephemeral fork”**，且允许任务运行中调用。**不能因此把 Claude 的“无工具、单次回答、overlay、20 组”自动套到 Codex**；本次只确认命令存在及 ephemeral fork 定位，未核实其完整权限/持久化契约。[O1][O5]

### Pi 建议语义

采用 Claude 式轻量旁问作为默认，避免用户把它误当成第二个自主执行代理：

1. `/btw <问题>` 在调用时快照当前分支的已完成上下文，不加入 user/assistant 主消息，不等待主任务结束。
2. 独立 model request，明确禁用所有工具；工具调用返回不能进入执行路径。若回答缺少资料，说明需要回到主任务读取，不伪装“已检查”。
3. overlay 的关闭仅影响展示；单独提供“取消本次旁问”。旁问取消不能取消主任务。保留原编辑器草稿。
4. 默认仅内存保留旁问线程，最多 20 组；清除、新会话、切换分支时不串线。持久化必须是显式选项。
5. 旁问仍产生 usage，单列并计入总量；不承诺一定“便宜”，成本取决于模型、上下文长度和缓存是否命中。
6. 如需“继续调查”，另设显式转入主对话/子代理动作，告知会获得工具访问、产生新费用以及如何合并结果。

Pi 扩展可注册命令、用 `ctx.modelRegistry.streamSimple()` 发起嵌套请求、用 `ctx.ui.custom({…}, {overlay: true})` 类能力展示独立界面。实际签名以类型声明为准；不要用 `sendUserMessage()` 冒充不会污染主上下文的旁问。[P4][P5]

## 2. Ctrl+C 清空，再按 Up 恢复

### 已核实的官方语义

- Claude Code：运行中 Ctrl+C 中断；空闲时第一次清空输入，第二次退出；在输入仍为空时按 Up 恢复清掉的草稿，官方文档标注 **v2.1.288+**。[C2]
- Codex 当前源码：`clear_for_ctrl_c()` 先 flush 输入/粘贴缓冲，再保存文本、text elements、图片路径、远程图片、mention bindings、pending pastes 到本地 history；清空动作还可能写入文本 history。`apply_history_entry()` 恢复相应状态。弹窗和历史搜索先处理取消，再考虑清草稿。[O2][O3]
- Pi 已定义 `app.clear = ctrl+c`（先清空/再退出）、`app.interrupt = escape`；Ctrl+C 同时可能是选择复制或菜单取消。现有文档**不足以证明清空草稿会完整恢复**，这里不把“未验证”写成“肯定没有”。[P2]

### Pi 建议语义

- 保留 Pi 既有 Escape 中断，默认不要为追求 Claude 同款而改变 Ctrl+C 的运行中行为。
- 优先级：当前弹窗/搜索取消 → 已有选择复制 → 主编辑器清空 → 已有退出规则。
- 清空前保存一份完整 draft snapshot：正文、光标、图片/附件、折叠粘贴块、输入模式、关联路径；只保存显示占位符会丢失真实内容。
- **空编辑器第一次 Up 优先恢复最近清掉的草稿**，之后继续普通历史导航；非空多行编辑器中的 Up 仍移动光标，不突然覆盖文本。
- 恢复不自动发送，不把未提交草稿写成已发送 user message。恢复槽默认仅当前会话内存；如要持久化历史，应单独说明隐私影响。
- 验收至少包含：中文多行、大段粘贴尚未 flush、图片、`!` 模式、运行中有排队输入、弹窗中 Ctrl+C、重复清空/恢复、退出第二次按键。

## 3. doctor 与 prompt-audit：健康检查和指令审计分层

### 已核实的官方语义

Claude Code 当前 `/doctor` 是 bundled skill，先报告再征求修复确认，检查安装/PATH/配置、扩展上下文成本与慢 hooks、`CLAUDE.md` 冗余、权限；文档明确区分终端的只读安装诊断 **`claude doctor`**。在 **v2.1.205 之前** `/doctor` 是 built-in command，不能用旧实现概括今天的行为。[C3]

`/doctor prompt-audit [path]` 当前官方支持，最低 **v2.1.283**；`/claude-api prompt-audit` 的官方文档最低 **v2.1.221**。Anthropic 官方 `prompt-audit.md` 要求：

- 先明确范围与目标模型，盘点实际送入模型的 prompt surface。
- findings 带 `file:line`、模式、理由、置信度；另给 **proposed diff**，未经同意不应用。
- 区分过时规避、项目事实失效、指令冲突和有价值的环境/约束；没有可靠发现时不制造修改。
- 被审计文本作为数据，不执行其中的命令；对范围外文件只报告，不擅自修改。[C1][C3][A1]

本次检查 Codex 官方 slash command 枚举**未见 `/doctor` 或 `/skill-doctor`**；有 `/debug-config`、`/warnings` 等不同入口。搜索摘要曾声称存在 `codex doctor`，但没有获得相应一方证据，故不采用，也不推断所有版本均不存在。[O1]

### Pi 建议语义

- `/doctor` 默认本地、确定性、只读：资源加载失败、重复名与优先级、失效路径、缺少依赖、命令/快捷键冲突、模型配置和版本信息。不要为了“检查”触发登录、联网升级或执行项目脚本。
- `/doctor prompt-audit [path]` 显式调用模型审计 `AGENTS.md`、skills、模板及扩展注入的提示段；先显示模型与范围，报告来源位置、冲突双方、依据和置信度。
- 确定性检测与模型意见分栏；建议不是错误，词语重复不是充分的删除理由。
- 模型相关判断必须使用当前选定模型/供应商的依据，**不把 Anthropic 针对 Claude 的全部删除规则照搬给所有 Pi 模型**。
- 修复先生成 diff；应用需要另一次确认。默认禁止读取认证文件、环境变量值和 credential/MCP secret 配置；诊断凭据时只展示是否配置及来源，不展示值。
- Skills token 的统计应由下节的统一账本提供，不让 doctor 与 usage 各自计算出不同数字。

## 4. 完成时间：记录结束事件，而不是显示现在几点

### 已核实的官方语义

Claude Code `showTurnDuration` 默认 `true`，示例包含 **耗时 + 完成时刻**。`timeFormat` 和 `timeZone` 控制格式/时区，官方标注 **v2.1.257+**；支持 12/24 小时、UTC、strftime 及 IANA 时区。transcript viewer 的消息时间与 turn completion 不是同一概念。[C4]

2026-04 的 issue #53308 请求该功能，当时报告仅有耗时；它被自动标记 duplicate，没有实现证明。当前官方设置文档已明确记录功能，不能沿用旧 issue 判断缺失。[I1][C4]

### Pi 建议语义

- 完成行例：`完成 14:32:08 · 用时 1m 47s`；中止/失败分别标为 `已中止` / `失败`，不能都显示“完成”。跨日或恢复旧会话时带日期。
- 壁钟时间在结束事件时固定并持久化为 UTC instant，显示时转换时区；耗时使用单调时钟，避免系统校时造成负耗时。
- 一次用户任务内多个 tool turns、重试、恢复和自动续跑，只在**真正停止继续运行**后记录总完成时间。Pi 文档指出 `agent_end` 后仍可能重试/恢复/compaction/排队继续；`agent_settled` 才是最终、仅通知的边界。[P4]
- 明确统计单位为“本次 harness run”；已有 follow-up 若启动下一 run，须产生自己的完成记录。不要把后台独立任务全部结束作为主 run 的完成条件。
- 可选相对时间 `12 分钟前` 是派生展示，不覆盖固定结束时间。嵌套 `/btw` 不应更新主任务的结束时刻。
- 历史数据若没有真实结束时间，显示“未知”，不要把 session entry 创建时间或当前时间冒充完成时间。

## 5. `/usage` 与 `/skill-doctor`：常驻开销、加载开销、实际账单分开

### 已核实的官方语义

Claude Code：

- `/usage` 汇总会话成本、套餐额度、活动 stats；`/cost`、`/stats` 为别名。[C1]
- `/context` 显示上下文占用和优化建议；Skills row 是**预算处理后实际列入清单的大小**，不是所有描述文件的总大小。[C1][C3]
- `/skill-doctor` 显示 skills 的 context cost 和使用频率；交互式在 `/plugin` 的 Stats tab，`-p` 输出文本。排除 bundled 与 enterprise skills，报告从未调用的清单项及禁用位置，也列出近期未用 plugins。Remote Control 不提供报告；需要在承载会话的机器终端运行。[C3]
- 当前 skill listing 保留全部名称；超字符预算时优先去掉调用少的描述。预算默认按 context window 的 **1%** 缩放，每项描述另有字符上限。这是 Claude 的实现，不是通用 token 公式。[C3]

同名第三方 **MindiveLabs/skill-doctor** 的 README 自述为 skills 冲突检测/解决，涉及遮蔽、触发重叠等，不能替代上述官方命令的出处。[T1]

Pi 文档明确：系统提示包含 skills 的 **名称、描述、路径**；完整 `SKILL.md` 在匹配任务时才读取。因此“所有 SKILL.md 字节数之和”不是 skills 常驻 token 成本。[P3]

### Pi 建议报告与账本

| 指标 | 精确定义 | 不应混淆为 |
|---|---|---|
| `advertised` | 当前实际 prompt 中名称、描述、路径及包装文本 | 磁盘 skill 全文 |
| `loaded` | 本次分支中读取的 SKILL.md / references 内容 | 已成功完成该工作流 |
| `retained` | 当前请求仍保留的 skills 内容，考虑裁剪/compaction | 累计读取字节 |
| `invoked` | 显式 `/skill:name` 或可靠识别的自动调用 | 仅名称出现 |
| `usage` | provider 报告的 input/output/cache 等请求用量 | 可精确归因到单个 skill 的账单 |

- `/usage` 首页保留会话真实 token/cost、provider 与模型；旁问/子调用独立明细且只计一次。套餐剩余额度没有官方接口时标 `不可用`，不从 token 总量反推。
- `/usage skills` 展示当前实际清单、常驻成本排序、全文大小、是否已加载/禁用、使用统计时间范围；`/skill-doctor` 在相同数据上给解释与建议，而不是另一套计费页。
- 优先当前模型 tokenizer；没有可靠 tokenizer 则标 `估算` 并注明方法，中文不能直接套“4 字符 = 1 token”。若调用远程 token-count API，须显式授权外发提示内容。
- 每项 token 独立计数未必与合并后精确相加，报告包装/分隔 overhead，必要时计算 `tokens(prompt) - tokens(prompt without item)` 的**估算边际贡献**；不要声称这是该 skill 的真实美元账单。
- 使用统计至少区分显式调用、可观察到的自动读取、统计缺口；零次调用意味着“观察窗口内未见”，不是“永远没用”。会话恢复或旧版本缺数据时标 unknown。
- 建议排序：高常驻成本 + 足够长观察期未用 → 手动调用候选；重复/触发描述高度重叠 → 合并审阅候选；描述冗长 → 保留触发关键字、把细节移到正文。安全/关键工作流不能仅因低频自动禁用。
- 展示每项来源、重复名遮蔽关系与生效版本/内容 hash。Pi 已支持 `disable-model-invocation: true` 的手动调用模式，但是否节省了清单成本应从**实际 prompt**验证，不按配置字段猜测。[P3]
- “每次请求携带”与“每次全额收费”不同；缓存会影响计费，compaction 会影响保留内容。报告必须把上下文占用和经济成本分列。

## 6. `/copy`：复制源文本，选择器只负责定位

### 已核实的官方语义

- Claude Code `/copy [N]` 支持第 N 个最近 assistant response；含 code blocks / blockquotes 时提供整条或块的 picker，`w` 将所选内容写文件，适合 SSH。[C1]
- Claude 的 `/btw` overlay 明确提供 raw Markdown 复制，以免鼠标选择得到终端硬换行。[C2]
- Codex 当前 `copy_picker.rs` 区分 Whole response（Markdown）、code block（PlainText）、blockquote（PlainText）；预览截短不影响 clipboard 源内容。这不是“所有 Markdown AST 节点均可复制”。[O4]
- Codex clipboard 源码区别 native 已确认复制与 OSC 52 等 terminal forwarding 的未确认请求；不能把“已发给终端”谎报为“用户剪贴板肯定写入”。[O6]
- Pi 当前已有 `/copy` 和 Ctrl+X 复制最近 assistant response，但上述文档未说明按块选择能力。[P1][P2]

### Pi 建议语义

1. 无参数保持复制最近完整 assistant 正文，**使用原始 Markdown，不从 ANSI/终端行反向拼接**；排除 thinking、工具输出及完成时间装饰。
2. `/copy N` 选择第 N 个最近完成的 assistant 正文；按当前分支查找，不复制别的 branch。无正文/编号越界时解释，不产生空成功提示。
3. 含多个块时可用 picker：全文、每个代码块、引用块；显示块序号、语言、首行预览。初版不承诺任意段落/表格/list 全可选。
4. 用户需求是 raw Markdown：默认全文/引用块保留原 Markdown；代码块明确区分 **代码内容（去围栏）** 和 **原始块（保留围栏及语言）** 两个选项。这是 Pi 的显式契约，不把上游 PlainText 块语义混称为 raw。
5. 解析基于源位置/range；保留换行、缩进、空行、长内容，预览 wrap/truncate 绝不能改变实际 payload。多个 assistant text segments 的边界规则也需固定。
6. 本地剪贴板、远程 OSC 52、写文件各自报告结果；不允许时给 `/copy --file <path>` 的显式导出替代。文件写入需防覆盖确认，不能关闭 picker 就默认落盘。
7. 活跃流式回答要么禁止复制并解释，要么显式“当前快照”；默认不把上一个 turn 与正在生成内容混起来。取消 picker 不改主编辑器草稿。

## 分层落地与验证建议（非实现结果）

| 层级 | 内容 | 优先验收条件 |
|---|---|---|
| 编辑器/宿主状态 | Ctrl+C 草稿恢复 | 附件、粘贴、输入模式不丢；不抢占选择复制 |
| 渲染与非上下文元数据 | 完成时间、raw copy picker | 重试/续跑不提前完成；resize 不改复制 payload |
| 确定性资源诊断 | usage skills、doctor 基础检查 | 使用实际生效 prompt；不读取/泄漏 secrets |
| 独立模型工作流 | `/btw`、prompt-audit | 旁问无工具且不污染主历史；审计仅提案、不自动改配置 |

Pi 扩展文档支持命令、嵌套模型请求、widgets/overlay、`appendEntry()` 的非模型上下文数据，以及生命周期观察；这些是可用接缝。**编辑器完整 draft snapshot、原生命令冲突及 provider 用量归集仍需实现前核查具体类型/源码**，不能据“有扩展 API”就保证全部可由单个插件无损实现。[P4][P5]

本研究未运行 UI 交互、tokenizer 对照或功能测试；只创建此文档。后续实现前，应以本机版本为目标核查快捷键、命令注册优先级、真实 system prompt 结构和最终 settle 事件。

## 来源

### Claude Code / Anthropic 一方

- [C1] [Commands](https://code.claude.com/docs/en/commands)：`/btw`、`/copy`、`/doctor`、`/usage`、`/skill-doctor`、`/context`。
- [C2] [Interactive mode](https://code.claude.com/docs/en/interactive-mode)：General controls、Side questions with /btw、raw Markdown 复制。
- [C3] [Extend Claude with skills](https://code.claude.com/docs/en/skills)：Check your setup with /doctor、Find unused skills、Skill descriptions are cut short、Work on Claude API projects。
- [C4] [Settings reference](https://code.claude.com/docs/en/settings-reference#showturnduration)：`showTurnDuration`、`timeFormat`、`timeZone`。
- [A1] [anthropics/skills: prompt-audit.md](https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/prompt-audit.md)：官方审计工作流，范围、模型、证据与 proposed diff。

### Codex 一方源码（固定提交）

- [O1] [slash_command.rs](https://github.com/openai/codex/blob/97239fd052db455bd08c41afcdab738e0fe83b87/codex-rs/tui/src/slash_command.rs)：命令枚举、说明、任务运行中可用性。
- [O2] [bottom_pane/mod.rs](https://github.com/openai/codex/blob/97239fd052db455bd08c41afcdab738e0fe83b87/codex-rs/tui/src/bottom_pane/mod.rs)：`on_ctrl_c`、`clear_composer_for_ctrl_c`。
- [O3] [chat_composer.rs](https://github.com/openai/codex/blob/97239fd052db455bd08c41afcdab738e0fe83b87/codex-rs/tui/src/bottom_pane/chat_composer.rs)：`clear_for_ctrl_c`、`apply_history_entry`。
- [O4] [copy_picker.rs](https://github.com/openai/codex/blob/97239fd052db455bd08c41afcdab738e0fe83b87/codex-rs/tui/src/chatwidget/copy_picker.rs)：全文/code/quote 的复制 payload 与预览分离。
- [O5] [side.rs](https://github.com/openai/codex/blob/97239fd052db455bd08c41afcdab738e0fe83b87/codex-rs/tui/src/chatwidget/side.rs)：side conversation 界面状态；完整线程生命周期在 app::side，不在本次核查范围。
- [O6] [clipboard_copy.rs](https://github.com/openai/codex/blob/97239fd052db455bd08c41afcdab738e0fe83b87/codex-rs/tui/src/clipboard_copy.rs)：Markdown/plain text、native 与 terminal forwarding 结果区分。

### Pi 一方文档

本机路径共同前缀：`/home/kun/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/`。

- [P1] [docs/usage.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md)：复制、usage、排队和中断。
- [P2] [docs/keybindings.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/keybindings.md)：clear、interrupt、selection copy、history actions。
- [P3] [docs/skills.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)：清单常驻、全文按需读取、手动调用、重复名。
- [P4] [docs/extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)：注册命令、嵌套调用、usage、状态存储、`agent_settled`。
- [P5] [docs/tui.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md)：overlay、editor 与输入焦点的契约。

### 同名第三方及用户报告（不冒充官方功能证据）

- [T1] [MindiveLabs/skill-doctor README](https://github.com/MindiveLabs/skill-doctor)：第三方 skills 冲突检测工具，与官方 usage/context report 不同。
- [I1] [Claude Code issue #53308](https://github.com/anthropics/claude-code/issues/53308)：旧的完成时间功能请求，closed as duplicate；仅作历史对照。

# Pi harness 增强：讨论稿

状态：历史设计研究（实现已完成，仍需真实终端/账号验收）。使用说明以 [README](../../README.md) 和以下最终边界为准。后文早期提案保留研究原貌，不是实现规范；尤其 doctor、旧命令名和“带回主对话”操作均未实施。

最终边界：`/btw 问题` 新建当前模型、已完成主上下文快照的无工具旁问；无参数重开，overlay 中可继续对话/New，Close 与 Cancel 分离，主任务继续，旁问仅当前 session 内存。完成信息为 `finished/stopped/error · HH:mm:ss · 1m24s` 独立非上下文持久条目，在真正 settled 后显示。草稿恢复集成现有 ChatInput。订阅查询只有 `/codex-plan-usage`；复制增强只有 `/copy-block`，保留原生 `/copy`。两个中文 skills 独立，只给审查/变更提案；token-analyze 分析当前 PROJECT 有效全局+项目配置和默认近 30 天项目工具/skill 历史频率，不汇总当前对话用量。数据缺口、估算和动态快照限制必须明确，不读取秘密、不自动修改配置。

## 已确认决策

1. 不做 doctor skill，也不以 doctor 作为统一入口。
2. `prompt-audit` 是独立 skill：审查提示词质量、过时约束和冲突，先提出建议，不自动修改。
3. `token-analyze` 是独立 skill：统一分析实际注入模型的 system prompt、工具提示词/声明/schema、skills 索引与相关注入内容，统计占用并提出效率优化建议。关注会话开头或各轮请求的注入成本，而不是订阅额度；区分初始状态、动态变化和最近请求快照，不假定每轮重新追加完整文本。
4. token-analyze 只将实际注入的 skill 索引计为常驻成本；按需加载正文单列，不把磁盘上的全部 skill 文件当作常驻开销。实测请求总量与各部分估算分开，说明缓存对收费的影响。
5. 订阅查询已改为 `/codex-plan-usage`，无旧别名，避免与 token 审计混淆。
6. 复制增强采用 `/copy-block`，保留原生 `/copy`。全文/章节/引用保留 Markdown 原文；代码块只复制代码内容，不含围栏或语言标签，不额外提供围栏选项。

### Skill 与数据采集的实现边界

对用户只暴露上述两个 skills，不额外做 doctor。`token-analyze` 需要可靠的运行时输入：仅从仓库文件推测不能保证还原扩展动态注入、当前生效工具声明或 provider 转换后的请求。实现时优先复用 Pi 可观测数据；若 skill 无法直接取得，则配一个小型本地采集辅助模块，输出带来源及估算方法的报告供 skill 分析。辅助模块不是另一个面向用户的诊断入口，不默认常驻增加大型工具说明。具体采集接口待验证后定。

报告建议按“来源 → 生效范围 → 估算 token → 占比 → 优化建议 → 语义风险”展示；缺失数据明确标未知，不能声称看到了隐藏或服务端内部 prompt。优化目标是有效使用 token，不以最短文本为唯一目标。

## 早期提案（以下为 superseded 研究记录）

## 设计原则

- 优先扩展，不 fork Pi，不修改安装目录；实际安装版本与项目兼容版本都需要确认。
- 本地检查和 UI 功能不调用模型，不向模型注册无必要的工具。
- 模型消费的上下文、会话持久记录、终端显示是三种不同的数据，不能混用。
- 数字标注来源：provider 实测、tokenizer 估计、字符估计、无法观测。不把估计解释成账单。
- 以下命令与交互是提案，不代表其他 harness 已有同名功能。

## 1. `/btw <问题>`：隔离旁路问答

建议第一版：主任务继续运行，旁路使用触发时的上下文快照；独立流式 UI；不向主 agent 发 steering 或 follow-up。默认无工具，不执行修改；明确提示旁路仍消耗 token。允许取消旁路而不取消主任务。

旁路回答不自动进入主会话的模型上下文；可提供“带回主对话”操作，由用户显式确认后提交选中内容。使用什么范围的上下文、是否保留旁路历史待用户确定。建议默认使用当前可见上下文的受限快照，不以便宜模型作为强制默认。

实现候选：`registerCommand`、`ctx.modelRegistry.streamSimple()`、`ctx.ui.custom()`。仍需核对运行中命令调度、provider 认证与请求上下文格式；不能以 `sendUserMessage` 假装隔离问答。独立 AbortController，session shutdown/reload 清理。

## 2. 清空后 Up 恢复草稿

建议语义：清空非空编辑器前保存临时草稿；编辑器为空时第一次 Up 恢复；后续按原有历史导航规则。恢复不发送，不落入已提交消息历史；输入新内容后不覆盖用户输入。

不劫持全局 Ctrl+C：全屏选择复制、对话框取消、空编辑器退出仍按原行为。尊重 `app.clear` 的实际绑定，不硬编码 Ctrl+C。多行、粘贴占位、附件、连续清空、切换会话与已有 editor 扩展冲突需要单独验证。第一版草稿只保存在内存。

公开扩展点候选是 `CustomEditor` / `setEditorComponent`，但只允许一个自定义主编辑器，需优先复用仓库已有实现或建议上游小改动，不能无条件覆盖。

## 3. 每轮结束显示时间

建议把“轮”定义为一次用户任务及其工具调用/自动恢复结束，不是每次 LLM 请求。显示本地时间和耗时，例如 `完成于 14:32:18 · 耗时 1m 24s`；错误、中断不伪装为成功。

当前 Pi 文档明确 `agent_end` 后仍可能继续自动重试、压缩或处理队列；`agent_settled` 才是最终通知边界。因此用真正收尾事件驱动 UI，开始时间与状态需结合实际类型和调用链核对。

不把时间戳添加到 assistant Markdown 正文，避免污染复制内容、模型上下文和缓存。第一版可用独立 widget；如果要求每条历史回答后永久保留，进一步验证 session entry renderer 与持久化方案。

## 4. `/doctor`、`/prompt-audit`、`/usage`

共享数据采集与报告模型，避免各自扫描和计算，但命令职责分离：

- `/doctor`：确定性健康检查，例如版本能力、扩展/命令/快捷键冲突、加载失败、技能 frontmatter/链接/重名问题、剪贴板可用性。
- `/prompt-audit`：当前请求可观测上下文拆分，来源定位，常驻成本和可改进项；技能分析作为子视图。
- `/usage`：模型请求实测累计消耗、最近请求上下文量、缓存相关字段；订阅剩余额度是单独可选 provider 能力，不能从 token 累计反推。

审计至少区分：

1. 系统指令：内置说明、AGENTS、SYSTEM/APPEND_SYSTEM 与扩展动态注入。
2. Skill 常驻索引：名称、描述、路径；未加载正文只显示潜在成本。
3. 工具：当前模型真正看到的声明、schema、codemode 内联声明，不是所有已注册工具的简单相加。
4. 对话：用户消息、assistant 文本、工具结果、按需读入的 skill/reference 内容。
5. 压缩摘要和不可可靠归属的内容。

必须说明快照是“最近请求”还是“下一次请求预估”。资源已经改动但未 reload、动态工具曝光、扩展覆盖完整 prompt、provider 重写 transcript 都会影响准确度。不能保证准确还原服务端最终 token 分桶。

静态建议附证据、文件路径、预估收益和代价，例如：重复说明、过长 skill 描述、大工具结果、只偶尔需要的工具是否适合 deferred/codemode。不得仅因描述相似就断言冲突，也不自动压缩或改写安全约束。LLM 语义分析若需要，应是显式 opt-in，并说明额外 token 与数据发送范围。

## 5. `/copy`：Markdown 原文分块复制

Pi 已有 `/copy` 和 `app.message.copy`（默认 Ctrl+X），可以复制最后 assistant 消息，快捷键还支持树中所选消息。因此增强重点是内容选择，不抢占已有整条复制。扩展命令是否能安全增强原生 `/copy` 尚需核对 dispatch；第一版可命名 `/copy-block` 避免同名冲突，而非默认覆盖内置命令。

建议流程：选择最近一条/历史 assistant 回复 → 整条、标题章节、段落、代码块 → 预览 → 复制。第一版可先实现整条 + 标题章节 + 代码块。

从会话中的原始 assistant text 取内容，不读终端 ANSI 或渲染后的折行文本。Markdown 解析只为定位区间，复制时使用源文本切片，保留缩进、表格和换行；整条回复保持 Markdown 原文，但单选代码块时只复制代码内容，不含围栏与语言标签。默认排除 thinking、工具结果、UI 时间戳。源码区间重叠和多选顺序需明确。

剪贴板优先复用 Pi 能力；SSH/OSC52、本机程序失败、超长文本应报告真实结果，并提供保存文件等显式备选，不能声称已复制到系统剪贴板。

## 仓库复用点（源码复核）

- `extensions/ui/chat-input.ts` 已有 `ChatInput extends CustomEditor`，当前主要重写 render。草稿恢复应整合到此处，不另装主编辑器。
- `extensions/ui/footer/index.ts` 的 `collectUsage` 只遍历当前 branch 的 assistant usage，不是完整会话账本；未来侧路调用、工具内嵌调用、其他分支等不能假定包含在内。可复用展示，但需明确统计范围。
- `extensions/openai-usage.ts` 已注册 `/usage`，用于 OpenAI ChatGPT/Codex 订阅用量，并支持脱敏 JSON。保留此命令语义，不重复注册。上下文成本分析放 `/prompt-audit`，请求用量详情可另设视图或在明确设计后扩展现有命令。
- `package.json` 当前开发依赖固定 Pi `0.82.1`，实现前需对照该版本类型，而不只依据全局安装文档。

## 优先级提案

1. 完成时间和 `/copy`：独立、低风险、直接改善体验。
2. 草稿恢复：先确认现有编辑器和 core 行为，避免第二个 editor 争用。
3. doctor + prompt audit：先静态确定性检查和标注估计的报告，再语义建议。
4. btw：在上下文范围、并发、取消、用量记账达成一致后实施。

各阶段可独立启用。不要为了六个功能先搭建一个泛化插件框架。

## 依据

已完整阅读本机 Pi 文档与 editor 示例（安装根目录 `/home/kun/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent`）：

- [Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)：事件收尾边界、nested model calls、工具曝光、会话存储、UI 模式。
- [Terminal UI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md)：CustomEditor、overlay、focus、渲染约束。
- [Skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)：skill 索引与按需加载、名称冲突和校验。
- [Keybindings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/keybindings.md)：app.clear、历史导航、app.message.copy、全屏优先级。
- [Settings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)：codemode inlineBudget、defaultTools、资源配置。
- [Configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md)：AGENTS 与 SYSTEM 发现规则。
- [Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)：独立资源启用与包结构。
- 本机 `examples/extensions/modal-editor.ts`：继承 CustomEditor 并透传未处理按键的实现示例。

在线 main 可能与本机安装版本不同，实施时以目标版本导出类型和行为测试为准。其他 harness 对照见 [官方参照研究](./harness-feature-references.md)。已核实 Claude Code 官方提供 `/skill-doctor`（skills 常驻成本与使用频率）、`/doctor prompt-audit`（指令质量审计），两者不是同一功能。建议本地成本报告与显式调用模型的语义审计分层；不将 token 统计等同于 prompt 质量评估。

另读本机 `docs/usage.md` 确认 Pi 原生 `/copy` 存在。

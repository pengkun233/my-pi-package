---
name: token-analyze
description: 分析当前项目有效 Pi 配置的 token 成本、动态注入及工具/skills 近 30 天使用频率；分析上下文配置开销或能力使用情况时使用，不是当前对话用量报告。
---

# 项目 token 分析

分析当前 PROJECT 的有效 Pi 配置及改进空间，不是当前会话 token 报表，也不是 Codex 套餐额度查询（后者为 /codex-plan-usage）。

## 采集与边界

1. 默认当前项目（Git 根目录及子目录）、近 30 天。用户指定范围/窗口时采用指定值。先运行本 skill 目录下 `scripts/report.mjs`：
   `node <skill目录>/scripts/report.mjs --cwd <当前目录> --days 30`。
   路径应按 shell 规则引用；可指定 `--agent-dir`、`--session-dir` 来覆盖宿主目录。辅助脚本是本地、确定性、只读分析，不调用模型/远程 token API、不读 auth 或秘密环境变量。
2. 优先现有会话 JSONL 的历史证据，再补充包内 token-analyze 扩展的最小元数据。扩展不注册额外工具，也不向主 prompt 注入审计说明；只存长度/估算/hash/来源路径和 skill 读取事件，运行时数据在 agent 目录，不在项目仓库。
3. 验证快照 `cwd/sessionId/observedAt/phase`：它是该项目最近一次可观察请求，可能来自另一个会话/子目录，并非磁盘配置改动后的下一请求。快照缺失或过时就说明未知，建议用户 reload 后触发主请求，或仅提供明确标为静态候选的文件审查；不要假装已获得运行时配置。读取本机 Pi 配置文档核实 AGENTS 与 SYSTEM/APPEND_SYSTEM 发现和优先级，区分 CLI 覆盖、未 reload 和扩展动态变化。
4. 若需要解释来源，再定向读实际生效指令与扩展注入源码。snapshot 不保存原文；不要读取认证文件、整份带密钥配置或宣称知道隐藏/服务端 prompt。快照中的注册工具目录只代表候选；active 标记也不证明最终 wire 声明。优先 wire 快照的声明（如果可观察），codemode 内联说明包含在其 description，别再重复计数。最终 provider 重写/后续 handlers 未知时写明。

## 报告结构

- **系统**：有效 system 总量与 base 差异，AGENTS 等 contextFiles、SYSTEM 替换、APPEND、工具 snippets/guidelines、扩展注入/覆盖。base 是 collector 在 before_agent_start 位置观察的 prompt，可能已经包含更早 handlers 的改动，不是纯磁盘静态基线；差异不等于能精确归属某个扩展，零差异也不证明没有动态注入。
- **工具**：实际 wire 声明或已标注限制的目录估算，描述/schema/codemode 包装；运行时动态曝光与初始静态配置分开。
- **Skill 常驻索引**：实际列入 prompt 的名称/描述/路径/包装，检查 presentVerbatim。单项估算包含共享包装，不能直接相加当作精确总量。被隐藏/未加载正文不算常驻开销。
- **按需正文**：bodies 是当前磁盘正文的潜在加载估算，历史读取次数是另一指标；不声称全部已加载或压缩后仍 retained。不要将全文总大小混入索引成本。
- **历史工具**：`history.tools` 的调用次数、成功/失败/未完成、direct/nested/collector 来源、会话覆盖数和最后见到日期。按会话与 call ID 去重：有结果用结果时间，否则按发起时间计为未完成；nested 时间是父工具结果时间。缺失 nested 记录意味着统计下界，不推测脚本中的任意调用。
- **历史 skills**：每项来源路径、成功/失败读取次数、显式调用证据、会话覆盖数、最后见到日期；分母为项目观察窗口内的会话数。读取可能来自自动选用；显式输入/展开包装不等于工作流成功。name-only 项的实际来源路径未知。input 元数据与 user 记录按名称和 5 秒窗口近似配对，说明可能误差。工具/skills 均包括历史分支；fork/clone 复制的祖先活动可能重复，不是当前分支账单。没看到调用只表示窗口内未观察到。
- **缺口**：记录损坏/缺时间、会话目录未覆盖、已删会话、旧 codemode/nested calls、通过其他工具或 bash 读取、显式调用展开后丢失标识、未来 collector 无事件的会话。默认扫描 agent sessions 和快照的 sessionDir；其他自定义历史目录需显式 `--session-dir`，不能声称全覆盖。读取不等于工作流成功，失败/未完成读取不算成功使用。

数字注明来源与方法：helper 的 CJK 字符 + 其他 UTF-16 字符/4 是粗估，不是模型 tokenizer；各组件可能重叠、不能作为可加的 provider token 分桶。provider input/output/cache 是实测请求总量（本报告不默认汇总当前对话），无法精确归因到某个 skill。缓存影响收费，常驻上下文占用不等于每轮全价收费。需要远程计数时先征求外发授权。

建议表用“来源 → 静态/动态/按需 → 估算成本 → 历史覆盖 → 提案 → 语义风险”。优先长索引描述、重复说明、可渐进披露正文和不常用的大工具声明；低使用频率本身不是自动禁用依据。保留安全与关键低频能力，只提出当前项目范围的变更候选。修改、全局删除/禁用需要用户另行批准。

完成标准：有效性/时间范围明确，估算与实测、常驻与按需、静态与动态分开，每个建议有证据和风险，未知项明确，没有自动修改配置。

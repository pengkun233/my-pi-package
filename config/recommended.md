# Herdr 与 Pi 推荐配置

这是其他机器安装、更新或同步配置时供 Agent 阅读的建议，不是自动执行策略。按当前机器的版本、已有配置和用户偏好决定采纳、调整或跳过；包更新本身不应用这些建议。

## 采纳流程

1. 先读本文件，再按需读取下方参考文件。检查目标机器的 Pi / Herdr 版本、实际配置路径和已有包，完成后应能说明每项建议是否适用。
2. 在用户授权的安装或同步范围内，自行选择兼容的建议；已有明确偏好优先。涉及覆盖偏好、删除资源、替换包或停止会话时，集中确认真正有冲突的部分。
3. 修改前备份目标文件，只合并选中的字段或段落，保留无关配置、资源过滤器和机器专属设置。仅请求审阅时只报告建议。
4. 校验修改后的格式与功能，按需重载。报告已采纳、跳过及原因；没有必要的差异就不修改。完成标准是选中项通过验证，其他配置保持原样。

## Pi

- **本包**：需要本包功能时使用 `pi install git:github.com/pengkun233/my-pi-package`。不固定 ref 便于后续更新；保留目标机器可用的 HTTPS / SSH 访问方式。先检查是否已注册同一仓库，避免重复加载。
- **更新**：用当前 Pi 支持的命令更新包；本机文档支持 `pi update --extensions`。更新后重新阅读本文件，配置建议不会自动合并到机器配置。需要加载资源变化时使用 `/reload` 或重启 Pi。
- **主题**：推荐 `slop`，可通过 `/settings` 选择；目标机器已有主题偏好时保留。主题与资源清单以 `package.json` 和 `themes/` 为准。
- **附加包**：需要 web、MCP、RTK、子代理、图像生成等能力时，参考 [packages.json](packages.json) 的候选来源，逐项确认是否需要及当前兼容性。这是参考清单，不是可直接覆盖 `settings.json` 的结构，也不是必须全装的依赖。
- **技能过滤**：若采纳 `packages.json` 中的 `mattPocockSkills`，将该对象作为 Pi `packages` 数组中的一项，保留精确技能路径和空的 extensions/prompts/themes 过滤器。先核对指定 ref 中路径仍存在；保留用户自己的资源开关。
- **子代理兼容**：参考清单中的 `npm:pi-subagents` 与 Herdr 计数所验证的 `@tintinweb/pi-subagents` 不是同一包。需要机器人任务标记时核对实际安装包是否提供 `subagents:started/completed/failed` 事件；不要默默替换已有子代理包。
- **全局交互偏好**：需要中文、语音输入容错及任务推进约定时，参考 [global-agents.md](global-agents.md)，按授权合并到实际 agent 目录下的 `AGENTS.md`。Pi 的包资源发现不会自动加载此参考文件。旧安装脚本留下的 managed block 现在只是普通文本；按内容合并，避免重复，保留用户其他指令。
- **外部依赖**：RTK 优化器需要可用的 `rtk`；Codex 相关功能需要目标机器自己的登录；MCP 和 web provider 需要各自配置。只在需要时配置依赖，不从另一台机器复制凭据。

Pi 全局配置通常位于 `~/.pi/agent/settings.json`，项目覆盖位于 `.pi/settings.json`；先核对当前版本和环境是否改变 agent 目录。保留模型、provider、密钥、路径和本地扩展设置。发现与本包重复的旧扩展、技能或 UI 时先说明冲突，不自动删除。

## Herdr

完整偏好样例在 [herdr/config.toml](herdr/config.toml)，仅作参考，**不整文件覆盖目标机器**。以下行为核对于 Herdr 0.9.0；其他版本以安装的 CLI 和官方配置文档为准。

| 配置范围 | 建议 | 适用条件 |
| --- | --- | --- |
| `ui.sidebar.agents` 与 `rows_by_agent.pi` | 第一行显示状态、青色加粗机器名、workspace、tab；Pi 第二行显示任务标记与会话名 | 需要区分机器并启用本包 Herdr 状态扩展 |
| `machine` 字段 | 通用与 Pi 覆盖布局都保留 | Herdr 在只有本机时省略此字段；多机器时用于区分来源 |
| `$pi_task_mark` / `$pi_session_name` | 保留样例字段名和样式 | Pi 在 Herdr 内运行，状态扩展正常上报元数据 |
| 主题与快捷键 | Dracula、直接 workspace/tab/agent 导航作为候选 | 与目标机器终端、输入法和既有按键习惯兼容 |
| `prefix+a` launcher | 仅在辅助程序存在时采纳 | `~/.local/bin/herdr-new-pi` 是机器本地脚本，本包不提供 |
| 持久化选项 | 按样例考虑关闭 pane history 和 agent 自动恢复 | 先确认用户是否依赖历史或重启恢复；与侧边栏同步无关时保持原样 |

- 只同步侧边栏时，合并上述两个 TOML 段，保留其他 agent 的专用覆盖。无需改 Pi 插件或重置整个 Herdr 配置。
- 字段间的 ` · ` 分隔符由 Herdr 控制；样例不提供冒号分隔、机器分组标题或折叠功能。
- 核对实际配置路径（默认 `~/.config/herdr/config.toml`，可能由 `HERDR_CONFIG_PATH` 覆盖）。在允许控制该 Herdr 会话的环境中，修改后用 `herdr server reload-config` 热重载，检查 `status: applied` 且无诊断错误。不要为同步配置停止服务或 pane。
- 若字段不显示，先区分元数据未上报和 sidebar 未引用字段；同时核对 Pi 专用布局是否覆盖通用布局。保留 Herdr 管理的生命周期集成。
- machine profiles、SSH aliases、密钥、会话文件和机器路径均留在各自机器，本参考不负责同步它们。

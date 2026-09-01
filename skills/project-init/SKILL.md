---
name: project-init
description: 初始化项目目录、Git 仓库和精简的项目文档体系。
disable-model-invocation: true
---

# 初始化项目

把用户指定的路径作为项目目录；没有指定时使用当前目录。

保持脚手架精简：避免过度设计，尤其避免过度防御。只处理本流程明确要求的文件，不扩展语言、框架或包管理器脚手架。

## 探索

检查目标目录及已有的 `AGENTS.md`、`CLAUDE.md`、`README.md`、`ai_docs/`、`docs/agents/`、`CONTEXT.md`、`CONTEXT-MAP.md` 和 `docs/adr/`。从已有项目文件推断项目名称、介绍、安装方式和使用方式；没有证据时保留简短占位内容，不虚构信息。

探索完成标准：已知道目标路径、现有文档以及每个目标文件将被创建还是合并。

## 起草并确认

向用户一次性展示：

- 目标路径，以及将执行的 `git init`；
- 将创建或修改的文件；
- `AGENTS.md` 的完整草案；
- 其他文件的内容摘要；

已有文件保留无关内容，把新内容合并到对应章节。若已有 `CLAUDE.md` 包含仍适用的项目规则，先将它们纳入 `AGENTS.md` 草案，再以软链接统一入口。用户明确确认后再写入。

`AGENTS.md` 保持精简，只包含：

```markdown
# Agent Instructions

## 设计原则

- 避免过度设计，尤其避免过度防御。

## 项目文档

- 项目介绍和使用方法见 `README.md`。
- 当前状态、阻塞和下一步见 `ai_docs/progress.md`。
- 参考文件、外部代码库和资料入口见 `ai_docs/reference.md`。

```

具体状态和决策写入其权威文件，不写入 `AGENTS.md`。

起草完成标准：四个文档都有最终草案，现有内容的合并方式清楚，用户已明确确认。

## 写入

1. 创建目标目录并在其中运行 `git init`。
2. 创建或合并 `AGENTS.md`。
3. 创建 `CLAUDE.md -> AGENTS.md` 软链接（如果有）。
4. 创建或合并 `README.md`。新项目至少包含项目名称、简介、安装和使用章节；已有项目尽量写入可由仓库验证的真实信息。
5. 创建 `ai_docs/reference.md`：

```markdown
# Reference

## Project files

## External repositories

## Other references
```

6. 创建 `ai_docs/progress.md`：

```markdown
# Progress

## Current status

## Completed

## Blockers

## Next steps
```

所有生成的 Markdown 文件使用中文，保持在 200 行以内。

写入完成标准：Git 仓库已初始化，四个文档存在，已有无关内容保持不变。

## 完成

列出创建和修改的路径。随后运行 `/skill:setup-matt-pocock-skills`

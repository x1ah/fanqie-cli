# Fanqie CLI

[![Tests](https://github.com/x1ah/fanqie-cli/actions/workflows/test.yml/badge.svg)](https://github.com/x1ah/fanqie-cli/actions/workflows/test.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

面向番茄小说作者的命令行工具。从本地 Markdown / TXT 文件上传章节，管理草稿、分卷和发布状态，适合在本地写作后批量更新作品。

首次通过浏览器手动登录，之后可直接在终端完成日常操作。支持多本作品，每本书可以使用自己的正文目录和分卷。

> **`upload` 只保存草稿，`publish` 才提交审核。** 提交审核不等于已发布，请用 `publish-status` 查询结果。

[功能](#功能) · [安装](#安装) · [快速开始](#快速开始) · [命令参考](#命令参考) · [常见问题](#常见问题) · [参与开发](#参与开发)

## 功能

- **章节上传**：检查章节格式，批量保存草稿，并核对后台的标题、正文和所属分卷。
- **草稿管理**：修改已核对的草稿、调整草稿所在分卷，保留原章节，不重新创建。
- **分卷管理**：查询、新建和重命名后台分卷，设置与本地目录的对应关系。
- **发布与查询**：将选定草稿提交审核，分别报告草稿、审核中、已发布等状态。
- **作品简介**：从本地文字文件更新简介，核对其他作品资料未被改动。
- **异常恢复**：记录操作进度，遇到超时或中断后先查询结果，避免重复上传或提交。

当前支持普通免费章节的立即提交审核，不支持定时发布、收费设置、作者有话说，以及修改或移动已发布章节。

这是独立维护的非官方工具，使用番茄作家网页接口。网站变更可能影响功能，请仅用于自己有权管理的作品。

## 安装

需要 [Node.js](https://nodejs.org/) **22 或更高版本**（含 npm）。首次登录默认使用 Google Chrome。

```bash
npm install -g 'git+https://github.com/x1ah/fanqie-cli.git#v0.5.3'
fanqie --version
fanqie --help
```

没有 Chrome 时，可改用 Playwright Chromium，配置方法见[浏览器设置](docs/commands.md#浏览器设置)。

## 快速开始

### 1. 添加作品并登录

先在番茄作家后台创建作品和至少一个分卷，再创建本地写作目录：

```bash
mkdir -p 我的写作目录/新书/正文/第一卷
cd 我的写作目录
fanqie init
fanqie add 新书 --title '后台实际书名' --source './新书/正文'
fanqie login
```

`新书` 是作品简称，后续命令都用它。`--title` 必须与后台实际书名一致。浏览器打开后，手动登录，再回到终端按回车。

设置本地分卷与后台分卷的对应关系。请替换下面的示例网址和卷名：

```bash
fanqie bind 新书 \
  --url 'https://fanqienovel.com/main/writer/chapter-manage/123456789' \
  --volume 第一卷 --remote-volume '第一卷：开篇'
fanqie volumes 新书
```

其中，`--volume` 是本地正文目录下的卷目录名，`--remote-volume` 是后台完整卷名。

### 2. 准备章节文件

创建 `新书/正文/第一卷/第001章_出发.md`：

```text
# 第001章 出发

这里是第一段正文。

这里是第二段正文。
```

- 文件名与首行的章号、章名须一致。
- 全书章号连续，换卷不重新从第1章编号。
- 正文使用纯文字段落，不放 Markdown 排版、注释或写作笔记。
- TXT 文件同样支持，首行可以省略 `#`。示例仅演示格式，实际章节长度以平台要求为准。

### 3. 检查并上传草稿

```bash
fanqie check 新书 --volume 第一卷 --chapters 1
fanqie plan 新书 --volume 第一卷 --chapters 1
fanqie upload 新书 --volume 第一卷 --chapters 1
```

`check` 检查文件格式，`plan` 预览上传内容，二者都不连接后台。`upload` 保存草稿后会重新读取后台内容，核对成功才记录为 `verified`；这不表示已发布。

批量处理时，`--chapters` 可填 `1-3` 或 `1,3-5`。一次处理一个分卷。

### 4. 提交审核并查询结果

确认要发布时，先预览，再提交：

```bash
fanqie publish 新书 --volume 第一卷 --chapters 1 --use-ai yes --dry-run
fanqie publish 新书 --volume 第一卷 --chapters 1 --use-ai yes
fanqie publish-status 新书 --volume 第一卷 --chapters 1
```

`--use-ai yes` 表示使用了 AI，未使用则填 `no`，必须按真实创作情况填写。`--dry-run` 只检查和预览，不提交。

| 查询结果 | 含义 |
| --- | --- |
| `draft` | 草稿，尚未提交 |
| `reviewing` | 审核中 |
| `published` | 已发布，内容及状态均已核对 |
| `rejected` | 审核未通过 |
| `scheduled` | 后台已有定时发布安排 |
| `unknown` | 暂时无法确认，需要继续核查 |

## 命令参考

所有命令均以 `fanqie` 开头。下表中的 `<作品>` 是添加作品时设置的简称。

| 用途 | 命令 | 说明 |
| --- | --- | --- |
| 配置作品 | `init`、`add <作品>`、`books`、`bind <作品>` | 创建配置、添加或查看作品、对应后台分卷 |
| 登录 | `login`、`auth-refresh` | 手动登录，或从已有浏览器登录信息恢复连接 |
| 本地检查 | `check <作品>`、`plan <作品>`、`status <作品>` | 检查格式、预览上传、查看本地上传记录 |
| 草稿上传 | `upload <作品>`、`reconcile <作品>` | 保存草稿，或查询上次上传是否成功 |
| 草稿修订 | `revise <作品>`、`revise-status <作品>` | 修改已核对的草稿，或查询修改结果 |
| 草稿移卷 | `move <作品>`、`move-status <作品>` | 调整草稿所属分卷，或查询移卷结果 |
| 分卷管理 | `volumes <作品>`、`volume-create <作品>`、`volume-rename <作品>` | 查询、新建或重命名后台分卷 |
| 发布 | `publish <作品>`、`publish-status <作品>` | 提交审核，或查询审核与发布状态 |
| 简介 | `book-abstract <作品>`、`book-abstract-status <作品>` | 更新简介，或查询更新结果 |
| 诊断 | `inspect <作品>` | 打开浏览器，导出截图和页面信息以排查问题 |

常用参数：

| 参数 | 示例与说明 |
| --- | --- |
| `--volume` | `--volume 第一卷`；无分卷子目录时填 `.` |
| `--chapters` | `--chapters 1`、`1-3` 或 `1,3-5` |
| `--all` | 上传所选卷的全部章节；发布、修订和移卷不支持 |
| `--dry-run` | 仅预览；上传预览只检查本地，其他修改命令会在线检查 |
| `--use-ai` | 发布时填写 `yes` 或 `no` |
| `--workspace` / `-w` | 指定写作目录，如 `-w /path/to/novel` |
| `--json` | 输出 JSON，便于脚本读取 |
| `--help` / `-h` | 显示命令帮助 |
| `--version` / `-v` | 显示版本 |

完整参数、修订条件、移卷步骤和简介更新示例见[命令与工作区参考](docs/commands.md)。

## 常见问题

**登录失效怎么办？**

先运行 `fanqie auth-refresh`。如果浏览器登录也已失效，再运行 `fanqie login`。

**上传或提交超时了，可以直接再执行吗？**

先查结果：上传使用 `reconcile`，发布使用 `publish-status`。其他操作有对应的 `*-status` 命令。不要删除操作记录来绕过错误，详见[故障恢复](docs/troubleshooting.md)。

**本地改了正文，怎么更新后台草稿？**

使用 `revise`，而不是再次 `upload`。工具要求旧草稿曾经核对通过，且后台内容未被其他操作改动。已发布章节不支持此操作。

**登录信息保存在哪里？**

保存在写作目录的 `.fanqie/`，其中也包含操作记录和部分正文备份。不要分享该文件夹；使用 Git 管理小说时，请将 `.fanqie/` 加入 `.gitignore`。更多说明见[安全说明](SECURITY.md)。

## 获取帮助

- 用法与参数：[命令参考](docs/commands.md)、[故障恢复](docs/troubleshooting.md)。
- 报告问题或提出建议：[GitHub Issues](https://github.com/x1ah/fanqie-cli/issues)。请提供版本、系统、脱敏后的命令和错误信息，不要附登录凭据或未发布正文。
- 版本变化：[CHANGELOG](CHANGELOG.md)。

## 参与开发

项目由 [@x1ah](https://github.com/x1ah) 维护，欢迎提交 Issue 和 Pull Request。开发环境需要 Node.js 22+：

```bash
git clone https://github.com/x1ah/fanqie-cli.git
cd fanqie-cli
npm ci
npm test
npm run test:browser
```

浏览器测试默认使用 Chrome，只操作临时浏览器和本地模拟数据。开发约定、其他测试方式及提交流程见[贡献指南](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © 2026 x1ah。

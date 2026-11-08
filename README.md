# Fanqie CLI

在终端里管理番茄小说：上传本地章节、保存草稿、提交审核，也能管理分卷、修改草稿和更新简介。

支持 Markdown 和 TXT 文件，可以管理多本书。首次需要用浏览器登录，之后通常不用打开网页。

**上传只会保存草稿；需要发布时，再单独提交审核。**

## 支持的命令

以下命令都以 `fanqie` 开头，例如 `fanqie books`。`<作品>` 填添加作品时使用的简称。

### 作品和登录

| 命令 | 用途 |
| --- | --- |
| `init` | 在当前写作目录创建配置文件 |
| `add <作品>` | 添加一本书，指定后台书名和本地正文目录 |
| `books` | 查看已添加的作品 |
| `bind <作品>` | 设置本地分卷与后台作品、分卷的对应关系 |
| `login` | 打开浏览器，手动登录并保存登录信息 |
| `auth-refresh` | 尝试用已有浏览器登录信息恢复连接；仍失败时再运行 login |
| `inspect <作品>` | 打开后台页面，保存用于排查问题的截图和页面信息 |

### 章节和草稿

| 命令 | 用途 |
| --- | --- |
| `check <作品>` | 检查本地章节的文件名、标题和正文格式 |
| `plan <作品>` | 查看准备上传哪些章节，不连接后台 |
| `upload <作品>` | 上传到草稿箱，并检查保存内容是否正确 |
| `status <作品>` | 查看本地保存的上传记录，不查询最新发布状态 |
| `reconcile <作品>` | 上传结果不确定时，检查后台已有草稿，不重新上传 |
| `revise <作品>` | 修改已上传且核对过的草稿，保留原章节 |
| `revise-status <作品>` | 查询草稿修改是否成功 |
| `move <作品>` | 将草稿移到指定分卷，保留原章节和正文 |
| `move-status <作品>` | 查询草稿移卷是否成功 |

### 分卷和简介

| 命令 | 用途 |
| --- | --- |
| `volumes <作品>` | 查看后台分卷名称和编号 |
| `volume-create <作品>` | 新建后台分卷，并记录它与本地卷目录的对应关系 |
| `volume-rename <作品>` | 修改后台分卷名称 |
| `book-abstract <作品>` | 用本地文字文件更新作品简介 |
| `book-abstract-status <作品>` | 查询简介更新是否成功 |

### 发布

| 命令 | 用途 |
| --- | --- |
| `publish <作品>` | 将选定草稿提交审核，必须填写是否使用 AI |
| `publish-status <作品>` | 查询章节是草稿、审核中、已发布还是其他状态 |

### 常用参数

| 参数 | 用法 |
| --- | --- |
| `--help` | 查看命令帮助 |
| `--version` | 查看工具版本 |
| `--title '书名'` | 添加作品时填写后台的实际书名 |
| `--source './新书/正文'` | 指定本地正文目录 |
| `--url '章节管理页地址'` | 指定作品在后台的章节管理页 |
| `--volume 第一卷` | 选择本地分卷；正文没有分卷子目录时填 `.` |
| `--remote-volume '第一卷：开篇'` | 填写后台的完整卷名 |
| `--chapters 1-3` | 选择章节，也可填 `1` 或 `1,3-5` |
| `--all` | 上传所选卷的全部章节；发布、修订和移卷不支持此参数 |
| `--dry-run` | 只预览，不提交修改；上传预览只检查本地，其他修改操作会连接后台检查 |
| `--use-ai yes` | 发布时声明使用了 AI，未使用则填 `no` |
| `--from-volume-id 123456789` | 移卷时填写原后台分卷编号，可用 volumes 查询 |
| `--abstract-file './简介.txt'` | 指定保存简介的纯文字文件 |
| `--workspace '/写作目录'` | 指定写作目录，可简写为 `-w` |
| `--json` | 以 JSON 格式输出结果，方便脚本读取 |

章节上传、修订、移卷和发布一次处理一个卷。其他参数和操作限制见[使用说明](docs/commands.md)。

## 安装

先安装 [Node.js](https://nodejs.org/) 22 或更高版本，以及 Google Chrome。然后在终端运行：

```bash
npm install -g 'git+https://github.com/x1ah/fanqie-cli.git#v0.5.3'
fanqie --help
```

其他浏览器的配置方法见[使用说明](docs/commands.md#浏览器设置)。

## 第一次使用

先在番茄作家后台创建好作品和第一卷。下面以一本书为例：

```bash
mkdir -p 我的写作目录/新书/正文/第一卷
cd 我的写作目录
fanqie init
fanqie add 新书 --title '后台实际书名' --source './新书/正文'
fanqie login
```

浏览器打开后，手动完成登录，再回终端按回车。

接着，告诉工具这本书和第一卷在后台的位置。将下面的网址替换为自己作品的章节管理页地址，卷名也要与后台一致：

```bash
fanqie bind 新书 \
  --url 'https://fanqienovel.com/main/writer/chapter-manage/123456789' \
  --volume 第一卷 --remote-volume '第一卷：开篇'
```

`新书` 是你给作品起的简称，后续命令都用它。

## 准备章节

将正文保存为 `新书/正文/第一卷/第001章_出发.md`，内容格式如下：

```text
# 第001章 出发

这里是小说正文。

另起一段，空一行即可。
```

文件名和第一行的章号、章名要一致。全书章号连续，换卷后不从第1章重新编号。正文只放文字段落，不放排版标记和写作笔记。TXT 文件也可以，第一行可省略 `#`。

## 上传和发布

先检查，再保存到草稿箱：

```bash
fanqie check 新书 --volume 第一卷 --chapters 1
fanqie upload 新书 --volume 第一卷 --chapters 1
```

工具会检查后台保存的标题、正文和分卷是否正确。上传成功后，章节仍是草稿。

确认要发布时，提交审核并查询结果：

```bash
fanqie publish 新书 --volume 第一卷 --chapters 1 --use-ai yes
fanqie publish-status 新书 --volume 第一卷 --chapters 1
```

`--use-ai yes` 表示使用了 AI，未使用则填 `no`，请按实际情况填写。结果中的 `reviewing` 表示审核中，`published` 才表示已发布。

一次处理多章时，把 `--chapters 1` 改成 `--chapters 1-3`。更多操作见[使用说明](docs/commands.md)，包括预览、修改草稿、调整草稿所在分卷和更新简介。

## 其他常用操作

查看后台分卷，新建第二卷：

```bash
fanqie volumes 新书
fanqie volume-create 新书 --volume 第二卷 --remote-volume '第二卷：远行'
```

修改本地正文后，先预览，再更新已有草稿：

```bash
fanqie revise 新书 --volume 第一卷 --chapters 1 --dry-run
fanqie revise 新书 --volume 第一卷 --chapters 1
```

修订要求这份草稿曾经由工具核对通过。如果后台有人另外改过内容，工具会停止，避免覆盖未知修改。

将简介保存到写作目录的 `简介.txt` 后更新：

```bash
fanqie book-abstract 新书 --abstract-file './简介.txt' --dry-run
fanqie book-abstract 新书 --abstract-file './简介.txt'
```

草稿移卷需要先设置目标卷，再指定原卷编号，完整步骤见[草稿归卷说明](docs/commands.md#原-id-草稿归卷和简介)。

## 使用时注意

- 登录信息保存在写作目录的 `.fanqie/` 中。不要分享这个文件夹；使用 Git 时，将它加入 `.gitignore`。
- 遇到超时或结果不确定时，先按[故障处理](docs/troubleshooting.md)查询，不要直接重复上传或提交。
- 目前不支持定时发布、收费设置、作者有话说，以及修改或移动已发布章节。

本工具由社区独立维护，并非番茄官方产品。

## 其他文档

[使用说明](docs/commands.md) · [故障处理](docs/troubleshooting.md) · [参与开发](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [更新记录](CHANGELOG.md)

采用 [MIT 许可证](LICENSE)。

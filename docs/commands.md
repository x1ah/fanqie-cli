# 命令与工作区参考

[返回 README](../README.md) · [故障恢复](troubleshooting.md)

## 添加作品与登录

以下作品、目录、书名和地址均为示例：

```bash
mkdir -p 我的写作目录/新书/正文/第一卷
cd 我的写作目录
fanqie init
fanqie add 新书 --title '后台实际书名' --source './新书/正文'
fanqie login
fanqie bind 新书 \
  --url 'https://fanqienovel.com/main/writer/chapter-manage/实际数字ID&后台实际书名' \
  --volume 第一卷 --remote-volume '第一卷：后台实际卷名'
```

`login` 打开独立 Chrome，手动完成登录后回终端按回车，保存浏览器和 HTTP 会话。无需提供账号密码。旧工作区首次运行 HTTP 命令时自动复用原浏览器登录态导出会话，保留旧配置、选择器、状态和正文。

HTTP 会话失效时先运行 `fanqie auth-refresh`，复用现有浏览器会话；浏览器也已失效时再运行 `fanqie login`。不会在写入失败后反复登录或重试提交。

- `--source` 支持工作区相对路径和外部绝对路径。
- `--volume` 是正文目录下的相对分卷路径。正文直接放在根目录时使用 `.`。
- `--remote-volume` 是后台完整卷名，包含「第几卷：」前缀。
- 每卷单独绑定。同一后台作品 ID 在一个工作区内只绑定一个作品别名。
- `fanqie init --discover` 可读取子目录的 `作品信息.json` 发现作品；普通 init 不预设作品。

## 分卷管理

```bash
# 查询真实后台分卷及 ID
fanqie volumes 新书

# 在线查询预览，不写后台或更新绑定
fanqie volume-create 新书 --volume 第二卷 --remote-volume '第二卷：远行' --dry-run

# 新建并回读，成功后自动保存本地卷与真实后台卷 ID 的绑定
fanqie volume-create 新书 --volume 第二卷 --remote-volume '第二卷：远行'

# 改名并更新绑定；前缀序号保持不变
fanqie volume-rename 新书 --volume 第一卷 --remote-volume '第一卷：开篇'
```

新建前作品至少需要一个已有卷的绑定作为管理入口。本地目录名与后台卷名可以不同；命令不会创建正文目录、移动章节或删除分卷。新建的序号须与后台下一卷对应；卷名最多16字符，含前缀的完整名称最多20字符。

相同完整卷名已存在时核对并绑定，不重复新建。改名会保留其他分卷与顺序，回读成功后才更新本地配置。写入前记录 `.fanqie/volume-operations.json`；结果不明时以相同命令回读恢复，不盲目重复写入。`--dry-run` 会连接后台查询，但不提交修改。

## 章节格式

```text
新书/正文/第一卷/第001章_出发.md
新书/正文/第一卷/第001章 出发.txt
新书/正文/第一卷/001-出发.txt
```

文件内容：

```text
# 第001章 出发

第一段小说正文。

第二段小说正文。
```

TXT 首行可省略 `#`。文件名与首行章号、章名须一致。章号使用阿拉伯数字，全书连续编号，不按卷重置。正文含 Markdown 格式、作者笔记或空正文时拒绝上传，不静默清洗。

扫描跳过隐藏目录、`node_modules`、`归档`、说明文件和符号链接。本地字数是去空白字符数，平台计数以后台为准。

## 日常上传

```bash
# 本地检查和预览，不连接后台
fanqie check 新书 --volume 第一卷 --chapters 1-3
fanqie plan 新书 --volume 第一卷 --chapters 1-3
fanqie upload 新书 --volume 第一卷 --chapters 1-3 --dry-run

# HTTP 上传到指定已绑定卷的草稿箱
fanqie upload 新书 --volume 第一卷 --chapters 1-3
fanqie upload 新书 --volume 第二卷 --chapters 31-33
fanqie upload 新书 --volume 第一卷 --all
fanqie status 新书
```

`--chapters` 支持 `1`、`1-3`、`1,3-5`；与 `--all` 二选一。每批只处理一个卷。`--json` 输出 JSON；`--headless` 仅影响旧会话首次导出时的浏览器，不影响日常 HTTP 操作。

上传先确认作品及分卷，再遍历全书各卷的章节列表与全部草稿分页，整批核对重复章号、已发布或待发布冲突。已有草稿只回读匹配，不覆盖。新建之前再次检查整书冲突。

新章分配前记录 `pending`，分配后记录真实 `itemId`，再通过独立 `cover_article` 接口保存草稿（不发送发布参数）。写接口不自动重试。成功响应后重新查询草稿并读取正文，比对章号、标题、分卷、状态和文字，全部一致才记录 `verified`。比较忽略空行、段落首尾空白和不换行空格差异。

**上传记录中的 `verified` 只表示草稿内容一致，不代表提交审核、审核通过或已发布。** 发布另存独立日志，必须结合 `stage` 判断实际阶段。 工具不修改小说正文、连续性台账或创作进度。

## 独立发布

```bash
# 在线预览：核对本地正文、分卷、草稿及已有发布状态，不发送发布请求
fanqie publish 新书 --volume 第一卷 --chapters 1-3 --use-ai yes --dry-run

# 将明确选择的已有草稿提交审核，不创建新章，不支持 --all
fanqie publish 新书 --volume 第一卷 --chapters 1-3 --use-ai yes

# 只回读状态，不提交、不重试
fanqie publish-status 新书 --volume 第一卷 --chapters 1-3
```

`--use-ai yes` 表示使用了 AI，`no` 表示未使用；实际发布时必须明确填写，不能沿用示例而不核对实际创作情况。发布不会自动上传缺失的稿件，须先用 upload 保存并核对草稿。当前只支持立即提交普通免费草稿，不支持定时发布、收费设置或带作者有话说的草稿。

`upload` 使用独立草稿接口 `cover_article`；它的客户端始终拒绝 `publish_article`。只有显式 publish 命令使用独立发布客户端，提交前重新核对真实草稿 ID、正文、章名、作品和卷；保留后台正文 HTML，以同一个 itemId 提交，不重新创建章节。

整批先检查，正文或分卷不一致时不先提交前章。`--dry-run` 在线查询，但不提交或写入发布日志；不会把本地已改而后台未改的版本悄悄发布。

| stage | 含义 |
| --- | --- |
| draft | 仍在草稿箱 |
| reviewing | 审核中，不能报告为已发布 |
| published | 已发布，列表与正文接口均已核对 |
| rejected | 审核不通过，仅报告，不自动重新提交 |
| scheduled | 平台已有定时待发，仅核对，不改排期 |
| unknown | 状态未核实，保留原记录并停止自动提交 |

发布日志保存在 `.fanqie/publication-state.json`，与草稿上传的 `state.json` 分开。写请求前记录 pending；响应丢失或回读不明时先运行 publish-status。即便仍显示草稿，也不会自动重发，需人工确认前次请求已明确失败后处理对应日志。已审核中或已发布的同一版本再次执行只回读，不重复提交；正文、卷或 itemId 变化会拒绝继续。

发布日志里的 `status=verified` 表示相应 `stage` 已回读确认，不能单凭 verified 判断已经公开。工具不自动修改小说的作品信息、台账或已发布章数；维护这些记录须以实际状态为准。

## 中断恢复

```bash
fanqie reconcile 新书 --volume 第一卷 --chapters 1
```

`reconcile` 只核对已有草稿，不创建或覆盖。结果不明、正文不一致、跨卷冲突、分页重复或总数变化时停止。上传后本地正文或所在卷改变，普通 upload 会拒绝覆盖；使用受限 revise 流程修订，或手动修订后台并确认一致后再 reconcile。

如果仅分配了空草稿而保存未成功，状态中保留 `itemId`，需要人工检查该空稿；不会自动覆盖空稿或分配第二份。不要删除整个状态文件绕过错误。

## 工作区与凭据

```bash
fanqie -w /写作工作区 books
fanqie -w /写作工作区 volumes 新书
```

默认从当前目录向上查找 `.fanqie/config.json`，也可用 `--workspace` / `-w` 明确指定。会话和所有操作记录都保存在工作区，不写入工具安装目录。

```text
.fanqie/
  config.json             # 作品、正文路径和分卷绑定
  browser/                # 登录和刷新会话使用的浏览器资料
  http-auth.json          # Cookie、CSRF 等 HTTP 会话，权限 0600
  state.json              # 按作品 ID + 章号记录上传结果
  volume-operations.json  # 分卷写入和回读恢复记录
  publication-state.json  # 发布尝试、审核/公开状态与恢复记录
  draft-revisions.json    # 原稿私有备份与修订恢复记录
  draft-moves.json        # 原 ID 移卷记录
  book-abstract-operations.json # 简介备份及恢复记录
  run.lock                # HTTP、浏览器和配置操作共用进程锁
  diagnostics/            # 手动 inspect 导出的截图/控件信息
```

多个工作区的登录态隔离；同一工作区的所有作品共享账号。`.fanqie/` 含敏感凭据与未发布正文信息，必须加入工作区 `.gitignore`，不得提交或公开分享。

只有确认没有命令或自动化浏览器运行时，才可移除异常退出遗留的 `run.lock`。正常退出会自动释放锁。


## 已有草稿的受限修订

正文修订并审读后，使用独立命令，普通 upload 不会覆盖旧稿：

~~~bash
fanqie revise 示例 --volume 第一卷 --chapters 2 --dry-run
fanqie revise 示例 --volume 第一卷 --chapters 2
fanqie revise-status 示例 --volume 第一卷 --chapters 2
~~~

必须已有该原章的草稿核验记录。命令在线核对整书唯一章号、原章节 ID、实际同卷、草稿状态及原正文摘要；后台内容若与上次核验不同，会停止，不能用来覆盖人工未知改动。写前备份旧稿 HTML 与摘要到工作区私有 .fanqie/draft-revisions.json，再用存草稿接口修改同一个 ID，回读全文、标题和真实草稿状态后更新记录。不会新建章节、移动分卷或提交审核。写前再次读取原摘要，但平台不提供原子条件写；避免同时在网页编辑该章。

写结果不明，先 revise-status 只读恢复。已应用会回读登记；确认仍是完整原稿则返回 not-applied，此后才可显式再运行 revise；未知第三版保持停止。此两命令都必须明确卷和章号，禁止 --all。备份含私有正文，不提交版本库。

## 原 ID 草稿归卷和简介

`move <作品> --volume 第二卷 --chapters 31-60 --from-volume-id <原卷ID> --dry-run` 在线预检；去掉 dry-run 后只将已有原ID纯文字草稿移到已绑定目标卷。当前本地全文/历史摘要必须相同，保留原HTML和原ID，整批预检后逐章写前复核。日志在工作区 `.fanqie/draft-moves.json`，结果未知先同参数 `move-status`，不得重建/重发；查询确认源卷仍在时登记 not-applied，之后显式 move 才可再次写。移卷不提交审核，不支持移动已发布、审核中或定时章节。平台没有原子条件写，避免网页并发编辑。

`volume-create` 可用 `--replace-volume-id <真实临存源卷ID>` 显式替换临存绑定，真实目标卷创建并回读后才更新配置；其他本地绑定不变。旧 pending 新建可单独加 `--resolve-not-applied`：仅当实时完整卷清单与写前相同且无目标卷时，只读登记本次观察未应用，不发请求；后续显式新建保存 previousAttempt。网络结果不明不自动重试。

`book-abstract <作品> --abstract-file <纯文字文件> --dry-run` 预览，去掉 dry-run 同步简介并回读。按官方网页 modify_book 空字段保持其他资料契约，只写简介；保存旧简介和名称/分类/封面/模式等快照，核对其他字段不变。未知先 `book-abstract-status` 同文件回读。不会修改全局笔名、签约或作品模式。简介超过500字符拒绝。


## 查询并发与分卷恢复

完整库存和草稿分页默认最多4路 GET；工作区配置 `http.readConcurrency` 可设1—8，1为串行。写请求仍逐章执行，不自动重发。后台审核锁可能造成等待；发布后最多12次、每次间隔2秒只读回查，超限保留 pending，使用 publish-status 恢复。

平台可能拒绝同时存在多个空分卷。此时停止创建，检查后台限制后安排作品流程；工具不会自动发布章节来解锁下一卷。

`volume-create --resolve-not-applied` 只用于已有 pending 的只读恢复；只有实时完整卷清单与写前相同且无目标卷时才记录 not-applied，不发送创建请求。之后显式新建保留 previousAttempt。

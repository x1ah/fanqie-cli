# 番茄小说 CLI

通过浏览器操作番茄作家后台，将本地 Markdown / TXT 小说章节上传到草稿箱。支持任意数量的作品、任意正文目录和多个独立工作区，不依赖特定作者、书名或创作项目。

当前版本 **只存草稿，不提交审核或正式发布**。提供章节格式检查、上传预览、逐章回读比对、防重复创建、冲突检查和中断恢复。工具不是番茄官方产品，页面改版可能需要调整适配。

## 安装

需要 Node.js 22+、npm 和 Google Chrome。仓库为私有，克隆或从 Git 安装需要相应 GitHub 访问权限。

```bash
gh repo clone x1ah/fanqie-cli
cd fanqie-cli
npm ci
npm link
fanqie --version
```

也可以直接从 GitHub 安装固定版本：

```bash
npm install -g 'git+ssh://git@github.com/x1ah/fanqie-cli.git#v0.2.0'
```

不全局安装也能运行 `node /工具目录/bin/fanqie.js ...`。工具目录仅放代码，会话和作品数据始终保存在指定的工作区。

如果不用 Chrome，在初始化后的 `.fanqie/config.json` 中把 `browser.channel` 改成空字符串，在工具安装目录运行 `npx playwright install chromium`，使用 Playwright 自带 Chromium。

## 新增任意作品

下面所有作品、目录和后台地址均为示例。先在番茄作者后台创建自己的作品及分卷。

```bash
mkdir -p 我的写作目录/新书/正文/第一卷
cd 我的写作目录

fanqie init
fanqie add 新书 --title '后台实际书名' --source './新书/正文'
fanqie books
fanqie login
```

`login` 打开独立浏览器，自行完成扫码或验证码登录，进入后台后回到终端按回车。以后复用会话，过期再登录；无需向工具提供账号密码。

绑定后台章节管理页和分卷，替换下列占位值：

```bash
fanqie bind 新书 \
  --url 'https://fanqienovel.com/main/writer/chapter-manage/实际数字ID&后台实际书名' \
  --volume 第一卷 \
  --remote-volume '第一卷：后台实际卷名'
```

- 别名由自己定义，可继续 `add` 添加更多小说；同一别名不能被覆盖。
- `--source` 可用工作区相对路径或外部绝对路径，多个作品的正文可放在不同目录。
- `--volume` 是正文目录下的相对分卷路径，嵌套目录用 `/`。若章节直接放在正文根目录，使用 `--volume .`。
- `--remote-volume` 必须与后台完整卷名一致，包含标点。每卷单独绑定。
- 同一后台作品 ID 在一个工作区内只允许绑定一个别名，避免上传状态冲突。

若已有创作目录，各书子目录中包含有 `书名` 字段的 `作品信息.json`，可以用 `fanqie init --discover` 初始化并发现作品，默认以子目录名为别名、其 `正文` 为来源。普通 `init` 创建空作品配置。两种方式都不会覆盖已有配置。

## 章节格式

支持以下文件名，文件名章号、章名必须与首行一致：

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

TXT 首行可省略 `#`。目前章号使用阿拉伯数字，全书连续编号，不按卷重置。正文使用纯文字段落；含 Markdown 标题、链接、列表、注释和明显工作笔记时拒绝上传，不擅自清洗或改写正文。

扫描只读取上述数字开头的章节文件，跳过隐藏目录、`node_modules`、`归档` 和符号链接。README 等说明文件不会上传，其他文件名需要先整理成支持的格式。本地字数为去空白字符数，平台字数以后台为准。

## 日常上传

```bash
# 本地检查与预览，不连接后台
fanqie check 新书 --volume 第一卷 --chapters 1-3
fanqie plan 新书 --volume 第一卷 --chapters 1-3
fanqie upload 新书 --volume 第一卷 --chapters 1-3 --dry-run

# 上传指定章节到草稿箱
fanqie upload 新书 --volume 第一卷 --chapters 1-3

# 上传该卷全部现有正文，已有同内容草稿回读核对
fanqie upload 新书 --volume 第一卷 --all

fanqie status 新书
```

`--chapters` 支持 `1`、`1-3`、`1,3-5`，与 `--all` 二选一；每批只处理一卷。默认显示浏览器过程，适配稳定后可以加 `--headless`。`--json` 输出 JSON，运行日志和诊断错误不会混入该命令的 JSON 标准输出。

流程先遍历后台章节列表和草稿箱，核对整批冲突，再逐章写入。已有草稿必须重新打开并比对章号、标题、分卷和正文，匹配后收录，不重复新建。已有同章号进入章节管理列表时停止，当前工具不覆盖已发布或待发布章节。

对新章节，在本地记录 `pending` 后才打开新草稿。点击存草稿后重新从草稿箱进入编辑器，回读一致才记为 `verified`。比较忽略空行、每段首尾空白和不换行空格差异，仍检查字词、标点及非空段落顺序。

**`verified` 表示草稿回读一致，不能视为已提交审核、审核通过或已发布。** 工具不修改创作项目的正文、连续性台账或进度文件。

## 工作区与登录态

```bash
# 在其他目录管理指定工作区
fanqie -w /写作工作区 books
fanqie -w /写作工作区 upload 新书 --volume 第一卷 --chapters 1
```

不传 `--workspace` / `-w` 时，从当前目录向上查找 `.fanqie/config.json`；找不到则使用当前目录。创建独立新工作区时可明确使用 `fanqie init -w /新目录`。

```text
写作工作区/
  .fanqie/
    config.json       # 作品、正文路径、分卷、浏览器及选择器设置
    browser/          # 登录会话，工作区内全部作品共享
    state.json        # 上传结果，按后台作品 ID + 章号隔离
    run.lock          # 配置写入或浏览器操作期间的进程锁
    diagnostics/      # 出错截图和控件属性
```

多个工作区互相隔离，每个工作区有独立会话；需要不同作者账号时使用不同工作区。已有旧版 `.fanqie/config.json`、作品别名、浏览器会话和上传状态可原地复用，无需迁移或重新初始化。

`.fanqie/` 包含登录凭据和可能未发布的正文截图，不应提交到 Git。若写作工作区另有版本库，请在其 `.gitignore` 中添加 `.fanqie/`。

## 中断恢复与冲突

保存超时或进程中断后可能已生成草稿，`pending` 状态会阻止直接重传：

```bash
fanqie reconcile 新书 --volume 第一卷 --chapters 1
```

`reconcile` 只核对已有草稿，匹配才恢复 `verified`，不创建或覆盖。找不到或不一致时停止。确认没有生成草稿后，再人工处理对应 pending 记录；不要删除整个状态文件绕过错误。

上传后修改了本地同章内容或分卷，普通 upload 会停止。当前版本不提供强制覆盖；手动修订后台草稿一致后，可以 reconcile 收录新版本。

异常退出可能留下 `run.lock`。确认没有运行中的命令及该工作区的自动化浏览器后，再移除该锁；普通退出自动释放。

## 后台页面变化

```bash
fanqie inspect 新书 --volume 第一卷
```

打开后台后，手动停留在待诊断页面，回终端按回车导出截图和控件属性。失败的上传也会尝试导出。诊断保存在工作区的 `.fanqie/diagnostics/`，不要直接公开分享。

在配置的 `selectors` 中可以用 CSS 选择器覆盖默认定位。支持 `number`、`title`、`body`、`rows`、`volume`、`editorVolume`、`drafts`、`published`、`create`、`save`、`edit` 和 `next`。单控件选择器必须唯一匹配可见元素；`rows` 匹配所有章节数据行，`edit` 相对该行查找。`save` 只应指向存草稿按钮。

控件不能唯一识别、分卷不符、出现后台错误或内容回读不一致时停止。不使用屏幕坐标猜测点击，不自动跳过未知确认弹窗。

## 验证状态与开发

本地逻辑测试覆盖任意作品添加、外部路径、工作区发现与隔离、旧配置兼容、跨卷章号冲突及中断恢复。真实浏览器集成测试在本地模拟后台验证分页、新标签页、草稿保存回读、防重复上传和远端内容变化。

```bash
npm ci
npm test
npm run test:browser
```

默认浏览器测试使用 Chrome，也可测试 Playwright Chromium：

```bash
npx playwright install chromium
FANQIE_TEST_CHANNEL=chromium npm run test:browser
```

GitHub Actions 在 Node.js 22、24 上运行逻辑测试和 Chromium 模拟后台测试。所有测试均不使用真实作者会话、不向番茄写入测试章节。

真实作者账号的章节上传全链路尚未验收。首次正式使用需验证编辑器控件、账号引导弹窗、分卷选择和保存回读；模拟后台测试通过不代表已完成真实平台验收。

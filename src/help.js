export const HELP = `番茄小说 CLI

工作区与会话
  fanqie init [--discover]            初始化工作区（不覆盖已有配置）
  fanqie add <别名> --title <后台书名> --source <正文目录>
  fanqie login                        打开独立 Chrome，手动登录并保存会话
  fanqie books                        列出本地作品与后台绑定
  fanqie inspect <作品> --volume 第一卷
  fanqie auth-refresh                 从现有 Chrome 登录态刷新 HTTP 会话

分卷
  fanqie volumes <作品>               HTTP 查询后台分卷
  fanqie volume-create <作品> --volume 第二卷 --remote-volume 第二卷：远行 [--dry-run]
  fanqie volume-rename <作品> --volume 第一卷 --remote-volume 第一卷：开篇 [--dry-run]
  fanqie bind <作品> --url <章节管理页> --volume 第一卷 --remote-volume <后台分卷完整名称>

章节与草稿
  fanqie status <作品>              查看本地上传记录（非实时发布状态）
  fanqie check <作品> [--volume 第一卷] [--chapters 1-3]
  fanqie plan <作品> [--volume 第一卷] [--chapters 1-3]
  fanqie upload <作品> --volume 第一卷 --chapters 1-3 [--dry-run]
  fanqie upload <作品> --volume 第一卷 --all
  fanqie reconcile <作品> --volume 第一卷 --chapters 1-3
  fanqie revise <作品> --volume 第一卷 --chapters 1-3 [--dry-run]
  fanqie revise-published <作品> --volume 第一卷 --chapters 1-3 --use-ai yes [--dry-run]
  fanqie revise-published-status <作品> --volume 第一卷 --chapters 1-3
  fanqie revise-status <作品> --volume 第一卷 --chapters 1-3

提交审核
  fanqie publish <作品> --volume 第一卷 --chapters 1-3 --use-ai yes [--dry-run]
  fanqie publish-status <作品> --volume 第一卷 --chapters 1-3

草稿归卷与作品资料
  fanqie move <作品> --volume 第二卷 --chapters 31-60 --from-volume-id <原卷ID> [--dry-run]
  fanqie move-status <作品> --volume 第二卷 --chapters 31-60 --from-volume-id <原卷ID>
  fanqie book-abstract <作品> --abstract-file <简介纯文字文件> [--dry-run]
  fanqie book-abstract-status <作品> --abstract-file <简介纯文字文件>


作品数量不限，使用 add 添加自己的作品。--chapters 支持 1、1-3、1,3-5。
没有分卷子目录时，使用 --volume . 绑定正文根目录。
upload 只存草稿；reconcile 只回读核对已有草稿，不创建或覆盖。
revise 仅按已核验旧稿摘要修改原章同卷草稿，写前备份；结果不明先 revise-status，不重复新建。
publish 独立提交已有草稿审核；不保证立即公开。publish-status 只查询发布结果。
发布须明确章号；--use-ai yes/no 为实际 AI 使用声明；不支持 --all 或定时发布。
日常操作通过 HTTP；浏览器仅用于 login、auth-refresh 和 inspect。
--json 输出 JSON；--headless 用于会话迁移时隐藏浏览器。
--workspace <目录> / -w <目录> 指定工作区；默认从当前目录向上查找配置。
--dry-run：upload 仅本地预览；其他修改命令在线预检，不提交修改。
配置及会话保存在工作区 .fanqie/ 下，不保存在工具安装目录。
--version 显示版本。`;

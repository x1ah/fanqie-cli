# 故障恢复

[返回 README](../README.md)

## 先确认是哪一种结果

`status` 仅显示本地上传记录。草稿记录 `verified` 表示当时回读一致；发布日志还必须查看 `stage`。`reviewing`、`published`、`rejected`、`scheduled`、`unknown` 分别表示审核中、已公开、被拒、定时和未知。

写入超时、响应丢失或回读失败时，先用原作品、卷和章号查询恢复：

| 原操作 | 恢复命令 | 说明 |
| --- | --- | --- |
| upload | `reconcile` | 只核对已有草稿，不创建或覆盖 |
| publish | `publish-status` | 查询审核/公开状态，不重新提交 |
| revise | `revise-status` | 核对新旧稿，确认未应用后才可显式重试 |
| move | `move-status` | 带原 `--from-volume-id` 查询 |
| book-abstract | `book-abstract-status` | 带原 `--abstract-file` 查询 |
| volume-create / volume-rename | 重复同参数命令 | 优先回读日志，不盲目再次写入 |

不要删除状态文件、强制覆盖或分配第二个章节 ID 来解决 pending。若只分配到空草稿，保留原 ID 并人工检查。

## 会话失效

先运行 `fanqie auth-refresh` 复用原浏览器登录态；仍无效再 `fanqie login`。普通服务错误（如 code=-100）不一定是登录失效，不要反复登录或重试提交。平台审核锁定时保留日志，稍后用对应 status 命令查询。

## 正文或卷冲突

核对本地正文、实际后台卷和原 ID。`upload` 不覆盖已有稿；只有已核验原摘要的同卷草稿才能使用 `revise`。移卷要求真实目标卷已经绑定，且本地目录、历史摘要满足检查。详见[命令参考](commands.md)。

## 平台不允许创建多个空卷

这属于平台约束，不是修改本地绑定就能解决。不要把本地配置变更当作实际归卷，也不要为解锁而自动发布或上传到错误的卷。

## 工作区被锁定

所有作品共享工作区 `.fanqie/run.lock`。先确认持锁进程及浏览器是否仍在运行；仅在确认没有活跃命令后移除异常退出遗留的锁，不删除活锁。

## 提交问题报告

提供工具版本、Node.js 版本、系统、脱敏命令、业务错误码和复现步骤。不要附 Cookie、CSRF、`.fanqie/`、完整诊断包、作品真实 ID 或未发布正文。`inspect` 产生的截图和控件信息也需先脱敏。

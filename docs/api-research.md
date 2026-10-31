# 作家后台 HTTP API 可行性研究

## 草稿写入协议更正（2026-11-01）

网页「存草稿」实际调用POST `/api/author/article/cover_article/v0/`，业务字段为book_id、item_id、title、content、volume_name、volume_id，另附公共参数。已在拦截所有作者写请求的诊断上下文中捕获按钮请求，发送前中止；修正后的CLI再以真实业务章节完成草稿列表、正文、卷ID及publish_status=0回读。

v0.3.0曾误用`/api/author/publish_article/v0/`；即便传publish_status=0，该接口也可能正式发布，不能当作草稿接口。v0.3.1已替换接口、删去不属于草稿契约的发布参数，并在请求层拒绝正式发布路径。旧模拟测试随实现共用错误路径，不能证明真实请求语义；回归模拟后端现固定独立的草稿路径契约，并检查发布路径零请求。不要再用v0.3.0进行上传；查询与分卷接口的既有验证范围不受此更正替代。

研究日期：2026-10-31。研究时 CLI v0.2.0 使用 Playwright。v0.3.0 已接入 HTTP 上传、回读与分卷管理；下文实测范围仍只代表研究时获得的证据。

## 结论和证据范围

可以把日常查询改为直接 HTTP 请求。已使用作者现有登录会话完成只读验证：先在浏览器中观察真实请求，将 Cookie 留在研究进程内存中，关闭浏览器，再使用 Node 原生 fetch 请求。未导出或提交任何凭据。

| 操作 | 当前网页接口 | 独立 HTTP 验证 |
| --- | --- | --- |
| 分卷列表 | GET `/api/author/volume/volume_list/v1` | HTTP 200，业务 code=0，189 ms |
| 作品信息 | GET `/api/author/book/book_detail/v0/` | HTTP 200，业务 code=0，257 ms |
| 章节列表 | GET `/api/author/chapter/chapter_list/v1` | HTTP 200，业务 code=0，161 ms |
| 新建分卷 | POST `/api/author/volume/add_volume/v0` | 已观察网页生成的请求，发送前拦截，未验证服务端写入 |
| 编辑分卷 | POST `/api/author/volume/modify/v0` | 已观察网页生成的请求，发送前拦截，未验证服务端写入 |

耗时来自本机单次请求，不包含登录和浏览器启动，不是性能保证。只读请求未携带 `msToken`、`a_bogus` 查询参数，均成功；不能据此推断写接口也不需要这些参数。未发现可作为兼容性承诺的官方公开 API 文档；目前应视作网页内部接口。

## 已确认的协议

公共参数：`aid=2503`、`app_name=muye_novel`。作品及分卷 ID 均保留字符串，避免长整型精度丢失。

读接口复用现有 Cookie，当前实测不需要 CSRF 请求头。分卷列表返回 `volume_list`，元素包含 `index`、`book_id`、`volume_id`、`volume_name`、`item_count`、`can_delete`。章节列表返回 `total_count`、`item_list`，查询包含作品、分卷、分页、状态和排序条件；不能把单卷单页误判为全书结果。

网页写请求使用 `application/x-www-form-urlencoded;charset=UTF-8`，包含 Cookie 和 `x-secsdk-csrf-token`：

- 新建：`book_id`、`volume_name`，以及公共参数。
- 编辑：`book_id`、`volume_data`，以及公共参数；`volume_data` 是 JSON 字符串，包含整组 `{ volume_id, volume_name }`，按网页的原始顺序提交。

网页实际生成的两个写请求已由 Playwright 路由在网络发送之前中止，没有新建或改名真实分卷。不能把这一步报告成写 API 已成功验收。未验证章节移卷接口。

协议依据：当前网页 `ChapterManage.79416ea3.js` 中的调用逻辑，以及浏览器实际生成并被拦截的请求；通用异步脚本里还存在其他版本或废弃接口，不能直接混用。

## 建议实现方式

1. 保留浏览器用于首次登录与会话失效后的刷新；登录完成后在工作区 `.fanqie/` 以 0600 权限保存 API 所需会话，日常 HTTP 调用无需启动 Chrome。
2. 独立实现 HTTP 客户端，限制请求目标为官方域名，检查 HTTP 状态、JSON 和业务 code；登录失效时给出登录指引，不反复重试鉴权或绕过平台挑战。
3. 先增加分卷列表、新建、改名及读后核对。编辑前重新读取完整分卷列表，只改目标卷名，保留其他卷与顺序；更新本地绑定时使用真实 `volume_id`。
4. 写入前记录 pending 操作；超时或结果不明时先查询恢复，不自动重发新建请求。服务端写入成功并回读一致后，才能更新本地绑定。
5. 现有 upload/reconcile 逻辑和工作区锁继续保留，随后逐步将草稿写入与回读适配为 API。API 和浏览器不能并发修改同一工作区。
6. 写接口的 CSRF、签名要求、服务端校验及响应格式仍需在实际业务操作时验收；测试使用本地模拟服务和临时上下文，不操作真实作品的测试数据。

研究阶段没有修改 CLI 功能、升级依赖或发布章节。研究脚本、脱敏结果和请求字段摘要只保存在研究工作区 `.fanqie/api-research/`，不提交到工具仓库。

参考实现（仅辅助核对，实测优先）：

- https://github.com/CommitByRyan/fanqie-writer-mcp/blob/main/server.js
- https://github.com/fuhei/tomato-writer-mcp


## v0.4.0 独立发布契约

2026-11-01根据当前网页 `Publish.da6ba01a.js` 的实际发布逻辑核对参数：POST `/api/author/publish_article/v0/`，发布路径为 `publish_status=1`、`timer_status=0`、`timer_time=''`、`device_platform=pc`，携带真实作品/章节/分卷 ID、标题和原始 HTML 正文、`need_pay`、`speak_type`、`use_ai`、`timer_chapter_preview`、广告字段。AI 声明按网页选项使用 yes=1/no=2。默认草稿客户端仍拒绝此接口，只有独立发布客户端允许提交。

本版本先支持无作者有话说的普通免费草稿，拒绝不支持的附加内容；不支持定时。状态须结合章节列表及正文接口核对，不能以 HTTP 200 或业务 code=0 断言公开成功。

开发期间只读取网页脚本并执行发布预览及已有公开章节查询；未发送真实发布请求。实际提交请求的回归验证只使用本地模拟后台。

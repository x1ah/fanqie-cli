# 参与开发

欢迎提交问题和改进。请先阅读 [AGENTS.md](AGENTS.md) 和[安全说明](SECURITY.md)，保持工具与具体小说项目分离。

## 本地开发

需要 Node.js 22+。克隆后执行：

```bash
npm ci
npm test
npm run test:browser
npm pack --dry-run
```

浏览器测试默认使用 Chrome，也可运行 `npx playwright install chromium` 后使用 `FANQIE_TEST_CHANNEL=chromium npm run test:browser`。CI 覆盖 Node.js 22/24。自动化测试只连接本地模拟后台和临时浏览器上下文，禁止使用真实作者凭据或向真实作品写入测试章节。

## 源码结构

| 文件 | 职责 |
| --- | --- |
| bin/fanqie.js | 可执行入口 |
| src/cli.js / src/help.js | 参数解析、命令调度 / 帮助文本 |
| src/core.js | 工作区、配置、章节解析、摘要和锁 |
| src/api.js | HTTP 适配、全书库存、分页及请求保护 |
| src/session.js / src/browser.js | 会话导出、刷新和浏览器诊断 |
| src/upload.js | 草稿上传与 reconcile |
| src/publish.js | 独立发布与状态恢复 |
| src/revise.js / src/move.js | 原 ID 草稿修订 / 移卷 |
| src/volumes.js / src/metadata.js | 分卷 / 简介 |
| test/ | 单元、本地 HTTP 与临时浏览器回归 |

## 修改要求

保持旧配置、登录态、正文及操作日志兼容。错误信息不得打印凭据、响应正文或小说正文。草稿客户端保持禁止正式发布接口；正式发布只通过独立命令，明确区分草稿、审核中和已公开。

变更请求语义时，应先用独立协议证据核实接口，再用固定契约的模拟后台验证，避免测试与实现共用错误假设。写请求前记录 pending，结果未知优先只读恢复，不自动重发。影响工作区、浏览器或上传流程的改动同时运行浏览器测试。

PR 说明写清触发条件、行为变化和验证范围。模拟测试通过不代表真实平台验收，不提交真实作品信息或登录材料。

## 发布检查

更新 package.json、package-lock.json 与 CHANGELOG；执行全部测试及 `npm pack --dry-run`，确认产物只包含预期源码和文档。检查暂存区、提交历史、凭据和依赖后再创建版本 tag。npm 发布与 GitHub 仓库公开分别处理；本仓库的 `private: true` 用于防止误发 npm，不影响 GitHub 源码可见性。

import path from 'node:path';
import { atomicJSON } from './core.js';
import { API, ORIGIN, FanqieApi } from './api.js';

// 仅登录/刷新会话时运行。SDK 正常生成 CSRF 头后，在发送前中止探测请求。
// 探测请求没有作品或分卷参数，不得到达服务器。
export async function exportHttpSession(browser, dataDir, { fetchImpl } = {}) {
  if (new URL(browser.page.url()).origin !== ORIGIN) throw new Error('只能从官方作家后台导出会话');
  const pattern = `${ORIGIN}${API.modifyVolumes}**`;
  let auth;
  const intercept = async route => {
    const request = route.request();
    if (request.method() === 'HEAD') return route.continue(); // 官方 SDK 的正常 CSRF 握手
    try {
      const headers = await request.allHeaders();
      if (request.method() === 'POST') auth = {
        cookie: headers.cookie, csrfToken: headers['x-secsdk-csrf-token'], userAgent: headers['user-agent'],
        clientHeaders: Object.fromEntries(Object.entries(headers).filter(([key]) => /^sec-(?:ch-ua|fetch-)/.test(key))),
        exportedAt: new Date().toISOString(),
      };
    } finally { await route.abort('blockedbyclient'); }
  };
  await browser.context.route(pattern, intercept);
  try {
    await browser.page.evaluate(async api => {
      await new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${api}?aid=2503&app_name=muye_novel`);
        xhr.timeout = 12000;
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
        xhr.onloadend = () => resolve(); xhr.send('');
      });
    }, API.modifyVolumes);
  } finally { await browser.context.unroute(pattern, intercept); }
  if (!auth?.cookie || !auth.csrfToken) throw new Error('无法导出 HTTP/CSRF 会话，请确认已登录作家后台后运行 auth-refresh');
  // 导出前在线确认认证，不把登录页/匿名 Cookie 当成可用会话。
  const api = await new FanqieApi({}, { auth, fetchImpl }).start();
  await api.request('GET', API.account);
  await atomicJSON(path.join(dataDir, 'http-auth.json'), auth);
}
export async function refreshHttpSession(config, dataDir, { headless = true } = {}) {
  const { FanqieBrowser } = await import('./browser.js');
  const browser = new FanqieBrowser(config, { dataDir, headless });
  try {
    await browser.start();
    await browser.goto(`${ORIGIN}/main/writer/book-manage`);
    await browser.page.locator('body').waitFor();
    await browser.page.waitForTimeout(1000);
    await exportHttpSession(browser, dataDir);
  } finally { await browser.close(); }
}

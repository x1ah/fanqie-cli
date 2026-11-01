import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseFragment } from 'parse5';
import { readJSON, normalize, validateURL } from './core.js';

export const ORIGIN = 'https://fanqienovel.com';
const COMMON = { aid: '2503', app_name: 'muye_novel' };
export const API = Object.freeze({
  account: '/api/author/account/info/v0/', book: '/api/author/book/book_detail/v0/',
  volumes: '/api/author/volume/volume_list/v1', chapters: '/api/author/chapter/chapter_list/v1',
  drafts: '/api/author/chapter/draft_list/v1', article: '/api/author/edit_article/v0/',
  allocate: '/api/author/article/new_article/v0/', save: '/api/author/article/cover_article/v0/',
  modifyBook: '/api/author/book/modify_book/v0/',
  addVolume: '/api/author/volume/add_volume/v0', modifyVolumes: '/api/author/volume/modify/v0',
});
const allowed = new Set(Object.values(API));
const publicationClients = new WeakSet();
export const PUBLICATION_ENDPOINT = '/api/author/publish_article/v0/';
export function id(value) {
  if ((typeof value !== 'string' && !Number.isSafeInteger(value)) || !/^\d+$/.test(String(value))) throw new Error('接口返回无效或不精确的 ID');
  return String(value);
}
export const textToHTML = text => normalize(text).split('\n').map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('');
export function htmlToText(html) {
  if (typeof html !== 'string') throw new Error('接口正文格式无效');
  const walk = node => {
    if (node.nodeName === '#text') return node.value;
    if (['script', 'style', 'img', 'video', 'audio', 'iframe'].includes(node.tagName)) throw new Error('正文包含非纯文字内容，停止回读');
    if (node.tagName === 'br') return '\n';
    const text = (node.childNodes ?? []).map(walk).join('');
    return ['p', 'div', 'li'].includes(node.tagName) ? `${text}\n` : text;
  };
  return normalize(walk(parseFragment(html)));
}
export function parseRemoteTitle(title) {
  const m = typeof title === 'string' && title.match(/^第\s*(\d+)\s*章\s*(.*)$/u);
  if (!m || !Number.isSafeInteger(Number(m[1])) || Number(m[1]) < 1) throw new Error('后台章节标题无法解析章号，停止核对');
  return { number: Number(m[1]), title: m[2].trim() };
}

export class FanqieApi {
  constructor(config, { dataDir, auth, fetchImpl = globalThis.fetch } = {}) {
    this.config = config; this.dataDir = dataDir; this.auth = auth; this.fetch = fetchImpl;
    this.timeout = config.http?.timeout ?? 15000;
  }
  async start() {
    this.auth ??= await readJSON(path.join(this.dataDir, 'http-auth.json'), null);
    if (!this.auth?.cookie) throw new Error('缺少 HTTP 会话，请运行 auth-refresh 复用现有浏览器登录，或 login 首次登录');
    if (typeof this.auth.cookie !== 'string' || /[\r\n]/.test(this.auth.cookie)) throw new Error('HTTP 会话格式无效，请运行 auth-refresh');
    return this;
  }
  async close() {}
  async request(method, api, params = {}) {
    const publication = api === PUBLICATION_ENDPOINT && publicationClients.has(this);
    if (/\/publish_article\//.test(api) && !publication) throw new Error('拒绝非授权正式发布接口：草稿适配器只保存草稿');
    if ((!allowed.has(api) && !publication) || !['GET', 'POST'].includes(method)) throw new Error('拒绝非授权 API 地址或请求方法');
    if (publication && (method !== 'POST' || params.publish_status !== 1 || params.timer_status !== 0 || ![1, 2].includes(params.use_ai))) throw new Error('发布请求必须明确提交审核、非定时及 AI 使用声明');
    if (method === 'POST' && !this.auth.csrfToken) throw new Error('缺少 CSRF 会话，请运行 auth-refresh');
    const url = new URL(api, ORIGIN);
    const headers = { Cookie: this.auth.cookie, Accept: 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/main/writer/` };
    if (this.auth.userAgent) headers['User-Agent'] = this.auth.userAgent;
    for (const [key, value] of Object.entries(this.auth.clientHeaders ?? {})) {
      if (/^sec-(?:ch-ua(?:-mobile|-platform)?|fetch-(?:dest|mode|site))$/.test(key)) headers[key] = value;
    }
    if (this.auth.csrfToken) headers['x-secsdk-csrf-token'] = this.auth.csrfToken;
    const fields = new URLSearchParams(Object.entries({ ...COMMON, ...params }).filter(([,v]) => v !== undefined && v !== null).map(([k,v]) => [k, String(v)]));
    const options = { method, headers, redirect: 'error', signal: AbortSignal.timeout(this.timeout) };
    if (method === 'GET') url.search = fields.toString();
    else {
      url.search = new URLSearchParams(COMMON).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      options.body = fields.toString();
    }
    // 写请求绝不自动重试；结果不明由上传状态或分卷操作日志恢复。
    let response;
    try { response = await this.fetch(url, options); }
    catch { throw new Error(`HTTP 请求失败或超时：${api}${method === 'POST' ? '；写入结果未明，请先核对，不能直接重传' : ''}`); }
    if ([401,403].includes(response.status)) throw new Error('HTTP 登录或权限已失效，请运行 auth-refresh；需要重新登录时运行 login');
    if (!response.ok) throw new Error(`HTTP ${response.status}：${api}`);
    let body;
    try { body = await response.json(); } catch { throw new Error(`接口未返回 JSON：${api}；请检查会话或平台验证，写入结果需先核对`); }
    if (!body || body.code !== 0) {
      if (/登录|登陆|csrf|token|未授权/i.test(body?.message ?? '')) throw new Error('HTTP 登录或 CSRF 会话失效，请运行 auth-refresh 或 login');
      throw new Error(`接口业务失败：${api}（code=${Number.isFinite(body?.code) ? body.code : '未知'}）`);
    }
    if (body.data == null && method === 'POST' && api !== API.allocate) return {};
    if (!body.data || typeof body.data !== 'object') throw new Error(`接口数据结构无效：${api}`);
    return body.data;
  }
  async assertBook(book) {
    const data = await this.request('GET', API.book, { book_id: id(book.bookId) });
    if (id(data.book_id) !== book.bookId || data.book_name !== book.title) throw new Error('后台作品 ID 或书名不匹配，停止操作');
  }
  async volumes(book) {
    const data = await this.request('GET', API.volumes, { book_id: id(book.bookId) });
    if (!Array.isArray(data.volume_list)) throw new Error('分卷列表结构无效');
    const seen = new Set();
    return data.volume_list.map(v => {
      const volumeId = id(v.volume_id);
      if (id(v.book_id) !== book.bookId || typeof v.volume_name !== 'string' || seen.has(volumeId)) throw new Error('分卷归属、名称或唯一性异常');
      seen.add(volumeId);
      return { ...v, volume_id: volumeId };
    });
  }
  async resolveVolume(book, binding, volumes) {
    validateURL(binding.manageUrl);
    const matches = (volumes ?? await this.volumes(book)).filter(v => v.volume_name === binding.remoteName && (!binding.volumeId || v.volume_id === binding.volumeId));
    if (matches.length !== 1) throw new Error(`无法唯一核对分卷「${binding.remoteName}」，请运行 volumes 检查绑定`);
    return matches[0];
  }
  async pages(api, params, key) {
    const rows = [], signatures = new Set(); let expected;
    for (let page = 0; page < 1000; page++) {
      // 草稿列表大分页在超过30条时可能返回服务错误；保留分页完整性校验。
      const pageCount = api === API.drafts ? 30 : 100;
      const data = await this.request('GET', api, { ...params, page_index: page, page_count: pageCount });
      const list = data[key], total = data.total_count;
      if (!Array.isArray(list) || !Number.isSafeInteger(total) || total < 0) throw new Error('分页列表结构无效');
      expected ??= total;
      if (expected !== total) throw new Error('核对期间远端章节总数变化，请重新核对');
      const signature = JSON.stringify(list.map(v => id(v.item_id)));
      if (signatures.has(signature) && list.length) throw new Error('接口分页重复，停止以免漏检章节');
      signatures.add(signature); rows.push(...list);
      if (rows.length === total) {
        if (new Set(rows.map(v => id(v.item_id))).size !== rows.length) throw new Error('分页存在重复章节 ID');
        return rows;
      }
      if (!list.length || rows.length > total) throw new Error('接口分页数量不一致，停止核对');
    }
    throw new Error('接口分页超过上限');
  }
  async published(book, volumeId) {
    return this.pages(API.chapters, { book_id: book.bookId, volume_id: volumeId, status: 0, sort: '', must_have_correction_feedback: 0, need_correction_feedback_num: 1 }, 'item_list');
  }
  async drafts(book) { return this.pages(API.drafts, { book_id: book.bookId }, 'draft_list'); }
  async inventory(book, binding) {
    await this.assertBook(book);
    const volumes = await this.volumes(book);
    await this.resolveVolume(book, binding, volumes);
    const entries = [];
    // 已发布接口按卷返回，遍历全部卷才能发现跨卷重复章号。
    for (const volume of volumes) {
      for (const row of await this.published(book, volume.volume_id)) {
        if (id(row.volume_id) !== volume.volume_id) throw new Error('章节列表返回其他分卷，停止核对');
        entries.push({ ...parseRemoteTitle(row.title), itemId: id(row.item_id), volumeId: id(row.volume_id), kind: 'published', displayStatus: row.display_status });
      }
    }
    for (const row of await this.drafts(book)) entries.push({ ...parseRemoteTitle(row.title), itemId: id(row.item_id), volumeId: id(row.volume_id), kind: 'drafts' });
    return entries;
  }
  async article(book, itemId) {
    const data = await this.request('GET', API.article, { book_id: id(book.bookId), item_id: id(itemId), from_source: 0 });
    if (id(data.column_data?.book_id) !== book.bookId) throw new Error('草稿所属作品不一致');
    return data;
  }
  verifyArticle(data, volume, chapter) {
    if (data.publish_status !== 0 || Number(data.timer_status) !== 0) throw new Error('章节已提交审核或待发布，拒绝作为草稿操作');
    this.verifyContent(data, volume, chapter);
  }
  verifyContent(data, volume, chapter) {
    const actual = parseRemoteTitle(data.title);
    if (id(data.volume_id) !== volume.volume_id) throw new Error('草稿所属分卷不一致');
    if (actual.number !== chapter.number || actual.title !== chapter.title || htmlToText(data.content) !== normalize(chapter.body)) throw new Error(`第 ${chapter.number} 章回读不一致（章号、标题或正文）`);
  }
  editorUrl(book, itemId) { return `${ORIGIN}/main/writer/${id(book.bookId)}/publish/${id(itemId)}/?enter_from=modifydraft`; }
  async openDraft(book, binding, chapter) {
    const volume = await this.resolveVolume(book, binding);
    const found = (await this.drafts(book)).filter(row => parseRemoteTitle(row.title).number === chapter.number);
    if (found.length !== 1) throw new Error(`草稿箱无法唯一定位第 ${chapter.number} 章`);
    const itemId = id(found[0].item_id);
    this.verifyArticle(await this.article(book, itemId), volume, chapter);
    return this.editorUrl(book, itemId);
  }
  async revisionSnapshot(book, binding, chapter, itemId) {
    const volume = await this.resolveVolume(book, binding);
    const rows = (await this.inventory(book, binding)).filter(row => row.number === chapter.number);
    if (rows.length !== 1 || rows[0].kind !== 'drafts' || rows[0].itemId !== id(itemId)) throw new Error('修订无法唯一定位原章草稿；拒绝新建或修改已发布章');
    const data = await this.article(book, itemId);
    if (data.publish_status !== 0 || Number(data.timer_status) !== 0) throw new Error('章节已提交审核或待发布，拒绝修订');
    if (rows[0].volumeId !== volume.volume_id || id(data.volume_id) !== volume.volume_id) throw new Error('修订不允许跨卷移动');
    const actual = parseRemoteTitle(data.title), body = htmlToText(data.content);
    if (actual.number !== chapter.number) throw new Error('原章号不符');
    const hash = createHash('sha256').update(actual.number + '\n' + actual.title + '\n' + normalize(body)).digest('hex');
    return { hash, title: actual.title, content: data.content, volumeId: volume.volume_id };
  }
  async reviseDraft(book, binding, chapter, { itemId, expectedHash }) {
    const before = await this.revisionSnapshot(book, binding, chapter, itemId);
    if (before.hash !== expectedHash) throw new Error('写入前原草稿摘要已变化，拒绝覆盖');
    const volume = await this.resolveVolume(book, binding);
    await this.request('POST', API.save, {
      item_id: id(itemId), book_id: book.bookId, title: '第' + chapter.number + '章 ' + chapter.title, content: textToHTML(chapter.body),
      volume_id: volume.volume_id, volume_name: volume.volume_name,
    });
    this.verifyArticle(await this.article(book, itemId), volume, chapter);
    return this.openDraft(book, binding, chapter);
  }
  async moveSnapshot(book, binding, chapter, itemId, sourceVolumeId) {
    const target = await this.resolveVolume(book, binding);
    const list = await this.volumes(book);
    if (!list.some(v => v.volume_id === id(sourceVolumeId)) || sourceVolumeId === target.volume_id) throw new Error('移卷源卷无效或与目标相同');
    const rows = (await this.inventory(book, binding)).filter(r => r.number === chapter.number);
    if (rows.length !== 1 || rows[0].kind !== 'drafts' || rows[0].itemId !== id(itemId)) throw new Error('移卷不能唯一定位原ID草稿');
    const data = await this.article(book, itemId);
    const currentVolumeId = id(data.volume_id);
    if (![sourceVolumeId, target.volume_id].includes(currentVolumeId) || rows[0].volumeId !== currentVolumeId) throw new Error('当前卷不在明确源卷/目标卷中');
    this.verifyArticle(data, { volume_id: currentVolumeId }, chapter);
    return { volumeId: currentVolumeId, content: data.content, title: data.title, target };
  }
  async moveDraft(book, binding, chapter, { itemId, sourceVolumeId }) {
    const before = await this.moveSnapshot(book, binding, chapter, itemId, sourceVolumeId);
    if (before.volumeId !== sourceVolumeId) throw new Error('写前源卷变化，请先 move-status');
    await this.request('POST', API.save, { item_id: id(itemId), book_id: book.bookId,
      title: before.title, content: before.content, volume_id: before.target.volume_id, volume_name: before.target.volume_name });
    return this.openDraft(book, binding, chapter);
  }
  async createDraft(book, binding, chapter, { allocated = async () => {} } = {}) {
    // 写入前再次查整书，避免预检以后产生重复章号。
    if ((await this.inventory(book, binding)).some(row => row.number === chapter.number)) throw new Error('写入前发现相同章号，请先 reconcile');
    const volume = await this.resolveVolume(book, binding);
    const data = await this.request('POST', API.allocate, { book_id: book.bookId, need_reuse: 0 });
    const itemId = id(data.item_id);
    await allocated(itemId);
    const blank = await this.article(book, itemId);
    if (blank.title?.trim() || htmlToText(blank.content) || blank.publish_status !== 0) throw new Error('分配的草稿非空或已提交，拒绝覆盖');
    await this.request('POST', API.save, {
      item_id: itemId, book_id: book.bookId, title: `第${chapter.number}章 ${chapter.title}`, content: textToHTML(chapter.body),
      volume_id: volume.volume_id, volume_name: volume.volume_name,
    });
    // 草稿保存和正式发布是不同接口；不能凭一个 publish_status=0 参数判断安全。
    // 独立读取实际状态，拒绝把已提交或已发布章节当成草稿成功。
    this.verifyArticle(await this.article(book, itemId), volume, chapter);
    // 不以写接口响应作为成功凭据；重新列草稿并读取正文。
    return this.openDraft(book, binding, chapter);
  }
}

// 只有发布命令显式创建此客户端；配置、普通 upload 和 reconcile 无法开启发布权限。
export class FanqiePublicationApi extends FanqieApi {
  constructor(...args) { super(...args); publicationClients.add(this); }
  async submitExistingDraft(book, binding, chapter, itemId, useAi) {
    if (!['yes', 'no'].includes(useAi)) throw new Error('发布必须提供 --use-ai yes 或 no');
    const volume = await this.resolveVolume(book, binding);
    const inventory = await this.inventory(book, binding);
    const rows = inventory.filter(r => r.number === chapter.number);
    if (rows.length !== 1 || rows[0].itemId !== itemId || rows[0].kind !== 'drafts') throw new Error('提交前草稿状态或 ID 已变化，请先 publish-status');
    const data = await this.article(book, itemId);
    this.verifyArticle(data, volume, chapter);
    if (data.author_speak || Number(data.column_data?.need_pay ?? 0) !== 0) throw new Error('含作者有话说或收费设置的草稿暂不支持 CLI 发布，请在后台确认设置');
    // 保留经过核对的后台正文 HTML，不重新创建章节、不覆盖为另一份稿件。
    return this.request('POST', PUBLICATION_ENDPOINT, {
      item_id: id(itemId), book_id: id(book.bookId), title: data.title, content: data.content,
      volume_id: volume.volume_id, volume_name: volume.volume_name,
      publish_status: 1, timer_status: 0, timer_time: '', need_pay: 0,
      device_platform: 'pc', speak_type: 0, use_ai: useAi === 'yes' ? 1 : 2,
      timer_chapter_preview: '[]', has_chapter_ad: 'false', chapter_ad_types: '',
    });
  }
}

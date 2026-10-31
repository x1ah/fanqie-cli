import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalize } from './core.js';

const defaults = {
  number: ['input[placeholder*="章节号"]', 'input[placeholder*="章数"]'],
  title: ['input[placeholder*="章节名称"]', 'input[placeholder*="章节名"]', 'input[placeholder*="章节标题"]', 'input[placeholder*="请输入标题"]'],
  body: ['.tiptap[contenteditable="true"]', '.ProseMirror[contenteditable="true"]', '[contenteditable="true"][role="textbox"]', '[contenteditable="true"]'],
  rows: ['.arco-table-body .arco-table-tr', '.ant-table-tbody > tr', 'tbody > tr'],
  volume: ['.flat-serial-select:not(.chapter-status-select) .arco-select-view-value', '.arco-select-view-value', '.ant-select-selection-item', '[data-fanqie-volume]'],
  editorVolume: ['.publish-header-volume-name', '[data-fanqie-editor-volume]'],
  next: ['.arco-pagination-item-next', '.ant-pagination-next', 'button[aria-label="下一页"]', 'button[aria-label="Next page"]'],
  edit: ['a:has(.auto-editor-draft-edit)', 'a[href*="/publish/"]', '[aria-label="编辑"]', '[title="编辑"]'],
};
const labels = {
  drafts: /^(?:草稿箱|草稿)(?:\s*[（(]\d+[）)])?$/u,
  published: /^(?:已发布|章节管理|已发布章节|章节目录)(?:\s*[（(]\d+[）)])?$/u,
  create: /^(?:新建章节|新建草稿)$/u,
  save: /^(?:存草稿|存为草稿|保存草稿|保存并退出)$/u,
  edit: /^编辑$/u,
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export class FanqieBrowser {
  constructor(config, { headless, dataDir } = {}) {
    this.config = config;
    this.dataDir = dataDir;
    this.options = { ...config.browser, ...(headless === undefined ? {} : { headless }) };
  }

  async start() {
    if (!this.dataDir) throw new Error('浏览器需要明确的工作区数据目录');
    const profile = path.join(this.dataDir, 'browser');
    await mkdir(profile, { recursive: true, mode: 0o700 });
    this.context = await chromium.launchPersistentContext(profile, {
      channel: this.options.channel || undefined, headless: this.options.headless,
      viewport: { width: 1440, height: 1000 }, locale: 'zh-CN',
    });
    this.context.setDefaultTimeout(this.options.timeout);
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    return this;
  }

  async close() { await this.context?.close(); }

  candidates(root, key) {
    const override = this.config.selectors[key];
    if (override) return [root.locator(override)];
    const locators = (defaults[key] ?? []).map(selector => root.locator(selector));
    if (labels[key]) {
      locators.push(root.getByRole('button', { name: labels[key] }));
      locators.push(root.getByText(labels[key]));
    }
    return locators;
  }

  async find(key, root = this.page, timeout = this.options.timeout) {
    const end = Date.now() + timeout;
    do {
      for (const locator of this.candidates(root, key)) {
        const visible = locator.filter({ visible: true });
        if (await visible.count() === 1) return visible;
      }
      // 当前站点共用编辑器把章号、章名放在专用标题容器中。
      // 只有恰好两个控件且第一个值为数字/空时才采用顺序回退。
      if (!this.config.selectors[key] && ['number', 'title'].includes(key)) {
        const fields = root.locator('.serial-editor-title input, .serial-editor-title textarea').filter({ visible: true });
        if (await fields.count() === 2 && /^\d*$/.test(await fields.nth(0).inputValue())) return fields.nth(key === 'number' ? 0 : 1);
      }
      await delay(100);
    } while (Date.now() < end);
    throw new Error(`无法唯一定位「${key}」。请运行 inspect，并在 .fanqie/config.json 的 selectors 中设置 CSS 选择器。`);
  }

  async goto(url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    if (/\/login(?:[/?]|$)/.test(this.page.url())) throw new Error('登录已失效，请先运行 login');
  }

  async ensureVolume(binding) {
    const control = await this.find('volume');
    if (normalize(await control.innerText()) === binding.remoteName) return;
    if (await control.evaluate(e => e.tagName === 'SELECT')) {
      await control.selectOption({ label: binding.remoteName });
    } else {
      await control.click();
      const option = this.page.getByText(binding.remoteName, { exact: true }).filter({ visible: true });
      if (await option.count() !== 1) throw new Error(`无法唯一选择后台分卷「${binding.remoteName}」`);
      await option.click();
    }
    // 分卷切换可能异步加载，等待完成后再读章节列表。
    await delay(600);
    if (normalize(await control.innerText()) !== binding.remoteName) throw new Error('分卷切换未生效');
  }

  async manager(book, binding, kind) {
    await this.goto(binding.manageUrl);
    await this.page.getByText(book.title, { exact: true }).filter({ visible: true }).first().waitFor();
    await (await this.find(kind)).click();
    await delay(500);
    if (kind === 'published') await this.ensureVolume(binding);
    await this.assertNoErrors();
  }

  async assertNoErrors() {
    const errors = this.page.locator('.arco-message-error, .ant-message-error, .arco-notification-error').filter({ visible: true });
    if (await errors.count()) throw new Error(`后台报错：${(await errors.allInnerTexts()).join('；')}`);
  }

  async rowLocator() {
    // 列表为空时也要识别表格容器，不能把加载失败当空列表。
    if (this.config.selectors.rows) return this.page.locator(this.config.selectors.rows).filter({ visible: true });
    await this.page.locator('.arco-table, .ant-table, table, .draft-table .empty, .chapter-table .empty').filter({ visible: true }).first().waitFor();
    for (const selector of defaults.rows) {
      const rows = this.page.locator(selector).filter({ visible: true });
      if (await rows.count()) return rows;
    }
    return this.page.locator('tbody > tr').filter({ visible: true });
  }

  async nextPage() {
    let button;
    try { button = await this.find('next', this.page, 150); }
    catch {
      if (await this.page.locator('.arco-pagination, .ant-pagination').filter({ visible: true }).count()) throw new Error('发现分页但无法唯一定位下一页，停止核对');
      return false;
    }
    const disabled = await button.evaluate(e => e.matches(':disabled') || e.getAttribute('aria-disabled') === 'true' || /(?:^|[\s-])disabled(?:$|[\s-])/.test(e.className) || !!e.querySelector(':disabled'));
    if (disabled) return false;
    const old = await (await this.rowLocator()).allTextContents();
    await button.click();
    const end = Date.now() + this.options.timeout;
    while (Date.now() < end) {
      await delay(150);
      const current = await (await this.rowLocator()).allTextContents();
      if (JSON.stringify(current) !== JSON.stringify(old)) return true;
    }
    throw new Error('翻页后列表未变化，停止以免漏检章节');
  }

  async walkRows(visitor) {
    const pages = new Set();
    for (let n = 0; n < 1000; n++) {
      const rows = await this.rowLocator();
      const texts = await rows.allInnerTexts();
      await this.assertNoErrors();
      if (!texts.length && !await this.page.getByText(/暂无(?:草稿|章节|数据)|没有章节|无数据/u).filter({ visible: true }).count()) throw new Error('章节列表为空且没有空列表提示，不能判定为没有章节');
      const signature = JSON.stringify(texts);
      if (pages.has(signature)) throw new Error('列表翻页重复，停止核对');
      pages.add(signature);
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        const match = text.match(/第\s*(\d+)\s*章/u);
        if (!match) {
          if (/暂无|没有|无数据|No Data/i.test(text) || !text.trim()) continue;
          throw new Error(`无法解析后台章节行：${text.slice(0, 80)}；请设置 selectors.rows 指向章节数据行`);
        }
        const result = await visitor({ number: Number(match[1]), text, row: rows.nth(i) });
        if (result !== undefined) return result;
      }
      if (!await this.nextPage()) return undefined;
    }
    throw new Error('章节列表超过 1000 页，停止');
  }

  async inventory(book, binding) {
    const entries = [];
    for (const kind of ['published', 'drafts']) {
      await this.manager(book, binding, kind);
      await this.walkRows(async row => { entries.push({ number: row.number, kind, text: row.text }); });
    }
    return entries;
  }

  async clickOpening(locator) {
    const before = new Set(this.context.pages());
    await locator.click();
    // SPA 与新标签两种打开方式都支持。
    await delay(500);
    const opened = this.context.pages().filter(p => !before.has(p));
    if (opened.length > 1) throw new Error('操作打开了多个页面，请人工检查');
    if (opened.length === 1) {
      const previous = this.page;
      this.page = opened[0];
      await previous.close();
    }
    await this.page.waitForLoadState('domcontentloaded');
  }

  async editorValues() {
    const number = await this.find('number');
    const title = await this.find('title');
    const body = await this.find('body');
    const text = await body.evaluate(e => {
      if ('value' in e) return e.value;
      const placeholders = [...e.querySelectorAll('.syl-placeholder, .ProseMirror-widget')].map(n => n.textContent).join('');
      if (placeholders && e.textContent.trim() === placeholders.trim()) return '';
      return e.innerText;
    });
    return { number: (await number.inputValue()).trim(), title: (await title.inputValue()).trim(), body: normalize(text) };
  }

  async verifyEditor(chapter) {
    const end = Date.now() + this.options.timeout;
    do {
      const actual = await this.editorValues();
      if (Number(actual.number) === chapter.number && actual.title === chapter.title && actual.body === normalize(chapter.body)) return;
      await delay(100);
    } while (Date.now() < end);
    throw new Error(`第 ${chapter.number} 章回读不一致（章号、标题或正文），请人工检查草稿`);
  }

  async openDraft(book, binding, chapter) {
    await this.manager(book, binding, 'drafts');
    const found = await this.walkRows(async ({ number, row }) => {
      if (number !== chapter.number) return undefined;
      await this.clickOpening(await this.find('edit', row));
      return true;
    });
    if (!found) throw new Error(`草稿箱中找不到第 ${chapter.number} 章`);
    await this.verifyEditorVolume(binding);
    await this.verifyEditor(chapter);
    await this.assertNoErrors();
    return this.page.url();
  }

  async createDraft(book, binding, chapter) {
    await this.manager(book, binding, 'drafts');
    await this.clickOpening(await this.find('create'));
    const fields = await this.editorValues();
    if (fields.title || fields.body) throw new Error('新建章节打开了有内容的编辑器，拒绝覆盖');
    const volume = await this.find('editorVolume');
    if (normalize(await volume.innerText()) !== binding.remoteName) {
      await volume.click();
      const option = this.page.locator('.editor-volume-list-item-normal:not(.unavailable) > span').filter({ hasText: binding.remoteName }).filter({ visible: true });
      const exact = option.filter({ hasText: new RegExp(`^${binding.remoteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
      if (await exact.count() !== 1) throw new Error('无法唯一定位编辑器分卷，请人工核对');
      await exact.click();
    }
    await this.verifyEditorVolume(binding);
    const editor = await this.find('body');
    await (await this.find('number')).fill(String(chapter.number));
    await (await this.find('title')).fill(chapter.title);
    // 用真实键盘输入事件写入富文本，保留段落，避免直接改 innerHTML 让编辑器状态丢失。
    await editor.fill('');
    await editor.focus();
    const paragraphs = chapter.body.split('\n');
    for (let i = 0; i < paragraphs.length; i++) {
      if (i) await this.page.keyboard.press('Enter');
      if (paragraphs[i]) await this.page.keyboard.insertText(paragraphs[i]);
    }
    await this.verifyEditor(chapter);
    await (await this.find('save')).click();
    // 自动保存和显式保存均不能作为成功凭据；必须重新进入草稿编辑器回读。
    const end = Date.now() + this.options.timeout;
    let lastError;
    do {
      await delay(500);
      try { return await this.openDraft(book, binding, chapter); }
      catch (e) { lastError = e; }
    } while (Date.now() < end);
    throw lastError;
  }

  async verifyEditorVolume(binding) {
    if (normalize(await (await this.find('editorVolume')).innerText()) !== binding.remoteName) throw new Error('草稿所属分卷不一致');
  }

  async diagnostics() {
    const dir = path.join(this.dataDir, 'diagnostics', new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await this.page.screenshot({ path: path.join(dir, 'page.png'), fullPage: true }).catch(() => {});
    const elements = await this.page.locator('input, textarea, [contenteditable], button, [role="tab"], select, [role="combobox"], a[href]').evaluateAll(els => els.map(e => ({
      tag: e.tagName, id: e.id, class: e.className, role: e.getAttribute('role'),
      placeholder: e.getAttribute('placeholder'), ariaLabel: e.getAttribute('aria-label'),
      text: e.tagName === 'INPUT' || e.hasAttribute('contenteditable') ? undefined : e.innerText?.slice(0, 100),
      href: e.getAttribute('href'),
    })));
    await writeFile(path.join(dir, 'elements.json'), JSON.stringify({ url: this.page.url(), elements }, null, 2), { mode: 0o600 });
    return dir;
  }
}

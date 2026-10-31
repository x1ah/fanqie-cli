import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { resolveWorkspace, initConfig, readJSON, atomicJSON, bookFor, addBook, bindVolume, scanBook, assertState, stateKey, lock } from './core.js';
import { FanqieBrowser } from './browser.js';
import { uploadChapters } from './upload.js';

const HELP = `番茄小说 CLI

  fanqie init [--discover]            初始化工作区（不覆盖已有配置）
  fanqie add <别名> --title <后台书名> --source <正文目录>
  fanqie login                        打开独立 Chrome，手动登录并保存会话
  fanqie books                        列出本地作品与后台绑定
  fanqie bind <作品> --url <章节管理页> --volume 第一卷 --remote-volume <后台分卷完整名称>
  fanqie check <作品> [--volume 第一卷] [--chapters 1-3]
  fanqie plan <作品> [--volume 第一卷] [--chapters 1-3]
  fanqie upload <作品> --volume 第一卷 --chapters 1-3 [--dry-run]
  fanqie upload <作品> --volume 第一卷 --all
  fanqie reconcile <作品> --volume 第一卷 --chapters 1-3
  fanqie status <作品>
  fanqie inspect <作品> --volume 第一卷

作品数量不限，使用 add 添加自己的作品。--chapters 支持 1、1-3、1,3-5。
没有分卷子目录时，使用 --volume . 绑定正文根目录。
upload 只存草稿；reconcile 只回读核对已有草稿，不创建或覆盖。
--json 输出 JSON；--headless 在后台运行（login/inspect 除外）。
--workspace <目录> / -w <目录> 指定工作区；默认从当前目录向上查找配置。
配置及会话保存在工作区 .fanqie/ 下，不保存在工具安装目录。
--version 显示版本。`;

async function waitForEnter(message) {
  if (!process.stdin.isTTY) throw new Error('该命令需要交互式终端，请在本机终端运行');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { await rl.question(message); } finally { rl.close(); }
}

export async function main(args = process.argv.slice(2), { defaultWorkspace } = {}) {
  const { values: flags, positionals } = parseArgs({ args, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, json: { type: 'boolean' }, headless: { type: 'boolean' },
    version: { type: 'boolean', short: 'v' }, workspace: { type: 'string', short: 'w' },
    title: { type: 'string' }, source: { type: 'string' }, discover: { type: 'boolean' },
    url: { type: 'string' }, 'book-id': { type: 'string' }, volume: { type: 'string' },
    'remote-volume': { type: 'string' }, chapters: { type: 'string' }, all: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
  } });
  const [command, alias, ...extra] = positionals;
  if (flags.version) { console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version); return; }
  if (extra.length) throw new Error('多余参数；含空格的书名或分卷名请使用引号');
  if (flags.help || !command) { console.log(HELP); return; }
  if (!['init', 'add', 'books', 'bind', 'check', 'plan', 'upload', 'reconcile', 'status', 'login', 'inspect'].includes(command)) throw new Error(`未知命令：${command}`);
  const { root: ROOT, data: DATA, config: CONFIG } = await resolveWorkspace(flags.workspace ?? defaultWorkspace);
  const output = value => console.log(flags.json ? JSON.stringify(value, null, 2) : typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  if (command === 'init') {
    const release = await lock(DATA);
    try { output({ config: CONFIG, books: Object.keys((await initConfig({ root: ROOT, data: DATA, config: CONFIG }, { discover: flags.discover })).books) }); } finally { await release(); }
    return;
  }
  const config = await readJSON(CONFIG, null);
  if (!config) throw new Error('尚未初始化，请先运行 init');
  if (command === 'add') {
    const release = await lock(DATA);
    try {
      const fresh = await readJSON(CONFIG);
      await addBook(fresh, alias, { title: flags.title, source: flags.source }, ROOT);
      await atomicJSON(CONFIG, fresh);
      output({ alias, ...fresh.books[alias] });
    } finally { await release(); }
    return;
  }
  if (command === 'books') { output(config.books); return; }
  const book = command === 'login' ? null : bookFor(config, alias);
  const stateFile = path.join(DATA, 'state.json');
  if (command === 'status') {
    const state = await readJSON(stateFile, {});
    output({ book: book.title, records: Object.entries(state).filter(([key]) => key.startsWith(`${book.bookId}/`)).map(([, row]) => row) });
    return;
  }
  if (command === 'bind') {
    if (!flags.url) throw new Error('请指定 --url 章节管理页地址');
    const release = await lock(DATA);
    try {
      // 锁内重读，避免并发配置更新丢失。
      const fresh = await readJSON(CONFIG);
      bindVolume(bookFor(fresh, alias), { url: flags.url, volume: flags.volume, remoteVolume: flags['remote-volume'], bookId: flags['book-id'] });
      const other = Object.entries(fresh.books).find(([key, value]) => key !== alias && value.bookId && value.bookId === fresh.books[alias].bookId);
      if (other) throw new Error(`该后台作品 ID 已由别名「${other[0]}」绑定，请复用该别名`);
      await atomicJSON(CONFIG, fresh);
      output(`已保存 ${book.title} / ${flags.volume} 的绑定。后台书名和分卷将在上传时核对。`);
    } finally { await release(); }
    return;
  }
  let chapters;
  if (['check', 'plan', 'upload', 'reconcile'].includes(command)) {
    if (flags.all && flags.chapters) throw new Error('--all 与 --chapters 不能同时使用');
    chapters = await scanBook(book, { volume: flags.volume, chapters: flags.chapters }, ROOT);
    const state = await readJSON(stateFile, {});
    if (command === 'check') {
      output({ book: book.title, chapters: chapters.map(ch => ({ number: ch.number, title: ch.title, volume: ch.volume, characters: ch.characters })), message: chapters.length ? '格式检查通过；不代表内容已审读或已上传' : '暂无章节正文' });
      return;
    }
    if (command === 'plan' || flags['dry-run']) {
      const pending = chapters.map(ch => {
        const record = state[stateKey(book, ch)];
        return { number: ch.number, title: ch.title, volume: ch.volume, characters: ch.characters,
          localStatus: !record ? '未记录' : record.status !== 'verified' ? '需 reconcile' : record.hash !== ch.hash || record.volume !== ch.volume ? '上传后已修改' : '已核对草稿',
          bound: !!book.volumes[ch.volume], file: path.relative(ROOT, ch.file) };
      });
      output({ book: book.title, destination: '草稿箱', chapters: pending, message: '仅本地预览，未连接后台；上传前还会核对远端冲突' });
      return;
    }
    if (!flags.volume || (!flags.chapters && !flags.all)) throw new Error('上传/核对请明确指定 --volume 和 --chapters（或 --all）');
    if (!chapters.length) throw new Error('没有可处理的章节正文');
    if (!book.bookId || !book.volumes[flags.volume]) throw new Error('该分卷尚未绑定，请先运行 bind');
    if (command === 'upload') assertState(state, book, chapters);
  }
  if (command === 'inspect' && (!flags.volume || !book.volumes[flags.volume])) throw new Error('inspect 需要已绑定的 --volume');
  if (['login', 'inspect'].includes(command) && !process.stdin.isTTY) throw new Error('请在本机交互式终端运行 login / inspect');
  const release = await lock(DATA);
  const adapter = new FanqieBrowser(config, { dataDir: DATA, headless: ['login', 'inspect'].includes(command) ? false : flags.headless ? true : undefined });
  try {
    await adapter.start();
    if (command === 'login') {
      await adapter.page.goto('https://fanqienovel.com/main/writer/', { waitUntil: 'domcontentloaded' });
      await waitForEnter('请在浏览器中完成登录，进入作品列表后回到这里按回车：');
      // 从官方入口重新导航，确保会话持久化后仍能进入后台。
      await adapter.goto('https://fanqienovel.com/main/writer/');
      await adapter.page.waitForTimeout(1000);
      if (/\/login(?:[/?]|$)/.test(adapter.page.url())) throw new Error('仍在登录页，请重新运行 login');
      output('浏览器会话已保存。');
    } else if (command === 'inspect') {
      await adapter.goto(book.volumes[flags.volume].manageUrl);
      await waitForEnter('请在浏览器中停留在要诊断的管理页或编辑页，然后按回车导出诊断：');
      output(await adapter.diagnostics());
    } else {
      const state = await readJSON(stateFile, {});
      const result = await uploadChapters({ adapter, book, chapters, state,
        persist: value => atomicJSON(stateFile, value), reconcile: command === 'reconcile',
        log: flags.json ? () => {} : message => console.log(message),
      });
      output({ book: book.title, results: result, message: '草稿已回读核对，尚未发布。' });
    }
  } catch (error) {
    if (adapter.page && !adapter.page.isClosed()) {
      try { console.error(`诊断文件：${await adapter.diagnostics()}`); } catch { /* 保留原始错误 */ }
    }
    throw error;
  } finally { try { await adapter.close(); } finally { await release(); } }
}

import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { resolveWorkspace, initConfig, readJSON, atomicJSON, bookFor, addBook, bindVolume, scanBook, assertState, stateKey, lock } from './core.js';
import { FanqieApi } from './api.js';
import { refreshHttpSession, exportHttpSession } from './session.js';
import { changeVolume, validateVolumeName } from './volumes.js';
import { uploadChapters } from './upload.js';
import { publishChapters } from './publish.js';
import { reviseChapters } from './revise.js';
import { moveChapters } from './move.js';
import { reviseAbstract } from './metadata.js';
import { HELP } from './help.js';

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
    'abstract-file': { type: 'string' }, 'from-volume-id': { type: 'string' }, 'replace-volume-id': { type: 'string' }, 'resolve-not-applied': { type: 'boolean' },
    'use-ai': { type: 'string' }, 'remote-volume': { type: 'string' }, chapters: { type: 'string' }, all: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
  } });
  const [command, alias, ...extra] = positionals;
  if (flags.version) { console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version); return; }
  if (extra.length) throw new Error('多余参数；含空格的书名或分卷名请使用引号');
  if (flags.help || !command) { console.log(HELP); return; }
  if (!['init', 'add', 'books', 'bind', 'check', 'plan', 'upload', 'reconcile', 'status', 'login', 'inspect', 'auth-refresh', 'volumes', 'volume-create', 'volume-rename', 'publish', 'publish-status', 'revise', 'revise-status', 'move', 'move-status', 'book-abstract', 'book-abstract-status'].includes(command)) throw new Error(`未知命令：${command}`);
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
  const book = ['login', 'auth-refresh'].includes(command) ? null : bookFor(config, alias);
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
  if (['revise', 'revise-status', 'move', 'move-status'].includes(command)) {
    if (!flags.volume || !flags.chapters || flags.all) throw new Error('修订/查询请明确 --volume 和 --chapters，不支持 --all');
    if (['revise-status','move-status'].includes(command) && flags['dry-run']) throw new Error(`${command} 已是只读查询，不使用 --dry-run`);
    chapters = await scanBook(book, { volume: flags.volume, chapters: flags.chapters }, ROOT);
    if (!chapters.length || !book.bookId || !book.volumes[flags.volume]) throw new Error('没有有效章节或分卷未绑定');
  }

  if (['publish', 'publish-status'].includes(command)) {
    if (!flags.volume || !flags.chapters || flags.all) throw new Error('发布/查询请明确 --volume 和 --chapters，不支持 --all');
    if (flags['use-ai'] !== undefined && !['yes','no'].includes(flags['use-ai'])) throw new Error('--use-ai 只能为 yes 或 no');
    if (command === 'publish' && !flags['dry-run'] && !flags['use-ai']) throw new Error('发布必须明确 --use-ai yes 或 no');
    if (!book.bookId || !book.volumes[flags.volume]) throw new Error('发布分卷尚未绑定');
    chapters = await scanBook(book, { volume: flags.volume, chapters: flags.chapters }, ROOT);
    if (!chapters.length) throw new Error('没有选中的本地章节');
  }
  if (command === 'inspect' && (!flags.volume || !book.volumes[flags.volume])) throw new Error('inspect 需要已绑定的 --volume');
  if (['login', 'inspect'].includes(command) && !process.stdin.isTTY) throw new Error('请在本机交互式终端运行 login / inspect');
  if (['volumes', 'volume-create', 'volume-rename'].includes(command) && !book.bookId) throw new Error('作品尚未绑定后台 ID，请先 bind');
  if (['volume-create', 'volume-rename'].includes(command)) {
    if (!flags.volume) throw new Error('分卷操作需要 --volume');
    validateVolumeName(flags['remote-volume']);
  }
  const release = await lock(DATA);
  let adapter;
  try {
    // 锁内重读配置，防止等待期间绑定被其他操作更新。
    const fresh = await readJSON(CONFIG);
    const activeBook = book ? bookFor(fresh, alias) : null;
    if (['login', 'inspect'].includes(command)) {
      const { FanqieBrowser } = await import('./browser.js');
      adapter = new FanqieBrowser(fresh, { dataDir: DATA, headless: false });
      await adapter.start();
      if (command === 'login') {
        await adapter.page.goto('https://fanqienovel.com/main/writer/', { waitUntil: 'domcontentloaded' });
        await waitForEnter('请在浏览器中完成登录，进入作品列表后回到这里按回车：');
        await adapter.goto('https://fanqienovel.com/main/writer/book-manage');
        await adapter.page.waitForTimeout(1000);
        await exportHttpSession(adapter, DATA);
        output('浏览器与 HTTP 会话已保存。');
      } else {
        await adapter.goto(activeBook.volumes[flags.volume].manageUrl);
        await waitForEnter('请在浏览器中停留在要诊断的管理页或编辑页，然后按回车导出诊断：');
        output(await adapter.diagnostics());
      }
      return;
    }
    if (command === 'auth-refresh') {
      await refreshHttpSession(fresh, DATA, { headless: flags.headless ?? true });
      output('HTTP 会话已从现有浏览器登录态刷新，无需重新登录。');
      return;
    }
    // 旧工作区首次升级：一次性复用 Chrome 会话导出，此后不启动浏览器。
    if (!await readJSON(path.join(DATA, 'http-auth.json'), null)) await refreshHttpSession(fresh, DATA, { headless: flags.headless ?? true });
    const Client = command === 'publish' && !flags['dry-run'] ? (await import('./api.js')).FanqiePublicationApi : FanqieApi;
    adapter = await new Client(fresh, { dataDir: DATA }).start();
    if (['book-abstract', 'book-abstract-status'].includes(command)) {
      if (!flags['abstract-file'] || !activeBook.bookId) throw new Error('需要绑定作品和 --abstract-file');
      if (flags.volume || flags.chapters || flags.all || (command==='book-abstract-status' && flags['dry-run'])) throw new Error('简介命令参数不适用');
      const abstract = (await readFile(path.resolve(ROOT,flags['abstract-file']),'utf8')).trim();
      const journalFile=path.join(DATA,'book-abstract-operations.json');
      output(await reviseAbstract({adapter,book:activeBook,abstract,journal:await readJSON(journalFile,{}),persist:v=>atomicJSON(journalFile,v),dryRun:!!flags['dry-run'],statusOnly:command==='book-abstract-status'}));
    } else if (['move', 'move-status'].includes(command)) {
      chapters = await scanBook(activeBook, { volume: flags.volume, chapters: flags.chapters }, ROOT);
      const journalFile = path.join(DATA, 'draft-moves.json');
      const results = await moveChapters({adapter,book:activeBook,chapters,sourceVolumeId:flags['from-volume-id'],
        state:await readJSON(stateFile,{}),journal:await readJSON(journalFile,{}),
        persistState:value=>atomicJSON(stateFile,value),persistJournal:value=>atomicJSON(journalFile,value),
        dryRun:!!flags['dry-run'],statusOnly:command === 'move-status'});
      output({book:activeBook.title,results,message:'原ID草稿移卷/核验；未提交审核。'});
    } else if (['revise', 'revise-status'].includes(command)) {
      chapters = await scanBook(activeBook, { volume: flags.volume, chapters: flags.chapters }, ROOT);
      const journalFile = path.join(DATA, 'draft-revisions.json');
      const results = await reviseChapters({ adapter, book: activeBook, chapters,
        state: await readJSON(stateFile, {}), journal: await readJSON(journalFile, {}),
        persistState: value => atomicJSON(stateFile, value), persistJournal: value => atomicJSON(journalFile, value),
        dryRun: !!flags['dry-run'], statusOnly: command === 'revise-status',
      });
      output({ book: activeBook.title, transport: 'http', results, message: flags['dry-run'] ? '在线修订预览，未写入。' : '仅核对/修订原草稿；not-applied=未应用，draft-verified=全文草稿一致；未提交审核。' });
    } else if (['publish', 'publish-status'].includes(command)) {
      chapters = await scanBook(activeBook, { volume: flags.volume, chapters: flags.chapters }, ROOT);
      const journalFile = path.join(DATA, 'publication-state.json');
      const results = await publishChapters({ adapter, book: activeBook, chapters, useAi: flags['use-ai'],
        journal: await readJSON(journalFile, {}), persist: value => atomicJSON(journalFile, value),
        dryRun: !!flags['dry-run'], statusOnly: command === 'publish-status',
      });
      output({ book: activeBook.title, transport: 'http', results, message: flags['dry-run'] ? '在线预览，未提交发布。' : '已回读平台状态：reviewing=审核中，published=已发布；pending 表示结果未核实。' });
    } else if (command === 'volumes') {
      await adapter.assertBook(activeBook);
      output({ book: activeBook.title, volumes: await adapter.volumes(activeBook) });
    } else if (['volume-create', 'volume-rename'].includes(command)) {
      const journalFile = path.join(DATA, 'volume-operations.json');
      output(await changeVolume({ adapter, book: activeBook, volume: flags.volume, remoteName: flags['remote-volume'],
        action: command === 'volume-create' ? 'create' : 'rename', dryRun: flags['dry-run'],
        replaceVolumeId:flags['replace-volume-id'],resolveNotApplied:!!flags['resolve-not-applied'],
        journal: await readJSON(journalFile, {}), persist: value => atomicJSON(journalFile, value),
        saveBook: async value => { fresh.books[alias] = value; await atomicJSON(CONFIG, fresh); },
      }));
    } else {
      // 正文可能由另一个写作进程更新；锁内重新扫描与核对上传状态。
      chapters = await scanBook(activeBook, { volume: flags.volume, chapters: flags.chapters }, ROOT);
      if (!chapters.length || !activeBook.volumes[flags.volume]) throw new Error('章节或分卷绑定已变化，请重新检查');
      const state = await readJSON(stateFile, {});
      const result = await uploadChapters({ adapter, book: activeBook, chapters, state,
        persist: value => atomicJSON(stateFile, value), reconcile: command === 'reconcile',
        log: flags.json ? () => {} : message => console.log(message),
      });
      output({ book: activeBook.title, transport: 'http', results: result, message: '草稿已通过 HTTP 回读核对，尚未发布。' });
    }
  } finally { try { await adapter?.close(); } finally { await release(); } }
}

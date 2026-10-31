import { readdir, readFile, mkdir, writeFile, rename, open, unlink, access, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export function workspacePaths(root) {
  root = path.resolve(root);
  const data = path.join(root, '.fanqie');
  return { root, data, config: path.join(data, 'config.json') };
}

export async function resolveWorkspace(explicit, cwd = process.cwd()) {
  if (explicit) return workspacePaths(path.resolve(cwd, explicit));
  let current = path.resolve(cwd);
  while (true) {
    const paths = workspacePaths(current);
    try { await access(paths.config); return paths; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const parent = path.dirname(current);
    if (parent === current) return workspacePaths(cwd);
    current = parent;
  }
}
export const normalize = text => text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').split('\n').map(s => s.trim()).filter(Boolean).join('\n');
export const digest = text => createHash('sha256').update(text).digest('hex');

export async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}

export async function atomicJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, file);
}

export async function lock(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'run.lock');
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (e) {
    if (e.code === 'EEXIST') throw new Error(`另一个番茄命令正在运行，或上次异常退出。确认没有运行中的命令后删除 ${file}`);
    throw e;
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return async () => { await handle.close(); await unlink(file); };
}

export async function initConfig(paths, { discover = false } = {}) {
  const existing = await readJSON(paths.config, null);
  if (existing) return existing;
  const books = {};
  for (const entry of discover ? await readdir(paths.root, { withFileTypes: true }) : []) {
    if (!entry.isDirectory()) continue;
    const meta = await readJSON(path.join(paths.root, entry.name, '作品信息.json'), null);
    if (!meta) continue;
    if (!meta.书名 || typeof meta.书名 !== 'string') throw new Error(`${entry.name}/作品信息.json 缺少字符串「书名」`);
    books[entry.name] = { title: meta.书名, source: `${entry.name}/正文`, bookId: null, volumes: {} };
  }
  const config = { version: 1, browser: { channel: 'chrome', headless: false, timeout: 15000 }, selectors: {}, books };
  await atomicJSON(paths.config, config);
  return config;
}

export function bookFor(config, alias) {
  const book = Object.hasOwn(config.books, alias) ? config.books[alias] : undefined;
  if (!book) throw new Error(`未知作品 ${alias ?? '(未指定)'}，可选：${Object.keys(config.books).join('、')}`);
  return book;
}

export async function addBook(config, alias, { title, source }, root) {
  if (!alias || !title?.trim() || !source) throw new Error('add 需要作品别名、--title 后台书名 和 --source 正文目录');
  if (['__proto__', 'prototype', 'constructor'].includes(alias)) throw new Error('该作品别名不可使用');
  if (Object.hasOwn(config.books, alias)) throw new Error(`作品别名已存在：${alias}；不会覆盖绑定或记录`);
  const absolute = path.resolve(root, source);
  if (!(await stat(absolute)).isDirectory()) throw new Error('正文目录必须是已存在的目录');
  config.books[alias] = { title: title.trim(), source: path.relative(root, absolute) || '.', bookId: null, volumes: {} };
}

export function validateURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'fanqienovel.com' || url.port || url.username || url.password || !url.pathname.startsWith('/main/writer/')) {
    throw new Error('仅接受 https://fanqienovel.com/main/writer/ 下的作家后台地址');
  }
  return url;
}

export function bindVolume(book, { url: value, volume, remoteVolume, bookId }) {
  const url = validateURL(value);
  const fromURL = url.pathname.match(/\/chapter-manage\/(\d+)(?:[&/]|$)/)?.[1] ?? url.searchParams.get('bookId') ?? url.searchParams.get('book_id');
  const id = bookId ?? fromURL;
  if (!id || !/^\d+$/.test(id)) throw new Error('无法识别作品 ID，请用章节管理页地址，或补充 --book-id');
  if (fromURL && fromURL !== id) throw new Error('地址里的作品 ID 与 --book-id 不一致');
  if (!volume || !remoteVolume) throw new Error('请指定 --volume 本地卷目录名 和 --remote-volume 后台分卷完整名称');
  if (book.bookId && book.bookId !== id) throw new Error('该作品已绑定其他作品 ID；请检查配置，不能直接换绑');
  book.bookId = id;
  book.volumes[volume] = { manageUrl: url.href, remoteName: remoteVolume };
}

export function parseChapter(text, file) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const [heading, ...lines] = text.split('\n');
  const match = heading.match(/^(?:#\s+)?第\s*(\d+)\s*章\s+(.+)$/u);
  if (!match) throw new Error(`${file}：首行必须是「# 第001章 章名」或「第001章 章名」`);
  const number = Number(match[1]);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${file}：章节号无效`);
  const title = match[2].trim();
  const body = lines.join('\n').trim();
  if (!body) throw new Error(`${file}：正文为空`);
  const filename = path.basename(file).match(/^第(\d+)章[_\s]+(.+)\.(?:md|txt)$/u)
    ?? path.basename(file).match(/^(\d+)[_\s.-]+(.+)\.(?:md|txt)$/u);
  if (!filename || Number(filename[1]) !== number || filename[2] !== title) throw new Error(`${file}：文件名与首行章号、章名不一致`);
  // 不把工作笔记或 Markdown 语法悄悄改成小说正文。
  if (/^(?:#{1,6}\s|---\s*$|```|>\s|[-*+]\s|\d+\.\s|\|)/mu.test(body) || /!?\[[^\]]*\]\(|\*\*|<!--/.test(body)) {
    throw new Error(`${file}：正文含 Markdown 格式或注释，请整理成纯文字段落`);
  }
  if (/^(?:作者笔记|创作笔记|待补|TODO|本章目标|场景卡|章末钩子)\s*[:：]/imu.test(body)) throw new Error(`${file}：检测到工作笔记`);
  const hash = digest(`${number}\n${title}\n${normalize(body)}`);
  return { number, title, body, hash, file, characters: [...body.replace(/\s/g, '')].length };
}

export function parseRange(value) {
  if (!value) return null;
  const selected = new Set();
  for (const part of value.split(',')) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error('章节范围格式：1 或 1-3 或 1,3-5');
    const start = Number(m[1]), end = Number(m[2] ?? m[1]);
    if (start < 1 || end < start || end - start > 10000 || !Number.isSafeInteger(end)) throw new Error('章节范围无效');
    for (let n = start; n <= end; n++) selected.add(n);
  }
  return selected;
}

export async function scanBook(book, { volume, chapters } = {}, root = process.cwd()) {
  const source = path.resolve(root, book.source);
  const selected = parseRange(chapters);
  const found = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.name.startsWith('.') || ['node_modules', '归档'].includes(entry.name)) continue;
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /^(?:第\d+章[_\s]|\d+[_\s.-]).+\.(md|txt)$/u.test(entry.name)) {
        const localVolume = path.relative(source, path.dirname(file)).split(path.sep).join('/') || '.';
        const chapter = parseChapter(await readFile(file, 'utf8'), file);
        found.push({ ...chapter, volume: localVolume });
      }
    }
  }
  await visit(source);
  const numbers = new Set(), titles = new Set();
  for (const ch of found) {
    if (numbers.has(ch.number)) throw new Error(`章号重复：${ch.number}（本工具要求全书章号连续，不按卷重置）`);
    if (titles.has(ch.title)) throw new Error(`章节标题重复：${ch.title}`);
    numbers.add(ch.number); titles.add(ch.title);
  }
  const inVolume = found.filter(ch => !volume || ch.volume === volume);
  const available = new Set(inVolume.map(ch => ch.number));
  if (selected) for (const number of selected) if (!available.has(number)) throw new Error(`找不到第 ${number} 章${volume ? `（${volume}）` : ''}`);
  return inVolume.filter(ch => !selected || selected.has(ch.number)).sort((a, b) => a.number - b.number);
}

export function stateKey(book, chapter) { return `${book.bookId}/${chapter.number}`; }

export function assertState(state, book, chapters) {
  for (const ch of chapters) {
    const record = state[stateKey(book, ch)];
    if (!record) continue;
    if (record.status !== 'verified') throw new Error(`第 ${ch.number} 章上次结果未核实。请先运行 reconcile 核对，不能直接重传。`);
    if (record.hash !== ch.hash || record.volume !== ch.volume) throw new Error(`第 ${ch.number} 章上传后已修改内容或分卷，请在后台人工修订并核对。CLI 不覆盖旧草稿。`);
  }
}

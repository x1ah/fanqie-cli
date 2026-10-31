import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspacePaths, resolveWorkspace, initConfig, addBook, scanBook, atomicJSON } from '../src/core.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/fanqie.js', import.meta.url));
async function temporary(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fanqie-workspace-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const chapter = (number, title) => `# 第${number}章 ${title}\n\n小说正文第一段。\n\n第二段。`;

test('空工作区不预设作品；添加任意别名、外部正文目录与根目录章节', () => temporary(async dir => {
  const workspace = workspacePaths(path.join(dir, 'workspace'));
  const source = path.join(dir, 'another-novel');
  await mkdir(source);
  await writeFile(path.join(source, '001-出发.txt'), chapter(1, '出发'));
  const config = await initConfig(workspace);
  assert.deepEqual(config.books, {});
  await addBook(config, '新书', { title: '全新的作品', source }, workspace.root);
  const found = await scanBook(config.books.新书, { volume: '.', chapters: '1' }, workspace.root);
  assert.equal(found.length, 1);
  assert.equal(found[0].volume, '.');
  assert.equal(found[0].title, '出发');
  await assert.rejects(addBook(config, '新书', { title: '不要覆盖', source }, workspace.root), /已存在/);
  await assert.rejects(addBook(config, '__proto__', { title: '无效别名', source }, workspace.root), /不可使用/);
}));

test('在正文子目录运行发现上级工作区，显式 --workspace 优先', () => temporary(async dir => {
  const paths = workspacePaths(path.join(dir, 'workspace'));
  await initConfig(paths);
  const nested = path.join(paths.root, 'novel', 'volume');
  await mkdir(nested, { recursive: true });
  assert.deepEqual(await resolveWorkspace(undefined, nested), paths);
  assert.deepEqual(await resolveWorkspace('../../other', nested), workspacePaths(path.resolve(nested, '../../other')));
}));

test('初始化不覆盖旧配置与会话目录，旧版本的作品别名继续使用', () => temporary(async dir => {
  const paths = workspacePaths(dir);
  const config = await initConfig(paths);
  config.books.旧别名 = { title: '旧作品', source: '正文', bookId: '123', volumes: {} };
  await atomicJSON(paths.config, config);
  await mkdir(path.join(paths.data, 'browser'));
  await writeFile(path.join(paths.data, 'browser', 'sentinel'), 'session marker');
  assert.deepEqual(await initConfig(paths), config);
  assert.equal(await readFile(path.join(paths.data, 'browser', 'sentinel'), 'utf8'), 'session marker');
}));

test('--discover 按目录名发现作品，不按题材或书名硬编码别名', () => temporary(async dir => {
  const title = '任意新小说';
  const novel = path.join(dir, '未来的新书');
  await mkdir(novel);
  await writeFile(path.join(novel, '作品信息.json'), JSON.stringify({ 书名: title }));
  const config = await initConfig(workspacePaths(dir), { discover: true });
  assert.deepEqual(Object.keys(config.books), ['未来的新书']);
  assert.equal(config.books.未来的新书.title, title);
}));

test('按分卷筛选仍能发现全书跨卷重复章号，并拒绝缺失章节', () => temporary(async dir => {
  for (const volume of ['卷一', '卷二']) {
    await mkdir(path.join(dir, volume));
    await writeFile(path.join(dir, volume, '第001章_出发.md'), chapter(1, '出发'));
  }
  await assert.rejects(scanBook({ source: dir }, { volume: '卷一' }, dir), /章号重复/);
  await rm(path.join(dir, '卷二'), { recursive: true });
  await assert.rejects(scanBook({ source: dir }, { chapters: '2' }, dir), /找不到/);
}));

test('已安装入口可从其他目录操作任意工作区，输出 JSON，并隔离两个工作区', () => temporary(async dir => {
  const a = path.join(dir, 'a'), b = path.join(dir, 'b');
  await mkdir(a); await mkdir(b);
  const run = async (cwd, ...args) => JSON.parse((await exec(process.execPath, [cli, ...args, '--json'], { cwd })).stdout);
  await run(dir, 'init', '-w', a);
  await run(dir, 'init', '-w', b);
  await mkdir(path.join(a, '正文'));
  await writeFile(path.join(a, '正文', '第001章_新篇.md'), chapter(1, '新篇'));
  await run(dir, 'add', '都市', '--title', '任意都市故事', '--source', '正文', '-w', a);
  const check = await run(path.join(a, '正文'), 'check', '都市');
  assert.equal(check.chapters[0].number, 1);
  assert.equal(check.chapters[0].volume, '.');
  const plan = await run(dir, 'upload', '都市', '--volume', '.', '--chapters', '1', '--dry-run', '-w', a);
  assert.equal(plan.chapters.length, 1);
  assert.equal(plan.chapters[0].bound, false);
  assert.deepEqual(await run(dir, 'books', '-w', b), {});
  assert.equal((await exec(process.execPath, [cli, '--version'], { cwd: dir })).stdout.trim(), '0.2.0');
}));

test('禁止两个别名绑定同一个平台作品，避免状态键发生碰撞', () => temporary(async dir => {
  await mkdir(path.join(dir, '正文'));
  const run = (...args) => exec(process.execPath, [cli, ...args, '--json'], { cwd: dir });
  await run('init');
  for (const alias of ['a', 'b']) await run('add', alias, '--title', alias, '--source', '正文');
  const flags = ['--url', 'https://fanqienovel.com/main/writer/chapter-manage/123', '--volume', '.', '--remote-volume', '第一卷'];
  await run('bind', 'a', ...flags);
  await assert.rejects(run('bind', 'b', ...flags), /已由别名/);
}));

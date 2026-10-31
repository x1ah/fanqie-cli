import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseChapter, parseRange, normalize, bindVolume, lock, assertState, stateKey } from '../src/core.js';
import { uploadChapters } from '../src/upload.js';

const ch = (number = 1) => ({ ...parseChapter(`# 第00${number}章 测试${number}\n\n船靠了岸。\n\n他系好缆绳。`, `/tmp/第00${number}章_测试${number}.md`), volume: '第一卷' });
const book = () => ({ title: '测试书', bookId: '123', volumes: { 第一卷: { manageUrl: 'https://fanqienovel.com/main/writer/chapter-manage/123', remoteName: '第一卷' } } });

test('解析正文保留段落，去除 BOM 和 CRLF，散列允许平台空白规范化', () => {
  const a = parseChapter('\uFEFF# 第001章 测试1\r\n\r\n船靠了岸。\r\n\r\n他系好缆绳。', '/tmp/第001章_测试1.md');
  assert.equal(a.hash, ch().hash);
  assert.equal(a.body, '船靠了岸。\n\n他系好缆绳。');
  assert.equal(normalize('第一段\n\n第二段'), '第一段\n第二段');
});

test('拒绝空正文、标题不一致、工作笔记及 Markdown 混入', () => {
  for (const text of ['# 第001章 测试1', '# 第002章 测试1\n正文', '# 第001章 测试1\n## 工作记录', '# 第001章 测试1\nTODO：补写', '# 第001章 测试1\n这是**加粗**']) {
    assert.throws(() => parseChapter(text, '/tmp/第001章_测试1.md'));
  }
});

test('章节范围验证', () => {
  assert.deepEqual([...parseRange('1,3-5')], [1, 3, 4, 5]);
  for (const range of ['0', '3-1', 'abc', '1-99999', '1,']) assert.throws(() => parseRange(range));
});

test('绑定严格限制官方域名并防止作品换绑', () => {
  const b = { bookId: null, volumes: {} };
  bindVolume(b, { url: 'https://fanqienovel.com/main/writer/chapter-manage/123', volume: '第一卷', remoteVolume: '第一卷 开篇' });
  assert.equal(b.bookId, '123');
  bindVolume(b, { url: 'https://fanqienovel.com/main/writer/chapter-manage/123&测试书?type=2', volume: '第一卷', remoteVolume: '第一卷 开篇' });
  for (const url of ['https://fanqienovel.com.evil.test/main/writer/chapter-manage/123', 'http://fanqienovel.com/main/writer/chapter-manage/123', 'https://fanqienovel.com/main/writer/chapter-manage/456']) {
    assert.throws(() => bindVolume(b, { url, volume: '第一卷', remoteVolume: '第一卷' }));
  }
});

test('进程锁拒绝同时写入并能释放', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fanqie-lock-'));
  try {
    const release = await lock(dir);
    await assert.rejects(lock(dir), /另一个/);
    await release();
    await (await lock(dir))();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('失败写入保留 pending，禁止直接重传；reconcile 回读后恢复', async () => {
  const b = book(), chapter = ch(), state = {}, events = [];
  const adapter = { inventory: async () => [], createDraft: async () => { throw new Error('保存后连接断开'); } };
  const args = { adapter, book: b, chapters: [chapter], state, persist: async () => events.push(structuredClone(state)), log: () => {} };
  await assert.rejects(uploadChapters(args), /连接断开/);
  assert.equal(events[0][stateKey(b, chapter)].status, 'pending');
  assert.throws(() => assertState(state, b, [chapter]), /reconcile/);
  adapter.inventory = async () => [{ number: 1, kind: 'drafts' }];
  adapter.openDraft = async () => 'https://fanqienovel.com/editor/1';
  await uploadChapters({ ...args, reconcile: true });
  assert.equal(state[stateKey(b, chapter)].status, 'verified');
});

test('先核对整批冲突，不先上传前面的章节', async () => {
  let writes = 0;
  const adapter = { inventory: async () => [{ number: 2, kind: 'published' }], createDraft: async () => writes++ };
  await assert.rejects(uploadChapters({ adapter, book: book(), chapters: [ch(1), ch(2)], state: {}, persist: async () => {}, log: () => {} }), /已在发布列表/);
  assert.equal(writes, 0);
});

test('已有同章草稿回读一致后收录，不重复创建；正文修改拒绝自动覆盖', async () => {
  let creates = 0, reads = 0;
  const b = book(), chapter = ch(), state = {};
  const adapter = { inventory: async () => [{ number: 1, kind: 'drafts' }], openDraft: async () => { reads++; return 'editor'; }, createDraft: async () => creates++ };
  const args = { adapter, book: b, chapters: [chapter], state, persist: async () => {}, log: () => {} };
  await uploadChapters(args);
  await uploadChapters(args);
  assert.equal(creates, 0);
  assert.equal(reads, 2);
  await assert.rejects(uploadChapters({ ...args, chapters: [{ ...chapter, hash: 'changed' }] }), /已修改/);
});

test('后台重复章号、草稿回读不一致均不创建新草稿', async () => {
  let creates = 0;
  const args = { book: book(), chapters: [ch()], state: {}, persist: async () => {}, log: () => {} };
  const adapter = { inventory: async () => [{ number: 1, kind: 'drafts' }, { number: 1, kind: 'drafts' }], createDraft: async () => creates++ };
  await assert.rejects(uploadChapters({ ...args, adapter }), /重复章号/);
  adapter.inventory = async () => [{ number: 1, kind: 'drafts' }];
  adapter.openDraft = async () => { throw new Error('回读不一致'); };
  await assert.rejects(uploadChapters({ ...args, adapter }), /回读不一致/);
  assert.equal(creates, 0);
});

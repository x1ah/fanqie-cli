import { assertState, stateKey } from './core.js';

// 所有已选章节先核对冲突，再开始写入；每一章写入前先落盘，崩溃后必须回读恢复。
export async function uploadChapters({ adapter, book, chapters, state, persist, reconcile = false, log = console.log }) {
  if (!reconcile) assertState(state, book, chapters);
  const volume = chapters[0]?.volume;
  if (!volume || chapters.some(ch => ch.volume !== volume)) throw new Error('每次只处理一个分卷，请指定 --volume');
  const binding = book.volumes[volume];
  if (!book.bookId || !binding) throw new Error(`尚未绑定「${volume}」，请先运行 bind`);
  const inventory = await adapter.inventory(book, binding);
  const existing = new Map();
  for (const row of inventory) {
    if (!existing.has(row.number)) existing.set(row.number, []);
    existing.get(row.number).push(row);
  }
  const plan = [];
  for (const chapter of chapters) {
    const key = stateKey(book, chapter);
    const rows = existing.get(chapter.number) ?? [];
    if (rows.length > 1) throw new Error(`后台有重复章号：第 ${chapter.number} 章，请人工处理`);
    if (rows[0]?.kind === 'published') throw new Error(`第 ${chapter.number} 章已在发布列表中，CLI 不覆盖已发布章节`);
    if (!rows.length && (reconcile || state[key])) throw new Error(`后台草稿箱找不到第 ${chapter.number} 章，请人工核对；不会自动重建`);
    if (rows.length) {
      const editorUrl = await adapter.openDraft(book, binding, chapter);
      plan.push({ chapter, editorUrl });
    } else plan.push({ chapter });
  }
  const results = [];
  for (const item of plan) {
    const { chapter } = item;
    const key = stateKey(book, chapter);
    const base = { book: book.title, volume, number: chapter.number, title: chapter.title, hash: chapter.hash, file: chapter.file, destination: 'draft' };
    let editorUrl = item.editorUrl;
    if (!editorUrl) {
      state[key] = { ...base, status: 'pending', startedAt: new Date().toISOString() };
      await persist(state);
      log(`上传第 ${chapter.number} 章：${chapter.title}`);
      editorUrl = await adapter.createDraft(book, binding, chapter);
    } else log(`回读核对第 ${chapter.number} 章：${chapter.title}`);
    state[key] = { ...base, status: 'verified', editorUrl, verifiedAt: new Date().toISOString() };
    await persist(state);
    results.push({ number: chapter.number, title: chapter.title, status: 'draft-verified', editorUrl });
  }
  return results;
}

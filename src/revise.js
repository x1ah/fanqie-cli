import { stateKey } from './core.js';

// 独立命令修改已经核对过的同卷草稿。普通 upload/reconcile 永不调用此写流程。
export async function reviseChapters({ adapter, book, chapters, state, journal, persistState, persistJournal, dryRun = false, statusOnly = false }) {
  const volume = chapters[0]?.volume;
  if (!volume || chapters.some(ch => ch.volume !== volume) || !book.volumes[volume]) throw new Error('修订需要同一已绑定分卷的明确章节');
  const binding = book.volumes[volume], plan = [];
  for (const chapter of chapters) {
    const key = stateKey(book, chapter), prior = state[key], entry = journal[key];
    if (!prior || !['verified', 'pending-revision'].includes(prior.status) || prior.destination !== 'draft' || prior.volume !== volume) throw new Error('修订仅支持有原草稿核验记录的同卷章节');
    const url = new URL(prior.editorUrl);
    const match = url.pathname.match(/^\/main\/writer\/(\d+)\/publish\/(\d+)\/?$/);
    if (url.origin !== 'https://fanqienovel.com' || !match || match[1] !== book.bookId) throw new Error('原核验章节地址与作品不符');
    const itemId = match[2];
    if (statusOnly && (!entry || entry.hash !== chapter.hash || entry.itemId !== itemId)) throw new Error('没有与当前版本对应的修订日志');
    if (!statusOnly && (entry?.status === 'pending' || prior.status === 'pending-revision')) throw new Error('上次修订结果未明，请先运行 revise-status；不会重发写请求');
    const remote = await adapter.revisionSnapshot(book, binding, chapter, itemId);
    const expectedHash = statusOnly ? entry.previous.hash : prior.hash;
    if (![chapter.hash, expectedHash].includes(remote.hash)) throw new Error('后台草稿已被其他操作修改，原摘要不符，拒绝覆盖');
    plan.push({ chapter, key, prior, entry, itemId, remote, expectedHash });
  }
  const results = [];
  for (const p of plan) {
    const { chapter, key, prior, entry, itemId, remote, expectedHash } = p;
    if (dryRun) {
      results.push({ number: chapter.number, status: remote.hash === chapter.hash ? 'unchanged' : 'would-revise', itemId });
      continue;
    }
    if (statusOnly && remote.hash !== chapter.hash) {
      journal[key] = { ...entry, status: 'not-applied', checkedAt: new Date().toISOString() };
      await persistJournal(journal);
      state[key] = { ...prior, hash: entry.previous.hash, title: entry.previous.title, status: 'verified' };
      delete state[key].targetHash;
      await persistState(state);
      results.push({ number: chapter.number, status: 'not-applied', itemId });
      continue;
    }
    if (!statusOnly && remote.hash !== chapter.hash) {
      journal[key] = { itemId, hash: chapter.hash, status: 'pending', previous: remote, startedAt: new Date().toISOString() };
      await persistJournal(journal);
      state[key] = { ...prior, status: 'pending-revision', targetHash: chapter.hash };
      await persistState(state);
      // 写方法内再次查整书与原稿摘要；不是仅凭写接口响应或本地记录覆盖。
      await adapter.reviseDraft(book, binding, chapter, { itemId, expectedHash });
    }
    const editorUrl = await adapter.openDraft(book, binding, chapter);
    state[key] = { book: book.title, volume, number: chapter.number, title: chapter.title, file: chapter.file, hash: chapter.hash, destination: 'draft', status: 'verified', editorUrl, verifiedAt: new Date().toISOString() };
    await persistState(state);
    if (journal[key]) {
      journal[key] = { ...journal[key], status: 'verified', verifiedAt: state[key].verifiedAt };
      await persistJournal(journal);
    }
    results.push({ number: chapter.number, status: 'draft-verified', itemId, editorUrl });
  }
  return results;
}

import { stateKey } from './core.js';

// 独立原ID草稿移卷，正文必须与本地和历史核验摘要相同；不触及已提交章节。
export async function moveChapters({ adapter, book, chapters, sourceVolumeId, state, journal, persistState, persistJournal, dryRun = false, statusOnly = false }) {
  if (!/^\d+$/.test(sourceVolumeId ?? '')) throw new Error('移卷必须明确 --from-volume-id');
  const volume = chapters[0]?.volume;
  if (!volume || chapters.some(c => c.volume !== volume) || !book.volumes[volume]) throw new Error('移卷需要单个已绑定目标卷及明确章号');
  const binding = book.volumes[volume], plan = [];
  for (const chapter of chapters) {
    const key = stateKey(book, chapter), prior = state[key], entry = journal[key];
    if (!prior || !['verified','pending-move'].includes(prior.status) || prior.destination !== 'draft' || prior.hash !== chapter.hash || prior.volume !== volume) throw new Error('移卷仅接受当前正文摘要一致的既往草稿核验记录');
    const url = new URL(prior.editorUrl), m = url.pathname.match(/^\/main\/writer\/(\d+)\/publish\/(\d+)\/?$/);
    if (url.origin !== 'https://fanqienovel.com' || !m || m[1] !== book.bookId) throw new Error('原ID地址与作品不符');
    const itemId = m[2];
    if (entry && (entry.hash !== chapter.hash || entry.itemId !== itemId || entry.sourceVolumeId !== sourceVolumeId || entry.targetVolumeId !== binding.volumeId)) throw new Error('移卷日志版本或目标冲突');
    if (statusOnly && !entry) throw new Error('无对应移卷日志');
    if (!statusOnly && (entry?.status === 'pending' || prior.status === 'pending-move')) throw new Error('未知结果先 move-status，不重发');
    const remote = await adapter.moveSnapshot(book, binding, chapter, itemId, sourceVolumeId);
    if (remote.volumeId === binding.volumeId && !entry) throw new Error('无日志的远端移卷，停止核查');
    plan.push({chapter,key,prior,entry,itemId,remote});
  }
  const results = [];
  for (const p of plan) {
    const {chapter,key,prior,entry,itemId,remote} = p;
    if (dryRun) { results.push({number:chapter.number,itemId,status:remote.volumeId === sourceVolumeId ? 'would-move' : 'already-moved'}); continue; }
    if (statusOnly && remote.volumeId === sourceVolumeId) {
      journal[key] = {...entry,status:'not-applied',checkedAt:new Date().toISOString()};
      await persistJournal(journal); state[key] = {...prior,status:'verified'}; await persistState(state);
      results.push({number:chapter.number,itemId,status:'not-applied'});continue;
    }
    if (!statusOnly && remote.volumeId === sourceVolumeId) {
      journal[key] = {itemId,hash:chapter.hash,sourceVolumeId,targetVolumeId:binding.volumeId,previous:{content:remote.content,title:remote.title,volumeId:remote.volumeId},status:'pending',startedAt:new Date().toISOString(),...(entry?{previousAttempt:entry}:{})};
      await persistJournal(journal); state[key] = {...prior,status:'pending-move'}; await persistState(state);
      await adapter.moveDraft(book,binding,chapter,{itemId,sourceVolumeId});
    }
    const editorUrl = await adapter.openDraft(book,binding,chapter);
    const verifiedAt = new Date().toISOString();
    state[key] = {...prior,status:'verified',editorUrl,verifiedAt,actualVolumeId:binding.volumeId};
    await persistState(state);
    journal[key] = {...journal[key],status:'verified',verifiedAt}; await persistJournal(journal);
    results.push({number:chapter.number,itemId,status:'draft-moved-verified',volumeId:binding.volumeId,hash:chapter.hash,verifiedAt});
  }
  return results;
}

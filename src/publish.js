import { API } from './api.js';
import { stateKey } from './core.js';

const STAGES = new Map([[1, 'published'], [4, 'reviewing'], [7, 'rejected'], [10, 'scheduled']]);
export function publicationStage(row, article) {
  if (row.kind === 'drafts' && article.publish_status === 0 && Number(article.timer_status) === 0) return 'draft';
  if (row.kind !== 'published' || article.publish_status !== 1) return 'unknown';
  const stage = STAGES.get(row.displayStatus);
  // 只有章节管理列表与正文接口状态一致，才能确认公开状态。
  if (stage && article.display_status === row.displayStatus) return stage;
  return 'unknown';
}

async function observe(adapter, book, binding, chapter, inventory, volume, wait) {
  // 发布后作品信息审核可短暂锁住编辑回读；仅重读GET，绝不重发POST。
  for (let attempt=0; attempt<12; attempt++) {
    try {
      const result = await observeOnce(adapter,book,binding,chapter,inventory,volume);
      if (result.stage==='unknown' && result.row.kind==='published' && STAGES.has(result.row.displayStatus) && result.article.publish_status===1 && STAGES.has(result.article.display_status) && result.row.displayStatus!==result.article.display_status) {
        throw Object.assign(new Error('列表与正文审核状态暂未同步，需只读核对'),{retryReadback:true});
      }
      return result;
    }
    catch (error) {
      if (!(error.retryReadback || (error.api===API.article && error.businessCode===-2014)) || attempt===11) throw error;
      await wait(2000);
      inventory=await adapter.inventory(book,binding);
    }
  }
}
async function observeOnce(adapter, book, binding, chapter, inventory, volume) {
  const found = inventory.filter(row => row.number === chapter.number);
  if (found.length !== 1) throw new Error(`第 ${chapter.number} 章无法唯一定位；publish 只提交已有草稿，不自动上传`);
  const row = found[0];
  if (row.volumeId !== volume.volume_id) throw new Error(`第 ${chapter.number} 章所在分卷不一致`);
  const article = await adapter.article(book, row.itemId);
  adapter.verifyContent(article, volume, chapter);
  const stage = publicationStage(row, article);
  return { row, stage, article };
}

export async function publishChapters({ adapter, book, chapters, journal, persist, useAi, dryRun = false, statusOnly = false, wait = ms => new Promise(resolve=>setTimeout(resolve,ms)) }) {
  if (!chapters.length || chapters.some(c => c.volume !== chapters[0].volume)) throw new Error('发布每次需要明确选择一个卷的章节');
  if (!dryRun && !statusOnly && !['yes', 'no'].includes(useAi)) throw new Error('请明确 --use-ai yes 或 no，按实际创作情况填写');
  const binding = book.volumes[chapters[0].volume];
  if (!binding) throw new Error('发布分卷尚未绑定');
  const inventory = await adapter.inventory(book, binding);
  const volume = await adapter.resolveVolume(book, binding);
  const plan = [];
  // 整批核对正文与平台状态，发现后章不一致时不先提交前章。
  for (const chapter of chapters) {
    const observed = await observe(adapter, book, binding, chapter, inventory, volume, wait);
    const previous = journal[stateKey(book, chapter)];
    if (previous && (previous.itemId !== observed.row.itemId || previous.hash !== chapter.hash || previous.volumeId !== volume.volume_id)) throw new Error(`第 ${chapter.number} 章与发布记录不一致，停止以免重复提交`);
    if (!statusOnly && !dryRun && observed.stage === 'unknown') throw new Error(`第 ${chapter.number} 章平台状态未知，请先 publish-status`);
    if (!statusOnly && !dryRun && previous && observed.stage === 'draft') throw new Error(`第 ${chapter.number} 章已有发布尝试记录但仍显示草稿，请先 publish-status 核对，不自动重发`);
    if (!statusOnly && !dryRun && observed.stage === 'draft' && (observed.article.author_speak || Number(observed.article.column_data?.need_pay ?? 0) !== 0)) throw new Error('作者有话说或收费章节暂不支持 CLI 发布，请使用后台');
    plan.push({ chapter, ...observed, previous });
  }
  if (dryRun) return plan.map(({chapter,row,stage,previous}) => ({ number: chapter.number, title: chapter.title, itemId: row.itemId, stage, action: stage === 'draft' ? (previous ? 'needs-status-check' : 'submit-review') : 'observe-only', useAi: useAi ?? 'unspecified', dryRun: true }));
  const results = [];
  for (const item of plan) {
    const { chapter, row, previous } = item, key = stateKey(book, chapter);
    let stage = item.stage;
    const base = { ...(previous ?? {}), book: book.title, number: chapter.number, title: chapter.title, hash: chapter.hash, volume: chapter.volume, volumeId: volume.volume_id, itemId: row.itemId };
    if (!statusOnly && stage === 'draft') {
      journal[key] = { ...base, status: 'pending', useAi, startedAt: new Date().toISOString() };
      await persist(journal);
      await adapter.submitExistingDraft(book, binding, chapter, row.itemId, useAi);
      const fresh = await observe(adapter, book, binding, chapter, await adapter.inventory(book, binding), volume, wait);
      if (fresh.row.itemId !== row.itemId) throw new Error('提交后章节 ID 变化，保留 pending 记录');
      stage = fresh.stage;
      // POST 成功不等于进入审核；仍在草稿或未知时不能登记为已提交。
      if (['draft','unknown'].includes(stage)) throw new Error(`第 ${chapter.number} 章提交结果未核实，请用 publish-status 回读；不会自动重发`);
    }
    if (statusOnly && !previous) {
      results.push({ number: chapter.number, title: chapter.title, itemId: row.itemId, stage, status: 'observed', contentVerified: true });
      continue;
    }
    const status = ['draft', 'unknown'].includes(stage) ? 'pending' : 'verified';
    journal[key] = { ...base, ...(journal[key] ?? {}), stage, status, checkedAt: new Date().toISOString(), contentVerified: true };
    await persist(journal);
    results.push({ number: chapter.number, title: chapter.title, itemId: row.itemId, stage, status, contentVerified: true });
  }
  return results;
}

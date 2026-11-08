import { stateKey } from './core.js';
import { API } from './api.js';

// 仅作者明确要求修改已发布原章时使用；不改变普通草稿/发布命令的边界。
export async function revisePublishedChapters({adapter,book,chapters,baselines,state,journal,publication,persist,persistPublication,useAi,dryRun=false,statusOnly=false,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  if (!chapters.length || chapters.some(c=>c.volume!==chapters[0].volume)) throw new Error('修订须明确同卷章节');
  if (!dryRun && !statusOnly && !['yes','no'].includes(useAi)) throw new Error('请提供 --use-ai yes/no');
  const binding=book.volumes[chapters[0].volume];
  if (!binding) throw new Error('分卷未绑定');
  const plan=[];
  // 整批预检，任一旧摘要或ID冲突，都不先修改前章。
  for (const chapter of chapters) {
    const key=stateKey(book,chapter),original=state[key],published=publication[key],entry=journal[key];
    const url=original?.editorUrl && new URL(original.editorUrl);
    const ids=url?.pathname.match(/^\/main\/writer\/(\d+)\/publish\/(\d+)\/?$/);
    if (!original || url?.origin!=='https://fanqienovel.com' || !ids || ids[1]!==book.bookId || original.volume!==chapter.volume) throw new Error('缺少同卷原章ID核验记录');
    const itemId=ids[2];
    if (entry && (entry.itemId!==itemId || entry.hash!==chapter.hash)) throw new Error('存在另一修订版本记录，先核查原修订');
    if (statusOnly && !entry) throw new Error('没有当前版本修订记录');
    if (!dryRun && !statusOnly && entry?.status==='pending') throw new Error('结果不明，请先 revise-published-status；不重复提交');
    const remote=await adapter.publishedRevisionSnapshot(book,binding,chapter,itemId);
    const baseline=baselines?.find(c=>c.number===chapter.number && c.volume===chapter.volume);
    if (baselines && !baseline) throw new Error('原稿基线缺章或卷不符');
    const expectedHash=entry?.previous.hash ?? baseline?.hash ?? (published?.status==='verified' && published?.stage==='published' && published?.contentVerified && published?.itemId===itemId && published?.volumeId===remote.volumeId ? published.hash : original.hash);
    if (![expectedHash,chapter.hash].includes(remote.hash)) throw new Error(`第${chapter.number}章后台原稿摘要冲突，拒绝覆盖`);
    if (remote.hash!==chapter.hash && !statusOnly && remote.stage!=='published') throw new Error('原稿正在审核或未通过，不提交覆盖');
    if (entry && (entry.previous.volumeId!==remote.volumeId || entry.previous.realOrder!==remote.realOrder || entry.previous.position!==remote.position)) throw new Error('修订后卷或阅读位置变化，停止核查');
    plan.push({chapter,key,remote,itemId,expectedHash,entry});
  }
  if (dryRun) return plan.map(p=>({number:p.chapter.number,itemId:p.itemId,status:p.remote.hash===p.chapter.hash?'unchanged':'would-revise-published',stage:p.remote.stage,previousHash:p.remote.hash,hash:p.chapter.hash}));
  const results=[];
  for (const p of plan) {
    const {chapter,key,itemId,expectedHash}=p;
    let remote=p.remote;
    if (remote.hash!==chapter.hash && !statusOnly) {
      journal[key]={book:book.title,number:chapter.number,title:chapter.title,hash:chapter.hash,itemId,volume:chapter.volume,volumeId:remote.volumeId,status:'pending',previous:remote,useAi,startedAt:new Date().toISOString()};
      await persist(journal); // 旧HTML/原ID/摘要落盘后才允许POST。
      await adapter.submitPublishedRevision(book,binding,chapter,itemId,expectedHash,useAi);
    }
    for (let attempt=0;attempt<12;attempt++) {
      try {
        remote=await adapter.publishedRevisionSnapshot(book,binding,chapter,itemId);
        if (remote.hash===chapter.hash) break;
        if (remote.hash!==expectedHash) throw new Error('回读出现第三份正文，停止核查');
      } catch(error) {
        if (!(error.api===API.article && error.businessCode===-2014) && !/状态未同步/.test(error.message)) throw error;
        if (attempt===11) throw error;
      }
      if (attempt<11) await wait(2000);
    }
    if (remote.volumeId!==p.remote.volumeId || remote.realOrder!==p.remote.realOrder || remote.position!==p.remote.position) throw new Error('卷或原阅读位置变化，保留pending记录');
    if (remote.hash!==chapter.hash) {
      results.push({number:chapter.number,itemId,status:'pending',stage:remote.stage,contentVerified:false});
      continue;
    }
    const entry=journal[key]??{previous:p.remote};
    journal[key]={...entry,book:book.title,number:chapter.number,title:chapter.title,hash:chapter.hash,itemId,volume:chapter.volume,volumeId:remote.volumeId,status:remote.stage==='rejected'?'rejected':'verified',stage:remote.stage,contentVerified:true,checkedAt:new Date().toISOString()};
    await persist(journal);
    // 发布日志保留旧版证据；只有新版双状态一致且公开才更新当前发布摘要。
    if (remote.stage==='published') {
      journal[key].previousPublication??=publication[key]??null;
      await persist(journal);
      publication[key]={book:book.title,number:chapter.number,title:chapter.title,hash:chapter.hash,itemId,volume:chapter.volume,volumeId:remote.volumeId,status:'verified',stage:'published',contentVerified:true,checkedAt:journal[key].checkedAt,source:'revise-published-status'};
      await persistPublication(publication);
    }
    results.push({number:chapter.number,itemId,status:journal[key].status,stage:remote.stage,contentVerified:true});
  }
  return results;
}

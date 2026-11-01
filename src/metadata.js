import { API } from './api.js';
import { digest } from './core.js';
const protectedKeys = ['book_id','book_name','gender','category','thumb_uri','roles','activity_id','label_list','sign_pattern'];
const snapshot = data => Object.fromEntries(protectedKeys.map(k=>[k,data[k] ?? null]));
// 网页 modify_book 的空字符串表示保持其他字段；只更新简介，不改名称/分类/封面/模式。
export async function reviseAbstract({adapter,book,abstract,journal,persist,dryRun=false,statusOnly=false}) {
  if (typeof abstract !== 'string' || abstract !== abstract.trim() || !abstract || abstract.length>500 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(abstract)) throw new Error('简介须为1—500字符纯文字');
  await adapter.assertBook(book);
  const key=book.bookId,hash=digest(abstract),entry=journal[key];
  let data=await adapter.request('GET',API.book,{book_id:book.bookId});
  if (entry && entry.hash!==hash) throw new Error('已有其他版本简介操作，停止核查');
  if (statusOnly && !entry) throw new Error('无简介操作日志');
  if (!statusOnly && entry?.status==='pending') throw new Error('简介结果未知，先 book-abstract-status');
  if (entry && JSON.stringify(snapshot(data))!==JSON.stringify(entry.protected)) throw new Error('简介操作期间其他作品字段变化，停止核查');
  if (entry && ![entry.previous,abstract].includes(data.abstract)) throw new Error('平台简介被其他操作修改');
  if (dryRun) return {status:data.abstract===abstract?'unchanged':'would-revise',previousHash:digest(data.abstract),hash};
  if (statusOnly && data.abstract!==abstract) {
    journal[key]={...entry,status:'not-applied',checkedAt:new Date().toISOString()};await persist(journal);return {status:'not-applied'};
  }
  if (data.abstract!==abstract) {
    const op={hash,previous:data.abstract,protected:snapshot(data),status:'pending',startedAt:new Date().toISOString(),...(entry?{previousAttempt:entry}:{})};
    journal[key]=op;await persist(journal);
    const before=await adapter.request('GET',API.book,{book_id:book.bookId});
    if (before.abstract!==op.previous || JSON.stringify(snapshot(before))!==JSON.stringify(op.protected)) throw new Error('写前作品简介或其他字段变化');
    await adapter.request('POST',API.modifyBook,{book_id:book.bookId,book_name:'',category:'',gender:'',thumb_uri:'',abstract});
  }
  data=await adapter.request('GET',API.book,{book_id:book.bookId});
  if (data.abstract!==abstract || (journal[key] && JSON.stringify(snapshot(data))!==JSON.stringify(journal[key].protected))) throw new Error('简介回读或其他字段不一致，保留pending');
  journal[key]={previous:data.abstract,protected:snapshot(data),...journal[key],hash,status:'verified',verifiedAt:new Date().toISOString()};await persist(journal);
  return {status:'verified',hash,verifiedAt:journal[key].verifiedAt};
}

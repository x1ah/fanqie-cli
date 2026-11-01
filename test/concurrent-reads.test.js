import test from 'node:test';
import assert from 'node:assert/strict';
import {FanqieApi,API} from '../src/api.js';
const auth={cookie:'session=fake',csrfToken:'fake'};
const good=data=>Response.json({code:0,data});
const yieldRead=()=>new Promise(resolve=>setImmediate(resolve));

test('并发读取全部卷和多页草稿，保持完整次序且网络并发不超过配置',async()=>{
 const volumes=Array.from({length:6},(_,i)=>({book_id:'123',volume_id:String(100+i),volume_name:i===0?'第一卷：开篇':`第${i+1}卷：新卷`}));
 const drafts=Array.from({length:95},(_,i)=>({item_id:String(2000+i),volume_id:'100',title:`第${i+1}章 草稿${i+1}`}));
 let active=0,peak=0;const draftPages=[],methods=[];
 const api=await new FanqieApi({http:{readConcurrency:4}},{auth,fetchImpl:async(url,options)=>{
  active++;peak=Math.max(peak,active);methods.push(options.method);
  try{
   await yieldRead();let data;
   if(url.pathname===API.book)data={book_id:'123',book_name:'测试书'};
   else if(url.pathname===API.volumes)data={volume_list:volumes};
   else if(url.pathname===API.chapters){const i=Number(url.searchParams.get('volume_id'))-100;data={total_count:1,item_list:[{item_id:String(1000+i),volume_id:String(100+i),title:`第${101+i}章 已发${i}`,display_status:1}]};}
   else if(url.pathname===API.drafts){const page=Number(url.searchParams.get('page_index'));draftPages.push(page);data={total_count:95,draft_list:drafts.slice(page*30,page*30+30)};}
   else throw new Error('unexpected endpoint');
   return good(data);
  }finally{active--;}
 }}).start();
 const book={bookId:'123',title:'测试书'},binding={remoteName:'第一卷：开篇',volumeId:'100',manageUrl:'https://fanqienovel.com/main/writer/chapter-manage/123'};
 const inventory=await api.inventory(book,binding);
 assert.equal(inventory.length,101);assert.deepEqual(inventory.slice(0,6).map(r=>r.number),[101,102,103,104,105,106]);assert.deepEqual(inventory.slice(6).map(r=>r.number),Array.from({length:95},(_,i)=>i+1));
 assert.deepEqual(draftPages.sort((a,b)=>a-b),[0,1,2,3]);assert.equal(new Set(inventory.map(r=>r.itemId)).size,101);assert(peak>1);assert(peak<=4);assert(methods.every(m=>m==='GET'));
});

test('读取失败释放并发槽，全部排队读取结束且失败不自动重试',async()=>{
 let active=0,peak=0,calls=0;
 const api=await new FanqieApi({http:{readConcurrency:2}},{auth,fetchImpl:async url=>{
  active++;peak=Math.max(peak,active);calls++;
  try{await yieldRead();return url.searchParams.get('case')==='3'?new Response('',{status:429}):good({ok:true});}finally{active--;}
 }}).start();
 const results=await Promise.allSettled(Array.from({length:8},(_,i)=>api.request('GET',API.account,{case:i})));
 assert.equal(calls,8);assert.equal(peak,2);assert.equal(active,0);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.match(results[3].reason.message,/HTTP 429/);
});

test('较小实际分页和乱序完成仍保留总数变化及重复ID拦截',async()=>{
 for(const corruption of ['total','duplicate']){
  const api=await new FanqieApi({},{auth,fetchImpl:async url=>{
   const page=Number(url.searchParams.get('page_index'));await yieldRead();
   return good({total_count:corruption==='total'&&page===2?6:5,draft_list:Array.from({length:page===2?1:2},(_,i)=>({item_id:String(corruption==='duplicate'&&page===2?1:page*2+i+1)}))});
  }}).start();
  await assert.rejects(api.drafts({bookId:'123'}),corruption==='total'?/总数变化/:/重复章节/);
 }
 assert.throws(()=>new FanqieApi({http:{readConcurrency:0}},{auth}),/readConcurrency/);
});

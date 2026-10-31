import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FanqieApi, FanqiePublicationApi, textToHTML } from '../src/api.js';
import { publishChapters, publicationStage } from '../src/publish.js';
import { parseChapter, atomicJSON } from '../src/core.js';
import { main } from '../src/cli.js';

const auth={cookie:'session=fake',csrfToken:'csrf-fake'};
const book=()=>({bookId:'123',title:'测试书',source:'正文',volumes:{第一卷:{remoteName:'第一卷：开篇',volumeId:'100',manageUrl:'https://fanqienovel.com/main/writer/chapter-manage/123'}}});
const chapter=n=>({...parseChapter(`# 第${n}章 新篇${n}\n\n梨熟了。\n\n甲 & 乙。`,`/tmp/第${n}章_新篇${n}.md`),volume:'第一卷'});
const draft=n=>({item_id:String(90071992547409930n+BigInt(n)),title:`第${n}章 新篇${n}`,content:textToHTML(chapter(n).body),volume_id:'100',publish_status:0,timer_status:0,display_status:0,column_data:{book_id:'123',need_pay:0}});
async function backend(run){
  const db={rows:[draft(1),draft(2)],calls:[],posts:0,failAfter:false,failBefore:false,postStage:4,corruptAfter:false};
  const server=createServer(async(req,res)=>{
    const u=new URL(req.url,'http://localhost');let body='';for await(const part of req)body+=part;
    const fields=Object.fromEntries(new URLSearchParams(req.method==='GET'?u.search:body));
    db.calls.push({path:u.pathname,method:req.method,fields});
    assert.equal(req.headers.cookie,auth.cookie);
    let data;
    // 独立固定接口契约，不从实现导入发布/草稿地址常量。
    switch(u.pathname){
      case '/api/author/book/book_detail/v0/':data={book_id:'123',book_name:'测试书'};break;
      case '/api/author/volume/volume_list/v1':data={volume_list:[{book_id:'123',volume_id:'100',volume_name:'第一卷：开篇',index:1}]};break;
      case '/api/author/chapter/draft_list/v1':{const rows=db.rows.filter(r=>r.publish_status===0);data={total_count:rows.length,draft_list:rows};break;}
      case '/api/author/chapter/chapter_list/v1':{const rows=db.rows.filter(r=>r.publish_status===1);data={total_count:rows.length,item_list:rows};break;}
      case '/api/author/edit_article/v0/':data=db.rows.find(r=>r.item_id===fields.item_id);break;
      case '/api/author/publish_article/v0/':{
        db.posts++;assert.equal(fields.publish_status,'1');assert.equal(fields.timer_status,'0');assert.equal(fields.timer_time,'');assert.ok(['1','2'].includes(fields.use_ai));
        assert.equal(req.headers['x-secsdk-csrf-token'],auth.csrfToken);
        assert.equal(fields.book_id,'123');assert.equal(fields.volume_id,'100');
        const row=db.rows.find(r=>r.item_id===fields.item_id);
        assert.equal(fields.content,row.content);assert.equal(fields.title,row.title);
        if(!db.failBefore){row.publish_status=1;row.display_status=db.postStage;if(db.corruptAfter)row.content='<p>服务器文字变化</p>';}
        if(db.failAfter||db.failBefore){res.writeHead(500);res.end('failed');return;}
        data=null;break;
      }
      default:res.writeHead(404);res.end();return;
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:0,data}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const native=globalThis.fetch;
  const fetchImpl=(url,options)=>{assert.equal(url.origin,'https://fanqienovel.com');return native(new URL(`http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`),options);};
  const api=await new FanqiePublicationApi({},{auth,fetchImpl}).start();
  try{await run(api,db,fetchImpl);}finally{await new Promise(resolve=>server.close(resolve));}
}
const args=api=>({adapter:api,book:book(),chapters:[chapter(1)],journal:{},persist:async()=>{},useAi:'yes'});

test('发布只提交已有草稿，原文不变，审核中与已发布分别记录；重跑零重复提交',()=>backend(async(api,db)=>{
  const opts=args(api),events=[];opts.persist=async j=>events.push(structuredClone(j));
  const result=await publishChapters(opts);
  assert.equal(result[0].stage,'reviewing');assert.equal(opts.journal['123/1'].stage,'reviewing');
  assert.equal(events[0]['123/1'].status,'pending');assert.equal(db.posts,1);
  assert.equal(db.calls.some(c=>/cover_article|new_article/.test(c.path)),false);
  await publishChapters(opts);assert.equal(db.posts,1);
  db.rows[0].display_status=1;
  const checked=await publishChapters({...opts,statusOnly:true});assert.equal(checked[0].stage,'published');assert.equal(db.posts,1);
}));

test('发布预览与状态查询不提交请求、不改原草稿上传状态或发布日志',()=>backend(async(api,db,fetchImpl)=>{
  const readonly=await new FanqieApi({},{auth,fetchImpl}).start();let writes=0;
  const opts={...args(readonly),persist:async()=>writes++};
  const result=await publishChapters({...opts,dryRun:true});assert.equal(result[0].action,'submit-review');
  await publishChapters({...opts,statusOnly:true});assert.equal(writes,0);assert.deepEqual(opts.journal,{});assert.equal(db.posts,0);
  await assert.rejects(readonly.request('POST','/api/author/publish_article/v0/',{publish_status:1}),/非授权/);
}));

test('整批后章正文、卷、重复 ID 或发布记录冲突时，前章也不提交',()=>backend(async(api,db)=>{
  const opts={...args(api),chapters:[chapter(1),chapter(2)]};
  db.rows[1].content='<p>其他文字</p>';await assert.rejects(publishChapters(opts),/回读不一致/);assert.equal(db.posts,0);
  db.rows[1]=draft(2);db.rows[1].volume_id='200';await assert.rejects(publishChapters(opts),/分卷不一致/);assert.equal(db.posts,0);
  db.rows[1]=draft(2);db.rows.push({...draft(2),item_id:'99999'});await assert.rejects(publishChapters(opts),/唯一定位/);assert.equal(db.posts,0);
  db.rows=[draft(1),draft(2)];opts.journal['123/1']={itemId:'wrong',hash:chapter(1).hash,volumeId:'100'};await assert.rejects(publishChapters(opts),/发布记录不一致/);
}));

test('提交响应丢失：pending 保留，先回读审核状态，不重复 POST',()=>backend(async(api,db)=>{
  const opts=args(api);db.failAfter=true;
  await assert.rejects(publishChapters(opts),/HTTP 500/);assert.equal(opts.journal['123/1'].status,'pending');
  db.failAfter=false;await publishChapters({...opts,statusOnly:true});assert.equal(opts.journal['123/1'].stage,'reviewing');
  await publishChapters(opts);assert.equal(db.posts,1);
}));

test('提交失败仍是草稿：保留 pending，重复发布拒绝；状态查询不会重新提交',()=>backend(async(api,db)=>{
  const opts=args(api);db.failBefore=true;
  await assert.rejects(publishChapters(opts),/HTTP 500/);
  await assert.rejects(publishChapters(opts),/不自动重发/);
  const status=await publishChapters({...opts,statusOnly:true});assert.equal(status[0].stage,'draft');assert.equal(status[0].status,'pending');assert.equal(db.posts,1);
}));

test('业务响应成功但状态未知或正文改变，不登记为已发布',()=>backend(async(api,db)=>{
  const opts=args(api);db.postStage=99;
  await assert.rejects(publishChapters(opts),/未核实/);assert.equal(opts.journal['123/1'].status,'pending');
  const status=await publishChapters({...opts,statusOnly:true});assert.equal(status[0].stage,'unknown');assert.equal(status[0].status,'pending');
}));

test('发布后正文不一致，保留 pending 且不会再次提交',()=>backend(async(api,db)=>{
  const opts=args(api);db.corruptAfter=true;
  await assert.rejects(publishChapters(opts),/回读不一致/);assert.equal(opts.journal['123/1'].status,'pending');assert.equal(db.posts,1);
}));

test('已发布/审核中/审核不通过/定时待发均只核对，不重新发布',()=>backend(async(api,db)=>{
  for(const [code,stage]of[[1,'published'],[4,'reviewing'],[7,'rejected'],[10,'scheduled']]){
    db.rows[0]={...draft(1),publish_status:1,display_status:code};
    const result=await publishChapters(args(api));assert.equal(result[0].stage,stage);
  }
  assert.equal(db.posts,0);
}));

test('发布前必须声明 AI；收费和作者有话说限制在整批预检中执行',()=>backend(async(api,db)=>{
  await assert.rejects(publishChapters({...args(api),useAi:undefined}),/use-ai/);
  db.rows[1].author_speak={content:'不能悄悄丢掉'};
  await assert.rejects(publishChapters({...args(api),chapters:[chapter(1),chapter(2)]}),/作者有话说/);assert.equal(db.posts,0);
  await assert.rejects(api.request('POST','/api/author/publish_article/v0/',{publish_status:0,timer_status:0,use_ai:1}),/发布请求/);
}));

test('CLI 显式 publish 与 upload 隔离，dry-run 和 publish-status 零发布请求',()=>backend(async(api,db,fetchImpl)=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'fanqie-publish-cli-'));
  const originalFetch=globalThis.fetch,originalLog=console.log,outputs=[];
  try{
    await mkdir(path.join(dir,'正文','第一卷'),{recursive:true});await writeFile(path.join(dir,'正文','第一卷','第1章_新篇1.md'),'# 第1章 新篇1\n\n梨熟了。\n\n甲 & 乙。');
    await atomicJSON(path.join(dir,'.fanqie','config.json'),{version:1,books:{新书:book()}});
    await atomicJSON(path.join(dir,'.fanqie','http-auth.json'),auth);
    globalThis.fetch=fetchImpl;console.log=value=>outputs.push(JSON.parse(value));
    const run=(...flags)=>main([...flags,'-w',dir,'--json']);
    await assert.rejects(run('publish','新书','--volume','第一卷','--all','--use-ai','yes'),/明确/);
    await assert.rejects(run('publish','新书','--volume','第一卷','--chapters','1'),/use-ai/);
    await run('publish','新书','--volume','第一卷','--chapters','1','--dry-run');assert.equal(db.posts,0);
    await assert.rejects(stat(path.join(dir,'.fanqie','publication-state.json')),e=>e.code==='ENOENT');
    await run('publish','新书','--volume','第一卷','--chapters','1','--use-ai','no');assert.equal(db.posts,1);
    const post=db.calls.find(c=>c.method==='POST');assert.equal(post.fields.use_ai,'2');
    assert.equal(outputs.at(-1).results[0].stage,'reviewing');
    await run('publish-status','新书','--volume','第一卷','--chapters','1');assert.equal(db.posts,1);
    assert.equal(JSON.parse(await readFile(path.join(dir,'.fanqie','publication-state.json')))['123/1'].stage,'reviewing');
    await assert.rejects(stat(path.join(dir,'.fanqie','state.json')),e=>e.code==='ENOENT');
    await assert.rejects(stat(path.join(dir,'.fanqie','run.lock')),e=>e.code==='ENOENT');
  }finally{globalThis.fetch=originalFetch;console.log=originalLog;await rm(dir,{recursive:true,force:true});}
}));


test('列表和正文接口的公开状态不一致时不报告已发布',()=>{
  assert.equal(publicationStage({kind:'published',displayStatus:1},{publish_status:1,display_status:4}),'unknown');
  assert.equal(publicationStage({kind:'drafts',displayStatus:1},{publish_status:1,display_status:1}),'unknown');
});

test('预检后草稿被修改，提交前再次核对阻止发布',()=>backend(async(api,db)=>{
  const submit=api.submitExistingDraft.bind(api);
  api.submitExistingDraft=async(...params)=>{db.rows[0].content='<p>提交前发生修改</p>';return submit(...params);};
  const opts=args(api);
  await assert.rejects(publishChapters(opts),/回读不一致/);assert.equal(db.posts,0);assert.equal(opts.journal['123/1'].status,'pending');
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChapter} from '../src/core.js';
import {FanqieApi,FanqiePublicationApi,textToHTML} from '../src/api.js';
import {revisePublishedChapters} from '../src/revise-published.js';
const book={bookId:'123',title:'测试书',volumes:{第一卷:{volumeId:'100',remoteName:'第一卷'}}};
const ch=n=>({...parseChapter(`# 第${n}章 新标题${n}\n\n新版故事。`,`/tmp/第${n}章_新标题${n}.md`),volume:'第一卷'});
function fixture(){
 const chapters=[ch(1),ch(2)],journal={},publication={},state={};
 const rows=new Map(chapters.map(c=>{state[`123/${c.number}`]={volume:'第一卷',hash:`old${c.number}`,editorUrl:`https://fanqienovel.com/main/writer/123/publish/${900+c.number}/`};return [String(900+c.number),{hash:`old${c.number}`,stage:'published',itemId:String(900+c.number),volumeId:'100',title:'旧标题',content:'<p>原文</p>',realOrder:c.number,latestVersion:0}]}));
 let posts=0,throwPost=false;
 const adapter={publishedRevisionSnapshot:async(b,v,c,id)=>structuredClone(rows.get(id)),submitPublishedRevision:async(b,v,c,id,expected,ai)=>{
  assert.equal(rows.get(id).hash,expected);assert.equal(ai,'yes');posts++;
  Object.assign(rows.get(id),{hash:c.hash,title:c.title,content:textToHTML(c.body),stage:'reviewing'});
  if(throwPost)throw Error('响应丢失');
 }};
 const args={adapter,book,chapters,state,journal,publication,persist:async()=>{},persistPublication:async()=>{},useAi:'yes',wait:async()=>{}};
 return {args,rows,posts:()=>posts,fail:()=>{throwPost=true;}};
}
test('已发布修订预览零写；原ID提交审核不冒称公开，公开后登记新版；重跑不重复POST',async()=>{
 const f=fixture();const r=await revisePublishedChapters({...f.args,dryRun:true});assert.equal(r[0].status,'would-revise-published');assert.equal(f.posts(),0);
 const a=await revisePublishedChapters(f.args);assert.equal(a[0].stage,'reviewing');assert.equal(f.posts(),2);assert.deepEqual(f.args.publication,{});assert.equal(f.args.journal['123/1'].previous.content,'<p>原文</p>');
 for(const v of f.rows.values())v.stage='published';
 await revisePublishedChapters({...f.args,statusOnly:true});assert.equal(f.args.publication['123/1'].hash,ch(1).hash);assert.equal(f.posts(),2);
 await revisePublishedChapters(f.args);assert.equal(f.posts(),2);
});
test('后章原稿冲突、同卷原ID错误或未知结果时，拒绝先修改前章',async()=>{
 const f=fixture();f.rows.get('902').hash='another';await assert.rejects(revisePublishedChapters(f.args),/摘要冲突/);assert.equal(f.posts(),0);
 f.rows.get('902').hash='old2';f.args.state['123/2'].editorUrl='https://other.example/main/writer/123/publish/902/';await assert.rejects(revisePublishedChapters(f.args),/原章ID/);assert.equal(f.posts(),0);
});
test('POST响应丢失可只读恢复；日志落盘失败零POST',async()=>{
 const f=fixture();f.args.chapters=[ch(1)];f.fail();await assert.rejects(revisePublishedChapters(f.args),/响应丢失/);assert.equal(f.posts(),1);
 await assert.rejects(revisePublishedChapters(f.args),/结果不明/);await revisePublishedChapters({...f.args,statusOnly:true});assert.equal(f.posts(),1);assert.equal(f.args.journal['123/1'].stage,'reviewing');
 const g=fixture();await assert.rejects(revisePublishedChapters({...g.args,persist:async()=>{throw Error('磁盘错误');}}),/磁盘错误/);assert.equal(g.posts(),0);
});
test('位置改变及第三份正文停止，原发布摘要不变',async()=>{
 const f=fixture();f.args.chapters=[ch(1)];await revisePublishedChapters(f.args);
 f.rows.get('901').realOrder=4;await assert.rejects(revisePublishedChapters({...f.args,statusOnly:true}),/阅读位置/);
 f.rows.get('901').realOrder=1;f.rows.get('901').hash='third';await assert.rejects(revisePublishedChapters({...f.args,statusOnly:true}),/摘要冲突/);assert.deepEqual(f.args.publication,{});
});
test('正式修订请求符合官方编辑器契约，普通草稿客户端仍禁止发布接口',async()=>{
 const api=new FanqiePublicationApi({},{auth:{cookie:'test'}}),fields=[];
 api.publishedRevisionSnapshot=async()=>({hash:'old',stage:'published',volumeId:'100',volumeName:'第一卷'});
 api.request=async(method,url,p)=>fields.push({method,url,p});
 await api.submitPublishedRevision(book,{},ch(1),'901','old','yes');
 assert.equal(fields.length,1);assert.equal(fields[0].url,'/api/author/publish_article/v0/');assert.equal(fields[0].p.item_id,'901');assert.equal(fields[0].p.volume_id,'100');assert.equal(fields[0].p.use_ai,1);assert.equal(fields[0].p.publish_status,1);assert.equal(fields[0].p.content,textToHTML(ch(1).body));
 await assert.rejects(new FanqieApi({},{auth:{cookie:'test'}}).request('POST','/api/author/publish_article/v0/',{}),/非授权/);
 api.publishedRevisionSnapshot=async()=>({hash:'changed',stage:'published'});await assert.rejects(api.submitPublishedRevision(book,{},ch(1),'901','old','yes'),/原稿或状态/);assert.equal(fields.length,1);
});
test('HTTP快照拒绝草稿、跨卷、重复章、非原ID、收费及列表正文状态分歧',async()=>{
 const api=new FanqieApi({},{auth:{cookie:'test'}}),c=ch(1);
 const row={number:1,itemId:'901',volumeId:'100',kind:'published',displayStatus:1};
 const article={title:'第1章 旧标题',content:'<p>原文</p>',publish_status:1,timer_status:0,volume_id:'100',display_status:1,latest_publish_item_info:{item_id:'901'},column_data:{need_pay:0},real_order:1};
 api.resolveVolume=async()=>({volume_id:'100',volume_name:'第一卷'});api.inventory=async()=>[row];api.article=async()=>article;
 const good=await api.publishedRevisionSnapshot(book,{},c,'901');assert.equal(good.stage,'published');assert.equal(good.content,'<p>原文</p>');
 for(const [object,key,value,pattern] of [[row,'kind','drafts',/原ID/],[row,'volumeId','200',/跨卷/],[article,'display_status',4,/未同步/],[article,'timer_status',1,/非定时/],[article.column_data,'need_pay',1,/收费/]]){
  const old=object[key];object[key]=value;await assert.rejects(api.publishedRevisionSnapshot(book,{},c,'901'),pattern);object[key]=old;
 }
 api.inventory=async()=>[row,row];await assert.rejects(api.publishedRevisionSnapshot(book,{},c,'901'),/原ID/);
});

test('显式原稿基线可处理早期草稿摘要滞后，但基线不匹配或缺章仍零写入',async()=>{
 const f=fixture();f.args.state['123/1'].hash='historical';f.args.baselines=[{...ch(1),hash:'old1'},{...ch(2),hash:'old2'}];
 assert.equal((await revisePublishedChapters({...f.args,dryRun:true}))[0].status,'would-revise-published');
 f.args.baselines[1].hash='not-current';await assert.rejects(revisePublishedChapters(f.args),/摘要冲突/);assert.equal(f.posts(),0);
 f.args.baselines=[f.args.baselines[0]];await assert.rejects(revisePublishedChapters(f.args),/基线缺章/);assert.equal(f.posts(),0);
});

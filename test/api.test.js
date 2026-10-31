import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { API, FanqieApi, textToHTML, htmlToText, id } from '../src/api.js';
import { uploadChapters } from '../src/upload.js';
import { atomicJSON, parseChapter } from '../src/core.js';
import { changeVolume } from '../src/volumes.js';
const auth = { cookie: 'session=fake', csrfToken: 'fake-csrf', userAgent: 'test-agent' };
const binding = { remoteName: '第一卷：开篇', manageUrl: 'https://fanqienovel.com/main/writer/chapter-manage/123' };
const makeBook = () => ({ bookId: '123', title: '测试书', volumes: { 第一卷: { ...binding } } });
const chapter = number => ({ ...parseChapter(`# 第${number}章 新篇${number}\n\n甲 & 乙 < 5。\n\n梨落地了。`, `/tmp/第${number}章_新篇${number}.md`), volume: '第一卷' });
const good = data => Response.json({ code: 0, message: 'success', data });

async function backend(run) {
  const db = { volumes: [{ book_id: '123', volume_id: '100', volume_name: binding.remoteName, index: 0 }], drafts: [], published: [], saves: 0, allocates: 0, volumeWrites: 0, calls: [], failSave: false, failAfterSave: false, corrupt: false, foreign: false };
  const server = createServer(async (req,res) => {
    const url = new URL(req.url, 'http://localhost');
    let raw=''; for await (const part of req) raw += part;
    const fields = Object.fromEntries(new URLSearchParams(req.method === 'GET' ? url.search : raw));
    db.calls.push({ path: url.pathname, method: req.method, fields, headers: req.headers });
    assert.equal(req.headers.cookie, auth.cookie);
    if (req.method === 'POST') assert.equal(req.headers['x-secsdk-csrf-token'], auth.csrfToken);
    let data;
    const page = rows => { const start = Number(fields.page_index)*2; return rows.slice(start,start+2); };
    const api=url.pathname;
    if (api===API.book) data={book_id:'123',book_name:'测试书'};
    else if (api===API.volumes) data={volume_list:db.volumes};
    else if (api===API.drafts) data={total_count:db.drafts.length,draft_list:page(db.drafts)};
    else if (api===API.chapters) {const rows=db.published.filter(r=>r.volume_id===fields.volume_id);data={total_count:rows.length,item_list:page(rows)};}
    else if (api===API.article) {const row=db.drafts.find(r=>r.item_id===fields.item_id);data={...row,content:db.corrupt?'后台文字改变':row.content,column_data:{book_id:db.foreign?'999':'123'}};}
    else if (api===API.allocate) {db.allocates++;const item_id=String(90071992547409930n+BigInt(db.allocates));db.drafts.push({item_id,title:'',content:'<p><br></p>',volume_id:'100',publish_status:0,timer_status:0});data={item_id};}
    // 路径固定为网页「存草稿」真实请求契约，不能跟随实现常量一起误改成发布接口。
    else if (api==='/api/author/article/cover_article/v0/') {
      db.saves++;assert.equal('publish_status' in fields,false);assert.equal('OperateType' in fields,false);
      assert.equal(fields.volume_id,'100');
      if(!db.failSave)Object.assign(db.drafts.find(r=>r.item_id===fields.item_id),fields,{publish_status:0,timer_status:0});
      if(db.failSave||db.failAfterSave){res.writeHead(500);res.end('not logged');return;}
      data=null;
    } else if(api===API.addVolume){db.volumeWrites++;db.volumes.push({book_id:'123',volume_id:'200',volume_name:fields.volume_name,index:1});data=null;}
    else if(api===API.modifyVolumes){db.volumeWrites++;const changed=JSON.parse(fields.volume_data);db.volumes=changed.map((v,index)=>({...v,book_id:'123',index}));data=null;}
    else {res.writeHead(404);res.end();return;}
    res.setHeader('content-type','application/json');res.end(JSON.stringify({code:0,message:'success',data}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const api = await new FanqieApi({},{auth, fetchImpl:(url,options)=>{
    assert.equal(url.origin,'https://fanqienovel.com');
    const local=new URL(`http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`);
    return fetch(local,options);
  }}).start();
  try{await run(api,db);}finally{await new Promise(resolve=>server.close(resolve));}
}

test('HTML 段落、转义、数值实体与长 ID 安全往返',()=>{
  const body='甲 & 乙 < 5。\n梨落地了。';
  assert.equal(htmlToText(textToHTML(body)),body);
  assert.equal(htmlToText('<p><span>甲&#38;乙</span></p><p><br></p><p>&quot;梨&quot;&nbsp;熟了。</p>'),'甲&乙\n"梨" 熟了。');
  assert.throws(()=>htmlToText('<p>文字<img src="x"></p>'),/非纯文字/);
  assert.equal(id('90071992547409931'),'90071992547409931');
  assert.throws(()=>id(90071992547409931),/不精确/);
});

test('HTTP 真正经过本地服务器：上传仅存草稿，回读与重跑不重复创建',()=>backend(async(api,db)=>{
  const book=makeBook(), state={}, events=[];
  const args={adapter:api,book,chapters:[chapter(1)],state,persist:async s=>events.push(structuredClone(s)),log:()=>{}};
  await uploadChapters(args);await uploadChapters(args);
  assert.equal(db.saves,1);assert.equal(db.allocates,1);
  assert.equal(state['123/1'].status,'verified');
  assert.ok(events.some(s=>s['123/1'].status==='pending'&&s['123/1'].itemId));
  assert.equal(db.calls.some(c=>c.path==='/api/author/publish_article/v0/'),false);
  assert.equal(db.calls.filter(c=>c.path==='/api/author/article/cover_article/v0/').length,1);
  db.corrupt=true;await assert.rejects(uploadChapters(args),/回读不一致/);
  assert.equal(db.saves,1);
}));

test('多页草稿、跨卷发布冲突先检查整批，零写入',()=>backend(async(api,db)=>{
  db.volumes.push({book_id:'123',volume_id:'200',volume_name:'第二卷：远行',index:1});
  db.published.push({item_id:'88',title:'第2章 新篇2',volume_id:'200'});
  for(let n=10;n<15;n++)db.drafts.push({item_id:String(n),title:`第${n}章 其他${n}`,volume_id:'100'});
  const inventory=await api.inventory(makeBook(),binding);
  assert.equal(inventory.length,6);
  assert.ok(db.calls.some(c=>c.path===API.drafts&&c.fields.page_index==='2'));
  await assert.rejects(uploadChapters({adapter:api,book:makeBook(),chapters:[chapter(1),chapter(2)],state:{},persist:async()=>{},log:()=>{}}),/已在发布列表/);
  assert.equal(db.allocates,0);
}));

test('草稿适配器即使传publish_status=0也绝不允许调用正式发布接口',()=>backend(async(api,db)=>{
  await assert.rejects(api.request('POST','/api/author/publish_article/v0/',{publish_status:0}),/非授权/);
  assert.equal(db.calls.length,0);
  assert.equal(db.allocates,0);
  assert.equal(db.saves,0);
}));

test('保存已到达服务器但响应失败：pending 保留分配 ID，reconcile 恢复且不重写',()=>backend(async(api,db)=>{
  db.failAfterSave=true;const state={};const args={adapter:api,book:makeBook(),chapters:[chapter(1)],state,persist:async()=>{},log:()=>{}};
  await assert.rejects(uploadChapters(args),/HTTP 500/);
  assert.equal(state['123/1'].status,'pending');assert.ok(state['123/1'].itemId);
  await assert.rejects(uploadChapters(args),/reconcile/);
  db.failAfterSave=false;await uploadChapters({...args,reconcile:true});
  assert.equal(state['123/1'].status,'verified');assert.equal(db.saves,1);assert.equal(db.allocates,1);
}));

test('分配成功但保存失败，空稿不被自动重建或覆盖',()=>backend(async(api,db)=>{
  db.failSave=true;const state={};const args={adapter:api,book:makeBook(),chapters:[chapter(1)],state,persist:async()=>{},log:()=>{}};
  await assert.rejects(uploadChapters(args),/HTTP 500/);
  await assert.rejects(uploadChapters({...args,reconcile:true}),/无法解析/);
  assert.equal(db.allocates,1);assert.equal(db.saves,1);assert.ok(state['123/1'].itemId);
}));

test('作品、卷、章节状态、正文归属检查拒绝不安全操作',()=>backend(async(api,db)=>{
  await assert.rejects(api.assertBook({...makeBook(),title:'错误作品'}),/不匹配/);
  await assert.rejects(api.resolveVolume(makeBook(),{...binding,volumeId:'999'}),/无法唯一/);
  db.drafts.push({item_id:'1',title:'第1章 新篇1',content:textToHTML(chapter(1).body),volume_id:'100',publish_status:1,timer_status:0});
  await assert.rejects(api.openDraft(makeBook(),binding,chapter(1)),/已提交/);
  db.foreign=true;await assert.rejects(api.article(makeBook(),'1'),/作品不一致/);
}));

test('HTTP 错误、非 JSON、业务失败、超时均不重试或泄露凭据',async()=>{
  const cases=[()=>new Response('secret',{status:403}),()=>new Response('secret',{status:429}),()=>new Response('<html>secret</html>'),()=>Response.json({code:-100,message:'secret 登录失效'}),()=>Response.json({code:42,message:'secret'}),()=>{throw new Error(auth.cookie);}];
  for(const response of cases){let calls=0;const api=await new FanqieApi({},{auth,fetchImpl:async()=>{calls++;return response();}}).start();await assert.rejects(api.request('POST',API.save,{}),e=>!e.message.includes('secret')&&!e.message.includes(auth.cookie));assert.equal(calls,1);}
  const api=await new FanqieApi({},{auth,fetchImpl:async()=>{throw new Error('must not send');}}).start();
  await assert.rejects(api.request('GET','https://example.org'),/非授权/);
  const noCSRF=await new FanqieApi({},{auth:{cookie:'x=1'}}).start();await assert.rejects(noCSRF.request('POST',API.save),/CSRF/);
});

test('分页重复与总数变化均停止，避免漏检',async()=>{
  const row={item_id:'1',title:'第1章 一'};
  let count=0;const api=await new FanqieApi({},{auth,fetchImpl:async()=>good({total_count:count++?3:2,draft_list:[row]})}).start();
  await assert.rejects(api.drafts(makeBook()),/总数变化/);
  api.fetch=async()=>good({total_count:2,draft_list:[row]});await assert.rejects(api.drafts(makeBook()),/分页重复/);
});

test('会话只从指定工作区加载，文件权限 0600',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'fanqie-auth-'));
  try{await assert.rejects(new FanqieApi({},{dataDir:dir}).start(),/缺少 HTTP/);await atomicJSON(path.join(dir,'http-auth.json'),auth);const api=await new FanqieApi({},{dataDir:dir}).start();assert.equal(api.auth.cookie,auth.cookie);assert.equal((await stat(path.join(dir,'http-auth.json'))).mode&0o777,0o600);assert.equal(JSON.parse(await readFile(path.join(dir,'http-auth.json'))).csrfToken,auth.csrfToken);}finally{await rm(dir,{recursive:true,force:true});}
});

test('分卷新建、改名、预览、重复执行和绑定同步',()=>backend(async(api,db)=>{
  const book=makeBook(),journal={};let saved=0;
  const common={adapter:api,book,journal,persist:async()=>{},saveBook:async()=>saved++};
  const create={...common,volume:'第二卷',remoteName:'第二卷：远行',action:'create'};
  await changeVolume({...create,dryRun:true});assert.equal(db.volumeWrites,0);assert.equal(saved,0);
  await changeVolume(create);await changeVolume(create);assert.equal(db.volumeWrites,1);assert.equal(book.volumes.第二卷.volumeId,'200');
  await changeVolume({...common,volume:'第一卷',remoteName:'第一卷：新篇',action:'rename'});
  assert.equal(db.volumeWrites,2);assert.equal(book.volumes.第一卷.remoteName,'第一卷：新篇');assert.equal(db.volumes[1].volume_name,'第二卷：远行');
  await assert.rejects(changeVolume({...common,volume:'第一卷',remoteName:'第三卷：错误',action:'rename'}),/序号/);
}));

test('分卷写入后响应丢失，用相同命令回读恢复，不重复写入',()=>backend(async(api,db)=>{
  const book=makeBook(),journal={};const orig=api.request.bind(api);let fail=true;
  api.request=async(...args)=>{const result=await orig(...args);if(args[0]==='POST'&&fail){fail=false;throw new Error('断开');}return result;};
  const args={adapter:api,book,volume:'第二卷',remoteName:'第二卷：远行',action:'create',journal,persist:async()=>{},saveBook:async()=>{}};
  await assert.rejects(changeVolume(args),/断开/);assert.equal(journal['123/第二卷'].status,'pending');assert.equal(book.volumes.第二卷,undefined);
  await changeVolume(args);assert.equal(db.volumeWrites,1);assert.equal(journal['123/第二卷'].status,'verified');
  journal['123/第一卷']={status:'pending',action:'rename',remoteName:'第一卷：新篇',volumeId:'100',before:db.volumes.map(v=>({volume_id:v.volume_id,volume_name:v.volume_name}))};
  await assert.rejects(changeVolume({...args,volume:'第一卷',remoteName:'第一卷：新篇',action:'rename'}),/仍未核实/);assert.equal(db.volumeWrites,1);
}));

test('CLI 使用已有 HTTP 会话执行上传/核对/分卷命令，不创建浏览器资料且兼容旧配置',()=>backend(async(api,db)=>{
  const {main}=await import('../src/cli.js');
  const {mkdir,writeFile}=await import('node:fs/promises');
  const dir=await mkdtemp(path.join(os.tmpdir(),'fanqie-http-cli-'));
  const originalFetch=globalThis.fetch,originalLog=console.log,output=[];
  // fixture 的转发 fetch 自身使用原生 fetch，避免全局替换后递归。
  const calls=api.fetch;api.fetch=undefined;
  const proxy=(url,options)=>{globalThis.fetch=originalFetch;try{return calls(url,options);}finally{globalThis.fetch=proxy;}};
  try{
    await mkdir(path.join(dir,'正文','第一卷'),{recursive:true});
    await writeFile(path.join(dir,'正文','第一卷','第1章_新篇1.md'),'# 第1章 新篇1\n\n甲 & 乙 < 5。\n\n梨落地了。');
    const book={...makeBook(),source:'正文'};
    await atomicJSON(path.join(dir,'.fanqie','config.json'),{version:1,browser:{timeout:15000},selectors:{body:'旧选择器'},books:{新书:book}});
    await atomicJSON(path.join(dir,'.fanqie','http-auth.json'),auth);
    globalThis.fetch=proxy;console.log=value=>output.push(JSON.parse(value));
    const run=(...args)=>main([...args,'--workspace',dir,'--json']);
    await run('upload','新书','--volume','第一卷','--chapters','1');
    assert.equal(output.at(-1).transport,'http');assert.equal(db.allocates,1);
    await run('reconcile','新书','--volume','第一卷','--chapters','1');assert.equal(db.allocates,1);
    await run('volumes','新书');assert.equal(output.at(-1).volumes[0].volume_id,'100');
    await run('volume-create','新书','--volume','第二卷','--remote-volume','第二卷：远行','--dry-run');assert.equal(db.volumeWrites,0);
    await run('volume-create','新书','--volume','第二卷','--remote-volume','第二卷：远行');
    const config=JSON.parse(await readFile(path.join(dir,'.fanqie','config.json')));assert.equal(config.selectors.body,'旧选择器');assert.equal(config.books.新书.volumes.第二卷.volumeId,'200');
    await assert.rejects(stat(path.join(dir,'.fanqie','browser')),e=>e.code==='ENOENT');
    await assert.rejects(stat(path.join(dir,'.fanqie','run.lock')),e=>e.code==='ENOENT');
  }finally{globalThis.fetch=originalFetch;console.log=originalLog;await rm(dir,{recursive:true,force:true});}
}));


test('超过30条草稿以小分页完整回读，不将服务错误误判为掉登录',async()=>{
  const rows=Array.from({length:61},(_,i)=>({item_id:String(i+1),title:`第${i+1}章 正文`,volume_id:'100'}));
  const seen=[];
  const api=await new FanqieApi({},{auth,fetchImpl:async(url,options)=>{
    assert.equal(options.method,'GET');
    const page=Number(url.searchParams.get('page_index')), size=Number(url.searchParams.get('page_count'));
    seen.push(page);
    if(size>30)return Response.json({code:-100,message:'服务器开小差了，请稍后再试'});
    return good({total_count:rows.length,draft_list:rows.slice(page*size,(page+1)*size)});
  }}).start();
  assert.deepEqual(await api.drafts(makeBook()),rows);
  assert.deepEqual(seen,[0,1,2]);
  api.fetch=async()=>Response.json({code:-100,message:'服务器开小差了，请稍后再试'});
  await assert.rejects(api.drafts(makeBook()),e=>e.message.includes('code=-100')&&!e.message.includes('登录'));
});

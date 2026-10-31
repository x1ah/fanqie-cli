import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { exportHttpSession } from '../src/session.js';

test('临时 Chrome 会话：SDK 生成 CSRF 后探测请求在发送前中止，导出 HTTP 会话', async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'fanqie-export-'));
  const browser=await chromium.launch({channel:process.env.FANQIE_TEST_CHANNEL==='chromium'?undefined:(process.env.FANQIE_TEST_CHANNEL||'chrome'),headless:true});
  try{
    const context=await browser.newContext();const page=await context.newPage();let sentWrites=0,authChecks=0;
    await context.addCookies([{name:'session',value:'fake',domain:'fanqienovel.com',path:'/'}]);
    await context.route('**/*',async route=>{
      if(route.request().method()==='POST'){sentWrites++;await route.abort();return;}
      await route.fulfill({contentType:'text/html',body:`<html><body>模拟登录后台<script>
      const original=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(...args){original.apply(this,args);this.setRequestHeader('x-secsdk-csrf-token','fake-csrf');};
      </script></body></html>`});
    });
    await page.goto('https://fanqienovel.com/main/writer/book-manage');
    const fetchImpl=async(url,options)=>{authChecks++;assert.equal(new URL(url).pathname,'/api/author/account/info/v0/');assert.equal(options.headers.Cookie,'session=fake');assert.equal(options.headers['x-secsdk-csrf-token'],'fake-csrf');return Response.json({code:0,data:{author_name:'测试作者'}});};
    await exportHttpSession({context,page},dir,{fetchImpl});
    assert.equal(sentWrites,0);assert.equal(authChecks,1);
    const file=path.join(dir,'http-auth.json');const auth=JSON.parse(await readFile(file,'utf8'));
    assert.equal(auth.csrfToken,'fake-csrf');assert.equal((await stat(file)).mode&0o777,0o600);
    await context.close();
  }finally{await browser.close();await rm(dir,{recursive:true,force:true});}
});

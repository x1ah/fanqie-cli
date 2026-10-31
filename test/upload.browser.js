import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { FanqieBrowser } from '../src/browser.js';
import { parseChapter, stateKey } from '../src/core.js';
import { uploadChapters } from '../src/upload.js';

test('真实 Chrome 测试：跨页找草稿、新标签编辑器、保存并回读、重跑不重复创建', async () => {
  const drafts = [{ number: 99, title: '已有草稿', body: '原有文字' }];
  let saves = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/save') {
      let raw = ''; for await (const part of req) raw += part;
      drafts.push(JSON.parse(raw)); saves++;
      res.end('ok'); return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname.startsWith('/editor/')) {
      const item = drafts.find(d => String(d.number) === url.pathname.split('/').pop());
      res.end(`<!doctype html><span class="publish-header-volume-name">第一卷</span><input placeholder="章节号" id="n"><input placeholder="章节名称" id="t"><div class="tiptap" contenteditable="true"></div><button id="save">存为草稿</button><script>
      const item=${JSON.stringify(item ?? { number: 1, title: '', body: '' })};
      n.value=item.number;t.value=item.title;document.querySelector('.tiptap').innerText=item.body;
      save.onclick=async()=>{await fetch('/save',{method:'POST',body:JSON.stringify({number:Number(n.value),title:t.value,body:document.querySelector('.tiptap').innerText})});document.body.dataset.saved='yes';};
      </script>`);
    } else {
      res.end(`<!doctype html><h1>测试书</h1><span class="arco-select-view-value">第一卷</span>
      <button id="published">已发布</button><button id="drafts">草稿箱</button><button onclick="window.open('/editor/new')">新建章节</button>
      <table><tbody></tbody></table><button class="arco-pagination-item-next">下一页</button>
      <script>
      const items=${JSON.stringify(drafts)};let kind='published',index=0;
      function render(){document.querySelector('tbody').innerHTML=kind==='drafts'&&items[index] ? '<tr><td>第'+items[index].number+'章 '+items[index].title+'</td><td><button aria-label="编辑">编辑</button></td></tr>' : '<tr><td>暂无数据</td></tr>';const edit=document.querySelector('[aria-label="编辑"]');if(edit)edit.onclick=()=>window.open('/editor/'+items[index].number);document.querySelector('.arco-pagination-item-next').disabled=kind!=='drafts'||index>=items.length-1;}
      published.onclick=()=>{kind='published';index=0;render()};drafts.onclick=()=>{kind='drafts';index=0;render()};document.querySelector('.arco-pagination-item-next').onclick=()=>{index++;render()};render();
      </script>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: process.env.FANQIE_TEST_CHANNEL === 'chromium' ? undefined : (process.env.FANQIE_TEST_CHANNEL || 'chrome'), headless: true });
  try {
    const context = await browser.newContext();
    context.setDefaultTimeout(3000);
    context.on('page', page => page.on('pageerror', error => console.error('模拟页错误：', error.message)));
    const adapter = new FanqieBrowser({ browser: { timeout: 2500 }, selectors: {} });
    adapter.context = context;
    adapter.page = await context.newPage();
    const book = { title: '测试书', bookId: '123', volumes: { 第一卷: { manageUrl: `http://127.0.0.1:${server.address().port}/manager`, remoteName: '第一卷' } } };
    const chapter = { ...parseChapter('# 第001章 靠岸\n\n船靠了岸。\n\n他系好缆绳。', '/tmp/第001章_靠岸.md'), volume: '第一卷' };
    const state = {};
    const args = { adapter, book, chapters: [chapter], state, persist: async () => {}, log: () => {} };
    await uploadChapters(args);
    assert.equal(saves, 1);
    assert.equal(state[stateKey(book, chapter)].status, 'verified');
    await uploadChapters(args);
    assert.equal(saves, 1);
    drafts[1].body = '后台被改过的文字';
    await assert.rejects(uploadChapters(args), /回读不一致/);
    assert.equal(saves, 1);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

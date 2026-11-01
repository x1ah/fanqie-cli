import test from 'node:test';
import assert from 'node:assert/strict';
import {reviseAbstract} from '../src/metadata.js';
import {API} from '../src/api.js';
function fixture(){
 const book={bookId:'123',title:'测试书'},journal={},db={book_id:'123',book_name:'测试书',abstract:'旧简介',gender:1,category:[{category_id:2}],thumb_uri:'original',sign_pattern:1};
 let writes=0,fail=false;const adapter={assertBook:async()=>{},request:async(method,url,fields)=>{
  if(method==='POST'){assert.equal(url,API.modifyBook);assert.equal(fields.book_name,'');assert.equal(fields.gender,'');assert.equal(fields.category,'');assert.equal(fields.thumb_uri,'');writes++;db.abstract=fields.abstract;if(fail)throw Error('响应丢失');}
  return structuredClone(db);
 }};
 const args={adapter,book,abstract:'新简介',journal,persist:async()=>{}};
 return {args,db,journal,writes:()=>writes,fail:()=>{fail=true;}};
}
test('简介预览零写入，原其他元信息不变，实际回读、重跑不重写',async()=>{
 const f=fixture();assert.equal((await reviseAbstract({...f.args,dryRun:true})).status,'would-revise');assert.equal(f.writes(),0);
 assert.equal((await reviseAbstract(f.args)).status,'verified');assert.equal(f.db.thumb_uri,'original');assert.equal(f.db.sign_pattern,1);
 await reviseAbstract(f.args);assert.equal(f.writes(),1);assert.equal(f.journal['123'].previous,'旧简介');
});
test('简介未知写只读恢复，不重发；其他字段/第三份简介变化停止',async()=>{
 const f=fixture();f.fail();await assert.rejects(reviseAbstract(f.args),/响应丢失/);await assert.rejects(reviseAbstract(f.args),/先 book/);
 assert.equal((await reviseAbstract({...f.args,statusOnly:true})).status,'verified');assert.equal(f.writes(),1);
 f.db.abstract='网页改稿';await assert.rejects(reviseAbstract({...f.args,statusOnly:true}),/其他操作/);
 f.db.abstract='新简介';f.db.book_name='另名';await assert.rejects(reviseAbstract({...f.args,statusOnly:true}),/其他作品字段/);
});
test('简介日志失败零写入，未应用只读登记',async()=>{
 const f=fixture();await assert.rejects(reviseAbstract({...f.args,persist:async()=>{throw Error('落盘失败');}}),/落盘/);assert.equal(f.writes(),0);
 assert.equal((await reviseAbstract({...f.args,statusOnly:true})).status,'not-applied');assert.equal(f.writes(),0);
});

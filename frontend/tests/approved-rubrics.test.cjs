const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const path=require('node:path');
const payload=JSON.parse(fs.readFileSync(path.join(__dirname,'../../backend/examples/approved-rubric.json'),'utf8'));
const saved={rubricId:'db-r1',assessmentId:'asm-test',questionId:'q1',version:3,approvedAt:'2026-11-24T10:00:00Z',approvedBy:'teacher',question:payload.question};

function moduleFrom(file,globals){
 const exports={};
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{exports,AbortSignal,URL,...globals});return exports;
}
function save(api){return api.saveApprovedRubric({id:'asm-test',title:'OOP',course:'CS'},{id:'q1',...payload.question},payload.question.criteria,payload.question.modelAnswerText,payload.question.subquestions,2);}
test('approval sends expected version then reads exact saved version',async()=>{
 const calls=[];const api=moduleFrom('lib/approved-rubrics.ts',{fetch:async(url,options)=>{calls.push({url,options});return Response.json(saved,{status:options.method==='POST'?201:200});}});
 assert.equal((await save(api)).rubricId,'db-r1');assert.equal(calls.length,2);assert.equal(calls[1].url,'/api/rubric/approved/asm-test/q1?version=3');
 const body=JSON.parse(calls[0].options.body);assert.equal(body.expectedVersion,2);assert.deepEqual(body.question,payload.question);assert.equal(calls[0].options.headers.Authorization,undefined);
});
test('a version conflict stops approval without fetching or retrying',async()=>{
 let calls=0;const api=moduleFrom('lib/approved-rubrics.ts',{fetch:async()=>{calls++;return Response.json({detail:'conflict'},{status:409});}});
 await assert.rejects(save(api),/Load the saved approval/);assert.equal(calls,1);
});
test('failed readback reports saved but unverified and tells user how to recover',async()=>{
 let calls=0;const api=moduleFrom('lib/approved-rubrics.ts',{fetch:async()=>++calls===1?Response.json(saved,{status:201}):Response.json({detail:'offline'},{status:503})});
 await assert.rejects(save(api),/approval was saved, but could not be read back/);assert.equal(calls,2);
});
test('uncertain network save does not retry and explains recovery',async()=>{
 let calls=0;const api=moduleFrom('lib/approved-rubrics.ts',{fetch:async()=>{calls++;throw new Error('timeout');}});
 await assert.rejects(save(api),/Load saved approval before retrying/);assert.equal(calls,1);
});
test('proxy requires cookie, forwards bearer token, and preserves backend status',async()=>{
 let token;const calls=[];
 const api=moduleFrom('app/api/rubric/approved/[assessmentId]/[questionId]/route.ts',{
  process:{env:{}},require(name){if(name==='next/headers')return {cookies:async()=>({get:()=>token?{value:token}:undefined})};if(name==='next/server')return {NextResponse:Response};throw new Error(name);},
  fetch:async(url,options)=>{calls.push({url,options});return Response.json({detail:'validation error'},{status:422});},
 });
 const context={params:Promise.resolve({assessmentId:'asm-test',questionId:'q1'})};
 const request=()=>new Request('http://localhost/api/rubric/approved/asm-test/q1',{method:'POST',body:JSON.stringify(payload)});
 assert.equal((await api.POST(request(),context)).status,401);assert.equal(calls.length,0);
 token='test-session';assert.equal((await api.POST(request(),context)).status,422);assert.equal(calls[0].options.headers.Authorization,'Bearer test-session');assert.equal(calls[0].url,'http://127.0.0.1:8000/api/v1/module2/assessments/asm-test/questions/q1/rubrics/approve');
 assert.equal((await api.GET(new Request('http://localhost/path?version=3'),context)).status,422);assert.match(calls[1].url,/rubrics\/3$/);
});

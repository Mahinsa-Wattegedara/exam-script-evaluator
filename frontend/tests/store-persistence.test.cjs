const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const path=require('node:path');

function harness(approvalApi = {}) {
  const key='scriptx-clean-state-v5';
  const seed={assessment:{id:'asm-test',title:'OOP',course:'OOP',questions:[{id:'q1',number:'Q1',prompt:'',maxMarks:2}]},rubrics:[],scripts:[],audit:[]};
  const saved=structuredClone(seed);
  saved.assessment.questions[0].prompt='Saved question';
  saved.rubrics=[{questionId:'q1',version:1,approved:false,criteria:[{id:'C1',description:'Saved point',maxMarks:2,allowedPartialCredits:[0,2],acceptedAlternatives:['Equivalent answer']}],modelAnswerText:'Saved original answer',subquestions:[{id:'a',label:'Q1(a)',prompt:'Saved subquestion',originalAnswer:'Saved original answer',maxMarks:2}]}];
  let raw=JSON.stringify(saved), writes=0, clears=0, blocked=false, release;
  const gate=new Promise(resolve=>{release=resolve;});
  let cursor=0, pending=[];
  const slots=[];
  const depsChanged=(old,next)=>!old||!next||old.length!==next.length||next.some((v,i)=>v!==old[i]);
  const hooks={
    createContext:()=>({Provider:'Provider'}),
    useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;}];},
    useRef(initial){const i=cursor++;return (slots[i]??={current:initial});},
    useCallback(fn,deps){const i=cursor++;if(!slots[i]||depsChanged(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||depsChanged(slots[i].deps,deps)){slots[i]={deps};pending.push(fn);}},
  };
  const exports={};
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/store.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,structuredClone,console,URL,Error,localStorage:{getItem:()=>raw,removeItem:()=>{},setItem:(_,v)=>{if(blocked)throw new Error('quota exceeded');raw=v;writes++;}},fetch:async()=>{await gate;return {ok:true,json:async()=>({authenticated:false})};},require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name==='./approved-rubrics')return approvalApi;if(name==='./seed')return {buildSeed:()=>structuredClone(seed),DEFAULT_QUESTIONS:seed.assessment.questions};if(name==='./image-utils')return {clearBlobs:async()=>{clears++;},getBlob:async()=>undefined};if(name==='./logic')return {uid:()=> 'audit',nowIso:()=> 'now'};return {};}});
  return {render(){cursor=0;const tree=exports.StoreProvider({children:'editor'});const effects=pending;pending=[];effects.forEach(fn=>fn());return tree;},release,get raw(){return raw;},get writes(){return writes;},get clears(){return clears;},block(){blocked=true;},saved};
}

test('restore completes before editor mounts or initial state is persisted',async()=>{
 const h=harness();const loading=h.render();assert.notEqual(loading.props.children[1],'editor');assert.equal(h.writes,0);assert.equal(JSON.parse(h.raw).rubrics[0].modelAnswerText,'Saved original answer');
 h.release();await new Promise(resolve=>setImmediate(resolve));const loaded=h.render();assert.equal(loaded.props.children[1],'editor');assert.equal(loaded.props.value.state.rubrics[0].subquestions[0].originalAnswer,'Saved original answer');assert.equal(h.clears,0);assert.equal(JSON.parse(h.raw).assessment.questions[0].prompt,'Saved question');
});
test('save flush includes latest edits even before another render',async()=>{
 const h=harness();h.render();h.release();await new Promise(resolve=>setImmediate(resolve));const ctx=h.render().props.value;
 ctx.actions.updateQuestion('q1','Edited question',2);ctx.actions.saveRubricDraft('q1',[{...h.saved.rubrics[0].criteria[0],description:'Edited point'}],'Edited answer',[],h.saved.rubrics[0].subquestions);
 assert.equal(ctx.flushPersistence().ok,true);const stored=JSON.parse(h.raw);assert.equal(stored.assessment.questions[0].prompt,'Edited question');assert.equal(stored.rubrics[0].criteria[0].description,'Edited point');assert.equal(stored.rubrics[0].modelAnswerText,'Edited answer');
});
test('storage failures return an error rather than false save success',async()=>{
 const h=harness();h.render();h.release();await new Promise(resolve=>setImmediate(resolve));const ctx=h.render().props.value;const previous=h.raw;h.block();const result=ctx.flushPersistence();assert.equal(result.ok,false);assert.match(result.error,/could not be saved/);assert.equal(h.raw,previous);
});

const approvalQuestion=JSON.parse(fs.readFileSync(path.join(__dirname,'../../backend/examples/approved-rubric.json'),'utf8')).question;
function approvalSnapshot(version=4){return {rubricId:'database-rubric',assessmentId:'asm-test',questionId:'q1',version,approvedAt:'2026-11-24T10:00:00Z',approvedBy:'actual-teacher',question:approvalQuestion};}
test('approval waits for database confirmation and uses database version and teacher',async()=>{
 let resolveSave, args;const gate=new Promise(resolve=>{resolveSave=resolve;});
 const h=harness({saveApprovedRubric:async(...input)=>{args=input;return gate;}});h.render();h.release();await new Promise(resolve=>setImmediate(resolve));let ctx=h.render().props.value;
 const {criteria,modelAnswerText,subquestions}=approvalQuestion;
 const pending=ctx.actions.approveRubric('q1',criteria,modelAnswerText,[],subquestions);
 ctx.flushPersistence();assert.equal(JSON.parse(h.raw).rubrics.some(r=>r.approved),false);
 resolveSave(approvalSnapshot());assert.equal((await pending).ok,true);ctx.flushPersistence();
 const saved=JSON.parse(h.raw).rubrics[0];assert.equal(saved.version,4);assert.equal(saved.rubricId,'database-rubric');assert.equal(saved.approvedBy,'actual-teacher');assert.equal(args[5],0);
});
test('failed database save leaves existing draft untouched',async()=>{
 const h=harness({saveApprovedRubric:async()=>{throw new Error('Sign in as a teacher');}});h.render();h.release();await new Promise(resolve=>setImmediate(resolve));const ctx=h.render().props.value;
 const before=JSON.parse(h.raw).rubrics;const q=approvalQuestion;const result=await ctx.actions.approveRubric('q1',q.criteria,q.modelAnswerText,[],q.subquestions);assert.equal(result.ok,false);assert.match(result.error,/Sign in/);ctx.flushPersistence();assert.deepEqual(JSON.parse(h.raw).rubrics,before);
});
test('loading a saved approval restores question and full rubric with database version',async()=>{
 const h=harness({loadApprovedRubric:async()=>approvalSnapshot(6)});h.render();h.release();await new Promise(resolve=>setImmediate(resolve));const ctx=h.render().props.value;
 await ctx.actions.loadApprovedRubric('q1');ctx.flushPersistence();const state=JSON.parse(h.raw);assert.equal(state.assessment.questions[0].prompt,approvalQuestion.prompt);assert.equal(state.rubrics[0].version,6);assert.equal(state.rubrics[0].approved,true);assert.deepEqual(state.rubrics[0].subquestions,approvalQuestion.subquestions);
});

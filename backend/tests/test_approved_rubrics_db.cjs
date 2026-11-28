// Optional real PostgreSQL engine test: see backend/README.md for PGlite setup.
const { PGlite } = require('@electric-sql/pglite');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const db = new PGlite();
  const migrations = path.join(__dirname, '../supabase/migrations');
  const baseline = fs.readFileSync(path.join(migrations, '001_fixed_er_complete_schema.sql'), 'utf8');
  // Build only the existing tables used by Module 2, in an isolated in-memory database.
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for (const table of ['app_users', 'teachers', 'project_admins', 'students', 'assessments', 'questions', 'rubrics', 'criteria', 'scripts', 'answers', 'evaluations']) {
    const statement = baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`));
    assert(statement, `Missing base schema for ${table}`);
    await db.exec(statement[0]);
  }
  await db.exec('GRANT USAGE ON SCHEMA public TO service_role; GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;');
  await db.exec('GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT ON public.rubrics, public.criteria TO authenticated;');
  await db.exec(fs.readFileSync(path.join(migrations, '002_module2_approved_rubrics.sql'), 'utf8'));
  // Applying the incremental migration twice must not destroy stored data.
  await db.exec(fs.readFileSync(path.join(migrations, '002_module2_approved_rubrics.sql'), 'utf8'));
  await db.exec(`INSERT INTO public.app_users(user_id,username,email,name,display_name,role,password_hash)
    VALUES ('11111111-1111-1111-1111-111111111111','teacher-one','teacher@example.test','Teacher','Teacher','TEACHER','test-only'),
           ('22222222-2222-2222-2222-222222222222','teacher-two','other@example.test','Other','Other','TEACHER','test-only');
    INSERT INTO public.teachers(teacher_id) VALUES ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222');`);
  const question = { number:'Q1',prompt:'Define encapsulation',maxMarks:2,modelAnswerText:'Groups data and methods.',
    subquestions:[{id:'a',label:'Q1(a)',prompt:'Define encapsulation',originalAnswer:'Groups data and methods.',maxMarks:2}],
    criteria:[{id:'C1',subquestionId:'a',sourceExcerpt:'Groups data and methods.',description:'Groups state and behaviour',maxMarks:2,
      allowedPartialCredits:[0,1,2],acceptedAlternatives:['Combines state and behaviour'],scoringGuide:[{marks:0,description:'Incorrect'},{marks:1,description:'Partial definition'},{marks:2,description:'Complete definition'}]}] };
  const approve = async (assessment, id, user, expected, data=question) => (await db.query(
    'SELECT public.approve_module2_rubric($1,$2,$3,$4,$5,$6,$7::jsonb) AS value',
    [assessment,id,user,'OOP exam','CS',expected,JSON.stringify(data)])).rows[0].value;
  await db.exec('SET ROLE service_role;');
  const first = await approve('asm-one','q1','teacher-one',0);
  assert.equal(first.version,1);
  assert.deepEqual(first.question,question);
  await assert.rejects(approve('asm-one','q1','teacher-one',0), error=>error.code==='PT409');
  const second = await approve('asm-one','q1','teacher-one',1,{...question,prompt:'Revised prompt'});
  assert.equal(second.version,2);
  const original = (await db.query('SELECT approved_snapshot FROM public.rubrics WHERE rubric_id=$1',[first.rubricId])).rows[0];
  assert.deepEqual(original.approved_snapshot,question);
  await assert.rejects(db.query("UPDATE public.rubrics SET model_answer_text='changed' WHERE rubric_id=$1",[first.rubricId]), error=>error.code==='PT409');
  await assert.rejects(db.query('DELETE FROM public.criteria WHERE rubric_id=$1',[first.rubricId]), error=>error.code==='PT409');
  await assert.rejects(db.query("UPDATE public.criteria SET description='changed' WHERE rubric_id=$1",[first.rubricId]), error=>error.code==='PT409');
  await assert.rejects(db.query("INSERT INTO public.criteria(criterion_id,rubric_id,description,max_mark) VALUES ('extra',$1,'extra',1)",[first.rubricId]), error=>error.code==='PT409');
  await assert.rejects(approve('asm-one','q1','teacher-two',2), error=>error.code==='PT404');
  const other = await approve('asm-two','q1','teacher-two',0);
  assert.notEqual(first.rubricId,other.rubricId);
  const invalid = {...question, criteria:[{...question.criteria[0],maxMarks:1},{...question.criteria[0],maxMarks:1}]};
  await assert.rejects(approve('atomic-rollback','q1','teacher-one',0,invalid),error=>error.code==='23505');
  assert.equal((await db.query("SELECT * FROM public.assessments WHERE assessment_id='atomic-rollback'")).rows.length,0);

  await db.exec('RESET ROLE');
  const resetMigration = fs.readFileSync(path.join(migrations, '003_module2_demo_scheme_reset.sql'), 'utf8');
  await db.exec(resetMigration);
  await db.exec(resetMigration);
  await db.exec('SET ROLE service_role;');
  const archive = async (assessment, user, id=null) => (await db.query(
    'SELECT public.archive_module2_marking_scheme($1,$2,$3) AS value', [assessment,user,id]
  )).rows[0].value.archivedQuestions;
  const stillActive = await approve('asm-one','q2','teacher-one',0,{...question,number:'Q2'});
  await assert.rejects(archive('asm-one','teacher-two'), error=>error.code==='PT404');
  assert.equal(await archive('asm-one','teacher-one','q1'),1);
  assert.equal(await archive('asm-one','teacher-one','q1'),0);
  const archivedSnapshot = (await db.query('SELECT approved_snapshot FROM public.rubrics WHERE rubric_id=$1',[first.rubricId])).rows[0];
  assert.deepEqual(archivedSnapshot.approved_snapshot,question);
  await assert.rejects(db.query('DELETE FROM public.rubrics WHERE rubric_id=$1',[first.rubricId]), error=>error.code==='PT409');
  const replacement = await approve('asm-one','q1','teacher-one',0);
  assert.equal(replacement.version,1);
  assert.notEqual(replacement.rubricId,first.rubricId);
  await db.query("INSERT INTO public.scripts(script_id,assessment_id,uploaded_by,pseudonym_code) VALUES ('test-script','asm-one','11111111-1111-1111-1111-111111111111','S1')");
  await assert.rejects(archive('asm-one','teacher-one'), error=>error.code==='PT409');
  await db.query("INSERT INTO public.answers(answer_id,script_id,question_id) SELECT 'test-answer','test-script',question_id FROM public.questions WHERE assessment_id='asm-one' AND external_question_id='q1'");
  await assert.rejects(archive('asm-one','teacher-one','q1'), error=>error.code==='PT409');
  await db.query("DELETE FROM public.scripts WHERE script_id='test-script'");
  assert.equal(await archive('asm-one','teacher-one'),2);
  assert.notEqual((await approve('asm-one','q2','teacher-one',0,{...question,number:'Q2'})).rubricId,stillActive.rubricId);
  assert.equal(await archive('missing-assessment','teacher-one'),0);
  await db.exec('RESET ROLE; SET ROLE anon;');
  await assert.rejects(approve('forbidden','q1','teacher-one',0),error=>error.code==='42501');
  await assert.rejects(archive('asm-one','teacher-one'),error=>error.code==='42501');
  await db.exec('RESET ROLE; SET ROLE authenticated;');
  await assert.rejects(db.query('SELECT * FROM public.rubrics'),error=>error.code==='42501');
  await db.exec('RESET ROLE;');
  console.log('PASS: rubric persistence, immutable and archived approvals, single and whole-scheme resets, fresh versions, ownership, student-work protection, and RPC permissions.');
  await db.close();
}
main().catch(error=>{console.error(error);process.exit(1);});

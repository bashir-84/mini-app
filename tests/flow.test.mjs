import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.mjs';

test('Telegram identity, class membership, stable results and teacher publication', async () => {
  const sql = new DatabaseSync(':memory:');
  for (const filename of ['0001_schema.sql','0002_seed.sql','0003_messages.sql']) {
    sql.exec(readFileSync(new URL('../migrations/' + filename, import.meta.url),'utf8'));
  }
  sql.exec(readFileSync(new URL('./fixture.sql', import.meta.url),'utf8'));
  // D1-shaped test adapter. SQL is executed by SQLite and Web Crypto by Node.
  const db = {
    withSession: () => db,
    prepare(statement) {
      const bind = (...values) => ({
        run: async () => sql.prepare(statement).run(...values),
        first: async () => sql.prepare(statement).get(...values) ?? null,
        all: async () => ({results:sql.prepare(statement).all(...values)})
      });
      return {bind};
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          // Test-only, used for both read and write statements.
          results.push(await statement.all());
        }
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    }
  };
  const token = 'fixture-not-a-real-token';
  const teacherKey = 'a'.repeat(64);
  sql.prepare('INSERT INTO users VALUES (?,NULL,?,?,?)')
    .run('teacher:test','معلم','teacher',createHash('sha256').update(teacherKey).digest('hex'));
  sql.exec(`INSERT INTO memberships VALUES ('class-1','teacher:test','teacher','active');
    INSERT INTO classes VALUES ('other','کلاس دیگر');
    INSERT INTO rounds (id,class_id,quiz_id) VALUES ('other-round','other','reasoning-v1');`);

  function telegram(id, firstName, age = 0, round = 'reasoning-01') {
    const params = new URLSearchParams({
      user:JSON.stringify({id,first_name:firstName}), start_param:round,
      auth_date:Math.floor(Date.now()/1000)-age, signature:'fixture_signature'
    });
    params.sort();
    const check = [...params].map(([key,value]) => key + '=' + value).join('\n');
    const secret = createHmac('sha256','WebAppData').update(token).digest();
    params.set('hash',createHmac('sha256',secret).update(check).digest('hex'));
    return params.toString();
  }
  async function call(path,{auth,cookie,method = 'GET',data,origin = 'https://quiz.test'} = {}) {
    const headers = {Origin:origin};
    if (auth) headers['X-Telegram-Init-Data'] = auth;
    if (cookie) headers.Cookie = cookie;
    if (data) headers['Content-Type'] = 'application/json';
    const response = await worker.fetch(new Request('https://quiz.test/api/' + path,{
      method,headers,body:data && JSON.stringify(data)
    }),{DB:db,TELEGRAM_BOT_TOKEN:token});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('Set-Cookie')?.split(';')[0]};
  }

  const sara = telegram(100,'سارا');
  const arash = telegram(200,'آرش');
  const outsider = telegram(300,'مهمان');
  const state = auth => call('student/state',{auth});
  const scores = auth => call('student/scores',{auth});
  const submit = (auth,answers,name='نام آزمون') => call('student/submit',{auth,method:'POST',data:{answers,name}});
  const round = '?round=reasoning-01';
  assert.equal((await state(telegram(100,'سارا',3601))).status,401);
  assert.equal((await state(sara.replace('reasoning-01','other-round'))).status,401);
  assert.equal((await state(outsider)).body.access,'active');
  assert.equal((await state(outsider)).body.questions.length,3);
  assert.equal((await call('teacher/report'+round,{auth:outsider})).status,401);
  assert.equal((await call('teacher/login',{method:'POST',data:{login:'teacher',key:'b'.repeat(64)}})).status,401);

  const {cookie,status} = await call('teacher/login',{method:'POST',data:{login:'teacher',key:teacherKey}});
  assert.equal(status,200);
  assert.ok(cookie.startsWith('__Host-teacher='));
  assert.equal((await call('teacher/report?round=other-round',{cookie})).status,403);
  assert.equal((await call('teacher/publish'+round,{cookie,method:'POST',origin:'https://outside.test'})).status,403);
  const initial = (await state(sara)).body;
  assert.equal(initial.questions.length,3);
  assert.deepEqual(Object.keys(initial.questions[0]),['number','prompt','options']);
  assert.deepEqual((await scores(sara)).body.rows,[]);
  assert.equal((await submit(sara,[1,2])).status,400);
  const [first, retry] = await Promise.all([submit(sara,[1,2,3],'سارا دلخواه'),submit(sara,[1,2,3],'سارا دلخواه')]);
  const result = first.body.result;
  assert.equal(result.score,2);
  assert.deepEqual(result.answers.map(a => [a.option,a.ok]),[[1,true],[2,false],[3,true]]);
  assert.deepEqual(Object.keys(result.answers[0]),['number','option','label','ok']);
  assert.deepEqual(retry.body.result,result);
  assert.deepEqual((await submit(sara,[1,0,3])).body.result,result);
  assert.deepEqual((await state(telegram(100,'نام تازه'))).body.result,result);
  assert.equal((await state(telegram(100,'نام تازه'))).body.displayName,'سارا دلخواه');
  await state(arash);
  assert.equal((await submit(arash,[1,0,3])).body.result.score,3);

  const report = (await call('teacher/report'+round,{cookie})).body;
  assert.equal(report.attempts.length,2);
  assert.equal(report.questions[1].correct,0);
  assert.equal(report.questions[1].incorrect,1);
  assert.match(report.attempts[0].submitted_at,/Z$/);
  assert.equal((await call('teacher/publish'+round,{cookie,method:'POST'})).status,200);
  assert.equal((await call('teacher/publish'+round,{cookie,method:'POST'})).status,200);
  assert.equal((await scores(outsider)).status,200);
  assert.deepEqual((await scores(sara)).body.rows,[
    {rank:1,name:'نام آزمون',score:3},{rank:2,name:'سارا دلخواه',score:2}
  ]);
  assert.deepEqual((await submit(sara,[0,0,0])).body.result,result);
  assert.equal((await submit(outsider,[1,0,3])).status,409);
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM attempts').get().count,2);

  const query = readFileSync(new URL('../report.sql', import.meta.url),'utf8');
  assert.deepEqual(sql.prepare(query).all().map(row => [row.display_name,row.score,row.q2]), [
    ['نام آزمون',3,'درست'],['سارا دلخواه',2,'نادرست']
  ]);

  sql.exec('UPDATE attempts SET score=2');
  assert.deepEqual((await scores(sara)).body.rows.map(row => row.rank),[1,1]);
  assert.equal((await call('teacher/logout',{cookie,method:'POST'})).status,200);
  assert.equal((await call('teacher/report'+round,{cookie})).status,401);
});

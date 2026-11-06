const encoder = new TextEncoder();
const fa = {
  telegram: 'مینی‌اپ را ببند و دوباره از لینک کلاس در تلگرام باز کن.',
  denied: 'به این بخش دسترسی نداری.',
  invalid: 'اطلاعات ارسال‌شده معتبر نیست.',
  missing: 'این نوبت آزمون پیدا نشد.',
  closed: 'این نوبت آزمون به پایان رسیده است.',
  server: 'ارتباط با سرور برقرار نشد. دوباره تلاش کن.'
};
const now = () => Math.floor(Date.now() / 1000);
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const fail = (status, message) => { throw new Response(message, { status }); };
const sessionCookie = (token, age) =>
  `__Host-teacher=${token}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Strict`;

function json(data, headers = {}, status = 200) {
  return Response.json(data, {status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers
  }});
}

export async function validateTelegram(raw, token) {
  if (!token || !raw || raw.length > 8192) fail(401, fa.telegram);
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!/^[a-f0-9]{64}$/.test(hash ?? '') || new Set(params.keys()).size !== [...params].length) {
    fail(401, fa.telegram);
  }
  params.delete('hash');
  params.sort();
  const check = [...params].map(([key, value]) => `${key}=${value}`).join('\n');
  const algorithm = {name: 'HMAC', hash: 'SHA-256'};
  const seed = await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), algorithm, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', seed, encoder.encode(token));
  const key = await crypto.subtle.importKey('raw', secret, algorithm, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key,
    Uint8Array.from(hash.match(/../g), byte => parseInt(byte, 16)), encoder.encode(check));
  const date = Number(params.get('auth_date'));
  if (!valid || !Number.isInteger(date) || date < now() - 3600 || date > now() + 30) {
    fail(401, fa.telegram);
  }
  let user;
  try { user = JSON.parse(params.get('user')); } catch { fail(401, fa.telegram); }
  if (!Number.isSafeInteger(user?.id) || user.id <= 0) fail(401, fa.telegram);
  const displayName = [user.first_name, user.last_name]
    .filter(value => typeof value === 'string')
    .join(' ').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, '').trim();
  return {id: `tg:${user.id}`, telegramId: String(user.id),
    displayName: Array.from(displayName).slice(0, 100).join('') || 'دانش‌آموز',
    roundId: params.get('start_param')};
}

async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415, fa.invalid);
  const reader = request.body?.getReader();
  if (!reader) fail(400, fa.invalid);
  const decoder = new TextDecoder();
  let size = 0;
  let raw = '';
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8192) {
      await reader.cancel();
      fail(413, fa.invalid);
    }
    raw += decoder.decode(value, {stream: true});
  }
  try {
    const value = JSON.parse(raw + decoder.decode());
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* handled below */ }
  fail(400, fa.invalid);
}

async function botApi(token, method, data) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(`Telegram ${method}: ${payload.description || response.status}`);
  return payload.result;
}

function messageTexts(attempt, telegramId, title) {
  const answers = JSON.parse(attempt.answers);
  const lines = answers.map(a => `سؤال ${a.number}: ${['الف','ب','ج','د'][a.option]}، ${a.ok ? 'درست' : 'نادرست'}`);
  const summary = `${title}\n${attempt.display_name}، ${attempt.score} پاسخ درست از ${answers.length}\n${lines.join('\n')}`;
  return {student:`نتیجهٔ آزمون شما\n${summary}`,teacher:
    `ثبت جدید آزمون\n${summary}\nشناسهٔ تلگرام: ${telegramId}\nزمان ثبت: ${attempt.submitted_at} (UTC)`};
}

async function queueMessages(db, round, userId, telegramId, attempt) {
  const texts = messageTexts(attempt, telegramId, round.title);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO message_outbox (round_id,user_id,recipient,chat_id,text)
      SELECT ?,?,'student',c.chat_id,? FROM bot_chats c WHERE c.user_id=?`)
      .bind(round.id,userId,texts.student,userId),
    db.prepare(`INSERT OR IGNORE INTO message_outbox (round_id,user_id,recipient,chat_id,text)
      SELECT ?,?,'teacher',c.chat_id,? FROM memberships m JOIN bot_chats c ON c.user_id=m.user_id
      WHERE m.class_id=? AND m.role='teacher' AND m.status='active'`)
      .bind(round.id,userId,texts.teacher,round.class_id)
  ]);
}

async function sendPending(db, token) {
  const {results} = await db.prepare(`SELECT round_id,user_id,recipient,chat_id,text,attempts FROM message_outbox
    WHERE sent_at IS NULL AND retry_at<=? AND lease_until<=? ORDER BY attempts,round_id LIMIT 15`)
    .bind(now(),now()).all();
  for (const row of results) {
    const key = [row.round_id,row.user_id,row.recipient];
    const claimed = await db.prepare(`UPDATE message_outbox SET lease_until=? WHERE round_id=? AND user_id=?
      AND recipient=? AND sent_at IS NULL AND lease_until<=?`)
      .bind(now()+45,...key,now()).run();
    if (!claimed.meta?.changes) continue;
    try {
      await botApi(token,'sendMessage',{chat_id:row.chat_id,text:row.text});
      await db.prepare(`UPDATE message_outbox SET sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        lease_until=0 WHERE round_id=? AND user_id=? AND recipient=?`).bind(...key).run();
    } catch (error) {
      console.error('Message delivery failed:', error.message);
      await db.prepare(`UPDATE message_outbox SET attempts=attempts+1,lease_until=0,retry_at=?
        WHERE round_id=? AND user_id=? AND recipient=?`)
        .bind(now()+Math.min(3600,60*2**Math.min(row.attempts,6)),...key).run();
    }
  }
}

async function botUpdate(request, env, db, ctx) {
  const config = await db.prepare('SELECT webhook_secret FROM bot_config WHERE id=1').first();
  if (!config || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== config.webhook_secret) {
    fail(403, fa.denied);
  }
  const update = await body(request);
  const message = update.message;
  if (!message || message.chat?.type !== 'private' || !Number.isSafeInteger(message.from?.id)
      || message.from?.is_bot || typeof message.text !== 'string') return json({ok:true});
  const chatId = String(message.chat.id);
  const userId = `tg:${message.from.id}`;
  const code = /^\/start ([a-f0-9]{32})$/.exec(message.text.trim())?.[1];
  if (code) {
    const hash = await digest(code);
    const claimed = await db.prepare(`DELETE FROM teacher_link_codes WHERE code_hash=? AND expires>?
      RETURNING user_id`).bind(hash,now()).first();
    const teacherId = claimed?.user_id;
    if (teacherId) {
      await db.prepare(`INSERT INTO bot_chats VALUES (?,?) ON CONFLICT(user_id)
        DO UPDATE SET chat_id=excluded.chat_id`).bind(teacherId,chatId).run();
      await botApi(env.TELEGRAM_BOT_TOKEN,'sendMessage',{
        chat_id:chatId,text:'حساب معلم به پیام‌های آزمون وصل شد.'
      });
      const {results: backfill} = await db.prepare(`SELECT a.*,r.title,u.telegram_id
        FROM attempts a JOIN rounds x ON x.id=a.round_id JOIN quizzes r ON r.id=x.quiz_id
        JOIN memberships m ON m.class_id=x.class_id AND m.user_id=?
        JOIN users u ON u.id=a.user_id WHERE m.role='teacher' AND m.status='active'`)
        .bind(teacherId).all();
      for (const attempt of backfill) {
        const text = messageTexts(attempt,attempt.telegram_id,attempt.title).teacher;
        await db.prepare(`INSERT OR IGNORE INTO message_outbox (round_id,user_id,recipient,chat_id,text)
          VALUES (?,?,'teacher',?,?)`).bind(attempt.round_id,attempt.user_id,chatId,text).run();
      }
      ctx?.waitUntil(sendPending(db,env.TELEGRAM_BOT_TOKEN));
    } else {
      await botApi(env.TELEGRAM_BOT_TOKEN,'sendMessage',{
        chat_id:chatId,text:'کد اتصال معتبر نیست یا منقضی شده است.'
      });
    }
    return json({ok:true});
  }
  if (message.text.trim() === '/start') {
    const student = await db.prepare('SELECT id FROM users WHERE id=? AND telegram_id=?')
      .bind(userId,String(message.from.id)).first();
    if (student) {
      await db.prepare(`INSERT INTO bot_chats VALUES (?,?) ON CONFLICT(user_id)
        DO UPDATE SET chat_id=excluded.chat_id`).bind(userId,chatId).run();
      const {results} = await db.prepare(`SELECT a.*,r.title FROM attempts a JOIN rounds x ON x.id=a.round_id
        JOIN quizzes r ON r.id=x.quiz_id WHERE a.user_id=?`).bind(userId).all();
      for (const attempt of results) {
        const text = messageTexts(attempt,String(message.from.id),attempt.title).student;
        await db.prepare(`INSERT OR IGNORE INTO message_outbox (round_id,user_id,recipient,chat_id,text)
          VALUES (?,?,'student',?,?)`).bind(attempt.round_id,userId,chatId,text).run();
      }
      ctx?.waitUntil(sendPending(db,env.TELEGRAM_BOT_TOKEN));
    }
    await botApi(env.TELEGRAM_BOT_TOKEN,'sendMessage',{
      chat_id:chatId,text:'چت بات فعال شد. نتیجهٔ آزمون پس از ثبت پاسخ به اینجا می‌رسد.'
    });
  }
  return json({ok:true});
}

async function student(action, request, env, db, ctx) {
  const {id, telegramId, displayName, roundId: startRoundId} = await validateTelegram(
    request.headers.get('X-Telegram-Init-Data'), env.TELEGRAM_BOT_TOKEN);
  let roundId = startRoundId;
  if (!roundId) {
    const available = await db.prepare('SELECT id FROM rounds ORDER BY id LIMIT 2').all();
    if (available.results.length === 1) roundId = available.results[0].id;
  }
  if (!/^[a-z0-9-]{1,64}$/.test(roundId ?? '')) fail(404, fa.missing);
  const round = await db.prepare(`SELECT r.*, c.title AS class_title, q.title, q.intro
    FROM rounds r JOIN classes c ON c.id=r.class_id JOIN quizzes q ON q.id=r.quiz_id
    WHERE r.id=?`).bind(roundId).first();
  if (!round) fail(404, fa.missing);
  if (action === 'state') {
    await db.batch([
      db.prepare(`INSERT INTO users (id,telegram_id,display_name) VALUES (?,?,?)
        ON CONFLICT(id) DO NOTHING`).bind(id, telegramId, displayName),
      db.prepare(`INSERT INTO memberships (class_id,user_id,role,status)
        VALUES (?,?,'student','active') ON CONFLICT(class_id,user_id) DO UPDATE
        SET status='active' WHERE memberships.role='student'`).bind(round.class_id,id)
    ]);
  }
  const member = await db.prepare(`SELECT role,status FROM memberships
    WHERE class_id=? AND user_id=?`).bind(round.class_id, id).first();
  const active = member?.role === 'student' && member.status === 'active';
  if (!active) fail(403, fa.denied);
  const savedUser = await db.prepare('SELECT display_name FROM users WHERE id=?').bind(id).first();
  const chosenName = savedUser.display_name;
  const attemptQuery = () => db.prepare(`SELECT display_name,score,answers FROM attempts
    WHERE round_id=? AND user_id=?`).bind(roundId, id).first();
  const questionRows = async () => (await db.prepare(`SELECT number,prompt,options FROM questions
    WHERE quiz_id=? ORDER BY number`).bind(round.quiz_id).all()).results
    .map(q => ({...q, options: JSON.parse(q.options)}));
  const personal = (attempt, questions) => {
    const answers = JSON.parse(attempt.answers);
    return {score: attempt.score, total: answers.length, answers: answers.map(answer => {
      const q = questions.find(item => item.number === answer.number);
      return {number: answer.number, option: answer.option,
        label: q.options[answer.option], ok: !!answer.ok};
    })};
  };
  if (action === 'scores') {
    const {results} = await db.prepare(`SELECT RANK() OVER (ORDER BY a.score DESC) AS rank,
      a.display_name AS name, a.score FROM attempts a JOIN memberships m
        ON m.user_id=a.user_id AND m.class_id=? AND m.role='student' AND m.status='active'
      WHERE a.round_id=? ORDER BY rank,a.submitted_at,a.user_id`).bind(round.class_id,roundId).all();
    return json({rows: results});
  }
  const attempt = await attemptQuery();
  if (action === 'submit') {
    if (attempt) return json({result: personal(attempt, await questionRows())});
    if (round.closed_at) fail(409, fa.closed);
    const {answers, name} = await body(request);
    const cleanName = typeof name === 'string' ? name.trim().replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, '') : '';
    if (!cleanName || Array.from(cleanName).length > 100) fail(400, 'نام نمایشی را وارد کن.');
    const questions = await questionRows();
    if (!Array.isArray(answers) || !questions.length || answers.length !== questions.length ||
        !answers.every(option => Number.isInteger(option) && option >= 0 && option < 4)) fail(400, fa.invalid);
    // The write itself checks membership and the open state. The primary key decides concurrent retries.
    await db.prepare(`WITH selected AS (
      SELECT q.number, CAST(j.value AS INTEGER) AS option, q.correct=CAST(j.value AS INTEGER) AS ok
      FROM (SELECT *, ROW_NUMBER() OVER (ORDER BY number)-1 AS position
        FROM questions WHERE quiz_id=?) q JOIN json_each(?) j ON j.key=q.position
    )
    INSERT INTO attempts (round_id,user_id,display_name,submitted_at,score,answers)
    SELECT r.id, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      (SELECT SUM(ok) FROM selected),
      (SELECT json_group_array(json_object('number',number,'option',option,'ok',ok))
        FROM (SELECT * FROM selected ORDER BY number))
    FROM rounds r JOIN memberships m ON m.class_id=r.class_id AND m.user_id=?
    WHERE r.id=? AND r.closed_at IS NULL AND m.role='student' AND m.status='active'
    ON CONFLICT(round_id,user_id) DO NOTHING`)
      .bind(round.quiz_id, JSON.stringify(answers), id, cleanName, id, roundId).run();
    const saved = await attemptQuery();
    if (!saved) fail(409, 'ثبت انجام نشد. وضعیت آزمون یا عضویت را دوباره بررسی کن.');
    await queueMessages(db, round, id, telegramId, saved);
    ctx?.waitUntil(sendPending(db,env.TELEGRAM_BOT_TOKEN));
    return json({result: personal(saved, questions)});
  }
  const questions = attempt || !round.closed_at ? await questionRows() : [];
  return json({access: 'active', closed: !!round.closed_at, title: round.title,
    classTitle: round.class_title, intro: round.intro, displayName: attempt?.display_name ?? chosenName,
    questions: attempt || round.closed_at ? [] : questions,
    result: attempt ? personal(attempt, questions) : null});
}

async function teacher(action, roundId, request, db, env) {
  if (action === 'login') {
    const {login, key} = await body(request);
    if (typeof login !== 'string' || !/^[a-z0-9-]{1,64}$/.test(login) ||
        typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) fail(401, 'نام کاربری یا کلید ورود معتبر نیست.');
    const user = await db.prepare(`SELECT id FROM users WHERE login=? AND key_hash=?
      AND EXISTS (SELECT 1 FROM memberships WHERE user_id=users.id AND role='teacher' AND status='active')`)
      .bind(login, await digest(key)).first();
    if (!user) fail(401, 'نام کاربری یا کلید ورود معتبر نیست.');
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const age = 28800;
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE expires<=?').bind(now()),
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').bind(await digest(token), user.id, now()+age)
    ]);
    return json({ok:true}, {'Set-Cookie':sessionCookie(token, age)});
  }
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-teacher=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) fail(401, 'ابتدا وارد پنل معلم شو.');
  const hash = await digest(token);
  const session = await db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires>?')
    .bind(hash, now()).first();
  if (!session) fail(401, 'نشست ورود پایان یافته است. دوباره وارد شو.');
  const id = session.user_id;
  if (action === 'logout') {
    await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run();
    return json({ok:true}, {'Set-Cookie':sessionCookie('',0)});
  }
  const {results: rounds} = await db.prepare(`SELECT r.id,r.closed_at,q.title,c.title AS class_title
    FROM rounds r JOIN memberships m ON m.class_id=r.class_id
    JOIN quizzes q ON q.id=r.quiz_id JOIN classes c ON c.id=r.class_id
    WHERE m.user_id=? AND m.role='teacher' AND m.status='active' ORDER BY c.title,r.id`).bind(id).all();
  if (action === 'rounds') return json({rounds});
  if (action === 'bot-link') {
    const code = hex(crypto.getRandomValues(new Uint8Array(16)));
    await db.prepare('INSERT INTO teacher_link_codes VALUES (?,?,?)')
      .bind(await digest(code),id,now()+600).run();
    return json({code,expiresIn:600});
  }
  if (action === 'bot-setup') {
    const webhook = await botApi(env.TELEGRAM_BOT_TOKEN,'getWebhookInfo',{});
    const target = new URL('/api/bot/update',request.url).href;
    if (webhook.url && webhook.url !== target) {
      return json({error:'این بات هم‌اکنون به وب‌هوک دیگری وصل است.',currentUrl:webhook.url}, {}, 409);
    }
    let config = await db.prepare('SELECT webhook_secret FROM bot_config WHERE id=1').first();
    if (!config) {
      const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
      await db.prepare('INSERT OR IGNORE INTO bot_config VALUES (1,?)').bind(secret).run();
      config = await db.prepare('SELECT webhook_secret FROM bot_config WHERE id=1').first();
    }
    await botApi(env.TELEGRAM_BOT_TOKEN,'setWebhook',{
      url:target, secret_token:config.webhook_secret, allowed_updates:['message'],drop_pending_updates:false
    });
    return json({ok:true,webhook:target});
  }
  if (!rounds.some(round => round.id === roundId)) fail(403, fa.denied);
  const round = await db.prepare('SELECT * FROM rounds WHERE id=?').bind(roundId).first();
  if (action === 'approve') {
    const {userId} = await body(request);
    if (typeof userId !== 'string' || !/^tg:[0-9]{1,16}$/.test(userId)) fail(400, fa.invalid);
    await db.prepare(`UPDATE memberships SET status='active' WHERE class_id=? AND user_id=?
      AND role='student' AND status='pending'`).bind(round.class_id,userId).run();
    return json({ok:true});
  }
  if (action === 'publish') {
    await db.prepare(`UPDATE rounds SET closed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND closed_at IS NULL`).bind(roundId).run();
    return json({ok:true});
  }
  const [members, attempts, questions] = await db.batch([
    db.prepare(`SELECT u.id,u.display_name,m.status FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.class_id=? AND m.role='student' ORDER BY u.display_name,u.id`).bind(round.class_id),
    db.prepare(`SELECT user_id,display_name,submitted_at,score,answers FROM attempts
      WHERE round_id=? ORDER BY submitted_at,user_id`).bind(roundId),
    db.prepare(`SELECT number,prompt,options,correct,explanation FROM questions
      WHERE quiz_id=? ORDER BY number`).bind(round.quiz_id)
  ]);
  const records = attempts.results.map(row => ({...row, answers:JSON.parse(row.answers)}));
  const items = questions.results.map(q => ({...q, options:JSON.parse(q.options),
    incorrect:records.filter(a => a.answers.some(item => item.number===q.number && !item.ok)).length}));
  return json({closed:!!round.closed_at, members:members.results, attempts:records, questions:items});
}

export default {
  async scheduled(controller, env) {
    await sendPending(env.DB.withSession('first-primary'),env.TELEGRAM_BOT_TOKEN);
  },
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const method = request.method;
      if (method === 'POST' && url.pathname !== '/api/bot/update' && request.headers.get('Origin') !== url.origin) fail(403, fa.denied);
      const db = env.DB.withSession('first-primary');
      if (url.pathname === '/api/bot/update' && method === 'POST') return botUpdate(request,env,db,ctx);
      const studentRoute = /^\/api\/student\/(state|scores|join|submit)$/.exec(url.pathname);
      const teacherRoute = /^\/api\/teacher\/(login|logout|rounds|report|approve|publish|bot-link|bot-setup)$/.exec(url.pathname);
      const action = studentRoute?.[1] ?? teacherRoute?.[1];
      if (!action) fail(404, 'مسیر پیدا نشد.');
      const expected = ['state','scores','rounds','report'].includes(action) ? 'GET' : 'POST';
      if (method !== expected) fail(405, 'روش درخواست معتبر نیست.');
      return studentRoute ? await student(action, request, env, db, ctx)
        : await teacher(action, url.searchParams.get('round'), request, db, env);
    } catch (error) {
      if (error instanceof Response) return json({error:await error.text()}, {}, error.status);
      console.error('Quiz request failed:', error?.name);
      return json({error:fa.server}, {}, 500);
    }
  }
};

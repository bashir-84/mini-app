import {api, busy, button, digits, element, get, letters, notice, table} from './common.js';

const login = get('login');
const dashboard = get('dashboard');
const selector = get('round');
const report = get('report');
const request = (action,{round,data,method = 'GET'} = {}) => api('teacher/' + action +
  (round ? '?round=' + encodeURIComponent(round) : ''),{method,data});
const date = new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Tehran'});
let loadVersion = 0;

function showLogin() {
  loadVersion++;
  dashboard.hidden = true;
  report.replaceChildren();
  login.hidden = false;
  login.reset();
}

async function refresh() {
  const round = selector.value;
  const version = ++loadVersion;
  if (!round) {
    report.replaceChildren();
    report.append(element('p','نوبت آزمونی برای این حساب وجود ندارد.'));
    return;
  }
  try {
    const data = await request('report',{round});
    if (version === loadVersion) render(round,data);
  } catch (error) {
    if (version !== loadVersion) return;
    if (error.status === 401) showLogin();
    throw error;
  }
}

async function load() {
  const {rounds} = await request('rounds');
  login.hidden = true;
  dashboard.hidden = false;
  selector.replaceChildren(...rounds.map(round => {
    const option = element('option',round.class_title + ' · ' + round.title + ' · ' + round.id);
    option.value = round.id;
    return option;
  }));
  await refresh();
}

function render(round,data) {
  const action = (name,body) => request(name,{round,method:'POST',data:body});
  const state = element('section',undefined,'card');
  state.append(element('h2',data.closed ? 'آزمون پایان یافته و جدول منتشر شده' : 'آزمون باز است'));
  if (!data.closed) state.append(button('پایان آزمون و انتشار جدول',async () => {
    if (!window.confirm('با انتشار جدول، ثبت پاسخ جدید بسته می‌شود. ادامه می‌دهی؟')) return;
    await action('publish');
    await refresh();
  }));
  const bot = element('section',undefined,'card');
  const botStatus = element('p','برای دریافت گزارش در تلگرام، ابتدا اتصال بات را فعال کن و سپس حساب معلم را وصل کن.');
  bot.append(element('h2','گزارش در چت بات'),botStatus,
    button('فعال‌سازی مسیر پیام',async () => {
      await request('bot-setup',{method:'POST'});
      botStatus.textContent = 'مسیر پیام فعال شد. حالا کد اتصال بساز.';
    },'secondary'),
    button('ساخت کد اتصال معلم',async () => {
      const {code} = await request('bot-link',{method:'POST'});
      botStatus.replaceChildren('این لینک را با حساب انسانی معلم در تلگرام باز کن. کد تا ۱۰ دقیقه معتبر است.');
      const link = element('a','وصل‌کردن حساب معلم');
      link.href = 'https://t.me/ConnectionPlansBot?start=' + code;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      botStatus.append(element('br'),link);
    },'secondary'));
  const members = element('section',undefined,'card');
  members.append(element('h2','عضویت کلاس'));
  const roster = data.members.map(member => [
    element('bdi',member.display_name),element('bdi',member.id.replace(/^tg:/,'')),
    member.status === 'active' ? 'تأییدشده' : button('تأیید عضویت',async () => {
      await action('approve',{userId:member.id});
      await refresh();
    },'secondary')
  ]);
  members.append(roster.length ? table(['نام','شناسهٔ تلگرام','عضویت'],roster) :
    element('p','درخواستی ثبت نشده است.'));
  const summary = element('section',undefined,'card');
  summary.append(element('h2','نمای کلی · ' + digits(data.attempts.length) + ' ثبت نهایی'));
  const list = element('ul');
  for (const q of data.questions) {
    list.append(element('li','سؤال ' + digits(q.number) + ' — ' + digits(q.incorrect) +
      ' پاسخ نادرست · پاسخ صحیح: ' + letters[q.correct] + ') ' + q.options[q.correct] + ' · ' + q.explanation));
  }
  summary.append(list);
  const attempts = element('section',undefined,'card');
  attempts.append(element('h2','گزارش پاسخ‌ها'));
  const byUser = new Map(data.attempts.map(item => [item.user_id,item]));
  const records = data.members.filter(member => member.status === 'active' || byUser.has(member.id));
  const rows = records.map(member => {
    const attempt = byUser.get(member.id);
    return [element('bdi',attempt?.display_name ?? member.display_name),
      attempt ? digits(attempt.score) + ' از ' + digits(data.questions.length) : 'ثبت نشده',
      attempt ? date.format(new Date(attempt.submitted_at)) : '—',
      ...data.questions.map(q => {
        const a = attempt?.answers.find(answer => answer.number === q.number);
        return a ? element('span',letters[a.option] + ') ' + q.options[a.option] +
          ' · ' + (a.ok ? 'درست' : 'نادرست'),a.ok ? 'good' : 'error') : '—';
      })];
  });
  attempts.append(rows.length ? table(['نام','امتیاز','زمان تهران',
    ...data.questions.map(q => 'سؤال ' + digits(q.number))],rows)
    : element('p','هنوز دانش‌آموز تأییدشده‌ای وجود ندارد.'));
  report.replaceChildren(state,bot,members,summary,attempts);
}
login.addEventListener('submit',event => {
  event.preventDefault();
  const submit = login.querySelector('button');
  if (submit.disabled) return;
  const data = new FormData(login);
  void busy(submit,async () => {
    await request('login',{method:'POST',data:{login:data.get('login').trim(),key:data.get('key').trim()}});
    login.reset();
    await load();
  });
});
selector.addEventListener('change',() => { notice(); refresh().catch(error => notice(error.message,true)); });
get('refresh').addEventListener('click',event => void busy(event.currentTarget,refresh));
get('logout').addEventListener('click',event => void busy(event.currentTarget,async () => {
  try { await request('logout',{method:'POST'}); }
  catch (error) { if (error.status !== 401) throw error; }
  showLogin();
}));
load().then(() => notice()).catch(error => {
  showLogin();
  notice(error.status === 401 ? '' : error.message,error.status !== 401);
});

setInterval(() => {
  if (!dashboard.hidden && document.visibilityState === 'visible') {
    void refresh().catch(() => {});
  }
},10000);

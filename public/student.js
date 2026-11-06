import {api, busy, button, digits, element, get, letters, notice, table} from './common.js';

const telegram = window.Telegram?.WebApp;
const screen = get('screen');
const request = (path, data) => api('student/' + path, {
  method:data === undefined ? 'GET' : 'POST', data,
  headers:{'X-Telegram-Init-Data':telegram.initData}
});

let scoreTimer;

function scorePanel() {
  const panel = element('section',undefined,'card');
  const content = element('div');
  async function refresh() {
    const {rows} = await request('scores');
    if (!panel.isConnected) return;
    content.replaceChildren(rows.length
      ? table(['رتبه','نام نمایشی','پاسخ درست'], rows.map(row => [
        digits(row.rank),element('bdi',row.name),digits(row.score)
      ]))
      : element('p','هنوز نتیجه‌ای ثبت نشده است.'));
  }
  panel.append(element('h2','جدول امتیاز کلاس'), button('تازه‌سازی جدول',refresh,'secondary'), content);
  void refresh().catch(error => notice(error.message,true));
  scoreTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && panel.isConnected) void refresh().catch(() => {});
  },10000);
  return panel;
}

function render(state) {
  get('title').textContent = state.title;
  get('context').textContent = state.classTitle;
  clearInterval(scoreTimer);
  screen.replaceChildren();
  const identity = element('p',undefined,'muted');
  identity.append('نام نمایشی در جدول کلاس: ',element('bdi',state.displayName));
  screen.append(identity);
  if (state.result) {
    const result = state.result;
    const panel = element('section',undefined,'card');
    panel.append(element('h2',digits(result.score) + ' پاسخ درست از ' + digits(result.total),'score'));
    const list = element('ul');
    for (const answer of result.answers) {
      const item = element('li','سؤال ' + digits(answer.number) + ' — ' +
        (answer.ok ? 'درست' : 'نادرست') + ' · انتخاب تو: ' +
        letters[answer.option] + ') ' + answer.label,answer.ok ? 'good' : 'error');
      list.append(item);
    }
    panel.append(list);
    screen.append(panel);
  } else if (!state.closed) {
    renderForm(state);
  } else {
    screen.append(element('p','آزمون پایان یافته است.','card'));
  }
  screen.append(scorePanel());
}

function renderForm(state) {
  screen.append(element('p',state.intro));
  const form = element('form');
  const nameLabel = element('label','نام نمایشی در جدول امتیاز');
  const nameInput = element('input');
  nameInput.type = 'text';
  nameInput.maxLength = 100;
  nameInput.required = true;
  nameInput.value = state.displayName;
  nameLabel.append(nameInput);
  form.append(nameLabel);
  const progress = element('p',undefined,'muted');
  progress.setAttribute('role','status');
  const fields = [];
  for (const question of state.questions) {
    const field = element('fieldset',undefined,'card');
    field.append(element('legend','سؤال ' + digits(question.number) + ' — ' + question.prompt));
    question.options.forEach((option,index) => {
      const label = element('label',undefined,'option');
      const radio = element('input');
      radio.type = 'radio';
      radio.name = 'question-' + question.number;
      radio.value = index;
      label.append(radio,element('span',letters[index] + ') ' + option));
      field.append(label);
    });
    fields.push({field, number:question.number});
    form.append(field);
  }
  const selected = () => fields.map(({field}) => field.querySelector(':checked'));
  function update() {
    const count = selected().filter(Boolean).length;
    progress.textContent = digits(count) + ' از ' + digits(fields.length) + ' پاسخ تکمیل شده';
    return count;
  }
  form.addEventListener('change',event => {
    event.target.closest('fieldset')?.classList.remove('error');
    if (update() === fields.length) notice();
  });
  const submit = element('button','ثبت نهایی');
  form.append(progress,submit);
  form.addEventListener('submit',event => {
    event.preventDefault();
    if (submit.disabled) return;
    const choices = selected();
    const missing = fields.filter(({field},index) => {
      field.classList.toggle('error',!choices[index]);
      return !choices[index];
    });
    if (missing.length) {
      notice('بی‌پاسخ: سؤال ' + missing.map(q => digits(q.number)).join('، '),true);
      missing[0].field.querySelector('input').focus();
      return;
    }
    const name = nameInput.value.trim();
    if (!name) { notice('نام نمایشی را وارد کن.',true); nameInput.focus(); return; }
    const answers = choices.map(input => Number(input.value));
    void busy(submit,async () => {
      fields.forEach(({field}) => { field.disabled = true; });
      nameInput.disabled = true;
      submit.textContent = 'در حال ثبت…';
      try {
        const {result} = await request('submit',{answers,name});
        render({...state,displayName:name,result});
      } catch (error) {
        if (error.status === 409 || error.status === 403) await load();
        else throw error;
      } finally {
        fields.forEach(({field}) => { field.disabled = false; });
        nameInput.disabled = false;
        submit.textContent = 'ثبت نهایی';
      }
    });
  });
  update();
  screen.append(form);
}

async function load() {
  const state = await request('state');
  notice();
  render(state);
}

if (!telegram?.initData) notice('آزمون را از لینک کلاس در تلگرام باز کن.',true);
else {
  telegram.ready();
  telegram.expand();
  load().catch(error => {
    notice(error.message,true);
    screen.append(button('تلاش دوباره',load,'secondary'));
  });
}

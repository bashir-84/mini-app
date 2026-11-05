export const get = id => document.getElementById(id);
export const digits = n => new Intl.NumberFormat('fa-IR', {useGrouping:false}).format(n);
export const letters = ['الف','ب','ج','د'];
export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function notice(text = '', error = false) {
  get('message').textContent = text;
  get('message').className = error ? 'error' : '';
}
export function button(label, callback, style) {
  const node = element('button',label,style);
  node.type = 'button';
  node.addEventListener('click', () => busy(node, callback));
  return node;
}
export async function busy(node, task) {
  node.disabled = true;
  notice();
  try { await task(); }
  catch (error) { notice(error.message, true); }
  finally { node.disabled = false; }
}
export async function api(path, {data, headers = {}, method = 'GET'} = {}) {
  let response;
  try {
    response = await fetch('/api/' + path, {method, headers: {
      ...(data === undefined ? {} : {'Content-Type':'application/json'}), ...headers
    }, body:data === undefined ? undefined : JSON.stringify(data), cache:'no-store'});
  } catch {
    throw new Error('ارتباط قطع شد. دوباره تلاش کن.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'دریافت اطلاعات ممکن نشد.');
    error.status = response.status;
    throw error;
  }
  return result;
}
export function table(headers, rows) {
  const wrapper = element('div',undefined,'table-wrap');
  const grid = element('table');
  const heading = grid.createTHead().insertRow();
  for (const title of headers) {
    const cell = element('th',title);
    cell.scope = 'col';
    heading.append(cell);
  }
  const body = grid.createTBody();
  for (const row of rows) {
    const line = body.insertRow();
    for (const value of row) {
      const cell = line.insertCell();
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value;
    }
  }
  wrapper.append(grid);
  return wrapper;
}

// 观点复盘 · 前端（纯静态，数据在 Supabase；页面结构和交互来自原型 v10）
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const CONFIGURED = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 40 && !SUPABASE_ANON_KEY.startsWith('__');
const sb = CONFIGURED ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

// ---------- 日期：全部按北京时间 ----------
const fmtSH = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const todayISO = () => fmtSH.format(new Date());
const shDate = ts => (ts ? fmtSH.format(new Date(ts)) : '');
const parseD = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const daysTo = d => Math.round((parseD(d) - parseD(todayISO())) / 86400000);
const addDays = (iso, n) => new Date(parseD(iso) + n * 86400000).toISOString().slice(0, 10);
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const weekday = iso => WEEK[new Date(parseD(iso)).getUTCDay()];

// ---------- 常量 ----------
const COLDEF = {
  num: { label: '#', sub: '状态', w: '46px', fixed: true },
  item: { label: '事项', sub: '判断对象', w: '1fr', fixed: true },
  claim: { label: '我的判断', sub: '可判对错的一句话', w: '2fr', fixed: true },
  signal: { label: '跟踪信号', sub: '看哪个数、从哪取', w: '1.3fr' },
  created: { label: '创建时间', sub: '立案日', w: '92px' },
  due: { label: '兑现时间', sub: '判定日', w: '112px' },
  actual: { label: '实际情况', sub: '到期后填', w: '1.3fr' },
  review: { label: '复盘', sub: '对错 · 错在哪', w: '1.4fr' },
};
const FIXED = 3; // # / 事项 / 我的判断 固定在前三列
const ERR_DEFAULT = ['口径错', '信源错', '拍数方向错', '漏变量', '时点早', '时点晚', '用结果解释结果', '只听一个信源', '外部冲击', '表述含糊'];
const OUTCOMES = ['对', '错', '部分对', '说不清'];
const defaultS = () => ({ cols: Object.keys(COLDEF), hidden: ['created'], sort: { key: 'due', dir: 1 }, errors: ERR_DEFAULT.slice(), name: '观点复盘' });

// ---------- 状态 ----------
let rows = [], logs = [], events = [], S = defaultS(), user = null;
let filter = 'all', tagF = null, q = '', expanded = new Set(), popOpen = false, menuOpen = null, confirmWd = null;
const $ = id => document.getElementById(id);
const main = $('main');

// ---------- 小工具 ----------
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const enc = s => encodeURIComponent(s);
function hl(s) { s = esc(s); if (!q) return s; const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); return s.replace(re, m => `<mark>${m}</mark>`); }
function toast(t, bad) { const e = document.createElement('div'); e.className = 'toast'; if (bad) e.style.background = 'var(--bad)'; e.textContent = t; document.body.appendChild(e); setTimeout(() => e.remove(), bad ? 3200 : 1800); }
function stateOf(r) { if (r.status === 'withdrawn') return 'withdrawn'; if (r.outcome || r.review) return 'done'; return daysTo(r.due) <= 0 ? 'due' : 'open'; }
function isLocked(r) { return Date.now() > new Date(r.locked_at).getTime(); }
function reached(r) { return stateOf(r) === 'done' || daysTo(r.due) <= 0; }
function isOk(r) { return r.outcome === '对'; }
function isBad(r) { return r.outcome === '错'; }
function matches(r) { if (!q) return true; const k = q.toLowerCase(); return [r.item, r.claim, r.signal, r.src, r.actual, r.review, r.reason, r.how, r.quote, r.kill, r.note, ...(r.tags || [])].some(v => (v || '').toLowerCase().includes(k)); }
const stRank = { due: 0, open: 1, done: 2, withdrawn: 3 };
function sortRows(list) {
  const k = S.sort.key, d = S.sort.dir;
  return list.slice().sort((a, b) => {
    let x, y;
    if (k === 'num') { x = stRank[stateOf(a)]; y = stRank[stateOf(b)]; if (x === y) { x = a.due; y = b.due; } }
    else if (k === 'due') { x = a.due; y = b.due; }
    else if (k === 'created') { x = a.created_at; y = b.created_at; }
    else if (k === 'review') { const rk = r => stateOf(r) === 'done' ? (isOk(r) ? 1 : isBad(r) ? 0 : 2) : 3; x = rk(a); y = rk(b); }
    else { x = (a[k] || ''); y = (b[k] || ''); }
    return (x < y ? -1 : x > y ? 1 : 0) * d;
  });
}
function friendly(error) {
  const m = String(error?.message || error || '');
  const k = m.match(/(LOCKED|NOT_DUE|NOT_ALLOWED|STATUS|FORBIDDEN|NO_JUDGMENT):\s*(.+)/);
  if (k) return k[2];
  if (/JWT|session|token|expired/i.test(m)) return '登录已过期，请重新登录';
  if (/row-level security/i.test(m)) return '没有权限（RLS 拒绝）';
  return '保存失败：' + m;
}

// ---------- 数据层 ----------
async function loadAll() {
  const [j, l, s, e] = await Promise.all([
    sb.from('judgments').select('*').order('id'),
    sb.from('confidence_log').select('*').order('id'),
    sb.from('settings').select('*').maybeSingle(),
    sb.from('events').select('*').order('date'),
  ]);
  for (const r of [j, l, s, e]) if (r.error) { toast(friendly(r.error), true); }
  rows = j.data || []; logs = l.data || []; events = e.data || [];
  if (s.data) {
    const d = s.data;
    S = { cols: d.columns, hidden: d.hidden, sort: d.sort, errors: d.errors, name: d.name };
  } else {
    S = defaultS();
    await sb.from('settings').insert({ user_id: user.id });
  }
  // 固定前三列
  S.cols = ['num', 'item', 'claim', ...S.cols.filter(k => !['num', 'item', 'claim'].includes(k))];
  for (const k of Object.keys(COLDEF)) if (!S.cols.includes(k)) S.cols.push(k);
  S.hidden = (S.hidden || []).filter(k => !['num', 'item', 'claim'].includes(k));
  if (!Array.isArray(S.errors) || !S.errors.length) S.errors = ERR_DEFAULT.slice();
}
async function loadLogs() { const { data } = await sb.from('confidence_log').select('*').order('id'); logs = data || []; }
async function dbUpdate(id, patch) {
  const { data, error } = await sb.from('judgments').update(patch).eq('id', id).select().single();
  if (error) { toast(friendly(error), true); return null; }
  const i = rows.findIndex(r => r.id === id); if (i >= 0) rows[i] = data;
  if ('p' in patch) await loadLogs();
  return data;
}
async function dbInsert(obj) {
  const { data, error } = await sb.from('judgments').insert(obj).select().single();
  if (error) { toast(friendly(error), true); return null; }
  rows.unshift(data);
  if (data.p != null) await loadLogs();
  return data;
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { error } = await sb.from('settings').upsert({ user_id: user.id, columns: S.cols, hidden: S.hidden, sort: S.sort, errors: S.errors, name: S.name });
    if (error) toast(friendly(error), true);
  }, 300);
}

// ---------- 账本页 ----------
function stateTag(r) {
  const st = stateOf(r);
  if (st === 'withdrawn') return '<span class="st wd">已撤回</span>';
  if (st === 'done') return isOk(r) ? '<span class="st ok">判对</span>' : isBad(r) ? '<span class="st bad">判错</span>' : `<span class="st">${esc(r.outcome || '已复盘')}</span>`;
  if (st === 'due') return '<span class="st due">到期</span>';
  return '<span class="st">进行中</span>';
}
function dueCell(r) {
  const n = daysTo(r.due); const st = stateOf(r); let s = '';
  if (st === 'done') s = '<small>已兑现</small>';
  else if (n <= 0) s = '<small class="warn">已到期，待填</small>';
  else if (n <= 30) s = `<small class="warn">还有 ${n} 天</small>`;
  else s = `<small>还有 ${n} 天</small>`;
  return `<span class="d cell${isLocked(r) ? ' locked' : ''}" onclick="editDate(this,${r.id})">${r.due}${s}</span>`;
}
function createdCell(r) { const c = shDate(r.created_at); const n = -daysTo(c); return `<span class="d">${c}<small>${n === 0 ? '今天' : n + ' 天前'}${isLocked(r) ? ' · 🔒' : ''}</small></span>`; }
function outcomeSeg(r) {
  return `<div class="seg">${OUTCOMES.map(o => `<button class="${r.outcome === o ? (o === '对' ? 'ok' : o === '错' ? 'bad' : 'mid') : ''}" onclick="setOutcome(${r.id},'${o}')">${o}</button>`).join('')}</div>`;
}
function cellHTML(key, r) {
  const lock = isLocked(r) ? ' locked' : ''; const open = reached(r);
  switch (key) {
    case 'num': return `<div class="c n" data-l="">#${r.id} ${stateTag(r)}<button class="dots" title="行操作" onclick="rowMenu(${r.id},event)">⋯</button>${menuOpen === r.id ? `<div class="menu" onclick="event.stopPropagation()">
      ${r.status === 'withdrawn' ? '' : (confirmWd === r.id ? `<span class="confirm">确定撤回？到期照样算分，并标「已撤回」 <button class="btn sm" onclick="withdraw(${r.id})">确定</button></span>` : `<button onclick="confirmWd=${r.id};go()">撤回这条判断</button>`)}
      <button onclick="supersede(${r.id})">新开一行替代（改口径）</button>
      <button onclick="dupRow(${r.id})">复制为新行</button>
    </div>` : ''}</div>`;
    case 'item': return `<div class="c" data-l="事项"><div class="cell item${lock}" data-ph="一句话说清判断对象" onclick="edit(this,${r.id},'item')">${hl(r.item)}</div><div class="sub2">${(r.tags || []).map(t => `<span class="tag" onclick="setTag('${enc(t)}')">${hl(t)}</span>`).join('')}${r.note ? `<span class="p lk">${esc(r.note)}</span>` : ''}</div></div>`;
    case 'claim': {
      const pb = r.type === '回看' ? '<span class="p lk">回看</span>' : `<span class="p${open ? ' lk' : ''}" style="cursor:pointer" title="把握：你立案时填的；兑现前可以追加新的" onclick="editP(${r.id},event)">${r.p != null ? '把握 ' + r.p + '%' : '填把握'}</span>`;
      return `<div class="c" data-l="我的判断"><div class="cell${lock}" data-ph="可判对错的一句话，带数字和日期" onclick="edit(this,${r.id},'claim')">${hl(r.claim)}</div><div class="sub2">${pb}${isLocked(r) ? '' : '<span class="p">24 小时内可改</span>'}<span class="more" onclick="tog(${r.id})">${expanded.has(r.id) ? '收起' : '理由 / 怎么判 / 出处'}</span></div></div>`;
    }
    case 'signal': return `<div class="c" data-l="跟踪信号"><div class="sig"><div class="cell${lock}" data-ph="看哪个数：指标 + 口径" onclick="edit(this,${r.id},'signal')">${hl(r.signal)}</div><span class="src cell" data-ph="从哪取：数据源" onclick="edit(this,${r.id},'src')">${hl(r.src)}</span></div></div>`;
    case 'created': return `<div class="c" data-l="创建时间">${createdCell(r)}</div>`;
    case 'due': return `<div class="c" data-l="兑现时间">${dueCell(r)}</div>`;
    case 'actual': return `<div class="c" data-l="实际情况">${open ? `<div class="cell" data-ph="到期后填实际数字和出处" onclick="edit(this,${r.id},'actual')">${hl(r.actual)}</div>` : `<div class="cell locked ph" data-ph="到兑现时间后开放"></div>`}</div>`;
    case 'review': return `<div class="c" data-l="复盘">${open ? `${outcomeSeg(r)}<div class="cell" data-ph="${r.type === '回看' ? '先点上面的判定，再写一句' : '错在哪一环、一句教训'}" onclick="edit(this,${r.id},'review')">${hl(r.review)}</div>` : `<div class="cell locked ph" data-ph="—"></div>`}</div>`;
  }
  return '';
}
function detailHTML(r, lock) {
  const plog = logs.filter(l => l.judgment_id === r.id);
  return `<div class="f">
    <div><div class="fl">理由</div><div class="fv"><div class="cell" data-ph="一句理由" onclick="edit(this,${r.id},'reason')">${hl(r.reason)}</div></div></div>
    <div><div class="fl">怎么判${lock ? ' 🔒' : ''}</div><div class="fv"><div class="cell${lock}" data-ph="边角情形怎么判；首次披露值还是重述值" onclick="edit(this,${r.id},'how')">${hl(r.how)}</div></div></div>
    <div><div class="fl">失效信号</div><div class="fv"><div class="cell" data-ph="看到什么说明我错了" onclick="edit(this,${r.id},'kill')">${hl(r.kill)}</div></div></div>
    <div><div class="fl">出处</div><div class="fv"><div class="cell" data-ph="报告 · 页码 / 纪要" onclick="edit(this,${r.id},'quote')">${hl(r.quote)}</div></div></div>
    <div><div class="fl">标签</div><div class="fv"><div class="cell" data-ph="逗号分隔" onclick="edit(this,${r.id},'tagsText')">${esc((r.tags || []).join('，'))}</div></div></div>
    <div><div class="fl">类型${lock ? ' 🔒' : ''}</div><div class="fv"><div class="cell locked" style="color:var(--fg-2)">${esc(r.type)}${lock ? '' : ` <button class="btn sm" onclick="setType(${r.id},'${r.type === '回看' ? '普通' : '回看'}')">改为${r.type === '回看' ? '普通' : '回看'}</button>`}</div></div></div>
    <div><div class="fl">把握记录</div><div class="fv"><div class="cell locked" style="color:var(--fg-2)">${plog.length ? plog.map(l => `${shDate(l.created_at)} ${l.p}%${l.note ? ' ' + esc(l.note) : ''}`).join('<br>') : (r.type === '回看' ? '回看类不填把握' : '还没填把握')}</div></div></div>
    ${r.supersedes_id ? `<div><div class="fl">替代</div><div class="fv"><div class="cell locked" style="color:var(--fg-2)">替代 #${r.supersedes_id}（旧行照样算）</div></div></div>` : ''}
    ${reached(r) ? `<div style="grid-column:1/-1"><div class="fl">错因（判错时选一个；表在复盘页维护，也可在此直接新增）</div><div class="errs">${S.errors.map(e => `<span class="echip ${r.err === e ? 'sel' : ''}" style="cursor:pointer" onclick="setErr(${r.id},'${enc(e)}')">${esc(e)}</span>`).join('')}<input placeholder="＋ 新错因，回车" onkeydown="if(event.key==='Enter'){event.preventDefault();addErr(this.value,${r.id});}"></div></div>` : ''}
    ${(r.revisions || []).length ? `<div style="grid-column:1/-1"><div class="fl">修订记录</div><div class="fv" style="font-size:11.5px;color:var(--fg-3)">${r.revisions.slice(-5).reverse().map(v => `${shDate(v.at)} 改了「${esc(v.field)}」，原来是：${esc(v.old || '（空）')}`).join('<br>')}</div></div>` : ''}
  </div>`;
}
function ledgerHTML() {
  const vis = S.cols.filter(k => !S.hidden.includes(k)); const tmpl = vis.map(k => COLDEF[k].w).join(' ');
  const xStart = Math.max(1, vis.indexOf('claim'));
  let list = rows.filter(r => { const st = stateOf(r); return filter === 'all' || (filter === 'open' && st === 'open') || (filter === 'due' && st === 'due') || (filter === 'done' && st === 'done'); }).filter(r => !tagF || (r.tags || []).includes(tagF)).filter(matches);
  list = sortRows(list);
  const tags = [...new Set(rows.flatMap(r => r.tags || []))].sort();
  const sortOpts = [['due', '兑现时间'], ['created', '创建时间'], ['num', '状态（到期优先）'], ['item', '事项'], ['review', '复盘结果']];
  const n = { due: 0, open: 0, done: 0, withdrawn: 0, ok: 0, bad: 0 };
  rows.forEach(r => { const st = stateOf(r); n[st]++; if (st === 'done') { if (isOk(r)) n.ok++; if (isBad(r)) n.bad++; } });
  return `<div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:8px"><h1 style="margin:0">账本</h1><span class="sum">共 <b>${rows.length}</b> · 进行中 <b>${n.open}</b> · 到期 <b>${n.due}</b> · 已复盘 <b>${n.done}</b>（对 ${n.ok} 错 ${n.bad}）· 撤回 <b>${n.withdrawn}</b>${q ? ` · 搜「${esc(q)}」命中 <b>${list.length}</b>` : ''}</span></div>
  <div class="tools">
    ${[['all', '全部'], ['due', '到期待填'], ['open', '进行中'], ['done', '已复盘']].map(([k, v]) => `<button class="chip ${filter === k ? 'on' : ''}" onclick="filter='${k}';go()">${v}</button>`).join('')}
    <span style="width:8px"></span>${tags.map(t => `<button class="chip tag ${tagF === t ? 'on' : ''}" onclick="setTag('${enc(t)}',true)">${esc(t)}</button>`).join('')}
    ${q ? `<button class="chip on" onclick="clearSearch()">搜「${esc(q)}」 ×</button>` : ''}
    <span class="spacer"></span>
    <select class="chip" onchange="S.sort={key:this.value,dir:S.sort.key===this.value?S.sort.dir:1};saveSettings();go()">${sortOpts.map(([k, v]) => `<option value="${k}" ${S.sort.key === k ? 'selected' : ''}>排序：${v}</option>`).join('')}</select>
    <button class="chip" onclick="S.sort.dir=-S.sort.dir;saveSettings();go()">${S.sort.dir > 0 ? '升序 ↑' : '降序 ↓'}</button>
    <button class="chip ${popOpen ? 'on' : ''}" onclick="popOpen=!popOpen;go()">列设置</button>
    ${popOpen ? `<div class="pop">${S.cols.map((k, i) => `<div class="rowc"><input type="checkbox" id="col-${k}" ${S.hidden.includes(k) ? '' : 'checked'} ${COLDEF[k].fixed ? 'disabled' : ''} onchange="toggleCol('${k}')"><label for="col-${k}">${COLDEF[k].label} <span style="color:var(--fg-3);font-size:11px">${COLDEF[k].sub}</span></label><button ${i <= FIXED ? 'disabled' : ''} onclick="moveCol(${i},-1)">▲</button><button ${(i < FIXED || i === S.cols.length - 1) ? 'disabled' : ''} onclick="moveCol(${i},1)">▼</button></div>`).join('')}<div class="note">前三列固定；其余勾选 = 显示，▲▼ = 调顺序。手机卡片同此顺序。</div></div>` : ''}
  </div>
  <div class="sheet">
    <div class="hdr" style="grid-template-columns:${tmpl}">${vis.map(k => `<div class="${S.sort.key === k ? 'sorted' : ''}" onclick="setSort('${k}')" title="点击排序">${COLDEF[k].label}${S.sort.key === k ? (S.sort.dir > 0 ? ' ↑' : ' ↓') : ''}<small>${COLDEF[k].sub}</small></div>`).join('')}</div>
    <div id="rows">${list.length ? list.map(r => { const lock = isLocked(r) ? ' locked' : ''; const st = stateOf(r); return `<div class="r ${st}${st === 'done' && isBad(r) ? ' wrong' : ''}" data-id="${r.id}" style="grid-template-columns:${tmpl}">${vis.map(k => cellHTML(k, r)).join('')}
      ${expanded.has(r.id) ? `${'<div class="xf"></div>'.repeat(xStart)}<div class="x" style="grid-column:${xStart + 1}/-1">${detailHTML(r, lock)}</div>` : ''}</div>`; }).join('') : `<div class="empty">${rows.length ? `没有匹配的行${q ? `：搜「${esc(q)}」` : ''}` : '还没有判断。点下面「新增一行」，或者去首页用「记一条判断」。'}</div>`}</div>
    <div class="add" onclick="addRow()">＋ 新增一行（事项 → 判断 → 跟踪信号 → 兑现时间，其余以后填）</div>
  </div>
  <div class="hint">「事项 / 判断 / 跟踪信号 / 兑现时间 / 怎么判」创建 24 小时后锁定（🔒），想改口径就用行菜单「新开一行替代」，旧行照样算。「实际情况 / 复盘」到兑现时间之后才开放。点表头可排序。</div>`;
}

// ---------- 首页 ----------
function homeHTML() {
  const ISO = todayISO();
  const pend = rows.filter(r => !['done', 'withdrawn'].includes(stateOf(r)));
  const due = pend.filter(r => daysTo(r.due) <= 0).sort((a, b) => a.due < b.due ? -1 : 1);
  const up = pend.filter(r => daysTo(r.due) > 0).sort((a, b) => a.due < b.due ? -1 : 1);
  const doneAll = rows.filter(r => stateOf(r) === 'done'); const ok = doneAll.filter(isOk).length, bad = doneAll.filter(isBad).length;
  const done = doneAll.slice().sort((a, b) => (b.resolved_on || '') < (a.resolved_on || '') ? -1 : 1).slice(0, 4);
  const WIN = 180; const x = d => Math.max(0, Math.min(100, daysTo(d) / WIN * 100));
  const ticks = []; const t0 = new Date(parseD(ISO));
  for (let m = 0; m < 7; m++) { const t = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() + m, 1)); const n = Math.round((t - t0) / 86400000); if (n >= 0 && n <= WIN) ticks.push({ x: n / WIN * 100, l: `${t.getUTCMonth() + 1}月` }); }
  const inWin = pend.filter(r => daysTo(r.due) <= WIN).sort((a, b) => a.due < b.due ? -1 : 1);
  const beyond = pend.length - inWin.length;
  const strip = inWin.map((r, i) => { const row = i % 3; const top = row * 20; const lx = Math.max(5, Math.min(95, x(r.due))); const d = daysTo(r.due); const cls = d <= 0 ? 'due' : (r.type === '回看' ? 'rv' : '');
    return `<div class="lbl" style="left:${lx}%;top:${top}px" title="${esc(r.claim)}" onclick="openRow(${r.id})">${esc(r.item || '（未填事项）')}</div><div class="stem" style="left:${lx}%;top:${top + 16}px;height:${104 - (top + 16) - 2}px"></div><div class="dot ${cls}" style="left:${x(r.due)}%" title="${r.due} ${esc(r.item)}" onclick="openRow(${r.id})"></div>`; }).join('');
  const grp = [['本周', 7], ['本月', 30], ['三个月内', 90], ['更远', 1e9]]; let last = 0;
  const agenda = grp.map(([g, lim]) => { const items = up.filter(r => { const d = daysTo(r.due); return d > last && d <= lim; }); const html = items.length ? `<div class="g">${g}</div>` + items.map(r => `<li onclick="openRow(${r.id})"><span class="d">${r.due.slice(5)}</span><span class="t">${esc(r.item || '（未填事项）')}<small>${esc((r.signal || '').split('；')[0])}</small></span><span class="days">${r.p != null ? r.p + '%' : (r.type === '回看' ? '回看' : '')} · ${daysTo(r.due)} 天</span></li>`).join('') : ''; last = lim; return html; }).join('');
  const lesson = doneAll.filter(isBad).sort((a, b) => (b.resolved_on || '') < (a.resolved_on || '') ? -1 : 1)[0];
  const nextEv = events.find(e => daysTo(e.date) > 0);
  const pct = doneAll.length ? Math.round(ok / doneAll.length * 100) : 0;
  return `<div class="mast"><div class="date">${ISO.replace(/-/g, ' · ')} · ${weekday(ISO)}</div><h1>${esc(S.name)}</h1>
    <p class="lead">在跟踪 <b>${pend.length}</b> 条判断，<b>${due.length}</b> 条到期待填。已复盘 <b>${doneAll.length}</b> 条，对 <b>${ok}</b> 错 <b>${bad}</b>。${nextEv ? `下一个开奖点是 <b>${nextEv.date.slice(5)}</b> ${esc(nextEv.name)}。` : ''}</p></div>
  <form class="capture" onsubmit="event.preventDefault();quickAdd()"><div class="cl">记一条判断</div><input id="qa-item" placeholder="事项：判断对象"><input id="qa-claim" placeholder="我的判断：可判对错的一句话，带数字和日期"><input id="qa-due" type="date" value="${addDays(ISO, 90)}" title="兑现时间"><button class="btn primary" type="submit">加进账本</button></form>
  <div class="strip">${ticks.map(t => `<div class="tick" style="left:${t.x}%"><span>${t.l}</span></div>`).join('')}<div class="today" style="left:0"><span>今天</span></div>${strip}</div>
  <div class="stripnote"><span>未来 180 天的兑现时间</span><span><i class="due"></i>已到期</span><span><i></i>待兑现</span><span><i class="rv"></i>回看类</span>${beyond ? `<span>另有 ${beyond} 条在 180 天之后</span>` : ''}</div>
  <div class="home">
    <div>
      <section><h2>到期待填 <a href="#ledger" onclick="filter='due'">在账本里填 →</a></h2>
        <div class="duelist">${due.map(r => `<div class="it"><div><div class="t">${esc(r.item || '（未填事项）')}<small>${esc(r.claim)}</small></div><div class="meta"><span>兑现 ${r.due}</span><span>${r.p != null ? '把握 ' + r.p + '%' : (r.type === '回看' ? '回看' : '')}</span></div></div><button class="btn sm" onclick="openRow(${r.id})">去填</button></div>`).join('') || '<div class="foot">没有到期的。</div>'}</div>
      </section>
      <section><h2>接下来兑现 <a href="#calendar">看日历 →</a></h2><ul class="agenda">${agenda || '<li class="foot">还没有待兑现的判断。</li>'}</ul></section>
    </div>
    <div>
      <section><h2>战绩 <a href="#review">复盘页 →</a></h2>
        <div class="score"><div><span class="big ok">${ok}</span><small>判对</small></div><div><span class="big bad">${bad}</span><small>判错</small></div><div><span class="big">${doneAll.length}<span style="font-size:13px;color:var(--fg-3)"> / ${rows.length}</span></span><small>已复盘 / 全部</small></div></div>
        <div class="stack"><i style="width:${rows.length ? ok / rows.length * 100 : 0}%;background:var(--ok)"></i><i style="width:${rows.length ? bad / rows.length * 100 : 0}%;background:var(--bad)"></i></div>
        <div class="foot">${pct ? `已复盘的里对了 ${pct}%。` : ''}平均 Brier 和校准图要攒到 10 / 30 条才显示。</div>
      </section>
      <section><h2>最近复盘</h2>${done.map(r => `<div class="rev"><div class="h"><span class="verdict ${isOk(r) ? 'ok' : isBad(r) ? 'bad' : ''}">${esc(r.outcome || '已复盘')}</span><span class="t">${esc(r.item)}</span><span class="q">${r.resolved_on || ''}</span></div><p>${esc(r.review)}</p></div>`).join('') || '<div class="foot">还没有复盘过的判断。</div>'}</section>
      ${lesson ? `<section><h2>上一条教训</h2><div class="lessonq"><b>${esc((lesson.tags || [])[0] || '')} · ${esc(lesson.err || '判错')}</b>${esc(lesson.review)}</div></section>` : ''}
    </div>
  </div>`;
}

// ---------- 日历 ----------
function calendarHTML() {
  const list = rows.filter(r => stateOf(r) !== 'withdrawn').slice().sort((a, b) => a.due < b.due ? -1 : 1);
  const months = {};
  list.forEach(r => { const m = r.due.slice(0, 7); (months[m] = months[m] || []).push(r); });
  const fixed = {}; events.forEach(e => { const m = e.date.slice(0, 7); (fixed[m] = fixed[m] || []).push(e); });
  const keys = Object.keys(Object.assign({}, months, fixed)).sort();
  return `<h1>开奖日历</h1><p class="sub">按月看哪些判断要兑现、哪些事件要盯。事件是你手工加的（财报季、政策生效日）。</p>
  <form class="evform" onsubmit="event.preventDefault();addEvent()"><input id="ev-date" type="date" value="${todayISO()}"><input id="ev-name" placeholder="事件，例：北美云厂三季报 · 关联 #5 #8"><button class="btn primary" type="submit">加事件</button></form>
  <div class="cal">${keys.length ? keys.map(m => `<div class="m">${m.slice(0, 4)} 年 ${+m.slice(5)} 月</div>
    ${(fixed[m] || []).map(e => `<div class="ev ${daysTo(e.date) < 0 ? 'past' : ''}"><span class="d">${e.date.slice(5)}</span><div><b>${esc(e.name)}</b>${e.note ? `<div class="s">${esc(e.note)}</div>` : ''}</div><span><span class="st">事件</span> <button class="del" title="删除事件" onclick="delEvent(${e.id})">×</button></span></div>`).join('')}
    ${(months[m] || []).map(r => `<div class="ev ${stateOf(r) === 'done' ? 'past' : ''}" onclick="openRow(${r.id})"><span class="d">${r.due.slice(5)}</span><div><b>${esc(r.item || '（未填事项）')}</b><div class="s">${esc(r.claim)}</div></div>${stateTag(r)}</div>`).join('')}`).join('') : '<div class="empty">还没有兑现时间和事件。</div>'}</div>`;
}

// ---------- 复盘 ----------
function reviewHTML() {
  const done = rows.filter(r => stateOf(r) === 'done'); const ok = done.filter(isOk).length, bad = done.filter(isBad).length;
  const lessons = done.filter(isBad).sort((a, b) => (b.resolved_on || '') < (a.resolved_on || '') ? -1 : 1);
  const mentor = rows.filter(r => (r.tags || []).includes('带教'));
  const cnt = {}; S.errors.forEach(e => cnt[e] = 0); rows.filter(r => r.err).forEach(r => { cnt[r.err] = (cnt[r.err] || 0) + 1; });
  const mx = Math.max(1, ...Object.values(cnt));
  const scale = Math.max(1, done.length);
  return `<h1>复盘</h1><p class="sub">主产出是"错在哪一环"，分数是副产品。这里的内容都从账本里汇总，不用另填。</p>
  <div class="grid">
    <div class="box"><h3>战绩</h3>
      <div class="bar"><span style="width:64px">已复盘</span><i class="t" style="width:${done.length / scale * 45}%"></i><span class="d">${done.length}</span></div>
      <div class="bar"><span style="width:64px">判对</span><i class="t" style="width:${ok / scale * 45}%;background:var(--ok)"></i><span class="d">${ok}</span></div>
      <div class="bar"><span style="width:64px">判错</span><i class="t" style="width:${bad / scale * 45}%;background:var(--bad)"></i><span class="d">${bad}</span></div>
      <div class="bar"><span style="width:64px">其他</span><i class="t" style="width:${(done.length - ok - bad) / scale * 45}%;background:var(--warn)"></i><span class="d">${done.length - ok - bad}</span></div>
      <div class="ph2">平均 Brier 要 ≥ 10 条、校准图要 ≥ 30 条才出现（现在 ${done.length}）。</div>
    </div>
    <div class="box"><h3>错因分布</h3>
      ${Object.keys(cnt).filter(e => cnt[e] > 0).sort((a, b) => cnt[b] - cnt[a]).map(e => `<div class="bar"><span style="width:110px">${esc(e)}</span><i class="t" style="width:${cnt[e] / mx * 45}%"></i>${cnt[e]}</div>`).join('') || '<div class="ph2">还没有标过错因的记录</div>'}
    </div>
  </div>
  <h2>错因表（点名字改，× 删除，回车新增；账本里判错时从这里选）</h2>
  <div class="errs">${S.errors.map((e, i) => `<span class="echip"><span class="cell" onclick="renameErr(${i},this)">${esc(e)}</span><button title="删除" onclick="delErr(${i})">×</button></span>`).join('')}<input placeholder="＋ 新增错因，回车" onkeydown="if(event.key==='Enter'){event.preventDefault();addErr(this.value);}"></div>
  <div class="hint">删掉某个错因不会改动已经用它标过的行；改名会一起改。</div>
  <h2>教训库（判错时写的复盘，按时间倒序）</h2>
  ${lessons.map(r => `<div class="lesson" onclick="openRow(${r.id})" style="cursor:pointer"><div class="h">${(r.tags || []).slice(0, 2).map(t => `<span class="tag">${esc(t)}</span>`).join('')}<span class="st bad">${esc(r.err || '判错')}</span><span class="d" style="font-size:11px;color:var(--fg-3)">#${r.id} · ${r.resolved_on || ''}</span></div><b>${esc(r.item)}</b>：${esc(r.review)}</div>`).join('') || '<div class="empty">还没有判错的记录</div>'}
  <h2>带教反馈（标签含「带教」的行）</h2>
  ${mentor.map(r => `<div class="lesson" onclick="openRow(${r.id})" style="cursor:pointer"><div class="h">${(r.tags || []).filter(t => t !== '带教').slice(0, 2).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${r.err ? `<span class="st bad">${esc(r.err)}</span>` : ''}<span class="d" style="font-size:11px;color:var(--fg-3)">#${r.id} · ${shDate(r.created_at)}</span></div><b>${esc(r.item)}</b>：${esc(r.claim)}${r.review ? ' → ' + esc(r.review) : ''}</div>`).join('') || '<div class="hint">把带教的纠错记成一行，标签加「带教」，就会汇总到这里。</div>'}`;
}

// ---------- 设置 ----------
function settingsHTML() {
  const bytes = new Blob([JSON.stringify({ rows, logs, events })]).size;
  return `<h1>设置</h1>
  <h2>账号</h2><div class="box">${esc(user?.email || '')} <button class="btn sm" style="margin-left:10px" onclick="logout()">退出登录</button>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;align-items:end;margin-top:12px;max-width:620px"><div class="field" style="margin:0"><label for="np1">新密码（至少 10 位）</label><input id="np1" type="password" autocomplete="new-password"></div><div class="field" style="margin:0"><label for="np2">再输一次</label><input id="np2" type="password" autocomplete="new-password"></div><button class="btn" onclick="changePass()">修改密码</button></div></div>
  <h2>网站名字</h2><div class="field" style="max-width:320px"><input value="${esc(S.name)}" onchange="S.name=this.value.trim()||'观点复盘';saveSettings();go()"></div>
  <h2>账本规则</h2><div class="box">
    <ul style="padding-left:18px;margin:0"><li>「事项 / 判断 / 跟踪信号 / 兑现时间 / 怎么判」创建 24 小时后锁定，数据库层面改不动；想改口径用「新开一行替代」。</li><li>「实际情况 / 复盘 / 判定 / 错因」到兑现时间之后才能写。</li><li>把握只能在兑现前追加，每次改动都有记录。</li><li>没有删除，只有撤回；撤回的照样算分。</li></ul>
    <div style="margin-top:10px"><button class="chip" onclick="S.cols=Object.keys(COLDEF);S.hidden=['created'];S.sort={key:'due',dir:1};saveSettings();go();toast('列设置已重置')">重置列设置</button></div>
  </div>
  <h2>导出</h2><div class="box">按当前列设置导出整张表，或导出全部数据。<div style="margin-top:8px"><button class="btn sm" onclick="exportMd(false)">下载 Markdown 表</button> <button class="btn sm" onclick="exportMd(true)">复制 Markdown</button> <button class="btn sm" onclick="exportJson()">下载 JSON（全部表）</button></div></div>
  <h2>容量</h2><div class="box">
    <div class="bar"><span style="width:110px">判断</span><span class="d">${rows.length} 行 · 把握记录 ${logs.length} 条 · 事件 ${events.length} 条</span></div>
    <div class="bar"><span style="width:110px">数据量</span><i class="t" style="width:${Math.max(0.5, Math.min(45, bytes / 500e6 * 45))}%"></i><span class="d">${(bytes / 1024).toFixed(0)} KB / 500 MB</span></div>
    <div class="ph2">免费额度（2026-10-08 官网核对）：Supabase 数据库 500 MB，连续 1 周不用会暂停（每日备份会访问一次，不会撞）；备份仓库建议 1 GB 以内；Actions 每月 2,000 分钟，备份每天约 1 分钟。按每年约 300 行估，十年用不到 1%。</div>
  </div>`;
}

// ---------- 路由 ----------
function go() {
  if (!user) return;
  const p = (location.hash || '#home').slice(1);
  $('brand').textContent = S.name; document.title = S.name;
  main.innerHTML = ({ home: homeHTML, ledger: ledgerHTML, calendar: calendarHTML, review: reviewHTML, settings: settingsHTML })[p]?.() || homeHTML();
  document.querySelectorAll('.nav a.t,.tabbar a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + p));
}
window.addEventListener('hashchange', () => { popOpen = false; menuOpen = null; confirmWd = null; go(); window.scrollTo(0, 0); });
document.addEventListener('click', () => { if (menuOpen !== null) { menuOpen = null; confirmWd = null; go(); } });
function measureNav() { const n = document.querySelector('.nav'); if (n) document.documentElement.style.setProperty('--navh', n.offsetHeight + 'px'); }
window.addEventListener('resize', measureNav); measureNav();
$('q').addEventListener('input', e => { q = e.target.value.trim(); if (location.hash !== '#ledger') location.hash = '#ledger'; else go(); });

// ---------- 动作 ----------
function clearSearch() { q = ''; $('q').value = ''; go(); }
function setTag(encoded, toggle) { const t = decodeURIComponent(encoded); tagF = (toggle && tagF === t) ? null : t; if (location.hash !== '#ledger') location.hash = '#ledger'; else go(); }
function setSort(k) { if (S.sort.key === k) S.sort.dir = -S.sort.dir; else S.sort = { key: k, dir: 1 }; saveSettings(); go(); }
function toggleCol(k) { const i = S.hidden.indexOf(k); i >= 0 ? S.hidden.splice(i, 1) : S.hidden.push(k); saveSettings(); go(); }
function moveCol(i, d) { const j = i + d; if (i < FIXED || j < FIXED || j >= S.cols.length) return; [S.cols[i], S.cols[j]] = [S.cols[j], S.cols[i]]; saveSettings(); go(); }
function tog(id) { expanded.has(id) ? expanded.delete(id) : expanded.add(id); go(); }
function openRow(id) {
  filter = 'all'; tagF = null; q = ''; $('q').value = ''; expanded.add(id);
  if (location.hash === '#ledger') go(); else location.hash = '#ledger';
  setTimeout(() => { const el = document.querySelector(`#rows .r[data-id="${id}"]`); el && el.scrollIntoView({ block: 'center' }); }, 60);
}
function rowMenu(id, ev) { ev.stopPropagation(); confirmWd = null; menuOpen = menuOpen === id ? null : id; go(); }
function edit(el, id, field) {
  const r = rows.find(x => x.id === id);
  if (el.classList.contains('locked')) { toast(['actual', 'review'].includes(field) ? '到兑现时间后才开放' : '已锁定。想改口径：行菜单里「新开一行替代」'); return; }
  if (el.querySelector('textarea')) return;
  const ta = document.createElement('textarea'); ta.value = field === 'tagsText' ? (r.tags || []).join('，') : (r[field] || ''); el.textContent = ''; el.appendChild(ta);
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }; fit(); ta.focus(); ta.addEventListener('input', fit);
  let done = false;
  const commit = async () => {
    if (done) return; done = true;
    const v = ta.value.trim();
    let patch;
    if (field === 'tagsText') { const tags = v.split(/[,，\s]+/).filter(Boolean); patch = { tags: tags.length ? tags : ['未分类'] }; if (JSON.stringify(patch.tags) === JSON.stringify(r.tags)) { go(); return; } }
    else { if (v === (r[field] || '')) { go(); return; } patch = { [field]: v }; }
    el.classList.add('busy');
    const ok = await dbUpdate(id, patch);
    go(); if (ok) toast('已保存');
  };
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); } if (e.key === 'Escape') { done = true; go(); } });
}
function editDate(el, id) {
  const r = rows.find(x => x.id === id);
  if (el.classList.contains('locked')) { toast('兑现时间已锁定；想改口径用「新开一行替代」'); return; }
  if (el.querySelector('input')) return;
  const i = document.createElement('input'); i.type = 'date'; i.value = r.due; el.textContent = ''; el.appendChild(i); i.focus();
  i.addEventListener('blur', async () => { if (i.value && i.value !== r.due) { await dbUpdate(id, { due: i.value }); } go(); });
}
function editP(id, ev) {
  ev.stopPropagation(); const r = rows.find(x => x.id === id);
  if (reached(r)) { toast('兑现时间已到，不能再改把握'); return; }
  const host = ev.currentTarget; if (host.querySelector('input')) return;
  const i = document.createElement('input'); i.type = 'number'; i.min = 5; i.max = 95; i.step = 5; i.value = r.p ?? 75; i.style.width = '56px'; host.textContent = ''; host.appendChild(i); i.focus();
  i.addEventListener('blur', async () => { const v = parseInt(i.value); if (!isNaN(v) && v !== r.p) await dbUpdate(id, { p: Math.max(5, Math.min(95, Math.round(v / 5) * 5)) }); go(); });
  i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); });
}
async function setOutcome(id, v) { const r = rows.find(x => x.id === id); await dbUpdate(id, { outcome: r.outcome === v ? null : v }); go(); }
async function setErr(id, encoded) { const e = decodeURIComponent(encoded); const r = rows.find(x => x.id === id); await dbUpdate(id, { err: r.err === e ? null : e }); go(); }
async function addErr(v, id) { v = (v || '').trim(); if (!v) return; if (!S.errors.includes(v)) { S.errors.push(v); saveSettings(); } if (id != null) await dbUpdate(id, { err: v }); go(); toast('已加入错因表：' + v); }
function delErr(i) { const e = S.errors[i]; S.errors.splice(i, 1); saveSettings(); go(); toast('已从错因表删除：' + e); }
function renameErr(i, el) {
  if (el.querySelector('input')) return; const old = S.errors[i];
  const inp = document.createElement('input'); inp.value = old; inp.style.cssText = 'border:0;border-bottom:1px solid var(--accent);background:transparent;font:inherit;width:' + Math.max(60, old.length * 14) + 'px;outline:0';
  el.textContent = ''; el.appendChild(inp); inp.focus(); inp.select();
  const done = async () => { const v = inp.value.trim(); if (v && v !== old) { S.errors[i] = v; saveSettings(); for (const r of rows.filter(r => r.err === old)) await dbUpdate(r.id, { err: v }); } go(); };
  inp.addEventListener('blur', done); inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
}
async function setType(id, t) { await dbUpdate(id, { type: t, ...(t === '回看' ? { p: null } : {}) }); go(); }
async function withdraw(id) { menuOpen = null; confirmWd = null; await dbUpdate(id, { status: 'withdrawn' }); go(); toast('已撤回，到期照样算分'); }
async function supersede(id) {
  const o = rows.find(r => r.id === id); menuOpen = null;
  const n = await dbInsert({ item: o.item, claim: '', due: o.due, signal: o.signal, src: o.src, tags: o.tags, reason: o.reason, quote: o.quote, kill: o.kill, type: o.type, supersedes_id: o.id, note: '替代 #' + o.id });
  if (n) { S.sort = { key: 'created', dir: -1 }; saveSettings(); expanded.add(n.id); go(); toast('已新开一行，注明替代 #' + id + '；旧行照样算'); }
}
async function dupRow(id) {
  const o = rows.find(r => r.id === id); menuOpen = null;
  const n = await dbInsert({ item: o.item, claim: o.claim, due: o.due, signal: o.signal, src: o.src, tags: o.tags, type: o.type });
  if (n) { S.sort = { key: 'created', dir: -1 }; saveSettings(); go(); }
}
async function addRow() {
  const n = await dbInsert({ item: '', claim: '', due: addDays(todayISO(), 30), tags: ['未分类'] });
  if (!n) return; S.sort = { key: 'created', dir: -1 }; saveSettings(); filter = 'all'; tagF = null; go();
  toast('新行的兑现时间先按 30 天后，24 小时内记得改');
  setTimeout(() => { const first = document.querySelector(`#rows .r[data-id="${n.id}"] .item`); first && first.click(); }, 0);
}
async function quickAdd() {
  const item = $('qa-item').value.trim(), claim = $('qa-claim').value.trim(), due = $('qa-due').value;
  if (!item || !claim || !due) { toast('事项、判断、兑现时间都要填'); return; }
  const n = await dbInsert({ item, claim, due, tags: ['未分类'] });
  if (n) { S.sort = { key: 'created', dir: -1 }; saveSettings(); toast('已加进账本'); openRow(n.id); }
}
async function addEvent() {
  const date = $('ev-date').value, name = $('ev-name').value.trim(); if (!date || !name) { toast('日期和事件都要填'); return; }
  const { data, error } = await sb.from('events').insert({ date, name }).select().single();
  if (error) { toast(friendly(error), true); return; }
  events.push(data); events.sort((a, b) => a.date < b.date ? -1 : 1); go();
}
async function delEvent(id) { const { error } = await sb.from('events').delete().eq('id', id); if (error) { toast(friendly(error), true); return; } events = events.filter(e => e.id !== id); go(); }
async function logout() { await sb.auth.signOut(); location.reload(); }

// ---------- 导出 ----------
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function mdCell(s) { return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' '); }
function exportMd(copy) {
  const vis = S.cols.filter(k => !S.hidden.includes(k));
  const head = vis.map(k => COLDEF[k].label);
  const val = (k, r) => ({ num: `#${r.id} ${stateOf(r) === 'done' ? (r.outcome || '已复盘') : stateOf(r) === 'due' ? '到期' : stateOf(r) === 'withdrawn' ? '已撤回' : '进行中'}`, item: r.item, claim: r.claim + (r.p != null ? `（把握 ${r.p}%）` : ''), signal: [r.signal, r.src].filter(Boolean).join(' · '), created: shDate(r.created_at), due: r.due, actual: r.actual, review: [r.outcome, r.err, r.review].filter(Boolean).join(' · ') })[k];
  const lines = ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |', ...sortRows(rows).map(r => '| ' + vis.map(k => mdCell(val(k, r))).join(' | ') + ' |')];
  const md = `# ${S.name} · ${todayISO()}\n\n` + lines.join('\n') + '\n';
  if (copy) { navigator.clipboard?.writeText(md).then(() => toast('已复制 Markdown 表'), () => download(`${S.name}-${todayISO()}.md`, md, 'text/markdown')); }
  else download(`${S.name}-${todayISO()}.md`, md, 'text/markdown');
}
function exportJson() { download(`${S.name}-${todayISO()}.json`, JSON.stringify({ exported_at: new Date().toISOString(), judgments: rows, confidence_log: logs, events, settings: S }, null, 1), 'application/json'); }

// ---------- 登录（邮箱 + 密码；免费版不能改验证码邮件模板，所以不用验证码）----------
function loginMsg(t, bad) { const m = $('login-msg'); m.textContent = t || ''; m.classList.toggle('bad', !!bad); }
function showLogin() {
  $('login').hidden = false; main.innerHTML = '';
  if (!CONFIGURED) {
    ['login-go', 'login-signup', 'login-reset'].forEach(id => { $(id).disabled = true; });
    loginMsg('还没有配置数据库。', true);
    const s = $('login-setup'); s.hidden = false; s.textContent = '把 Supabase 项目的 URL 和 anon key 填进 config.js 后再打开这个页面。';
  }
}
function creds() { const email = $('login-email').value.trim(), password = $('login-pass').value; if (!email) { loginMsg('先填邮箱', true); return null; } return { email, password }; }
function busyLogin(on) { ['login-go', 'login-signup', 'login-reset'].forEach(id => { $(id).disabled = on; }); }
async function signIn() {
  const c = creds(); if (!c) return; if (!c.password) { loginMsg('先填密码', true); return; }
  busyLogin(true); loginMsg('正在登录…');
  const { error } = await sb.auth.signInWithPassword(c);
  busyLogin(false);
  if (error) { loginMsg(/invalid login/i.test(error.message) ? '邮箱或密码不对' : /email not confirmed/i.test(error.message) ? '邮箱还没确认：去邮箱点确认链接，再回来登录' : '登录失败：' + error.message, true); return; }
  loginMsg('');
}
async function signUp() {
  const c = creds(); if (!c) return; if (c.password.length < 10) { loginMsg('密码至少 10 位', true); return; }
  busyLogin(true); loginMsg('正在注册…');
  const { data, error } = await sb.auth.signUp({ email: c.email, password: c.password, options: { emailRedirectTo: location.origin + location.pathname } });
  busyLogin(false);
  if (error) { loginMsg(/signups? not allowed|disabled/i.test(error.message) ? '注册已关闭（这个账本只给一个人用）' : '注册失败：' + error.message, true); return; }
  if (data.session) { loginMsg(''); return; }   // 已自动确认
  loginMsg('确认邮件已发到 ' + c.email + '。点邮件里的链接确认后，回到这里用密码登录。（已有账号的话这封邮件不会再发，直接登录即可）');
}
async function resetPass() {
  const c = creds(); if (!c) return;
  busyLogin(true); loginMsg('正在发送…');
  const { error } = await sb.auth.resetPasswordForEmail(c.email, { redirectTo: location.origin + location.pathname });
  busyLogin(false);
  if (error) { loginMsg('发送失败：' + error.message, true); return; }
  loginMsg('重设密码的邮件已发到 ' + c.email + '。点链接回到网站后，在「设置」里改密码。');
}
async function changePass() {
  const p1 = $('np1').value, p2 = $('np2').value;
  if (p1.length < 10) { toast('密码至少 10 位', true); return; }
  if (p1 !== p2) { toast('两次输入不一样', true); return; }
  const { error } = await sb.auth.updateUser({ password: p1 });
  if (error) { toast('改密码失败：' + error.message, true); return; }
  $('np1').value = ''; $('np2').value = ''; toast('密码已修改');
}
let recovering = false;
async function boot(session) {
  user = session?.user || null;
  if (!user) { showLogin(); return; }
  $('login').hidden = true; main.innerHTML = '<div class="empty">正在读取…</div>';
  try { await loadAll(); } catch (e) { main.innerHTML = `<div class="empty">读取失败：${esc(e.message)}</div>`; return; }
  if (recovering) { recovering = false; location.hash = '#settings'; toast('请在这里设一个新密码'); }
  go();
}
if (CONFIGURED) {
  $('login-go').onclick = signIn; $('login-signup').onclick = signUp; $('login-reset').onclick = resetPass;
  $('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); });
  $('login-email').addEventListener('keydown', e => { if (e.key === 'Enter') $('login-pass').focus(); });
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'PASSWORD_RECOVERY') { recovering = true; }
    if ((ev === 'SIGNED_IN' || ev === 'PASSWORD_RECOVERY' || ev === 'INITIAL_SESSION') && session && !user) boot(session);
    if (ev === 'INITIAL_SESSION' && !session) showLogin();
    if (ev === 'SIGNED_OUT') { user = null; showLogin(); }
  });
} else showLogin();

// 页面里的 onclick 是内联字符串，需要这些名字挂在 window 上；可变状态用 getter/setter 透传到模块变量
Object.assign(window, { changePass, go, edit, editDate, editP, setOutcome, setErr, addErr, delErr, renameErr, setType, withdraw, supersede, dupRow, addRow, quickAdd, addEvent, delEvent, logout, exportMd, exportJson, clearSearch, setTag, setSort, toggleCol, moveCol, tog, openRow, rowMenu, saveSettings, toast, COLDEF });
Object.defineProperties(window, {
  S: { get: () => S, set: v => { S = v; } },
  filter: { get: () => filter, set: v => { filter = v; } },
  popOpen: { get: () => popOpen, set: v => { popOpen = v; } },
  confirmWd: { get: () => confirmWd, set: v => { confirmWd = v; } },
});

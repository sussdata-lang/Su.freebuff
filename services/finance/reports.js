// التقارير المالية: ميزان المراجعة، دفتر الأستاذ، قائمة الدخل، الميزانية، دفتر الصندوق، كشف الطرف، مراكز الكلفة.
import { ready, rawBalances, fromMinor, DEBIT_NATURE, TYPE_LABEL, bad, isDay, today, sysAccount } from './core.js';

const accounts = (db) => { ready(db); return db.prepare('SELECT * FROM fin_accounts ORDER BY code').all(); };
const range = (q) => {
  const from = q.from && isDay(q.from) ? q.from : null, to = q.to && isDay(q.to) ? q.to : null;
  if (q.from && !from) throw bad('تاريخ البداية غير صالح.'); if (q.to && !to) throw bad('تاريخ النهاية غير صالح.');
  return { from, to };
};
// يجمّع أرصدة الأوراق إلى الآباء
function rollup(accs, bal) {
  const sums = new Map(accs.map((a) => [a.id, { d: 0, c: 0 }])), byId = new Map(accs.map((a) => [a.id, a]));
  for (const [id, v] of bal) { let a = byId.get(id); while (a) { const s = sums.get(a.id); s.d += v.d; s.c += v.c; a = a.parent_id ? byId.get(a.parent_id) : null; } }
  return sums;
}
const net = (a, s) => (DEBIT_NATURE.has(a.type) ? s.d - s.c : s.c - s.d);

export function trialBalance({ db }, q = {}) {
  const { from, to } = range(q), accs = accounts(db);
  const open = from ? rawBalances(db, { before: from }) : new Map(), mov = rawBalances(db, { from, to });
  const so = rollup(accs, open), sm = rollup(accs, mov);
  const rows = []; let t = { od: 0, oc: 0, md: 0, mc: 0, cd: 0, cc: 0 };
  for (const a of accs) {
    const o = so.get(a.id), m = sm.get(a.id);
    if (!o.d && !o.c && !m.d && !m.c && !q.all) continue;
    const ob = o.d - o.c, cb = ob + m.d - m.c;
    const r = { id: a.id, code: a.code, name: a.name, type: a.type, postable: !!a.postable, parentId: a.parent_id,
      openDebit: fromMinor(ob > 0 ? ob : 0), openCredit: fromMinor(ob < 0 ? -ob : 0), debit: fromMinor(m.d), credit: fromMinor(m.c), closeDebit: fromMinor(cb > 0 ? cb : 0), closeCredit: fromMinor(cb < 0 ? -cb : 0) };
    rows.push(r);
    if (a.postable) { t.od += ob > 0 ? ob : 0; t.oc += ob < 0 ? -ob : 0; t.md += m.d; t.mc += m.c; t.cd += cb > 0 ? cb : 0; t.cc += cb < 0 ? -cb : 0; }
  }
  return { from, to, rows, totals: { openDebit: fromMinor(t.od), openCredit: fromMinor(t.oc), debit: fromMinor(t.md), credit: fromMinor(t.mc), closeDebit: fromMinor(t.cd), closeCredit: fromMinor(t.cc) }, balanced: t.cd === t.cc && t.md === t.mc };
}

// كشف حساب مع رصيد جارٍ — يشمل الأبناء إن كان الحساب تجميعياً
export function ledger({ db }, q = {}) {
  ready(db);
  const acc = db.prepare('SELECT * FROM fin_accounts WHERE id = ?').get(Number(q.account));
  if (!acc) throw bad('اختر حساباً.');
  const { from, to } = range(q);
  const ids = [acc.id]; for (let i = 0; i < ids.length; i++) for (const c of db.prepare('SELECT id FROM fin_accounts WHERE parent_id = ?').all(ids[i])) ids.push(c.id);
  const ph = ids.map(() => '?').join(',');
  const w = [`l.account_id IN (${ph})`, "e.status = 'posted'"], a = [...ids];
  if (q.party) { w.push('l.party_id = ?'); a.push(Number(q.party)); }
  if (q.costCenter) { w.push('l.cost_center_id = ?'); a.push(Number(q.costCenter)); }
  if (q.student) { w.push('l.student_id = ?'); a.push(Number(q.student)); }
  const sign = DEBIT_NATURE.has(acc.type) ? 1 : -1;
  let running = 0;
  if (from) { const o = db.prepare(`SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id WHERE ${w.join(' AND ')} AND e.entry_day < ?`).get(...a, from); running = sign * (o.d - o.c); }
  const opening = running, w2 = [...w], a2 = [...a];
  if (from) { w2.push('e.entry_day >= ?'); a2.push(from); } if (to) { w2.push('e.entry_day <= ?'); a2.push(to); }
  const rows = db.prepare(`SELECT l.*, e.no, e.entry_day, e.description, e.type, e.id eid, ac.code, ac.name aname, p.name pname FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id JOIN fin_accounts ac ON ac.id = l.account_id LEFT JOIN fin_parties p ON p.id = l.party_id WHERE ${w2.join(' AND ')} ORDER BY e.entry_day, e.id, l.line_no`).all(...a2);
  let td = 0, tc = 0;
  const lines = rows.map((r) => { running += sign * (r.debit - r.credit); td += r.debit; tc += r.credit; return { entryId: r.eid, no: r.no, day: r.entry_day, type: r.type, description: r.note ? `${r.description} — ${r.note}` : r.description, account: ids.length > 1 ? `${r.code} ${r.aname}` : undefined, party: r.pname, debit: fromMinor(r.debit), credit: fromMinor(r.credit), balance: fromMinor(running) }; });
  return { account: { id: acc.id, code: acc.code, name: acc.name, type: acc.type, nature: sign === 1 ? 'مدين' : 'دائن' }, from, to, opening: fromMinor(opening), lines, totals: { debit: fromMinor(td), credit: fromMinor(tc) }, closing: fromMinor(running) };
}

function section(accs, sm, types) {
  const rows = [];
  let total = 0;
  for (const a of accs) if (types.includes(a.type) && a.postable) { const s = sm.get(a.id); const v = net(a, s); if (!s.d && !s.c) continue; rows.push({ id: a.id, code: a.code, name: a.name, amount: fromMinor(v), type: a.type }); total += v; }
  return { rows, total };
}
export function incomeStatement({ db }, q = {}) {
  const { from, to } = range(q), accs = accounts(db), sm = rollup(accs, rawBalances(db, { from, to }));
  const rev = section(accs, sm, ['revenue']), exp = section(accs, sm, ['expense']);
  return { from, to, revenue: { rows: rev.rows, total: fromMinor(rev.total) }, expense: { rows: exp.rows, total: fromMinor(exp.total) }, surplus: fromMinor(rev.total - exp.total) };
}
export function balanceSheet({ db }, q = {}) {
  const to = q.to && isDay(q.to) ? q.to : today(), accs = accounts(db), sm = rollup(accs, rawBalances(db, { to }));
  const as = section(accs, sm, ['asset']), li = section(accs, sm, ['liability']), eq = section(accs, sm, ['equity']);
  const rev = section(accs, sm, ['revenue']), exp = section(accs, sm, ['expense']);
  const surplus = rev.total - exp.total;     // فائض الفترة غير المُقفل
  const eqTotal = eq.total + surplus;
  return { to, assets: { rows: as.rows, total: fromMinor(as.total) }, liabilities: { rows: li.rows, total: fromMinor(li.total) }, equity: { rows: eq.rows, surplus: fromMinor(surplus), total: fromMinor(eqTotal) }, balanced: as.total === li.total + eqTotal, difference: fromMinor(as.total - li.total - eqTotal) };
}
export function cashBook({ db }, q = {}) {
  ready(db);
  const accs = [sysAccount(db, 'cash'), sysAccount(db, 'bank')];
  const out = accs.map((a) => ledger({ db }, { ...q, account: a.id }));
  return { books: out, totalClosing: fromMinor(out.reduce((s, b) => s + Math.round(b.closing * 100), 0)) };
}
export function costCenterReport({ db }, q = {}) {
  ready(db); const { from, to } = range(q);
  const w = ["e.status = 'posted'", "a.type IN ('revenue','expense')", 'l.cost_center_id IS NOT NULL']; const a = [];
  if (from) { w.push('e.entry_day >= ?'); a.push(from); } if (to) { w.push('e.entry_day <= ?'); a.push(to); }
  const rows = db.prepare(`SELECT c.id, c.code, c.name, a.type, SUM(l.debit) d, SUM(l.credit) cr FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id JOIN fin_accounts a ON a.id = l.account_id JOIN fin_cost_centers c ON c.id = l.cost_center_id WHERE ${w.join(' AND ')} GROUP BY c.id, a.type`).all(...a);
  const m = new Map();
  for (const r of rows) { const x = m.get(r.id) ?? { id: r.id, code: r.code, name: r.name, revenue: 0, expense: 0 }; if (r.type === 'revenue') x.revenue += r.cr - r.d; else x.expense += r.d - r.cr; m.set(r.id, x); }
  return { from, to, rows: [...m.values()].map((x) => ({ ...x, revenue: fromMinor(x.revenue), expense: fromMinor(x.expense), net: fromMinor(x.revenue - x.expense) })) };
}
export function partyStatement({ db }, q = {}) {
  ready(db);
  const p = db.prepare('SELECT * FROM fin_parties WHERE id = ?').get(Number(q.party)); if (!p) throw bad('الطرف غير موجود.', 404, 'not_found');
  const { from, to } = range(q), w = ["e.status = 'posted'", 'l.party_id = ?'], a = [p.id];
  let run = 0;
  if (from) { const o = db.prepare(`SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id WHERE ${w.join(' AND ')} AND e.entry_day < ?`).get(...a, from); run = o.d - o.c; }
  const opening = run; const w2 = [...w], a2 = [...a];
  if (from) { w2.push('e.entry_day >= ?'); a2.push(from); } if (to) { w2.push('e.entry_day <= ?'); a2.push(to); }
  const rows = db.prepare(`SELECT l.debit, l.credit, l.note, e.no, e.entry_day, e.description, e.id eid, ac.name aname FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id JOIN fin_accounts ac ON ac.id = l.account_id WHERE ${w2.join(' AND ')} ORDER BY e.entry_day, e.id, l.line_no`).all(...a2);
  let td = 0, tc = 0;
  const lines = rows.map((r) => { run += r.debit - r.credit; td += r.debit; tc += r.credit; return { entryId: r.eid, no: r.no, day: r.entry_day, description: r.description, account: r.aname, debit: fromMinor(r.debit), credit: fromMinor(r.credit), balance: fromMinor(run) }; });
  // الرصيد: موجب = مدين (له علينا/لنا عليه حسب النوع)
  return { party: { id: p.id, name: p.name, kind: p.kind }, from, to, opening: fromMinor(opening), lines, totals: { debit: fromMinor(td), credit: fromMinor(tc) }, closing: fromMinor(run), side: run > 0 ? 'مدين' : run < 0 ? 'دائن' : 'صفر' };
}
export function overview({ db }) {
  ready(db);
  const y = db.prepare("SELECT * FROM fin_years WHERE status = 'open' AND start_day <= ? AND end_day >= ?").get(today(), today()) ?? db.prepare("SELECT * FROM fin_years WHERE status = 'open' ORDER BY start_day DESC").get();
  const accs = accounts(db), key = (k) => accs.find((a) => a.system_key === k);
  const bal = rawBalances(db, {}), sums = rollup(accs, bal);
  const cur = (k) => { const a = key(k); return a ? fromMinor(net(a, sums.get(a.id))) : 0; };
  const inc = y ? incomeStatement({ db }, { from: y.start_day, to: y.end_day }) : null;
  const drafts = db.prepare("SELECT COUNT(*) c FROM fin_entries WHERE status = 'draft'").get().c;
  const recent = db.prepare("SELECT id, no, type, entry_day day, description FROM fin_entries WHERE status = 'posted' ORDER BY id DESC LIMIT 8").all();
  const monthly = y ? db.prepare(`SELECT substr(e.entry_day,1,7) m, a.type t, SUM(l.debit) d, SUM(l.credit) c FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id JOIN fin_accounts a ON a.id = l.account_id WHERE e.status = 'posted' AND a.type IN ('revenue','expense') AND e.entry_day BETWEEN ? AND ? GROUP BY m, t ORDER BY m`).all(y.start_day, y.end_day) : [];
  const mm = new Map(); for (const r of monthly) { const x = mm.get(r.m) ?? { month: r.m, revenue: 0, expense: 0 }; if (r.t === 'revenue') x.revenue += r.c - r.d; else x.expense += r.d - r.c; mm.set(r.m, x); }
  return { year: y ? { id: y.id, name: y.name } : null, cash: cur('cash'), bank: cur('bank'), receivables: cur('students'), payables: cur('suppliers'),
    revenue: inc?.revenue.total ?? 0, expense: inc?.expense.total ?? 0, surplus: inc?.surplus ?? 0, drafts, recent, monthly: [...mm.values()].map((x) => ({ month: x.month, revenue: fromMinor(x.revenue), expense: fromMinor(x.expense) })) };
}
export { TYPE_LABEL };

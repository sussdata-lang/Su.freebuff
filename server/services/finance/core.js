// النواة المحاسبية: الحسابات والسنوات والقيود مزدوجة القيد والترحيل والعكس. كل المبالغ أعداد صحيحة بوحدة 1/100.
import { tx } from '../../db.js';
import { audit } from '../../audit.js';
import { HttpError } from '../../http.js';
import { getSetting } from '../settings.js';
import { CHART, CURRENCIES, FEE_TYPES } from './seed.js';

export const bad = (m, s = 400, code = 'validation') => new HttpError(s, m, code);
export const toMinor = (v) => { const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
export const fromMinor = (n) => Math.round(n) / 100;
export const pad = (n, w = 5) => String(n).padStart(w, '0');
export const TYPE_LABEL = { asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصروفات' };
export const ENTRY_LABEL = { JV: 'قيد يومية', RV: 'سند قبض', PV: 'سند صرف', OB: 'قيد افتتاحي', CL: 'قيد إقفال', FE: 'رسوم طلاب', PR: 'قيد رواتب' };
export const DEBIT_NATURE = new Set(['asset', 'expense']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s) => DAY.test(String(s)) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date());
const clean = (s, max, label, min = 1) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (v.length < min || v.length > max) throw bad(`«${label}» يجب أن يكون بين ${min} و${max} حرفاً.`);
  if (/[\x00-\x1f<>]/.test(v)) throw bad(`«${label}» يحوي رموزاً غير مسموحة.`);
  return v;
};
export { clean };

/* ---------- التهيئة الأولى ---------- */
const seeded = new WeakSet();
export function ready(db) {
  if (seeded.has(db)) return;
  if (!db.prepare('SELECT 1 FROM fin_accounts LIMIT 1').get()) {
    tx(db, () => {
      const now = Date.now(), ids = new Map();
      const ins = db.prepare('INSERT INTO fin_accounts (code, name, parent_id, type, postable, system_key, created_at) VALUES (?,?,?,?,?,?,?)');
      for (const [code, name, parent, type, post, key] of CHART) ids.set(code, Number(ins.run(code, name, parent ? ids.get(parent) : null, type, post, key ?? null, now).lastInsertRowid));
      for (const [code, name, symbol, rate, base] of CURRENCIES) db.prepare('INSERT OR IGNORE INTO fin_currencies (code, name, symbol, rate, is_base) VALUES (?,?,?,?,?)').run(code, name, symbol, rate, base);
      for (const [code, name, kind, key, amt] of FEE_TYPES) db.prepare('INSERT OR IGNORE INTO fin_fee_types (code, name, kind, account_id, default_amount) VALUES (?,?,?,?,?)').run(code, name, kind, sysAccount(db, key).id, amt);
    });
  }
  if (!db.prepare('SELECT 1 FROM fin_years LIMIT 1').get()) {
    const y = Number(today().slice(0, 4));
    db.prepare('INSERT INTO fin_years (name, start_day, end_day, created_at) VALUES (?,?,?,?)').run(String(y), `${y}-01-01`, `${y}-12-31`, Date.now());
  }
  seeded.add(db);
}
export function sysAccount(db, key) {
  const a = db.prepare('SELECT * FROM fin_accounts WHERE system_key = ?').get(key);
  if (!a) throw bad(`الحساب الوظيفي «${key}» غير معرَّف؛ عيّنه من دليل الحسابات.`, 409, 'conflict');
  return a;
}
export const baseCurrency = (db) => db.prepare('SELECT * FROM fin_currencies WHERE is_base = 1').get();

/* ---------- السنوات المالية ---------- */
export const listYears = (db) => { ready(db); return db.prepare('SELECT id, name, start_day startDay, end_day endDay, status, closed_at closedAt FROM fin_years ORDER BY start_day DESC').all(); };
export function yearFor(db, day, { requireOpen = true } = {}) {
  const y = db.prepare('SELECT * FROM fin_years WHERE start_day <= ? AND end_day >= ?').get(day, day);
  if (!y) throw bad(`لا توجد سنة مالية تشمل التاريخ ${day}؛ أنشئ السنة أولاً.`, 409, 'conflict');
  if (requireOpen && y.status !== 'open') throw bad(`السنة المالية ${y.name} مقفلة؛ لا يجوز التسجيل فيها.`, 409, 'conflict');
  return y;
}
export function createYear({ db }, actor, input, ip) {
  ready(db);
  const name = clean(input?.name, 20, 'اسم السنة'), s = String(input?.startDay), e = String(input?.endDay);
  if (!isDay(s) || !isDay(e) || e <= s) throw bad('تواريخ السنة غير صالحة.');
  if (db.prepare('SELECT 1 FROM fin_years WHERE NOT (end_day < ? OR start_day > ?)').get(s, e)) throw bad('الفترة تتداخل مع سنة مالية قائمة.', 409, 'conflict');
  if (db.prepare('SELECT 1 FROM fin_years WHERE name = ?').get(name)) throw bad('اسم السنة مستخدم.', 409, 'conflict');
  const id = Number(db.prepare('INSERT INTO fin_years (name, start_day, end_day, created_at) VALUES (?,?,?,?)').run(name, s, e, Date.now()).lastInsertRowid);
  audit(db, actor, 'إنشاء سنة مالية', name, ip);
  return { id };
}

/* ---------- الحسابات ---------- */
const acctView = (a) => ({ id: a.id, code: a.code, name: a.name, parentId: a.parent_id, type: a.type, typeLabel: TYPE_LABEL[a.type], postable: !!a.postable, active: !!a.active, systemKey: a.system_key, requireCc: !!a.require_cc });
export function listAccounts(db) { ready(db); return db.prepare('SELECT * FROM fin_accounts ORDER BY code').all().map(acctView); }
const hasLines = (db, id) => !!db.prepare('SELECT 1 FROM fin_lines WHERE account_id = ? LIMIT 1').get(id);
function accountInput(db, b, cur) {
  const code = clean(b?.code ?? cur?.code, 20, 'رمز الحساب');
  if (!/^[0-9A-Za-z.-]+$/.test(code)) throw bad('رمز الحساب: أرقام وحروف لاتينية و . - فقط.');
  const name = clean(b?.name ?? cur?.name, 100, 'اسم الحساب', 2);
  const parentId = b?.parentId === undefined ? cur?.parent_id ?? null : (b.parentId ? Number(b.parentId) : null);
  let type = b?.type ?? cur?.type;
  if (parentId) { const p = db.prepare('SELECT * FROM fin_accounts WHERE id = ?').get(parentId); if (!p) throw bad('الحساب الأب غير موجود.'); if (p.postable && hasLines(db, p.id)) throw bad('الحساب الأب عليه حركات؛ لا يجوز جعله تجميعياً.', 409, 'conflict'); type = p.type; }
  if (!TYPE_LABEL[type]) throw bad('نوع الحساب غير صالح.');
  const postable = b?.postable === undefined ? (cur ? cur.postable : 1) : (b.postable ? 1 : 0);
  return { code, name, parentId, type, postable, requireCc: b?.requireCc === undefined ? (cur?.require_cc ?? 0) : (b.requireCc ? 1 : 0) };
}
export function createAccount({ db }, actor, b, ip) {
  ready(db); const v = accountInput(db, b, null);
  if (db.prepare('SELECT 1 FROM fin_accounts WHERE code = ?').get(v.code)) throw bad('رمز الحساب مستخدم.', 409, 'conflict');
  const id = Number(db.prepare('INSERT INTO fin_accounts (code, name, parent_id, type, postable, require_cc, created_at) VALUES (?,?,?,?,?,?,?)').run(v.code, v.name, v.parentId, v.type, v.postable, v.requireCc, Date.now()).lastInsertRowid);
  if (v.parentId) db.prepare('UPDATE fin_accounts SET postable = 0 WHERE id = ?').run(v.parentId);   // الأب يصير تجميعياً
  audit(db, actor, 'إضافة حساب', `${v.code} ${v.name}`, ip);
  return { account: acctView(db.prepare('SELECT * FROM fin_accounts WHERE id = ?').get(id)) };
}
export function updateAccount({ db }, actor, id, b, ip) {
  ready(db); const cur = db.prepare('SELECT * FROM fin_accounts WHERE id = ?').get(Number(id));
  if (!cur) throw bad('الحساب غير موجود.', 404, 'not_found');
  const v = accountInput(db, b, cur);
  if (v.code !== cur.code && db.prepare('SELECT 1 FROM fin_accounts WHERE code = ? AND id != ?').get(v.code, cur.id)) throw bad('رمز الحساب مستخدم.', 409, 'conflict');
  if ((v.type !== cur.type || v.parentId !== cur.parent_id) && hasLines(db, cur.id)) throw bad('الحساب عليه حركات؛ لا يجوز تغيير نوعه أو أبيه.', 409, 'conflict');
  if (!v.postable && hasLines(db, cur.id)) throw bad('الحساب عليه حركات؛ لا يجوز جعله تجميعياً.', 409, 'conflict');
  if (v.postable && db.prepare('SELECT 1 FROM fin_accounts WHERE parent_id = ? LIMIT 1').get(cur.id)) throw bad('للحساب أبناء؛ يبقى تجميعياً.', 409, 'conflict');
  if (v.parentId === cur.id) throw bad('لا يكون الحساب أباً لنفسه.');
  db.prepare('UPDATE fin_accounts SET code = ?, name = ?, parent_id = ?, type = ?, postable = ?, require_cc = ? WHERE id = ?').run(v.code, v.name, v.parentId, v.type, v.postable, v.requireCc, cur.id);
  if (v.parentId) db.prepare('UPDATE fin_accounts SET postable = 0 WHERE id = ?').run(v.parentId);
  audit(db, actor, 'تعديل حساب', `${v.code} ${v.name}`, ip);
  return { account: acctView(db.prepare('SELECT * FROM fin_accounts WHERE id = ?').get(cur.id)) };
}
export function toggleAccount({ db }, actor, id, on, ip) {
  const a = db.prepare('SELECT * FROM fin_accounts WHERE id = ?').get(Number(id)); if (!a) throw bad('الحساب غير موجود.', 404, 'not_found');
  if (!on && a.system_key) throw bad('حساب وظيفي لا يُعطَّل؛ غيّر ربطه أولاً.', 409, 'conflict');
  db.prepare('UPDATE fin_accounts SET active = ? WHERE id = ?').run(on ? 1 : 0, a.id); audit(db, actor, on ? 'تفعيل حساب' : 'تعطيل حساب', a.code, ip); return { ok: true };
}
export function deleteAccount({ db }, actor, id, ip) {
  const a = db.prepare('SELECT * FROM fin_accounts WHERE id = ?').get(Number(id)); if (!a) throw bad('الحساب غير موجود.', 404, 'not_found');
  if (a.system_key) throw bad('حساب وظيفي لا يُحذف.', 409, 'conflict');
  if (hasLines(db, a.id) || db.prepare('SELECT 1 FROM fin_accounts WHERE parent_id = ?').get(a.id) || db.prepare('SELECT 1 FROM fin_fee_types WHERE account_id = ?').get(a.id) || db.prepare('SELECT 1 FROM fin_parties WHERE account_id = ?').get(a.id)) throw bad('الحساب مستعمل (حركات أو أبناء أو ارتباطات) فلا يُحذف؛ عطّله.', 409, 'conflict');
  db.prepare('DELETE FROM fin_accounts WHERE id = ?').run(a.id); audit(db, actor, 'حذف حساب', a.code, ip); return { ok: true };
}

/* ---------- القيود ---------- */
function parseLines(db, raw) {
  if (!Array.isArray(raw) || raw.length < 2) throw bad('القيد يحتاج سطرين على الأقل.');
  if (raw.length > 200) throw bad('عدد أسطر القيد حتى 200.');
  const base = baseCurrency(db).code;
  const out = raw.map((l, i) => {
    const n = i + 1, acc = db.prepare('SELECT * FROM fin_accounts WHERE id = ?').get(Number(l?.accountId));
    if (!acc) throw bad(`السطر ${n}: الحساب غير موجود.`);
    if (!acc.active) throw bad(`السطر ${n}: الحساب «${acc.name}» معطّل.`);
    if (!acc.postable) throw bad(`السطر ${n}: الحساب «${acc.name}» تجميعي لا تُرحَّل عليه قيود.`);
    let debit = l.debit ? toMinor(l.debit) : 0, credit = l.credit ? toMinor(l.credit) : 0;
    const cur = l.currency && l.currency !== base ? db.prepare('SELECT * FROM fin_currencies WHERE code = ? AND active = 1').get(String(l.currency)) : null;
    if (l.currency && l.currency !== base && !cur) throw bad(`السطر ${n}: عملة غير معروفة.`);
    let fc = null, rate = null;
    if (cur) {
      rate = Number(l.rate ?? cur.rate); fc = l.fcAmount ? toMinor(l.fcAmount) : null;
      if (!(rate > 0)) throw bad(`السطر ${n}: سعر الصرف غير صالح.`);
      if (!debit && !credit && fc) { const amt = Math.round(fc * rate); if (l.dc === 'c') credit = amt; else debit = amt; }
    }
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) throw bad(`السطر ${n}: مبلغ غير صالح.`);
    if ((debit > 0) === (credit > 0)) throw bad(`السطر ${n}: أدخل مبلغاً مديناً أو دائناً (واحداً فقط).`);
    if (debit > 1e13 || credit > 1e13) throw bad(`السطر ${n}: مبلغ كبير جداً.`);
    const cc = l.costCenterId ? Number(l.costCenterId) : null;
    if (cc && !db.prepare('SELECT 1 FROM fin_cost_centers WHERE id = ? AND active = 1').get(cc)) throw bad(`السطر ${n}: مركز الكلفة غير موجود.`);
    if (acc.require_cc && !cc) throw bad(`السطر ${n}: الحساب «${acc.name}» يتطلب مركز كلفة.`);
    const party = l.partyId ? Number(l.partyId) : null;
    if (party && !db.prepare('SELECT 1 FROM fin_parties WHERE id = ?').get(party)) throw bad(`السطر ${n}: الطرف غير موجود.`);
    const stu = l.studentId ? Number(l.studentId) : null;
    if (stu && !db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'student'").get(stu)) throw bad(`السطر ${n}: الطالب غير موجود.`);
    return { n, accountId: acc.id, debit, credit, currency: cur ? cur.code : null, rate, fc, cc, party, stu, note: clean(l.note ?? '', 200, 'البيان', 0) };
  });
  const dr = out.reduce((s, l) => s + l.debit, 0), cr = out.reduce((s, l) => s + l.credit, 0);
  if (dr !== cr) throw bad(`القيد غير متوازن: المدين ${fromMinor(dr)} والدائن ${fromMinor(cr)}.`);
  if (dr === 0) throw bad('مبلغ القيد صفر.');
  return { lines: out, total: dr };
}
function writeLines(db, entryId, lines) {
  db.prepare('DELETE FROM fin_lines WHERE entry_id = ?').run(entryId);
  const ins = db.prepare('INSERT INTO fin_lines (entry_id, line_no, account_id, debit, credit, currency, rate, fc_amount, cost_center_id, party_id, student_id, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const l of lines) ins.run(entryId, l.n, l.accountId, l.debit, l.credit, l.currency, l.rate, l.fc, l.cc, l.party, l.stu, l.note);
}
const lineView = (l) => ({ id: l.id, lineNo: l.line_no, accountId: l.account_id, code: l.code, account: l.account, debit: fromMinor(l.debit), credit: fromMinor(l.credit), currency: l.currency, rate: l.rate, fcAmount: l.fc_amount === null ? null : fromMinor(l.fc_amount), costCenterId: l.cost_center_id, costCenter: l.cc_name ?? null, partyId: l.party_id, party: l.party_name ?? null, studentId: l.student_id, note: l.note });
export function entryView(db, e) {
  const lines = db.prepare(`SELECT l.*, a.code, a.name account, c.name cc_name, p.name party_name FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id LEFT JOIN fin_cost_centers c ON c.id = l.cost_center_id LEFT JOIN fin_parties p ON p.id = l.party_id WHERE l.entry_id = ? ORDER BY l.line_no`).all(e.id).map(lineView);
  const u = (id) => (id ? db.prepare('SELECT display_name n FROM users WHERE id = ?').get(id)?.n ?? null : null);
  const y = db.prepare('SELECT name FROM fin_years WHERE id = ?').get(e.year_id);
  return { id: e.id, no: e.no, type: e.type, typeLabel: ENTRY_LABEL[e.type], year: y?.name, day: e.entry_day, description: e.description, reference: e.reference, status: e.status, source: e.source,
    reversalOf: e.reversal_of, reversedBy: e.reversed_by, createdBy: u(e.created_by), createdById: e.created_by, createdAt: e.created_at, postedBy: u(e.posted_by), postedAt: e.posted_at,
    total: fromMinor(lines.reduce((s, l) => s + Math.round(l.debit * 100), 0)), lines };
}
function entryHead(db, input, cur) {
  const day = String(input?.day ?? cur?.entry_day ?? today());
  if (!isDay(day)) throw bad('تاريخ القيد غير صالح.');
  const y = yearFor(db, day);
  return { day, year: y, description: clean(input?.description ?? cur?.description, 300, 'البيان', 2), reference: clean(input?.reference ?? cur?.reference ?? '', 60, 'المرجع', 0) };
}
// الإنشاء: مسودة، أو مرحَّل مباشرة (post:true) — وأنواع النظام (FE/PR/OB/CL) تُنشأ من وحدات داخلية فقط عبر opts.type
export function createEntry(deps, actor, input, ip, opts = {}) {
  const { db } = deps; ready(db);
  const type = opts.type ?? 'JV';
  if (!opts.type && input?.type && !['JV', 'RV', 'PV'].includes(input.type)) throw bad('نوع القيد غير مسموح.');
  const t = opts.type ?? (['JV', 'RV', 'PV'].includes(input?.type) ? input.type : 'JV');
  const head = entryHead(db, input, null), { lines } = parseLines(db, input?.lines);
  const id = tx(db, () => {
    const eid = Number(db.prepare('INSERT INTO fin_entries (year_id, type, entry_day, description, reference, status, source, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(head.year.id, t, head.day, head.description, head.reference, 'draft', opts.source ?? null, actor?.id ?? null, Date.now()).lastInsertRowid);
    writeLines(db, eid, lines);
    audit(db, actor, `إنشاء ${ENTRY_LABEL[t]} (مسودة)`, `#${eid} ${head.description.slice(0, 60)}`, ip);
    if (opts.post || input?.post === true) postEntry(deps, actor, eid, ip, { system: !!opts.system });
    return eid;
  });
  void type;
  return entryView(db, db.prepare('SELECT * FROM fin_entries WHERE id = ?').get(id));
}
const loadEntry = (db, id) => { const e = db.prepare('SELECT * FROM fin_entries WHERE id = ?').get(Number(id)); if (!e) throw bad('القيد غير موجود.', 404, 'not_found'); return e; };
export function updateEntry(deps, actor, id, input, ip) {
  const { db } = deps, e = loadEntry(db, id);
  if (e.status !== 'draft') throw bad('القيد المرحَّل لا يُعدَّل؛ اعكسه وسجّل قيداً جديداً.', 409, 'conflict');
  if (e.created_by !== actor.id && !actor.can('finance:setup')) throw bad('تعديل المسودة لمنشئها أو لمدير المالية.', 403, 'forbidden');
  const head = entryHead(db, input, e), { lines } = input?.lines ? parseLines(db, input.lines) : { lines: null };
  tx(db, () => {
    db.prepare('UPDATE fin_entries SET year_id = ?, entry_day = ?, description = ?, reference = ? WHERE id = ?').run(head.year.id, head.day, head.description, head.reference, e.id);
    if (lines) writeLines(db, e.id, lines);
    audit(db, actor, 'تعديل مسودة قيد', `#${e.id}`, ip);
    if (input?.post === true) postEntry(deps, actor, e.id, ip);
  });
  return entryView(db, loadEntry(db, e.id));
}
export function deleteEntry({ db }, actor, id, ip) {
  const e = loadEntry(db, id);
  if (e.status !== 'draft') throw bad('القيد المرحَّل لا يُحذف؛ اعكسه.', 409, 'conflict');
  if (e.created_by !== actor.id && !actor.can('finance:setup')) throw bad('حذف المسودة لمنشئها أو لمدير المالية.', 403, 'forbidden');
  db.prepare('DELETE FROM fin_entries WHERE id = ?').run(e.id); audit(db, actor, 'حذف مسودة قيد', `#${e.id}`, ip); return { ok: true };
}
export function postEntry(deps, actor, id, ip, { system = false } = {}) {
  const { db } = deps, e = loadEntry(db, id);
  if (e.status === 'posted') throw bad('القيد مرحَّل مسبقاً.', 409, 'conflict');
  if (!system && getSetting(db, 'finance.separate_poster') && e.created_by === actor.id) throw bad('سياسة فصل المهام: لا يُرحِّل القيد من أنشأه.', 403, 'forbidden');
  const y = yearFor(db, e.entry_day);
  parseLines(db, db.prepare('SELECT * FROM fin_lines WHERE entry_id = ?').all(e.id).map((l) => ({ accountId: l.account_id, debit: fromMinor(l.debit), credit: fromMinor(l.credit), currency: l.currency, rate: l.rate, costCenterId: l.cost_center_id, partyId: l.party_id, studentId: l.student_id, note: l.note })));
  const seq = (db.prepare('SELECT COALESCE(MAX(seq), 0) m FROM fin_entries WHERE year_id = ? AND type = ?').get(y.id, e.type).m) + 1;
  const no = `${e.type}-${y.name}-${pad(seq)}`;
  db.prepare("UPDATE fin_entries SET status = 'posted', seq = ?, no = ?, year_id = ?, posted_by = ?, posted_at = ? WHERE id = ?").run(seq, no, y.id, actor?.id ?? null, Date.now(), e.id);
  audit(db, actor, 'ترحيل قيد', no, ip);
  return entryView(db, loadEntry(db, e.id));
}
export function reverseEntry(deps, actor, id, input, ip) {
  const { db } = deps, e = loadEntry(db, id);
  if (e.status !== 'posted') throw bad('يُعكس القيد المرحَّل فقط.', 409, 'conflict');
  if (e.reversed_by) throw bad('القيد معكوس مسبقاً.', 409, 'conflict');
  if (e.reversal_of) throw bad('لا يُعكس قيد عكسي.', 409, 'conflict');
  if (e.type === 'CL' || e.type === 'OB') throw bad('قيود الإقفال والافتتاح لا تُعكس.', 409, 'conflict');
  const day = String(input?.day ?? today()); if (!isDay(day)) throw bad('تاريخ العكس غير صالح.');
  const y = yearFor(db, day);
  const why = clean(input?.reason ?? '', 200, 'سبب العكس', 0);
  return tx(db, () => {
    const eid = Number(db.prepare('INSERT INTO fin_entries (year_id, type, entry_day, description, reference, status, reversal_of, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(y.id, e.type, day, `عكس القيد ${e.no}${why ? ': ' + why : ''}`, e.no, 'draft', e.id, actor.id, Date.now()).lastInsertRowid);
    const ls = db.prepare('SELECT * FROM fin_lines WHERE entry_id = ? ORDER BY line_no').all(e.id);
    const ins = db.prepare('INSERT INTO fin_lines (entry_id, line_no, account_id, debit, credit, currency, rate, fc_amount, cost_center_id, party_id, student_id, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const l of ls) ins.run(eid, l.line_no, l.account_id, l.credit, l.debit, l.currency, l.rate, l.fc_amount, l.cost_center_id, l.party_id, l.student_id, l.note);
    const rev = postEntry(deps, actor, eid, ip, { system: true });
    db.prepare('UPDATE fin_entries SET reversed_by = ? WHERE id = ?').run(eid, e.id);
    audit(db, actor, 'عكس قيد', `${e.no} ← ${rev.no}`, ip);
    return rev;
  });
}
export function getEntry({ db }, id) { ready(db); return { entry: entryView(db, loadEntry(db, id)) }; }
export function listEntries({ db }, q = {}) {
  ready(db);
  const w = [], a = [];
  if (['JV', 'RV', 'PV', 'OB', 'CL', 'FE', 'PR'].includes(q.type)) { w.push('e.type = ?'); a.push(q.type); }
  if (['draft', 'posted'].includes(q.status)) { w.push('e.status = ?'); a.push(q.status); }
  if (isDay(q.from)) { w.push('e.entry_day >= ?'); a.push(q.from); }
  if (isDay(q.to)) { w.push('e.entry_day <= ?'); a.push(q.to); }
  if (q.account) { w.push('EXISTS (SELECT 1 FROM fin_lines l WHERE l.entry_id = e.id AND l.account_id = ?)'); a.push(Number(q.account)); }
  if (q.party) { w.push('EXISTS (SELECT 1 FROM fin_lines l WHERE l.entry_id = e.id AND l.party_id = ?)'); a.push(Number(q.party)); }
  const term = String(q.q ?? '').trim().slice(0, 60);
  if (term) { w.push("(e.description LIKE ? ESCAPE '\\' OR e.no LIKE ? ESCAPE '\\' OR e.reference LIKE ? ESCAPE '\\')"); const l = '%' + term.replace(/[\\%_]/g, '\\$&') + '%'; a.push(l, l, l); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const size = Math.min(Math.max(Number(q.size) || 100, 1), 500), page = Math.max(Number(q.page) || 1, 1);
  const total = db.prepare(`SELECT COUNT(*) c FROM fin_entries e ${where}`).get(...a).c;
  const rows = db.prepare(`SELECT e.*, (SELECT SUM(debit) FROM fin_lines WHERE entry_id = e.id) total FROM fin_entries e ${where} ORDER BY e.entry_day DESC, e.id DESC LIMIT ? OFFSET ?`).all(...a, size, (page - 1) * size);
  return { total, page, size, entries: rows.map((e) => ({ id: e.id, no: e.no, type: e.type, typeLabel: ENTRY_LABEL[e.type], day: e.entry_day, description: e.description, reference: e.reference, status: e.status, total: fromMinor(e.total ?? 0), reversed: !!e.reversed_by, isReversal: !!e.reversal_of, source: e.source })) };
}

/* ---------- الأرصدة ---------- */
// أرصدة الحسابات النهائية من القيود المرحَّلة ضمن المدى. opts.to شاملة، opts.from شاملة، opts.before حتى (قبل) تاريخ
export function rawBalances(db, { from = null, to = null, before = null, costCenterId = null, partyId = null } = {}) {
  const w = ["e.status = 'posted'"], a = [];
  if (from) { w.push('e.entry_day >= ?'); a.push(from); }
  if (to) { w.push('e.entry_day <= ?'); a.push(to); }
  if (before) { w.push('e.entry_day < ?'); a.push(before); }
  if (costCenterId) { w.push('l.cost_center_id = ?'); a.push(Number(costCenterId)); }
  if (partyId) { w.push('l.party_id = ?'); a.push(Number(partyId)); }
  const m = new Map();
  for (const r of db.prepare(`SELECT l.account_id, SUM(l.debit) d, SUM(l.credit) c FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id WHERE ${w.join(' AND ')} GROUP BY l.account_id`).all(...a)) m.set(r.account_id, { d: r.d, c: r.c });
  return m;
}

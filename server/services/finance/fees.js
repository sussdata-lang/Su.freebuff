// رسوم الطلاب: أنواع الرسوم، الاستحقاقات، المدفوعات/الإيصالات، كشف الطالب، إغلاق السنة، قيد الرواتب.
import { tx } from '../../db.js';
import { audit } from '../../audit.js';
import { bad, ready, sysAccount, createEntry, reverseEntry, fromMinor, toMinor, isDay, today, clean } from './core.js';
import { getSetting } from '../settings.js';

/* --------- أنواع الرسوم --------- */
const ftView = (r) => ({ id: r.id, code: r.code, name: r.name, kind: r.kind, accountId: r.account_id, defaultAmount: fromMinor(r.default_amount ?? 0), active: !!r.active });
export function listFeeTypes({ db }) { ready(db); return db.prepare('SELECT * FROM fin_fee_types ORDER BY code').all().map(ftView); }
export function saveFeeType({ db }, actor, input, ip) {
  ready(db);
  const code = clean(input?.code, 30, 'رمز نوع الرسم'), name = clean(input?.name, 100, 'اسم نوع الرسم', 2);
  if (!['fee', 'discount'].includes(input?.kind)) throw bad('نوع الرسم غير صالح (fee/discount).');
  const acc = db.prepare('SELECT * FROM fin_accounts WHERE id = ? AND active = 1 AND postable = 1').get(Number(input?.accountId));
  if (!acc) throw bad('الحساب غير موجود أو غير قابل للقيد.');
  const amt = input?.defaultAmount !== undefined ? toMinor(input.defaultAmount) : 0;
  if (!Number.isFinite(amt) || amt < 0) throw bad('مبلغ افتراضي غير صالح.');
  const id = input?.id ? Number(input.id) : null;
  if (id) {
    const cur = db.prepare('SELECT * FROM fin_fee_types WHERE id = ?').get(id); if (!cur) throw bad('نوع الرسم غير موجود.', 404, 'not_found');
    if (code !== cur.code && db.prepare('SELECT 1 FROM fin_fee_types WHERE code = ? AND id != ?').get(code, id)) throw bad('رمز نوع الرسم مستخدم.', 409, 'conflict');
    db.prepare('UPDATE fin_fee_types SET code=?, name=?, kind=?, account_id=?, default_amount=? WHERE id=?').run(code, name, input.kind, acc.id, amt, id);
    audit(db, actor, 'تعديل نوع رسم', name, ip); return { feeType: ftView(db.prepare('SELECT * FROM fin_fee_types WHERE id=?').get(id)) };
  }
  if (db.prepare('SELECT 1 FROM fin_fee_types WHERE code = ?').get(code)) throw bad('رمز نوع الرسم مستخدم.', 409, 'conflict');
  const nid = Number(db.prepare('INSERT INTO fin_fee_types (code,name,kind,account_id,default_amount) VALUES (?,?,?,?,?)').run(code, name, input.kind, acc.id, amt).lastInsertRowid);
  audit(db, actor, 'إضافة نوع رسم', name, ip); return { feeType: ftView(db.prepare('SELECT * FROM fin_fee_types WHERE id=?').get(nid)) };
}
export function toggleFeeType({ db }, actor, id, on, ip) {
  const r = db.prepare('SELECT * FROM fin_fee_types WHERE id=?').get(Number(id)); if (!r) throw bad('نوع الرسم غير موجود.', 404, 'not_found');
  db.prepare('UPDATE fin_fee_types SET active=? WHERE id=?').run(on ? 1 : 0, r.id); audit(db, actor, on ? 'تفعيل نوع رسم' : 'تعطيل نوع رسم', r.code, ip); return { ok: true };
}

/* --------- الاستحقاقات (Charges) --------- */
const chView = (r) => ({ id: r.id, studentId: r.student_id, feeTypeId: r.fee_type_id, feeType: r.ft_name, kind: r.ft_kind, amount: fromMinor(r.amount), dueDay: r.due_day, academicYear: r.academic_year, note: r.note, status: r.status, entryId: r.entry_id, createdAt: r.created_at });
export function listCharges({ db }, q = {}) {
  ready(db);
  const w = [], a = [];
  if (q.studentId) { w.push('c.student_id = ?'); a.push(Number(q.studentId)); }
  if (q.feeTypeId) { w.push('c.fee_type_id = ?'); a.push(Number(q.feeTypeId)); }
  if (q.status) { w.push('c.status = ?'); a.push(q.status); }
  if (q.academicYear) { w.push('c.academic_year = ?'); a.push(String(q.academicYear)); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  return db.prepare(`SELECT c.*, ft.name ft_name, ft.kind ft_kind FROM fin_charges c JOIN fin_fee_types ft ON ft.id = c.fee_type_id ${where} ORDER BY c.due_day DESC, c.id DESC`).all(...a).map(chView);
}
export function createCharge(deps, actor, input, ip) {
  const { db } = deps; ready(db);
  const stu = db.prepare("SELECT * FROM users WHERE id=? AND role='student'").get(Number(input?.studentId)); if (!stu) throw bad('الطالب غير موجود.', 404, 'not_found');
  const ft = db.prepare('SELECT * FROM fin_fee_types WHERE id=? AND active=1').get(Number(input?.feeTypeId)); if (!ft) throw bad('نوع الرسم غير موجود أو معطّل.', 404, 'not_found');
  const amt = toMinor(input?.amount ?? ft.default_amount);
  if (!Number.isFinite(amt) || amt <= 0) throw bad('مبلغ الاستحقاق غير صالح.');
  const due = String(input?.dueDay ?? today()); if (!isDay(due)) throw bad('تاريخ الاستحقاق غير صالح.');
  const ay = String(input?.academicYear ?? due.slice(0, 4));
  const note = clean(input?.note ?? '', 200, 'ملاحظة', 0);
  return tx(db, () => {
    const cid = Number(db.prepare('INSERT INTO fin_charges (student_id,fee_type_id,amount,due_day,academic_year,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(stu.id, ft.id, amt, due, ay, note, actor.id, Date.now()).lastInsertRowid);
    const studAcc = sysAccount(db, 'students');
    const isFee = ft.kind === 'fee';
    const lines = isFee
      ? [{ accountId: studAcc.id, debit: fromMinor(amt), studentId: stu.id }, { accountId: ft.account_id, credit: fromMinor(amt), studentId: stu.id }]
      : [{ accountId: ft.account_id, debit: fromMinor(amt), studentId: stu.id }, { accountId: studAcc.id, credit: fromMinor(amt), studentId: stu.id }];
    const desc = `${isFee ? 'استحقاق' : 'خصم'} ${ft.name} — ${stu.display_name}`;
    const entry = createEntry(deps, actor, { day: due, description: desc, lines, post: true }, ip, { type: 'FE', source: `charge:${cid}`, post: true, system: true });
    db.prepare('UPDATE fin_charges SET entry_id=? WHERE id=?').run(entry.id, cid);
    audit(db, actor, isFee ? 'استحقاق رسوم' : 'خصم رسوم', desc, ip);
    return { charge: chView(db.prepare(`SELECT c.*, ft.name ft_name, ft.kind ft_kind FROM fin_charges c JOIN fin_fee_types ft ON ft.id=c.fee_type_id WHERE c.id=?`).get(cid)) };
  });
}
export function voidCharge(deps, actor, id, input, ip) {
  const { db } = deps, ch = db.prepare(`SELECT c.*, ft.name ft_name, ft.kind ft_kind FROM fin_charges c JOIN fin_fee_types ft ON ft.id=c.fee_type_id WHERE c.id=?`).get(Number(id));
  if (!ch) throw bad('الاستحقاق غير موجود.', 404, 'not_found');
  if (ch.status !== 'open') throw bad('الاستحقاق ملغى مسبقاً.', 409, 'conflict');
  return tx(db, () => {
    if (ch.entry_id) reverseEntry(deps, actor, ch.entry_id, input, ip);
    db.prepare("UPDATE fin_charges SET status='void' WHERE id=?").run(ch.id);
    audit(db, actor, 'إلغاء استحقاق', `#${ch.id}`, ip); return { ok: true };
  });
}

/* --------- المدفوعات/الإيصالات --------- */
const pyView = (r) => ({ id: r.id, receiptNo: r.receipt_no, studentId: r.student_id, student: r.student_name, amount: fromMinor(r.amount), method: r.method, accountId: r.account_id, paidDay: r.paid_day, note: r.note, status: r.status, entryId: r.entry_id, createdAt: r.created_at });
export function listPayments({ db }, q = {}) {
  ready(db);
  const w = [], a = [];
  if (q.studentId) { w.push('p.student_id = ?'); a.push(Number(q.studentId)); }
  if (['ok', 'void'].includes(q.status)) { w.push('p.status = ?'); a.push(q.status); }
  if (q.from) { w.push('p.paid_day >= ?'); a.push(q.from); } if (q.to) { w.push('p.paid_day <= ?'); a.push(q.to); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  return db.prepare(`SELECT p.*, u.display_name student_name FROM fin_payments p JOIN users u ON u.id=p.student_id ${where} ORDER BY p.paid_day DESC, p.id DESC`).all(...a).map(pyView);
}
function nextReceiptNo(db) {
  const prefix = getSetting(db, 'finance.receipt_prefix', 'RCP');
  const y = new Date().getFullYear();
  const last = db.prepare("SELECT receipt_no FROM fin_payments WHERE receipt_no LIKE ? ORDER BY id DESC LIMIT 1").get(`${prefix}-${y}-%`);
  const n = last ? Number(last.receipt_no.split('-').pop()) + 1 : 1;
  return `${prefix}-${y}-${String(n).padStart(5, '0')}`;
}
export function createPayment(deps, actor, input, ip) {
  const { db } = deps; ready(db);
  const stu = db.prepare("SELECT * FROM users WHERE id=? AND role='student'").get(Number(input?.studentId)); if (!stu) throw bad('الطالب غير موجود.', 404, 'not_found');
  const amt = toMinor(input?.amount); if (!Number.isFinite(amt) || amt <= 0) throw bad('مبلغ الدفعة غير صالح.');
  const method = ['cash', 'bank'].includes(input?.method) ? input.method : 'cash';
  const cashAcc = sysAccount(db, method);
  const day = String(input?.paidDay ?? today()); if (!isDay(day)) throw bad('تاريخ الدفع غير صالح.');
  const studAcc = sysAccount(db, 'students');
  const note = clean(input?.note ?? '', 200, 'ملاحظة', 0);
  return tx(db, () => {
    const rno = nextReceiptNo(db);
    const pid = Number(db.prepare('INSERT INTO fin_payments (receipt_no,student_id,amount,method,account_id,paid_day,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(rno, stu.id, amt, method, cashAcc.id, day, note, actor.id, Date.now()).lastInsertRowid);
    const desc = `دفعة ${stu.display_name} / ${rno}`;
    const entry = createEntry(deps, actor, { day, description: desc, lines: [{ accountId: cashAcc.id, debit: fromMinor(amt) }, { accountId: studAcc.id, credit: fromMinor(amt), studentId: stu.id }], post: true }, ip, { type: 'RV', source: `payment:${pid}`, post: true, system: true });
    db.prepare("UPDATE fin_payments SET entry_id=?, status='ok' WHERE id=?").run(entry.id, pid);
    audit(db, actor, 'استلام دفعة', `${rno} ${stu.display_name}`, ip);
    return { payment: pyView(db.prepare(`SELECT p.*, u.display_name student_name FROM fin_payments p JOIN users u ON u.id=p.student_id WHERE p.id=?`).get(pid)), receiptNo: rno };
  });
}
export function voidPayment(deps, actor, id, input, ip) {
  const { db } = deps, py = db.prepare(`SELECT p.*, u.display_name student_name FROM fin_payments p JOIN users u ON u.id=p.student_id WHERE p.id=?`).get(Number(id));
  if (!py) throw bad('الدفعة غير موجودة.', 404, 'not_found');
  if (py.status !== 'ok') throw bad('الدفعة ملغاة مسبقاً.', 409, 'conflict');
  return tx(db, () => {
    if (py.entry_id) reverseEntry(deps, actor, py.entry_id, input, ip);
    db.prepare("UPDATE fin_payments SET status='void' WHERE id=?").run(py.id);
    audit(db, actor, 'إلغاء دفعة', py.receipt_no, ip); return { ok: true };
  });
}

/* --------- كشف حساب الطالب --------- */
export function studentStatement({ db }, studentId) {
  ready(db);
  const stu = db.prepare("SELECT * FROM users WHERE id=? AND role='student'").get(Number(studentId)); if (!stu) throw bad('الطالب غير موجود.', 404, 'not_found');
  const charges = listCharges({ db }, { studentId: stu.id });
  const payments = listPayments({ db }, { studentId: stu.id });
  const totalCharged = charges.filter((c) => c.status === 'open').reduce((s, c) => s + Math.round(c.amount * 100), 0);
  const totalPaid = payments.filter((p) => p.status === 'ok').reduce((s, p) => s + Math.round(p.amount * 100), 0);
  const balance = totalCharged - totalPaid;
  return { student: { id: stu.id, name: stu.display_name }, charges, payments, totalCharged: fromMinor(totalCharged), totalPaid: fromMinor(totalPaid), balance: fromMinor(balance), side: balance > 0 ? 'مستحق' : balance < 0 ? 'رصيد دائن' : 'صفر' };
}

/* --------- قيد الرواتب --------- */
export function payrollEntry(deps, actor, input, ip) {
  const { db } = deps; ready(db);
  const month = String(input?.month ?? ''); if (!/^\d{4}-\d{2}$/.test(month)) throw bad('الشهر غير صالح (YYYY-MM).');
  if (db.prepare("SELECT 1 FROM fin_entries WHERE source=? AND reversal_of IS NULL").get(`payroll:${month}`)) throw bad(`قيد الرواتب لشهر ${month} موجود مسبقاً.`, 409, 'conflict');
  const rows = db.prepare(`SELECT COALESCE(SUM(gross),0) g, COALESCE(SUM(deductions),0) d, COALESCE(SUM(net),0) n FROM hr_salaries WHERE month=? AND status='approved'`).get(month);
  if (!rows || !rows.g) throw bad('لا توجد رواتب معتمدة لهذا الشهر.');
  const gross = rows.g, ded = rows.d, net = rows.n;
  const salExp = sysAccount(db, 'salaries_exp'), salPay = sysAccount(db, 'salaries_pay');
  const lines = [{ accountId: salExp.id, debit: fromMinor(gross) }, { accountId: salPay.id, credit: fromMinor(net) }];
  if (ded > 0) {
    const dedAcc = db.prepare("SELECT id FROM fin_accounts WHERE system_key='deductions'").get();
    if (dedAcc) lines.push({ accountId: dedAcc.id, credit: fromMinor(ded) });
    else lines[1] = { accountId: salPay.id, credit: fromMinor(gross) };
  }
  const entry = createEntry(deps, actor, { day: `${month}-01`, description: `قيد رواتب ${month}`, lines, post: true }, ip, { type: 'PR', source: `payroll:${month}`, post: true, system: true });
  audit(db, actor, 'قيد رواتب', month, ip);
  return { entry };
}

/* --------- إغلاق السنة المالية --------- */
export function closeYear(deps, actor, yearId, ip) {
  const { db } = deps; ready(db);
  const y = db.prepare('SELECT * FROM fin_years WHERE id=?').get(Number(yearId));
  if (!y) throw bad('السنة غير موجودة.', 404, 'not_found');
  if (y.status !== 'open') throw bad('السنة مقفلة.', 409, 'conflict');
  if (db.prepare("SELECT 1 FROM fin_entries WHERE status='draft' AND year_id=?").get(y.id)) throw bad('توجد مسودات قيود غير مرحَّلة في هذه السنة؛ أرحلها أو احذفها أولاً.', 409, 'conflict');
  return tx(db, () => {
    // أرصدة الإيرادات والمصروفات
    const bals = db.prepare(`SELECT l.account_id, a.type t, SUM(l.debit) d, SUM(l.credit) c FROM fin_lines l JOIN fin_entries e ON e.id=l.entry_id JOIN fin_accounts a ON a.id=l.account_id WHERE e.status='posted' AND e.year_id=? AND a.type IN ('revenue','expense') GROUP BY l.account_id`).all(y.id);
    if (!bals.length) throw bad('لا توجد إيرادات أو مصروفات في هذه السنة لإقفالها.', 409, 'conflict');
    const retained = sysAccount(db, 'retained');
    let surplus = 0;
    const clLines = [];
    for (const b of bals) {
      const isRev = b.t === 'revenue', netV = isRev ? (b.c - b.d) : (b.d - b.c);
      surplus += isRev ? netV : -netV;
      if (isRev && b.c > b.d) clLines.push({ accountId: b.account_id, debit: fromMinor(b.c - b.d) });
      else if (!isRev && b.d > b.c) clLines.push({ accountId: b.account_id, credit: fromMinor(b.d - b.c) });
    }
    if (surplus > 0) clLines.push({ accountId: retained.id, credit: fromMinor(surplus) });
    else if (surplus < 0) clLines.push({ accountId: retained.id, debit: fromMinor(-surplus) });
    else clLines.push({ accountId: retained.id, credit: 0.01 }); // صفر — إضافة رمزية لإتمام القيد
    createEntry(deps, actor, { day: y.end_day, description: `إقفال سنة ${y.name}`, lines: clLines, post: true }, ip, { type: 'CL', source: `close:${y.id}`, post: true, system: true });
    db.prepare("UPDATE fin_years SET status='closed', closed_at=?, closed_by=? WHERE id=?").run(Date.now(), actor.id, y.id);
    // السنة التالية
    const nextY = Number(y.end_day.slice(0, 4)) + 1;
    let createdNext = false;
    if (!db.prepare('SELECT 1 FROM fin_years WHERE name=?').get(String(nextY))) {
      const nid = Number(db.prepare('INSERT INTO fin_years (name,start_day,end_day,created_at) VALUES (?,?,?,?)').run(String(nextY), `${nextY}-01-01`, `${nextY}-12-31`, Date.now()).lastInsertRowid);
      // قيد افتتاحي من الأصول والخصوم وحقوق الملكية
      const prev = db.prepare(`SELECT l.account_id, SUM(l.debit) d, SUM(l.credit) c FROM fin_lines l JOIN fin_entries e ON e.id=l.entry_id WHERE e.status='posted' AND e.year_id=? GROUP BY l.account_id`).all(y.id);
      const bsAccs = new Set(db.prepare("SELECT id FROM fin_accounts WHERE postable=1 AND type IN ('asset','liability','equity')").all().map((a) => a.id));
      const obLines = [];
      for (const b of prev) {
        if (!bsAccs.has(b.account_id)) continue;
        const net = b.d - b.c;
        if (net > 0) obLines.push({ accountId: b.account_id, debit: fromMinor(net) });
        else if (net < 0) obLines.push({ accountId: b.account_id, credit: fromMinor(-net) });
      }
      if (obLines.length >= 2) createEntry(deps, actor, { day: `${nextY}-01-01`, description: `رصيد افتتاحي ${nextY}`, lines: obLines, post: true }, ip, { type: 'OB', source: `open:${nid}`, post: true, system: true });
      void nid;
      createdNext = true;
    }
    audit(db, actor, 'إقفال سنة مالية', y.name, ip);
    return { ok: true, yearClosed: y.name, nextYear: createdNext ? String(nextY) : null };
  });
}

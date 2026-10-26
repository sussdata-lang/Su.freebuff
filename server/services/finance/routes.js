// /api/finance/* — يُسجَّل من routes.js عبر registerFinance(r, deps, helpers)
import { HttpError } from '../../http.js';
const need = (ctx, perm) => { if (!ctx.user.can(perm)) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); };
import * as C from './core.js';
import * as R from './reports.js';
import * as F from './fees.js';

// helpers لكتابة الإكسل
let xlsxLib = null; const xlsx = () => xlsxLib ?? (xlsxLib = import('../../lib/xlsx.js'));

export async function registerFinance(r, deps, { writeXlsx }) {
  const { db } = deps;
  const fin = (perm, handler, successCode = 200) => async (c) => {
    need(c, perm);
    const body = c.body ?? {};
    const q = c.query ?? {};
    const result = await handler(c, body, q);
    if (result === null || result === undefined) return c.json(204, {});
    return c.json(successCode, result);
  };
  const finC = (perm, handler) => fin(perm, handler, 201);

  /* ---- لوحة المعلومات ---- */
  r.add('GET', '/api/finance/overview', fin('finance:read', () => R.overview(deps)));

  /* ---- السنوات المالية ---- */
  r.add('GET', '/api/finance/years', fin('finance:read', () => ({ years: C.listYears(db) })));
  r.add('POST', '/api/finance/years', finC('finance:setup', (c, b) => C.createYear(deps, c.user, b, c.ip)));

  /* ---- دليل الحسابات ---- */
  r.add('GET', '/api/finance/accounts', fin('finance:read', () => ({ accounts: C.listAccounts(db) })));
  r.add('POST', '/api/finance/accounts', finC('finance:setup', (c, b) => C.createAccount(deps, c.user, b, c.ip)));
  r.add('PUT', '/api/finance/accounts/:id', fin('finance:setup', (c, b) => C.updateAccount(deps, c.user, c.params.id, b, c.ip)));
  r.add('POST', '/api/finance/accounts/:id/toggle', fin('finance:setup', (c, b) => C.toggleAccount(deps, c.user, c.params.id, b?.active !== false, c.ip)));
  r.add('DELETE', '/api/finance/accounts/:id', fin('finance:setup', (c) => C.deleteAccount(deps, c.user, c.params.id, c.ip)));

  /* ---- القيود اليومية ---- */
  r.add('GET', '/api/finance/entries', fin('finance:read', (_c, _b, q) => C.listEntries(deps, q)));
  r.add('GET', '/api/finance/entries/:id', fin('finance:read', (c) => C.getEntry(deps, c.params.id)));
  r.add('POST', '/api/finance/entries', finC('finance:entry', (c, b) => C.createEntry(deps, c.user, b, c.ip)));
  r.add('PUT', '/api/finance/entries/:id', fin('finance:entry', (c, b) => C.updateEntry(deps, c.user, c.params.id, b, c.ip)));
  r.add('DELETE', '/api/finance/entries/:id', fin('finance:entry', (c) => C.deleteEntry(deps, c.user, c.params.id, c.ip)));
  r.add('POST', '/api/finance/entries/:id/post', fin('finance:post', (c, b) => C.postEntry(deps, c.user, c.params.id, c.ip)));
  r.add('POST', '/api/finance/entries/:id/reverse', finC('finance:post', (c, b) => C.reverseEntry(deps, c.user, c.params.id, b, c.ip)));

  /* ---- الأطراف ---- */
  r.add('GET', '/api/finance/parties', fin('finance:read', (_c, _b, q) => {
    C.ready(db);
    const w = [], a = [];
    if (q.kind) { w.push('kind=?'); a.push(q.kind); }
    if (q.q) { const l = `%${q.q.slice(0, 40)}%`; w.push("name LIKE ? ESCAPE '\\'"); a.push(l); }
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
    return { parties: db.prepare(`SELECT * FROM fin_parties ${where} ORDER BY name LIMIT 200`).all(...a) };
  }));
  r.add('POST', '/api/finance/parties', finC('finance:setup', (c, b) => {
    C.ready(db);
    const name = C.clean(b?.name, 100, 'اسم الطرف', 2), kind = ['supplier','customer','employee','other'].includes(b?.kind) ? b.kind : 'other';
    const accId = b?.accountId ? Number(b.accountId) : null;
    if (accId && !db.prepare('SELECT 1 FROM fin_accounts WHERE id=? AND active=1 AND postable=1').get(accId)) throw C.bad('الحساب غير صالح.');
    const id = Number(db.prepare('INSERT INTO fin_parties (kind,name,phone,email,notes,account_id,created_at) VALUES (?,?,?,?,?,?,?)').run(kind, name, b?.phone ?? null, b?.email ?? null, b?.notes ?? null, accId, Date.now()).lastInsertRowid);
    return { party: db.prepare('SELECT * FROM fin_parties WHERE id=?').get(id) };
  }));
  r.add('PUT', '/api/finance/parties/:id', fin('finance:setup', (c, b) => {
    C.ready(db);
    const p = db.prepare('SELECT * FROM fin_parties WHERE id=?').get(Number(c.params.id)); if (!p) throw C.bad('الطرف غير موجود.', 404, 'not_found');
    const name = C.clean(b?.name ?? p.name, 100, 'اسم الطرف', 2), kind = ['supplier','customer','employee','other'].includes(b?.kind) ? b.kind : p.kind;
    db.prepare('UPDATE fin_parties SET name=?,kind=?,phone=?,email=?,notes=?,account_id=? WHERE id=?').run(name, kind, b?.phone ?? p.phone, b?.email ?? p.email, b?.notes ?? p.notes, b?.accountId ?? p.account_id, p.id);
    return { party: db.prepare('SELECT * FROM fin_parties WHERE id=?').get(p.id) };
  }));
  r.add('POST', '/api/finance/parties/:id/toggle', fin('finance:setup', (c, b) => {
    C.ready(db);
    db.prepare('UPDATE fin_parties SET active=? WHERE id=?').run(b?.active !== false ? 1 : 0, Number(c.params.id)); return { ok: true };
  }));

  /* ---- مراكز الكلفة ---- */
  r.add('GET', '/api/finance/cost-centers', fin('finance:read', () => {
      C.ready(db); return { costCenters: db.prepare('SELECT cc.*, u.name unit_name FROM fin_cost_centers cc LEFT JOIN org_units u ON u.id=cc.unit_id ORDER BY cc.code').all() };
  }));
  r.add('POST', '/api/finance/cost-centers', finC('finance:setup', (c, b) => {
    C.ready(db);
    const code = C.clean(b?.code, 20, 'رمز مركز الكلفة'), name = C.clean(b?.name, 100, 'اسم مركز الكلفة', 2);
    if (db.prepare('SELECT 1 FROM fin_cost_centers WHERE code=?').get(code)) throw C.bad('الرمز مستخدم.', 409, 'conflict');
    const id = Number(db.prepare('INSERT INTO fin_cost_centers (code,name,unit_id) VALUES (?,?,?)').run(code, name, b?.unitId ?? null).lastInsertRowid);
    return { costCenter: db.prepare('SELECT * FROM fin_cost_centers WHERE id=?').get(id) };
  }));
  r.add('PUT', '/api/finance/cost-centers/:id', fin('finance:setup', (c, b) => {
    C.ready(db);
    const cc = db.prepare('SELECT * FROM fin_cost_centers WHERE id=?').get(Number(c.params.id)); if (!cc) throw C.bad('مركز الكلفة غير موجود.', 404, 'not_found');
    const code = C.clean(b?.code ?? cc.code, 20, 'رمز مركز الكلفة'), name = C.clean(b?.name ?? cc.name, 100, 'اسم مركز الكلفة', 2);
    if (code !== cc.code && db.prepare('SELECT 1 FROM fin_cost_centers WHERE code=? AND id!=?').get(code, cc.id)) throw C.bad('الرمز مستخدم.', 409, 'conflict');
    db.prepare('UPDATE fin_cost_centers SET code=?,name=?,unit_id=? WHERE id=?').run(code, name, b?.unitId ?? cc.unit_id, cc.id);
    return { costCenter: db.prepare('SELECT * FROM fin_cost_centers WHERE id=?').get(cc.id) };
  }));
  r.add('POST', '/api/finance/cost-centers/:id/toggle', fin('finance:setup', (c, b) => {
    C.ready(db); db.prepare('UPDATE fin_cost_centers SET active=? WHERE id=?').run(b?.active !== false ? 1 : 0, Number(c.params.id)); return { ok: true };
  }));

  /* ---- العملات ---- */
  r.add('GET', '/api/finance/currencies', fin('finance:read', () => {
    C.ready(db); return { currencies: db.prepare('SELECT * FROM fin_currencies ORDER BY is_base DESC, code').all() };
  }));
  r.add('PUT', '/api/finance/currencies/:code', fin('finance:setup', (c, b) => {
    C.ready(db);
    const cur = db.prepare('SELECT * FROM fin_currencies WHERE code=?').get(c.params.code); if (!cur) throw C.bad('العملة غير موجودة.', 404, 'not_found');
    if (b?.rate !== undefined) { const r = Number(b.rate); if (!Number.isFinite(r) || r <= 0) throw C.bad('سعر الصرف غير صالح.'); db.prepare('UPDATE fin_currencies SET rate=? WHERE code=?').run(r, cur.code); }
    if (b?.active !== undefined) db.prepare('UPDATE fin_currencies SET active=? WHERE code=?').run(b.active ? 1 : 0, cur.code);
    return { currency: db.prepare('SELECT * FROM fin_currencies WHERE code=?').get(cur.code) };
  }));

  /* ---- التقارير ---- */
  r.add('GET', '/api/finance/reports/trial-balance', fin('finance:read', (_c, _b, q) => R.trialBalance(deps, q)));
  r.add('GET', '/api/finance/reports/ledger', fin('finance:read', (_c, _b, q) => R.ledger(deps, q)));
  r.add('GET', '/api/finance/reports/income', fin('finance:read', (_c, _b, q) => R.incomeStatement(deps, q)));
  r.add('GET', '/api/finance/reports/balance-sheet', fin('finance:read', (_c, _b, q) => R.balanceSheet(deps, q)));
  r.add('GET', '/api/finance/reports/cash-book', fin('finance:read', (_c, _b, q) => R.cashBook(deps, q)));
  r.add('GET', '/api/finance/reports/cost-centers', fin('finance:read', (_c, _b, q) => R.costCenterReport(deps, q)));
  r.add('GET', '/api/finance/reports/party', fin('finance:read', (_c, _b, q) => R.partyStatement(deps, q)));

  /* إكسل - ميزان المراجعة */
  r.add('GET', '/api/finance/reports/trial-balance.xlsx', async (c) => {
    need(c, 'finance:read');
    const { from, to } = c.query;
    const tb = R.trialBalance(deps, { from, to });
    const { writeXlsx: wx } = await xlsx();
    const buf = await wx([{ name: 'ميزان المراجعة', rows: tb.rows.map((r) => [r.code, r.name, r.openDebit, r.openCredit, r.debit, r.credit, r.closeDebit, r.closeCredit]), headers: ['الرمز','الحساب','مدين افتتاحي','دائن افتتاحي','مدين','دائن','مدين ختامي','دائن ختامي'] }]);
    c.res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.res.setHeader('Content-Disposition', 'attachment; filename="trial-balance.xlsx"');
    c.res.end(buf);
  });

  /* ---- رسوم الطلاب ---- */
  r.add('GET', '/api/finance/fee-types', fin('finance:fees', () => F.listFeeTypes(deps)));
  r.add('POST', '/api/finance/fee-types', fin('finance:fees', (c, b) => F.saveFeeType(deps, c.user, b, c.ip)));
  r.add('POST', '/api/finance/fee-types/:id/toggle', fin('finance:fees', (c, b) => F.toggleFeeType(deps, c.user, c.params.id, b?.active !== false, c.ip)));
  r.add('GET', '/api/finance/charges', fin('finance:fees', (_c, _b, q) => ({ charges: F.listCharges(deps, q) })));
  r.add('POST', '/api/finance/charges', finC('finance:fees', (c, b) => F.createCharge(deps, c.user, b, c.ip)));
  r.add('POST', '/api/finance/charges/:id/void', fin('finance:fees', (c, b) => F.voidCharge(deps, c.user, c.params.id, b, c.ip)));
  r.add('GET', '/api/finance/payments', fin('finance:fees', (_c, _b, q) => ({ payments: F.listPayments(deps, q) })));
  r.add('POST', '/api/finance/payments', finC('finance:fees', (c, b) => F.createPayment(deps, c.user, b, c.ip)));
  r.add('POST', '/api/finance/payments/:id/void', fin('finance:fees', (c, b) => F.voidPayment(deps, c.user, c.params.id, b, c.ip)));
  r.add('GET', '/api/finance/student-statement/:id', fin('finance:fees', (c) => F.studentStatement(deps, c.params.id)));
  r.add('POST', '/api/finance/payroll-entry', fin('finance:post', (c, b) => F.payrollEntry(deps, c.user, b, c.ip)));
  r.add('POST', '/api/finance/years/:id/close', fin('finance:setup', (c, b) => F.closeYear(deps, c.user, c.params.id, c.ip)));

  /* ---- رسوم الطالب (self) ---- */
  r.add('GET', '/api/me/fees', async (c) => {
    if (!c.user) { c.res.writeHead(401); c.res.end(); return; }
    if (c.user.role !== 'student' && !c.user.can('finance:fees')) { c.res.writeHead(403); c.res.end(); return; }
    const id = c.user.role === 'student' ? c.user.id : Number(c.query?.studentId ?? c.user.id);
    c.json(F.studentStatement(deps, id));
  });
}

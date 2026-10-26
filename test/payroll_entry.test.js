// قيد الرواتب: من hr_salaries إلى قيد محاسبي (مدين رواتب وأجور / دائن رواتب مستحقة)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payroll-entry-'));
const app = await createApp({ dbPath: path.join(dir, 't.db'), jwtSecret: 'test', backupAuto: false });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + app.server.address().port;
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('admin','م',?, 'admin', ?)").run(await hashPassword('Test#Pass12345', 1024), Date.now());
const lr = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Test#Pass12345' }) });
const ck = lr.headers.get('set-cookie').split(';')[0];
const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { cookie: ck, ...(b ? { 'Content-Type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
const unit = app.db.prepare('SELECT id FROM org_units LIMIT 1').get();
const emp = async (n, hire, amount) => {
  const e = await call('POST', '/api/admin/hr/employees', { name: 'موظف ' + n, employeeNo: 'E' + n, personalId: 'P' + n, email: `e${n}@x.com`, phone: '09' + n, hireDate: hire, unit_id: unit.id, position: 'محاسب' });
  const id = e.j?.employee?.id ?? e.j?.id; assert.ok(id, 'employee created');
  if (amount) assert.equal((await call('POST', '/api/admin/hr/salaries', { employee_id: id, amount })).s, 201);
};
const month = (() => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();

test('معاينة الشهر: آخر راتب للفعّالين، ومن بلا راتب يُنبَّه إليه', async () => {
  await emp('001', '2024-01-01', 2500000); await emp('002', '2025-06-01', 3000000); await emp('003', '2024-01-01', 0);
  await emp('004', '2999-01-01', 1000000);               // تعيين مستقبلي: لا يدخل
  const p = await call('GET', '/api/finance/payroll-preview?month=' + month);
  assert.equal(p.s, 200); assert.equal(p.j.rows.length, 2); assert.equal(p.j.total, 5500000); assert.equal(p.j.missing.length, 1);
  assert.equal(p.j.entry, null);
  assert.equal((await call('GET', '/api/finance/payroll-preview?month=2026-13')).s, 400);
});

test('إنشاء القيد مرة واحدة: مرحَّل ومتوازن ويرفض التكرار والشهر الفارغ', async () => {
  const r = await call('POST', '/api/finance/payroll-entry', { month });
  assert.equal(r.s, 200); assert.equal(r.j.employees, 2); assert.equal(r.j.total, 5500000);
  const rows = app.db.prepare("SELECT a.system_key k, SUM(l.debit) d, SUM(l.credit) c FROM fin_lines l JOIN fin_accounts a ON a.id=l.account_id JOIN fin_entries e ON e.id=l.entry_id WHERE e.source=? AND e.status='posted' GROUP BY a.system_key").all('payroll:' + month);
  const by = Object.fromEntries(rows.map((x) => [x.k, x]));
  assert.equal(by.salaries_exp.d, 550000000); assert.equal(by.salaries_pay.c, 550000000);
  assert.equal((await call('POST', '/api/finance/payroll-entry', { month })).s, 409);
  assert.equal((await call('POST', '/api/finance/payroll-entry', { month: '2020-01' })).s, 400);
  const m = (await call('GET', '/api/finance/payroll-months')).j.months[0];
  assert.equal(m.entry.status, 'posted'); assert.equal(m.entry.reversed, false);
});

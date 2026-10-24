import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ensureStructure } from '../server/services/structure.js';
import { ensureForms } from '../server/services/forms/index.js';
import { readXlsx } from '../server/lib/xlsx.js';
import { workingDays, dayKey } from '../server/services/staffatt.js';

const PW = 'Test#Pass12345';
let app, base, c;
const call = async (m, u, ck, body) => { const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(ck ? { Cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j, r }; };
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
async function leave(ck, type, from, to) {
  const svc = (await call('GET', '/api/services', ck)).j.services.find((s) => s.code === 'hr_leave');
  const f = (l) => svc.fields.find((x) => x.label === l).name;
  const d = { [f('الرقم الوظيفي')]: 'E1', [f('نوع الإجازة')]: type, [f('من تاريخ')]: from, [f('إلى تاريخ')]: to, [f('عدد الأيام')]: 1, [f('الموظف البديل')]: 'زميل', [f('رقم هاتف للتواصل')]: '0944123456' };
  return call('POST', '/api/requests', ck, { service: 'hr_leave', details: d });
}

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-att-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  const ins = (u, n, role, no) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,?,?,?)').run(u, n, h, role, no ?? null, Date.now());
  ins('admin', 'مدير', 'admin'); ins('s1', 'ليلى', 'student', '2024-1087');
  await ensureStructure(app, { activate: true, password: PW }); ensureForms(app);
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  c = Object.fromEntries(await Promise.all(['admin', 'hr', 'library', 's1'].map(async (u) => [u, await login(u)])));
});
test.after(async () => { await app.close(); });

test('أيام العمل تستثني الجمعة والسبت، ومفتاح اليوم بتوقيت دمشق', () => {
  assert.equal(workingDays('2026-11-02', '2026-11-06'), 4);   // الإثنين–الجمعة
  assert.equal(workingDays('2026-11-06', '2026-11-07'), 0);
  assert.equal(workingDays('2026-11-02', '2026-11-15'), 10);
  assert.equal(workingDays('2026-11-05', '2026-11-02'), 0);
  assert.equal(dayKey(Date.parse('2026-10-23T21:30:00Z')), '2026-10-24');   // بعد منتصف الليل في دمشق (+3)
});

test('البصمة: دخول ثم خروج، ولا وصول للطلاب', async () => {
  const a = await call('POST', '/api/hr/attendance/punch', c.library, {});
  assert.equal(a.s, 200); assert.equal(a.j.today.out, null); assert.ok(a.j.today.in);
  const b = await call('POST', '/api/hr/attendance/punch', c.library, {});
  assert.ok(b.j.today.out >= b.j.today.in);
  const me = (await call('GET', '/api/hr/attendance/me', c.library)).j;
  assert.equal(me.today.in, a.j.today.in); assert.equal(me.history.length >= 1, true); assert.equal(me.leave.entitlement, 30); assert.equal(me.leave.remaining, 30);
  assert.equal((await call('POST', '/api/hr/attendance/punch', c.s1, {})).s, 403);
  assert.equal((await call('GET', '/api/hr/attendance/me')).s, 401);
});

test('تقرير اليوم للمسؤول فقط، مع تصدير Excel', async () => {
  const today = dayKey(Date.now());
  assert.equal((await call('GET', `/api/hr/attendance?date=${today}`, c.library)).s, 403);
  const r = (await call('GET', `/api/hr/attendance?date=${today}`, c.hr)).j;
  assert.ok(r.rows.some((x) => x.name && x.in && x.username === 'library'));
  const x = await fetch(base + `/api/hr/attendance/export.xlsx?month=${today.slice(0, 7)}`, { headers: { Cookie: c.hr } });
  assert.equal(x.status, 200);
  const wb = readXlsx(Buffer.from(await x.arrayBuffer()));
  assert.ok(wb.sheets[0].rows.length >= 2);
  assert.equal((await fetch(base + '/api/hr/attendance/export.xlsx', { headers: { Cookie: c.library } })).status, 403);
});

test('الإجازة: اعتماد طلب إجازة اعتيادية يخصم من الرصيد ويُحسب على أيام العمل', async () => {
  const q = await leave(c.library, 'اعتيادية', '2026-11-02', '2026-11-06');
  assert.equal(q.s, 201);
  assert.equal((await call('POST', `/api/requests/${q.j.request.id}/approve`, c.hr, {})).s, 200);
  const me = (await call('GET', '/api/hr/attendance/me', c.library)).j;
  assert.equal(me.leave.used, 4); assert.equal(me.leave.remaining, 26); assert.equal(me.leaves.length, 1); assert.equal(me.leaves[0].days, 4);
  const rep = (await call('GET', '/api/hr/attendance?date=2026-11-03', c.hr)).j;
  assert.equal(rep.rows.find((x) => x.username === 'library').leave, 'اعتيادية');
});

test('رصيد غير كافٍ يمنع الاعتماد، والمرضية لا تُخصم، وتعديل الاستحقاق', async () => {
  await call('PUT', '/api/hr/settings', c.hr, { leaveDefaultDays: 30 });
  const big = await leave(c.library, 'اعتيادية', '2026-12-01', '2027-02-27');   // أكثر من 26 يوم عمل
  const bad = await call('POST', `/api/requests/${big.j.request.id}/approve`, c.hr, {});
  assert.equal(bad.s, 409); assert.match(bad.j.message, /الرصيد/);
  assert.equal((await call('GET', `/api/requests/${big.j.request.id}`, c.hr)).j.request.status, 'review');
  const sick = await leave(c.library, 'مرضية', '2026-12-01', '2026-12-31');
  assert.equal((await call('POST', `/api/requests/${sick.j.request.id}/approve`, c.hr, {})).s, 200);
  assert.equal((await call('GET', '/api/hr/attendance/me', c.library)).j.leave.remaining, 26);
  const uid = app.db.prepare("SELECT id FROM users WHERE username = 'library'").get().id;
  assert.equal((await call('PUT', '/api/hr/leave/entitlement', c.library, { userId: uid, year: 2026, days: 45 })).s, 403);
  assert.equal((await call('PUT', '/api/hr/leave/entitlement', c.hr, { userId: uid, year: 2026, days: 45 })).s, 200);
  assert.equal((await call('GET', '/api/hr/attendance/me', c.library)).j.leave.remaining, 41);
  assert.equal((await call('PUT', '/api/hr/leave/entitlement', c.hr, { userId: uid, year: 2026, days: -1 })).s, 400);
  const bal = (await call('GET', '/api/hr/leaves?year=2026', c.hr)).j.rows.find((x) => x.username === 'library');
  assert.equal(bal.entitlement, 45); assert.equal(bal.used, 4);
});

test('إعدادات الحضور والإجازات: الاستحقاق الافتراضي وعطلة نهاية الأسبوع قابلان للتعديل', async () => {
  const g = (await call('GET', '/api/hr/settings', c.hr)).j.settings;
  assert.equal(g.leaveDefaultDays, 30); assert.equal(g.weekend, 'fri,sat');
  assert.equal((await call('GET', '/api/hr/settings', c.library)).s, 403);
  assert.equal((await call('PUT', '/api/hr/settings', c.library, { leaveDefaultDays: 20 })).s, 403);
  assert.equal((await call('PUT', '/api/hr/settings', c.hr, { leaveDefaultDays: 400 })).s, 400);
  assert.equal((await call('PUT', '/api/hr/settings', c.hr, { weekend: 'mon' })).s, 400);
  assert.equal((await call('PUT', '/api/hr/settings', c.hr, { leaveDefaultDays: 20, weekend: 'fri' })).s, 200);
  // من لا استحقاق مخصّصاً له يتأثر بالافتراضي الجديد؛ ومن له استحقاق مخصّص لا يتأثر
  assert.equal((await call('GET', '/api/hr/attendance/me', c.library)).j.leave.entitlement, 45);
  assert.equal((await call('GET', '/api/hr/attendance/me', c.hr)).j.leave.entitlement, 20);
  assert.equal(workingDays('2026-11-06', '2026-11-07', 'fri'), 1);          // السبت يومُ عملٍ حين تكون العطلة الجمعة فقط
  const q = await leave(c.hr, 'اعتيادية', '2026-11-07', '2026-11-07');       // سبت
  assert.equal((await call('POST', `/api/requests/${q.j.request.id}/approve`, c.admin, {})).s, 200);
  assert.equal((await call('GET', '/api/hr/attendance/me', c.hr)).j.leave.used, 1);
  await call('PUT', '/api/hr/settings', c.hr, { leaveDefaultDays: 30, weekend: 'fri,sat' });
});

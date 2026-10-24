import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ensureStructure } from '../server/services/structure.js';
import { readXlsx, writeXlsx } from '../server/lib/xlsx.js';

const PW = 'Test#Pass12345';
let app, base, adm, hr, s1;
const call = async (m, u, { body, cookie } = {}) => fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const b64 = (rows) => writeXlsx([{ name: 'النموذج', rows }]).toString('base64');

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-xl-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  const ins = (u, n, role, no) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,?,?,?)').run(u, n, h, role, no ?? null, Date.now());
  ins('admin', 'مدير', 'admin'); ins('s1', 'ليلى الحسن', 'student', '2024-1087');
  await ensureStructure(app, { activate: true, password: PW });
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  [adm, hr, s1] = await Promise.all(['admin', 'hr', 's1'].map(login));
  const svc = (code, audience, extra = {}) => call('POST', '/api/admin/services', { cookie: adm, body: { code, label: `خدمة ${code}`, description: 'وصف الخدمة', slaHours: 24, unit: 'hr', audience, category: 'اختبار', instructions: 'تعليمات', issuesDocument: false,
    fields: [{ label: 'السبب', type: 'textarea', required: true }, { label: 'المبلغ', type: 'decimal', min: 0, max: 100 }, { label: 'النوع', type: 'select', options: ['أ', 'ب'], required: true }, { label: 'التاريخ', type: 'date' }], ...extra } });
  assert.equal((await svc('xl_staff', 'staff')).status, 200);
  assert.equal((await svc('xl_stu', 'student')).status, 200);
  assert.equal((await svc('xl_att', 'staff', { requiresAttachment: true, attachments: [{ label: 'م', required: true }] })).status, 200);
});
test.after(async () => { await app.close(); });

test('القالب: ثلاث أوراق وقوائم وقيود إدخال', async () => {
  const r = await call('GET', '/api/services/xl_stu/template.xlsx', { cookie: s1 });
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer()), wb = readXlsx(buf);
  assert.deepEqual(wb.sheets.map((x) => x.name), ['تعليمات', 'النموذج', 'القوائم']);
  assert.deepEqual(wb.sheets[1].rows[0], ['الرقم الجامعي', 'السبب *', 'المبلغ', 'النوع *', 'التاريخ']);
  assert.ok(buf.toString('latin1').length > 0);
  const staff = readXlsx(Buffer.from(await (await call('GET', '/api/services/xl_staff/template.xlsx', { cookie: hr })).arrayBuffer()));
  assert.equal(staff.sheets[1].rows[0][0], 'السبب *');
  assert.equal((await call('GET', '/api/services/nope/template.xlsx', { cookie: hr })).status, 404);
  assert.equal((await call('GET', '/api/services/xl_stu/template.xlsx')).status, 401);
});

test('الاستيراد: فحص ثم اعتماد مع أخطاء لكل صف', async () => {
  const rows = [['الرقم الجامعي', 'السبب *', 'المبلغ', 'النوع *', 'التاريخ'], ['2024-1087', 'سبب أول', '12.5', 'أ', '2026-11-01'], ['9999', 'x', '', 'أ', ''], ['2024-1087', 'سبب', '500', 'أ', ''], ['2024-1087', 'سبب ثان', '', 'ب', '']];
  const pv = await (await call('POST', '/api/services/xl_stu/import', { cookie: hr, body: { filename: 'a.xlsx', data: b64(rows), commit: false } })).json();
  assert.equal(pv.valid, 2); assert.equal(pv.errorCount, 2); assert.equal(pv.created, 0);
  assert.deepEqual(pv.errors.map((e) => e.row), [3, 4]);
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM requests WHERE service_code='xl_stu'").get().n, 0);
  const cm = await (await call('POST', '/api/services/xl_stu/import', { cookie: hr, body: { filename: 'a.xlsx', data: b64(rows), commit: true } })).json();
  assert.equal(cm.created, 2);
  const q = app.db.prepare("SELECT r.assigned_unit_id, u.student_no FROM requests r JOIN users u ON u.id = r.student_id WHERE service_code='xl_stu'").all();
  assert.equal(q.length, 2); assert.ok(q.every((x) => x.student_no === '2024-1087' && x.assigned_unit_id));
  assert.equal((await call('POST', '/api/services/xl_stu/import', { cookie: s1, body: { data: b64(rows) } })).status, 403);
});

test('الاستيراد: خدمة موظفين تُقدَّم باسم المستورِد، والخدمات ذات المرفقات مرفوضة', async () => {
  const rows = [['السبب *', 'النوع *'], ['حاجة', 'أ']];
  const r = await (await call('POST', '/api/services/xl_staff/import', { cookie: hr, body: { data: b64(rows), commit: true } })).json();
  assert.equal(r.created, 1);
  const hrId = app.db.prepare("SELECT id FROM users WHERE username='hr'").get().id;
  assert.equal(app.db.prepare("SELECT student_id FROM requests WHERE service_code='xl_staff'").get().student_id, hrId);
  assert.equal((await call('POST', '/api/services/xl_att/import', { cookie: hr, body: { data: b64(rows) } })).status, 400);
  assert.equal((await call('POST', '/api/services/xl_staff/import', { cookie: hr, body: { data: b64([['عمود'], ['x']]) } })).status, 400);
});

test('التصدير: ضمن نطاق المستخدم مع أعمدة الحقول', async () => {
  const r = await call('GET', '/api/requests/export.xlsx?service=xl_stu', { cookie: adm });
  assert.equal(r.status, 200);
  const wb = readXlsx(Buffer.from(await r.arrayBuffer())), rows = wb.sheets[0].rows;
  assert.equal(rows.length, 3); assert.ok(rows[0].includes('السبب')); assert.equal(rows[1][3], '2024-1087');
  assert.equal(wb.sheets[1].name, 'ملخص');
  const own = readXlsx(Buffer.from(await (await call('GET', '/api/requests/export.xlsx', { cookie: s1 })).arrayBuffer())).sheets[0].rows;
  assert.equal(own.length, 3);
  assert.equal((await call('GET', '/api/requests/export.xlsx')).status, 401);
});

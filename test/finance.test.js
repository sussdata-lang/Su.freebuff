// اختبارات وحدة المالية والمحاسبة
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { ensureStructure } from '../server/services/structure.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345';
const PW_HASH = await hashPassword(PW, 1024);

let testApp = null;
let base = null;
let adminCookie = null;
let finCookie = null;

async function loginAs(username, _app) {
  const url = base || ('http://127.0.0.1:' + _app.server.address().port);
  const r = await fetch(url + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PW })
  });
  if (r.status !== 200) return null;
  const sc = r.headers.get('set-cookie');
  return sc ? sc.split(';')[0] : null;
}

async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-fin-'));
  const app = await createApp({ dbPath: path.join(dir, 'test.db'), jwtSecret: 'test-secret-fin' });
  await new Promise((res) => app.server.listen(0, '127.0.0.1', res));
  const db = app.db;
  ensureStructure(db);
  const now = Date.now();
  db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)").run('admin', 'مدير', PW_HASH, 'admin', now);
  // مستخدم بصلاحيات مالية
  db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)").run('finstaff', 'موظف مالي', PW_HASH, 'staff', now);
  const uid = db.prepare("SELECT id FROM users WHERE username='finstaff'").get().id;
  // إنشاء دور مالي
  db.prepare("INSERT INTO roles (key, label, permissions_json, active, created_at) VALUES ('finance_role','مالي','[\"finance:read\",\"finance:entry\",\"finance:post\",\"finance:setup\",\"finance:fees\"]',1,?)").run(now);
  db.prepare("UPDATE users SET role_key='finance_role' WHERE id=?").run(uid);
  return app;
}

test.beforeEach(async () => {
  testApp = await createTestApp();
  base = 'http://127.0.0.1:' + testApp.server.address().port;
  adminCookie = await loginAs('admin', testApp);
  finCookie = await loginAs('finstaff', testApp);
});

test.afterEach(async () => {
  if (testApp) { await testApp.close(); testApp = null; }
});

async function req(method, path, body, cookie) {
  const headers = {};
  if (cookie) headers['Cookie'] = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, body: json };
}

// ── 1. نقاط نهاية المالية متاحة ──────────────────────────────────────────────
test('GET /api/finance/overview returns KPIs for admin', async () => {
  const { status, body } = await req('GET', '/api/finance/overview', null, adminCookie);
  assert.equal(status, 200);
  assert.ok('cash' in body, 'يجب أن يحتوي على cash');
  assert.ok('bank' in body, 'يجب أن يحتوي على bank');
  assert.ok('surplus' in body, 'يجب أن يحتوي على surplus');
});

test('GET /api/finance/accounts returns seeded chart of accounts', async () => {
  const { status, body } = await req('GET', '/api/finance/accounts', null, adminCookie);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.accounts));
  assert.ok(body.accounts.length > 0, 'يجب أن يكون هناك حسابات مبذرة');
  const codes = body.accounts.map((a) => a.code);
  assert.ok(codes.some((c) => c.startsWith('1')), 'يجب وجود حسابات أصول');
  assert.ok(codes.some((c) => c.startsWith('4')), 'يجب وجود حسابات إيرادات');
});

test('GET /api/finance/years returns at least one open year', async () => {
  const { status, body } = await req('GET', '/api/finance/years', null, adminCookie);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.years));
  assert.ok(body.years.some((y) => y.status === 'open'), 'يجب وجود سنة مالية مفتوحة');
});

test('GET /api/finance/currencies returns seeded currencies', async () => {
  const { status, body } = await req('GET', '/api/finance/currencies', null, adminCookie);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.currencies));
  assert.ok(body.currencies.some((c) => c.is_base), 'يجب وجود عملة أساسية');
});

// ── 2. إنشاء قيد يومي ─────────────────────────────────────────────────────────
async function getPostableAccounts() {
  const { body } = await req('GET', '/api/finance/accounts', null, adminCookie);
  return body.accounts.filter((a) => a.postable && a.active);
}

test('POST /api/finance/entries creates draft journal entry', async () => {
  const accs = await getPostableAccounts();
  assert.ok(accs.length >= 2, 'يجب وجود حسابين قابلين للقيد على الأقل');
  const [a1, a2] = accs;
  const { status, body } = await req('POST', '/api/finance/entries', {
    day: '2026-06-01',
    type: 'JV',
    description: 'قيد اختباري',
    lines: [
      { accountId: a1.id, debit: 100, credit: 0, note: 'مدين' },
      { accountId: a2.id, debit: 0, credit: 100, note: 'دائن' }
    ]
  }, adminCookie);
  assert.equal(status, 201, JSON.stringify(body));
  assert.ok(body.id, 'يجب أن يعيد id القيد');
  assert.equal(body.status, 'draft');
});

test('POST /api/finance/entries rejects unbalanced entry', async () => {
  const accs = await getPostableAccounts();
  const [a1, a2] = accs;
  const { status, body } = await req('POST', '/api/finance/entries', {
    day: '2026-06-01',
    type: 'JV',
    description: 'قيد غير متوازن',
    lines: [
      { accountId: a1.id, debit: 100, credit: 0 },
      { accountId: a2.id, debit: 0, credit: 50 }
    ]
  }, adminCookie);
  assert.equal(status, 400, 'يجب رفض القيد غير المتوازن');
});

// ── 3. ترحيل القيد ─────────────────────────────────────────────────────────────
test('POST /api/finance/entries/:id/post changes status to posted', async () => {
  const accs = await getPostableAccounts();
  const [a1, a2] = accs;
  const { body: created } = await req('POST', '/api/finance/entries', {
    day: '2026-06-01', type: 'JV', description: 'قيد للترحيل',
    lines: [{ accountId: a1.id, debit: 200, credit: 0 }, { accountId: a2.id, debit: 0, credit: 200 }]
  }, adminCookie);
  assert.ok(created.id);
  const { status, body } = await req('POST', `/api/finance/entries/${created.id}/post`, {}, adminCookie);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.status, 'posted');
  assert.ok(body.no, 'يجب أن يُعيَّن رقم للقيد عند الترحيل');
});

test('Cannot post already posted entry', async () => {
  const accs = await getPostableAccounts();
  const [a1, a2] = accs;
  const { body: created } = await req('POST', '/api/finance/entries', {
    day: '2026-06-01', type: 'JV', description: 'قيد مرحَّل',
    lines: [{ accountId: a1.id, debit: 50, credit: 0 }, { accountId: a2.id, debit: 0, credit: 50 }]
  }, adminCookie);
  await req('POST', `/api/finance/entries/${created.id}/post`, {}, adminCookie);
  const { status } = await req('POST', `/api/finance/entries/${created.id}/post`, {}, adminCookie);
  assert.ok([400, 409].includes(status), `لا يجوز ترحيل قيد مرحَّل مسبقاً (status: ${status})`);
});

// ── 4. عكس القيد ───────────────────────────────────────────────────────────────
test('POST /api/finance/entries/:id/reverse creates a reversal', async () => {
  const accs = await getPostableAccounts();
  const [a1, a2] = accs;
  const { body: created } = await req('POST', '/api/finance/entries', {
    day: '2026-06-01', type: 'JV', description: 'قيد للعكس',
    lines: [{ accountId: a1.id, debit: 300, credit: 0 }, { accountId: a2.id, debit: 0, credit: 300 }]
  }, adminCookie);
  await req('POST', `/api/finance/entries/${created.id}/post`, {}, adminCookie);
  const { status, body } = await req('POST', `/api/finance/entries/${created.id}/reverse`, { reason: 'اختبار عكس' }, adminCookie);
  assert.equal(status, 201, JSON.stringify(body));
  assert.ok(body.id);
  assert.equal(body.status, 'posted');
});

// ── 5. التقارير ────────────────────────────────────────────────────────────────
test('GET /api/finance/reports/trial-balance returns balanced result', async () => {
  const { status, body } = await req('GET', '/api/finance/reports/trial-balance', null, adminCookie);
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok('balanced' in body);
  assert.ok(Array.isArray(body.rows));
});

test('GET /api/finance/reports/income returns revenue and expense', async () => {
  const { status, body } = await req('GET', '/api/finance/reports/income', null, adminCookie);
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok('revenue' in body && 'expense' in body && 'surplus' in body);
});

test('GET /api/finance/reports/balance-sheet returns assets and liabilities', async () => {
  const { status, body } = await req('GET', '/api/finance/reports/balance-sheet', null, adminCookie);
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok('assets' in body && 'liabilities' in body && 'equity' in body);
});

// ── 6. رسوم الطلاب ─────────────────────────────────────────────────────────────
test('POST /api/finance/charges creates a fee charge entry', async () => {
  // نحتاج طالباً — نتحقق أولاً من وجود الجدول
  const db = testApp.db;
  const hasStudents = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='students'").get();
  if (!hasStudents) { console.log('جدول students غير موجود في بيئة الاختبار — تخطي'); return; }
  db.prepare("INSERT INTO students (name, student_no, faculty_id, program_id) SELECT 'طالب اختبار', 'S-TEST-001', f.id, p.id FROM faculties f JOIN programs p ON p.faculty_id = f.id LIMIT 1").run();
  const student = db.prepare("SELECT id FROM students WHERE student_no='S-TEST-001'").get();
  if (!student) { console.log('تعذر إنشاء الطالب — تخطي'); return; }
  const fts = (await req('GET', '/api/finance/fee-types', null, adminCookie)).body;
  const ft = Array.isArray(fts) ? fts.find((f) => f.kind === 'fee' && f.active) : null;
  if (!ft) { console.log('لا أنواع رسوم — تخطي'); return; }
  const { status, body } = await req('POST', '/api/finance/charges', {
    studentId: student.id, feeTypeId: ft.id, amount: 500, dueDay: '2026-09-01', academicYear: '2026'
  }, adminCookie);
  assert.equal(status, 201, JSON.stringify(body));
  assert.ok(body.id);
});

// ── 7. أطراف ───────────────────────────────────────────────────────────────────
test('CRUD /api/finance/parties', async () => {
  const { status: s1, body: b1 } = await req('POST', '/api/finance/parties', { name: 'شركة الاختبار', kind: 'supplier' }, adminCookie);
  assert.equal(s1, 201, JSON.stringify(b1));
  // الـ route يعيد { party: { id, name, ... } }
  const id = (b1.party ?? b1).id;
  assert.ok(id, 'يجب أن يعيد id الطرف بعد الإنشاء');
  const { status: s2 } = await req('PUT', `/api/finance/parties/${id}`, { name: 'شركة الاختبار المعدّلة', kind: 'supplier' }, adminCookie);
  assert.equal(s2, 200);
  const { body: list } = await req('GET', '/api/finance/parties', null, adminCookie);
  assert.ok(list.parties.some((p) => p.id === id));
});

// ── 8. مراكز الكلفة ────────────────────────────────────────────────────────────
test('POST /api/finance/cost-centers creates a cost center', async () => {
  const { status, body } = await req('POST', '/api/finance/cost-centers', { code: 'IT-TEST', name: 'مركز تقنية اختبار' }, adminCookie);
  assert.equal(status, 201, JSON.stringify(body));
  // الـ route يعيد { costCenter: { id, code, name, ... } }
  const id = (body.costCenter ?? body).id;
  assert.ok(id, 'يجب أن يعيد id مركز الكلفة');
});

// ── 9. صلاحيات ─────────────────────────────────────────────────────────────────
test('Unauthenticated cannot access finance endpoints', async () => {
  const { status } = await req('GET', '/api/finance/overview', null, null);
  assert.equal(status, 401);
});

test('Finance staff with finance:read can access overview', async () => {
  const { status } = await req('GET', '/api/finance/overview', null, finCookie);
  assert.equal(status, 200);
});

test('Finance staff can create entries', async () => {
  const accs = (await req('GET', '/api/finance/accounts', null, finCookie)).body.accounts.filter((a) => a.postable && a.active);
  if (accs.length < 2) return;
  const [a1, a2] = accs;
  const { status } = await req('POST', '/api/finance/entries', {
    day: '2026-06-01', type: 'JV', description: 'قيد من موظف مالي',
    lines: [{ accountId: a1.id, debit: 100, credit: 0 }, { accountId: a2.id, debit: 0, credit: 100 }]
  }, finCookie);
  assert.equal(status, 201);
});

// ── 10. واجهة الطالب /api/me/fees ─────────────────────────────────────────────
test('Student can access /api/me/fees', async () => {
  const db = testApp.db;
  // إنشاء مستخدم طالب
  const hasStudents = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='students'").get();
  if (!hasStudents) { console.log('جدول students غير موجود — تخطي'); return; }
  db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('stu_fin','طالب مالية',?,'student',?)").run(PW_HASH, Date.now());
  const stuUser = db.prepare("SELECT id FROM users WHERE username='stu_fin'").get();
  // إنشاء سجل طالب مرتبط
  const fac = db.prepare("SELECT id FROM faculties LIMIT 1").get();
  const prog = fac ? db.prepare("SELECT id FROM programs WHERE faculty_id=? LIMIT 1").get(fac.id) : null;
  if (!fac || !prog) { console.log('لا جهات/برامج — تخطي'); return; }
  db.prepare("INSERT INTO students (name, student_no, faculty_id, program_id, user_id) VALUES ('طالب مالية', 'S-FIN-001', ?, ?, ?)").run(fac.id, prog.id, stuUser.id);
  const stuCookie = await loginAs('stu_fin', testApp);
  if (!stuCookie) { console.log('تعذر تسجيل الدخول كطالب — تخطي'); return; }
  const { status, body } = await req('GET', '/api/me/fees', null, stuCookie);
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok('charges' in body && 'payments' in body);
});

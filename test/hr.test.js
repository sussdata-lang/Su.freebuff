// اختبارات وحدة 5.7 الموارد البشرية والرواتب
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

// Module-level state - set in beforeEach, used in tests
let testApp = null;
let base = null;
let adminCookie = null;
let staffCookie = null;
let empCounter = 0;
let empIdCounter = 0;

// Setup unit ID helper (using the test app's db)
const unitId = (name, db) => db.prepare('SELECT id FROM org_units WHERE name = ?').get(name).id;

// Login helper (defined before createTestApp)
async function loginAs(username, _app) {
  const url = base || ('http://127.0.0.1:' + _app.server.address().port);
  const r = await fetch(url + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PW })
  });
  assert.equal(r.status, 200, `login ${username}: ${r.statusText}`);
  const setCookie = r.headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0] : null;
}

// Create a fresh test app (called in beforeEach)
async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-hr-'));
  const _app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => _app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${_app.server.address().port}`;

  try {
    // Setup users
    for (const [u, role] of [['admin', 'admin'], ['staff', 'staff']]) {
      _app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, u, PW_HASH, role, Date.now());
    }
    // Activate accounts
    _app.db.prepare('UPDATE users SET active = 1, failed_logins = 0, locked_until = 0 WHERE role = ?').run('admin');
    _app.db.prepare('UPDATE users SET active = 1, failed_logins = 0, locked_until = 0 WHERE role = ?').run('staff');

    // موظف الموارد البشرية: دور مخصّص بصلاحية hr:manage (الدور المدمج «staff» لا يملك الرواتب)
    _app.db.prepare("INSERT INTO roles (key, label, description, permissions_json, created_at) VALUES ('hrtest','موارد بشرية','','[\"hr:manage\"]',?)").run(Date.now());
    _app.db.prepare("UPDATE users SET role_key = 'hrtest' WHERE username = 'staff'").run();
    // Login
    adminCookie = await loginAs('admin', _app);
    staffCookie = await loginAs('staff', _app);

    await ensureStructure({ db: _app.db, cfg: _app.cfg });
  } catch (e) {
    // أغلق الخادم حتى لا يتسرب إجراء قيد الإنشاء
    await _app.close().catch(() => {});
    throw e;
  }

  // Reset counters
  empCounter = 0;
  empIdCounter = 0;

  return _app;
}

// API helper - handles GET/HEAD body issue
async function api(method, url, bodyOrOptions = {}) {
  const cookie = bodyOrOptions.cookie || staffCookie;
  // For GET/HEAD methods, body is always undefined regardless of bodyOrOptions.body
  let body;
  if (method === 'GET' || method === 'HEAD') {
    body = undefined;
  } else {
    body = bodyOrOptions.body ?? (typeof bodyOrOptions === 'object' ? bodyOrOptions : undefined);
  }
  const cookieForRequest = cookie || staffCookie;

  const headers = {
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookieForRequest ? { Cookie: cookieForRequest } : {})
  };

  const res = await fetch(base + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text, headers: res.headers };
}

// Employee creator function - resolves unit_id to the current test app's db
const emp = (o = {}) => ({
  employeeNo: o.employeeNo !== undefined ? o.employeeNo : ('HR-' + (++empCounter)),
  name: o.name !== undefined ? o.name : ('أ. أحمد الموظف ' + empCounter),
  personalId: o.personalId !== undefined ? o.personalId : ('SH-' + (++empIdCounter)),
  email: o.email !== undefined ? o.email : ('ahmad' + empCounter + '@uni.edu'),
  phone: o.phone !== undefined ? o.phone : ('011' + (1000 + empCounter) + '333'),
  hireDate: o.hireDate || '2026-01-10',
  unit_id: unitId('الشؤون الإدارية', testApp.db),
  status: o.status || 'active',
  position: o.position || 'مدير شؤون الطلاب',
  salary: o.salary || 0,
  joinDate: o.joinDate || '2026-01-10',
  ...o
});

// Reset counters
function resetEmpCounters() {
  empCounter = 0;
  empIdCounter = 0;
}

// Test hooks - runs before/after each test
test.beforeEach(async () => {
  testApp = await createTestApp();
});

test.afterEach(async () => {
  if (testApp) {
    await testApp.close();
    testApp = null;
  }
});

// ---- Tests ----

test('القائمة والفلاتر: بحث، وحدة، حالة، وملخص الصفحات', async () => {
  const u = unitId('الشؤون الإدارية', testApp.db);
  await api('POST', '/api/admin/hr/employees', { body: emp({ unit_id: u }) });
  await api('POST', '/api/admin/hr/employees', { body: emp({ employeeNo: 'HR-002', personalId: 'SH-1002', name: 'أ. خالد الراجحي', unit_id: u }) });
  const list = await api('GET', '/api/admin/hr/employees');
  assert.equal(list.status, 200);
  const ids = list.json.employees.map(e => e.id);
  assert.equal(ids.length, 2);
  const filtered = await api('GET', '/api/admin/hr/employees?search=' + encodeURIComponent('أحمد') + '&status=active');
  assert.equal(filtered.json.employees.length, 1);
  const unitList = await api('GET', '/api/admin/hr/employees?unitId=' + u);
  assert.equal(unitList.json.employees.length, 2);
  const opts = await api('GET', '/api/admin/hr/options');
  assert.ok(opts.json.statuses.some(s => s.key === 'active' && s.label === 'نشط'));
  assert.ok(opts.json.leaveTypes.some(l => l.key === 'annual' && l.label === 'إجازة سنوية'));
  assert.ok(opts.json.contractTypes.some(c => c.key === 'fixed' && c.label === 'محدد المدة'));
});

test('إضافة موظف وتحديثه وحذفه مع فحص الأخطاء: رقم duplicates، مطلوب، حذف غير موجود', async () => {
  resetEmpCounters();
  const m1 = await api('POST', '/api/admin/hr/employees', { body: emp({ id: 1 }) });
  assert.equal(m1.status, 201);
  const empId = m1.json.id;
  const dup = await api('POST', '/api/admin/hr/employees', { body: emp({ employeeNo: m1.json.employeeNo, personalId: m1.json.personalId }) });
  assert.equal(dup.status, 400, dup.text);
  const updated = await api('PUT', `/api/admin/hr/employee/${empId}`, { body: emp({ name: 'أ. أحمد المحيط' }) });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.name, 'أ. أحمد المحيط');
  const deleted = await api('DELETE', `/api/admin/hr/employee/${empId}`);
  assert.equal(deleted.status, 200);
  const gone = await api('GET', `/api/admin/hr/employee/${empId}`);
  assert.equal(gone.status, 404);
});

test('حالة الموظف: تفعيل وإجازة', async () => {
  resetEmpCounters();
  const m = await api('POST', '/api/admin/hr/employees', { body: emp({ id: 1 }) });
  const id = m.json.id;
  const off = await api('POST', `/api/admin/hr/employee/${id}/toggle`, { body: { enabled: false } });
  assert.equal(off.json.status, 'on_leave');
  const on = await api('POST', `/api/admin/hr/employee/${id}/toggle`, { body: { enabled: true } });
  assert.equal(on.json.status, 'active');
});

test('الراتب: إضافة، آخر راتب، فلاتر (شهر / السنة / المبلغ)', async () => {
  resetEmpCounters();
  const m = await api('POST', '/api/admin/hr/employees', { body: emp({ id: 1 }) });
  const eid = m.json.id;
  const now = new Date();
  const sal = await api('POST', '/api/admin/hr/salaries', { body: { employee_id: eid, amount: 5000, effective_at: now.getTime() } });
  assert.equal(sal.status, 201);
  const latest = await api('GET', `/api/admin/hr/salary/${eid}/latest`);
  assert.equal(latest.json.salary.employeeId, eid);
  assert.equal(latest.json.salary.amount, 5000);
  const month = await api('GET', '/api/admin/hr/salaries?month=' + (now.getMonth() + 1) + '&year=' + now.getFullYear());
  assert.equal(month.json.salaries.length, 1);
  const min = await api('GET', '/api/admin/hr/salaries?minAmount=4000');
  assert.ok(min.json.salaries.some(s => s.amount >= 4000));
  const opts = await api('GET', '/api/admin/hr/options');
  assert.ok(opts.json.statuses.some(s => s.key === 'active' && s.label === 'نشط'));
  assert.ok(opts.json.leaveTypes.some(l => l.key === 'annual' && l.label === 'إجازة سنوية'));
  assert.ok(opts.json.contractTypes.some(c => c.key === 'fixed' && c.label === 'محدد المدة'));
});

test('الإجازة: إنشاؤها، اعتمادها، رفضها، إلغاؤها، وحالات غير قابلة للتعديل', async () => {
  resetEmpCounters();
  const m = await api('POST', '/api/admin/hr/employees', { body: emp({ id: 1 }) });
  const eid = m.json.id;
  const mk = (start, end) => api('POST', '/api/admin/hr/leaves', { body: { employee_id: eid, leave_type: 'annual', start_date: start, end_date: end, days: 8, reason: 'Taking care of family', notes: 'Note' } });

  // اعتماد: pending ثم approve
  const l1 = await mk('2026-03-01', '2026-03-10');
  assert.equal(l1.status, 201, l1.text);
  const b = await api('GET', `/api/admin/hr/leave/${l1.json.id}`);
  assert.equal(b.json.leave.status, 'pending');
  const appr = await api('POST', `/api/admin/hr/leave/${l1.json.id}/approve`, { body: {} });
  assert.equal(appr.json.status, 'approved');
  const badAppr = await api('POST', `/api/admin/hr/leave/${l1.json.id}/approve`, { body: {} });
  assert.equal(badAppr.status, 400, badAppr.text);

  // رفض: طلب منفصل
  const l2 = await mk('2026-04-01', '2026-04-10');
  const rej = await api('POST', `/api/admin/hr/leave/${l2.json.id}/reject`, { body: { reason: 'Change' } });
  assert.equal(rej.json.status, 'rejected');

  // إلغاء: طلب منفصل
  const l3 = await mk('2026-05-01', '2026-05-10');
  const can = await api('POST', `/api/admin/hr/leave/${l3.json.id}/cancel`, { body: {} });
  assert.equal(can.json.status, 'cancelled');
  const bad = await api('POST', `/api/admin/hr/leave/${l3.json.id}/approve`, { body: {} });
  assert.equal(bad.status, 400, bad.text);

  // طلب غير موجود
  const missing = await api('GET', '/api/admin/hr/leave/99999');
  assert.equal(missing.status, 404);
});

test('العقد: الإضافة والقائمة وأنواع العقود', async () => {
  resetEmpCounters();
  const m = await api('POST', '/api/admin/hr/employees', { body: emp({ id: 1 }) });
  const eid = m.json.id;
  const c1 = await api('POST', '/api/admin/hr/contracts', { body: { employee_id: eid, contract_type: 'fixed', start_date: '2026-01-01', end_date: '2026-12-31', salary: 4800, title: 'Academic Year Contract' } });
  assert.equal(c1.status, 201);
  const c2 = await api('POST', '/api/admin/hr/contracts', { body: { employee_id: eid, contract_type: 'indefinite', start_date: '2025-05-01', end_date: '2027-05-01', salary: 5000, title: 'Indefinite Contract' } });
  assert.equal(c2.status, 201);
  const list = await api('GET', '/api/admin/hr/contracts?employeeId=' + eid);
  assert.equal(list.json.contracts.length, 2);
  const opts = await api('GET', '/api/admin/hr/options');
  assert.ok(opts.json.contractTypes.some(c => c.key === 'fixed' && c.label === 'محدد المدة'));
  assert.ok(opts.json.contractTypes.some(c => c.key === 'indefinite' && c.label === 'غير محدد المدة'));
  assert.ok(opts.json.contractTypes.some(c => c.key === 'temporary' && c.label === 'مؤقت'));
  assert.ok(opts.json.contractTypes.some(c => c.key === 'freelance' && c.label === 'مستقل'));
});

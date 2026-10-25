import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { verifyAuditChain } from '../server/audit.js';

const PW = 'Test#Pass12345';
let app, base, staff, auditor, stu, stu2, stuId, stu2Id, courseId;

async function api(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
async function loginAs(username, password = PW) {
  app.limiter.hits.clear();
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}
const form = (o = {}) => ({
  first_name: 'ليلى', father_name: 'أحمد', last_name: 'الحسن', mother_name: 'سعاد الخطيب', national_id: '01234567890', gender: 'أنثى', birth_date: '2006-03-14',
  birth_place: 'دمشق', nationality: 'سورية', phone: '0944123456', governorate: 'دمشق', city: 'المزة', address: 'شارع الجلاء',
  hs_type: 'الثانوية العامة - الفرع العلمي', hs_year: 2024, hs_score: 2100, program_id: 2, admission_type: 'القبول العام (المفاضلة)',
  enroll_year: 2024, enroll_term: 'الفصل الأول', study_level: 2, guardian_name: 'أحمد الحسن', guardian_relation: 'الأب', guardian_phone: '0933111222', ...o,
});

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-cfg-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  app.db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('grades_workflow', 'off')").run();   // هذه الاختبارات لا تخص مراحل الاعتماد
  const h = await hashPassword(PW, 1024);
  for (const [u, n, role] of [['staff', 'موظف', 'staff'], ['auditor', 'مدقق', 'auditor'], ['admin', 'مدير', 'admin']])
    app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, n, h, role, Date.now());
  staff = await loginAs('staff'); auditor = await loginAs('auditor');
  // طالبان بكلمة مرور معروفة (نتجاوز الإجبار على التغيير لتبسيط الاختبار)
  const a = await api('POST', '/api/students', { cookie: staff, body: form() });
  const b = await api('POST', '/api/students', { cookie: staff, body: form({ national_id: '01234567891', first_name: 'سامر', mother_name: 'هدى', program_id: 3 }) });
  stuId = a.json.student.id; stu2Id = b.json.student.id;
  app.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE role = ?').run(h, 'student');
  stu = await loginAs(a.json.student.username); stu2 = await loginAs(b.json.student.username);
});
test.after(async () => { await app.close(); });

const put = (values, ck) => api('PUT', '/api/admin/general', { cookie: ck, body: { values } });

test('الإعدادات العامة: القائمة بكل الأقسام والقيم الافتراضية، وللمدير وحده', async () => {
  const adm = await loginAs('admin');
  const r = await api('GET', '/api/admin/general', { cookie: adm });
  assert.equal(r.status, 200);
  const keys = r.json.tabs.map((t) => t.key);
  for (const k of ['institution', 'grades', 'academic', 'students', 'requests', 'security', 'hr', 'corr', 'faculty']) assert.ok(keys.includes(k), k);
  const all = r.json.tabs.flatMap((t) => t.items);
  assert.equal(all.find((i) => i.key === 'grades.practical_max').value, 30);
  assert.equal(all.find((i) => i.key === 'grades.pass_mark').value, 60);
  assert.equal(all.find((i) => i.key === 'hr.leave_default_days').value, 30);
  assert.ok(all.every((i) => i.changed === false));
  assert.equal((await api('GET', '/api/admin/general', { cookie: staff })).status, 403);
  assert.equal((await api('GET', '/api/admin/general')).status, 401);
});

test('علامة العملي: الحد 30 افتراضياً وقابل للتعديل، ومعه علامة النجاح والعلامة القصوى', async () => {
  const adm = await loginAs('admin');
  const c = await api('POST', '/api/courses', { cookie: staff, body: { programId: 2, level: 2, semester: 1, name: 'مقرر الإعدادات', hours: 3 } });
  const courseId = c.json.course.id;
  const enter = (o) => api('POST', `/api/students/${stuId}/grades`, { cookie: staff, body: { courseId, academicYear: '2024/2025', theory: 60, practical: 10, ...o } });
  assert.equal((await enter({ practical: 31 })).status, 400, 'أعلى من حد العملي 30');
  assert.equal((await enter({ practical: 30, theory: 60 })).status, 200);
  assert.equal((await put({ 'grades.practical_max': 40 }, adm)).status, 200);
  assert.equal((await enter({ practical: 40, theory: 55 })).status, 200);                    // الحد الجديد يسري فوراً
  assert.equal((await enter({ practical: 41, theory: 50 })).status, 400);
  // علامة النجاح
  const g1 = (await api('GET', `/api/students/${stuId}/grades`, { cookie: staff })).json;
  assert.ok(g1);
  assert.equal((await put({ 'grades.pass_mark': 95 }, adm)).status, 200);
  const me = (await api('GET', '/api/me/grades', { cookie: stu })).json;
  assert.equal(me.passMark, 95); assert.ok(me.grades.every((g) => g.passed === (g.total >= 95)));
  assert.equal((await api('GET', '/api/me')).json.limits.passMark, 95);
  // اتساق: لا نجاح فوق العلامة القصوى
  assert.equal((await put({ 'grades.pass_mark': 150 }, adm)).status, 400);
  assert.equal((await put({ 'grades.total_max': 50 }, adm)).status, 400);                      // النجاح 95 > 50
  assert.equal((await put({ 'grades.total_max': 200, 'grades.pass_mark': 120 }, adm)).status, 200);
});

test('الحفظ ذرّي ويُدقَّق، والإعادة إلى الافتراضي، ورفض القيم الخاطئة', async () => {
  const adm = await loginAs('admin');
  const before = (await api('GET', '/api/admin/general', { cookie: adm })).json.tabs.flatMap((t) => t.items).find((i) => i.key === 'security.password_min').value;
  const bad = await put({ 'security.password_min': 12, 'security.lock_minutes': 0 }, adm);        // الثاني غير صالح ← لا يُحفظ أي منهما
  assert.equal(bad.status, 400);
  assert.equal((await api('GET', '/api/admin/general', { cookie: adm })).json.tabs.flatMap((t) => t.items).find((i) => i.key === 'security.password_min').value, before);
  assert.equal((await put({ 'no.such': 1 }, adm)).status, 400);
  assert.equal((await put({ 'faculty.ranks': [] }, adm)).status, 400);
  assert.equal((await put({ 'corr.no_prefix': 'cor' }, adm)).status, 400);
  const ok = await put({ 'security.password_min': 12 }, adm);
  assert.equal(ok.status, 200); assert.equal(ok.json.changed, 1);
  assert.ok(app.db.prepare("SELECT 1 FROM audit_log WHERE action = 'تعديل الإعدادات العامة' AND ref LIKE '%security.password_min%'").get());
  const r = await api('POST', '/api/admin/general/reset', { cookie: adm, body: { keys: ['security.password_min'] } });
  assert.equal(r.status, 200); assert.equal(r.json.tabs.flatMap((t) => t.items).find((i) => i.key === 'security.password_min').value, 10);
});

test('سياسة كلمة المرور وقفل الحساب ومدة الجلسة من الإعدادات', async () => {
  const adm = await loginAs('admin');
  await put({ 'security.password_min': 14 }, adm);
  const mk = (pw) => api('POST', '/api/admin/users', { cookie: adm, body: { username: 'newu' + pw.length, displayName: 'مستخدم', role: 'staff', password: pw } });
  assert.equal((await mk('Abcdef12345')).status, 400);          // 11 حرفاً < 14
  assert.equal((await mk('Abcdef1234567890')).status, 201);
  await put({ 'security.password_min': 10, 'security.max_failed_logins': 3, 'security.lock_minutes': 1 }, adm);
  for (let i = 0; i < 3; i++) { app.limiter.hits.clear(); await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'auditor', password: 'wrong' }) }); }
  app.limiter.hits.clear();
  const locked = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'auditor', password: PW }) });
  assert.equal(locked.status, 423);                             // قُفل بعد 3 لا 5
  await put({ 'security.session_hours': 2 }, adm);
  app.db.prepare('UPDATE users SET locked_until = 0, failed_logins = 0').run(); app.limiter.hits.clear();
  const ok = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'staff', password: PW }) });
  assert.match(ok.headers.get('set-cookie'), /Max-Age=7200/);
});

test('قوائم الطلاب والدرجات العلمية والبادئة وسقف المرفقات والترويسة', async () => {
  const adm = await loginAs('admin');
  assert.equal((await put({ 'students.governorates': ['دمشق', 'مدينة جديدة'], 'faculty.ranks': ['بروفيسور', 'أستاذ'], 'corr.no_prefix': 'MEM', 'requests.max_attachment_mb': 1, 'institution.ministry': 'جهة اختبار', 'academic.levels': ['الاولى', 'الثانية'] }, adm)).status, 200);
  const opts = (await api('GET', '/api/registration/options', { cookie: staff })).json;
  const gov = JSON.stringify(opts);
  assert.ok(gov.includes('مدينة جديدة') && !gov.includes('حلب'));
  assert.equal((await api('POST', '/api/students', { cookie: staff, body: form({ national_id: '01234567899', governorate: 'حلب' }) })).status, 400);
  const fo = (await api('GET', '/api/faculty', { cookie: adm })).json.options;
  assert.deepEqual(fo.ranks, ['بروفيسور', 'أستاذ']);
  assert.equal((await api('POST', '/api/faculty', { cookie: adm, body: { name: 'د. اختبار', rank: 'محاضر' } })).status, 400);
  assert.equal((await api('POST', '/api/faculty', { cookie: adm, body: { name: 'د. اختبار', rank: 'بروفيسور' } })).status, 201);
  const inst = await api('GET', '/api/me');
  assert.equal(inst.json.limits.maxAttachmentMb, 1);
  assert.equal(inst.json.site.university.length > 0, true);
  const { headerLines } = await import('../server/services/site.js');
  assert.equal(headerLines(app.db).line, 'جهة اختبار — قسم شؤون الطلاب');
  assert.equal(headerLines(app.db).country, 'الجمهورية العربية السورية · جهة اختبار');
  const { levelLabel } = await import('../server/services/students.js');
  assert.equal(levelLabel(2, app.db), 'السنة الثانية'); assert.equal(levelLabel(3, app.db), 'السنة 3');
});

test('الحضور والإجازات: الرصيد والعطلة ونوع الإجازة المخصومة من الإعدادات', async () => {
  const adm = await loginAs('admin');
  const { leaveSummary } = await import('../server/services/staffatt.js');
  const uid = app.db.prepare("SELECT id FROM users WHERE username = 'staff'").get().id;
  assert.equal(leaveSummary(app.db, uid, 2026).entitlement, 30);
  await put({ 'hr.leave_default_days': 21 }, adm);
  assert.equal(leaveSummary(app.db, uid, 2026).entitlement, 21);
  const hrs = (await api('GET', '/api/hr/settings', { cookie: adm })).json.settings;
  assert.equal(hrs.leaveDefaultDays, 21);                       // الواجهتان تقرآن المصدر نفسه
});

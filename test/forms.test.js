import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ensureStructure } from '../server/services/structure.js';

const PW = 'Test#Pass12345';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let app, base;
const api = async (m, u, { body, cookie } = {}) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const att = (n = 'a.png') => ({ name: n, data: PNG });
let adm, hr, hr2, fin, svcHead, leaves, housing, s1;

const svc = (o = {}) => ({ code: 'hr_leave_t', label: 'إجازة موظف', description: 'طلب إجازة لموظف', slaHours: 48, unit: 'hr', audience: 'staff', category: 'الإجازات', instructions: 'أرفق التقرير ثم قدّم الطلب.',
  attachments: [{ label: 'تقرير داعم', required: true }, { label: 'صورة', required: false }], maxAttachments: 3, requiresAttachment: true, issuesDocument: false,
  fields: [{ label: 'السبب', type: 'textarea', required: true }, { label: 'المبلغ', type: 'decimal', min: 0, max: 1000 }, { label: 'من تاريخ', type: 'date', required: true }, { label: 'النوع', type: 'select', options: ['اعتيادية', 'مرضية'], required: true }], ...o });
const det = (o = {}) => ({ f1: 'ظرف عائلي', f2: '12.5', f3: '2026-11-01', f4: 'اعتيادية', ...o });

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-forms-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  const ins = (u, n, role, no) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,?,?,?)').run(u, n, h, role, no ?? null, Date.now());
  ins('admin', 'مدير', 'admin'); ins('s1', 'ليلى الحسن', 'student', '2024-1087');
  await ensureStructure(app, { activate: true, password: PW });
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  const hrUser = app.db.prepare("SELECT * FROM users WHERE username = 'hr'").get();
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, role_key, unit_id, created_at) VALUES (?,?,?,?,?,?,?)').run('hr2', 'موظف ثان', h, 'staff', hrUser.role_key, hrUser.unit_id, Date.now());
  [adm, hr, hr2, fin, svcHead, leaves, housing, s1] = await Promise.all(['admin', 'hr', 'hr2', 'finance', 'sa_services', 'of_leaves', 'of_housing', 's1'].map(login));
});
test.after(async () => { await app.close(); });

test('محرر الخدمات: وحدة مالكة وفئة وتعليمات ومرفقات مطلوبة وأنواع حقول جديدة، مع تحقق صارم', async () => {
  assert.equal((await api('POST', '/api/admin/services', { cookie: adm, body: svc({ unit: 'nope' }) })).s, 400);
  assert.equal((await api('POST', '/api/admin/services', { cookie: adm, body: svc({ audience: 'x' }) })).s, 400);
  assert.equal((await api('POST', '/api/admin/services', { cookie: adm, body: svc({ attachments: [{ label: '', required: true }] }) })).s, 400);
  assert.equal((await api('POST', '/api/admin/services', { cookie: adm, body: svc() })).s, 200);
  const m = (await api('GET', '/api/admin/services', { cookie: adm })).j.services.find((x) => x.code === 'hr_leave_t');
  assert.equal(m.unit, 'hr'); assert.equal(m.audience, 'staff'); assert.equal(m.category, 'الإجازات'); assert.equal(m.maxAttachments, 3);
  assert.deepEqual(m.attachments.map((a) => [a.label, a.required]), [['تقرير داعم', true], ['صورة', false]]);
  assert.deepEqual(m.fields.map((f) => f.type), ['textarea', 'decimal', 'date', 'select']);
  assert.equal((await api('POST', '/api/admin/services', { cookie: adm, body: svc({ code: 'svc_s', label: 'خدمة طالب', audience: 'student', unit: 'of_leaves', attachments: [], requiresAttachment: false }) })).s, 200);
  assert.equal((await api('POST', '/api/admin/services', { cookie: adm, body: svc({ code: 'svc_big', fields: Array.from({ length: 17 }, (_, i) => ({ label: 'ح' + i, type: 'text' })) }) })).s, 400);
});

test('الجمهور: الطالب لا يرى خدمات الموظفين ولا يقدّمها، والموظف لا يقدّم خدمات الطلاب', async () => {
  const names = async (c) => { const r = await api('GET', '/api/services', { cookie: c }); if (!r.j?.services) console.log('DBG', r.s, JSON.stringify(r.j)); return r.j.services.map((x) => x.code); };
  assert.ok(!(await names(s1)).includes('hr_leave_t')); assert.ok((await names(s1)).includes('svc_s'));
  assert.ok((await names(hr)).includes('hr_leave_t')); assert.ok(!(await names(hr)).includes('svc_s'));
  const one = (await api('GET', '/api/services', { cookie: hr })).j.services.find((x) => x.code === 'hr_leave_t');
  assert.equal(one.instructions, 'أرفق التقرير ثم قدّم الطلب.'); assert.equal(one.attachments.length, 2); assert.equal(one.unit.name, 'الموارد البشرية');
  assert.equal((await api('POST', '/api/requests', { cookie: s1, body: { service: 'hr_leave_t', details: det(), attachments: [att()] } })).s, 400);
  assert.equal((await api('POST', '/api/requests', { cookie: hr, body: { service: 'svc_s', details: det() } })).s, 400);
});

test('طلب داخلي: يُسند لوحدة الخدمة، مرفقات متعددة، تحقق الحقول والمرفقات المطلوبة', async () => {
  const post = (b, c = hr) => api('POST', '/api/requests', { cookie: c, body: { service: 'hr_leave_t', ...b } });
  assert.equal((await post({ details: det(), attachments: [] })).s, 400);                                        // المرفق المطلوب ناقص
  assert.equal((await post({ details: det(), attachments: [att(), att('b.png'), att('c.png'), att('d.png')] })).s, 400);   // أكثر من الحد الأقصى
  assert.equal((await post({ details: det({ f2: 'abc' }), attachments: [att()] })).s, 400);                      // مبلغ غير عددي
  assert.equal((await post({ details: det({ f2: '5000' }), attachments: [att()] })).s, 400);                     // فوق الحد
  assert.equal((await post({ details: det({ f1: 'س'.repeat(1001) }), attachments: [att()] })).s, 400);
  assert.equal((await post({ details: det({ f4: 'غيرها' }), attachments: [att()] })).s, 400);
  const ok = await post({ details: det(), attachments: [att(), att('b.png')] });
  assert.equal(ok.s, 201);
  const r = ok.j.request;
  assert.equal(r.status, 'review'); assert.equal(r.unit.name, 'الموارد البشرية'); assert.equal(r.attachments.length, 2); assert.equal(r.attachment.id, r.attachments[0].id);
  assert.equal(r.details.f2, '12.5');
  assert.equal((await api('GET', `/api/attachments/${r.attachments[1].id}`, { cookie: hr })).s, 200);
  // مقدّم الطلب يرى طلبه، وموظف آخر في الوحدة يعتمده، ولا يعتمد صاحبه طلبه
  assert.equal((await api('GET', '/api/requests', { cookie: hr })).j.requests.some((x) => x.id === r.id), true);
  assert.equal((await api('POST', `/api/requests/${r.id}/approve`, { cookie: hr })).s, 403);
  assert.equal((await api('POST', `/api/requests/${r.id}/approve`, { cookie: hr2 })).s, 200);
  assert.equal((await api('GET', `/api/requests/${r.id}`, { cookie: fin })).s, 404);                              // وحدة أخرى لا ترى الطلب
});

test('نطاق الوحدة يشمل الوحدات الفرعية ولا يشمل الأقران', async () => {
  const r = await api('POST', '/api/requests', { cookie: s1, body: { service: 'svc_s', details: det() } });
  assert.equal(r.s, 201); assert.equal(r.j.request.unit.name, 'مكتب الإجازات الطلابية');
  const ids = async (c) => (await api('GET', '/api/requests', { cookie: c })).j.requests.map((x) => x.id);
  assert.ok((await ids(leaves)).includes(r.j.request.id));        // المكتب نفسه
  assert.ok((await ids(svcHead)).includes(r.j.request.id));       // رئيس الوحدة الأب
  assert.ok(!(await ids(housing)).includes(r.j.request.id));      // مكتب شقيق
  assert.ok(!(await ids(hr)).includes(r.j.request.id));
});

test('كتالوج النماذج: كل نموذج صالح ومرتبط بوحدة قائمة، والتشغيل مكرَّر آمن', async () => {
  const { ensureForms, FORMS } = await import('../server/services/forms/index.js');
  const r = ensureForms(app);
  assert.ok(FORMS.length >= 150, `عدد النماذج ${FORMS.length}`);
  assert.equal(r.created + r.existing, FORMS.length);
  const rows = app.db.prepare('SELECT * FROM service_types WHERE unit_code IS NOT NULL').all();
  for (const s of rows) assert.ok(app.db.prepare('SELECT 1 FROM org_units WHERE code = ?').get(s.unit_code), `${s.code} → ${s.unit_code}`);
  // كل إدارة من الـ16 لها نموذج واحد على الأقل (مباشرة أو عبر مكاتبها)
  for (const d of ['affairs', 'admission', 'exams', 'academic', 'hr', 'finance', 'procure', 'admin_aff', 'it_sec', 'library', 'quality', 'research', 'legal', 'media', 'safety', 'alumni', 'discipline']) {
    const ids = app.db.prepare("WITH RECURSIVE t(id) AS (SELECT id FROM org_units WHERE code = ? UNION SELECT o.id FROM org_units o JOIN t ON o.parent_id = t.id) SELECT code FROM org_units WHERE id IN (SELECT id FROM t)").all(d).map((x) => x.code);
    assert.ok(rows.some((s) => ids.includes(s.unit_code)), `لا نماذج للإدارة ${d}`);
  }
  const r2 = ensureForms(app); assert.equal(r2.created, 0);
  // الخدمات القديمة نُسبت لوحدتها دون تغيير حقولها
  const ex = app.db.prepare("SELECT * FROM service_types WHERE code = 'excuse'").get();
  assert.equal(ex.unit_code, 'of_leaves'); assert.equal(JSON.parse(ex.fields_json)[0].name, 'course');
  // طلب فعلي على نموذج من الكتالوج يُسند للمكتب المختص
  const req = await api('POST', '/api/requests', { cookie: s1, body: { service: 'housing_repair', details: { f1: '204', f2: 'كهرباء', f3: 'مستعجل', f4: 'انقطاع التيار' } } });
  assert.equal(req.s, 201, JSON.stringify(req.j)); assert.equal(req.j.request.unit.name, 'مكتب السكن والخدمات');
});

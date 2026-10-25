// اختبارات وحدة 5.6 أعضاء هيئة التدريس: السجل والتحقق والصلاحيات والعبء التدريسي والتدقيق.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { verifyAuditChain } from '../server/audit.js';
import { ensureStructure } from '../server/services/structure.js';

const PW = 'Test#Pass12345';
let app, base, admin, staff, auditor;

async function api(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text, headers: res.headers };
}
async function loginAs(username) {
  app.limiter.hits.clear();
  const r = await api('POST', '/api/auth/login', { body: { username, password: PW } });
  assert.equal(r.status, 200, `login ${username}: ${r.text}`);
  return r.headers.get('set-cookie').split(';')[0];
}
const member = (o = {}) => ({ name: 'د. سامر الحلبي', rank: 'أستاذ مشارك', specialty: 'أمن الشبكات', officeHours: 'الأحد والثلاثاء 10:00 – 12:00', ...o });

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-fm-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, role] of [['admin', 'admin'], ['staff', 'staff'], ['auditor', 'auditor']])
    app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, u, h, role, Date.now());
  await ensureStructure({ db: app.db, cfg: app.cfg });
  admin = await loginAs('admin'); staff = await loginAs('staff'); auditor = await loginAs('auditor');
});
test.after(async () => { await app.close(); });

test('الفهرس والصلاحيات: faculty:manage قابلة للإسناد ومنح للموظف والمدير دون المدقق', async () => {
  const ov = await api('GET', '/api/admin/access', { cookie: admin });
  assert.equal(ov.status, 200);
  const item = ov.json.catalog.flatMap((g) => g.items).find((i) => i.key === 'faculty:manage');
  assert.ok(item && item.label.includes('هيئة التدريس'), 'الصلاحية في الفهرس بوصف عربي');
  for (const r of ov.json.roles.filter((x) => x.builtin)) {
    const has = r.permissions.includes('faculty:manage');
    assert.equal(has, r.key !== 'auditor', `${r.key}: ${has ? 'تملك' : 'لا تملك'} الصلاحية`);
  }
  const me = (await api('GET', '/api/me', { cookie: staff })).json.user;
  assert.ok(me.permissions.includes('faculty:manage'));
  assert.ok(!(await api('GET', '/api/me', { cookie: auditor })).json.user.permissions.includes('faculty:manage'));
});

test('الإضافة والعرض: عضو جديد بدرجته وقسمه وساعاته المكتبية مع خيارات القائمة', async () => {
  const unit = app.db.prepare('SELECT id FROM org_units ORDER BY id LIMIT 1').get().id;
  const r = await api('POST', '/api/faculty', { cookie: staff, body: member({ unitId: unit, email: 'samer@su.edu', phone: '0944111222', officeLocation: 'مبنى 2 — مكتب 214' }) });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.member.rank, 'أستاذ مشارك');
  assert.equal(r.json.member.unitId, unit);
  const up = await api('PUT', '/api/faculty/' + r.json.member.id, { cookie: staff, body: member({ officeHours: 'الاثنين 09:00 – 11:00' }) });
  assert.equal(up.status, 200, up.text);
  assert.equal(up.json.member.officeHours, 'الاثنين 09:00 – 11:00', 'التحديث الجزئي يحفظ القسم');
  assert.equal(up.json.member.unitId, unit);
  const list = await api('GET', '/api/faculty', { cookie: admin });
  assert.equal(list.status, 200);
  assert.ok(list.json.members.some((m) => m.name === 'د. سامر الحلبي'));
  assert.ok(list.json.options.ranks.includes('أستاذ مساعد'));
  assert.equal(list.json.options.statuses.active, 'على رأس العمل');
  assert.ok(list.json.options.units.length >= 16, 'الهيكل التنظيمي مبني في الاختبار');
  assert.ok(list.json.summary.total >= 1);
});

test('التحقق: يرفض الاسم القصير والدرجة غير المعروفة والبريد السيئ والقسم غير الموجود', async () => {
  const cases = [
    [{ ...member(), name: 'ق' }, 'الاسم'],
    [{ ...member(), rank: 'أستاذ زائر' }, 'الدرجة'],
    [{ ...member(), email: 'not-an-email' }, 'البريد'],
    [{ ...member(), unitId: 9999999 }, 'القسم'],
    [{ ...member(), status: 'متوقف' }, 'الحالة'],
  ];
  for (const [body, label] of cases) {
    const r = await api('POST', '/api/faculty', { cookie: admin, body });
    assert.equal(r.status, 400, `${label}: ${r.text}`);
    assert.equal(r.json.error, 'validation', label);
  }
  const n = (await api('GET', '/api/faculty', { cookie: admin })).json.summary.total;
  assert.equal(n, 1, 'لا شيء من الرفوضات كُتب');
});

test('الصلاحيات: الموظف يدير، والمدقق ممنوع 403، وبدون جلسة 401', async () => {
  assert.equal((await api('POST', '/api/faculty', { cookie: staff, body: member({ name: 'د. رنا محمود' }) })).status, 201);
  assert.equal((await api('GET', '/api/faculty', { cookie: auditor })).status, 403);
  assert.equal((await api('POST', '/api/faculty', { cookie: auditor, body: member() })).status, 403);
  assert.equal((await api('PUT', '/api/faculty/1', { cookie: auditor, body: member() })).status, 403);
  assert.equal((await api('DELETE', '/api/faculty/1', { cookie: auditor })).status, 403);
  assert.equal((await api('GET', '/api/faculty')).status, 401);
});

test('العبء التدريسي: إسناد المقرر يزامن اسم المدرّس ويحسب ساعات العضو ويعيد النص عند الفك', async () => {
  const fm = (await api('GET', '/api/faculty', { cookie: admin })).json.members.find((m) => m.name === 'د. سامر الحلبي');
  const programId = app.db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id;
  const c1 = (await api('POST', '/api/courses', { cookie: admin, body: { programId, level: 1, semester: 1, name: 'تعمية البيانات', hours: 3, instructor: 'د. اسم حر قديم' } })).json.course;
  const c2 = (await api('POST', '/api/courses', { cookie: admin, body: { programId, level: 1, semester: 2, name: 'شبكات متقدمة', hours: 4 } })).json.course;
  const as1 = await api('PUT', `/api/courses/${c1.id}`, { cookie: admin, body: { memberId: fm.id } });
  assert.equal(as1.status, 200, as1.text);
  assert.equal(as1.json.course.memberId, fm.id);
  assert.equal(as1.json.course.instructor, 'د. سامر الحلبي', 'الإسناد يتحكّم بنص «المدرّس»');
  await api('PUT', `/api/courses/${c2.id}`, { cookie: admin, body: { memberId: fm.id } });
  let m = (await api('GET', '/api/faculty', { cookie: admin })).json;
  let me = m.members.find((x) => x.id === fm.id);
  assert.equal(me.courses, 2); assert.equal(me.hours, 7, '3 + 4 ساعات نشطة');
  assert.equal(m.summary.unassigned, 0, 'لا مقررات نشطة بلا إسناد');
  // فك الإسناد: يبقى اسم العضو نصاً حراً في المقرر (سجل سليم لا يُفرّغ)
  const un = await api('PUT', `/api/courses/${c1.id}`, { cookie: admin, body: { memberId: null } });
  assert.equal(un.json.course.memberId, null);
  assert.equal(un.json.course.instructor, 'د. سامر الحلبي');
  me = (await api('GET', '/api/faculty', { cookie: admin })).json.members.find((x) => x.id === fm.id);
  assert.equal(me.courses, 1); assert.equal(me.hours, 4);
  await api('PUT', `/api/courses/${c1.id}`, { cookie: admin, body: { memberId: fm.id } });   // لإسناد اختبار الحذف
});

test('الحذف والتعطيل: الحذف مرفوض مع إسنادات، والتعطيل يغيّر الحالة، وفك الإسناد يفتح الحذف', async () => {
  const fm = (await api('GET', '/api/faculty', { cookie: admin })).json.members.find((m) => m.name === 'د. سامر الحلبي');
  const del = await api('DELETE', '/api/faculty/' + fm.id, { cookie: admin });
  assert.equal(del.status, 409, del.text);
  assert.match(del.json.message, /مقرر مسنَد/);
  const off = await api('POST', `/api/faculty/${fm.id}/toggle`, { cookie: admin, body: { enabled: false } });
  assert.equal(off.json.member.status, 'inactive');
  const on = await api('POST', `/api/faculty/${fm.id}/toggle`, { cookie: admin, body: { enabled: true } });
  assert.equal(on.json.member.status, 'active');
  // إجراء الحذف: نزيل إسناد c2 المتبقي (c1 أُسند سابقاً في هذا الاختبار بعد فكه)، ثم نحذف
  const courses = (await api('GET', '/api/courses', { cookie: admin })).json.courses;
  for (const x of courses) { if (x.memberId === fm.id) await api('PUT', `/api/courses/${x.id}`, { cookie: admin, body: { memberId: null } }); }
  assert.equal((await api('DELETE', '/api/faculty/' + fm.id, { cookie: admin })).status, 200);
  const list = (await api('GET', '/api/faculty', { cookie: admin })).json;
  assert.ok(!list.members.some((m) => m.id === fm.id));
  assert.ok(list.members.some((m) => m.name === 'د. رنا محمود'), 'الآخر باقٍ');
});

test('التدقيق: عمليات الوحدة في السجل والسلسلة سليمة', async () => {
  const chain = verifyAuditChain(app.db);
  assert.ok(chain.ok, `سلسلة مكسورة عند ${chain.brokenAtId}`);
  const acts = app.db.prepare("SELECT DISTINCT action FROM audit_log WHERE action LIKE '%عضو هيئة تدريس%'").all().map((r) => r.action);
  for (const a of ['إضافة عضو هيئة تدريس', 'تعديل عضو هيئة تدريس', 'تعطيل عضو هيئة تدريس', 'إسناد مقرر لعضو هيئة تدريس', 'حذف عضو هيئة تدريس'])
    assert.ok(acts.includes(a), `حدث: ${a}`);
  const rows = app.db.prepare("SELECT ref FROM audit_log WHERE action = 'إسناد مقرر لعضو هيئة تدريس'").all();
  assert.ok(rows.every((r) => r.ref.includes('←')), 'المرجع يذكر المقرر والعضو');
});

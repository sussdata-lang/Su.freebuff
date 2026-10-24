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
let app, base, c, id;
const call = async (m, u, ck, body) => { const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(ck ? { Cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j, t, h: r.headers }; };
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const mk = (o = {}) => ({ title: 'طلب شراء', subject: 'تجهيزات مكتبية', body: 'نص المستند', mode: 'parallel', approvers: [id.hr, id.finance], send: true, ...o });

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-corr-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  const ins = (u, n, role, no) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,?,?,?)').run(u, n, h, role, no ?? null, Date.now());
  ins('admin', 'مدير', 'admin'); ins('s1', 'ليلى', 'student', '2024-1087'); ins('aud', 'مدقق', 'auditor');
  await ensureStructure(app, { activate: true, password: PW });
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  const uid = (u) => app.db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
  id = Object.fromEntries(['admin', 'hr', 'finance', 'library', 'aud', 's1'].map((u) => [u, uid(u)]));
  c = Object.fromEntries(await Promise.all(['admin', 'hr', 'finance', 'library', 'aud', 's1'].map(async (u) => [u, await login(u)])));
});
test.after(async () => { await app.close(); });

test('إرسال مستند متوازٍ: يظهر وارداً للمعتمدين وصادراً للمنشئ مع إشعارات ومرفق', async () => {
  const r = await call('POST', '/api/corr', c.library, mk({ files: [{ name: 'a.png', data: PNG }] }));
  assert.equal(r.s, 201); const d = r.j.doc;
  assert.match(d.no, /^COR-\d{4}-\d{5}$/); assert.equal(d.status, 'pending'); assert.equal(d.approvers.length, 2); assert.equal(d.files.length, 1);
  assert.equal((await call('GET', '/api/corr?box=in', c.hr)).j.docs.some((x) => x.id === d.id), true);
  assert.equal((await call('GET', '/api/corr?box=out', c.library)).j.docs.some((x) => x.id === d.id), true);
  assert.equal((await call('GET', '/api/corr?box=in', c.library)).j.docs.some((x) => x.id === d.id), false);
  const n = (await call('GET', '/api/corr/notifications', c.finance)).j;
  assert.ok(n.unread >= 1 && n.items[0].docId === d.id);
  const f = await fetch(base + `/api/corr/files/${d.files[0].id}`, { headers: { Cookie: c.hr } }); assert.equal(f.status, 200);
  assert.equal((await fetch(base + `/api/corr/files/${d.files[0].id}`, { headers: { Cookie: c.admin } })).status, 200);
});

test('اعتماد متوازٍ: يكتمل بالجميع ويُمنح رقم صادر', async () => {
  const d = (await call('POST', '/api/corr', c.library, mk())).j.doc;
  const a = await call('POST', `/api/corr/${d.id}/approve`, c.hr, { note: 'موافق' });
  assert.equal(a.j.doc.status, 'pending'); assert.equal(a.j.doc.outNo, null);
  const b = await call('POST', `/api/corr/${d.id}/approve`, c.finance, {});
  assert.equal(b.j.doc.status, 'approved'); assert.match(b.j.doc.outNo, /^\d{4}\/\d+$/);
  assert.equal((await call('POST', `/api/corr/${d.id}/approve`, c.finance, {})).s, 409);
  assert.ok((await call('GET', '/api/corr/notifications', c.library)).j.items.some((x) => x.docId === d.id && /اعتُمد/.test(x.text)));
});

test('اعتماد تسلسلي: لا يعتمد الثاني قبل الأول، وإشعار الدور التالي', async () => {
  const d = (await call('POST', '/api/corr', c.library, mk({ mode: 'sequential' }))).j.doc;
  assert.equal((await call('GET', '/api/corr/notifications', c.finance)).j.items.some((x) => x.docId === d.id), false);
  assert.equal((await call('POST', `/api/corr/${d.id}/approve`, c.finance, {})).s, 409);
  assert.equal((await call('POST', `/api/corr/${d.id}/approve`, c.hr, {})).s, 200);
  assert.ok((await call('GET', '/api/corr/notifications', c.finance)).j.items.some((x) => x.docId === d.id));
  assert.equal((await call('POST', `/api/corr/${d.id}/approve`, c.finance, {})).j.doc.status, 'approved');
});

test('الرفض يتطلب سبباً وينهي المستند', async () => {
  const d = (await call('POST', '/api/corr', c.library, mk())).j.doc;
  assert.equal((await call('POST', `/api/corr/${d.id}/reject`, c.hr, {})).s, 400);
  const r = await call('POST', `/api/corr/${d.id}/reject`, c.hr, { note: 'ناقص المرفقات' });
  assert.equal(r.j.doc.status, 'rejected');
  assert.equal((await call('POST', `/api/corr/${d.id}/approve`, c.finance, {})).s, 409);
});

test('الظهور: غير المعنيّ 404 والطالب 403 والمدقق/المدير يقرآن', async () => {
  const d = (await call('POST', '/api/corr', c.library, mk())).j.doc;
  assert.equal((await call('GET', `/api/corr/${d.id}`, c.admin)).s, 200);
  assert.equal((await call('GET', `/api/corr/${d.id}`, c.aud)).s, 200);
  const other = await call('POST', '/api/corr', c.hr, mk({ approvers: [id.finance] }));
  assert.equal((await call('GET', `/api/corr/${other.j.doc.id}`, c.library)).s, 404);
  assert.equal((await call('GET', '/api/corr?box=in', c.s1)).s, 403);
  assert.equal((await call('POST', `/api/corr/${d.id}/approve`, c.library, {})).s, 403);   // المنشئ ليس معتمداً
});

test('مسودة ثم إرسال، تعليق، إلغاء، والتحقق من الحقول', async () => {
  const dr = (await call('POST', '/api/corr', c.library, mk({ send: false }))).j.doc;
  assert.equal(dr.status, 'draft');
  assert.equal((await call('GET', `/api/corr/${dr.id}`, c.hr)).s, 404);
  assert.equal((await call('POST', `/api/corr/${dr.id}/send`, c.hr, {})).s, 404);
  assert.equal((await call('POST', `/api/corr/${dr.id}/send`, c.library, {})).j.doc.status, 'pending');
  assert.equal((await call('POST', `/api/corr/${dr.id}/comment`, c.hr, { text: 'ملاحظة' })).s, 200);
  assert.ok((await call('GET', `/api/corr/${dr.id}`, c.library)).j.doc.events.some((e) => e.kind === 'comment' && e.text === 'ملاحظة'));
  assert.equal((await call('POST', `/api/corr/${dr.id}/cancel`, c.hr, {})).s, 403);
  assert.equal((await call('POST', `/api/corr/${dr.id}/cancel`, c.library, {})).j.doc.status, 'cancelled');
  assert.equal((await call('POST', '/api/corr', c.library, mk({ title: '' }))).s, 400);
  assert.equal((await call('POST', '/api/corr', c.library, mk({ approvers: [] }))).s, 400);
  assert.equal((await call('POST', '/api/corr', c.library, mk({ approvers: [id.s1] }))).s, 400);
  assert.equal((await call('POST', '/api/corr', c.library, mk({ approvers: [id.hr, id.hr] }))).s, 400);
});

test('قائمة الأشخاص والإشعارات: بلا طلاب، وتعليم المقروء', async () => {
  const p = (await call('GET', '/api/corr/people', c.library)).j.people;
  assert.ok(p.length >= 2 && p.every((x) => x.id !== id.s1) && p.every((x) => x.id !== id.library));
  const n = (await call('GET', '/api/corr/notifications', c.hr)).j; assert.ok(n.unread > 0);
  await call('POST', '/api/corr/notifications/read', c.hr, { all: true });
  assert.equal((await call('GET', '/api/corr/notifications', c.hr)).j.unread, 0);
});

test('قوالب المراسلات: قوالب جاهزة، وإدارتها لمن يملك corr:templates فقط', async () => {
  const l = (await call('GET', '/api/corr/templates', c.library)).j.templates;
  assert.ok(l.length >= 10 && l.every((t) => t.code && t.name && t.title && t.body && ['parallel', 'sequential'].includes(t.mode)));
  assert.ok(l.some((t) => /\{\{date\}\}/.test(t.body) || /\{\{unit\}\}/.test(t.body)));
  assert.equal((await call('GET', '/api/corr/templates', c.s1)).s, 403);
  const mkT = { code: 'my_tpl', name: 'قالبي', category: 'عام', title: 'عنوان', subject: 'موضوع', body: 'نص {{name}}', mode: 'sequential' };
  assert.equal((await call('POST', '/api/corr/templates', c.library, mkT)).s, 403);
  assert.equal((await call('POST', '/api/corr/templates', c.admin, mkT)).s, 201);
  assert.equal((await call('POST', '/api/corr/templates', c.admin, mkT)).s, 409);
  assert.equal((await call('POST', '/api/corr/templates', c.admin, { ...mkT, code: 'x', name: '' })).s, 400);
  assert.equal((await call('PUT', '/api/corr/templates/my_tpl', c.admin, { ...mkT, name: 'قالبي 2' })).s, 200);
  assert.ok((await call('GET', '/api/corr/templates', c.library)).j.templates.some((t) => t.code === 'my_tpl' && t.name === 'قالبي 2'));
  assert.equal((await call('PUT', '/api/corr/templates/my_tpl', c.admin, { active: false })).s, 200);
  assert.equal((await call('GET', '/api/corr/templates', c.library)).j.templates.some((t) => t.code === 'my_tpl'), false);
  assert.equal((await call('GET', '/api/corr/templates?all=1', c.admin)).j.templates.some((t) => t.code === 'my_tpl'), true);
  assert.equal((await call('DELETE', '/api/corr/templates/my_tpl', c.admin)).s, 200);
  const b = l.find((t) => t.builtin);
  assert.equal((await call('DELETE', `/api/corr/templates/${b.code}`, c.admin)).s, 409);
});

test('نسخة إلى: ترى المستند وتُشعَر ولا تعتمد، ويظهر في واردها', async () => {
  const d = (await call('POST', '/api/corr', c.library, mk({ cc: [id.admin] }))).j.doc;
  assert.deepEqual(d.cc.map((x) => x.id), [id.admin]);
  assert.equal((await call('GET', `/api/corr/${d.id}`, c.admin)).s, 200);
  const inbox = (await call('GET', '/api/corr?box=in', c.admin)).j.docs.find((x) => x.id === d.id);
  assert.ok(inbox && inbox.mine.cc === true && inbox.mine.approver === false);
  assert.ok((await call('GET', '/api/corr/notifications', c.admin)).j.items.some((x) => x.docId === d.id && /نسخة/.test(x.text)));
  assert.equal((await call('POST', `/api/corr/${d.id}/approve`, c.admin, {})).s, 403);
  assert.equal((await call('POST', `/api/corr/${d.id}/comment`, c.admin, { text: 'اطلعت' })).s, 200);
  await call('POST', `/api/corr/${d.id}/approve`, c.hr, {}); await call('POST', `/api/corr/${d.id}/approve`, c.finance, {});
  assert.ok((await call('GET', '/api/corr/notifications', c.admin)).j.items.some((x) => x.docId === d.id && /اعتُمد/.test(x.text)));
  assert.equal((await call('POST', '/api/corr', c.library, mk({ cc: [id.hr] }))).s, 400);        // معتمد وفي نسخة
  assert.equal((await call('POST', '/api/corr', c.library, mk({ cc: [id.library] }))).s, 400);   // المنشئ نفسه
  assert.equal((await call('POST', '/api/corr', c.library, mk({ cc: [id.s1] }))).s, 400);        // طالب
});

test('تعديل المسودة: النص والمعتمدون والنسخة والمرفقات، للمنشئ وللمسودة فقط', async () => {
  const dr = (await call('POST', '/api/corr', c.library, mk({ send: false, files: [{ name: 'a.png', data: PNG }] }))).j.doc;
  const up = await call('PUT', `/api/corr/${dr.id}`, c.library, { title: 'عنوان معدّل', subject: 's2', body: 'نص جديد', mode: 'sequential', approvers: [id.finance], cc: [id.admin], removeFiles: [dr.files[0].id], files: [{ name: 'b.png', data: PNG }] });
  assert.equal(up.s, 200);
  const d = up.j.doc; assert.equal(d.title, 'عنوان معدّل'); assert.equal(d.mode, 'sequential'); assert.deepEqual(d.approvers.map((a) => a.id), [id.finance]); assert.deepEqual(d.cc.map((x) => x.id), [id.admin]);
  assert.equal(d.files.length, 1); assert.equal(d.files[0].name, 'b.png'); assert.equal(d.status, 'draft');
  assert.equal((await call('PUT', `/api/corr/${dr.id}`, c.hr, { title: 'x' })).s, 404);          // غير المنشئ لا يرى المسودة
  assert.equal((await call('PUT', `/api/corr/${dr.id}`, c.library, { title: '' })).s, 400);
  const sent = await call('PUT', `/api/corr/${dr.id}`, c.library, { send: true });
  assert.equal(sent.j.doc.status, 'pending');
  assert.equal((await call('PUT', `/api/corr/${dr.id}`, c.library, { title: 'بعد الإرسال' })).s, 409);
});

test('معاينة المرفق داخل المتصفح وتنزيل PDF موقَّع للمستند المعتمد فقط', async () => {
  const d = (await call('POST', '/api/corr', c.library, mk({ files: [{ name: 'a.png', data: PNG }], cc: [id.admin] }))).j.doc;
  const inl = await fetch(base + `/api/corr/files/${d.files[0].id}?inline=1`, { headers: { Cookie: c.hr } });
  assert.match(inl.headers.get('content-disposition'), /^inline/); assert.equal(inl.headers.get('content-type'), 'image/png');
  assert.equal((await call('GET', `/api/corr/${d.id}/pdf`, c.hr)).s, 409);                        // لم يُعتمد بعد
  await call('POST', `/api/corr/${d.id}/approve`, c.hr, {}); await call('POST', `/api/corr/${d.id}/approve`, c.finance, {});
  const r = await fetch(base + `/api/corr/${d.id}/pdf`, { headers: { Cookie: c.library } });
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await r.arrayBuffer()); assert.equal(buf.subarray(0, 5).toString(), '%PDF-'); assert.ok(buf.length > 5000);
  const again = Buffer.from(await (await fetch(base + `/api/corr/${d.id}/pdf`, { headers: { Cookie: c.admin } })).arrayBuffer());
  assert.ok(buf.equals(again));                                                                    // ملف واحد ثابت
  const other = (await call('POST', '/api/corr', c.hr, mk({ approvers: [id.finance] }))).j.doc;
  await call('POST', `/api/corr/${other.id}/approve`, c.finance, {});
  assert.equal((await call('GET', `/api/corr/${other.id}/pdf`, c.library)).s, 404);
});

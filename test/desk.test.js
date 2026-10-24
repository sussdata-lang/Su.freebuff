import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ensureStructure } from '../server/services/structure.js';
import { ensureForms } from '../server/services/forms/index.js';

const PW = 'Test#Pass12345';
let app, base, c;
const call = async (m, u, ck, body) => { const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(ck ? { Cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j, r }; };
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-desk-'));
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

test('مكتبي: ملخص الموظف يشمل الملف والصلاحيات والأرقام، ويُمنع الطالب', async () => {
  const d = (await call('GET', '/api/me/desk', c.hr)).j.desk;
  assert.ok(d.me.name && d.me.unit); assert.equal(d.me.staffKind, 'admin');
  assert.ok(d.permissions.length > 0 && d.permissions.every((g) => g.items.length));
  assert.equal(typeof d.counts.corrTurn, 'number'); assert.ok(d.hr.leave.entitlement === 30);
  assert.equal((await call('GET', '/api/me/desk', c.s1)).s, 403);
  assert.equal((await call('GET', '/api/me/desk')).s, 401);
});

test('نوع العضو (إداري/تدريسي) والمسمى الوظيفي يُحفظان ويظهران في /api/me', async () => {
  const id = app.db.prepare("SELECT id FROM users WHERE username = 'library'").get().id;
  assert.equal((await call('PUT', `/api/admin/users/${id}`, c.admin, { staffKind: 'faculty', jobTitle: 'أستاذ مساعد' })).s, 200);
  assert.equal((await call('PUT', `/api/admin/users/${id}`, c.admin, { staffKind: 'x' })).s, 400);
  const lib = await login('library');
  const me = (await call('GET', '/api/me', lib)).j.user;
  assert.equal(me.staffKind, 'faculty'); assert.equal(me.jobTitle, 'أستاذ مساعد');
  const mk = await call('POST', '/api/admin/users', c.admin, { username: 'dr1', displayName: 'د. سامر', role: 'staff', staffKind: 'faculty', jobTitle: 'عميد', password: 'Temp#Pass12345' });
  assert.equal(mk.s, 201);
  assert.equal((await call('GET', '/api/admin/users', c.admin)).j.users.find((u) => u.username === 'dr1').staffKind, 'faculty');
});

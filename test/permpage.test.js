import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ensureStructure } from '../server/services/structure.js';
import { PERMISSION_CATALOG, ASSIGNABLE } from '../server/permissions.js';
import { readXlsx } from '../server/lib/xlsx.js';

const PW = 'Test#Pass12345';
let app, base, adm, aud;
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const get = (u, ck) => fetch(base + u, { headers: { Cookie: ck } });

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-perm-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('admin', 'مدير', h, 'admin', Date.now());
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('aud', 'مدقق', h, 'auditor', Date.now());
  await ensureStructure(app, { activate: true, password: PW });
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  [adm, aud] = await Promise.all([login('admin'), login('aud')]);
});
test.after(async () => { await app.close(); });

test('الفهرس: كل صلاحية في مجموعة واحدة، ومجموعة مستقلة للمراسلات والموارد البشرية', async () => {
  const keys = PERMISSION_CATALOG.flatMap((g) => g.items.map((i) => i.key));
  assert.equal(new Set(keys).size, keys.length); assert.equal(keys.length, ASSIGNABLE.size);
  const g = PERMISSION_CATALOG.find((x) => x.group === 'المراسلات والموارد البشرية');
  assert.deepEqual(g.items.map((i) => i.key).sort(), ['corr:read_all', 'corr:templates', 'corr:use', 'staffatt:manage', 'staffatt:self']);
});

test('صفحة الصلاحيات تعرض كل الأدوار (ومنها دور الطالب الثابت) وكل الصلاحيات', async () => {
  const j = await (await get('/api/admin/access', adm)).json();
  assert.ok(j.roles.some((r) => r.key === 'admin') && j.roles.some((r) => r.key === 'head_hr') && j.roles.length >= 3 + 30);
  assert.equal(j.studentRole.key, 'student'); assert.ok(j.studentRole.permissions.length >= 8 && j.studentRole.permissions.every((p) => p.key && p.label));
  assert.equal(j.roles.find((r) => r.key === 'admin').permissions.length, ASSIGNABLE.size);
});

test('تصدير مصفوفة الصلاحيات إلى Excel: كل الأدوار أعمدة وكل الصلاحيات صفوف', async () => {
  const j = await (await get('/api/admin/access', adm)).json();
  const r = await get('/api/admin/access/matrix.xlsx', adm); assert.equal(r.status, 200);
  const wb = readXlsx(Buffer.from(await r.arrayBuffer())), rows = wb.sheets[0].rows;
  assert.equal(rows[0].length, 2 + j.roles.length + 1);                      // المجموعة + الصلاحية + الأدوار + الطالب
  const nPerm = PERMISSION_CATALOG.reduce((s, g) => s + g.items.length, 0) + j.studentRole.permissions.filter((p) => !ASSIGNABLE.has(p.key)).length;
  assert.equal(rows.length - 1, nPerm);
  assert.equal(rows.find((x) => x[1] === 'corr:use')[2 + j.roles.findIndex((x) => x.key === 'admin')], '✓');
  assert.equal((await get('/api/admin/access/matrix.xlsx', aud)).status, 403);
});

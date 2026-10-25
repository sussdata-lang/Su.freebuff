// npm: node scripts/build-demo-full.js — ديمو شامل لكل وحدات النظام (للاطلاع فقط).
// الفكرة: يُشغَّل الخادم الحقيقي داخل العملية ببيانات تجريبية لكل الوحدات، تُلتقط ردود كل مسارات GET بحساب المدير،
// ثم تُحقن لقطة JSON + ملفات الواجهة الناقصة في ملف الديمو الأساسي. التعديلات في الوحدات الإضافية غير مفعّلة.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ensureStructure } from '../server/services/structure.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'scripts/build-demo.js')], { stdio: 'inherit' });

/* ---------- 1) خادم حقيقي مؤقت + حساب مدير ---------- */
const PW = 'Demo#Pass12345';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-full-'));
const app = await createApp({ dbPath: path.join(dir, 'd.db'), jwtSecret: 'demo-full', backupAuto: false });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + app.server.address().port;
await ensureStructure({ db: app.db, cfg: app.cfg ?? { scryptN: 1024 } }, { activate: false }).catch(() => {});
app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('admin','مدير النظام',?, 'admin', ?)").run(await hashPassword(PW, 1024), Date.now());
const lr = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PW }) });
const cookie = lr.headers.get('set-cookie').split(';')[0];
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  const j = ct.includes('json') ? await r.json().catch(() => null) : null;
  return { ok: r.ok, status: r.status, json: j };
};
const seed = async (label, method, url, body) => { const r = await call(method, url, body); if (!r.ok) console.log('  ✘ seed', label, r.status, r.json && r.json.message); return r.json; };

/* ---------- 2) بذر بيانات المشتريات ---------- */
const P = '/api/procurement';
const wh1 = (await seed('wh1', 'POST', P + '/warehouses', { code: 'WH-MAIN', name: 'المخزن الرئيسي', location: 'المبنى الإداري - الطابق الأرضي' }))?.warehouse;
const wh2 = (await seed('wh2', 'POST', P + '/warehouses', { code: 'WH-LAB', name: 'مخزن المختبرات', location: 'كلية الأمن السيبراني - مبنى B' }))?.warehouse;
const sups = [];
for (const [code, name, phone] of [['SUP-01', 'شركة الشام للقرطاسية', '0112000001'], ['SUP-02', 'مؤسسة النور للتجهيزات التقنية', '0112000002'], ['SUP-03', 'الفرات للأثاث المكتبي', '0112000003']]) sups.push((await seed(code, 'POST', P + '/suppliers', { code, name, phone, email: code.toLowerCase() + '@example.com', address: 'دمشق' }))?.supplier);
const cats = (await call('GET', P + '/categories')).json?.categories || [];
const cat = (n) => (cats.find((c) => c.name.includes(n)) || cats[0] || {}).id;
const itemDefs = [['ITM-001', 'ورق طباعة A4 (رزمة)', 'قرطاسية', 'رزمة', wh1, 50, 400], ['ITM-002', 'أقلام حبر جاف', 'قرطاسية', 'علبة', wh1, 20, 200], ['ITM-003', 'حبر طابعة ليزر', 'قرطاسية', 'قطعة', wh1, 5, 40], ['ITM-004', 'حاسوب مكتبي', 'أجهزة', 'جهاز', wh2, 3, 30], ['ITM-005', 'محوّل شبكة 24 منفذ', 'أجهزة', 'جهاز', wh2, 2, 10], ['ITM-006', 'كرسي مكتبي', 'أثاث', 'قطعة', wh1, 5, 50], ['ITM-007', 'كابلات شبكة Cat6', 'مختبرات', 'ملفّ', wh2, 10, 60], ['ITM-008', 'سبورة بيضاء', 'أثاث', 'قطعة', wh1, 2, 12]];
const items = [];
for (const [code, name, c, unit, w, minStock, maxStock] of itemDefs) items.push((await seed(code, 'POST', P + '/items', { code, name, categoryId: cat(c), unit, warehouseId: w?.id, minStock, maxStock }))?.item);
const I = (i) => items[i]?.id;

const rq = async (title, lines, submit) => (await seed(title, 'POST', P + '/requests', { title, description: 'طلب لأغراض العرض التجريبي', warehouseId: wh1?.id, lines, submit }));
const r1 = await rq('توريد قرطاسية للفصل الأول', [{ itemId: I(0), description: 'ورق طباعة A4', qty: 200, estCost: 28000 }, { itemId: I(1), description: 'أقلام حبر جاف', qty: 60, estCost: 9000 }], true);
const r2 = await rq('تجهيز مخبر الشبكات', [{ itemId: I(3), description: 'حاسوب مكتبي', qty: 8, estCost: 3200000 }, { itemId: I(4), description: 'محوّل شبكة 24 منفذ', qty: 3, estCost: 1800000 }, { itemId: I(6), description: 'كابلات شبكة Cat6', qty: 20, estCost: 150000 }], true);
const r3 = await rq('كراسي لقاعة الاجتماعات', [{ itemId: I(5), description: 'كرسي مكتبي', qty: 30, estCost: 450000 }], true);
await rq('سبورات للقاعات الجديدة (مسودة)', [{ itemId: I(7), description: 'سبورة بيضاء', qty: 6, estCost: 600000 }], false);
await rq('أحبار للطابعات (قيد المراجعة)', [{ itemId: I(2), description: 'حبر طابعة ليزر', qty: 15, estCost: 900000 }], true);
const idOf = (r) => r?.request?.id ?? r?.id;
await seed('approve1', 'POST', `${P}/requests/${idOf(r1)}/approve`, { note: 'معتمد' });
await seed('approve2', 'POST', `${P}/requests/${idOf(r2)}/approve`, { note: 'معتمد' });
await seed('reject3', 'POST', `${P}/requests/${idOf(r3)}/reject`, { note: 'خارج الميزانية الحالية' });

const mkOrder = async (reqId, supplier, lines, send) => {
  const o = await seed('order', 'POST', P + '/orders', { supplierId: supplier?.id, requestId: reqId, lines });
  const id = o?.order?.id ?? o?.id; if (id && send) await seed('send', 'POST', `${P}/orders/${id}/order`, {});
  return id;
};
const o1 = await mkOrder(idOf(r1), sups[0], [{ itemId: I(0), description: 'ورق طباعة A4', qty: 200, unitCost: 140 }, { itemId: I(1), description: 'أقلام حبر جاف', qty: 60, unitCost: 150 }], true);
await seed('receipt', 'POST', P + '/receipts', { orderId: o1, note: 'استلام كامل', lines: [{ itemId: I(0), qty: 200, unitCost: 140 }, { itemId: I(1), qty: 60, unitCost: 150 }] });
await mkOrder(idOf(r2), sups[1], [{ itemId: I(3), description: 'حاسوب مكتبي', qty: 8, unitCost: 400000 }, { itemId: I(4), description: 'محوّل شبكة 24 منفذ', qty: 3, unitCost: 600000 }, { itemId: I(6), description: 'كابلات شبكة Cat6', qty: 20, unitCost: 7500 }], true);
await mkOrder(null, sups[2], [{ itemId: I(5), description: 'كرسي مكتبي', qty: 10, unitCost: 15000 }], false);
await seed('issue', 'POST', P + '/issues', { warehouseId: wh1?.id, issuedTo: 'قسم شؤون الطلاب', purpose: 'احتياج شهري', lines: [{ itemId: I(0), qty: 40 }, { itemId: I(1), qty: 15 }] });
const assets = [];
for (const [code, name, category, w, cost] of [['AST-001', 'حاسوب محمول - قسم الحاسب', 'أجهزة', wh2, 1200000], ['AST-002', 'جهاز عرض (بروجكتر)', 'أجهزة', wh1, 900000], ['AST-003', 'خادم مختبر الشبكات', 'أجهزة', wh2, 5500000], ['AST-004', 'مكيّف قاعة المحاضرات', 'تجهيزات', wh1, 2100000]]) assets.push((await seed(code, 'POST', P + '/assets', { code, name, category, warehouseId: w?.id, cost, supplierId: sups[1]?.id, purchaseDay: '2026-03-15' }))?.asset);
if (assets[0]) await seed('move1', 'POST', `${P}/assets/${assets[0].id}/move`, { kind: 'transfer', toWarehouseId: wh1?.id, toUser: 'د. هالة سعيد', reason: 'إسناد لعضو هيئة تدريس' });
if (assets[2]) await seed('move2', 'POST', `${P}/assets/${assets[2].id}/move`, { kind: 'maintenance', reason: 'صيانة دورية' });

/* ---------- 3) التقاط ردود كل مسارات GET ---------- */
const SRC = ['server/routes.js', ...fs.readdirSync(path.join(root, 'server/services'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `server/services/${d.name}/routes.js`)].filter((f) => fs.existsSync(path.join(root, f)));
const getPaths = [...new Set(SRC.flatMap((f) => [...fs.readFileSync(path.join(root, f), 'utf8').matchAll(/\.add\(\s*'GET'\s*,\s*'([^']+)'/g)].map((m) => m[1])))]
  .filter((p) => !/export|\.xlsx|\.pdf|\.svg|\.png|\.jpe?g|download|\/health|\/auth\/|\/backup\/files|\/verify|\/qr|\/media|\/files|\/attachments|\/push/.test(p));
const snap = {};
const grab = async (p) => { const r = await call('GET', p); if (r.ok && r.json !== null) { snap[p] = r.json; return r.json; } return null; };
for (const p of getPaths.filter((x) => !x.includes(':'))) await grab(p);
const firstIds = (resp) => { const arr = resp && Object.values(resp).find((v) => Array.isArray(v) && v.length && typeof v[0] === 'object'); return arr ? arr.slice(0, 4).map((x) => x.id).filter((x) => x !== undefined) : []; };
for (const p of getPaths.filter((x) => x.includes(':'))) {
  const prefix = p.slice(0, p.indexOf('/:')); const ids = firstIds(snap[prefix]);
  for (const id of ids) await grab(p.replace(/:[A-Za-z]+/, String(id)));
}
console.log('لقطة الديمو:', Object.keys(snap).length, 'مساراً من', getPaths.length);
const adminUser = (await call('GET', '/api/me')).json.user;
await app.close();

/* ---------- 4) حقن اللقطة والملفات الناقصة في الديمو الأساسي ---------- */
const demoFile = path.join(root, 'demo/university-portal-demo.html');
let html = fs.readFileSync(demoFile, 'utf8');
const included = ['theme.js', 'app.js', 'icons.js', 'transcript.js', 'staff.js', 'student.js', 'import.js', 'internal.js', 'corr.js', 'staffatt.js', 'exchange.js', 'adminconfig.js', 'idcard.js', 'dashboard.js', 'shell.js', 'tablefilter.js', 'boot.js'];
const extraOrder = ['stable.js', 'record360.js', 'attendance.js', 'backup.js', 'access.js', 'export.js', 'desk.js', 'general.js', 'payroll.js', 'finance.js', 'procurement.js', 'faculty.js', 'units.js'];
const extra = extraOrder.filter((f) => !included.includes(f)).map((f) => fs.readFileSync(path.join(root, 'public', f), 'utf8').replace(/<\/script/gi, '<\\/script')).join('\n;\n');
const must = (cond, msg) => { if (!cond) throw new Error('تعذّر تعديل الديمو: ' + msg); };

must(html.includes('window.UA.start();'), 'boot');
html = html.replace('window.UA.start();', () => extra + '\n;\nwindow.UA.start();');
must(html.includes('window.__DEMO__='), 'data');
const snapJson = JSON.stringify(snap).replace(/</g, '\\u003c');
html = html.replace('window.__DEMO__=', () => `window.__SNAP__=${snapJson};window.__DEMO__=`);
must(html.includes('const D = window.__DEMO__, now = () => Date.now();'), 'shim D');
html = html.replace('const D = window.__DEMO__, now = () => Date.now();', () => `const D = window.__DEMO__, now = () => Date.now(); D.users.admin = ${JSON.stringify(adminUser).replace(/</g, '\\u003c')};`);
html = html.replaceAll("role !== 'staff'", "role === 'student'").replaceAll("role === 'staff'", "role !== 'student'");
const lg = /role = \/staff\|admin\|([^/]*)\/\.test\(n\) \? 'staff' : 'student'/;
must(lg.test(html), 'login');
html = html.replace(lg, (_, ar) => `role = /admin|مدير/.test(n) ? 'admin' : /staff|${ar}/.test(n) ? 'staff' : 'student'`);
const fb = /throw err\(404, 'هذه الميزة غير متاحة في نسخة العرض\.', 'not_found'\);/;
must(fb.test(html), 'fallback');
html = html.replace(fb, () => `if (role !== 'student' && method === 'GET') { const hit = window.__SNAP__[path + u.search] ?? window.__SNAP__[path]; if (hit !== undefined) return JSON.parse(JSON.stringify(hit)); }
    if (role !== 'student' && method !== 'GET') throw err(403, 'هذا الإجراء للاطلاع فقط في نسخة العرض ولا يُحفظ.', 'demo_readonly');
    throw err(404, 'هذه الميزة غير متاحة في نسخة العرض.', 'not_found');`);
html = html.replace("lo.hidden = true; document.body.append(lo); lo.click(); lo.remove();", "lo.hidden = true; document.body.append(lo); lo.click(); lo.remove();");
html = html.replaceAll("r === 'staff' ? 'staff' : 'student'", 'r').replaceAll("r === 'staff')", "r !== 'student')");
const btn = /<button data-r="staff"[^>]*>[^<]*<\/button>/;
must(btn.test(html), 'bar');
html = html.replace(btn, (m) => m + '<button data-r="admin" aria-pressed="false">مدير النظام (كل الوحدات)</button>');

const out = path.join(root, 'demo/university-portal-demo-full.html');
fs.writeFileSync(out, html);
console.log('OK', (html.length / 1024).toFixed(0) + ' KB →', out);
process.exit(0);

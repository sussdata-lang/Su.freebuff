// اختبارات الواجهة في متصفح حقيقي (Playwright). تُتخطّى تلقائياً إن لم يتوفر Playwright/Chromium (PLAYWRIGHT_MODULE لتحديد مساره).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { log } from '../server/lib/logger.js';

const PW = 'Test#Pass12345';
let pw = null;
for (const spec of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/npm-tools/node_modules/playwright/index.mjs'].filter(Boolean)) {
  try { pw = await import(spec); break; } catch { /* التالي */ }
}
let app, base, browser, page, adm;
const errs = [];
const form = (o = {}) => ({ first_name: 'سارة', father_name: 'أحمد', last_name: 'العلي', mother_name: 'سعاد الخطيب', national_id: '01234567890', gender: 'أنثى', birth_date: '2006-03-14', birth_place: 'دمشق', nationality: 'سورية',
  phone: '0944123456', governorate: 'دمشق', city: 'المزة', address: 'شارع الجلاء', hs_type: 'الثانوية العامة - الفرع العلمي', hs_year: 2024, hs_score: 2100, program_id: 2, admission_type: 'القبول العام (المفاضلة)',
  enroll_year: 2024, enroll_term: 'الفصل الأول', study_level: 2, guardian_name: 'أحمد', guardian_relation: 'الأب', guardian_phone: '0933111222', ...o });
const api = async (m, u, body) => { const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: adm }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };

test.before(async () => {
  if (!pw) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ui-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, publicDir: path.resolve('public') });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('admin', 'مدير', await hashPassword(PW, 1024), 'admin', Date.now());
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PW }) });
  adm = r.headers.get('set-cookie').split(';')[0];
  for (const [n, l] of [['مدخل إلى الأمن', 1], ['أمن الشبكات', 2]]) await api('POST', '/api/courses', { programId: 2, level: l, semester: 1, name: n, hours: 3 });
  for (let i = 0; i < 30; i++) await api('POST', '/api/students', form({ first_name: 'طالب' + [...String(i)].map((d) => 'ابجدهوزحطي'[d]).join(''), national_id: String(10000000000 + i), phone: '09' + (55000000 + i) }));
  try { browser = await pw.chromium.launch(); } catch { pw = null; return; }
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base);
  await page.evaluate(async (p) => { await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: p }) }); }, PW);
  await page.reload(); await page.waitForSelector('.sx-nav');
});
test.after(async () => { if (browser) await browser.close(); if (app) await app.close(); });
const go = async (v, tab) => { await page.evaluate(([v, tab]) => { if (tab) UA.S.stTab = tab; return UA.go(v); }, [v, tab]); await page.waitForTimeout(700); };

test('القائمة الجانبية: تبويبات الصفحات صارت قوائم فرعية وبوابة استيراد/تصدير واحدة', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  const nav = await page.locator('.sx-nav > button').allInnerTexts();
  assert.ok(nav.some((x) => x.includes('الاستيراد والتصدير')) && !nav.some((x) => /^\s*(الاستيراد|التصدير)\s*$/.test(x)));
  for (const v of ['admin', 'access', 'attendance', 'comms', 'exchange', 'audit']) {
    await go(v);
    assert.equal(await page.locator('.sx-page .sub-tabs').count(), 0, `${v}: لا تبويبات مكررة داخل الصفحة`);
    assert.ok(await page.locator('.sx-sub-list button').count() >= 2, `${v}: قائمة فرعية`);
  }
});

test('وحدات النظام: القائمة مُجمَّعة على المجموعات والصفحة تفهرس الوحدات السبع عشرة', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  // عناوين المجموعات: واحدة لكل مجموعة، والأزرار أبناء مباشرون لـ-.sx-nav
  const gh = await page.locator('.sx-nav .sx-gh').allInnerTexts();
  for (const g of ['الطلاب والخدمات', 'الأكاديمي والامتحانات', 'التقارير والبيانات', 'التواصل والإشعارات', 'النواة والحوكمة', 'عن النظام']) assert.ok(gh.includes(g), `مجموعة: ${g}`);
  assert.equal(new Set(gh).size, gh.length, 'كل مجموعة عنوان واحد فقط');
  const nav = await page.locator('.sx-nav > button').allInnerTexts();
  assert.ok(nav.some((x) => x.includes('وحدات النظام')), 'مدخل «وحدات النظام»');
  assert.ok(nav.some((x) => x.includes('المواد والعلامات')), 'المواد والعلامات صارت مدخلاً مستقلاً');
  // صفحة الوحدات: 17 وحدة بأسمائها وحالتها
  await go('units');
  assert.equal(await page.locator('.sx-page [data-unit]').count(), 17, 'الوحدات السبع عشرة');
  const txt = await page.locator('.sx-page').innerText();
  for (const s of ['القبول والتسجيل', 'سجل الطالب', 'الامتحانات والعلامات', 'الموارد البشرية والرواتب', 'الجودة والاعتماد', 'ذكاء الأعمال والتقارير', 'مُنفَّذ', 'غير مبني']) assert.ok(txt.includes(s), s);
  // انتقال من بطاقة وحدة إلى صفحتها المنفّذة
  await page.locator('[data-unit="5.4"] [data-sx="sub"][data-v="academics"]').click();
  await page.waitForTimeout(700);
  assert.ok((await page.locator('.sx-crumbs').innerText()).includes('المواد والعلامات'), 'وحدة 5.4 تفتح دليل المواد');
  assert.deepEqual(errs, []);
});

test('التسجيل بلا كاميرا: بطاقة موحّدة كاملة + بيانات إضافية + طباعة معزولة', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await go('affairs', 'new');
  await page.evaluate((v) => { for (const [k, val] of Object.entries(v)) { const e = document.getElementById('sf-' + k); if (e) e.value = val; } }, form({ first_name: 'ريم', national_id: '09876543210', phone: '0955111222' }));
  await page.locator('[data-act=xfadd]').click(); await page.locator('.xf-l').first().fill('الهواية'); await page.locator('.xf-v').first().fill('الرسم');
  await page.locator('#regform button[type=submit]').click();
  await page.waitForSelector('#credwrap .idc', { timeout: 8000 });
  const labels = (await page.locator('#credwrap .idc-rows dt').allInnerTexts()).join('|');
  for (const l of ['اسم الطالب', 'الكلية / المعهد', 'سنة القيد', 'فصل القيد', 'تاريخ ووقت إنشاء الحساب', 'الهواية']) assert.ok(labels.includes(l), l);
  assert.equal(await page.locator('#credwrap .bc128').count(), 1);
  assert.equal(await page.locator('#credwrap .idc-k').count(), 1);
  await page.evaluate(() => { window.print = () => {}; });
  await page.locator('[data-act=credprint]').click();
  assert.ok(await page.evaluate(() => document.body.classList.contains('print-root') && document.querySelector('#printroot .idc') !== null));
  await page.evaluate(() => { document.body.classList.remove('print-root'); document.getElementById('printroot').innerHTML = ''; });
});

test('السجل 360: قسم المقررات حتى دون علامات، وزر الطباعة يملأ جذر الطباعة', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  const id = (await api('GET', '/api/students?q=' + encodeURIComponent('ريم'))).j.students[0].id;
  await page.evaluate((id) => UA.actions.strecord(null, { id }), id); await page.waitForSelector('#layer .rec-h');
  const heads = (await page.locator('#layer .rec-h').allInnerTexts()).join('|');
  assert.ok(heads.includes('المقررات') && heads.includes('بيانات الطالب'));
  assert.ok((await page.locator('#layer table').first().innerText()).includes('أمن الشبكات'));
  await page.evaluate(() => { window.print = () => {}; });
  await page.locator('[data-act=r360print]').click();
  assert.ok(await page.evaluate(() => document.querySelector('#printroot .rec-print')?.textContent.includes('المقررات')));
  await page.evaluate(() => { document.body.classList.remove('print-root'); document.getElementById('printroot').innerHTML = ''; document.getElementById('layer').innerHTML = ''; });
});

test('الفلترة تشمل كل البيانات: تفعيل فلتر عمود يرفع الصفوف إلى 500', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await go('affairs', 'list');
  const rows = () => page.locator('#app table tbody tr:not([hidden]):not(.tf-none)').count();
  assert.equal(await rows(), 25);
  await page.locator('#app table thead th .tf-dd').nth(1).click();
  await page.locator('.tf-pop-q').fill('طالبب'); await page.waitForTimeout(1500);
  assert.equal(await page.locator('select[data-stt=size]').inputValue(), '500');
  assert.equal(await rows(), 11);                                  // 10 + 1: كل من اسمه يبدأ بـ«طالبب» ضمن الـ31 لا ضمن الصفحة الأولى فقط
});

test('الفلترة: عند تجاوز الإجمالي للصفوف المحمّلة يظهر تنبيه صريح', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await page.evaluate(() => { document.querySelector('.pager .small').textContent = '900 نتيجة'; });
  await page.locator('#app table thead th .tf-dd').nth(1).click();
  await page.locator('.tf-pop-q').fill('طالبج'); await page.waitForTimeout(500);
  assert.match(await page.locator('.tf-count').first().innerText(), /إجمالي 900/);
  await page.keyboard.press('Escape'); await page.locator('.tf-clear').first().click();
});

test('زر المظهر: تلقائي ← فاتح ← ليلي ويغيّر الألوان فعلاً', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await go('overview');
  const bg = () => page.evaluate(() => [UAtheme.get(), document.documentElement.getAttribute('data-theme'), getComputedStyle(document.body).backgroundColor]);
  assert.equal((await bg())[0], 'auto');
  await page.locator('[data-theme-toggle]').click(); assert.deepEqual((await bg()).slice(0, 2), ['light', 'light']); const light = (await bg())[2];
  await page.locator('[data-theme-toggle]').click(); assert.deepEqual((await bg()).slice(0, 2), ['dark', 'dark']); assert.notEqual((await bg())[2], light);
  await page.locator('[data-theme-toggle]').click(); assert.equal((await bg())[0], 'auto');
});

test('سجل النظام: حدث error يظهر في تبويب «سجل النظام» للمدير', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  log.error('اختبار: حدث تجريبي', new Error('تفاصيل تجريبية'));
  await go('audit');
  await page.locator('[data-act=audtab][data-t=logs]').first().click(); await page.waitForTimeout(600);
  assert.ok((await page.locator('#app table').first().innerText()).includes('اختبار: حدث تجريبي'));
  assert.deepEqual(errs, []);
});

test('الإدارة: تبويبا «هوية الموقع» و«الخدمات» يعملان من الواجهة', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await go('admin');
  await page.locator('[data-act=atab][data-t=services]').first().click(); await page.waitForTimeout(500);
  await page.locator('[data-act=svnew]').click(); await page.waitForTimeout(200);
  await page.fill('#sv-code', 'lib_ui'); await page.fill('#sv-label', 'بطاقة مكتبة'); await page.fill('#sv-desc', 'طلب بطاقة استعارة');
  await page.locator('[data-act=svaddf]').click(); await page.fill('#fl-l-0', 'السبب');
  await page.locator('[data-act=svsave]').click(); await page.waitForTimeout(700);
  assert.ok((await page.locator('#app table').first().innerText()).includes('بطاقة مكتبة'));
  await page.locator('[data-act=atab][data-t=identity]').first().click(); await page.waitForTimeout(500);
  await page.fill('#si-title', 'بوابة الطلاب التجريبية'); await page.locator('[data-act=savesite]').click(); await page.waitForTimeout(500);
  assert.equal((await api('GET', '/api/admin/settings')).j.site.title, 'بوابة الطلاب التجريبية');
  assert.deepEqual(errs, []);
});

test('ملف الطالب لا يعرض بطاقة الشهادة؛ زر الـPDF فقط، وتظهر البطاقة عند التسجيل', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await go('affairs', 'list');
  const sid = (await api('GET', '/api/students')).j.students[0].id;
  await page.evaluate((id) => UA.actions.sttopen(null, { id: String(id) }), sid); await page.waitForTimeout(800);
  assert.ok(await page.locator('[data-act=stcert]').count() > 0);
  assert.equal(await page.locator('.idc-rows, .idc-v, .idc-bar, [data-act=bcprint]').count(), 0);
  assert.deepEqual(errs, []);
});

test('الطلبات الداخلية: اختيار نموذج وتقديمه، وتبويب طلبات Excel يظهر', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  const c = await api('POST', '/api/admin/services', { code: 'ui_staff', label: 'طلب تجريبي داخلي', description: 'وصف', slaHours: 24, audience: 'staff', category: 'اختبار', instructions: 'تعليمات', issuesDocument: false,
    fields: [{ label: 'السبب', type: 'textarea', required: true }, { label: 'النوع', type: 'select', options: ['أ', 'ب'], required: true }] });
  assert.equal(c.s, 200);
  await page.evaluate(() => { document.getElementById('layer').innerHTML = ''; });
  await go('internal');
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await page.evaluate(() => document.querySelector('[data-act="inpick"][data-k="ui_staff"]').click());
  await page.fill('#in-f1', 'سبب تجريبي'); await page.selectOption('#in-f2', 'أ');
  await page.click('#inform button[type="submit"]'); await page.waitForTimeout(800);
  assert.match(await page.textContent('main, body'), /REQ-\d{4}-\d{5}/);
  await go('exchange');
  await page.click('[data-act="extab"][data-t="reqx"]'); await page.waitForTimeout(500);
  assert.ok(await page.$('#rx-svc'));
  assert.deepEqual(errs, []);
});

test('المراسلات: إنشاء مستند بمعتمد وإرساله ثم ظهوره في الصادر مع تبويب الإشعارات', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('mgr1','مدير الموارد','x','staff',?)").run(Date.now());
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('cc1','مطّلع للنسخة','x','staff',?)").run(Date.now());
  await page.evaluate(() => { document.getElementById('layer').innerHTML = ''; });
  await go('corr');
  await page.evaluate(() => document.querySelector('[data-act="crtab"][data-t="new"]').click()); await page.waitForTimeout(600);
  await page.fill('#cf-title', 'طلب شراء تجريبي'); await page.fill('#cf-body', 'نص المستند');
  await page.selectOption('#cf-person', { label: 'مدير الموارد' }).catch(async () => { const v = await page.$eval('#cf-person', (s) => [...s.options].find((o) => o.textContent.includes('مدير الموارد')).value); await page.selectOption('#cf-person', v); });
  await page.evaluate(() => document.querySelector('[data-act="cradd"]').click()); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#crform').requestSubmit()); await page.waitForTimeout(1000);
  const txt = await page.textContent('body');
  assert.match(txt, /COR-\d{4}-\d{5}/); assert.match(txt, /مسار الاعتماد/); assert.match(txt, /مدير الموارد/);
  assert.ok(await page.$('[data-act="crtab"][data-t="notifs"]'));
  assert.deepEqual(errs, []);
});

test('الحضور والإجازات: بصمة الدخول والخروج من الواجهة وظهور الرصيد وتقرير اليوم', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await page.evaluate(() => { document.getElementById('layer').innerHTML = ''; });
  await go('hr');
  await page.evaluate(() => document.querySelector('[data-act="sapunch"]').click()); await page.waitForTimeout(800);
  assert.match(await page.textContent('body'), /سُجّل دخولك/);
  assert.match(await page.textContent('body'), /المتبقي/);
  await page.evaluate(() => document.querySelector('[data-act="satab"][data-t="report"]').click()); await page.waitForTimeout(600);
  assert.ok(await page.$('#sa-date'));
  assert.match(await page.textContent('body'), /حاضر/);
  assert.deepEqual(errs, []);
});

test('المراسلات: مسودة ← تعديل مع نسخة إلى ← إرسال', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await page.evaluate(() => { document.getElementById('layer').innerHTML = ''; });
  await go('corr');
  await page.evaluate(() => document.querySelector('[data-act="crtab"][data-t="new"]').click()); await page.waitForTimeout(600);
  await page.fill('#cf-title', 'مسودة للتعديل');
  const mgr = await page.$eval('#cf-person', (s) => [...s.options].find((o) => o.textContent.includes('مدير الموارد')).value);
  await page.selectOption('#cf-person', mgr); await page.evaluate(() => document.querySelector('[data-act="cradd"]').click()); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act="crdraft"]').click()); await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('[data-act="credit"]').click()); await page.waitForTimeout(500);
  assert.match(await page.textContent('body'), /تعديل المسودة/);
  await page.fill('#cf-title', 'مسودة معدّلة');
  const cc = await page.$eval('#cf-cc', (s) => [...s.options].find((o) => o.textContent.includes('مطّلع للنسخة')).value);
  await page.selectOption('#cf-cc', cc); await page.evaluate(() => document.querySelector('[data-act="crccadd"]').click()); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#crform').requestSubmit()); await page.waitForTimeout(1000);
  const txt = await page.textContent('body');
  assert.match(txt, /مسودة معدّلة/); assert.match(txt, /نسخة إلى:.*مطّلع للنسخة/);
  assert.deepEqual(errs, []);
});

test('مكتبي: واجهة الموظف بمظهر إداري ثم تدريسي، مع الأرقام والمختصرات والصلاحيات والإعدادات', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await page.evaluate(() => { document.getElementById('layer').innerHTML = ''; });
  await go('desk');
  assert.ok(await page.$('.sdesk.sd-admin .sd-hero')); assert.match(await page.textContent('.sd-hero'), /هيئة إدارية/);
  assert.ok((await page.$$('.sd-tile')).length >= 3);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/desk-admin.png`, fullPage: true });
  await page.evaluate(() => { UA.S.me.staffKind = 'faculty'; UA.S.me.jobTitle = 'أستاذ مساعد'; UA.render(); });
  assert.ok(await page.$('.sdesk.sd-faculty')); assert.match(await page.textContent('.sd-hero'), /هيئة تدريسية.*أستاذ مساعد|أستاذ مساعد/s);
  const first = await page.$eval('.sd-tile span', (e) => e.textContent); assert.match(first, /المواد/);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/desk-faculty.png`, fullPage: true });
  await page.evaluate(() => document.querySelector('[data-act="sdtab"][data-t="prof"]').click());
  assert.match(await page.textContent('.sdesk'), /ملفي الوظيفي/); assert.match(await page.textContent('.sdesk'), /صلاحياتي/);
  await page.evaluate(() => document.querySelector('[data-act="sdtab"][data-t="set"]').click());
  assert.ok(await page.$('#sdpw'));
  await page.evaluate(() => { UA.S.me.staffKind = 'admin'; UA.S.me.jobTitle = ''; UA.render(); });
  assert.deepEqual(errs, []);
});

test('الإعدادات العامة: تبويب في الإدارة يعدّل علامة العملي ويظهر أثره في نموذج العلامات', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await page.evaluate(() => { document.getElementById('layer').innerHTML = ''; });
  await go('admin');
  await page.evaluate(() => document.querySelector('[data-act="atab"][data-t="general"]').click()); await page.waitForTimeout(600);
  assert.ok(await page.$('.g-cards')); assert.match(await page.textContent('.g-cards'), /العلامات والنجاح/);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/general-index.png`, fullPage: true });
  await page.evaluate(() => document.querySelector('[data-act="gtab"][data-t="grades"]').click());
  assert.equal(await page.inputValue('#g-grades-practical_max'), '30');
  await page.fill('#g-grades-practical_max', '40');
  await page.evaluate(() => document.querySelector('#gform').requestSubmit()); await page.waitForTimeout(800);
  assert.equal(await page.inputValue('#g-grades-practical_max'), '40');
  assert.ok(await page.$('.g-item.chg'));
  assert.equal(await page.evaluate(() => UA.S.limits.practicalMax), 40);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/general-grades.png`, fullPage: true });
  await page.evaluate(() => document.querySelector('[data-act="gres"]').click()).catch(() => {});
  assert.deepEqual(errs, []);
});

test('الموظفون والرواتب: واجهة الموارد البشرية تفتح مع نموذج موظف', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await page.evaluate(() => { document.getElementById('layer').innerHTML = ''; });
  await go('payroll');
  assert.match(await page.textContent('body'), /الموظفون/);
  await page.evaluate(() => document.querySelector('[data-act="pynew"]').click()); await page.waitForTimeout(300);
  assert.ok(await page.$('#pyemp'));
  await page.evaluate(() => document.querySelector('[data-act="pytab"][data-t="leave"]').click()); await page.waitForTimeout(500);
  assert.match(await page.textContent('body'), /إجازات الموظفين/);
  assert.deepEqual(errs, []);
});

test('صفحة الصلاحيات: المصفوفة تعرض دور الطالب والمراسلات وزر التصدير', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await page.evaluate(() => { document.getElementById('layer').innerHTML = ''; });
  await go('access');
  await page.evaluate(() => document.querySelector('[data-act="xtab"][data-t="matrix"]').click()); await page.waitForTimeout(500);
  const txt = await page.textContent('body');
  assert.match(txt, /corr:use/); assert.match(txt, /staffatt:manage/); assert.match(txt, /صلاحيات حساب الطالب/); assert.ok(await page.$('a[href="/api/admin/access/matrix.xlsx"]'));
  assert.deepEqual(errs, []);
});

test('قوالب المراسلات: اختيار قالب يملأ النموذج، وتبويب القوالب للمدير', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await page.evaluate(() => { document.getElementById('layer').innerHTML = ''; });
  await go('corr');
  await page.evaluate(() => document.querySelector('[data-act="crtab"][data-t="new"]').click()); await page.waitForTimeout(700);
  await page.selectOption('#cf-tpl', 'purchase'); await page.waitForTimeout(400);
  assert.equal(await page.inputValue('#cf-title'), 'طلب شراء');
  const body = await page.inputValue('#cf-body'); assert.ok(body.includes('الجهة الطالبة') && !body.includes('{{date}}'));
  assert.equal(await page.inputValue('#cf-mode'), 'sequential');
  await page.evaluate(() => document.querySelector('[data-act="crtab"][data-t="tpl"]').click()); await page.waitForTimeout(600);
  assert.match(await page.textContent('body'), /قوالب المراسلات/); assert.match(await page.textContent('body'), /محضر اجتماع/);
  assert.deepEqual(errs, []);
});

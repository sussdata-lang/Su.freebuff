import { writeXlsx, readXlsx } from '../lib/xlsx.js';
import { getSetting } from './settings.js';
import { HttpError } from '../http.js';
import { audit } from '../audit.js';
import { createRequest, listRequests, requesterKind, scopeOf, validateDetails } from './requests.js';

const bad = (m, s = 400) => new HttpError(s, m, 'validation');
const FORM = 'النموذج';
const AUD = { student: 'الطلاب', staff: 'الموظفون', both: 'الطلاب والموظفون' };
const STATUS = { review: 'قيد المراجعة', approved: 'مقبول', rejected: 'مرفوض' };
const norm = (s) => String(s ?? '').replace(/[*\s]+/g, ' ').trim();
const colL = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const getService = (db, code) => { const s = db.prepare('SELECT s.*, o.name unit_name FROM service_types s LEFT JOIN org_units o ON o.code = s.unit_code WHERE s.code = ? AND s.enabled = 1').get(code); if (!s) throw new HttpError(404, 'الخدمة غير موجودة.', 'not_found'); return s; };
const fieldsOf = (s) => JSON.parse(s.fields_json).filter((f) => f.type !== 'ref');
const hasRef = (s) => JSON.parse(s.fields_json).some((f) => f.type === 'ref');
const typeName = { text: 'نص', textarea: 'نص طويل', select: 'قائمة', number: 'عدد صحيح', decimal: 'رقم عشري', date: 'تاريخ (سنة-شهر-يوم)' };

// قالب فارغ: تعليمات + نموذج بقوائم وقيود إدخال + قوائم الخيارات
export function buildTemplate(db, code) {
  const MAX_ROWS = getSetting(db, 'requests.import_max_rows');
  const s = getService(db, code), fields = fieldsOf(s), slots = JSON.parse(s.attachments_json || '[]');
  const studentCol = s.audience !== 'staff';
  const head = [...(studentCol ? ['الرقم الجامعي'] : []), ...fields.map((f) => (f.required ? `${f.label} *` : f.label))];
  const off = studentCol ? 1 : 0, N = MAX_ROWS + 1, lists = [], val = [], cs = {}, widths = [];
  if (studentCol) widths.push(18);
  fields.forEach((f, i) => {
    const c = colL(i + off), rg = `${c}2:${c}${N}`; widths.push(f.type === 'textarea' ? 40 : Math.max(16, Math.min(34, f.label.length + 6)));
    if (f.type === 'select') {
      lists.push(f.options); const lc = colL(lists.length - 1);
      val.push({ sqref: rg, type: 'list', f1: `'القوائم'!$${lc}$2:$${lc}$${f.options.length + 1}`, title: f.label, msg: 'اختر قيمة من القائمة.' });
    } else if (f.type === 'number') val.push({ sqref: rg, type: 'whole', f1: String(f.min ?? 0), f2: String(f.max ?? 1000), title: f.label, msg: `عدد صحيح بين ${f.min ?? 0} و${f.max ?? 1000}.` });
    else if (f.type === 'decimal') { val.push({ sqref: rg, type: 'decimal', f1: String(f.min ?? 0), f2: String(f.max ?? 1e9), title: f.label, msg: `رقم بين ${f.min ?? 0} و${f.max ?? 1e9}.` }); cs[i + off] = 5; }
    else if (f.type === 'date') { val.push({ sqref: rg, type: 'date', f1: '36526', f2: '73050', title: f.label, msg: 'أدخل تاريخاً صحيحاً.' }); cs[i + off] = 4; }
    else val.push({ sqref: rg, type: 'textLength', f1: '1', f2: f.type === 'textarea' ? '1000' : '200', title: f.label, msg: 'النص مطلوب بحد أقصى مسموح.' });
  });
  const info = [
    ['البند', 'التفاصيل'],
    ['اسم الخدمة', s.label], ['رمز الخدمة', s.code], ['الجهة المسؤولة', s.unit_name ?? 'غير محددة'], ['الفئة', s.category ?? ''],
    ['المخصصة لـ', AUD[s.audience]], ['وصف الخدمة', s.description], ['مدة الإنجاز المتوقعة', `${s.sla_hours} ساعة`],
    ['التعليمات', s.instructions || '—'],
    ['المرفقات المطلوبة', slots.length ? slots.map((x) => `${x.label} (${x.required ? 'إلزامي' : 'اختياري'})`).join(' ، ') : (s.requires_attachment ? 'مرفق واحد على الأقل' : 'لا يوجد')],
    ['طريقة الاستخدام', `املأ ورقة «${FORM}» سطراً لكل طلب (حتى ${MAX_ROWS}). الأعمدة المعلَّمة بـ * إلزامية. ${studentCol ? 'عمود الرقم الجامعي إلزامي ويحدد صاحب الطلب. ' : ''}ثم ارفع الملف من «تبادل البيانات ← استيراد طلبات».${(slots.length || s.requires_attachment) ? ' ملاحظة: الخدمات التي تتطلب مرفقات تُقدَّم من الواجهة لا بالاستيراد.' : ''}`],
    [],
    ['العمود', 'النوع', 'إلزامي', 'ملاحظات'],
    ...(studentCol ? [['الرقم الجامعي', 'نص', 'نعم', 'مثال: 2024-1087']] : []),
    ...fields.map((f) => [f.label, typeName[f.type], f.required ? 'نعم' : 'لا', [f.hint, f.type === 'select' ? `الخيارات: ${f.options.join('، ')}` : '', (f.type === 'number' || f.type === 'decimal') ? `من ${f.min ?? 0} إلى ${f.max}` : ''].filter(Boolean).join(' — ')]),
  ];
  const infoRows = info.map((r, i) => (i === 0 || i === 12 ? r : r.map((v, j) => (v === '' || v === undefined ? v : { v, s: (i < 11 && j === 0) ? 8 : 9 }))));
  const sheets = [
    { name: 'تعليمات', rows: infoRows, widths: [26, 18, 12, 60], header: true, rtl: true },
    { name: FORM, rows: [head], widths, colStyles: cs, validations: val, rtl: true, textCols: [], freeze: true },
  ];
  if (lists.length) {
    const h = fields.filter((f) => f.type === 'select').map((f) => f.label), mx = Math.max(...lists.map((l) => l.length));
    sheets.push({ name: 'القوائم', rows: [h, ...Array.from({ length: mx }, (_, i) => lists.map((l) => l[i] ?? ''))], widths: lists.map(() => 24), rtl: true });
  }
  return writeXlsx(sheets, { title: `نموذج ${s.label}` });
}

// تصدير الطلبات ضمن صلاحية المستخدم؛ عند تحديد خدمة تصير حقولها أعمدة
export function exportRequests(deps, user, q = {}) {
  const { db } = deps;
  if (scopeOf(user) !== 'own' && !user.can('data:export')) throw new HttpError(403, 'لا تملك صلاحية تصدير الطلبات.', 'forbidden');
  const svc = q.service ? getService(db, String(q.service)) : null;
  let rows = listRequests(deps, user, { status: q.status }).filter((r) => (!svc || r.service?.code === svc.code));
  const unit = q.unit ? String(q.unit) : null;
  if (unit) { const u = db.prepare('SELECT id FROM org_units WHERE code = ?').get(unit); rows = rows.filter((r) => r.unit?.id === u?.id); }
  const from = q.from ? Date.parse(q.from) : null, to = q.to ? Date.parse(q.to) + 86400000 : null;
  rows = rows.filter((r) => (!from || r.createdAt >= from) && (!to || r.createdAt < to));
  const fields = svc ? JSON.parse(svc.fields_json) : [];
  const d = (t) => (t ? new Date(t + 3 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '');
  const head = ['رقم الطلب', 'الخدمة', 'مقدّم الطلب', 'الرقم الجامعي', 'الجهة', 'الحالة', 'تاريخ التقديم', 'تاريخ القرار', 'سبب الرفض', 'عدد المرفقات', ...fields.map((f) => f.label)];
  const body = rows.map((r) => [r.no, r.service?.label ?? '', r.student?.name ?? '', r.student?.studentNo ?? '', r.unit?.name ?? '', STATUS[r.status], d(r.createdAt), d(r.decidedAt), r.rejectReason ?? '', r.attachments.length, ...fields.map((f) => r.details[f.name] ?? '')]);
  const by = {}; for (const r of rows) { const k = `${r.service?.label ?? ''}|${r.status}`; by[k] = (by[k] ?? 0) + 1; }
  const sum = [['الخدمة', 'الحالة', 'العدد'], ...Object.entries(by).sort().map(([k, n]) => { const [a, b] = k.split('|'); return [a, STATUS[b], n]; }), [], ['الإجمالي', '', rows.length]];
  audit(db, user, `تصدير طلبات (${rows.length})`, svc?.code ?? 'all', q.ip);
  return writeXlsx([{ name: 'الطلبات', rows: [head, ...body], widths: head.map((_, i) => (i === 0 ? 18 : 22)), textCols: [3], rtl: true }, { name: 'ملخص', rows: sum, widths: [34, 18, 12], rtl: true }], { title: 'تصدير الطلبات' });
}

// استيراد دفعة: commit=false فحص بلا كتابة، commit=true تقديم الصفوف السليمة
export function importRequests(deps, user, code, { filename, data, commit }, ip) {
  const MAX_ROWS = getSetting(deps.db, 'requests.import_max_rows');
  const { db } = deps;
  if (typeof data !== 'string' || !data) throw bad('لم يصل ملف.');
  const s = getService(db, code);
  if (s.requires_attachment || JSON.parse(s.attachments_json || '[]').length) throw bad('هذه الخدمة تتطلب مرفقات؛ تُقدَّم من الواجهة لا بالاستيراد.');
  if (hasRef(s)) throw bad('هذه الخدمة تحوي حقولاً مرتبطة ببيانات الطالب؛ تُقدَّم من الواجهة.');
  let wb; try { wb = readXlsx(Buffer.from(data, 'base64')); } catch (e) { throw bad(e.message); }
  const sh = wb.sheets.find((x) => x.name === FORM) ?? wb.sheets[0];
  const [hdr, ...rows] = (sh?.rows ?? []).filter((r, i) => i === 0 || r.some((c) => String(c ?? '').trim() !== ''));
  if (!hdr || !rows.length) throw bad('الملف لا يحوي صفوف بيانات تحت العناوين.');
  if (rows.length > MAX_ROWS) throw bad(`عدد الصفوف يتجاوز ${MAX_ROWS}.`);
  const fields = fieldsOf(s), idx = new Map(hdr.map((h, i) => [norm(h), i]));
  const stuCol = s.audience !== 'staff' ? idx.get('الرقم الجامعي') : undefined;
  if (s.audience !== 'staff' && stuCol === undefined) throw bad('عمود «الرقم الجامعي» غير موجود.');
  const missing = fields.filter((f) => f.required && !idx.has(norm(f.label)));
  if (missing.length) throw bad(`أعمدة إلزامية ناقصة: ${missing.map((f) => f.label).join('، ')}.`);
  const unused = hdr.map((h) => norm(h)).filter((h) => h && h !== 'الرقم الجامعي' && !fields.some((f) => norm(f.label) === h));
  const errors = [], ok = [];
  rows.forEach((r, i) => {
    const row = i + 2;
    let who = user;
    if (s.audience !== 'staff') {
      const no = String(r[stuCol] ?? '').trim();
      const u = no ? db.prepare("SELECT id, display_name, role, student_no FROM users WHERE student_no = ? AND role = 'student' AND active = 1").get(no) : null;
      if (!u) { if (s.audience === 'student' || no) { errors.push({ row, message: no ? `الرقم الجامعي ${no} غير موجود أو غير فعّال.` : 'الرقم الجامعي مطلوب.' }); return; } }
      else who = { id: u.id, label: u.display_name, role: 'student', can: () => false };
    }
    if (requesterKind(who) !== (s.audience === 'both' ? requesterKind(who) : s.audience)) { errors.push({ row, message: 'مقدّم الطلب لا يناسب جمهور الخدمة.' }); return; }
    const details = {};
    for (const f of fields) { const v = r[idx.get(norm(f.label))]; if (v !== undefined && v !== null && String(v).trim() !== '') details[f.name] = typeof v === 'string' ? v.trim() : v; }
    try { validateDetails(s, details, { db, studentId: who.id }); } catch (e) { errors.push({ row, message: e.message }); return; }
    ok.push({ row, who, details });
  });
  let created = 0, rejectedAuto = 0;
  if (commit) {
    for (const o of ok) {
      try { const v = createRequest(deps, o.who, { service: s.code, details: o.details }, ip); created++; if (v.status === 'rejected') rejectedAuto++; }
      catch (e) { errors.push({ row: o.row, message: e.message }); }
    }
    audit(db, user, `استيراد طلبات: ${s.label} — ${created} مقدَّم / ${errors.length} مرفوض`, String(filename ?? '').slice(0, 80), ip);
  }
  return { service: s.code, committed: !!commit, filename, total: rows.length, valid: ok.length, created, rejectedAuto, unusedColumns: unused, errors: errors.sort((a, b) => a.row - b.row).slice(0, 300), errorCount: errors.length };
}

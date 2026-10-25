// الإعدادات العامة: كل قيمة كانت ثابتة في الكود صارت هنا قابلة للتعديل من لوحة الإدارة.
// المخطط (SCHEMA) هو المرجع الوحيد: يرسم الواجهة ويتحقق من القيم ويحدد الافتراضي. تُخزَّن في site_settings
// بمفتاح `cfg.<key>` (JSON)، أو بالمفتاح القديم (legacy) حين كانت القيمة محفوظة سابقاً بنص عادي.
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

const bad = (m) => new HttpError(400, m, 'validation');
const opt = (...p) => p.map(([value, label]) => ({ value, label }));

export const SCHEMA = [
  { key: 'institution', label: 'الهوية والمؤسسة', desc: 'الأسماء التي تظهر في البوابة والوثائق الموقّعة.', items: [
    { key: 'institution.university', legacy: 'university_name', label: 'اسم الجامعة', type: 'text', default: 'الجامعة السورية للعلوم الأمنية', min: 2, max: 120, arabic: true },
    { key: 'institution.portal', legacy: 'portal_title', label: 'اسم البوابة', type: 'text', default: 'بوابة خدمات الطلاب', min: 2, max: 60 },
    { key: 'institution.department', legacy: 'department_name', label: 'اسم القسم', type: 'text', default: 'قسم شؤون الطلاب', min: 2, max: 80 },
    { key: 'institution.ministry', label: 'الجهة الأعلى (ترويسة الوثائق)', type: 'text', default: 'وزارة الداخلية', min: 0, max: 80, hint: 'تظهر في ترويسة الوثائق والمراسلات المعتمدة؛ اتركها فارغة لإخفائها.' },
    { key: 'institution.country', label: 'اسم الدولة (ترويسة كشف العلامات)', type: 'text', default: 'الجمهورية العربية السورية', min: 0, max: 80 },
  ] },
  { key: 'grades', label: 'العلامات والنجاح', desc: 'سلّم العلامات وحدود الإدخال وعتبة النجاح.', items: [
    { key: 'grades.total_max', label: 'العلامة الكلية القصوى للمقرر', type: 'int', default: 100, min: 10, max: 1000, unit: 'علامة' },
    { key: 'grades.practical_max', label: 'الحد الأعلى للعلامة العملية', type: 'int', default: 30, min: 0, max: 1000, unit: 'علامة', hint: '0 = لا علامة عملية. تُرفض أي علامة عملية أعلى من هذا الحد.' },
    { key: 'grades.pass_mark', label: 'علامة النجاح', type: 'int', default: 60, min: 1, max: 1000, unit: 'علامة', hint: 'تُعتمد في العلامات والكشوف والإحصاءات والإنذار الأكاديمي والوثائق.' },
  ] },
  { key: 'academic', label: 'الأكاديمي', desc: 'حدود المقررات وتسميات السنوات الدراسية.', items: [
    { key: 'academic.max_course_hours', label: 'أقصى ساعات للمقرر الواحد', type: 'int', default: 12, min: 1, max: 40, unit: 'ساعة' },
    { key: 'academic.default_course_hours', label: 'الساعات الافتراضية عند إضافة مقرر', type: 'int', default: 3, min: 0, max: 40, unit: 'ساعة' },
    { key: 'academic.levels', label: 'تسميات السنوات الدراسية (بالترتيب)', type: 'list', default: ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة'], max: 12, itemMax: 30, hint: 'سطر لكل سنة؛ تظهر بصيغة «السنة …».' },
  ] },
  { key: 'students', label: 'الطلاب والقبول', desc: 'قوائم الاختيار في نموذج تسجيل الطالب وحدود الاستيراد.', items: [
    { key: 'students.governorates', label: 'المحافظات', type: 'list', default: ['دمشق', 'ريف دمشق', 'حلب', 'حمص', 'حماة', 'اللاذقية', 'طرطوس', 'إدلب', 'درعا', 'السويداء', 'القنيطرة', 'دير الزور', 'الرقة', 'الحسكة', 'خارج سوريا'], max: 60, itemMax: 40 },
    { key: 'students.hs_types', label: 'أنواع الشهادة الثانوية', type: 'list', default: ['الثانوية العامة - الفرع العلمي', 'الثانوية العامة - الفرع الأدبي', 'الثانوية المهنية - صناعي', 'الثانوية المهنية - تجاري', 'الثانوية المهنية - نسوي', 'الثانوية المهنية - زراعي', 'معهد متوسط', 'شهادة ثانوية أجنبية / معادلة', 'أخرى'], max: 40, itemMax: 80 },
    { key: 'students.admissions', label: 'أنواع القبول', type: 'list', default: ['القبول العام (المفاضلة)', 'التعليم الموازي', 'التعليم المفتوح / الافتراضي', 'أبناء أعضاء الهيئة التدريسية', 'الطلاب الوافدون', 'نقل من جامعة أخرى', 'أخرى'], max: 40, itemMax: 80 },
    { key: 'students.relations', label: 'صلات القرابة (ولي الأمر)', type: 'list', default: ['الأب', 'الأم', 'الأخ', 'الأخت', 'الزوج/الزوجة', 'قريب آخر', 'وصي'], max: 30, itemMax: 30 },
    { key: 'students.import_max_rows', label: 'أقصى عدد طلاب في ملف الاستيراد', type: 'int', default: 1500, min: 10, max: 20000, unit: 'طالب' },
  ] },
  { key: 'requests', label: 'الطلبات والمرفقات', desc: 'حدود المرفقات والاستيراد ومدة الإنجاز الافتراضية.', items: [
    { key: 'requests.max_attachment_mb', label: 'أقصى حجم للمرفق الواحد', type: 'int', default: 2, min: 1, max: 10, unit: 'ميغابايت' },
    { key: 'requests.max_total_mb', label: 'أقصى مجموع مرفقات الطلب', type: 'int', default: 8, min: 1, max: 10, unit: 'ميغابايت', hint: 'لا يتجاوز 10 ميغابايت (حد الطلب الواحد على الخادم).' },
    { key: 'requests.import_max_rows', label: 'أقصى صفوف في استيراد الطلبات من Excel', type: 'int', default: 500, min: 10, max: 5000, unit: 'صف' },
    { key: 'requests.default_sla_hours', label: 'مدة الإنجاز الافتراضية لخدمة جديدة', type: 'int', default: 48, min: 1, max: 720, unit: 'ساعة' },
  ] },
  { key: 'security', label: 'الأمان والجلسات', desc: 'سياسة كلمات المرور والقفل ومدة الجلسة.', items: [
    { key: 'security.password_min', label: 'أقل طول لكلمة المرور', type: 'int', default: 10, min: 6, max: 64, unit: 'حرفاً' },
    { key: 'security.max_failed_logins', label: 'محاولات الدخول الفاشلة قبل القفل', type: 'int', default: 5, min: 3, max: 20 },
    { key: 'security.lock_minutes', label: 'مدة قفل الحساب', type: 'int', default: 15, min: 1, max: 1440, unit: 'دقيقة' },
    { key: 'security.session_hours', label: 'مدة الجلسة', type: 'int', default: 8, min: 1, max: 168, unit: 'ساعة', hint: 'تسري على الجلسات الجديدة بعد الحفظ.' },
  ] },
  { key: 'hr', label: 'الحضور والإجازات', desc: 'استحقاق الإجازة والعطلة الأسبوعية.', items: [
    { key: 'hr.leave_default_days', legacy: 'leave_default_days', label: 'الاستحقاق السنوي الافتراضي للإجازة الاعتيادية', type: 'int', default: 30, min: 0, max: 366, unit: 'يوماً', hint: 'يمكن تخصيص رصيد لموظف بعينه من «الحضور والإجازات ← أرصدة الإجازات».' },
    { key: 'hr.weekend', legacy: 'weekend_days', label: 'العطلة الأسبوعية', type: 'select', default: 'fri,sat', options: opt(['fri,sat', 'الجمعة والسبت'], ['fri', 'الجمعة فقط'], ['sat,sun', 'السبت والأحد']), hint: 'تؤثر في حساب أيام الإجازات المعتمدة بعد الحفظ.' },
    { key: 'hr.currency', label: 'رمز العملة المعروض مع الرواتب', type: 'text', default: 'ل.س', min: 1, max: 10 },
    { key: 'hr.annual_leave_type', label: 'اسم نوع الإجازة المخصوم من الرصيد', type: 'text', default: 'اعتيادية', min: 2, max: 30, hint: 'يجب أن يطابق الخيار في نموذج «طلب إجازة».' },
  ] },
  { key: 'corr', label: 'المراسلات', desc: 'حدود المستندات الداخلية وترقيمها.', items: [
    { key: 'corr.max_approvers', label: 'أقصى عدد معتمدين للمستند', type: 'int', default: 12, min: 1, max: 30 },
    { key: 'corr.max_files', label: 'أقصى عدد مرفقات للمستند', type: 'int', default: 5, min: 0, max: 20 },
    { key: 'corr.no_prefix', label: 'بادئة رقم المستند', type: 'text', default: 'COR', min: 2, max: 8, ascii: true, hint: 'أحرف لاتينية كبيرة؛ تنطبق على المستندات الجديدة.' },
  ] },
  { key: 'faculty', label: 'الهيئة التدريسية', desc: 'قوائم السجل الأكاديمي للأعضاء.', items: [
    { key: 'faculty.ranks', label: 'الدرجات العلمية', type: 'list', default: ['أستاذ', 'أستاذ مشارك', 'أستاذ مساعد', 'محاضر', 'مساعد', 'معيد'], max: 20, itemMax: 40, hint: 'حذف درجة مستخدمة لا يغيّر الأعضاء الحاليين، لكن لا يمكن اختيارها لاحقاً.' },
  ] },
  { key: 'display', label: 'العرض', desc: 'أحجام القوائم في الواجهة.', items: [
    { key: 'display.news_limit', label: 'عدد الأخبار المعروضة', type: 'int', default: 30, min: 5, max: 200 },
  ] },
];

export const ITEMS = Object.fromEntries(SCHEMA.flatMap((t) => t.items.map((i) => [i.key, { ...i, tab: t.key }])));
const skey = (it) => it.legacy ?? `cfg.${it.key}`;

function decode(it, raw) {
  if (raw === undefined || raw === null) return undefined;
  try {
    if (it.legacy) { if (it.type === 'int') { const n = Number(raw); return Number.isFinite(n) ? n : undefined; } return String(raw); }
    return JSON.parse(raw);
  } catch { return undefined; }
}
const encode = (it, v) => (it.legacy ? String(v) : JSON.stringify(v));

// القيمة الفعلية: المحفوظة إن وُجدت وصالحة، وإلا fallback (إن مُرّر)، وإلا الافتراضي. تتحمّل قاعدة وهمية (لا تنكسر).
export function getSetting(db, key, fallback) {
  const it = ITEMS[key];
  if (!it) throw new Error(`إعداد غير معروف: ${key}`);
  let v;
  try { v = decode(it, db.prepare('SELECT value FROM site_settings WHERE key = ?').get(skey(it))?.value); } catch { v = undefined; }
  if (v !== undefined) { try { return normalize(it, v); } catch { /* قيمة تالفة: نعود للافتراضي */ } }
  return fallback !== undefined ? fallback : it.default;
}

function normalize(it, v) {
  const label = `«${it.label}»`;
  switch (it.type) {
    case 'int': {
      const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
      if (!Number.isInteger(n) || n < it.min || n > it.max) throw bad(`${label}: عدد صحيح من ${it.min} إلى ${it.max}.`);
      return n;
    }
    case 'text': {
      const s = String(v ?? '').replace(/\s+/g, ' ').trim();
      if (s.length < (it.min ?? 0) || s.length > it.max) throw bad(`${label}: ${it.min ? `من ${it.min} إلى ` : 'حتى '}${it.max} حرفاً.`);
      if (/[\x00-\x1f<>]/.test(s)) throw bad(`${label} يحوي رموزاً غير مسموحة.`);
      if (it.arabic && !/[؀-ۿ]/.test(s)) throw bad(`${label} يجب أن يحوي حروفاً عربية.`);
      if (it.ascii && !/^[A-Z][A-Z0-9]*$/.test(s)) throw bad(`${label}: أحرف لاتينية كبيرة وأرقام فقط.`);
      return s;
    }
    case 'select': {
      if (!it.options.some((o) => o.value === v)) throw bad(`${label}: خيار غير صالح.`);
      return v;
    }
    case 'bool': return !!v;
    case 'list': {
      const arr = Array.isArray(v) ? v : String(v ?? '').split('\n');
      const out = [];
      for (const x of arr) {
        const s = String(x ?? '').replace(/\s+/g, ' ').trim();
        if (!s) continue;
        if (s.length > it.itemMax) throw bad(`${label}: العنصر «${s.slice(0, 20)}…» أطول من ${it.itemMax} حرفاً.`);
        if (/[\x00-\x1f<>]/.test(s)) throw bad(`${label}: رموز غير مسموحة.`);
        if (!out.includes(s)) out.push(s);
      }
      if (!out.length) throw bad(`${label}: أدخل عنصراً واحداً على الأقل.`);
      if (out.length > it.max) throw bad(`${label}: حتى ${it.max} عنصراً.`);
      return out;
    }
    default: throw new Error('نوع إعداد غير معروف');
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// كل الإعدادات للواجهة: القيمة الحالية + الافتراضي + هل عُدِّلت
export function listSettings(db) {
  return { tabs: SCHEMA.map((t) => ({ key: t.key, label: t.label, desc: t.desc, items: t.items.map((it) => {
    const value = getSetting(db, it.key);
    const { key, label, type, hint, min, max, unit, itemMax, options } = it;
    return { key, label, type, hint: hint ?? '', min, max, unit: unit ?? '', itemMax, options, default: it.default, value, changed: !same(value, it.default) };
  }) })) };
}

// حفظ دفعة قيم: تُتحقَّق كلها قبل أي كتابة (إما الكل أو لا شيء) مع تدقيق القديم والجديد
export function saveSettings({ db }, actor, input, ip) {
  const values = input?.values;
  if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) throw bad('لا توجد قيم للحفظ.');
  const next = {};
  for (const [k, v] of Object.entries(values)) {
    const it = ITEMS[k];
    if (!it) throw bad(`إعداد غير معروف: ${k}`);
    next[k] = normalize(it, v);
  }
  // اتساق: النجاح والعملي ضمن العلامة القصوى
  const val = (k) => (k in next ? next[k] : getSetting(db, k));
  if (val('grades.pass_mark') > val('grades.total_max')) throw bad('علامة النجاح لا تتجاوز العلامة الكلية القصوى.');
  if (val('grades.practical_max') > val('grades.total_max')) throw bad('الحد الأعلى للعلامة العملية لا يتجاوز العلامة الكلية القصوى.');
  const changes = [];
  tx(db, () => {
    const up = db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(next)) {
      const it = ITEMS[k], old = getSetting(db, k);
      if (same(old, v)) continue;
      up.run(skey(it), encode(it, v));
      changes.push(`${k}: ${JSON.stringify(old).slice(0, 60)} ← ${JSON.stringify(v).slice(0, 60)}`);
    }
    if (changes.length) audit(db, actor, 'تعديل الإعدادات العامة', changes.join(' | ').slice(0, 900), ip);
  });
  return { changed: changes.length, ...listSettings(db) };
}

// إعادة قيم إلى الافتراضي (حذف المخزَّن)
export function resetSettings({ db }, actor, input, ip) {
  const keys = Array.isArray(input?.keys) ? input.keys : [];
  if (!keys.length) throw bad('حدّد الإعدادات المراد إعادتها.');
  for (const k of keys) if (!ITEMS[k]) throw bad(`إعداد غير معروف: ${k}`);
  tx(db, () => {
    for (const k of keys) db.prepare('DELETE FROM site_settings WHERE key = ?').run(skey(ITEMS[k]));
    audit(db, actor, 'إعادة إعدادات عامة إلى الافتراضي', keys.join(',').slice(0, 300), ip);
  });
  return listSettings(db);
}

// القيم التي يحتاجها المتصفح (حدود الإدخال) — بلا مفاتيح حساسة
export function publicLimits(db) {
  return {
    passMark: getSetting(db, 'grades.pass_mark'), totalMax: getSetting(db, 'grades.total_max'), practicalMax: getSetting(db, 'grades.practical_max'),
    maxCourseHours: getSetting(db, 'academic.max_course_hours'), defaultCourseHours: getSetting(db, 'academic.default_course_hours'),
    passwordMin: getSetting(db, 'security.password_min'), defaultSla: getSetting(db, 'requests.default_sla_hours'),
    maxAttachmentMb: getSetting(db, 'requests.max_attachment_mb'), governorates: getSetting(db, 'students.governorates'),
  };
}

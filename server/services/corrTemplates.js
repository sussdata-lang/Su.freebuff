// قوالب المراسلات الجاهزة + إدارتها. العناصر البديلة: {{date}} تاريخ اليوم، {{unit}} وحدة المنشئ، {{name}} اسم المنشئ (تُستبدل في الواجهة عند الاختيار).
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

const bad = (m) => new HttpError(400, m, 'validation');
const SIG = '\n\nمع الشكر والتقدير،\n{{name}}\n{{unit}}';
export const BUILTIN_TEMPLATES = [
  ['purchase', 'طلب شراء', 'المشتريات والمالية', 'طلب شراء', 'طلب شراء تجهيزات وأدوات', 'التاريخ: {{date}}\nالجهة الطالبة: {{unit}}\n\nنرجو الموافقة على شراء المواد التالية:\n1. ........ (الكمية: ..، المواصفات: ..)\n2. ........ (الكمية: ..، المواصفات: ..)\n\nالقيمة التقديرية: ........\nمسوّغ الشراء: ........\nمرفق: عروض الأسعار.' + SIG, 'sequential'],
  ['monthly_report', 'تقرير شهري', 'التقارير', 'التقرير الشهري', 'التقرير الشهري لأعمال {{unit}}', 'التاريخ: {{date}}\n\nأولاً: أبرز الإنجازات خلال الشهر:\n- ........\n\nثانياً: المؤشرات والأرقام:\n- ........\n\nثالثاً: التحديات والمعوّقات:\n- ........\n\nرابعاً: خطة الشهر القادم:\n- ........' + SIG, 'parallel'],
  ['circular', 'تعميم داخلي', 'الإدارة', 'تعميم', 'تعميم إلى العاملين', 'التاريخ: {{date}}\n\nيُعمَّم على جميع العاملين ما يلي:\n........\n\nويُعمل به اعتباراً من تاريخ ........' + SIG, 'sequential'],
  ['minutes', 'محضر اجتماع', 'الإدارة', 'محضر اجتماع', 'محضر اجتماع بتاريخ {{date}}', 'التاريخ: {{date}}    المكان: ........\nالحضور: ........\nالغياب: ........\n\nجدول الأعمال:\n1. ........\n\nالقرارات والتوصيات:\n1. ........ (المسؤول: .. — الموعد: ..)\n\nأمين السر: {{name}}', 'parallel'],
  ['assignment', 'طلب تكليف أو ندب', 'الموارد البشرية', 'طلب تكليف', 'طلب تكليف موظف بمهمة', 'التاريخ: {{date}}\n\nنرجو الموافقة على تكليف السيد/ة ........ بالمهمة التالية: ........\nالمدة: من ........ إلى ........\nالمبررات: ........' + SIG, 'sequential'],
  ['maintenance', 'طلب صيانة', 'الخدمات', 'طلب صيانة', 'طلب صيانة في ........', 'التاريخ: {{date}}\nالموقع: ........\nوصف العطل: ........\nدرجة الاستعجال: ( عادي / مستعجل / طارئ )' + SIG, 'parallel'],
  ['external_letter', 'كتاب رسمي إلى جهة خارجية', 'المراسلات الخارجية', 'كتاب إلى جهة خارجية', 'كتاب رسمي إلى ........', 'السيد/ة ........ المحترم/ة\n\nتحية طيبة وبعد،\n\nنودّ إعلامكم بـ ........\nوعليه نأمل التفضل بـ ........' + SIG, 'sequential'],
  ['mission', 'طلب إيفاد أو مهمة رسمية', 'الموارد البشرية', 'طلب إيفاد', 'طلب إيفاد إلى ........', 'التاريخ: {{date}}\n\nنرجو الموافقة على إيفاد السيد/ة ........ إلى ........ للغاية التالية: ........\nمن ........ إلى ........\nالتكاليف المتوقعة: ........' + SIG, 'sequential'],
  ['memo', 'مذكرة داخلية', 'الإدارة', 'مذكرة داخلية', 'مذكرة بخصوص ........', 'التاريخ: {{date}}\nإلى: ........\nمن: {{name}} — {{unit}}\n\nالموضوع: ........\n\n........' , 'parallel'],
  ['budget', 'طلب موافقة على بند مالي', 'المشتريات والمالية', 'طلب موافقة مالية', 'طلب موافقة على صرف ........', 'التاريخ: {{date}}\nالبند: ........\nالمبلغ المطلوب: ........\nالمخصص المتاح: ........\nالمبررات: ........' + SIG, 'sequential'],
  ['decision', 'إشعار قرار', 'الإدارة', 'إشعار قرار', 'إشعار بقرار ........', 'التاريخ: {{date}}\n\nنُشعركم بصدور القرار التالي:\n........\nويُبلَّغ إلى الجهات المعنية للتنفيذ.' + SIG, 'parallel'],
  ['it_request', 'طلب تجهيزات أو خدمة تقنية', 'التقنية', 'طلب تقني', 'طلب تجهيزات أو خدمة تقنية', 'التاريخ: {{date}}\nالجهة الطالبة: {{unit}}\nنوع الطلب: ( جهاز / برمجيات / صلاحيات / شبكة )\nالتفاصيل: ........\nالمستخدمون المعنيون: ........' + SIG, 'parallel'],
].map(([code, name, category, title, subject, body, mode]) => ({ code, name, category, title, subject, body, mode }));

const ensure = (db) => { for (const t of BUILTIN_TEMPLATES) db.prepare('INSERT OR IGNORE INTO corr_templates (code, name, category, title, subject, body, mode, active, builtin, created_at) VALUES (?,?,?,?,?,?,?,1,1,?)').run(t.code, t.name, t.category, t.title, t.subject, t.body, t.mode, Date.now()); };
const shape = (r) => ({ code: r.code, name: r.name, category: r.category, title: r.title, subject: r.subject, body: r.body, mode: r.mode, active: !!r.active, builtin: !!r.builtin });

export function listTemplates({ db }, user, q) {
  ensure(db);
  const all = q?.all === '1' && user.can('corr:templates');
  return db.prepare(`SELECT * FROM corr_templates ${all ? '' : 'WHERE active = 1'} ORDER BY builtin DESC, category, name`).all().map(shape);
}

function parse(input, existing) {
  const m = { ...(existing ?? {}), ...input };
  const name = String(m.name ?? '').replace(/\s+/g, ' ').trim(), title = String(m.title ?? '').trim(), subject = String(m.subject ?? '').trim().slice(0, 200), body = String(m.body ?? '').trim().slice(0, 8000);
  const category = String(m.category ?? 'عام').replace(/\s+/g, ' ').trim().slice(0, 60) || 'عام';
  if (name.length < 2 || name.length > 80) throw bad('اسم القالب بين 2 و80 حرفاً.');
  if (title.length < 2 || title.length > 120) throw bad('عنوان المستند بين 2 و120 حرفاً.');
  if (!body) throw bad('نص القالب مطلوب.');
  return { name, title, subject, body, category, mode: m.mode === 'sequential' ? 'sequential' : 'parallel', active: m.active === undefined ? 1 : (m.active ? 1 : 0) };
}

export function createTemplate({ db }, actor, input, ip) {
  const code = String(input?.code ?? '').trim();
  if (!/^[a-z][a-z0-9_]{2,29}$/.test(code)) throw bad('رمز القالب: 3 إلى 30 حرفاً لاتينياً صغيراً أو أرقاماً أو _ ويبدأ بحرف.');
  ensure(db);
  if (db.prepare('SELECT 1 FROM corr_templates WHERE code = ?').get(code)) throw new HttpError(409, 'رمز القالب مستخدم.', 'conflict');
  const v = parse(input);
  db.prepare('INSERT INTO corr_templates (code, name, category, title, subject, body, mode, active, builtin, created_at) VALUES (?,?,?,?,?,?,?,?,0,?)').run(code, v.name, v.category, v.title, v.subject, v.body, v.mode, v.active, Date.now());
  audit(db, actor, `إضافة قالب مراسلات: ${v.name}`, code, ip);
  return { code };
}
export function updateTemplate({ db }, actor, code, input, ip) {
  ensure(db);
  const cur = db.prepare('SELECT * FROM corr_templates WHERE code = ?').get(String(code));
  if (!cur) throw new HttpError(404, 'القالب غير موجود.', 'not_found');
  const v = parse(input, cur);
  db.prepare('UPDATE corr_templates SET name = ?, category = ?, title = ?, subject = ?, body = ?, mode = ?, active = ? WHERE code = ?').run(v.name, v.category, v.title, v.subject, v.body, v.mode, v.active, cur.code);
  audit(db, actor, `تعديل قالب مراسلات: ${v.name}`, cur.code, ip);
  return { ok: true };
}
export function deleteTemplate({ db }, actor, code, ip) {
  const cur = db.prepare('SELECT * FROM corr_templates WHERE code = ?').get(String(code));
  if (!cur) throw new HttpError(404, 'القالب غير موجود.', 'not_found');
  if (cur.builtin) throw new HttpError(409, 'القوالب الأساسية لا تُحذف؛ عطّلها بدلاً من ذلك.', 'conflict');
  db.prepare('DELETE FROM corr_templates WHERE code = ?').run(cur.code);
  audit(db, actor, `حذف قالب مراسلات: ${cur.name}`, cur.code, ip);
  return { ok: true };
}

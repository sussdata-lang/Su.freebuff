import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

// الخدمات الأساسية لها قوالب وثائق خاصة في الواجهة، لذا تبقى حقولها وإصدارها للوثيقة ثابتين
export const BUILTIN = new Set(['attendance', 'transcript', 'excellence_year', 'campus_life', 'excuse']);
const TYPES = ['text', 'textarea', 'select', 'number', 'decimal', 'date', 'ref'];
const REFS = ['program', 'my_course', 'my_grade'];
const AUDIENCES = ['student', 'staff', 'both'];
export const MAX_FIELDS = 16;
const bad = (m) => new HttpError(400, m, 'validation');

function parseCommon(db, input) {
  const label = String(input?.label ?? '').replace(/\s+/g, ' ').trim();
  const description = String(input?.description ?? '').replace(/\s+/g, ' ').trim();
  const sla = Number(input?.slaHours);
  if (label.length < 2 || label.length > 80) throw bad('اسم الخدمة يجب أن يكون بين 2 و80 حرفاً.');
  if (description.length < 2 || description.length > 300) throw bad('وصف الخدمة يجب أن يكون بين 2 و300 حرف.');
  if (!Number.isInteger(sla) || sla < 1 || sla > 720) throw bad('مدة الإنجاز: عدد صحيح من 1 إلى 720 ساعة.');
  const unit = input?.unit ? String(input.unit) : null;
  if (unit && !db.prepare('SELECT 1 FROM org_units WHERE code = ?').get(unit)) throw bad('الوحدة المسؤولة غير موجودة.');
  const audience = input?.audience ?? 'student';
  if (!AUDIENCES.includes(audience)) throw bad('جمهور الخدمة: طلاب أو موظفون أو كلاهما.');
  const category = input?.category ? String(input.category).replace(/\s+/g, ' ').trim() : null;
  if (category && category.length > 60) throw bad('اسم الفئة حتى 60 حرفاً.');
  const instructions = String(input?.instructions ?? '').trim();
  if (instructions.length > 1000) throw bad('التعليمات حتى 1000 حرف.');
  const slots = input?.attachments ?? [];
  if (!Array.isArray(slots) || slots.length > 8) throw bad('المرفقات المطلوبة: حتى 8.');
  const attachments = slots.map((s) => {
    const l = String(s?.label ?? '').replace(/\s+/g, ' ').trim();
    if (l.length < 1 || l.length > 60) throw bad('تسمية المرفق مطلوبة (حتى 60 حرفاً).');
    return { label: l, required: !!s.required };
  });
  const maxAtt = input?.maxAttachments === undefined ? Math.max(1, attachments.length) : Number(input.maxAttachments);
  if (!Number.isInteger(maxAtt) || maxAtt < 1 || maxAtt > 8) throw bad('الحد الأقصى للمرفقات من 1 إلى 8.');
  if (maxAtt < attachments.length) throw bad('الحد الأقصى للمرفقات أقل من عدد المرفقات المعرَّفة.');
  const att = (input?.requiresAttachment || attachments.some((s) => s.required)) ? 1 : 0;
  return { label, description, sla, att, doc: input?.issuesDocument === false ? 0 : 1, unit, audience, category, instructions, attachments, maxAtt };
}

// أسماء الحقول الموجودة تُحفظ كما هي كي لا تنكسر الطلبات القديمة، وتُولَّد f1، f2… للجديدة
function parseFields(input) {
  if (!Array.isArray(input) || input.length > MAX_FIELDS) throw bad(`عدد الحقول يجب ألا يتجاوز ${MAX_FIELDS}.`);
  const used = new Set();
  const out = input.map((raw) => {
    const label = String(raw?.label ?? '').replace(/\s+/g, ' ').trim();
    if (label.length < 1 || label.length > 60) throw bad('تسمية الحقل مطلوبة (حتى 60 حرفاً).');
    if (!TYPES.includes(raw?.type)) throw bad(`نوع الحقل «${label}» غير صالح.`);
    let name = raw.name ?? null;
    if (name !== null) {
      if (!/^[a-z][a-z0-9_]{0,29}$/.test(name) || used.has(name)) throw bad('اسم حقل غير صالح أو مكرر.');
      used.add(name);
    }
    const f = { name, label, type: raw.type };
    if (raw.type === 'ref') { if (!REFS.includes(raw.ref)) throw bad(`مرجع الحقل «${label}» غير صالح.`); f.ref = raw.ref; }
    if (raw.required) f.required = true;
    if (raw.hint) { f.hint = String(raw.hint).replace(/\s+/g, ' ').trim().slice(0, 120); }
    if (raw.type === 'number' || raw.type === 'decimal') {
      const lo = raw.min === undefined || raw.min === null ? 0 : Number(raw.min), hi = raw.max === undefined || raw.max === null ? (raw.type === 'number' ? 1000 : 1e9) : Number(raw.max);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) throw bad(`حدّا «${label}» غير صالحين.`);
      f.min = lo; f.max = hi;
    }
    if (raw.type === 'select') {
      const opts = Array.isArray(raw.options) ? raw.options.map((o) => String(o).replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
      if (opts.length < 2 || opts.length > 20 || opts.some((o) => o.length > 40) || new Set(opts).size !== opts.length) throw bad(`خيارات «${label}»: من 2 إلى 20 خياراً غير مكررة (حتى 40 حرفاً لكل خيار).`);
      f.options = opts;
    }
    return f;
  });
  let n = 1;
  for (const f of out) if (!f.name) { while (used.has('f' + n)) n++; f.name = 'f' + n; used.add(f.name); }
  return out;
}

const shape = (s) => ({
  code: s.code, label: s.label, description: s.description, slaHours: s.sla_hours, requiresAttachment: !!s.requires_attachment,
  issuesDocument: !!s.issues_document, enabled: !!s.enabled, builtin: BUILTIN.has(s.code), requests: s.requests, fields: JSON.parse(s.fields_json),
  unit: s.unit_code, unitName: s.unit_name ?? null, audience: s.audience, category: s.category, instructions: s.instructions,
  attachments: JSON.parse(s.attachments_json), maxAttachments: s.max_attachments,
});

export function listServices({ db }) {
  return db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM requests r WHERE r.service_code = s.code) AS requests,
      (SELECT o.name FROM org_units o WHERE o.code = s.unit_code) AS unit_name FROM service_types s ORDER BY s.rowid`).all().map(shape);
}

export function createService({ db }, actor, input, ip) {
  const code = String(input?.code ?? '').trim();
  if (!/^[a-z][a-z0-9_]{2,29}$/.test(code)) throw bad('رمز الخدمة: 3 إلى 30 حرفاً لاتينياً صغيراً أو أرقاماً أو _ ويبدأ بحرف.');
  if (db.prepare('SELECT 1 FROM service_types WHERE code = ?').get(code)) throw new HttpError(409, 'رمز الخدمة مستخدم مسبقاً.', 'conflict');
  const v = parseCommon(db, input), fields = parseFields(input?.fields ?? []);
  tx(db, () => {
    db.prepare(`INSERT INTO service_types (code, label, description, sla_hours, requires_attachment, issues_document, fields_json, enabled, unit_code, audience, category, instructions, attachments_json, max_attachments)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(code, v.label, v.description, v.sla, v.att, v.doc, JSON.stringify(fields), input?.enabled === false ? 0 : 1, v.unit, v.audience, v.category, v.instructions, JSON.stringify(v.attachments), v.maxAtt);
    audit(db, actor, `إضافة خدمة: ${v.label}`, code, ip);
  });
  return { code };
}

export function updateService({ db }, actor, code, input, ip) {
  const s = db.prepare('SELECT * FROM service_types WHERE code = ?').get(String(code));
  if (!s) throw new HttpError(404, 'الخدمة غير موجودة.', 'not_found');
  const builtin = BUILTIN.has(s.code);
  if (builtin && input?.fields !== undefined) throw bad('حقول الخدمات الأساسية ثابتة لارتباطها بقوالب الوثائق.');
  // الحقول غير المرسَلة تبقى كما هي (مثل تبديل التفعيل من القائمة)
  const merged = { unit: s.unit_code, audience: s.audience, category: s.category, instructions: s.instructions, attachments: JSON.parse(s.attachments_json), maxAttachments: s.max_attachments, ...input };
  const v = parseCommon(db, merged);
  const fieldsJson = builtin ? s.fields_json : JSON.stringify(parseFields(input?.fields ?? JSON.parse(s.fields_json)));
  const doc = builtin ? s.issues_document : v.doc;
  const enabled = input?.enabled === undefined ? s.enabled : (input.enabled ? 1 : 0);
  tx(db, () => {
    db.prepare(`UPDATE service_types SET label = ?, description = ?, sla_hours = ?, requires_attachment = ?, issues_document = ?, fields_json = ?, enabled = ?,
      unit_code = ?, audience = ?, category = ?, instructions = ?, attachments_json = ?, max_attachments = ? WHERE code = ?`)
      .run(v.label, v.description, v.sla, v.att, doc, fieldsJson, enabled, v.unit, v.audience, v.category, v.instructions, JSON.stringify(v.attachments), v.maxAtt, s.code);
    audit(db, actor, `تعديل خدمة: ${v.label}${enabled !== s.enabled ? (enabled ? ' (تفعيل)' : ' (تعطيل)') : ''}`, s.code, ip);
  });
  return { ok: true };
}

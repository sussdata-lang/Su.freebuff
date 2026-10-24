import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { sha256 } from '../security.js';
import { HttpError } from '../http.js';
import { runRules } from './rules.js';
import { issueDocument } from './documents.js';
import { linkedTargets } from './access.js';
import { recordLeaveOnApprove } from './staffatt.js';

export const ACADEMIC = new Set(['postponement', 'withdrawal', 'program_transfer', 'grade_appeal', 'violation_report']);
const pad = (n, w) => String(n).padStart(w, '0');

export function detectMime(buf) {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

// حقول «ref»: قوائم مرتبطة ببيانات الطالب نفسه (برامج أخرى، علاماته…). تُحوَّل لقائمة خيارات نصية تحمل المعرّف [#id]
export function refOptions(db, studentId, ref) {
  const p = db.prepare('SELECT program_id, study_level FROM student_profiles WHERE user_id = ?').get(Number(studentId));
  if (ref === 'program') return db.prepare('SELECT id, faculty, name FROM programs WHERE active = 1 AND id != ? ORDER BY faculty, name').all(p?.program_id ?? -1).map((r) => ({ id: r.id, label: `${r.faculty} — ${r.name} [#${r.id}]` }));
  if (ref === 'my_course') return db.prepare('SELECT id, name, level FROM courses WHERE program_id = ? AND level <= ? ORDER BY level, name').all(p?.program_id ?? -1, p?.study_level ?? 0).map((r) => ({ id: r.id, label: `${r.name} (السنة ${r.level}) [#${r.id}]` }));
  if (ref === 'my_grade') return db.prepare("SELECT id, course, academic_year ay, mark FROM grades WHERE student_id = ? AND workflow_status = 'approved' ORDER BY academic_year DESC, course").all(Number(studentId)).map((r) => ({ id: r.id, label: `${r.course} (${r.ay ?? r.term}) — ${r.mark} [#${r.id}]` }));
  return [];
}
export const expandFields = (db, studentId, fieldsJson) => JSON.parse(fieldsJson).map((f) => (f.type === 'ref' ? { ...f, type: 'select', options: refOptions(db, studentId, f.ref).map((o) => o.label) } : f));

// تحقق صارم من الحقول وفق تعريف الخدمة، وتجاهل أي حقل غير معرَّف
export function validateDetails(service, input, ctx) {
  const fields = JSON.parse(service.fields_json), out = {};
  for (const f of fields) {
    if (f.type === 'ref') {
      const v = input?.[f.name];
      if (v === undefined || v === null || v === '') { if (f.required) throw new HttpError(400, `الحقل «${f.label}» مطلوب.`, 'validation'); continue; }
      const opt = refOptions(ctx.db, ctx.studentId, f.ref).find((o) => o.label === v);
      if (!opt) throw new HttpError(400, `قيمة غير صالحة في «${f.label}».`, 'validation');
      out[f.name] = opt.label.replace(/\s*\[#\d+\]$/, ''); out[`${f.name}__id`] = opt.id;
      continue;
    }
    let v = input?.[f.name];
    if (v === undefined || v === null || v === '') v = f.default;
    if (v === undefined || v === '') { if (f.required) throw new HttpError(400, `الحقل «${f.label}» مطلوب.`, 'validation'); continue; }
    if (f.type === 'select') { if (!f.options.includes(v)) throw new HttpError(400, `قيمة غير صالحة في «${f.label}».`, 'validation'); }
    else if (f.type === 'number') { v = Number(v); if (!Number.isInteger(v) || v < (f.min ?? 0) || v > (f.max ?? 1000)) throw new HttpError(400, `قيمة غير صالحة في «${f.label}».`, 'validation'); }
    else if (f.type === 'decimal') {
      const s = String(v).trim().replace(',', '.');
      if (!/^\d{1,12}(\.\d{1,2})?$/.test(s) || Number(s) < (f.min ?? 0) || Number(s) > (f.max ?? 1e9)) throw new HttpError(400, `قيمة غير صالحة في «${f.label}» (رقم بحد أقصى منزلتين عشريتين).`, 'validation');
      v = s;
    }
    else if (f.type === 'textarea') { v = String(v).trim(); if (v.length < 1 || v.length > 1000) throw new HttpError(400, `«${f.label}» يجب ألا يتجاوز 1000 حرف.`, 'validation'); }
    else if (f.type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `تاريخ غير صالح في «${f.label}».`, 'validation'); }
    else { v = String(v).trim(); if (v.length < 1 || v.length > 200) throw new HttpError(400, `«${f.label}» يجب ألا يتجاوز 200 حرف.`, 'validation'); }
    out[f.name] = v;
  }
  return out;
}

export function addEvent(db, requestId, actorLabel, text) {
  db.prepare('INSERT INTO request_events (request_id, at, actor_label, text) VALUES (?,?,?,?)').run(requestId, Date.now(), actorLabel, text);
}

// نطاق رؤية الطلبات: all (كل الطلبات) | unit (المحالة إلى وحدة المستخدم) | own (طلبات الطالب نفسه)
export const scopeOf = (user) => (user.can('request:read_all') ? 'all' : user.can('request:read_unit') ? 'unit' : 'own');
// «unit» يشمل وحدة المستخدم ووحداتها الفرعية (رئيس الوحدة يرى طلبات مكاتبه)، وطلبات صاحب الحساب نفسه دائماً
export function visibleTo(user, r) {
  if (r.student_id === user.id) return true;
  const s = scopeOf(user);
  if (s === 'all') return true;
  if (s === 'unit') return !!user.unit_id && r.assigned_unit_id != null && (user.unitIds ?? [user.unit_id]).includes(r.assigned_unit_id);
  return false;
}

export function requestView(db, r, { withStudent = false } = {}) {
  const svc = db.prepare('SELECT code, label, sla_hours FROM service_types WHERE code = ?').get(r.service_code);
  const atts = db.prepare('SELECT id, orig_name, size, mime, slot_label FROM attachments WHERE request_id = ? ORDER BY id').all(r.id).map((a) => ({ id: a.id, name: a.orig_name, size: a.size, slot: a.slot_label }));
  const att = atts[0];
  const doc = db.prepare('SELECT code, issued_at FROM documents WHERE request_id = ?').get(r.id);
  const v = {
    id: r.id, no: r.no, service: svc, details: Object.fromEntries(Object.entries(JSON.parse(r.details_json)).filter(([k]) => !k.endsWith('__id'))), status: r.status,
    rejectReason: r.reject_reason, rejectedBy: r.rejected_by, createdAt: r.created_at, decidedAt: r.decided_at,
    attachment: att ? { id: att.id, name: att.name, size: att.size } : null, attachments: atts,
    document: doc ? { code: doc.code, issuedAt: doc.issued_at } : null,
    unit: r.assigned_unit_id ? db.prepare('SELECT id, name FROM org_units WHERE id = ?').get(r.assigned_unit_id) : null,
    events: db.prepare('SELECT at, actor_label AS actor, text FROM request_events WHERE request_id = ? ORDER BY id').all(r.id),
  };
  if (withStudent) {
    const s = db.prepare('SELECT u.id, u.display_name, u.student_no, u.role, o.name unit FROM users u LEFT JOIN org_units o ON o.id = u.unit_id WHERE u.id = ?').get(r.student_id);
    v.student = { id: s.id, name: s.display_name, studentNo: s.student_no, kind: s.role === 'student' ? 'student' : 'staff', unit: s.unit ?? null };
  }
  return v;
}

export const MAX_TOTAL_ATTACH = 8 * 1024 * 1024;

// يقرأ المرفقات من الطلب: attachments[] (الجديدة) أو attachment (القديمة، مفرد)
function readAttachments(cfg, service, input) {
  const raw = Array.isArray(input.attachments) ? input.attachments : (input.attachment ? [input.attachment] : []);
  if (raw.length > service.max_attachments) throw new HttpError(400, `الحد الأقصى للمرفقات في هذه الخدمة ${service.max_attachments}.`, 'validation');
  const slots = JSON.parse(service.attachments_json || '[]');
  let total = 0;
  return raw.map((a, i) => {
    if (!a || typeof a.data !== 'string' || typeof a.name !== 'string') throw new HttpError(400, 'مرفق غير صالح.', 'validation');
    const buf = Buffer.from(a.data, 'base64');
    if (!buf.length || buf.length > cfg.maxAttachmentBytes) throw new HttpError(413, 'حجم المرفق الواحد يجب ألا يتجاوز 2 ميغابايت.', 'too_large');
    total += buf.length; if (total > MAX_TOTAL_ATTACH) throw new HttpError(413, 'مجموع المرفقات يجب ألا يتجاوز 8 ميغابايت.', 'too_large');
    const mime = detectMime(buf);
    if (!mime) throw new HttpError(415, 'المرفقات المسموحة: PDF أو PNG أو JPG.', 'bad_type');
    const slot = typeof a.slot === 'string' && slots.some((s) => s.label === a.slot) ? a.slot : (slots[i]?.label ?? null);
    return { buf, mime, slot, name: path.basename(a.name).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 100) || 'attachment' };
  });
}

// جمهور الطلب: الطالب (role=student) أو موظف/مدير. الموظف يقدّم الطلبات الداخلية فقط
export const requesterKind = (user) => (user.role === 'student' ? 'student' : 'staff');

export function createRequest({ db, cfg }, user, input, ip) {
  const service = db.prepare('SELECT * FROM service_types WHERE code = ? AND enabled = 1').get(input?.service);
  if (!service) throw new HttpError(400, 'خدمة غير معروفة.', 'validation');
  const kind = requesterKind(user);
  if (service.audience !== 'both' && service.audience !== kind) throw new HttpError(400, kind === 'student' ? 'هذه الخدمة للموظفين فقط.' : 'هذه الخدمة للطلاب فقط.', 'validation');
  const details = validateDetails(service, input.details, { db, studentId: user.id });

  const atts = readAttachments(cfg, service, input);
  const requiredN = JSON.parse(service.attachments_json || '[]').filter((s) => s.required).length;
  if (service.requires_attachment && atts.length < Math.max(1, requiredN)) throw new HttpError(400, requiredN > 1 ? `هذه الخدمة تتطلب ${requiredN} مرفقات على الأقل.` : 'هذه الخدمة تتطلب مرفقاً.', 'validation');
  const unit = service.unit_code ? db.prepare('SELECT id FROM org_units WHERE code = ? AND active = 1').get(service.unit_code) : null;

  const storedPaths = [];
  try {
    const result = tx(db, () => {
      const check = kind === 'student' ? runRules(db, { studentId: user.id, serviceCode: service.code, hasAttachment: atts.length > 0 }) : { ok: true };
      const nextId = (db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM requests').get().n);
      const no = `REQ-${new Date().getFullYear()}-${pad(nextId, 5)}`;
      const now = Date.now();
      const rejected = !check.ok;
      db.prepare(`INSERT INTO requests (id, no, student_id, service_code, details_json, status, reject_reason, rejected_by, created_at, decided_at, assigned_unit_id)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(nextId, no, user.id, service.code, JSON.stringify(details), rejected ? 'rejected' : 'review', rejected ? check.message : null, rejected ? 'auto' : null, now, rejected ? now : null, unit?.id ?? null);
      addEvent(db, nextId, user.label, 'تقديم الطلب');
      if (ACADEMIC.has(service.code)) {
        db.prepare(`INSERT INTO academic_request_details (request_id, request_category, target_program_id, target_course_id, target_grade_id, claimed_mark, violation_type, justification, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(nextId, service.code, details.target_program_id__id ?? null, details.target_course_id__id ?? null, details.target_grade_id__id ?? null,
          Number.isInteger(details.claimed_mark) ? details.claimed_mark : null, details.violation_type ?? null, details.justification ?? details.reason ?? null, now);
      }
      if (atts.length) fs.mkdirSync(cfg.uploadDir, { recursive: true });
      for (const att of atts) {
        const stored = crypto.randomBytes(16).toString('hex');
        const p = path.join(cfg.uploadDir, stored);
        fs.writeFileSync(p, att.buf, { mode: 0o600 }); storedPaths.push(p);
        db.prepare('INSERT INTO attachments (request_id, orig_name, stored_name, mime, size, sha256, slot_label) VALUES (?,?,?,?,?,?,?)')
          .run(nextId, att.name, stored, att.mime, att.buf.length, sha256(att.buf), att.slot);
      }
      if (unit) addEvent(db, nextId, 'النظام', `أُسند الطلب تلقائياً إلى «${db.prepare('SELECT name FROM org_units WHERE id = ?').get(unit.id).name}»`);
      addEvent(db, nextId, 'النظام', rejected ? `الفحص الآلي: رُفض الطلب تلقائياً (${check.message})` : (kind === 'student' ? 'الفحص الآلي: اجتاز القواعد، أُحيل لمراجعة الموظف' : 'أُحيل لمراجعة الجهة المختصة'));
      audit(db, user, `تقديم طلب: ${service.label}${rejected ? ' (رفض آلي)' : ''}`, no, ip);
      return nextId;
    });
    return requestView(db, db.prepare('SELECT * FROM requests WHERE id = ?').get(result));
  } catch (e) {
    for (const p of storedPaths) fs.rmSync(p, { force: true });
    throw e;
  }
}

export function listRequests({ db }, user, query) {
  const scope = scopeOf(user), own = scope === 'own';
  const where = [], args = [];
  if (scope === 'own') { where.push('student_id = ?'); args.push(user.id); }
  if (scope === 'unit') {
    const ids = (user.unitIds?.length ? user.unitIds : [user.unit_id ?? -1]);
    where.push(`(assigned_unit_id IN (${ids.map(() => '?').join(',')}) OR student_id = ?)`); args.push(...ids, user.id);
  }
  if (['review', 'approved', 'rejected'].includes(query.status)) { where.push('status = ?'); args.push(query.status); }
  const rows = db.prepare(`SELECT * FROM requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`).all(...args);
  return rows.map((r) => requestView(db, r, { withStudent: !own }));
}

export function getRequest({ db }, user, id) {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(id));
  // الطالب لا يرى إلا طلباته، والرد 404 كي لا يُكشف وجود طلبات الآخرين
  if (!r || !visibleTo(user, r)) throw new HttpError(404, 'الطلب غير موجود.', 'not_found');
  return requestView(db, r, { withStudent: scopeOf(user) !== 'own' });
}

export function decide({ db, cfg }, user, id, action, reason, ip) {
  return tx(db, () => {
    const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(id));
    if (!r) throw new HttpError(404, 'الطلب غير موجود.', 'not_found');
    if (!visibleTo(user, r)) throw new HttpError(404, 'الطلب غير موجود.', 'not_found');
    if (r.status !== 'review') throw new HttpError(409, 'تم البت في هذا الطلب مسبقاً.', 'conflict');
    if (r.student_id === user.id) throw new HttpError(403, 'لا يجوز البت في طلبك الخاص (فصل المهام).', 'forbidden');
    const now = Date.now();
    if (action === 'approve') {
      const svc = db.prepare('SELECT * FROM service_types WHERE code = ?').get(r.service_code);
      recordLeaveOnApprove(db, r, svc);
      let code = null;
      if (svc.issues_document) code = issueDocument({ db, cfg }, r, user, now).code;
      db.prepare("UPDATE requests SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ?").run(now, user.id, r.id);
      addEvent(db, r.id, user.label, code ? `اعتماد الطلب وإصدار وثيقة موقعة برمز ${code}` : 'اعتماد الطلب');
      audit(db, user, 'اعتماد طلب', r.no, ip);
    } else {
      if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 300) throw new HttpError(400, 'سبب الرفض مطلوب (3-300 حرفاً) ويظهر للطالب.', 'validation');
      db.prepare("UPDATE requests SET status = 'rejected', rejected_by = 'staff', reject_reason = ?, decided_at = ?, decided_by = ? WHERE id = ?").run(reason.trim(), now, user.id, r.id);
      addEvent(db, r.id, user.label, `رفض الطلب: ${reason.trim()}`);
      audit(db, user, 'رفض طلب', r.no, ip);
    }
    return requestView(db, db.prepare('SELECT * FROM requests WHERE id = ?').get(r.id), { withStudent: true });
  });
}

// إحالة طلب قيد المراجعة إلى وحدة مرتبطة بوحدة المستخدم (أو إلى أي وحدة لمن لا وحدة له، كالمدير)
export function forwardRequest({ db }, user, id, input, ip) {
  return tx(db, () => {
    const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(id));
    if (!r || !visibleTo(user, r)) throw new HttpError(404, 'الطلب غير موجود.', 'not_found');
    if (r.status !== 'review') throw new HttpError(409, 'لا تُحال إلا الطلبات قيد المراجعة.', 'conflict');
    const t = db.prepare('SELECT id, name, active FROM org_units WHERE id = ?').get(Number(input?.unitId));
    if (!t || !t.active) throw new HttpError(400, 'الوحدة المطلوبة غير موجودة أو معطَّلة.', 'validation');
    if (r.assigned_unit_id === t.id) throw new HttpError(409, 'الطلب عند هذه الوحدة أصلاً.', 'conflict');
    if (user.unit_id) {
      if (!linkedTargets(db, user.unit_id).some((x) => x.id === t.id)) throw new HttpError(403, 'وحدتك غير مرتبطة بهذه الوحدة؛ تُحال الطلبات إلى الوحدات المرتبطة فقط.', 'forbidden');
    } else if (user.role !== 'admin' || user.role_key) {
      throw new HttpError(403, 'حسابك غير مرتبط بوحدة إدارية، فلا يمكنه الإحالة.', 'forbidden');
    }
    const note = String(input?.note ?? '').replace(/\s+/g, ' ').trim();
    if (note.length > 300) throw new HttpError(400, 'الملاحظة لا تتجاوز 300 حرف.', 'validation');
    db.prepare('UPDATE requests SET assigned_unit_id = ? WHERE id = ?').run(t.id, r.id);
    addEvent(db, r.id, user.label, `إحالة الطلب إلى «${t.name}»${note ? `: ${note}` : ''}`);
    audit(db, user, `إحالة طلب إلى ${t.name}`, r.no, ip);
    return requestView(db, db.prepare('SELECT * FROM requests WHERE id = ?').get(r.id), { withStudent: true });
  });
}

export function stats({ db }) {
  const by = Object.fromEntries(db.prepare('SELECT status, COUNT(*) c FROM requests GROUP BY status').all().map((r) => [r.status, r.c]));
  const avg = db.prepare("SELECT AVG(decided_at - created_at) a FROM requests WHERE status = 'approved'").get().a;
  const late = db.prepare(`SELECT COUNT(*) c FROM requests r JOIN service_types s ON s.code = r.service_code
                           WHERE r.status = 'review' AND (? - r.created_at) > s.sla_hours * 3600000`).get(Date.now()).c;
  return { review: by.review ?? 0, approved: by.approved ?? 0, rejected: by.rejected ?? 0, avgApprovalMs: avg ? Math.round(avg) : null, slaBreaches: late };
}

export function readAttachment({ db, cfg }, user, id) {
  const a = db.prepare('SELECT a.*, r.student_id FROM attachments a JOIN requests r ON r.id = a.request_id WHERE a.id = ?').get(Number(id));
  if (!a || !visibleTo(user, db.prepare('SELECT * FROM requests WHERE id = ?').get(a.request_id))) throw new HttpError(404, 'غير موجود.', 'not_found');
  const file = path.join(cfg.uploadDir, a.stored_name);
  const buf = fs.readFileSync(file);
  if (sha256(buf) !== a.sha256) throw new HttpError(500, 'سلامة المرفق مخالفة للمسجَّل.', 'integrity');
  return { buf, mime: a.mime, name: a.orig_name };
}

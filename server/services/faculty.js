// وحدة 5.6 أعضاء هيئة التدريس: السجل الأساسي والعبء التدريسي والساعات المكتبية.
// الإسناد يمر عبر `courses.member_id`، وعند الإسناد يصبح اسم العضو نص «المدرّس» في المقرر.
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

import { getSetting } from './settings.js';
const ranksOf = (db) => getSetting(db, 'faculty.ranks');
export const STATUS = { active: 'على رأس العمل', leave: 'في إجازة', inactive: 'منتهي الخدمة' };
const bad = (m, f) => new HttpError(400, m, 'validation', f);
const CTRL = /[\u0000-\u001f\u007f<>]/;
const text = (v, label, { min = 1, max = 60 } = {}) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max) throw bad(`«${label}» يجب أن يكون بين ${min} و${max} حرفاً.`, label);
  if (CTRL.test(s)) throw bad(`«${label}» يحوي رموزاً غير مسموحة.`, label);
  return s;
};

function readInput(db, b, cur = null) {
  const name = text(b?.name ?? cur?.name, 'الاسم', { min: 2, max: 80 });
  let rank = String(b?.rank ?? cur?.rank ?? '').trim();
  const allowedRanks = ranksOf(db);
  if (!rank && !cur) {
    // إنشاء جديد بدون تحديد رتبة: استخدم أول رتبة متاحة لتجنب انهيار الواجهة
    if (allowedRanks.length) rank = allowedRanks[0];
    else throw bad('لا توجد درجات علمية معرّفة في الإعدادات؛ عرّف واحدة أولاً من الإعدادات العامة.', 'rank');
  }
  if (rank && !allowedRanks.includes(rank) && rank !== cur?.rank) throw bad('اختر الدرجة العلمية من القائمة.', 'rank');
  const unitId = b?.unitId === undefined ? cur?.unit_id ?? null : (b.unitId ? Number(b.unitId) : null);
  if (unitId !== null && !db.prepare('SELECT 1 FROM org_units WHERE id = ?').get(unitId)) throw bad('القسم / الإدارة غير موجود.', 'unitId');
  const emailRaw = b?.email === undefined ? cur?.email ?? null : (String(b.email).trim() || null);
  const email = emailRaw && emailRaw.trim() ? emailRaw.trim() : null;
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100)) throw bad('البريد الإلكتروني غير صالح.', 'email');
  const phoneRaw = b?.phone === undefined ? cur?.phone ?? null : (String(b.phone).trim() || null);
  const phone = phoneRaw && phoneRaw.trim() ? phoneRaw.trim() : null;
  if (phone && !/^[\d+()\s-]{5,20}$/.test(phone)) throw bad('رقم الهاتف غير صالح.', 'phone');
  const status = String(b?.status ?? cur?.status ?? 'active');
  if (!STATUS[status]) throw bad('حالة العضو غير صالحة.', 'status');
  const hireDate = b?.hireDate === undefined ? cur?.hire_date ?? null : (b.hireDate ? Math.trunc(Number(b.hireDate)) : null);
  if (hireDate !== null && (!Number.isFinite(hireDate) || hireDate < 946684800000 || hireDate > Date.now() + 86400000)) throw bad('تاريخ التعيين غير صالح.', 'hireDate');
  return {
    name, rank, unitId,
    specialty: b?.specialty === undefined ? cur?.specialty ?? null : (text(b.specialty, 'التخصص', { min: 0, max: 100 }) || null),
    email, phone,
    officeHours: b?.officeHours === undefined ? cur?.office_hours ?? null : (text(b.officeHours, 'الساعات المكتبية', { min: 0, max: 200 }) || null),
    officeLocation: b?.officeLocation === undefined ? cur?.office_location ?? null : (text(b.officeLocation, 'مكتب الاستقبال', { min: 0, max: 60 }) || null),
    status, hireDate,
    notes: b?.notes === undefined ? cur?.notes ?? null : (text(b.notes, 'ملاحظات', { min: 0, max: 300 }) || null),
  };
}

const SEL = `SELECT m.*, u.name unit_name, (SELECT COUNT(*) FROM courses c WHERE c.member_id = m.id) courses,
  (SELECT COALESCE(SUM(c.hours), 0) FROM courses c WHERE c.member_id = m.id AND c.active = 1) hours,
  (SELECT COUNT(*) FROM courses c WHERE c.member_id = m.id AND c.active = 1) active_courses
  FROM faculty_members m LEFT JOIN org_units u ON u.id = m.unit_id`;
const view = (r) => ({ id: r.id, name: r.name, rank: r.rank, unitId: r.unit_id, unit: r.unit_name ?? '', specialty: r.specialty ?? '',
  email: r.email ?? '', phone: r.phone ?? '', officeHours: r.office_hours ?? '', officeLocation: r.office_location ?? '',
  status: r.status, statusLabel: STATUS[r.status] ?? r.status, hireDate: r.hire_date, notes: r.notes ?? '', createdAt: r.created_at,
  courses: r.courses, hours: r.hours, activeCourses: r.active_courses });

export function options(db) {
  try {
    return { ranks: ranksOf(db), statuses: STATUS,
      units: db.prepare("SELECT id, name FROM org_units WHERE active = 1 AND kind != 'university' ORDER BY name").all() };
  } catch {
    return { ranks: ['أستاذ','أستاذ مشارك','أستاذ مساعد','محاضر','معيد'], statuses: STATUS, units: [] };
  }
}

const likeEsc = (s) => '%' + s.replace(/[\\%_]/g, '\\$&') + '%';
export function listFaculty({ db }, q = {}) {
  const w = [], a = [];
  const term = String(q.q ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (term) { const l = likeEsc(term); w.push(`(m.name LIKE ? ESCAPE '\\' OR m.specialty LIKE ? ESCAPE '\\' OR m.rank LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')`); a.push(l, l, l, l); }
  if (q.rank) { w.push('m.rank = ?'); a.push(q.rank); }
  if (STATUS[q.status]) { w.push('m.status = ?'); a.push(q.status); }
  if (Number(q.unit) > 0) { w.push('m.unit_id = ?'); a.push(Number(q.unit)); }
  const W = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const rows = db.prepare(`${SEL} ${W} ORDER BY m.name`).all(...a);
  const sum = db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(hours), 0) hours FROM (${SEL})`).get();
  const unassigned = db.prepare('SELECT COUNT(*) n FROM courses WHERE member_id IS NULL AND active = 1').get().n;
  const active = db.prepare("SELECT COUNT(*) n FROM faculty_members WHERE status = 'active'").get().n;
  return { members: rows.map(view), options: options(db), summary: { total: sum.total, active, hours: sum.hours, unassigned } };
}

const one = (db, id) => db.prepare(`${SEL} WHERE m.id = ?`).get(Number(id));

export function createFaculty({ db }, actor, b, ip) {
  const d = readInput(db, b);
  return tx(db, () => {
    const id = Number(db.prepare(`INSERT INTO faculty_members (name, rank, unit_id, specialty, email, phone, office_hours, office_location, status, hire_date, notes, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.name, d.rank, d.unitId, d.specialty, d.email, d.phone, d.officeHours, d.officeLocation, d.status, d.hireDate, d.notes, Date.now()).lastInsertRowid);
    audit(db, actor, 'إضافة عضو هيئة تدريس', d.name, ip);
    return { member: view(one(db, id)) };
  });
}

export function updateFaculty({ db }, actor, id, b, ip) {
  const cur = db.prepare('SELECT * FROM faculty_members WHERE id = ?').get(Number(id));
  if (!cur) throw new HttpError(404, 'العضو غير موجود.', 'not_found');
  const d = readInput(db, b, cur);
  return tx(db, () => {
    db.prepare('UPDATE faculty_members SET name = ?, rank = ?, unit_id = ?, specialty = ?, email = ?, phone = ?, office_hours = ?, office_location = ?, status = ?, hire_date = ?, notes = ? WHERE id = ?')
      .run(d.name, d.rank, d.unitId, d.specialty, d.email, d.phone, d.officeHours, d.officeLocation, d.status, d.hireDate, d.notes, cur.id);
    audit(db, actor, 'تعديل عضو هيئة تدريس', d.name, ip);
    return { member: view(one(db, cur.id)) };
  });
}

// تفعيل/تعطيل سريع (مثل بقية الجداول)؛ الإجازة تُضبط من نموذج التعديل
export function toggleFaculty({ db }, actor, id, enabled, ip) {
  const cur = db.prepare('SELECT * FROM faculty_members WHERE id = ?').get(Number(id));
  if (!cur) throw new HttpError(404, 'العضو غير موجود.', 'not_found');
  const status = enabled ? 'active' : 'inactive';
  db.prepare('UPDATE faculty_members SET status = ? WHERE id = ?').run(status, cur.id);
  audit(db, actor, enabled ? 'تفعيل عضو هيئة تدريس' : 'تعطيل عضو هيئة تدريس', cur.name, ip);
  return { member: view(one(db, cur.id)) };
}

export function deleteFaculty({ db }, actor, id, ip) {
  const cur = db.prepare('SELECT * FROM faculty_members WHERE id = ?').get(Number(id));
  if (!cur) throw new HttpError(404, 'العضو غير موجود.', 'not_found');
  const n = db.prepare('SELECT COUNT(*) n FROM courses WHERE member_id = ?').get(cur.id).n;
  if (n) throw new HttpError(409, `للعضو ${n} مقرر مسنَد؛ ألغِ الإسنادات من نافذة «إسناد مواد» قبل الحذف.`, 'conflict');
  db.prepare('DELETE FROM faculty_members WHERE id = ?').run(cur.id);
  audit(db, actor, 'حذف عضو هيئة تدريس', cur.name, ip);
}

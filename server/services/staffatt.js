// حضور وانصراف الموظفين + رصيد الإجازات (يُخصم عند اعتماد طلب hr_leave)
import { tx } from '../db.js';
import { getSetting } from './settings.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { writeXlsx } from '../lib/xlsx.js';

export const DEFAULT_ENTITLEMENT = 30;                 // القيمة الابتدائية؛ تُعدَّل من إعدادات الحضور والإجازات
export const WEEKENDS = { 'fri,sat': [5, 6], fri: [5], 'sat,sun': [6, 0] };
const WEEKEND_LABEL = { 'fri,sat': 'الجمعة والسبت', fri: 'الجمعة فقط', 'sat,sun': 'السبت والأحد' };
const TZ = 'Asia/Damascus', FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const bad = (m) => new HttpError(400, m, 'validation');
export const dayKey = (ms) => FMT.format(new Date(ms));
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(s));

// أيام العمل بين تاريخين شاملين، دون أيام العطلة الأسبوعية (الافتراضي الجمعة والسبت)
export function workingDays(from, to, weekend = 'fri,sat') {
  const off = WEEKENDS[weekend] ?? WEEKENDS['fri,sat'];
  let n = 0;
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) { if (!off.includes(new Date(t).getUTCDay())) n++; }
  return n;
}

export function getHrSettings(db) {
  return { leaveDefaultDays: getSetting(db, 'hr.leave_default_days'), weekend: getSetting(db, 'hr.weekend'), annualType: getSetting(db, 'hr.annual_leave_type'), weekendOptions: Object.entries(WEEKEND_LABEL).map(([value, label]) => ({ value, label })) };
}
export function saveHrSettings({ db }, actor, input, ip) {
  const cur = getHrSettings(db), set = db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  let days = cur.leaveDefaultDays, weekend = cur.weekend;
  if (input?.leaveDefaultDays !== undefined) { days = Number(input.leaveDefaultDays); if (!Number.isInteger(days) || days < 0 || days > 366) throw bad('الاستحقاق الافتراضي: عدد صحيح من 0 إلى 366 يوماً.'); }
  if (input?.weekend !== undefined) { weekend = String(input.weekend); if (!WEEKEND_LABEL[weekend]) throw bad('عطلة نهاية الأسبوع غير صالحة.'); }
  tx(db, () => { set.run('leave_default_days', String(days)); set.run('weekend_days', weekend); audit(db, actor, `تعديل إعدادات الحضور والإجازات: ${days} يوماً، العطلة ${WEEKEND_LABEL[weekend]}`, 'hr_settings', ip); });
  return { settings: getHrSettings(db) };
}

export function leaveSummary(db, userId, year) {
  const e = db.prepare('SELECT days FROM leave_entitlements WHERE user_id = ? AND year = ?').get(userId, year);
  const entitlement = e ? e.days : getHrSettings(db).leaveDefaultDays;
  const used = db.prepare("SELECT COALESCE(SUM(days),0) n FROM leave_records WHERE user_id = ? AND year = ? AND type = ?").get(userId, year, getSetting(db, 'hr.annual_leave_type')).n;
  return { year, entitlement, used, remaining: entitlement - used };
}

const todayRow = (db, userId) => { const r = db.prepare('SELECT * FROM staff_attendance WHERE user_id = ? AND day = ?').get(userId, dayKey(Date.now())); return r ? { day: r.day, in: r.check_in, out: r.check_out } : null; };

export function punch({ db }, user) {
  const now = Date.now(), day = dayKey(now), cur = db.prepare('SELECT * FROM staff_attendance WHERE user_id = ? AND day = ?').get(user.id, day);
  if (!cur) db.prepare('INSERT INTO staff_attendance (user_id, day, check_in) VALUES (?,?,?)').run(user.id, day, now);
  else db.prepare('UPDATE staff_attendance SET check_out = ? WHERE user_id = ? AND day = ?').run(now, user.id, day);
  return { today: todayRow(db, user.id), action: cur ? 'out' : 'in' };
}

export function myAttendance({ db }, user) {
  const year = Number(dayKey(Date.now()).slice(0, 4)), month = dayKey(Date.now()).slice(0, 7);
  const history = db.prepare('SELECT day, check_in "in", check_out "out" FROM staff_attendance WHERE user_id = ? ORDER BY day DESC LIMIT 30').all(user.id);
  const m = history.filter((h) => h.day.startsWith(month));
  const hours = m.reduce((s, h) => s + (h.out ? (h.out - h.in) / 3600000 : 0), 0);
  return { today: todayRow(db, user.id), history, month: { days: m.length, hours: Math.round(hours * 10) / 10 }, leave: leaveSummary(db, user.id, year),
    leaves: db.prepare('SELECT id, type, from_day "from", to_day "to", days FROM leave_records WHERE user_id = ? AND year = ? ORDER BY from_day DESC').all(user.id, year) };
}

export function dayReport({ db }, q) {
  const date = q.date ?? dayKey(Date.now());
  if (!isDay(date)) throw bad('تاريخ غير صالح.');
  const rows = db.prepare(`SELECT u.id, u.username, u.display_name name, o.name unit, a.check_in "in", a.check_out "out",
      (SELECT type FROM leave_records l WHERE l.user_id = u.id AND l.from_day <= ? AND l.to_day >= ? LIMIT 1) leave
    FROM users u LEFT JOIN org_units o ON o.id = u.unit_id LEFT JOIN staff_attendance a ON a.user_id = u.id AND a.day = ?
    WHERE u.role != 'student' AND u.active = 1 ORDER BY o.name, u.display_name`).all(date, date, date);
  return { date, rows: rows.map((r) => ({ ...r, hours: r.in && r.out ? Math.round((r.out - r.in) / 36000) / 100 : null })) };
}

const hhmm = (ms) => (ms ? new Date(ms + 3 * 3600000).toISOString().slice(11, 16) : '');
export function exportMonth({ db }, user, q, ip) {
  const month = q.month ?? dayKey(Date.now()).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('الشهر بصيغة YYYY-MM.');
  const rows = db.prepare(`SELECT u.id uid, u.display_name name, COALESCE(o.name,'') unit, a.day, a.check_in, a.check_out FROM staff_attendance a JOIN users u ON u.id = a.user_id LEFT JOIN org_units o ON o.id = u.unit_id WHERE a.day LIKE ? ORDER BY u.display_name, a.day`).all(month + '-%');
  const by = new Map();
  for (const r of rows) { const e = by.get(r.uid) ?? { name: r.name, unit: r.unit, days: 0, hours: 0 }; e.days++; if (r.check_out) e.hours += (r.check_out - r.check_in) / 3600000; by.set(r.uid, e); }
  audit(db, user, `تصدير حضور الموظفين ${month}`, month, ip);
  return writeXlsx([
    { name: 'ملخص', rows: [['الموظف', 'الوحدة', 'أيام الحضور', 'ساعات العمل'], ...[...by.values()].map((e) => [e.name, e.unit, e.days, Math.round(e.hours * 10) / 10])], widths: [30, 30, 14, 14], rtl: true },
    { name: 'التفصيل', rows: [['التاريخ', 'الموظف', 'الدخول', 'الخروج', 'الساعات'], ...rows.map((r) => [r.day, r.name, hhmm(r.check_in), hhmm(r.check_out), r.check_out ? Math.round((r.check_out - r.check_in) / 36000) / 100 : ''])], widths: [14, 30, 10, 10, 10], textCols: [0, 2, 3], rtl: true },
  ], { title: `حضور الموظفين ${month}` });
}

export function listBalances({ db }, q) {
  const year = Number(q.year) || Number(dayKey(Date.now()).slice(0, 4));
  const rows = db.prepare("SELECT u.id, u.username, u.display_name name, o.name unit FROM users u LEFT JOIN org_units o ON o.id = u.unit_id WHERE u.role != 'student' AND u.active = 1 ORDER BY o.name, u.display_name").all();
  return { year, rows: rows.map((r) => ({ ...r, ...leaveSummary(db, r.id, year) })) };
}

export function setEntitlement({ db }, actor, input, ip) {
  const userId = Number(input?.userId), year = Number(input?.year), days = Number(input?.days);
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role != 'student'").get(userId)) throw new HttpError(404, 'الموظف غير موجود.', 'not_found');
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw bad('سنة غير صالحة.');
  if (!Number.isFinite(days) || days < 0 || days > 366) throw bad('الاستحقاق من 0 إلى 366 يوماً.');
  db.prepare('INSERT INTO leave_entitlements (user_id, year, days) VALUES (?,?,?) ON CONFLICT(user_id, year) DO UPDATE SET days = excluded.days').run(userId, year, days);
  audit(db, actor, `تعديل استحقاق إجازة ${year}: ${days}`, String(userId), ip);
  return { ok: true };
}

// يُستدعى من اعتماد الطلب (داخل المعاملة): يسجّل الإجازة ويخصم من الرصيد، وإلا يمنع الاعتماد
export function recordLeaveOnApprove(db, request, service) {
  if (service.code !== 'hr_leave') return;
  const labels = new Map(JSON.parse(service.fields_json).map((f) => [f.label, f.name]));
  const d = JSON.parse(request.details_json), get = (l) => d[labels.get(l)];
  const from = get('من تاريخ'), to = get('إلى تاريخ'), type = get('نوع الإجازة');
  if (!isDay(from) || !isDay(to) || to < from) throw new HttpError(409, 'تواريخ الإجازة غير صالحة.', 'conflict');
  const days = workingDays(from, to, getHrSettings(db).weekend), year = Number(from.slice(0, 4));
  if (days < 1) throw new HttpError(409, 'الفترة المطلوبة لا تحوي أياماً للعمل (عطلة نهاية الأسبوع).', 'conflict');
  if (type === getSetting(db, 'hr.annual_leave_type')) {
    const s = leaveSummary(db, request.student_id, year);
    if (days > s.remaining) throw new HttpError(409, `الرصيد غير كافٍ: المطلوب ${days} يوماً والمتبقي ${s.remaining}.`, 'conflict');
  }
  db.prepare('INSERT INTO leave_records (user_id, year, type, from_day, to_day, days, request_id, created_at) VALUES (?,?,?,?,?,?,?,?)').run(request.student_id, year, type, from, to, days, request.id, Date.now());
}

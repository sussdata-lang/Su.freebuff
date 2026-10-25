// الموارد البشرية والرواتب (وحدة 5.7)
// tables: hr_employees, hr_salaries, hr_leaves, hr_contracts
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { getSetting } from './settings.js';

const STATUS = { active: 'نشط', on_leave: 'في إجازة', terminated: 'منتهي' };
const likeEsc = (s) => '%' + String(s).replace(/[\\%_]/g, '\\$&') + '%';
const LEAVE_TYPES = { annual: 'إجازة سنوية', sick: 'إجازة مرضية', unpaid: 'إجازة بدون راتب', maternity: 'إجازة أمومة', paternity: 'إجازة أبوة' };
const LEAVE_STATUS = { pending: 'مقدم', approved: 'معتمد', rejected: 'مرفوض', cancelled: 'ملغّى' };
const CONTRACT_TYPES = { fixed: 'محدد المدة', indefinite: 'غير محدد المدة', temporary: 'مؤقت', freelance: 'مستقل' };

export function listEmployees(db, q = {}) {
  const { search, unitId, status, department, page = 1, size = 50, sort = 'name', order = 'ASC' } = q;
  const allowedSort = ['name', 'employeeNo', 'hireDate', 'status', 'unit_id', 'salary_net'];
  const col = allowedSort.includes(sort) ? sort : 'name';
  const dir = order?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const w = [], a = [];
  if (search) { const l = likeEsc(search); w.push(`(e.name LIKE ? ESCAPE '\\' OR e.employeeNo LIKE ? ESCAPE '\\' OR e.personalId LIKE ? ESCAPE '\\')`); a.push(l, l, l); }
  if (unitId) { w.push('e.unit_id = ?'); a.push(Number(unitId)); }
  if (status) { w.push('e.status = ?'); a.push(status); }
  if (department) { w.push(`u.name LIKE ? ESCAPE '\\'`); a.push(likeEsc(department)); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM hr_employees e LEFT JOIN org_units u ON e.unit_id = u.id ${where}`).get(...a).c;
  const rows = db.prepare(`SELECT e.*, u.name AS unitName, u.code AS unitCode FROM hr_employees e LEFT JOIN org_units u ON e.unit_id = u.id ${where} ORDER BY e.${col} ${dir} LIMIT ? OFFSET ?`).all(...a, Number(size), (Number(page) - 1) * Number(size)).map(m => ({
    id: m.id,
    employeeNo: m.employeeNo,
    name: m.name,
    personalId: m.personalId,
    email: m.email,
    phone: m.phone,
    hireDate: m.hireDate,
    status: m.status,
    unitId: m.unit_id,
    unitName: m.unitName,
    unitCode: m.unitCode,
    position: m.position,
    salary: m.salary_base,
    joinDate: m.joinDate,
  }));
  return { employees: rows, page: Number(page), size: Number(size), total, hasMore: rows.length === Number(size) && total > rows.length };
}

export function getEmployee(db, id, q = {}) {
  const e = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(Number(id));
  if (!e) throw new HttpError(404, 'الموظف غير موجود.', 'not_found');
  const salary = db.prepare('SELECT * FROM hr_salaries WHERE employee_id = ? ORDER BY effective_at DESC LIMIT 1').get(Number(id));
  const leaves = db.prepare('SELECT * FROM hr_leaves WHERE employee_id = ? ORDER BY start_date DESC LIMIT 20').all(Number(id));
  const contracts = db.prepare('SELECT * FROM hr_contracts WHERE employee_id = ? ORDER BY start_date DESC').all(Number(id));
  const base = { id: e.id, employeeNo: e.employeeNo, name: e.name, personalId: e.personalId, email: e.email, phone: e.phone, hireDate: e.hireDate, status: e.status, unitId: e.unit_id, position: e.position, salary: e.salary_base, joinDate: e.joinDate, unit: db.prepare('SELECT id, name, code FROM org_units WHERE id = ?').get(e.unit_id) };
  return { employee: { ...base, salary: salary ? { ...salary, effectiveAt: salary.effective_at } : null, leaves: leaves.map(l => ({ id: l.id, type: l.leave_type, status: l.status, startDate: l.start_date, endDate: l.end_date, days: l.days, notes: l.notes, createdBy: l.created_by, createdAt: l.created_at, reviewedBy: l.reviewed_by, reviewedAt: l.reviewed_at, reason: l.reason })), contracts: contracts.map(c => ({ id: c.id, type: c.contract_type, title: c.title, start: c.start_date, end: c.end_date, salary: c.salary, notes: c.notes, createdBy: c.created_by, createdAt: c.created_at, document: c.document_path ? { name: c.document_name, path: c.document_path } : null }))}};
}

export function createEmployee(db, actor, body, ip) {
  const required = ['name', 'employeeNo', 'personalId', 'email', 'phone', 'hireDate', 'unit_id', 'position'];
  for (const f of required) if (!body[f]) throw new HttpError(400, `حقل ${f} مطلوب`, 'validation', f);
  const unitId = Number(body.unit_id);
  if (!Number.isInteger(unitId)) throw new HttpError(400, 'الوحدة التنظيمية غير صالحة', 'validation', 'unit_id');
  const existing = db.prepare('SELECT id FROM hr_employees WHERE employeeNo = ? OR personalId = ?').get(body.employeeNo, body.personalId);
  if (existing) throw new HttpError(400, 'رقم الموظف أو الرقم الشخصي مسجّل مسبقاً', 'validation');
  const now = Date.now();
  const e = { employeeNo: body.employeeNo, name: body.name, personalId: body.personalId, email: body.email, phone: body.phone, hireDate: body.hireDate, status: body.status || 'active', unit_id: unitId, position: body.position, salary_base: Number(body.salary) || 0, joinDate: body.joinDate || body.hireDate, created_at: now, updated_at: now };
  const id = db.prepare('INSERT INTO hr_employees (employeeNo, name, personalId, email, phone, hireDate, status, unit_id, position, salary_base, joinDate, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(e.employeeNo, e.name, e.personalId, e.email, e.phone, e.hireDate, e.status, e.unit_id, e.position, e.salary_base, e.joinDate, e.created_at, e.updated_at).lastInsertRowid;
  audit(db, actor, 'إضافة موظف', e.employeeNo, ip);
  if (body.salary && body.salary > 0) createSalaryRecord(db, actor, Number(id), body.salary, now, ip);
  return getEmployee(db, Number(id)).employee;
}

export function updateEmployee(db, actor, id, body, ip) {
  const e = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(Number(id));
  if (!e) throw new HttpError(404, 'الموظف غير موجود.', 'not_found');
  const vals = {};
  for (const f of ['name', 'personalId', 'email', 'phone', 'position', 'status', 'hireDate', 'joinDate']) if (body[f] !== undefined) vals[f] = body[f];
  if (body.unit_id !== undefined) vals.unit_id = Number(body.unit_id);
  if (body.salary !== undefined) vals.salary_base = Number(body.salary) || 0;
  const set = Object.keys(vals).map(k => `${k} = ?`).join(', ');
  const sql = `UPDATE hr_employees SET ${set}, updated_at = ? WHERE id = ?`;
  db.prepare(sql).run(...Object.values(vals), Date.now(), Number(id));
  if (body.salary !== undefined && Number(body.salary) > 0) createSalaryRecord(db, actor, Number(id), Number(body.salary), Date.now(), ip);
  audit(db, actor, 'تعديل بيانات موظف', e.employeeNo, ip);
  return getEmployee(db, Number(id)).employee;
}

export function toggleEmployeeStatus(db, actor, id, enabled, ip) {
  const e = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(Number(id));
  if (!e) throw new HttpError(404, 'الموظف غير موجود.', 'not_found');
  e.status = enabled ? 'active' : 'on_leave';
  db.prepare('UPDATE hr_employees SET status = ?, updated_at = ? WHERE id = ?').run(e.status, Date.now(), Number(id));
  audit(db, actor, enabled ? 'تفعيل الموظف' : 'إجازة الموظف', e.employeeNo, ip);
  return getEmployee(db, Number(id)).employee;
}

export function deleteEmployee(db, actor, id, ip) {
  const e = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(Number(id));
  if (!e) throw new HttpError(404, 'الموظف غير موجود.', 'not_found');
  const dependent = db.prepare('SELECT COUNT(*) c FROM hr_salaries WHERE employee_id = ?').get(Number(id)).c;
  if (dependent) throw new HttpError(400, 'لا يمكن حذف موظف له سجلات راتب', 'validation');
  db.prepare('DELETE FROM hr_leaves WHERE employee_id = ?').run(Number(id));
  db.prepare('DELETE FROM hr_contracts WHERE employee_id = ?').run(Number(id));
  db.prepare('DELETE FROM hr_employees WHERE id = ?').run(Number(id));
  audit(db, actor, 'حذف موظف', e.employeeNo, ip);
  return { ok: true };
}

export function createSalaryRecord(db, actor, employeeId, amount, effectiveAt, ip) {
  const e = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(employeeId);
  if (!e) throw new HttpError(404, 'الموظف غير موجود.', 'not_found');
  const now = effectiveAt || Date.now();
  db.prepare('INSERT INTO hr_salaries (employee_id, amount, effective_at, created_by, created_at, ip) VALUES (?,?,?,?,?,?)').run(employeeId, amount, now, actor?.id || null, now, ip || null);
  audit(db, actor, 'تسجيل راتب', e.employeeNo, ip);
}

export function listSalaries(db, q = {}) {
  const { employeeId, month, year, minAmount, maxAmount, page = 1, size = 50, sort = 'effective_at', order = 'DESC' } = q;
  const allowedSort = ['effective_at', 'amount', 'employee_id'];
  const col = allowedSort.includes(sort) ? sort : 'effective_at';
  const dir = order?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const w = [], a = [];
  if (employeeId) { w.push('s.employee_id = ?'); a.push(Number(employeeId)); }
  if (month) { w.push(`strftime('%m', s.effective_at/1000, 'unixepoch') = ?`); a.push(String(month).padStart(2, '0')); }
  if (year) { w.push(`strftime('%Y', s.effective_at/1000, 'unixepoch') = ?`); a.push(String(year)); }
  if (minAmount) { w.push('s.amount >= ?'); a.push(Number(minAmount)); }
  if (maxAmount) { w.push('s.amount <= ?'); a.push(Number(maxAmount)); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM hr_salaries s JOIN hr_employees e ON s.employee_id = e.id ${where}`).get(...a).c;
  const rows = db.prepare(`SELECT s.*, e.name AS employeeName, e.employeeNo, e.unit_id, u.name AS unitName FROM hr_salaries s JOIN hr_employees e ON s.employee_id = e.id LEFT JOIN org_units u ON e.unit_id = u.id ${where} ORDER BY s.${col} ${dir} LIMIT ? OFFSET ?`).all(...a, Number(size), (Number(page) - 1) * Number(size)).map(r => ({
    id: r.id, employeeId: r.employee_id, employeeName: r.employeeName, employeeNo: r.employeeNo, unitName: r.unitName, unitId: r.unit_id, amount: r.amount, effectiveAt: r.effective_at, createdBy: r.created_by, createdAt: r.created_at, ip: r.ip,
  }));
  return { salaries: rows, page: Number(page), size: Number(size), total, hasMore: rows.length === Number(size) && total > rows.length };
}

export function latestSalary(db, employeeId) {
  const e = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(employeeId);
  if (!e) throw new HttpError(404, 'الموظف غير موجود.', 'not_found');
  const s = db.prepare('SELECT * FROM hr_salaries WHERE employee_id = ? ORDER BY effective_at DESC LIMIT 1').get(employeeId);
  return s ? { id: s.id, employeeId, employeeNo: e.employeeNo, amount: s.amount, effectiveAt: s.effective_at, createdBy: s.created_by, createdAt: s.created_at, ip: s.ip } : null;
}

export function createLeaveRequest(db, actor, body, ip) {
  const required = ['employee_id', 'leave_type', 'start_date', 'end_date', 'days', 'reason'];
  for (const f of required) if (!body[f]) throw new HttpError(400, `حقل ${f} مطلوب`, 'validation', f);
  if (!LEAVE_TYPES[body.leave_type]) throw new HttpError(400, 'نوع الإجازة غير صالح', 'validation', 'leave_type');
  const emp = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(Number(body.employee_id));
  if (!emp) throw new HttpError(404, 'الموظف غير موجود.', 'not_found');
  if (emp.status !== 'active') throw new HttpError(400, 'الموظف غير فعّال', 'validation');
  const now = Date.now();
  const existing = db.prepare('SELECT COUNT(*) c FROM hr_leaves WHERE employee_id = ? AND status IN (?,?) AND start_date <= ? AND end_date >= ?').get(Number(body.employee_id), 'approved', 'pending', body.end_date, body.start_date);
  if (existing.c) throw new HttpError(400, 'يوجد إجازة معتمدة أو قيد الموافقة في هذه الفترة', 'validation');
  const l = { employee_id: Number(body.employee_id), leave_type: body.leave_type, status: 'pending', start_date: body.start_date, end_date: body.end_date, days: Number(body.days), reason: body.reason, notes: body.notes || '', created_by: actor?.id || null, created_at: now, ip };
  const id = db.prepare('INSERT INTO hr_leaves (employee_id, leave_type, status, start_date, end_date, days, reason, notes, created_by, created_at, ip) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(l.employee_id, l.leave_type, l.status, l.start_date, l.end_date, l.days, l.reason, l.notes, l.created_by, l.created_at, l.ip).lastInsertRowid;
  audit(db, actor, 'طلب إجازة', emp.employeeNo, ip);
  return getLeave(db, Number(id)).leave;
}

export function approveLeaveRequest(db, actor, id, ip) {
  const l = db.prepare('SELECT * FROM hr_leaves WHERE id = ?').get(Number(id));
  if (!l) throw new HttpError(404, 'طلب الإجازة غير موجود.', 'not_found');
  if (l.status !== 'pending') throw new HttpError(400, 'الحالة غير قابلة للاعتماد', 'validation');
  db.prepare('UPDATE hr_leaves SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').run('approved', actor?.id || null, Date.now(), Number(id));
  audit(db, actor, 'اعتماد إجازة', l.employee_id, ip);
  return getLeave(db, Number(id)).leave;
}

export function rejectLeaveRequest(db, actor, id, reason, ip) {
  const l = db.prepare('SELECT * FROM hr_leaves WHERE id = ?').get(Number(id));
  if (!l) throw new HttpError(404, 'طلب الإجازة غير موجود.', 'not_found');
  if (l.status !== 'pending') throw new HttpError(400, 'الحالة غير قابلة للرفض', 'validation');
  db.prepare('UPDATE hr_leaves SET status = ?, reviewed_by = ?, reviewed_at = ?, reason = ? WHERE id = ?').run('rejected', actor?.id || null, Date.now(), reason || '', Number(id));
  audit(db, actor, 'رفض إجازة', l.employee_id, ip);
  return getLeave(db, Number(id)).leave;
}

export function cancelLeaveRequest(db, actor, id, ip) {
  const l = db.prepare('SELECT * FROM hr_leaves WHERE id = ?').get(Number(id));
  if (!l) throw new HttpError(404, 'طلب الإجازة غير موجود.', 'not_found');
  if (l.status !== 'pending') throw new HttpError(400, 'الحالة غير قابلة للإلغاء', 'validation');
  db.prepare('UPDATE hr_leaves SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').run('cancelled', actor?.id || null, Date.now(), Number(id));
  audit(db, actor, 'إلغاء إجازة', l.employee_id, ip);
  return getLeave(db, Number(id)).leave;
}

export function getLeave(db, id) {
  const l = db.prepare('SELECT * FROM hr_leaves WHERE id = ?').get(Number(id));
  if (!l) throw new HttpError(404, 'طلب الإجازة غير موجود.', 'not_found');
  const emp = db.prepare('SELECT id, employeeNo, name, status FROM hr_employees WHERE id = ?').get(l.employee_id);
  return { leave: { id: l.id, employeeId: l.employee_id, employeeNo: emp.employeeNo, employeeName: emp.name, status: l.status, leaveType: l.leave_type, statusLabel: LEAVE_STATUS[l.status], startDate: l.start_date, endDate: l.end_date, days: l.days, reason: l.reason, notes: l.notes, createdBy: l.created_by, createdAt: l.created_at, reviewedBy: l.reviewed_by, reviewedAt: l.reviewed_at, ip: l.ip } };
}

export function listLeaves(db, q = {}) {
  const { employeeId, status, type, from, to, page = 1, size = 50, sort = 'start_date', order = 'DESC' } = q;
  const allowedSort = ['start_date', 'end_date', 'created_at', 'days'];
  const col = allowedSort.includes(sort) ? sort : 'start_date';
  const dir = order?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const w = [], a = [];
  if (employeeId) { w.push('l.employee_id = ?'); a.push(Number(employeeId)); }
  if (status) { w.push('l.status = ?'); a.push(status); }
  if (type) { w.push('l.leave_type = ?'); a.push(type); }
  if (from) { w.push('l.start_date >= ?'); a.push(from); }
  if (to) { w.push('l.start_date <= ?'); a.push(to); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM hr_leaves l ${where}`).get(...a).c;
  const rows = db.prepare(`SELECT l.*, e.name AS employeeName, e.employeeNo FROM hr_leaves l JOIN hr_employees e ON l.employee_id = e.id ${where} ORDER BY l.${col} ${dir} LIMIT ? OFFSET ?`).all(...a, Number(size), (Number(page) - 1) * Number(size)).map(r => ({
    id: r.id, employeeId: r.employee_id, employeeName: r.employeeName, employeeNo: r.employeeNo, leaveType: r.leave_type, status: r.status, statusLabel: LEAVE_STATUS[r.status], startDate: r.start_date, endDate: r.end_date, days: r.days, reason: r.reason, notes: r.notes, createdBy: r.created_by, createdAt: r.created_at, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, ip: r.ip,
  }));
  return { leaves: rows, page: Number(page), size: Number(size), total, hasMore: rows.length === Number(size) && total > rows.length };
}

export function createContract(db, actor, body, ip) {
  const required = ['employee_id', 'contract_type', 'start_date', 'end_date', 'salary'];
  for (const f of required) if (!body[f]) throw new HttpError(400, `حقل ${f} مطلوب`, 'validation', f);
  if (!CONTRACT_TYPES[body.contract_type]) throw new HttpError(400, 'نوع العقد غير صالح', 'validation', 'contract_type');
  const emp = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(Number(body.employee_id));
  if (!emp) throw new HttpError(404, 'الموظف غير موجود.', 'not_found');
  const now = Date.now();
  const c = { employee_id: Number(body.employee_id), contract_type: body.contract_type, title: body.title || '', start_date: body.start_date, end_date: body.end_date, salary: Number(body.salary) || 0, notes: body.notes || '', created_by: actor?.id || null, created_at: now, ip };
  const id = db.prepare('INSERT INTO hr_contracts (employee_id, contract_type, title, start_date, end_date, salary, notes, created_by, created_at, ip) VALUES (?,?,?,?,?,?,?,?,?,?)').run(c.employee_id, c.contract_type, c.title, c.start_date, c.end_date, c.salary, c.notes, c.created_by, c.created_at, c.ip).lastInsertRowid;
  audit(db, actor, 'إضافة عقد عمل', emp.employeeNo, ip);
  return { id, ...c };
}

export function listContracts(db, q = {}) {
  const { employeeId, type, from, to, page = 1, size = 50, sort = 'start_date', order = 'DESC' } = q;
  const allowedSort = ['start_date', 'end_date', 'salary', 'created_at'];
  const col = allowedSort.includes(sort) ? sort : 'start_date';
  const dir = order?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const w = [], a = [];
  if (employeeId) { w.push('c.employee_id = ?'); a.push(Number(employeeId)); }
  if (type) { w.push('c.contract_type = ?'); a.push(type); }
  if (from) { w.push('c.start_date >= ?'); a.push(from); }
  if (to) { w.push('c.start_date <= ?'); a.push(to); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM hr_contracts c ${where}`).get(...a).c;
  const rows = db.prepare(`SELECT c.*, e.name AS employeeName, e.employeeNo FROM hr_contracts c JOIN hr_employees e ON c.employee_id = e.id ${where} ORDER BY c.${col} ${dir} LIMIT ? OFFSET ?`).all(...a, Number(size), (Number(page) - 1) * Number(size)).map(r => ({
    id: r.id, employeeId: r.employee_id, employeeName: r.employeeName, employeeNo: r.employeeNo, contractType: r.contract_type, title: r.title, start: r.start_date, end: r.end_date, salary: r.salary, notes: r.notes, createdBy: r.created_by, createdAt: r.created_at, ip: r.ip,
  }));
  return { contracts: rows, page: Number(page), size: Number(size), total, hasMore: rows.length === Number(size) && total > rows.length };
}

export function listOptions(db) {
  return {
    units: db.prepare("SELECT id, name FROM org_units WHERE active = 1 AND kind != 'university' ORDER BY name").all(),
    currency: getSetting(db, 'hr.currency'),
    statuses: Object.entries(STATUS).map(([k, v]) => ({ key: k, label: v })),
    leaveTypes: Object.entries(LEAVE_TYPES).map(([k, v]) => ({ key: k, label: v })),
    leaveStatuses: Object.entries(LEAVE_STATUS).map(([k, v]) => ({ key: k, label: v })),
    contractTypes: Object.entries(CONTRACT_TYPES).map(([k, v]) => ({ key: k, label: v })),
  };
}

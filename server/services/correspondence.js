// المراسلات الداخلية: مستند يُنشئه موظف ويُرسَل إلى معتمدين (تسلسلياً أو بالتوازي) مع تعليقات ومرفقات وإشعارات.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { sha256 } from '../security.js';
import { HttpError } from '../http.js';
import { detectMime } from './requests.js';
import { notify } from './push.js';

const bad = (m, s = 400) => new HttpError(s, m, 'validation');
const MAX_APPROVERS = 12, MAX_FILES = 5, MAX_TOTAL = 8 * 1024 * 1024;
const pad = (n, w) => String(n).padStart(w, '0');
const clean = (s, max) => String(s ?? '').replace(/\r/g, '').trim().slice(0, max);

const staffUser = (db, id) => db.prepare("SELECT u.id, u.display_name name, u.role, u.unit_id, o.name unit FROM users u LEFT JOIN org_units o ON o.id = u.unit_id WHERE u.id = ? AND u.role != 'student' AND u.active = 1").get(Number(id));
const ev = (db, docId, kind, actor, text) => db.prepare('INSERT INTO corr_events (doc_id, at, kind, actor_id, actor_label, text) VALUES (?,?,?,?,?,?)').run(docId, Date.now(), kind, actor?.id ?? null, actor?.label ?? 'النظام', text);
const note = (deps, userIds, doc, text) => {
  const ids = [...new Set(userIds)];
  for (const u of ids) deps.db.prepare('INSERT INTO corr_notifs (user_id, doc_id, text, at) VALUES (?,?,?,?)').run(u, doc.id, text, Date.now());
  notify(deps, ids, { title: 'مراسلات', body: `${doc.no} — ${text}`, url: '/', tag: `corr-${doc.id}` });
};

// هل هذا المستند مرئي لهذا المستخدم؟ المسودة للمنشئ وحده
export function canSee(user, db, d) {
  if (d.creator_id === user.id) return true;
  if (d.status === 'draft') return false;
  if (user.can('corr:read_all')) return true;
  return !!db.prepare('SELECT 1 FROM corr_approvers WHERE doc_id = ? AND user_id = ?').get(d.id, user.id) || !!db.prepare('SELECT 1 FROM corr_cc WHERE doc_id = ? AND user_id = ?').get(d.id, user.id);
}
const ccIds = (db, id) => db.prepare('SELECT user_id FROM corr_cc WHERE doc_id = ?').all(id).map((r) => r.user_id);

// دور المعتمد الحالي: متوازٍ ← كل من لم يبتّ؛ تسلسلي ← أول من لم يبتّ فقط
export function pendingApprovers(db, d) {
  if (d.status !== 'pending') return [];
  const rows = db.prepare("SELECT * FROM corr_approvers WHERE doc_id = ? AND state = 'pending' ORDER BY seq").all(d.id);
  return d.mode === 'parallel' ? rows : rows.slice(0, 1);
}

export function docView(db, d, user) {
  const approvers = db.prepare(`SELECT a.user_id id, a.seq, a.state, a.at, a.note, u.display_name name, o.name unit FROM corr_approvers a JOIN users u ON u.id = a.user_id LEFT JOIN org_units o ON o.id = u.unit_id WHERE a.doc_id = ? ORDER BY a.seq`).all(d.id);
  const turn = new Set(pendingApprovers(db, d).map((a) => a.user_id));
  const c = db.prepare('SELECT u.display_name name, o.name unit FROM users u LEFT JOIN org_units o ON o.id = u.unit_id WHERE u.id = ?').get(d.creator_id);
  return {
    id: d.id, no: d.no, title: d.title, subject: d.subject, body: d.body, mode: d.mode, status: d.status, outNo: d.out_no ? `${d.out_year}/${d.out_no}` : null,
    createdAt: d.created_at, sentAt: d.sent_at, decidedAt: d.decided_at, creator: { id: d.creator_id, name: c?.name, unit: c?.unit ?? null },
    approvers: approvers.map((a) => ({ ...a, turn: turn.has(a.id) })),
    cc: db.prepare('SELECT c.user_id id, u.display_name name, o.name unit FROM corr_cc c JOIN users u ON u.id = c.user_id LEFT JOIN org_units o ON o.id = u.unit_id WHERE c.doc_id = ? ORDER BY u.display_name').all(d.id),
    files: db.prepare('SELECT id, orig_name name, size, mime FROM corr_files WHERE doc_id = ? ORDER BY id').all(d.id),
    events: db.prepare('SELECT at, kind, actor_label actor, text FROM corr_events WHERE doc_id = ? ORDER BY id').all(d.id),
    mine: { creator: d.creator_id === user.id, approver: approvers.some((a) => a.id === user.id), cc: ccIds(db, d.id).includes(user.id), myTurn: turn.has(user.id) },
  };
}

function readFiles(cfg, raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_FILES) throw bad(`المرفقات: حتى ${MAX_FILES}.`);
  let total = 0;
  return raw.map((a) => {
    if (!a || typeof a.data !== 'string' || typeof a.name !== 'string') throw bad('مرفق غير صالح.');
    const buf = Buffer.from(a.data, 'base64');
    if (!buf.length || buf.length > cfg.maxAttachmentBytes) throw new HttpError(413, 'حجم المرفق الواحد يجب ألا يتجاوز 2 ميغابايت.', 'too_large');
    total += buf.length; if (total > MAX_TOTAL) throw new HttpError(413, 'مجموع المرفقات يجب ألا يتجاوز 8 ميغابايت.', 'too_large');
    const mime = detectMime(buf); if (!mime) throw new HttpError(415, 'المرفقات المسموحة: PDF أو PNG أو JPG.', 'bad_type');
    return { buf, mime, name: path.basename(a.name).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 100) || 'file' };
  });
}

function parse(db, user, input) {
  const title = clean(input?.title, 120), subject = clean(input?.subject, 200), body = clean(input?.body, 8000);
  if (title.length < 2) throw bad('عنوان المستند مطلوب (حرفان على الأقل).');
  const mode = input?.mode === 'sequential' ? 'sequential' : 'parallel';
  const list = Array.isArray(input?.approvers) ? input.approvers.map(Number) : [];
  if (!list.length) throw bad('اختر معتمداً واحداً على الأقل.');
  if (list.length > MAX_APPROVERS) throw bad(`المعتمدون: حتى ${MAX_APPROVERS}.`);
  if (new Set(list).size !== list.length) throw bad('لا يجوز تكرار المعتمد.');
  for (const id of list) { if (id === user.id) throw bad('لا يجوز اختيار نفسك معتمداً.'); if (!staffUser(db, id)) throw bad('معتمد غير صالح أو غير فعّال.'); }
  const cc = Array.isArray(input?.cc) ? input.cc.map(Number) : [];
  if (cc.length > MAX_APPROVERS) throw bad(`نسخة إلى: حتى ${MAX_APPROVERS}.`);
  if (new Set(cc).size !== cc.length) throw bad('لا يجوز تكرار المستلم في النسخة.');
  for (const id of cc) { if (id === user.id) throw bad('لا حاجة لإرسال نسخة إلى نفسك.'); if (list.includes(id)) throw bad('الشخص معتمد بالفعل ولا يضاف في النسخة.'); if (!staffUser(db, id)) throw bad('مستلم نسخة غير صالح أو غير فعّال.'); }
  return { title, subject, body, mode, approvers: list, cc };
}

export function listPeople({ db }, user) {
  return db.prepare(`SELECT u.id, u.display_name name, COALESCE(o.name, '') unit FROM users u LEFT JOIN org_units o ON o.id = u.unit_id WHERE u.role != 'student' AND u.active = 1 AND u.id != ? ORDER BY o.name, u.display_name`).all(user.id);
}

function send(deps, user, d) {
  const { db } = deps;
  db.prepare("UPDATE corr_docs SET status = 'pending', sent_at = ? WHERE id = ?").run(Date.now(), d.id);
  ev(db, d.id, 'send', user, 'أُرسل المستند للاعتماد');
  const fresh = db.prepare('SELECT * FROM corr_docs WHERE id = ?').get(d.id);
  note(deps, pendingApprovers(db, fresh).map((a) => a.user_id), fresh, `مستند جديد بانتظار اعتمادك: ${fresh.title}`);
  note(deps, ccIds(db, fresh.id), fresh, `نسخة للاطلاع: ${fresh.title}`);
}

export function createDoc(deps, user, input, ip) {
  const { db, cfg } = deps;
  const v = parse(db, user, input), files = readFiles(cfg, input?.files);
  const stored = [];
  try {
    const id = tx(db, () => {
      const n = db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM corr_docs').get().n;
      const no = `COR-${new Date().getFullYear()}-${pad(n, 5)}`;
      db.prepare("INSERT INTO corr_docs (id, no, title, subject, body, mode, status, creator_id, unit_id, created_at) VALUES (?,?,?,?,?,?,'draft',?,?,?)")
        .run(n, no, v.title, v.subject, v.body, v.mode, user.id, user.unit_id ?? null, Date.now());
      v.approvers.forEach((u, i) => db.prepare('INSERT INTO corr_approvers (doc_id, user_id, seq) VALUES (?,?,?)').run(n, u, i + 1));
      for (const u of v.cc) db.prepare('INSERT INTO corr_cc (doc_id, user_id) VALUES (?,?)').run(n, u);
      if (files.length) fs.mkdirSync(cfg.uploadDir, { recursive: true });
      for (const f of files) {
        const name = crypto.randomBytes(16).toString('hex'), p = path.join(cfg.uploadDir, name);
        fs.writeFileSync(p, f.buf, { mode: 0o600 }); stored.push(p);
        db.prepare('INSERT INTO corr_files (doc_id, orig_name, stored_name, mime, size, sha256) VALUES (?,?,?,?,?,?)').run(n, f.name, name, f.mime, f.buf.length, sha256(f.buf));
      }
      ev(db, n, 'new', user, 'أُنشئ المستند');
      audit(db, user, `إنشاء مراسلة: ${v.title}`, no, ip);
      return n;
    });
    if (input?.send !== false) sendDoc(deps, user, id, ip);
    return docView(db, db.prepare('SELECT * FROM corr_docs WHERE id = ?').get(id), user);
  } catch (e) { for (const p of stored) fs.rmSync(p, { force: true }); throw e; }
}

const load = (db, user, id) => {
  const d = db.prepare('SELECT * FROM corr_docs WHERE id = ?').get(Number(id));
  if (!d || !canSee(user, db, d)) throw new HttpError(404, 'المستند غير موجود.', 'not_found');
  return d;
};

// تعديل المسودة: المنشئ وحده وما دامت مسودة؛ send:true يرسلها بعد الحفظ
export function updateDoc(deps, user, id, input, ip) {
  const { db, cfg } = deps, d = load(db, user, id);
  if (d.creator_id !== user.id) throw new HttpError(403, 'للمنشئ وحده.', 'forbidden');
  if (d.status !== 'draft') throw new HttpError(409, 'لا يُعدَّل المستند بعد إرساله.', 'conflict');
  const has = (k) => input?.[k] !== undefined;
  const oldA = db.prepare('SELECT user_id FROM corr_approvers WHERE doc_id = ? ORDER BY seq').all(d.id).map((r) => r.user_id);
  const v = parse(db, user, { title: has('title') ? input.title : d.title, subject: has('subject') ? input.subject : d.subject, body: has('body') ? input.body : d.body, mode: has('mode') ? input.mode : d.mode,
    approvers: has('approvers') ? input.approvers : oldA, cc: has('cc') ? input.cc : ccIds(db, d.id) });
  const remove = Array.isArray(input?.removeFiles) ? input.removeFiles.map(Number) : [];
  const keep = db.prepare('SELECT * FROM corr_files WHERE doc_id = ?').all(d.id), gone = keep.filter((f) => remove.includes(f.id));
  const files = readFiles(cfg, input?.files);
  if (keep.length - gone.length + files.length > MAX_FILES) throw bad(`المرفقات: حتى ${MAX_FILES}.`);
  const stored = [];
  try {
    tx(db, () => {
      db.prepare('UPDATE corr_docs SET title = ?, subject = ?, body = ?, mode = ? WHERE id = ?').run(v.title, v.subject, v.body, v.mode, d.id);
      db.prepare('DELETE FROM corr_approvers WHERE doc_id = ?').run(d.id); v.approvers.forEach((u, i) => db.prepare('INSERT INTO corr_approvers (doc_id, user_id, seq) VALUES (?,?,?)').run(d.id, u, i + 1));
      db.prepare('DELETE FROM corr_cc WHERE doc_id = ?').run(d.id); for (const u of v.cc) db.prepare('INSERT INTO corr_cc (doc_id, user_id) VALUES (?,?)').run(d.id, u);
      for (const f of gone) db.prepare('DELETE FROM corr_files WHERE id = ?').run(f.id);
      if (files.length) fs.mkdirSync(cfg.uploadDir, { recursive: true });
      for (const f of files) {
        const name = crypto.randomBytes(16).toString('hex'), p = path.join(cfg.uploadDir, name);
        fs.writeFileSync(p, f.buf, { mode: 0o600 }); stored.push(p);
        db.prepare('INSERT INTO corr_files (doc_id, orig_name, stored_name, mime, size, sha256) VALUES (?,?,?,?,?,?)').run(d.id, f.name, name, f.mime, f.buf.length, sha256(f.buf));
      }
      ev(db, d.id, 'edit', user, 'عُدّلت المسودة');
      audit(db, user, `تعديل مسودة مراسلة: ${v.title}`, d.no, ip);
    });
  } catch (e) { for (const p of stored) fs.rmSync(p, { force: true }); throw e; }
  for (const f of gone) fs.rmSync(path.join(cfg.uploadDir, f.stored_name), { force: true });
  if (input?.send === true) return sendDoc(deps, user, d.id, ip);
  return docView(db, db.prepare('SELECT * FROM corr_docs WHERE id = ?').get(d.id), user);
}

export function sendDoc(deps, user, id, ip) {
  const d = load(deps.db, user, id);
  if (d.creator_id !== user.id) throw new HttpError(403, 'للمنشئ وحده.', 'forbidden');
  if (d.status !== 'draft') throw new HttpError(409, 'أُرسل المستند مسبقاً.', 'conflict');
  tx(deps.db, () => { send(deps, user, d); audit(deps.db, user, `إرسال مراسلة: ${d.title}`, d.no, ip); });
  return docView(deps.db, deps.db.prepare('SELECT * FROM corr_docs WHERE id = ?').get(d.id), user);
}

export function getDoc({ db }, user, id) { return docView(db, load(db, user, id), user); }

export function listDocs({ db }, user, q) {
  const box = q.box === 'out' ? 'out' : q.box === 'all' ? 'all' : 'in';
  if (box === 'all' && !user.can('corr:read_all')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
  const where = [], args = [];
  if (box === 'in') { where.push("d.status != 'draft' AND (EXISTS (SELECT 1 FROM corr_approvers a WHERE a.doc_id = d.id AND a.user_id = ?) OR EXISTS (SELECT 1 FROM corr_cc c WHERE c.doc_id = d.id AND c.user_id = ?))"); args.push(user.id, user.id); }
  else if (box === 'out') { where.push('d.creator_id = ?'); args.push(user.id); }
  else where.push("d.status != 'draft'");
  if (['draft', 'pending', 'approved', 'rejected', 'cancelled'].includes(q.status)) { where.push('d.status = ?'); args.push(q.status); }
  const rows = db.prepare(`SELECT d.* FROM corr_docs d WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC, d.id DESC LIMIT 200`).all(...args);
  return rows.map((d) => { const v = docView(db, d, user); return { ...v, body: undefined, events: undefined }; });
}

export function decideDoc(deps, user, id, action, noteText, ip) {
  const { db } = deps;
  const d = load(db, user, id);
  const mine = db.prepare('SELECT * FROM corr_approvers WHERE doc_id = ? AND user_id = ?').get(d.id, user.id);
  if (!mine) throw new HttpError(403, 'لست معتمداً على هذا المستند.', 'forbidden');
  if (d.status !== 'pending' || mine.state !== 'pending') throw new HttpError(409, 'لا يمكن البتّ في هذا المستند الآن.', 'conflict');
  if (!pendingApprovers(db, d).some((a) => a.user_id === user.id)) throw new HttpError(409, 'لم يحن دورك بعد في المسار التسلسلي.', 'conflict');
  const text = clean(noteText, 500);
  if (action === 'reject' && text.length < 3) throw bad('اذكر سبب الرفض (3 أحرف على الأقل).');
  tx(db, () => {
    const now = Date.now();
    db.prepare('UPDATE corr_approvers SET state = ?, at = ?, note = ? WHERE id = ?').run(action === 'approve' ? 'approved' : 'rejected', now, text || null, mine.id);
    ev(db, d.id, action === 'approve' ? 'ok' : 'no', user, action === 'approve' ? `اعتمد المستند${text ? ': ' + text : ''}` : `رفض المستند: ${text}`);
    if (action === 'reject') {
      db.prepare("UPDATE corr_docs SET status = 'rejected', decided_at = ? WHERE id = ?").run(now, d.id);
      note(deps, [d.creator_id], d, `رُفض مستندك من ${user.label}: ${text}`);
      note(deps, ccIds(db, d.id), d, `رُفض المستند ${d.title}`);
    } else if (!db.prepare("SELECT 1 FROM corr_approvers WHERE doc_id = ? AND state != 'approved'").get(d.id)) {
      const year = new Date().getFullYear(), outNo = db.prepare('SELECT COALESCE(MAX(out_no),0)+1 n FROM corr_docs WHERE out_year = ?').get(year).n;
      db.prepare("UPDATE corr_docs SET status = 'approved', decided_at = ?, out_no = ?, out_year = ? WHERE id = ?").run(now, outNo, year, d.id);
      ev(db, d.id, 'ok', null, `اكتمل الاعتماد — رقم الصادر ${year}/${outNo}`);
      note(deps, [d.creator_id], d, `اعتُمد مستندك بالكامل (صادر ${year}/${outNo})`);
      note(deps, ccIds(db, d.id), d, `اعتُمد المستند ${d.title} (صادر ${year}/${outNo})`);
    } else if (d.mode === 'sequential') {
      const fresh = db.prepare('SELECT * FROM corr_docs WHERE id = ?').get(d.id);
      note(deps, pendingApprovers(db, fresh).map((a) => a.user_id), fresh, `حان دورك لاعتماد: ${d.title}`);
    }
    audit(db, user, `${action === 'approve' ? 'اعتماد' : 'رفض'} مراسلة: ${d.title}`, d.no, ip);
  });
  return docView(db, db.prepare('SELECT * FROM corr_docs WHERE id = ?').get(d.id), user);
}

export function commentDoc(deps, user, id, text, ip) {
  const { db } = deps, d = load(db, user, id), t = clean(text, 1000);
  if (d.status === 'draft') throw new HttpError(409, 'أرسل المستند أولاً.', 'conflict');
  if (t.length < 1) throw bad('نص التعليق مطلوب.');
  ev(db, d.id, 'comment', user, t);
  const others = [d.creator_id, ...ccIds(db, d.id), ...db.prepare('SELECT user_id FROM corr_approvers WHERE doc_id = ?').all(d.id).map((r) => r.user_id)].filter((u) => u !== user.id);
  note(deps, others, d, `تعليق جديد من ${user.label} على ${d.title}`);
  return docView(db, d, user);
}

export function cancelDoc(deps, user, id, ip) {
  const { db } = deps, d = load(db, user, id);
  if (d.creator_id !== user.id) throw new HttpError(403, 'للمنشئ وحده.', 'forbidden');
  if (!['draft', 'pending'].includes(d.status)) throw new HttpError(409, 'لا يمكن إلغاء مستند بُتَّ فيه.', 'conflict');
  tx(db, () => {
    db.prepare("UPDATE corr_docs SET status = 'cancelled', decided_at = ? WHERE id = ?").run(Date.now(), d.id);
    ev(db, d.id, 'cancel', user, 'ألغى المنشئ المستند');
    if (d.status === 'pending') note(deps, db.prepare("SELECT user_id FROM corr_approvers WHERE doc_id = ? AND state = 'pending'").all(d.id).map((r) => r.user_id), d, `أُلغي المستند: ${d.title}`);
    audit(db, user, `إلغاء مراسلة: ${d.title}`, d.no, ip);
  });
  return docView(db, db.prepare('SELECT * FROM corr_docs WHERE id = ?').get(d.id), user);
}

export function readCorrFile({ db, cfg }, user, fid) {
  const f = db.prepare('SELECT * FROM corr_files WHERE id = ?').get(Number(fid));
  const d = f && db.prepare('SELECT * FROM corr_docs WHERE id = ?').get(f.doc_id);
  if (!f || !canSee(user, db, d)) throw new HttpError(404, 'غير موجود.', 'not_found');
  const buf = fs.readFileSync(path.join(cfg.uploadDir, f.stored_name));
  if (sha256(buf) !== f.sha256) throw new HttpError(500, 'سلامة المرفق مخالفة للمسجَّل.', 'integrity');
  return { buf, mime: f.mime, name: f.orig_name };
}

export function listNotifs({ db }, user) {
  const items = db.prepare('SELECT id, doc_id docId, text, at, read FROM corr_notifs WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT 50').all(user.id).map((n) => ({ ...n, read: !!n.read }));
  return { items, unread: db.prepare('SELECT COUNT(*) n FROM corr_notifs WHERE user_id = ? AND read = 0').get(user.id).n };
}
export function readNotifs({ db }, user, body) {
  if (body?.all) db.prepare('UPDATE corr_notifs SET read = 1 WHERE user_id = ?').run(user.id);
  else for (const id of Array.isArray(body?.ids) ? body.ids.slice(0, 100) : []) db.prepare('UPDATE corr_notifs SET read = 1 WHERE user_id = ? AND id = ?').run(user.id, Number(id));
  return { ok: true };
}

// «مكتبي»: ملخص شخصي للموظف في استدعاء واحد — الملف الوظيفي، الصلاحيات، الأرقام الحية، آخر الطلبات والمراسلات
import { effective, PERMISSION_CATALOG } from '../permissions.js';
import { listRequests } from './requests.js';
import { myAttendance } from './staffatt.js';
import { publicUser } from './auth.js';

const one = (db, sql, ...a) => db.prepare(sql).get(...a)?.n ?? 0;

export function deskSummary({ db }, user) {
  const can = (p) => user.can(p);
  const mine = effective(db, user);
  const permissions = PERMISSION_CATALOG.map((g) => ({ group: g.group, items: g.items.filter((i) => mine.includes(i.key)).map((i) => i.label) })).filter((g) => g.items.length);
  const out = { me: publicUser(db, user), permissions, counts: {}, requests: { mine: [], queue: 0 }, corr: null, hr: null };
  out.me.permissions = undefined;                                     // القائمة الخام موجودة في /api/me

  // طلباتي الداخلية + ما ينتظر وحدتي
  if (can('request:create_internal')) {
    const rows = db.prepare('SELECT id, no, status, created_at, service_code FROM requests WHERE student_id = ? ORDER BY created_at DESC LIMIT 5').all(user.id);
    const label = db.prepare('SELECT label FROM service_types WHERE code = ?');
    out.requests.mine = rows.map((r) => ({ id: r.id, no: r.no, status: r.status, at: r.created_at, service: label.get(r.service_code)?.label ?? r.service_code }));
    out.counts.myOpen = one(db, "SELECT COUNT(*) n FROM requests WHERE student_id = ? AND status = 'review'", user.id);
  }
  if (can('request:decide') || can('request:read_unit') || can('request:read_all')) {
    out.requests.queue = Math.max(0, listRequests({ db }, user, { status: 'review' }).length - one(db, "SELECT COUNT(*) n FROM requests WHERE student_id = ? AND status = 'review'", user.id));
    out.counts.queue = out.requests.queue;
  }

  // المراسلات
  if (can('corr:use') || can('corr:read_all')) {
    out.counts.corrTurn = one(db, `SELECT COUNT(*) n FROM corr_approvers a JOIN corr_docs d ON d.id = a.doc_id WHERE a.user_id = ? AND a.state = 'pending' AND d.status = 'pending'`, user.id);
    out.counts.corrUnread = one(db, 'SELECT COUNT(*) n FROM corr_notifs WHERE user_id = ? AND read = 0', user.id);
    out.counts.corrDrafts = one(db, "SELECT COUNT(*) n FROM corr_docs WHERE creator_id = ? AND status = 'draft'", user.id);
    out.corr = db.prepare(`SELECT d.id, d.no, d.title, d.status, d.created_at at FROM corr_docs d WHERE d.status != 'draft' AND (d.creator_id = ? OR EXISTS (SELECT 1 FROM corr_approvers a WHERE a.doc_id = d.id AND a.user_id = ?) OR EXISTS (SELECT 1 FROM corr_cc c WHERE c.doc_id = d.id AND c.user_id = ?)) ORDER BY d.created_at DESC LIMIT 5`).all(user.id, user.id, user.id);
  }

  // الحضور والإجازة
  if (can('staffatt:self')) { const a = myAttendance({ db }, user); out.hr = { today: a.today, month: a.month, leave: a.leave }; }
  return out;
}

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL + فهارس أداء: قراءة متزامنة مع كتابة، وحد زمني للانتظار عند التزاحم
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA cache_size = -20000; PRAGMA temp_store = MEMORY;');
  // تحليل الإحصاءات مرة واحدة عند أول فتح لقاعدة ملف (يسرّع اختيار المخطط الاستعلامي)
  try { db.exec('ANALYZE;'); } catch {}
  migrate(db);
  // تحليل إضافي بعد الترحيلات لخطة استعلام حديثة
  try { db.exec('ANALYZE;'); } catch {}
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    tx(db, () => {
      db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now());
    });
  }
}

// معاملة ذرية: كل شيء أو لا شيء
// معاملة قابلة للتداخل: الأولى BEGIN والمتداخلة SAVEPOINT (يستفيد منها الاستيراد: صف فاشل يُلغى وحده)
const depth = new WeakMap();
export function tx(db, fn) {
  const d = depth.get(db) ?? 0, sp = `sp_${d}`;
  db.exec(d === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth.set(db, d + 1);
  try {
    const r = fn();
    depth.set(db, d);
    db.exec(d === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    depth.set(db, d);
    try { db.exec(d === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`); } catch { /* already rolled back */ }
    throw e;
  }
}

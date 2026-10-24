-- المراسلات الداخلية: مستندات بين الوحدات والموظفين بمسار اعتماد (تسلسلي أو متوازٍ)
CREATE TABLE corr_docs (
  id INTEGER PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,                                   -- رقم الوارد: COR-2026-00001
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL CHECK (mode IN ('sequential','parallel')),
  status TEXT NOT NULL CHECK (status IN ('draft','pending','approved','rejected','cancelled')),
  creator_id INTEGER NOT NULL REFERENCES users(id),
  unit_id INTEGER REFERENCES org_units(id),
  out_no INTEGER,                                            -- رقم الصادر: يُمنح عند الاعتماد النهائي (تسلسل سنوي)
  out_year INTEGER,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  decided_at INTEGER
);
CREATE UNIQUE INDEX corr_out_unique ON corr_docs(out_year, out_no) WHERE out_no IS NOT NULL;
CREATE INDEX corr_creator ON corr_docs(creator_id, created_at);
CREATE TABLE corr_approvers (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES corr_docs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  seq INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected')),
  at INTEGER,
  note TEXT,
  UNIQUE (doc_id, user_id)
);
CREATE INDEX corr_appr_user ON corr_approvers(user_id, state);
CREATE TABLE corr_events (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES corr_docs(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,                                        -- new | send | ok | no | comment | cancel
  actor_id INTEGER,
  actor_label TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX corr_ev_doc ON corr_events(doc_id, id);
CREATE TABLE corr_files (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES corr_docs(id) ON DELETE CASCADE,
  orig_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL
);
CREATE TABLE corr_notifs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  doc_id INTEGER REFERENCES corr_docs(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  at INTEGER NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX corr_notif_user ON corr_notifs(user_id, read, at);

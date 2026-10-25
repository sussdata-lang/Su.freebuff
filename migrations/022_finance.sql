-- المالية والمحاسبة (وحدة 5.9): دليل حسابات هرمي، سنوات مالية، قيود يومية مزدوجة القيد، أطراف، مراكز كلفة، عملات،
-- ورسوم الطلاب. كل المبالغ أعداد صحيحة بوحدة 1/100 من العملة الأساسية (لا أخطاء كسور عشرية).
CREATE TABLE fin_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  start_day TEXT NOT NULL,            -- YYYY-MM-DD
  end_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at INTEGER, closed_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE fin_currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  rate REAL NOT NULL DEFAULT 1,       -- كم وحدة أساسية تعادل وحدة واحدة من هذه العملة
  is_base INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE fin_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES fin_accounts(id),
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  postable INTEGER NOT NULL DEFAULT 1,  -- حساب نهائي تُرحَّل عليه القيود (الأب تجميعي)
  active INTEGER NOT NULL DEFAULT 1,
  system_key TEXT UNIQUE,               -- ربط وظيفي: cash, bank, students, salaries_exp, salaries_pay, retained …
  require_cc INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_fin_accounts_parent ON fin_accounts(parent_id);

CREATE TABLE fin_cost_centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit_id INTEGER REFERENCES org_units(id),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE fin_parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('supplier','customer','employee','other')),
  name TEXT NOT NULL,
  phone TEXT, email TEXT, notes TEXT,
  account_id INTEGER REFERENCES fin_accounts(id),   -- حساب المراقبة (الموردون/المدينون…)
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE fin_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year_id INTEGER NOT NULL REFERENCES fin_years(id),
  type TEXT NOT NULL CHECK (type IN ('JV','RV','PV','OB','CL','FE','PR')),
  seq INTEGER,                                    -- يُمنح عند الترحيل فقط
  no TEXT UNIQUE,                                 -- مثال JV-2026-00012
  entry_day TEXT NOT NULL,
  description TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  source TEXT,                                    -- charge:12 / payment:7 / payroll:2026-10 …
  reversal_of INTEGER REFERENCES fin_entries(id),
  reversed_by INTEGER REFERENCES fin_entries(id),
  created_by INTEGER REFERENCES users(id), created_at INTEGER NOT NULL,
  posted_by INTEGER REFERENCES users(id), posted_at INTEGER
);
CREATE INDEX idx_fin_entries_day ON fin_entries(entry_day, status);
CREATE INDEX idx_fin_entries_year ON fin_entries(year_id, type);
CREATE UNIQUE INDEX idx_fin_entries_source ON fin_entries(source) WHERE source IS NOT NULL AND reversal_of IS NULL;

CREATE TABLE fin_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES fin_entries(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES fin_accounts(id),
  debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency TEXT REFERENCES fin_currencies(code),
  rate REAL, fc_amount INTEGER,                    -- مبلغ العملة الأجنبية وسعرها وقت القيد (للمرجع)
  cost_center_id INTEGER REFERENCES fin_cost_centers(id),
  party_id INTEGER REFERENCES fin_parties(id),
  student_id INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX idx_fin_lines_entry ON fin_lines(entry_id);
CREATE INDEX idx_fin_lines_account ON fin_lines(account_id);
CREATE INDEX idx_fin_lines_party ON fin_lines(party_id) WHERE party_id IS NOT NULL;
CREATE INDEX idx_fin_lines_student ON fin_lines(student_id) WHERE student_id IS NOT NULL;

-- رسوم الطلاب
CREATE TABLE fin_fee_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fee' CHECK (kind IN ('fee','discount')),
  account_id INTEGER NOT NULL REFERENCES fin_accounts(id),   -- الإيراد (أو مصروف الخصم)
  default_amount INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE fin_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id),
  fee_type_id INTEGER NOT NULL REFERENCES fin_fee_types(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  due_day TEXT NOT NULL,
  academic_year TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','void')),
  entry_id INTEGER REFERENCES fin_entries(id),
  created_by INTEGER REFERENCES users(id), created_at INTEGER NOT NULL
);
CREATE INDEX idx_fin_charges_student ON fin_charges(student_id, status);

CREATE TABLE fin_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','bank')),
  account_id INTEGER NOT NULL REFERENCES fin_accounts(id),
  paid_day TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','void')),
  entry_id INTEGER REFERENCES fin_entries(id),
  created_by INTEGER REFERENCES users(id), created_at INTEGER NOT NULL
);
CREATE INDEX idx_fin_payments_student ON fin_payments(student_id, status);

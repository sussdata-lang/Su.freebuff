-- وحدة 5.10 المشتريات والمخازن والأصول
-- مخازن، موردون، أصناف، طلبات شراء، أوامر توريد، استلام وصرف، وأصول ثابتة
CREATE TABLE proc_warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  manager_id INTEGER REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE proc_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT, email TEXT, address TEXT,
  tax_no TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE proc_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO proc_categories (code, name) VALUES
  ('CAT-GEN','عام'),('CAT-STA','قرطاسية ومستلزمات مكتبية'),('CAT-IT','أجهزة وحاسوب وشبكات'),
  ('CAT-FUR','أثاث وتجهيزات'),('CAT-LAB','مخبرية وتدريبية'),('CAT-MED','طبية وإسعافية'),('CAT-CLN','نظافة وصيانة');

CREATE TABLE proc_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES proc_categories(id),
  unit TEXT NOT NULL DEFAULT 'قطعة',
  warehouse_id INTEGER REFERENCES proc_warehouses(id),
  qty_on_hand INTEGER NOT NULL DEFAULT 0,
  avg_cost INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  max_stock INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_proc_items_wh ON proc_items(warehouse_id);
CREATE INDEX idx_proc_items_cat ON proc_items(category_id);

CREATE TABLE proc_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  requester_id INTEGER NOT NULL REFERENCES users(id),
  warehouse_id INTEGER REFERENCES proc_warehouses(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','rejected','ordered','cancelled')),
  requested_at INTEGER,
  decided_by INTEGER REFERENCES users(id),
  decided_at INTEGER,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_proc_requests_status ON proc_requests(status);
CREATE INDEX idx_proc_requests_requester ON proc_requests(requester_id);

CREATE TABLE proc_request_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES proc_requests(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES proc_items(id),
  description TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK(qty > 0),
  est_cost INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_proc_req_lines_req ON proc_request_lines(request_id);

CREATE TABLE proc_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  request_id INTEGER REFERENCES proc_requests(id),
  supplier_id INTEGER NOT NULL REFERENCES proc_suppliers(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ordered','received','cancelled')),
  total_amount INTEGER NOT NULL DEFAULT 0,
  ordered_at INTEGER,
  received_at INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_proc_orders_supplier ON proc_orders(supplier_id);
CREATE INDEX idx_proc_orders_status ON proc_orders(status);

CREATE TABLE proc_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES proc_orders(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES proc_items(id),
  description TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK(qty > 0),
  unit_cost INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_proc_order_lines_order ON proc_order_lines(order_id);

CREATE TABLE proc_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES proc_orders(id),
  received_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE proc_receipt_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES proc_receipts(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES proc_items(id),
  qty INTEGER NOT NULL CHECK(qty > 0),
  unit_cost INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE proc_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  warehouse_id INTEGER NOT NULL REFERENCES proc_warehouses(id),
  issued_to TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  issued_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE proc_issue_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES proc_issues(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES proc_items(id),
  qty INTEGER NOT NULL CHECK(qty > 0)
);

CREATE TABLE proc_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'عام',
  warehouse_id INTEGER REFERENCES proc_warehouses(id),
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','in_use','maintenance','disposed')),
  purchase_day TEXT,
  cost INTEGER NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES proc_suppliers(id),
  assigned_to TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_proc_assets_status ON proc_assets(status);
CREATE INDEX idx_proc_assets_wh ON proc_assets(warehouse_id);

CREATE TABLE proc_asset_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES proc_assets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('transfer','dispose','maintenance','return')),
  from_wh INTEGER REFERENCES proc_warehouses(id),
  to_wh INTEGER REFERENCES proc_warehouses(id),
  to_user TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  moved_at INTEGER NOT NULL,
  moved_by INTEGER REFERENCES users(id)
);

-- الموارد البشرية والرواتب (وحدة 5.7)
CREATE TABLE IF NOT EXISTS hr_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employeeNo TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  personalId TEXT NOT NULL UNIQUE,
  email TEXT,
  phone TEXT,
  hireDate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','on_leave','terminated')),
  unit_id INTEGER REFERENCES org_units(id),
  position TEXT,
  salary_base INTEGER NOT NULL DEFAULT 0,
  joinDate TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_hr_employees_unit ON hr_employees(unit_id);
CREATE INDEX idx_hr_employees_status ON hr_employees(status);

CREATE TABLE IF NOT EXISTS hr_salaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  effective_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  ip TEXT
);
CREATE INDEX idx_hr_salaries_employee ON hr_salaries(employee_id);
CREATE INDEX idx_hr_salaries_effective ON hr_salaries(effective_at);

CREATE TABLE IF NOT EXISTS hr_leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL CHECK(leave_type IN ('annual','sick','unpaid','maternity','paternity')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days INTEGER NOT NULL,
  reason TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at INTEGER,
  ip TEXT
);
CREATE INDEX idx_hr_leaves_employee ON hr_leaves(employee_id);
CREATE INDEX idx_hr_leaves_status ON hr_leaves(status);
CREATE INDEX idx_hr_leaves_dates ON hr_leaves(start_date, end_date);

CREATE TABLE IF NOT EXISTS hr_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  contract_type TEXT NOT NULL CHECK(contract_type IN ('fixed','indefinite','temporary','freelance')),
  title TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  salary INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  ip TEXT
);
CREATE INDEX idx_hr_contracts_employee ON hr_contracts(employee_id);
CREATE INDEX idx_hr_contracts_dates ON hr_contracts(start_date, end_date);

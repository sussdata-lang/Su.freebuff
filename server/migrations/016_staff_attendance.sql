-- حضور وانصراف الموظفين ورصيد الإجازات
CREATE TABLE staff_attendance (
  user_id INTEGER NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,                       -- YYYY-MM-DD بتوقيت دمشق
  check_in INTEGER NOT NULL,
  check_out INTEGER,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX staff_att_day ON staff_attendance(day);
CREATE TABLE leave_entitlements (          -- استحقاق سنوي مخصَّص (الافتراضي 15 يوماً)
  user_id INTEGER NOT NULL REFERENCES users(id),
  year INTEGER NOT NULL,
  days REAL NOT NULL CHECK (days >= 0 AND days <= 366),
  PRIMARY KEY (user_id, year)
);
CREATE TABLE leave_records (               -- إجازات معتمدة (تُنشأ تلقائياً عند اعتماد طلب hr_leave)
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  year INTEGER NOT NULL,
  type TEXT NOT NULL,
  from_day TEXT NOT NULL,
  to_day TEXT NOT NULL,
  days INTEGER NOT NULL,                   -- أيام العمل (تُستثنى الجمعة والسبت)
  request_id INTEGER UNIQUE REFERENCES requests(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX leave_user_year ON leave_records(user_id, year);

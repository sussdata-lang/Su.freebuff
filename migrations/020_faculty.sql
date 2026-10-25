-- وحدة 5.6 أعضاء هيئة التدريس: السجل الأساسي (الدرجة، القسم، الساعات المكتبية)
-- + إسناد المقرر إلى عضو لحساب العبء التدريسي. عند إسناد مقرر يصبح اسم العضو هو نص «المدرّس».
CREATE TABLE faculty_members (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  rank           TEXT NOT NULL,                 -- الدرجة العلمية (من قائمة RANKS في services/faculty.js)
  unit_id        INTEGER REFERENCES org_units(id),
  specialty      TEXT,
  email          TEXT,
  phone          TEXT,
  office_hours   TEXT,                          -- الساعات المكتبية (نص حر: أيام وأوقات الاستقبال)
  office_location TEXT,
  status         TEXT NOT NULL DEFAULT 'active', -- active | leave | inactive
  hire_date      INTEGER,
  notes          TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_faculty_status ON faculty_members(status);
ALTER TABLE courses ADD COLUMN member_id INTEGER REFERENCES faculty_members(id);
CREATE INDEX idx_courses_member ON courses(member_id) WHERE member_id IS NOT NULL;

-- 024: فهارس أداء وتهيئة WAL المحسّنة — لا يُغيّر المخطط، يضيف فهارس فقط (إعادة آمنة مع IF NOT EXISTS)
-- يغطي: الطلاب، المقررات، العلامات، القاعات، الطلبات، الذمم، الشكاوى، الحضور، المراسلات، المالية، المشتريات

-- الطلاب والبرامج
CREATE INDEX IF NOT EXISTS idx_users_student_no2 ON users(student_no) WHERE student_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
CREATE INDEX IF NOT EXISTS idx_profiles_program_year ON student_profiles(program_id, enroll_year);
CREATE INDEX IF NOT EXISTS idx_profiles_status_year ON student_profiles(status, enroll_year);
CREATE INDEX IF NOT EXISTS idx_profiles_nid ON student_profiles(national_id);

-- المقررات والعلامات
CREATE INDEX IF NOT EXISTS idx_courses_program_level ON courses(program_id, level, semester);
CREATE INDEX IF NOT EXISTS idx_courses_active ON courses(active);
CREATE INDEX IF NOT EXISTS idx_courses_member ON courses(member_id) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_grades_course ON grades(course_id);
CREATE INDEX IF NOT EXISTS idx_grades_level ON grades(level, semester);
CREATE INDEX IF NOT EXISTS idx_grades_year ON grades(academic_year);
CREATE INDEX IF NOT EXISTS idx_grades_workflow2 ON grades(workflow_status, student_id);

-- سجل القاعات والحضور
CREATE INDEX IF NOT EXISTS idx_hall_logs_student ON hall_logs(student_id, entered_at);
CREATE INDEX IF NOT EXISTS idx_hall_logs_hall ON hall_logs(hall);
CREATE INDEX IF NOT EXISTS idx_hall_logs_course ON hall_logs(course_id) WHERE course_id IS NOT NULL;
-- staff_attendance مفهرس أصلاً (المفتاح الأساسي user_id,day + staff_att_day)؛ لا عمود attended_at في الجدول

-- الطلبات والوثائق والذمم
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_service ON requests(service_code, status);
CREATE INDEX IF NOT EXISTS idx_requests_student_service ON requests(student_id, service_code);
CREATE INDEX IF NOT EXISTS idx_documents_request ON documents(request_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status, created_at);
CREATE INDEX IF NOT EXISTS idx_complaints_student ON complaints(student_id);

-- المالية
CREATE INDEX IF NOT EXISTS idx_fin_entries_status_day ON fin_entries(status, entry_day);
CREATE INDEX IF NOT EXISTS idx_fin_entries_type ON fin_entries(type, status);
CREATE INDEX IF NOT EXISTS idx_fin_lines_account_day ON fin_lines(account_id, entry_id);

-- المشتريات والمخازن
CREATE INDEX IF NOT EXISTS idx_proc_items_code ON proc_items(code);
CREATE INDEX IF NOT EXISTS idx_proc_items_active ON proc_items(active, qty_on_hand);
CREATE INDEX IF NOT EXISTS idx_proc_requests_created ON proc_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proc_orders_created ON proc_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proc_issues_warehouse ON proc_issues(warehouse_id, issued_at);
CREATE INDEX IF NOT EXISTS idx_proc_assets_code ON proc_assets(code);

-- تحسين WAL: ضبط إضافي عند الفتح في db.js يكمّل هذا (busy_timeout وsynchronous)

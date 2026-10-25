-- نوع العضو: هيئة إدارية أو هيئة تدريسية (يحدد شكل «مكتبي» ومختصراته) + المسمى الوظيفي
ALTER TABLE users ADD COLUMN staff_kind TEXT NOT NULL DEFAULT 'admin' CHECK (staff_kind IN ('admin','faculty'));
ALTER TABLE users ADD COLUMN job_title TEXT NOT NULL DEFAULT '';

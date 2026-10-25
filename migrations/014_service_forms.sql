-- نماذج الطلبات المفصّلة: الجهة المالكة، الجمهور (طلاب/موظفون)، الفئة، التعليمات، المرفقات المطلوبة
ALTER TABLE service_types ADD COLUMN unit_code TEXT;                                   -- رمز الوحدة المسؤولة (org_units.code)؛ تُسنَد إليها الطلبات تلقائياً
ALTER TABLE service_types ADD COLUMN audience TEXT NOT NULL DEFAULT 'student' CHECK (audience IN ('student','staff','both'));
ALTER TABLE service_types ADD COLUMN category TEXT;                                    -- مجموعة العرض داخل الإدارة (الوثائق، الأعذار، السكن…)
ALTER TABLE service_types ADD COLUMN instructions TEXT NOT NULL DEFAULT '';            -- تعليمات تُعرض لمقدّم الطلب
ALTER TABLE service_types ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]';      -- [{label, required}] المرفقات المطلوبة/الاختيارية
ALTER TABLE service_types ADD COLUMN max_attachments INTEGER NOT NULL DEFAULT 1;
ALTER TABLE attachments ADD COLUMN slot_label TEXT;                                    -- تسمية المرفق (تقرير طبي، صورة…)

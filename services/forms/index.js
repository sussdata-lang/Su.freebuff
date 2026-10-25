// كتالوج نماذج الطلبات المفصّلة لكل إدارات الجامعة، مرتبطة بالهيكل التنظيمي (structure.js).
// ensureForms إضافي وآمن للتكرار: ينشئ الناقص فقط ولا يعدّل ما غيّره المدير في محرر الخدمات.
import { tx } from '../../db.js';
import { audit } from '../../audit.js';
import { createService } from '../catalog.js';
import { STUDENT_AFFAIRS } from './studentAffairs.js';
import { ACADEMIC_CORE } from './academicCore.js';
import { HR_FORMS, FINANCE_FORMS, PROCURE_FORMS, ADMIN_FORMS } from './support.js';
import { IT_FORMS, LIBRARY_FORMS, QUALITY_FORMS, RESEARCH_FORMS, LEGAL_FORMS, MEDIA_FORMS, SAFETY_FORMS } from './services.js';

export const FORMS = [...STUDENT_AFFAIRS, ...ACADEMIC_CORE, ...HR_FORMS, ...FINANCE_FORMS, ...PROCURE_FORMS, ...ADMIN_FORMS,
  ...IT_FORMS, ...LIBRARY_FORMS, ...QUALITY_FORMS, ...RESEARCH_FORMS, ...LEGAL_FORMS, ...MEDIA_FORMS, ...SAFETY_FORMS];

// الخدمات الأساسية الموجودة مسبقاً: تُنسب إلى وحدتها وفئتها دون المساس بحقولها
const ADOPT = {
  attendance:       { unit: 'of_docs',      category: 'الوثائق والشهادات', instructions: 'تصدر الإفادة موقَّعة رقمياً بعد الاعتماد، ويمكن التحقق منها برمز QR.' },
  transcript:       { unit: 'of_docs',      category: 'الوثائق والشهادات', instructions: 'يُصدر كشف العلامات المعتمدة فقط، موقَّعاً رقمياً.' },
  excuse:           { unit: 'of_leaves',    category: 'الأعذار', instructions: 'يُقدَّم العذر خلال 7 أيام من الامتحان ومعه المستند المؤيِّد.', attachments: [{ label: 'مستند العذر', required: true }], maxAttachments: 2 },
  campus_life:      { unit: 'of_housing',   category: 'السكن والخدمات', instructions: '' },
  needs_request:    { unit: 'of_housing',   category: 'السكن والخدمات', instructions: 'حدّد نوع الاحتياج وسببه بدقة ليُدرس طلبك.' },
  postponement:     { unit: 'admission',    category: 'القبول والتسجيل', instructions: 'يُعرض الطلب على لجنة القبول والتسجيل.' },
  withdrawal:       { unit: 'admission',    category: 'القبول والتسجيل', instructions: '' },
  program_transfer: { unit: 'admission',    category: 'القبول والتسجيل', instructions: 'يخضع التحويل لشروط البرنامج المطلوب ومقاعده.' },
  grade_appeal:     { unit: 'exams',        category: 'الامتحانات والعلامات', instructions: 'يُقدَّم التظلم خلال 5 أيام من إعلان العلامة.' },
  violation_report: { unit: 'of_grievance', category: 'التوجيه والتظلمات', instructions: '' },
};

export function ensureForms({ db }) {
  const out = { created: 0, adopted: 0, existing: 0, perms: 0 };
  const exists = db.prepare('SELECT 1 FROM service_types WHERE code = ?');
  for (const f of FORMS) {
    if (exists.get(f.code)) { out.existing++; continue; }
    createService({ db }, null, f, null);
    out.created++;
  }
  tx(db, () => {
    for (const [code, a] of Object.entries(ADOPT)) {
      const r = db.prepare(`UPDATE service_types SET unit_code = ?, category = ?, instructions = CASE WHEN instructions = '' THEN ? ELSE instructions END
        WHERE code = ? AND unit_code IS NULL`).run(a.unit, a.category, a.instructions, code);
      if (r.changes) {
        out.adopted++;
        if (a.attachments) db.prepare('UPDATE service_types SET attachments_json = ?, max_attachments = ? WHERE code = ?').run(JSON.stringify(a.attachments), a.maxAttachments ?? a.attachments.length, code);
      }
    }
    // أدوار المسؤولين المنشأة قبل هذا الإصدار: تُمنح مرة واحدة صلاحيتي تقديم الطلبات الداخلية والبتّ في طلبات الوحدة
    if (!db.prepare("SELECT 1 FROM site_settings WHERE key = 'forms_perm_v1'").get()) {
      for (const r of db.prepare("SELECT key, permissions_json p FROM roles WHERE key LIKE 'head\\_%' ESCAPE '\\'").all()) {
        const p = JSON.parse(r.p), add = ['request:create_internal'];
        if (p.includes('request:read_unit')) add.push('request:decide');
        const next = [...new Set([...p, ...add])];
        if (next.length !== p.length) { db.prepare('UPDATE roles SET permissions_json = ? WHERE key = ?').run(JSON.stringify(next), r.key); out.perms++; }
      }
      db.prepare("INSERT INTO site_settings (key, value) VALUES ('forms_perm_v1', '1')").run();
    }
    if (out.created || out.adopted || out.perms) audit(db, null, 'تهيئة نماذج الطلبات', `جديد ${out.created} · منسوب ${out.adopted} · صلاحيات ${out.perms}`);
  });
  return out;
}

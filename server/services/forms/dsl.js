// أدوات تعريف مختصرة لنماذج الطلبات. تُنتج كائنات مطابقة لما يقبله محرر الخدمات (catalog.js).
export const T = (label, required = false, hint) => ({ label, type: 'text', required, ...(hint ? { hint } : {}) });
export const L = (label, required = false, hint) => ({ label, type: 'textarea', required, ...(hint ? { hint } : {}) });
export const S = (label, options, required = false, hint) => ({ label, type: 'select', options, required, ...(hint ? { hint } : {}) });
export const N = (label, min, max, required = false, hint) => ({ label, type: 'number', min, max, required, ...(hint ? { hint } : {}) });
export const M = (label, max = 1e9, required = false, hint) => ({ label, type: 'decimal', min: 0, max, required, ...(hint ? { hint } : {}) });
export const D = (label, required = false, hint) => ({ label, type: 'date', required, ...(hint ? { hint } : {}) });
export const YN = (label, required = false) => S(label, ['نعم', 'لا'], required);

export const PHONE = T('رقم هاتف للتواصل', true, 'مثال: 0944123456');
export const URGENCY = S('درجة الاستعجال', ['عادي', 'مستعجل', 'طارئ'], true);
export const NOTES = L('ملاحظات إضافية');
export const TERM = S('الفصل الدراسي', ['الفصل الأول', 'الفصل الثاني', 'الفصل الصيفي'], true);
export const YEAR = T('العام الدراسي', true, 'مثال: 2026-2027');

// form(code, label, unit, audience, category, desc, { sla, ins, att:[[label, required]], doc, fields })
export function form(code, label, unit, audience, category, description, o = {}) {
  const att = (o.att ?? []).map(([l, r]) => ({ label: l, required: !!r }));
  return { code, label, unit, audience, category, description, slaHours: o.sla ?? 72, instructions: o.ins ?? '', attachments: att,
    maxAttachments: o.max ?? Math.max(1, att.length), requiresAttachment: att.some((a) => a.required), issuesDocument: !!o.doc, fields: o.fields ?? [] };
}

// نسخة PDF موقَّعة رقمياً للمستند المعتمد: رقم الصادر، النص، سجل الاعتماد، بصمة المحتوى. تُولَّد عند أول طلب وتُحفظ فتبقى ثابتة.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from '../http.js';
import { buildPdf, prepareSigning, textWidth } from '../lib/pdf.js';
import { signDetached } from './pki.js';
import { identityOf } from './enrollcert.js';
import { headerLines } from './site.js';
import { canSee, docView } from './correspondence.js';

const G = '#054239', GOLD = '#C9A24B', MUTE = '#566660', R = 545, L = 50;
const utc = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
function wrap(str, size, maxW) {
  const lines = [];
  for (const para of String(str ?? '').split('\n')) {
    let cur = '';
    for (const w of para.split(/\s+/).filter(Boolean)) { const t = cur ? `${cur} ${w}` : w; if (cur && textWidth(t, 'regular', size) > maxW) { lines.push(cur); cur = w; } else cur = t; }
    lines.push(cur);
  }
  return lines;
}
const fit = (s, font, size, maxW) => { s = String(s ?? ''); while (s.length > 1 && textWidth(s, font, size) > maxW) s = s.slice(0, -1); return s; };
const STATE = { approved: 'اعتمد', rejected: 'رفض', pending: 'بانتظار' };

function paint(d, v, hash, cn, signedAt, hdr) {
  d.fill(G); d.rect(0, 742, 595.28, 100); d.fill(GOLD); d.rect(0, 738, 595.28, 4);
  d.image(478, 752, 68, 82);
  d.text('الجامعة السورية للعلوم الأمنية', { x: 465, y: 800, size: 21, font: 'bold', color: '#FFFFFF' });
  d.text(hdr.corr, { x: 465, y: 774, size: 12, color: '#E6CB84' });
  d.text(fit(v.title, 'bold', 20, 480), { x: 297.6, y: 705, size: 20, font: 'bold', color: G, align: 'center' });
  d.stroke(GOLD); d.line(190, 693, 405, 693, 1.5);
  const rows = [['رقم الصادر', v.outNo || '-'], ['رقم المستند', v.no], ['من', `${v.creator.name}${v.creator.unit ? ' — ' + v.creator.unit : ''}`], ['الموضوع', v.subject || '-'], ['تاريخ الاعتماد', utc(v.decidedAt)]];
  let y = 668;
  rows.forEach(([k, val], i) => { if (i % 2 === 0) { d.fill('#F2F5F2'); d.rect(L - 10, y - 8, R - L + 20, 24); } d.text(k, { x: R, y, size: 11, color: MUTE }); d.text(fit(val, 'bold', 12, 380), { x: 440, y, size: 12, font: 'bold' }); y -= 24; });
  y -= 14;
  const lines = wrap(v.body, 12, R - L), max = Math.floor((y - 330) / 19);
  lines.slice(0, max).forEach((ln) => { d.text(ln, { x: R, y, size: 12 }); y -= 19; });
  if (lines.length > max) d.text('… (النص كاملاً في النظام)', { x: R, y, size: 10, color: MUTE });
  // سجل الاعتماد
  d.fill(G); d.rect(L - 10, 312, R - L + 20, 20); d.text('سجل الاعتماد', { x: R, y: 318, size: 11.5, font: 'bold', color: '#FFFFFF' });
  let ay = 296;
  for (const a of v.approvers.slice(0, 6)) {
    d.text(fit(`${a.seq}. ${a.name}${a.unit ? ' — ' + a.unit : ''}`, 'regular', 10.5, 300), { x: R, y: ay, size: 10.5 });
    d.text(`${STATE[a.state] ?? a.state}${a.at ? ' · ' + utc(a.at) : ''}`, { x: 235, y: ay, size: 10, color: a.state === 'approved' ? G : MUTE });
    ay -= 17;
  }
  if (v.cc.length) d.text(fit(`نسخة إلى: ${v.cc.map((c) => c.name).join('، ')}`, 'regular', 9.5, R - L), { x: R, y: Math.min(ay, 196) - 4, size: 9.5, color: MUTE });
  d.fill(G); d.rect(L - 10, 150, R - L + 20, 20); d.text('التوقيع الرقمي', { x: R, y: 156, size: 11.5, font: 'bold', color: '#FFFFFF' });
  d.text('بصمة المحتوى', { x: R, y: 130, size: 9.5, color: MUTE }); d.text(hash.slice(0, 32), { x: R - 100, y: 130, size: 8.5 }); d.text(hash.slice(32), { x: R - 100, y: 118, size: 8.5 });
  d.text('وقت التوقيع', { x: R, y: 98, size: 9.5, color: MUTE }); d.text(utc(signedAt), { x: R - 100, y: 98, size: 10.5, font: 'bold' });
  d.text('الموقِّع (X.509)', { x: R, y: 78, size: 9.5, color: MUTE }); d.text(cn, { x: R - 100, y: 78, size: 10, font: 'bold' });
  d.stroke(GOLD); d.line(L - 10, 50, R + 10, 50, 1);
  d.text('وثيقة إلكترونية موقَّعة رقمياً. أي تعديل على الملف يُبطل توقيعه.', { x: R + 10, y: 34, size: 8, color: MUTE });
}

export function corrPdf(deps, user, id) {
  const { db, cfg } = deps, d = db.prepare('SELECT * FROM corr_docs WHERE id = ?').get(Number(id));
  if (!d || !canSee(user, db, d)) throw new HttpError(404, 'المستند غير موجود.', 'not_found');
  if (d.status !== 'approved') throw new HttpError(409, 'يتوفر ملف PDF للمستند المعتمد فقط.', 'conflict');
  const dir = path.join(cfg.uploadDir, 'corr'), file = path.join(dir, `${d.no}.pdf`), filename = `${d.no}.pdf`;
  try { return { pdf: fs.readFileSync(file), filename }; } catch { /* لم يُنشأ بعد */ }
  const v = docView(db, d, user), created = new Date(d.decided_at ?? Date.now());
  const hash = crypto.createHash('sha256').update(JSON.stringify([v.no, v.outNo, v.title, v.subject, v.body, v.approvers.map((a) => [a.id, a.state, a.at])])).digest('hex');
  const ident = identityOf(cfg), cn = ident.leaf.subject.match(/CN=([^,]+)/)?.[1] ?? 'signer';
  const raw = buildPdf({ family: 'dejavu', title: v.title, author: 'الجامعة السورية للعلوم الأمنية', subject: `${v.no} ${v.outNo || ''}`, producer: 'الجامعة السورية للعلوم الأمنية', created, signer: { name: cn, reason: 'Approved correspondence', location: 'SY' } }, (p) => paint(p, v, hash, cn, created, headerLines(db)));
  const prep = prepareSigning(raw), { cms } = signDetached(ident, prep.digest, { signingTime: created }), pdf = prep.finish(cms);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, pdf);
  return { pdf, filename };
}

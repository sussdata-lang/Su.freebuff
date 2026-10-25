// تهيئة الهيكل التنظيمي: الإدارات والوحدات والمكاتب + أدوار المسؤوليات + حساب مسؤول لكل جهة + روابط الإحالة.
// آمن للتكرار ولا يمسّ ما عدّله المدير ولا حساباً موجوداً.
//   npm run structure                          ينشئ الحسابات معطّلة (يفعّلها المدير من «الحسابات والصلاحيات» مع كلمة مؤقتة)
//   STRUCTURE_ACTIVATE=1 npm run structure     يفعّل الحسابات الهيكلية التي لم تُستخدم بعد بكلمة SEED_PASSWORD
//                                              وتُلزَم بتغييرها عند أول دخول
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { seedPassword } from '../server/services/bootstrap.js';
import { ensureStructure, STRUCTURE } from '../server/services/structure.js';
import { ensureForms, FORMS } from '../server/services/forms/index.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const activate = process.env.STRUCTURE_ACTIVATE === '1';
const r = await ensureStructure({ db, cfg }, { activate, password: activate ? seedPassword() : undefined });
console.log(`الهيكل التنظيمي (${STRUCTURE.length} جهة): وحدات جديدة ${r.units} · أدوار ${r.roles} · حسابات ${r.accounts} · روابط ${r.links}${activate ? ` · مفعّلة ${r.activated}` : ''}`);
const f = ensureForms({ db });
console.log(`نماذج الطلبات (${FORMS.length} نموذجاً): جديدة ${f.created} · قائمة ${f.existing} · منسوبة لوحداتها ${f.adopted}`);
if (!activate) console.log('الحسابات الجديدة معطّلة. لتفعيلها: STRUCTURE_ACTIVATE=1 npm run structure (أو من شاشة الحسابات والصلاحيات).');

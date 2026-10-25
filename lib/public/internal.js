/* طلبات الموظفين الداخلية (نماذج الإدارات) + تبويب «طلبات Excel» في الاستيراد والتصدير */
(function () {
  const UA = window.UA, { S, api, esc, fmt, toast, can } = UA;
  const fresh = () => ({ list: null, svcs: null, k: null, vals: {}, files: {}, err: '', busy: false, open: null, ex: { code: '', res: null, busy: false, file: null, b64: null } });
  const B = fresh();
  const prevReset = UA.reset; UA.reset = () => { if (prevReset) prevReset(); Object.assign(B, fresh()); };
  const $id = (i) => document.getElementById(i);
  const ST = { review: 'قيد المراجعة', approved: 'مقبول', rejected: 'مرفوض' };
  const slotsOf = (s) => (s.attachments && s.attachments.length ? s.attachments : (s.requiresAttachment ? [{ label: 'المرفق', required: true }] : []));
  const svc = () => (B.svcs || []).find((s) => s.code === B.k);

  function field(f, v) {
    const id = 'in-' + f.name, req = f.required ? ' required' : '', cur = v ?? '';
    let c;
    if (f.type === 'select') c = `<select id="${id}"${req}><option value="">— اختر —</option>${f.options.map((o) => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (f.type === 'textarea') c = `<textarea id="${id}" rows="3" maxlength="1000"${req}>${esc(cur)}</textarea>`;
    else if (f.type === 'number' || f.type === 'decimal') c = `<input id="${id}" type="number" step="${f.type === 'number' ? 1 : 0.01}" min="${f.min ?? 0}" max="${f.max ?? ''}" value="${esc(cur)}"${req}>`;
    else if (f.type === 'date') c = `<input id="${id}" type="date" value="${esc(cur)}"${req}>`;
    else c = `<input id="${id}" maxlength="200" value="${esc(cur)}"${req}>`;
    return `<label>${esc(f.label)}${f.required ? ' <i class="req-m">*</i>' : ''}${f.hint ? `<span class="small" style="display:block">${esc(f.hint)}</span>` : ''}${c}</label>`;
  }
  function form() {
    const s = svc();
    if (!s) {
      const groups = {};
      for (const x of B.svcs || []) (groups[x.category || (x.unit && x.unit.name) || 'عام'] ||= []).push(x);
      return `<section class="card"><h2>طلب جديد</h2><p class="hint">اختر النموذج المناسب؛ يُسند تلقائياً إلى الجهة المختصة.</p>
        ${Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0], 'ar')).map(([g, l]) => `<details ${Object.keys(groups).length < 4 ? 'open' : ''}><summary><b>${esc(g)}</b> <span class="small">(${l.length})</span></summary>${l.map((x) => `<div style="padding:6px 0;border-bottom:1px solid var(--line,#ddd)"><button class="btn sm" data-act="inpick" data-k="${esc(x.code)}">${esc(x.label)}</button> <span class="small">${esc(x.unit ? x.unit.name : '')} — ${esc(x.description)}</span></div>`).join('')}</details>`).join('') || '<p class="hint">لا نماذج متاحة لك.</p>'}</section>`;
    }
    return `<section class="card"><h2>${esc(s.label)}</h2><p class="hint">${esc(s.description)}${s.unit ? ' — الجهة: ' + esc(s.unit.name) : ''}</p>
      ${s.instructions ? `<div class="hint" style="white-space:pre-line">${esc(s.instructions)}</div>` : ''}
      <form id="inform" class="inline-form" style="display:grid;gap:10px">${s.fields.filter((f) => f.type !== 'ref').map((f) => field(f, B.vals[f.name])).join('')}
        ${slotsOf(s).map((sl, i) => `<label>${esc(sl.label)}${sl.required ? ' <i class="req-m">*</i>' : ' (اختياري)'}<input id="in-file-${i}" type="file" accept=".pdf,.png,.jpg,.jpeg"${sl.required && !B.files[i] ? ' required' : ''}>${B.files[i] ? `<span class="small">${esc(B.files[i].name)}</span>` : ''}</label>`).join('')}
        ${B.err ? `<div class="err" role="alert">${esc(B.err)}</div>` : ''}
        <div><button class="btn pri" type="submit"${B.busy ? ' disabled' : ''}>تقديم الطلب</button> <button class="btn" type="button" data-act="incancel">رجوع</button> <a class="btn" href="/api/services/${encodeURIComponent(s.code)}/template.xlsx" download>قالب Excel لهذا النموذج</a></div></form></section>`;
  }
  function mine() {
    const rows = (B.list || []).map((r) => `<tr><td class="mono">${esc(r.no)}</td><td>${esc(r.service.label)}</td><td>${esc(r.unit ? r.unit.name : '—')}</td><td><span class="pill p-${r.status}">${ST[r.status]}</span></td><td>${fmt(r.createdAt)}</td>
      <td><button class="btn sm" data-act="inopen" data-id="${r.id}">${B.open === r.id ? 'إخفاء' : 'تفاصيل'}</button></td></tr>${B.open === r.id ? `<tr><td colspan="6">${detail(r)}</td></tr>` : ''}`).join('');
    return `<section class="card"><h2>طلباتي</h2><div class="tbl-wrap"><table><thead><tr><th>الرقم</th><th>النموذج</th><th>الجهة</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="hint">لا طلبات بعد.</td></tr>'}</tbody></table></div></section>`;
  }
  const detail = (r) => `<dl class="kv">${Object.entries(r.details).map(([k, v]) => { const f = ((B.svcs || []).find((s) => s.code === r.service.code) || { fields: [] }).fields.find((x) => x.name === k); return `<dt>${esc(f ? f.label : k)}</dt><dd>${esc(v)}</dd>`; }).join('')}
    ${r.rejectReason ? `<dt>سبب الرفض</dt><dd>${esc(r.rejectReason)}</dd>` : ''}${r.attachments.map((a) => `<dt>مرفق</dt><dd><a href="/api/attachments/${a.id}" download>${esc(a.name)}</a></dd>`).join('')}</dl>
    <ol class="small">${r.events.map((e) => `<li>${esc(e.text)} — ${esc(e.actor)} (${fmt(e.at)})</li>`).join('')}</ol>`;

  UA.views.internal = () => `${form()}${B.k ? '' : mine()}`;
  UA.loaders.internal = async () => {
    const [s, r] = await Promise.all([api('GET', '/api/services'), api('GET', '/api/requests')]);
    B.svcs = s.services; B.list = r.requests.filter((x) => x.student && x.student.id === S.me.id);
  };
  const A = UA.actions;
  A.inpick = (el, d) => { B.k = d.k; B.vals = {}; B.files = {}; B.err = ''; UA.render(); window.scrollTo(0, 0); };
  A.incancel = () => { B.k = null; B.err = ''; UA.render(); };
  A.inopen = (el, d) => { B.open = B.open === Number(d.id) ? null : Number(d.id); UA.render(); };
  UA.forms.inform = async () => {
    const s = svc(); if (!s || B.busy) return;
    s.fields.forEach((f) => { const e = $id('in-' + f.name); if (e) B.vals[f.name] = e.value; });
    slotsOf(s).forEach((_, i) => { const e = $id('in-file-' + i); if (e && e.files[0]) B.files[i] = e.files[0]; });
    B.busy = true; B.err = '';
    try {
      const details = {}; s.fields.forEach((f) => { const v = B.vals[f.name]; if (v !== undefined && v !== '') details[f.name] = f.type === 'number' ? Number(v) : v; });
      const sl = slotsOf(s), attachments = [];
      for (const [i, f] of Object.entries(B.files)) attachments.push({ name: f.name, data: await UA.readFile(f), slot: sl[i] && sl[i].label });
      const r = await api('POST', '/api/requests', { service: s.code, details, attachments });
      B.k = null; B.vals = {}; B.files = {}; await UA.loaders.internal(); UA.render(); toast('قُدّم الطلب برقم ' + r.request.no);
    } catch (e) { if (!e.status) throw e; B.err = e.message; } finally { B.busy = false; }
    if (B.err) UA.render();
  };

  /* ---------- طلبات Excel: قالب فارغ، تصدير، استيراد دفعة ---------- */
  UA.views.reqx = () => {
    const x = B.ex, list = B.xsvcs || [], r = x.res;
    const opts = list.map((s) => `<option value="${esc(s.code)}"${x.code === s.code ? ' selected' : ''}>${esc(s.label)}${s.unit ? ' — ' + esc(s.unit.name) : ''}</option>`).join('');
    const out = r ? `<div class="imp-sum"><div class="stat"><small>صفوف الملف</small><b>${r.total}</b></div><div class="stat"><small>${r.committed ? 'قُدِّم' : 'صالحة'}</small><b>${r.committed ? r.created : r.valid}</b></div><div class="stat"><small>مرفوضة</small><b>${r.errorCount}</b></div></div>
      ${r.committed ? `<p class="ok-t">اكتمل الاستيراد${r.rejectedAuto ? ` (${r.rejectedAuto} رُفضت آلياً وفق القواعد)` : ''}.</p>` : '<p class="hint">فحص فقط: لم يُحفظ شيء بعد.</p>'}
      ${r.errorCount ? `<div class="tbl-wrap" style="max-height:240px;overflow:auto"><table><thead><tr><th>الصف</th><th>السبب</th></tr></thead><tbody>${r.errors.map((e) => `<tr><td>${e.row}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${!r.committed && r.valid ? `<div class="actions"><button class="btn pri" data-act="xgo"${x.busy ? ' disabled' : ''}>اعتماد وتقديم ${r.valid} طلباً</button></div>` : ''}` : '';
    return `<section class="card"><h2>طلبات بصيغة Excel</h2><p class="hint">لكل نموذج قالب فارغ بتعليماته وقوائمه المنسدلة، ويمكن تصدير الطلبات المقدَّمة ضمن صلاحيتك، واستيراد دفعة طلبات من القالب.</p>
      <label>النموذج<select id="rx-svc"><option value="">— اختر —</option>${opts}</select></label>
      <div class="actions" style="margin-top:10px"><button class="btn" data-act="xtpl">تنزيل القالب الفارغ</button> <button class="btn" data-act="xexp">تصدير طلبات هذا النموذج</button> <button class="btn" data-act="xexpall">تصدير كل الطلبات</button></div>
      <div class="inline-form" style="margin-top:8px"><label>من تاريخ<input id="rx-from" type="date"></label><label>إلى تاريخ<input id="rx-to" type="date"></label><label>الحالة<select id="rx-st"><option value="">الكل</option><option value="review">قيد المراجعة</option><option value="approved">مقبول</option><option value="rejected">مرفوض</option></select></label></div></section>
      ${can('request:import') ? `<section class="card"><h3 style="margin:0 0 6px">استيراد دفعة طلبات</h3><p class="hint">الخدمات التي تتطلب مرفقات تُقدَّم من الواجهة. حتى 500 صف في الملف.</p>
        <input id="rx-file" type="file" accept=".xlsx"> <button class="btn pri" data-act="xprev"${x.busy ? ' disabled' : ''}>فحص الملف</button>${out}</section>` : ''}`;
  };
  UA.loaders.reqx = async () => { B.xsvcs = (await api('GET', '/api/services?all=1')).services; };
  const pick = () => { const e = $id('rx-svc'); if (e) B.ex.code = e.value; return B.ex.code; };
  const go = (u) => { const a = document.createElement('a'); a.href = u; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); };
  const q = () => { const p = new URLSearchParams(); for (const [k, id] of [['from', 'rx-from'], ['to', 'rx-to'], ['status', 'rx-st']]) { const v = $id(id) && $id(id).value; if (v) p.set(k, v); } return p; };
  A.xtpl = () => { const c = pick(); if (!c) return toast('اختر النموذج أولاً'); go(`/api/services/${encodeURIComponent(c)}/template.xlsx`); };
  A.xexp = () => { const c = pick(); if (!c) return toast('اختر النموذج أولاً'); const p = q(); p.set('service', c); go('/api/requests/export.xlsx?' + p); };
  A.xexpall = () => go('/api/requests/export.xlsx?' + q());
  const run = async (commit) => {
    const c = pick(), x = B.ex; if (!c) return toast('اختر النموذج أولاً');
    const f = $id('rx-file') && $id('rx-file').files[0]; if (f) { x.file = f; x.b64 = await UA.readFile(f); }
    if (!x.b64) return toast('اختر ملف Excel أولاً');
    x.busy = true; UA.render();
    try { x.res = await api('POST', `/api/services/${encodeURIComponent(c)}/import`, { filename: x.file ? x.file.name : 'requests.xlsx', data: x.b64, commit }); }
    catch (e) { if (!e.status) throw e; x.res = null; toast(e.message); } finally { x.busy = false; }
    UA.render();
  };
  A.xprev = () => run(false);
  A.xgo = () => run(true);
})();

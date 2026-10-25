/* المراسلات الداخلية: وارد وصادر، إنشاء مستند بمسار اعتماد، اعتماد/رفض، تعليقات، إشعارات */
(function () {
  const UA = window.UA, { S, api, esc, fmt, toast, can } = UA;
  const fresh = () => ({ tab: 'in', filter: 'all', docs: null, sel: null, doc: null, people: null, tpls: null, tedit: null, notifs: { items: [], unread: 0 }, form: null, err: '', busy: false });
  const B = fresh();
  const prevReset = UA.reset; UA.reset = () => { if (prevReset) prevReset(); Object.assign(B, fresh()); };
  const $id = (i) => document.getElementById(i);
  const ST = { draft: 'مسودة', pending: 'قيد الاعتماد', approved: 'معتمد', rejected: 'مرفوض', cancelled: 'ملغى' };
  const CLS = { draft: 'p-review', pending: 'p-review', approved: 'p-approved', rejected: 'p-rejected', cancelled: 'p-rejected' };
  const AST = { pending: 'بانتظار', approved: 'اعتمد', rejected: 'رفض' };
  const pill = (s) => `<span class="pill ${CLS[s]}">${ST[s]}</span>`;
  const tabs = () => [['in', 'الوارد'], ['out', 'الصادر'], ...(can('corr:read_all') ? [['all', 'كل المراسلات']] : []), ...(can('corr:use') ? [['new', 'مستند جديد']] : []), ...(can('corr:templates') ? [['tpl', 'القوالب']] : []), ['notifs', 'الإشعارات']];

  async function loadList() {
    if (B.tab === 'new' || B.tab === 'notifs' || B.tab === 'tpl') return;
    const q = new URLSearchParams({ box: B.tab }); if (B.filter !== 'all') q.set('status', B.filter);
    B.docs = (await api('GET', '/api/corr?' + q)).docs;
  }
  async function loadNotifs() { B.notifs = await api('GET', '/api/corr/notifications'); }
  UA.loaders.corr = async () => { if (!can('corr:use') && B.tab !== 'all') B.tab = can('corr:read_all') ? 'all' : 'notifs'; await Promise.all([loadNotifs(), loadList(), B.doc ? open(B.doc.id, true) : null]); };
  async function open(id, silent) { try { B.doc = (await api('GET', `/api/corr/${id}`)).doc; B.err = ''; } catch (e) { if (!e.status) throw e; B.doc = null; if (!silent) toast(e.message); } }

  function list() {
    const rows = (B.docs || []).map((d) => {
      const done = d.approvers.filter((a) => a.state === 'approved').length;
      return `<tr class="row" tabindex="0" data-act="cropen" data-id="${d.id}"><td class="mono">${esc(d.no)}</td><td><b>${esc(d.title)}</b><div class="small">${esc(d.subject)}</div></td><td>${esc(B.tab === 'out' ? d.approvers.map((a) => a.name).join('، ') : d.creator.name)}<div class="small">${esc(B.tab === 'out' ? '' : d.creator.unit || '')}</div></td><td>${pill(d.status)}${d.mine.myTurn ? ' <span class="pill p-review">دورك</span>' : ''}</td><td>${done}/${d.approvers.length}</td><td>${fmt(d.createdAt)}</td></tr>`;
    }).join('');
    const chips = ['all', 'pending', 'approved', 'rejected', ...(B.tab === 'out' ? ['draft', 'cancelled'] : [])].map((k) => `<button class="chip" data-act="crfilter" data-k="${k}" aria-pressed="${B.filter === k}">${k === 'all' ? 'الكل' : ST[k]}</button>`).join('');
    return `<section class="card"><div class="sub-tabs no-print">${chips}</div><div class="tbl-wrap"><table><thead><tr><th>الرقم</th><th>المستند</th><th>${B.tab === 'out' ? 'المعتمدون' : 'المنشئ'}</th><th>الحالة</th><th>الاعتماد</th><th>التاريخ</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="hint">لا مستندات.</td></tr>'}</tbody></table></div></section>`;
  }

  function detail() {
    const d = B.doc; if (!d) return '';
    const m = d.mine;
    const appr = d.approvers.map((a) => `<li><b>${esc(a.name)}</b> <span class="small">${esc(a.unit || '')}</span> — <span class="pill ${a.state === 'approved' ? 'p-approved' : a.state === 'rejected' ? 'p-rejected' : 'p-review'}">${AST[a.state]}${a.turn && d.status === 'pending' ? ' (دوره الآن)' : ''}</span>${a.at ? ` <span class="small">${fmt(a.at)}</span>` : ''}${a.note ? `<div class="small">${esc(a.note)}</div>` : ''}</li>`).join('');
    const actions = [];
    if (m.myTurn) actions.push(`<label>ملاحظة (إلزامية عند الرفض)<textarea id="cr-note" rows="2" maxlength="500"></textarea></label><div class="actions"><button class="btn pri" data-act="crapprove">اعتماد</button> <button class="btn" data-act="crreject">رفض</button></div>`);
    if (m.creator && d.status === 'draft') actions.push(`<div class="actions"><button class="btn pri" data-act="crsend">إرسال للاعتماد</button> <button class="btn" data-act="credit">تعديل المسودة</button></div>`);
    if (m.creator && ['draft', 'pending'].includes(d.status)) actions.push(`<div class="actions"><button class="btn" data-act="crcancel">إلغاء المستند</button></div>`);
    return `<section class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h2 style="margin:0">${esc(d.title)}</h2><button class="btn sm" data-act="crclose">إغلاق</button></div>
      <p class="small"><span class="mono">${esc(d.no)}</span> · ${pill(d.status)} · ${d.mode === 'sequential' ? 'اعتماد تسلسلي' : 'اعتماد متوازٍ'}${d.outNo ? ` · <b>صادر ${esc(d.outNo)}</b>` : ''} · من ${esc(d.creator.name)}${d.creator.unit ? ' (' + esc(d.creator.unit) + ')' : ''} · ${fmt(d.createdAt)}</p>
      ${d.subject ? `<p><b>الموضوع:</b> ${esc(d.subject)}</p>` : ''}<div style="white-space:pre-wrap;line-height:1.9;border:1px solid var(--line,#ddd);border-radius:10px;padding:12px;margin:8px 0">${esc(d.body) || '<span class="hint">لا نص.</span>'}</div>
      ${d.files.length ? `<p>${d.files.map((f) => `<span class="file-chip"><a class="btn sm" href="/api/corr/files/${f.id}" download>${esc(f.name)}</a>${/^(application\/pdf|image\/(png|jpeg))$/.test(f.mime) ? ` <a class="btn sm" href="/api/corr/files/${f.id}?inline=1" target="_blank" rel="noopener">معاينة</a>` : ''}</span>`).join(' ')}</p>` : ''}
      ${d.status === 'approved' ? `<p><a class="btn pri" href="/api/corr/${d.id}/pdf" download>تنزيل PDF موقَّع (صادر ${esc(d.outNo || '')})</a></p>` : ''}
      <h3 style="font-size:15px;margin:12px 0 4px">مسار الاعتماد</h3><ol>${appr}</ol>
      ${d.cc.length ? `<p class="small"><b>نسخة إلى:</b> ${d.cc.map((c) => esc(c.name)).join('، ')}</p>` : ''}${m.cc ? '<p class="small hint">وصلتك نسخة للاطلاع فقط.</p>' : ''}
      ${actions.join('')}
      ${d.status !== 'draft' ? `<label style="display:block;margin-top:10px">تعليق<textarea id="cr-comment" rows="2" maxlength="1000"></textarea></label><div class="actions"><button class="btn sm" data-act="crcomment">إضافة تعليق</button></div>` : ''}
      <h3 style="font-size:15px;margin:12px 0 4px">السجل</h3><ol class="small">${d.events.map((e) => `<li>${esc(e.text)} — ${esc(e.actor)} (${fmt(e.at)})</li>`).join('')}</ol></section>`;
  }

  function newForm() {
    const f = B.form ?? (B.form = { title: '', subject: '', body: '', mode: 'parallel', approvers: [], cc: [], files: [], keep: [], remove: [] });
    const people = (B.people || []).filter((p) => !f.approvers.includes(p.id));
    const sel = f.approvers.map((id, i) => { const p = (B.people || []).find((x) => x.id === id); return `<li>${f.mode === 'sequential' ? `<b>${i + 1}.</b> ` : ''}${esc(p ? p.name : id)} <span class="small">${esc(p ? p.unit : '')}</span> <button class="btn sm" type="button" data-act="crup" data-i="${i}" aria-label="أعلى">↑</button> <button class="btn sm" type="button" data-act="crdown" data-i="${i}" aria-label="أسفل">↓</button> <button class="btn sm" type="button" data-act="crrm" data-i="${i}">حذف</button></li>`; }).join('');
    const ccPeople = (B.people || []).filter((p) => !f.cc.includes(p.id) && !f.approvers.includes(p.id));
    const ccSel = f.cc.map((id, i) => { const p = (B.people || []).find((x) => x.id === id); return `<li>${esc(p ? p.name : id)} <span class="small">${esc(p ? p.unit : '')}</span> <button class="btn sm" type="button" data-act="crccrm" data-i="${i}">حذف</button></li>`; }).join('');
    const kept = f.keep.filter((x) => !f.remove.includes(x.id)).map((x) => `<span class="small">${esc(x.name)} <button class="btn sm" type="button" data-act="crfrm" data-id="${x.id}">إزالة</button></span>`).join(' ');
    return `<section class="card"><h2>${f.editId ? 'تعديل المسودة' : 'مستند جديد'}</h2><form id="crform" style="display:grid;gap:10px">
      ${(B.tpls || []).length ? `<label>القالب (اختياري — يملأ الحقول ويمكنك تعديلها)<select id="cf-tpl"><option value="">— بلا قالب —</option>${[...new Set(B.tpls.map((t) => t.category))].map((g) => `<optgroup label="${esc(g)}">${B.tpls.filter((t) => t.category === g).map((t) => `<option value="${esc(t.code)}">${esc(t.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>` : ''}
      <label>العنوان *<input id="cf-title" maxlength="120" value="${esc(f.title)}" required></label>
      <label>الموضوع<input id="cf-subject" maxlength="200" value="${esc(f.subject)}"></label>
      <label>النص<textarea id="cf-body" rows="8" maxlength="8000">${esc(f.body)}</textarea></label>
      <label>نوع الاعتماد<select id="cf-mode"><option value="parallel"${f.mode === 'parallel' ? ' selected' : ''}>متوازٍ (الجميع في وقت واحد)</option><option value="sequential"${f.mode === 'sequential' ? ' selected' : ''}>تسلسلي (واحداً بعد الآخر بالترتيب)</option></select></label>
      <div><b>المعتمدون *</b><ol>${sel || '<li class="hint">لم يُختر أحد.</li>'}</ol>
        <select id="cf-person" aria-label="إضافة معتمد"><option value="">— اختر شخصاً —</option>${people.map((p) => `<option value="${p.id}">${esc(p.name)}${p.unit ? ' — ' + esc(p.unit) : ''}</option>`).join('')}</select> <button class="btn sm" type="button" data-act="cradd">إضافة</button></div>
      <div><b>نسخة إلى (للاطلاع فقط)</b><ul>${ccSel || '<li class="hint">لا أحد.</li>'}</ul>
        <select id="cf-cc" aria-label="إضافة مستلم نسخة"><option value="">— اختر شخصاً —</option>${ccPeople.map((p) => `<option value="${p.id}">${esc(p.name)}${p.unit ? ' — ' + esc(p.unit) : ''}</option>`).join('')}</select> <button class="btn sm" type="button" data-act="crccadd">إضافة</button></div>
      ${kept ? `<div>المرفقات الحالية: ${kept}</div>` : ''}
      <label>مرفقات (PDF أو صور، حتى 5)<input id="cf-files" type="file" multiple accept=".pdf,.png,.jpg,.jpeg">${f.files.length ? `<span class="small">${f.files.map((x) => esc(x.name)).join('، ')}</span>` : ''}</label>
      ${B.err ? `<div class="err" role="alert">${esc(B.err)}</div>` : ''}
      <div><button class="btn pri" type="submit"${B.busy ? ' disabled' : ''}>إرسال للاعتماد</button> <button class="btn" type="button" data-act="crdraft">حفظ كمسودة</button>${f.editId ? ' <button class="btn" type="button" data-act="crcanceledit">تراجع</button>' : ''}</div></form></section>`;
  }
  const fill = (s) => String(s || '').replaceAll('{{date}}', new Intl.DateTimeFormat('ar-SY', { dateStyle: 'long', timeZone: 'Asia/Damascus' }).format(new Date())).replaceAll('{{unit}}', (S.me.unit && S.me.unit.name) || '').replaceAll('{{name}}', S.me.name || '');
  const readForm = () => { const f = B.form; if (!f || !$id('cf-title')) return; f.title = $id('cf-title').value; f.subject = $id('cf-subject').value; f.body = $id('cf-body').value; f.mode = $id('cf-mode').value; const fi = $id('cf-files'); if (fi && fi.files.length) f.files = [...fi.files]; };

  function notifs() {
    const n = B.notifs;
    return `<section class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">الإشعارات</h2>${n.unread ? '<button class="btn sm" data-act="crreadall">تعليم الكل كمقروء</button>' : ''}</div>
      <ul style="list-style:none;padding:0">${n.items.map((i) => `<li style="padding:10px 0;border-bottom:1px solid var(--line,#e4e9e7);${i.read ? 'opacity:.65' : 'font-weight:600'}"><button class="link" data-act="cropen" data-id="${i.docId}" data-n="${i.id}">${esc(i.text)}</button> <span class="small">${fmt(i.at)}</span></li>`).join('') || '<li class="hint">لا إشعارات.</li>'}</ul></section>`;
  }

  function tplTab() {
    const e = B.tedit;
    const rows = (B.tpls || []).map((t) => `<tr><td><b>${esc(t.name)}</b> <span class="mono small">${esc(t.code)}</span></td><td>${esc(t.category)}</td><td>${t.mode === 'sequential' ? 'تسلسلي' : 'متوازٍ'}</td><td>${t.builtin ? 'أساسي' : 'مخصّص'}</td><td>${t.active ? '<span class="ok-t">فعّال</span>' : '<span class="bad-t">معطّل</span>'}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-act="ctedit" data-c="${esc(t.code)}">تعديل</button> <button class="btn sm" data-act="cttoggle" data-c="${esc(t.code)}" data-on="${t.active ? 0 : 1}">${t.active ? 'تعطيل' : 'تفعيل'}</button>${t.builtin ? '' : ` <button class="btn sm" data-act="ctdel" data-c="${esc(t.code)}">حذف</button>`}</td></tr>`).join('');
    const form = e ? `<section class="card"><h2>${e.isNew ? 'قالب جديد' : 'تعديل: ' + esc(e.name)}</h2><form id="ctform" style="display:grid;gap:10px">
      <div class="inline-form"><label>الرمز (لاتيني)<input id="ct-code" class="mono" dir="ltr" maxlength="30" value="${esc(e.code)}"${e.isNew ? '' : ' disabled'} required></label><label>اسم القالب<input id="ct-name" maxlength="80" value="${esc(e.name)}" required></label><label>الفئة<input id="ct-cat" maxlength="60" value="${esc(e.category)}"></label>
      <label>نوع الاعتماد<select id="ct-mode"><option value="parallel"${e.mode === 'parallel' ? ' selected' : ''}>متوازٍ</option><option value="sequential"${e.mode === 'sequential' ? ' selected' : ''}>تسلسلي</option></select></label></div>
      <label>عنوان المستند<input id="ct-title" maxlength="120" value="${esc(e.title)}" required></label><label>الموضوع<input id="ct-subject" maxlength="200" value="${esc(e.subject)}"></label>
      <label>النص <span class="small">(العناصر البديلة: {{date}} التاريخ، {{unit}} وحدة المنشئ، {{name}} اسمه)</span><textarea id="ct-body" rows="10" maxlength="8000" required>${esc(e.body)}</textarea></label>
      ${B.err ? `<div class="err" role="alert">${esc(B.err)}</div>` : ''}<div><button class="btn pri" type="submit">حفظ</button> <button class="btn" type="button" data-act="ctcancel">إلغاء</button></div></form></section>` : '';
    return `${form}<section class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">قوالب المراسلات</h2><button class="btn pri" data-act="ctnew">قالب جديد</button></div>
      <div class="tbl-wrap"><table><thead><tr><th>القالب</th><th>الفئة</th><th>الاعتماد</th><th>النوع</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }
  UA.views.corr = () => {
    const t = tabs();
    const bar = `<div class="sub-tabs no-print" role="tablist">${t.map((x) => `<button class="chip" role="tab" data-act="crtab" data-t="${x[0]}" aria-pressed="${B.tab === x[0]}">${x[1]}${x[0] === 'notifs' && B.notifs.unread ? ` <span class="badge-n">${B.notifs.unread}</span>` : ''}</button>`).join('')}</div>`;
    return `${bar}${B.doc ? detail() : ''}${B.tab === 'new' ? newForm() : B.tab === 'notifs' ? notifs() : B.tab === 'tpl' ? tplTab() : list()}`;
  };

  const A = UA.actions;
  const refresh = async () => { await Promise.all([loadNotifs(), loadList(), B.doc ? open(B.doc.id, true) : null]); UA.render(); };
  const loadTpls = async () => { B.tpls = (await api('GET', '/api/corr/templates' + (B.tab === 'tpl' ? '?all=1' : ''))).templates; };
  A.crtab = async (el, d) => { readForm(); B.tab = d.t; B.doc = null; B.err = ''; B.tedit = null; if (d.t === 'new' && !B.people) B.people = (await api('GET', '/api/corr/people')).people; if (d.t === 'new' || d.t === 'tpl') await loadTpls(); await refresh(); };
  const blank = () => ({ isNew: true, code: '', name: '', category: 'عام', title: '', subject: '', body: '', mode: 'parallel' });
  A.ctnew = () => { B.tedit = blank(); B.err = ''; UA.render(); window.scrollTo(0, 0); };
  A.ctedit = (el, d) => { const t = B.tpls.find((x) => x.code === d.c); if (t) { B.tedit = { ...t, isNew: false }; B.err = ''; UA.render(); window.scrollTo(0, 0); } };
  A.ctcancel = () => { B.tedit = null; B.err = ''; UA.render(); };
  A.cttoggle = async (el, d) => { try { await api('PUT', `/api/corr/templates/${d.c}`, { active: d.on === '1' }); await loadTpls(); UA.render(); } catch (e) { if (!e.status) throw e; toast(e.message); } };
  A.ctdel = async (el, d) => { if (!confirm('حذف هذا القالب نهائياً؟')) return; try { await api('DELETE', `/api/corr/templates/${d.c}`); await loadTpls(); UA.render(); toast('حُذف القالب'); } catch (e) { if (!e.status) throw e; toast(e.message); } };
  UA.forms.ctform = async () => {
    const e = B.tedit, v = (i) => $id(i).value, body = { name: v('ct-name'), category: v('ct-cat'), mode: v('ct-mode'), title: v('ct-title'), subject: v('ct-subject'), body: v('ct-body') };
    try { if (e.isNew) await api('POST', '/api/corr/templates', { ...body, code: v('ct-code').trim() }); else await api('PUT', `/api/corr/templates/${e.code}`, body); B.tedit = null; B.err = ''; await loadTpls(); UA.render(); toast('حُفظ القالب'); }
    catch (x) { if (!x.status) throw x; B.err = x.message; UA.render(); }
  };
  document.addEventListener('change', (e) => {
    if (e.target.id !== 'cf-tpl' || !B.form) return;
    const t = (B.tpls || []).find((x) => x.code === e.target.value); if (!t) return;
    readForm(); Object.assign(B.form, { title: fill(t.title), subject: fill(t.subject), body: fill(t.body), mode: t.mode }); UA.render();
  });
  A.crfilter = async (el, d) => { B.filter = d.k; await loadList(); UA.render(); };
  A.cropen = async (el, d) => { if (d.n) await api('POST', '/api/corr/notifications/read', { ids: [Number(d.n)] }); await open(Number(d.id)); if (B.tab === 'notifs') B.tab = 'in'; await refresh(); window.scrollTo(0, 0); };
  A.crclose = () => { B.doc = null; UA.render(); };
  A.crreadall = async () => { await api('POST', '/api/corr/notifications/read', { all: true }); await refresh(); };
  const act = (path, body, msg) => async () => { try { B.doc = (await api('POST', `/api/corr/${B.doc.id}/${path}`, body ? body() : {})).doc; await refresh(); toast(msg); } catch (e) { if (!e.status) throw e; toast(e.message); } };
  A.crapprove = (el, d, e) => act('approve', () => ({ note: $id('cr-note').value }), 'تم الاعتماد')();
  A.crreject = (el, d, e) => act('reject', () => ({ note: $id('cr-note').value }), 'تم الرفض')();
  A.crcomment = (el, d, e) => act('comment', () => ({ text: $id('cr-comment').value }), 'أُضيف التعليق')();
  A.crsend = act('send', null, 'أُرسل المستند');
  A.crcancel = act('cancel', null, 'أُلغي المستند');
  A.cradd = () => { readForm(); const v = Number($id('cf-person').value); if (v) B.form.approvers.push(v); UA.render(); };
  A.crccadd = () => { readForm(); const v = Number($id('cf-cc').value); if (v) B.form.cc.push(v); UA.render(); };
  A.crccrm = (el, d) => { readForm(); B.form.cc.splice(Number(d.i), 1); UA.render(); };
  A.crfrm = (el, d) => { readForm(); B.form.remove.push(Number(d.id)); UA.render(); };
  A.credit = async () => {
    const d = B.doc; if (!d) return; if (!B.people) B.people = (await api('GET', '/api/corr/people')).people; await loadTpls();
    B.form = { editId: d.id, title: d.title, subject: d.subject || '', body: d.body || '', mode: d.mode, approvers: d.approvers.map((a) => a.id), cc: d.cc.map((c) => c.id), files: [], keep: d.files.map((f) => ({ id: f.id, name: f.name })), remove: [] };
    B.tab = 'new'; B.doc = null; B.err = ''; UA.render(); window.scrollTo(0, 0);
  };
  A.crcanceledit = async () => { const id = B.form && B.form.editId; B.form = null; B.tab = 'out'; await refresh(); if (id) await open(id, true); UA.render(); };
  A.crrm = (el, d) => { readForm(); B.form.approvers.splice(Number(d.i), 1); UA.render(); };
  const mv = (i, k) => { readForm(); const a = B.form.approvers, j = i + k; if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]]; UA.render(); };
  A.crup = (el, d) => mv(Number(d.i), -1); A.crdown = (el, d) => mv(Number(d.i), 1);
  async function submit(send) {
    readForm(); const f = B.form; if (B.busy) return; B.busy = true; B.err = '';
    try {
      const files = []; for (const x of f.files) files.push({ name: x.name, data: await UA.readFile(x) });
      const body = { title: f.title, subject: f.subject, body: f.body, mode: f.mode, approvers: f.approvers, cc: f.cc, files, send };
      const r = f.editId ? await api('PUT', `/api/corr/${f.editId}`, { ...body, removeFiles: f.remove }) : await api('POST', '/api/corr', body);
      B.form = null; B.tab = 'out'; B.doc = r.doc; await refresh(); toast(send ? 'أُرسل المستند ' + r.doc.no : 'حُفظت المسودة ' + r.doc.no);
    } catch (e) { if (!e.status) throw e; B.err = e.message; } finally { B.busy = false; }
    if (B.err) UA.render();
  }
  UA.forms.crform = () => submit(true);
  A.crdraft = () => submit(false);
})();

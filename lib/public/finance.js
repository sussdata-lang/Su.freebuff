/* finance.js — وحدة المالية والمحاسبة (v10) */
'use strict';
(function () {
  if (!window.UA) return;

  /* -------- مساعدات مشتركة -------- */
  const api = window.UA.api ?? (async (m, u, b) => { const r = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined, credentials: 'same-origin' }); if (!r.ok) { const e = await r.json().catch(() => ({})); throw Object.assign(new Error(e.message || r.statusText), { code: e.code, status: r.status }); } return r.status === 204 ? {} : r.json(); });
  const $ = (s, ctx = document) => ctx.querySelector(s);
  const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];
  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, dec = 2) => (Number(n) || 0).toLocaleString('ar-SY', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ar-SY') : '—';
  const fmtTs = (t) => t ? new Date(t).toLocaleString('ar-SY') : '—';
  const badge = (s, map) => `<span class="badge badge-${map[s] ?? 'default'}">${s}</span>`;
  const STD = { draft: 'draft', posted: 'success', open: 'info', void: 'danger', ok: 'success', closed: 'danger' };
  const EL = { JV: 'قيد يومية', RV: 'سند قبض', PV: 'سند صرف', OB: 'قيد افتتاحي', CL: 'قيد إقفال', FE: 'رسوم', PR: 'رواتب' };

  function toast(msg, ok = true) {
    let t = document.getElementById('fin-toast');
    if (!t) { t = document.createElement('div'); t.id = 'fin-toast'; t.style.cssText = 'position:fixed;bottom:1.5rem;left:1.5rem;padding:.7rem 1.2rem;border-radius:8px;color:#fff;font-size:.95rem;z-index:9999;max-width:340px;direction:rtl;'; document.body.appendChild(t); }
    t.style.background = ok ? '#16a34a' : '#dc2626'; t.textContent = msg; t.style.display = 'block';
    clearTimeout(t._t); t._t = setTimeout(() => { t.style.display = 'none'; }, 3500);
  }
  function confirmDlg(msg) { return new Promise((res) => res(confirm(msg))); }

  /* -------- تحميل البيانات الرئيسية -------- */
  let _accounts = [], _costCenters = [], _parties = [], _currencies = [], _years = [], _feeTypes = [], _overview = {};
  async function loadMeta() {
    try {
      [_accounts, _costCenters, _parties, _currencies, _years, _feeTypes, _overview] = await Promise.all([
        api('GET', '/api/finance/accounts').then((d) => d.accounts),
        api('GET', '/api/finance/cost-centers').then((d) => d.costCenters),
        api('GET', '/api/finance/parties').then((d) => d.parties),
        api('GET', '/api/finance/currencies').then((d) => d.currencies),
        api('GET', '/api/finance/years').then((d) => d.years),
        api('GET', '/api/finance/fee-types').then((d) => d.map ? d : d),
        api('GET', '/api/finance/overview'),
      ]);
    } catch (e) { console.warn('finance meta', e.message); }
  }
  const postableAccounts = () => _accounts.filter((a) => a.postable && a.active);
  const accOpts = (sel) => postableAccounts().map((a) => `<option value="${a.id}" ${a.id == sel ? 'selected' : ''}>${escHtml(a.code)} — ${escHtml(a.name)}</option>`).join('');
  const partyOpts = (sel) => _parties.map((p) => `<option value="${p.id}" ${p.id == sel ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('');

  /* ============================================================
     1. لوحة المعلومات
  ============================================================ */
  async function renderOverview(el) {
    el.innerHTML = '<p class="loading">جارٍ التحميل…</p>';
    try {
      const d = await api('GET', '/api/finance/overview');
      el.innerHTML = `
      <div class="fin-kpis">
        <div class="fin-kpi"><span class="fin-kpi-label">الصندوق</span><span class="fin-kpi-val">${fmt(d.cash)}</span></div>
        <div class="fin-kpi"><span class="fin-kpi-label">البنك</span><span class="fin-kpi-val">${fmt(d.bank)}</span></div>
        <div class="fin-kpi"><span class="fin-kpi-label">ذمم الطلاب</span><span class="fin-kpi-val">${fmt(d.receivables)}</span></div>
        <div class="fin-kpi"><span class="fin-kpi-label">ذمم الموردين</span><span class="fin-kpi-val">${fmt(d.payables)}</span></div>
        <div class="fin-kpi"><span class="fin-kpi-label">الإيرادات</span><span class="fin-kpi-val g-ok">${fmt(d.revenue)}</span></div>
        <div class="fin-kpi"><span class="fin-kpi-label">المصروفات</span><span class="fin-kpi-val g-warn">${fmt(d.expense)}</span></div>
        <div class="fin-kpi fin-kpi-wide"><span class="fin-kpi-label">صافي الفائض / العجز</span><span class="fin-kpi-val ${d.surplus >= 0 ? 'g-ok' : 'g-err'}">${fmt(d.surplus)}</span></div>
        ${d.drafts ? `<div class="fin-kpi fin-kpi-warn"><span class="fin-kpi-label">مسودات غير مرحَّلة</span><span class="fin-kpi-val">${d.drafts}</span></div>` : ''}
      </div>
      <h3 class="fin-section-title">آخر القيود المرحَّلة</h3>
      <table class="tbl"><thead><tr><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>البيان</th></tr></thead><tbody>
        ${d.recent.map((e) => `<tr><td>${escHtml(e.no || '—')}</td><td>${e.day}</td><td>${escHtml(EL[e.type] || e.type)}</td><td>${escHtml(e.description)}</td></tr>`).join('')}
      </tbody></table>`;
    } catch (e) { el.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
  }

  /* ============================================================
     2. القيود اليومية
  ============================================================ */
  async function renderEntries(el) {
    el.innerHTML = `
    <div class="fin-toolbar">
      <button class="btn btn-primary" id="fin-new-entry">+ قيد جديد</button>
      <select id="fin-entry-type" class="inp"><option value="">كل الأنواع</option>${Object.entries(EL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select>
      <select id="fin-entry-status" class="inp"><option value="">كل الحالات</option><option value="draft">مسودة</option><option value="posted">مرحَّل</option></select>
      <input id="fin-entry-from" type="date" class="inp" title="من">
      <input id="fin-entry-to" type="date" class="inp" title="إلى">
      <input id="fin-entry-q" type="search" class="inp" placeholder="بحث…">
      <button class="btn" id="fin-entries-search">بحث</button>
    </div>
    <div id="fin-entries-list"></div>`;
    const doSearch = () => loadEntries(el);
    $('#fin-entries-search', el).onclick = doSearch;
    $('#fin-entry-q', el).onkeydown = (e) => e.key === 'Enter' && doSearch();
    $('#fin-new-entry', el).onclick = () => openEntryForm(el);
    loadEntries(el);
  }
  async function loadEntries(el) {
    const list = $('#fin-entries-list', el); list.innerHTML = '<p class="loading">…</p>';
    const q = new URLSearchParams();
    const type = $('#fin-entry-type', el)?.value, status = $('#fin-entry-status', el)?.value;
    const from = $('#fin-entry-from', el)?.value, to = $('#fin-entry-to', el)?.value, qq = $('#fin-entry-q', el)?.value;
    if (type) q.set('type', type); if (status) q.set('status', status);
    if (from) q.set('from', from); if (to) q.set('to', to); if (qq) q.set('q', qq);
    try {
      const { entries, total } = await api('GET', `/api/finance/entries?${q}`);
      list.innerHTML = `<p class="fin-count">النتائج: ${total}</p>
      <table class="tbl"><thead><tr><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>البيان</th><th>المبلغ</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>
      ${entries.map((e) => `<tr>
        <td><a href="#" class="link fin-open-entry" data-id="${e.id}">${escHtml(e.no || '#' + e.id)}</a></td>
        <td>${e.day}</td><td>${escHtml(EL[e.type] || e.type)}</td>
        <td>${escHtml(e.description)}${e.reversed ? ' <em>(معكوس)</em>' : ''}${e.isReversal ? ' <em>(عكس)</em>' : ''}</td>
        <td class="ltr">${fmt(e.total)}</td>
        <td>${badge(e.status, STD)}</td>
        <td>${e.status === 'draft' ? `<button class="btn btn-sm btn-primary fin-post-entry" data-id="${e.id}">ترحيل</button> <button class="btn btn-sm fin-edit-entry" data-id="${e.id}">تعديل</button> <button class="btn btn-sm btn-danger fin-del-entry" data-id="${e.id}">حذف</button>` : (e.reversed ? '' : `<button class="btn btn-sm fin-rev-entry" data-id="${e.id}">عكس</button>`)}
        <button class="btn btn-sm fin-open-entry" data-id="${e.id}">عرض</button></td>
      </tr>`).join('')}
      </tbody></table>`;
      $$('.fin-open-entry', list).forEach((b) => b.onclick = (ev) => { ev.preventDefault(); openEntryDetail(el, b.dataset.id); });
      $$('.fin-post-entry', list).forEach((b) => b.onclick = async () => { try { await api('POST', `/api/finance/entries/${b.dataset.id}/post`); toast('تم الترحيل'); loadEntries(el); } catch (e) { toast(e.message, false); } });
      $$('.fin-del-entry', list).forEach((b) => b.onclick = async () => { if (!await confirmDlg('تأكيد حذف المسودة؟')) return; try { await api('DELETE', `/api/finance/entries/${b.dataset.id}`); toast('تم الحذف'); loadEntries(el); } catch (e) { toast(e.message, false); } });
      $$('.fin-edit-entry', list).forEach((b) => b.onclick = () => openEntryForm(el, b.dataset.id));
      $$('.fin-rev-entry', list).forEach((b) => b.onclick = async () => { const reason = prompt('سبب العكس (اختياري):') ?? ''; try { await api('POST', `/api/finance/entries/${b.dataset.id}/reverse`, { reason }); toast('تم إنشاء قيد العكس'); loadEntries(el); } catch (e) { toast(e.message, false); } });
    } catch (e) { list.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
  }
  async function openEntryDetail(parent, id) {
    try {
      const { entry: e } = await api('GET', `/api/finance/entries/${id}`);
      const dlg = document.createElement('dialog');
      dlg.className = 'fin-dlg'; dlg.innerHTML = `
      <h2>قيد ${escHtml(e.no || '#' + e.id)} — ${escHtml(e.typeLabel)}</h2>
      <p>${e.day} | ${escHtml(e.description)} ${e.reference ? `[${escHtml(e.reference)}]` : ''} | ${badge(e.status, STD)}</p>
      <table class="tbl"><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>البيان</th><th>طرف</th></tr></thead><tbody>
        ${e.lines.map((l) => `<tr><td>${escHtml(l.account)}</td><td class="ltr">${l.debit ? fmt(l.debit) : ''}</td><td class="ltr">${l.credit ? fmt(l.credit) : ''}</td><td>${escHtml(l.note)}</td><td>${escHtml(l.party || '')}</td></tr>`).join('')}
        <tr class="tbl-total"><td><strong>الإجمالي</strong></td><td class="ltr"><strong>${fmt(e.total)}</strong></td><td class="ltr"><strong>${fmt(e.total)}</strong></td><td colspan="2"></td></tr>
      </tbody></table>
      <p class="fin-meta">أنشأه: ${escHtml(e.createdBy || '—')} | رُحِّل بواسطة: ${escHtml(e.postedBy || '—')}</p>
      <div class="dlg-actions"><button class="btn" id="fin-dlg-close">إغلاق</button></div>`;
      document.body.appendChild(dlg); dlg.showModal();
      $('#fin-dlg-close', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    } catch (e) { toast(e.message, false); }
  }
  function openEntryForm(parent, editId = null) {
    const dlg = document.createElement('dialog');
    dlg.className = 'fin-dlg fin-entry-form';
    const linesId = 'fin-lines-' + Date.now();
    dlg.innerHTML = `
    <h2>${editId ? 'تعديل مسودة قيد' : 'قيد يومية جديد'}</h2>
    <form id="fin-entry-frm">
      <div class="form-row">
        <label>التاريخ <input name="day" type="date" class="inp" required value="${new Date().toISOString().slice(0,10)}"></label>
        <label>النوع <select name="type" class="inp"><option value="JV">قيد يومية</option><option value="RV">سند قبض</option><option value="PV">سند صرف</option></select></label>
      </div>
      <label>البيان <input name="description" class="inp full" required placeholder="وصف مختصر للقيد…" maxlength="300"></label>
      <label>المرجع <input name="reference" class="inp full" placeholder="رقم فاتورة أو مستند…" maxlength="60"></label>
      <h3>الأسطر <button type="button" class="btn btn-sm" id="${linesId}-add">+ سطر</button></h3>
      <table class="tbl" id="${linesId}">
        <thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>البيان</th><th>طرف</th><th></th></tr></thead>
        <tbody></tbody>
        <tfoot><tr><td><strong>الإجمالي</strong></td><td id="${linesId}-dr" class="ltr">0</td><td id="${linesId}-cr" class="ltr">0</td><td colspan="3"></td></tr></tfoot>
      </table>
      <div class="dlg-actions">
        <button type="submit" name="act" value="draft" class="btn">حفظ مسودة</button>
        <button type="submit" name="act" value="post" class="btn btn-primary">حفظ وترحيل</button>
        <button type="button" class="btn btn-cancel" id="fin-entry-cancel">إلغاء</button>
      </div>
    </form>`;
    document.body.appendChild(dlg); dlg.showModal();
    const tbody = $(`#${linesId} tbody`, dlg), addLine = $(`#${linesId}-add`, dlg);
    function calcTotals() {
      let dr = 0, cr = 0;
      $$('tr', tbody).forEach((tr) => { dr += Number($('.ldr', tr)?.value) || 0; cr += Number($('.lcr', tr)?.value) || 0; });
      $(`#${linesId}-dr`, dlg).textContent = fmt(dr); $(`#${linesId}-cr`, dlg).textContent = fmt(cr);
    }
    function addLineRow(v = {}) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><select class="inp lacc" required><option value="">— اختر حساباً —</option>${accOpts(v.accountId)}</select></td>
        <td><input class="inp ldr" type="number" min="0" step="0.01" value="${v.debit || ''}" placeholder="0"></td>
        <td><input class="inp lcr" type="number" min="0" step="0.01" value="${v.credit || ''}" placeholder="0"></td>
        <td><input class="inp lnote" type="text" maxlength="200" value="${escHtml(v.note || '')}" placeholder="بيان السطر…"></td>
        <td><select class="inp lparty"><option value="">—</option>${partyOpts(v.partyId)}</select></td>
        <td><button type="button" class="btn btn-sm btn-danger lrem">✕</button></td>`;
      tbody.appendChild(tr);
      $('.lrem', tr).onclick = () => { tr.remove(); calcTotals(); };
      $$('.ldr,.lcr', tr).forEach((i) => i.oninput = calcTotals);
    }
    addLine.onclick = () => addLineRow();
    if (!editId) { addLineRow(); addLineRow(); }
    else {
      api('GET', `/api/finance/entries/${editId}`).then(({ entry: e }) => {
        const frm = $('#fin-entry-frm', dlg);
        frm.elements.day.value = e.day; frm.elements.description.value = e.description; frm.elements.reference.value = e.reference || ''; frm.elements.type.value = e.type;
        e.lines.forEach((l) => addLineRow(l)); calcTotals();
      });
    }
    $('#fin-entry-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#fin-entry-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault();
      const frm = ev.target, act = ev.submitter?.value ?? 'draft';
      const lines = $$('tr', tbody).map((tr) => ({ accountId: Number($('.lacc', tr).value), debit: Number($('.ldr', tr).value) || 0, credit: Number($('.lcr', tr).value) || 0, note: $('.lnote', tr).value, partyId: Number($('.lparty', tr).value) || null }));
      const body = { day: frm.elements.day.value, type: frm.elements.type.value, description: frm.elements.description.value, reference: frm.elements.reference.value, lines, post: act === 'post' };
      try {
        if (editId) await api('PUT', `/api/finance/entries/${editId}`, body);
        else await api('POST', '/api/finance/entries', body);
        toast(act === 'post' ? 'تم إنشاء القيد وترحيله' : 'تم حفظ المسودة');
        dlg.close(); dlg.remove(); loadEntries(parent);
      } catch (e) { toast(e.message, false); }
    };
  }

  /* ============================================================
     3. دليل الحسابات
  ============================================================ */
  async function renderAccounts(el) {
    el.innerHTML = `<div class="fin-toolbar"><button class="btn btn-primary" id="fin-new-acc">+ حساب جديد</button></div><div id="fin-acc-tree"></div>`;
    $('#fin-new-acc', el).onclick = () => openAccountForm(el);
    loadAccounts(el);
  }
  async function loadAccounts(el) {
    const tree = $('#fin-acc-tree', el); tree.innerHTML = '<p class="loading">…</p>';
    try {
      const { accounts } = await api('GET', '/api/finance/accounts');
      _accounts = accounts;
      const byParent = new Map();
      for (const a of accounts) { const pid = a.parentId ?? 'root'; if (!byParent.has(pid)) byParent.set(pid, []); byParent.get(pid).push(a); }
      function renderNode(pid, depth) {
        const children = byParent.get(pid) ?? [];
        return children.map((a) => `
        <tr style="--depth:${depth}" class="acc-row ${!a.active ? 'row-muted' : ''}">
          <td style="padding-right:${depth * 1.2 + 0.5}rem">${escHtml(a.code)}</td>
          <td>${escHtml(a.name)}${a.systemKey ? ' <span class="badge">وظيفي</span>' : ''}</td>
          <td>${escHtml(a.typeLabel)}</td>
          <td>${a.postable ? 'ورقة' : 'تجميعي'}</td>
          <td>
            <button class="btn btn-sm fin-edit-acc" data-id="${a.id}">تعديل</button>
            <button class="btn btn-sm ${a.active ? 'btn-warn' : ''} fin-toggle-acc" data-id="${a.id}" data-active="${a.active ? '1' : '0'}">${a.active ? 'تعطيل' : 'تفعيل'}</button>
            <button class="btn btn-sm btn-danger fin-del-acc" data-id="${a.id}">حذف</button>
          </td>
        </tr>${renderNode(a.id, depth + 1)}`).join('');
      }
      tree.innerHTML = `<table class="tbl"><thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>صنف</th><th>إجراء</th></tr></thead><tbody>${renderNode('root', 0)}</tbody></table>`;
      $$('.fin-edit-acc', tree).forEach((b) => b.onclick = () => openAccountForm(el, b.dataset.id));
      $$('.fin-toggle-acc', tree).forEach((b) => b.onclick = async () => { const on = b.dataset.active === '0'; try { await api('POST', `/api/finance/accounts/${b.dataset.id}/toggle`, { active: on }); toast(on ? 'تم التفعيل' : 'تم التعطيل'); loadAccounts(el); } catch (e) { toast(e.message, false); } });
      $$('.fin-del-acc', tree).forEach((b) => b.onclick = async () => { if (!await confirmDlg('حذف الحساب؟')) return; try { await api('DELETE', `/api/finance/accounts/${b.dataset.id}`); toast('تم الحذف'); loadAccounts(el); } catch (e) { toast(e.message, false); } });
    } catch (e) { tree.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
  }
  function openAccountForm(parent, editId = null) {
    const acc = editId ? _accounts.find((a) => a.id == editId) : null;
    const dlg = document.createElement('dialog'); dlg.className = 'fin-dlg';
    const parentOpts = _accounts.filter((a) => !a.postable || !a.systemKey).map((a) => `<option value="${a.id}" ${acc?.parentId == a.id ? 'selected' : ''}>${escHtml(a.code)} — ${escHtml(a.name)}</option>`).join('');
    dlg.innerHTML = `<h2>${editId ? 'تعديل حساب' : 'حساب جديد'}</h2>
    <form id="fin-acc-frm">
      <label>رمز الحساب <input name="code" class="inp" required value="${escHtml(acc?.code || '')}" pattern="[0-9A-Za-z.\\-]+" title="أرقام وحروف لاتينية وشرطة ونقطة فقط"></label>
      <label>اسم الحساب <input name="name" class="inp full" required value="${escHtml(acc?.name || '')}"></label>
      <label>الحساب الأب <select name="parentId" class="inp"><option value="">— لا يوجد (حساب رئيسي) —</option>${parentOpts}</select></label>
      <label>النوع <select name="type" class="inp" ${editId ? 'disabled' : ''}>
        <option value="asset" ${acc?.type === 'asset' ? 'selected' : ''}>أصول</option>
        <option value="liability" ${acc?.type === 'liability' ? 'selected' : ''}>خصوم</option>
        <option value="equity" ${acc?.type === 'equity' ? 'selected' : ''}>حقوق ملكية</option>
        <option value="revenue" ${acc?.type === 'revenue' ? 'selected' : ''}>إيرادات</option>
        <option value="expense" ${acc?.type === 'expense' ? 'selected' : ''}>مصروفات</option>
      </select></label>
      <label><input name="postable" type="checkbox" ${acc?.postable !== false ? 'checked' : ''}> حساب ورقة (قابل للقيد)</label>
      <label><input name="requireCc" type="checkbox" ${acc?.requireCc ? 'checked' : ''}> يستلزم مركز كلفة</label>
      <div class="dlg-actions">
        <button type="submit" class="btn btn-primary">${editId ? 'حفظ التعديل' : 'إضافة'}</button>
        <button type="button" class="btn btn-cancel" id="fin-acc-cancel">إلغاء</button>
      </div>
    </form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#fin-acc-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#fin-acc-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      const body = { code: f.code.value, name: f.name.value, parentId: f.parentId.value || null, type: f.type.value, postable: f.postable.checked, requireCc: f.requireCc.checked };
      try {
        if (editId) await api('PUT', `/api/finance/accounts/${editId}`, body);
        else await api('POST', '/api/finance/accounts', body);
        toast('تم الحفظ'); dlg.close(); dlg.remove(); loadAccounts(parent);
      } catch (e) { toast(e.message, false); }
    };
  }

  /* ============================================================
     4. التقارير
  ============================================================ */
  function renderReports(el) {
    el.innerHTML = `
    <div class="gsub">
      <button class="gsubbtn active" data-tab="tb">ميزان المراجعة</button>
      <button class="gsubbtn" data-tab="ledger">دفتر الأستاذ</button>
      <button class="gsubbtn" data-tab="income">قائمة الدخل</button>
      <button class="gsubbtn" data-tab="bs">الميزانية</button>
      <button class="gsubbtn" data-tab="cash">دفتر الصندوق</button>
      <button class="gsubbtn" data-tab="cc">مراكز الكلفة</button>
      <button class="gsubbtn" data-tab="party">كشف طرف</button>
    </div>
    <div id="fin-report-body" class="fin-report-body"></div>`;
    const body = $('#fin-report-body', el);
    function activateTab(tab) {
      $$('.gsubbtn', el).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      const from = `<input type="date" id="rpt-from" class="inp" title="من">`, to = `<input type="date" id="rpt-to" class="inp" title="إلى">`;
      if (tab === 'tb') {
        body.innerHTML = `<div class="fin-toolbar">${from}${to}<button class="btn btn-primary" id="rpt-run">تشغيل</button> <a class="btn" id="rpt-xlsx" href="#">تصدير Excel</a></div><div id="rpt-out"></div>`;
        const run = async () => {
          const f = $('#rpt-from', body)?.value, t = $('#rpt-to', body)?.value;
          const q = new URLSearchParams(); if (f) q.set('from', f); if (t) q.set('to', t);
          const out = $('#rpt-out', body); out.innerHTML = '<p class="loading">…</p>';
          try {
            const d = await api('GET', `/api/finance/reports/trial-balance?${q}`);
            $('#rpt-xlsx', body).href = `/api/finance/reports/trial-balance.xlsx?${q}`;
            out.innerHTML = `<table class="tbl">
            <thead><tr><th>الرمز</th><th>الحساب</th><th>مدين افتتاحي</th><th>دائن افتتاحي</th><th>مدين</th><th>دائن</th><th>مدين ختامي</th><th>دائن ختامي</th></tr></thead>
            <tbody>${d.rows.map((r) => `<tr class="${!r.postable ? 'acc-parent' : ''}"><td>${escHtml(r.code)}</td><td>${escHtml(r.name)}</td><td class="ltr">${r.openDebit ? fmt(r.openDebit) : ''}</td><td class="ltr">${r.openCredit ? fmt(r.openCredit) : ''}</td><td class="ltr">${r.debit ? fmt(r.debit) : ''}</td><td class="ltr">${r.credit ? fmt(r.credit) : ''}</td><td class="ltr">${r.closeDebit ? fmt(r.closeDebit) : ''}</td><td class="ltr">${r.closeCredit ? fmt(r.closeCredit) : ''}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="2"><strong>${d.balanced ? '✔ متوازن' : '✘ غير متوازن'}</strong></td><td class="ltr">${fmt(d.totals.openDebit)}</td><td class="ltr">${fmt(d.totals.openCredit)}</td><td class="ltr">${fmt(d.totals.debit)}</td><td class="ltr">${fmt(d.totals.credit)}</td><td class="ltr">${fmt(d.totals.closeDebit)}</td><td class="ltr">${fmt(d.totals.closeCredit)}</td></tr></tfoot>
            </table>`;
          } catch (e) { out.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
        };
        $('#rpt-run', body).onclick = run; run();
      } else if (tab === 'ledger') {
        const accOp = postableAccounts().map((a) => `<option value="${a.id}">${escHtml(a.code)} — ${escHtml(a.name)}</option>`).join('');
        body.innerHTML = `<div class="fin-toolbar"><select id="rpt-acc" class="inp"><option value="">— اختر حساباً —</option>${accOp}</select>${from}${to}<button class="btn btn-primary" id="rpt-run">تشغيل</button></div><div id="rpt-out"></div>`;
        $('#rpt-run', body).onclick = async () => {
          const acc = $('#rpt-acc', body)?.value, f = $('#rpt-from', body)?.value, t = $('#rpt-to', body)?.value;
          if (!acc) { toast('اختر حساباً', false); return; }
          const q = new URLSearchParams({ account: acc }); if (f) q.set('from', f); if (t) q.set('to', t);
          const out = $('#rpt-out', body); out.innerHTML = '<p class="loading">…</p>';
          try {
            const d = await api('GET', `/api/finance/reports/ledger?${q}`);
            out.innerHTML = `<h3>كشف حساب: ${escHtml(d.account.name)} (${escHtml(d.account.nature)})</h3>
            <p>الرصيد الافتتاحي: <strong>${fmt(d.opening)}</strong></p>
            <table class="tbl"><thead><tr><th>القيد</th><th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
            <tbody>${d.lines.map((l) => `<tr><td><a href="#" class="link">${escHtml(l.no || '#' + l.entryId)}</a></td><td>${l.day}</td><td>${escHtml(l.description)}</td><td class="ltr">${l.debit ? fmt(l.debit) : ''}</td><td class="ltr">${l.credit ? fmt(l.credit) : ''}</td><td class="ltr ${l.balance < 0 ? 'g-err' : ''}">${fmt(l.balance)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="3"><strong>الرصيد الختامي: ${fmt(d.closing)}</strong></td><td class="ltr">${fmt(d.totals.debit)}</td><td class="ltr">${fmt(d.totals.credit)}</td><td></td></tr></tfoot>
            </table>`;
          } catch (e) { out.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
        };
      } else if (tab === 'income') {
        body.innerHTML = `<div class="fin-toolbar">${from}${to}<button class="btn btn-primary" id="rpt-run">تشغيل</button></div><div id="rpt-out"></div>`;
        $('#rpt-run', body).onclick = async () => {
          const f = $('#rpt-from', body)?.value, t = $('#rpt-to', body)?.value;
          const q = new URLSearchParams(); if (f) q.set('from', f); if (t) q.set('to', t);
          const out = $('#rpt-out', body); out.innerHTML = '<p class="loading">…</p>';
          try {
            const d = await api('GET', `/api/finance/reports/income?${q}`);
            out.innerHTML = `
            <h3>قائمة الدخل</h3>
            <h4>الإيرادات</h4>
            <table class="tbl">${d.revenue.rows.map((r) => `<tr><td>${escHtml(r.code)} — ${escHtml(r.name)}</td><td class="ltr">${fmt(r.amount)}</td></tr>`).join('')}<tfoot><tr><td><strong>إجمالي الإيرادات</strong></td><td class="ltr"><strong>${fmt(d.revenue.total)}</strong></td></tr></tfoot></table>
            <h4>المصروفات</h4>
            <table class="tbl">${d.expense.rows.map((r) => `<tr><td>${escHtml(r.code)} — ${escHtml(r.name)}</td><td class="ltr">${fmt(r.amount)}</td></tr>`).join('')}<tfoot><tr><td><strong>إجمالي المصروفات</strong></td><td class="ltr"><strong>${fmt(d.expense.total)}</strong></td></tr></tfoot></table>
            <div class="fin-kpis"><div class="fin-kpi fin-kpi-wide"><span class="fin-kpi-label">صافي الفائض / العجز</span><span class="fin-kpi-val ${d.surplus >= 0 ? 'g-ok' : 'g-err'}">${fmt(d.surplus)}</span></div></div>`;
          } catch (e) { out.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
        };
      } else if (tab === 'bs') {
        body.innerHTML = `<div class="fin-toolbar">${to}<button class="btn btn-primary" id="rpt-run">تشغيل</button></div><div id="rpt-out"></div>`;
        $('#rpt-run', body).onclick = async () => {
          const t = $('#rpt-to', body)?.value; const q = new URLSearchParams(); if (t) q.set('to', t);
          const out = $('#rpt-out', body); out.innerHTML = '<p class="loading">…</p>';
          try {
            const d = await api('GET', `/api/finance/reports/balance-sheet?${q}`);
            const sec = (title, rows, total) => `<h4>${title}</h4><table class="tbl">${rows.map((r) => `<tr><td>${escHtml(r.code)} — ${escHtml(r.name)}</td><td class="ltr">${fmt(r.amount)}</td></tr>`).join('')}<tfoot><tr><td><strong>${title} (الإجمالي)</strong></td><td class="ltr"><strong>${fmt(total)}</strong></td></tr></tfoot></table>`;
            out.innerHTML = `<h3>الميزانية العمومية — حتى ${t || 'اليوم'}</h3>
            ${sec('الأصول', d.assets.rows, d.assets.total)}${sec('الخصوم', d.liabilities.rows, d.liabilities.total)}${sec('حقوق الملكية', [...d.equity.rows, { code: '—', name: 'فائض الفترة', amount: d.equity.surplus }], d.equity.total)}
            <p class="${d.balanced ? 'g-ok' : 'g-err'}">${d.balanced ? '✔ الميزانية متوازنة' : `✘ فارق ${fmt(d.difference)}`}</p>`;
          } catch (e) { out.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
        };
      } else if (tab === 'cash') {
        body.innerHTML = `<div class="fin-toolbar">${from}${to}<button class="btn btn-primary" id="rpt-run">تشغيل</button></div><div id="rpt-out"></div>`;
        $('#rpt-run', body).onclick = async () => {
          const f = $('#rpt-from', body)?.value, t = $('#rpt-to', body)?.value;
          const q = new URLSearchParams(); if (f) q.set('from', f); if (t) q.set('to', t);
          const out = $('#rpt-out', body); out.innerHTML = '<p class="loading">…</p>';
          try {
            const d = await api('GET', `/api/finance/reports/cash-book?${q}`);
            out.innerHTML = d.books.map((b) => `<h3>${escHtml(b.account.name)}</h3><p>الافتتاحي: <strong>${fmt(b.opening)}</strong> | الختامي: <strong>${fmt(b.closing)}</strong></p>
            <table class="tbl"><thead><tr><th>القيد</th><th>التاريخ</th><th>البيان</th><th>وارد</th><th>صادر</th><th>الرصيد</th></tr></thead>
            <tbody>${b.lines.map((l) => `<tr><td>${escHtml(l.no || '')}</td><td>${l.day}</td><td>${escHtml(l.description)}</td><td class="ltr">${l.debit ? fmt(l.debit) : ''}</td><td class="ltr">${l.credit ? fmt(l.credit) : ''}</td><td class="ltr">${fmt(l.balance)}</td></tr>`).join('')}</tbody>
            </table>`).join('') + `<p><strong>إجمالي الأرصدة النقدية: ${fmt(d.totalClosing)}</strong></p>`;
          } catch (e) { out.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
        };
      } else if (tab === 'cc') {
        body.innerHTML = `<div class="fin-toolbar">${from}${to}<button class="btn btn-primary" id="rpt-run">تشغيل</button></div><div id="rpt-out"></div>`;
        $('#rpt-run', body).onclick = async () => {
          const f = $('#rpt-from', body)?.value, t = $('#rpt-to', body)?.value;
          const q = new URLSearchParams(); if (f) q.set('from', f); if (t) q.set('to', t);
          const out = $('#rpt-out', body); out.innerHTML = '<p class="loading">…</p>';
          try {
            const d = await api('GET', `/api/finance/reports/cost-centers?${q}`);
            out.innerHTML = `<table class="tbl"><thead><tr><th>الرمز</th><th>المركز</th><th>الإيرادات</th><th>المصروفات</th><th>الصافي</th></tr></thead>
            <tbody>${d.rows.map((r) => `<tr><td>${escHtml(r.code)}</td><td>${escHtml(r.name)}</td><td class="ltr g-ok">${fmt(r.revenue)}</td><td class="ltr g-warn">${fmt(r.expense)}</td><td class="ltr ${r.net >= 0 ? 'g-ok' : 'g-err'}">${fmt(r.net)}</td></tr>`).join('')}</tbody>
            </table>`;
          } catch (e) { out.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
        };
      } else if (tab === 'party') {
        const pOpts = _parties.map((p) => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
        body.innerHTML = `<div class="fin-toolbar"><select id="rpt-party" class="inp"><option value="">— اختر طرفاً —</option>${pOpts}</select>${from}${to}<button class="btn btn-primary" id="rpt-run">تشغيل</button></div><div id="rpt-out"></div>`;
        $('#rpt-run', body).onclick = async () => {
          const pid = $('#rpt-party', body)?.value, f = $('#rpt-from', body)?.value, t = $('#rpt-to', body)?.value;
          if (!pid) { toast('اختر طرفاً', false); return; }
          const q = new URLSearchParams({ party: pid }); if (f) q.set('from', f); if (t) q.set('to', t);
          const out = $('#rpt-out', body); out.innerHTML = '<p class="loading">…</p>';
          try {
            const d = await api('GET', `/api/finance/reports/party?${q}`);
            out.innerHTML = `<h3>كشف حساب: ${escHtml(d.party.name)}</h3>
            <p>الافتتاحي: <strong>${fmt(d.opening)}</strong> | الختامي: <strong class="${d.closing < 0 ? 'g-err' : ''}">${fmt(d.closing)} (${d.side})</strong></p>
            <table class="tbl"><thead><tr><th>القيد</th><th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
            <tbody>${d.lines.map((l) => `<tr><td>${escHtml(l.no || '')}</td><td>${l.day}</td><td>${escHtml(l.description)}</td><td class="ltr">${l.debit ? fmt(l.debit) : ''}</td><td class="ltr">${l.credit ? fmt(l.credit) : ''}</td><td class="ltr">${fmt(l.balance)}</td></tr>`).join('')}</tbody>
            </table>`;
          } catch (e) { out.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
        };
      }
    }
    $$('.gsubbtn', el).forEach((b) => b.onclick = () => activateTab(b.dataset.tab));
    activateTab('tb');
  }

  /* ============================================================
     5. رسوم الطلاب
  ============================================================ */
  async function renderFees(el) {
    el.innerHTML = `
    <div class="gsub">
      <button class="gsubbtn active" data-tab="charges">الاستحقاقات</button>
      <button class="gsubbtn" data-tab="payments">الدفعات</button>
      <button class="gsubbtn" data-tab="fee-types">أنواع الرسوم</button>
      <button class="gsubbtn" data-tab="stmt">كشف طالب</button>
    </div>
    <div id="fin-fees-body"></div>`;
    const body = $('#fin-fees-body', el);
    const activateTab = (tab) => {
      $$('.gsubbtn', el).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      if (tab === 'charges') renderCharges(body);
      else if (tab === 'payments') renderPayments(body);
      else if (tab === 'fee-types') renderFeeTypes(body);
      else if (tab === 'stmt') renderStudentStatement(body);
    };
    $$('.gsubbtn', el).forEach((b) => b.onclick = () => activateTab(b.dataset.tab));
    activateTab('charges');
  }
  async function renderCharges(el) {
    el.innerHTML = `<div class="fin-toolbar"><button class="btn btn-primary" id="fin-new-charge">+ استحقاق رسوم</button></div><div id="fin-ch-list"><p class="loading">…</p></div>`;
    $('#fin-new-charge', el).onclick = () => openChargeForm(el);
    const list = $('#fin-ch-list', el);
    try {
      const { charges } = await api('GET', '/api/finance/charges?');
      list.innerHTML = `<table class="tbl"><thead><tr><th>الطالب</th><th>نوع الرسم</th><th>المبلغ</th><th>تاريخ الاستحقاق</th><th>العام</th><th>الحالة</th><th>إجراء</th></tr></thead>
      <tbody>${charges.map((c) => `<tr><td>#${c.studentId}</td><td>${escHtml(c.feeType)}</td><td class="ltr">${fmt(c.amount)}</td><td>${c.dueDay}</td><td>${c.academicYear}</td><td>${badge(c.status, STD)}</td>
      <td>${c.status === 'open' ? `<button class="btn btn-sm btn-danger fin-void-ch" data-id="${c.id}">إلغاء</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
      $$('.fin-void-ch', list).forEach((b) => b.onclick = async () => { if (!await confirmDlg('إلغاء الاستحقاق؟')) return; try { await api('POST', `/api/finance/charges/${b.dataset.id}/void`); toast('تم الإلغاء'); renderCharges(el); } catch (e) { toast(e.message, false); } });
    } catch (e) { list.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
  }
  function openChargeForm(parent) {
    const ftOpts = _feeTypes?.filter((f) => f.active).map((f) => `<option value="${f.id}">${escHtml(f.name)} (${f.kind === 'fee' ? 'رسم' : 'خصم'})</option>`).join('') || '';
    const dlg = document.createElement('dialog'); dlg.className = 'fin-dlg';
    dlg.innerHTML = `<h2>إضافة استحقاق</h2><form id="fin-ch-frm">
      <label>رقم الطالب <input name="studentId" type="number" class="inp" required></label>
      <label>نوع الرسم <select name="feeTypeId" class="inp" required><option value="">—</option>${ftOpts}</select></label>
      <label>المبلغ <input name="amount" type="number" class="inp" step="0.01" min="0.01" required></label>
      <label>تاريخ الاستحقاق <input name="dueDay" type="date" class="inp" value="${new Date().toISOString().slice(0,10)}"></label>
      <label>العام الدراسي <input name="academicYear" type="text" class="inp" value="${new Date().getFullYear()}" maxlength="10"></label>
      <label>ملاحظة <input name="note" class="inp full" maxlength="200"></label>
      <div class="dlg-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn btn-cancel" id="fin-ch-cancel">إلغاء</button></div>
    </form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#fin-ch-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#fin-ch-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try { await api('POST', '/api/finance/charges', { studentId: Number(f.studentId.value), feeTypeId: Number(f.feeTypeId.value), amount: f.amount.value, dueDay: f.dueDay.value, academicYear: f.academicYear.value, note: f.note.value }); toast('تم الحفظ'); dlg.close(); dlg.remove(); renderCharges(parent); } catch (e) { toast(e.message, false); }
    };
  }
  async function renderPayments(el) {
    el.innerHTML = `<div class="fin-toolbar"><button class="btn btn-primary" id="fin-new-pay">+ استلام دفعة</button></div><div id="fin-py-list"><p class="loading">…</p></div>`;
    $('#fin-new-pay', el).onclick = () => openPaymentForm(el);
    const list = $('#fin-py-list', el);
    try {
      const { payments } = await api('GET', '/api/finance/payments?');
      list.innerHTML = `<table class="tbl"><thead><tr><th>الإيصال</th><th>الطالب</th><th>المبلغ</th><th>طريقة الدفع</th><th>التاريخ</th><th>الحالة</th><th>إجراء</th></tr></thead>
      <tbody>${payments.map((p) => `<tr><td>${escHtml(p.receiptNo)}</td><td>${escHtml(p.student || '#' + p.studentId)}</td><td class="ltr">${fmt(p.amount)}</td><td>${p.method === 'cash' ? 'نقد' : 'بنك'}</td><td>${p.paidDay}</td><td>${badge(p.status, STD)}</td>
      <td>${p.status === 'ok' ? `<button class="btn btn-sm btn-danger fin-void-py" data-id="${p.id}">إلغاء</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
      $$('.fin-void-py', list).forEach((b) => b.onclick = async () => { if (!await confirmDlg('إلغاء الدفعة؟')) return; try { await api('POST', `/api/finance/payments/${b.dataset.id}/void`); toast('تم الإلغاء'); renderPayments(el); } catch (e) { toast(e.message, false); } });
    } catch (e) { list.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
  }
  function openPaymentForm(parent) {
    const dlg = document.createElement('dialog'); dlg.className = 'fin-dlg';
    dlg.innerHTML = `<h2>استلام دفعة</h2><form id="fin-py-frm">
      <label>رقم الطالب <input name="studentId" type="number" class="inp" required></label>
      <label>المبلغ <input name="amount" type="number" class="inp" step="0.01" min="0.01" required></label>
      <label>طريقة الدفع <select name="method" class="inp"><option value="cash">نقد</option><option value="bank">بنك</option></select></label>
      <label>التاريخ <input name="paidDay" type="date" class="inp" value="${new Date().toISOString().slice(0,10)}"></label>
      <label>ملاحظة <input name="note" class="inp full" maxlength="200"></label>
      <div class="dlg-actions"><button type="submit" class="btn btn-primary">استلام</button><button type="button" class="btn btn-cancel" id="fin-py-cancel">إلغاء</button></div>
    </form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#fin-py-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#fin-py-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try { await api('POST', '/api/finance/payments', { studentId: Number(f.studentId.value), amount: f.amount.value, method: f.method.value, paidDay: f.paidDay.value, note: f.note.value }); toast('تم الاستلام'); dlg.close(); dlg.remove(); renderPayments(parent); } catch (e) { toast(e.message, false); }
    };
  }
  async function renderFeeTypes(el) {
    el.innerHTML = `<div class="fin-toolbar"><button class="btn btn-primary" id="fin-new-ft">+ نوع رسم جديد</button></div><div id="fin-ft-list"><p class="loading">…</p></div>`;
    $('#fin-new-ft', el).onclick = () => openFeeTypeForm(el);
    const list = $('#fin-ft-list', el);
    try {
      const fts = await api('GET', '/api/finance/fee-types');
      list.innerHTML = `<table class="tbl"><thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>المبلغ الافتراضي</th><th>الحالة</th><th>إجراء</th></tr></thead>
      <tbody>${fts.map((f) => `<tr><td>${escHtml(f.code)}</td><td>${escHtml(f.name)}</td><td>${f.kind === 'fee' ? 'رسم' : 'خصم'}</td><td class="ltr">${fmt(f.defaultAmount)}</td><td>${badge(f.active ? 'active' : 'disabled', { active: 'success', disabled: 'danger' })}</td>
      <td><button class="btn btn-sm fin-edit-ft" data-id="${f.id}">تعديل</button> <button class="btn btn-sm fin-toggle-ft" data-id="${f.id}" data-active="${f.active ? 1 : 0}">${f.active ? 'تعطيل' : 'تفعيل'}</button></td></tr>`).join('')}</tbody></table>`;
      $$('.fin-edit-ft', list).forEach((b) => b.onclick = () => openFeeTypeForm(el, b.dataset.id));
      $$('.fin-toggle-ft', list).forEach((b) => b.onclick = async () => { try { await api('POST', `/api/finance/fee-types/${b.dataset.id}/toggle`, { active: b.dataset.active === '0' }); toast('تم التحديث'); renderFeeTypes(el); } catch (e) { toast(e.message, false); } });
    } catch (e) { list.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
  }
  function openFeeTypeForm(parent, editId = null) {
    const ft = editId ? (_feeTypes ?? []).find((f) => f.id == editId) : null;
    const dlg = document.createElement('dialog'); dlg.className = 'fin-dlg';
    dlg.innerHTML = `<h2>${editId ? 'تعديل نوع رسم' : 'نوع رسم جديد'}</h2><form id="fin-ft-frm">
      <label>الرمز <input name="code" class="inp" required value="${escHtml(ft?.code || '')}" maxlength="30"></label>
      <label>الاسم <input name="name" class="inp full" required value="${escHtml(ft?.name || '')}" maxlength="100"></label>
      <label>النوع <select name="kind" class="inp"><option value="fee" ${ft?.kind !== 'discount' ? 'selected' : ''}>رسم</option><option value="discount" ${ft?.kind === 'discount' ? 'selected' : ''}>خصم</option></select></label>
      <label>الحساب <select name="accountId" class="inp" required><option value="">— اختر —</option>${accOpts(ft?.accountId)}</select></label>
      <label>المبلغ الافتراضي <input name="defaultAmount" type="number" class="inp" step="0.01" min="0" value="${ft?.defaultAmount || 0}"></label>
      <div class="dlg-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn btn-cancel" id="fin-ft-cancel">إلغاء</button></div>
    </form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#fin-ft-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#fin-ft-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      const body = { code: f.code.value, name: f.name.value, kind: f.kind.value, accountId: Number(f.accountId.value), defaultAmount: f.defaultAmount.value };
      if (editId) body.id = Number(editId);
      try { await api('POST', '/api/finance/fee-types', body); toast('تم الحفظ'); dlg.close(); dlg.remove(); renderFeeTypes(parent); } catch (e) { toast(e.message, false); }
    };
  }
  async function renderStudentStatement(el) {
    el.innerHTML = `<div class="fin-toolbar"><input id="fin-stmt-sid" type="number" class="inp" placeholder="رقم الطالب…"><button class="btn btn-primary" id="fin-stmt-run">عرض</button></div><div id="fin-stmt-out"></div>`;
    $('#fin-stmt-run', el).onclick = async () => {
      const sid = $('#fin-stmt-sid', el).value; if (!sid) { toast('أدخل رقم الطالب', false); return; }
      const out = $('#fin-stmt-out', el); out.innerHTML = '<p class="loading">…</p>';
      try {
        const d = await api('GET', `/api/finance/student-statement/${sid}`);
        out.innerHTML = `<h3>كشف حساب: ${escHtml(d.student.name)}</h3>
        <div class="fin-kpis"><div class="fin-kpi"><span class="fin-kpi-label">المستحق</span><span class="fin-kpi-val">${fmt(d.totalCharged)}</span></div><div class="fin-kpi"><span class="fin-kpi-label">المدفوع</span><span class="fin-kpi-val g-ok">${fmt(d.totalPaid)}</span></div><div class="fin-kpi"><span class="fin-kpi-label">الرصيد</span><span class="fin-kpi-val ${d.balance > 0 ? 'g-err' : 'g-ok'}">${fmt(d.balance)} (${d.side})</span></div></div>
        <h4>الاستحقاقات</h4><table class="tbl"><thead><tr><th>نوع الرسم</th><th>المبلغ</th><th>التاريخ</th><th>الحالة</th></tr></thead><tbody>${d.charges.map((c) => `<tr><td>${escHtml(c.feeType)}</td><td class="ltr">${fmt(c.amount)}</td><td>${c.dueDay}</td><td>${badge(c.status, STD)}</td></tr>`).join('')}</tbody></table>
        <h4>الدفعات</h4><table class="tbl"><thead><tr><th>الإيصال</th><th>المبلغ</th><th>التاريخ</th><th>الطريقة</th><th>الحالة</th></tr></thead><tbody>${d.payments.map((p) => `<tr><td>${escHtml(p.receiptNo)}</td><td class="ltr">${fmt(p.amount)}</td><td>${p.paidDay}</td><td>${p.method === 'cash' ? 'نقد' : 'بنك'}</td><td>${badge(p.status, STD)}</td></tr>`).join('')}</tbody></table>`;
      } catch (e) { out.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
    };
  }

  /* ============================================================
     6. الإعداد (السنوات، العملات، مراكز الكلفة، الأطراف)
  ============================================================ */
  async function renderSetup(el) {
    el.innerHTML = `
    <div class="gsub">
      <button class="gsubbtn active" data-tab="years">السنوات المالية</button>
      <button class="gsubbtn" data-tab="currencies">العملات</button>
      <button class="gsubbtn" data-tab="cc">مراكز الكلفة</button>
      <button class="gsubbtn" data-tab="parties">الأطراف</button>
    </div>
    <div id="fin-setup-body"></div>`;
    const body = $('#fin-setup-body', el);
    const activateTab = (tab) => {
      $$('.gsubbtn', el).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      if (tab === 'years') renderYears(body);
      else if (tab === 'currencies') renderCurrencies(body);
      else if (tab === 'cc') renderCostCenters(body);
      else if (tab === 'parties') renderParties(body);
    };
    $$('.gsubbtn', el).forEach((b) => b.onclick = () => activateTab(b.dataset.tab));
    activateTab('years');
  }
  async function renderYears(el) {
    el.innerHTML = `<div class="fin-toolbar"><button class="btn btn-primary" id="fin-new-year">+ سنة مالية</button></div><div id="fin-years-list"><p class="loading">…</p></div>`;
    $('#fin-new-year', el).onclick = () => openYearForm(el);
    const list = $('#fin-years-list', el);
    try {
      const { years } = await api('GET', '/api/finance/years');
      list.innerHTML = `<table class="tbl"><thead><tr><th>الاسم</th><th>البداية</th><th>النهاية</th><th>الحالة</th><th>إجراء</th></tr></thead>
      <tbody>${years.map((y) => `<tr><td>${escHtml(y.name)}</td><td>${y.startDay}</td><td>${y.endDay}</td><td>${badge(y.status, STD)}</td>
      <td>${y.status === 'open' ? `<button class="btn btn-sm btn-danger fin-close-year" data-id="${y.id}" data-name="${escHtml(y.name)}">إقفال</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
      $$('.fin-close-year', list).forEach((b) => b.onclick = async () => {
        if (!await confirmDlg(`إقفال السنة ${b.dataset.name}؟ هذا الإجراء لا يمكن التراجع عنه.`)) return;
        try { await api('POST', `/api/finance/years/${b.dataset.id}/close`); toast('تم إقفال السنة'); renderYears(el); } catch (e) { toast(e.message, false); }
      });
    } catch (e) { list.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
  }
  function openYearForm(parent) {
    const dlg = document.createElement('dialog'); dlg.className = 'fin-dlg';
    const y = new Date().getFullYear() + 1;
    dlg.innerHTML = `<h2>سنة مالية جديدة</h2><form id="fin-year-frm">
      <label>الاسم <input name="name" class="inp" required value="${y}" maxlength="20"></label>
      <label>من <input name="startDay" type="date" class="inp" required value="${y}-01-01"></label>
      <label>حتى <input name="endDay" type="date" class="inp" required value="${y}-12-31"></label>
      <div class="dlg-actions"><button type="submit" class="btn btn-primary">إضافة</button><button type="button" class="btn btn-cancel" id="fin-year-cancel">إلغاء</button></div>
    </form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#fin-year-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#fin-year-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try { await api('POST', '/api/finance/years', { name: f.name.value, startDay: f.startDay.value, endDay: f.endDay.value }); toast('تم الإنشاء'); dlg.close(); dlg.remove(); renderYears(parent); } catch (e) { toast(e.message, false); }
    };
  }
  async function renderCurrencies(el) {
    el.innerHTML = '<p class="loading">…</p>';
    try {
      const { currencies } = await api('GET', '/api/finance/currencies');
      el.innerHTML = `<table class="tbl"><thead><tr><th>الرمز</th><th>الاسم</th><th>سعر الصرف</th><th>أساسية</th><th>الحالة</th><th>تعديل</th></tr></thead>
      <tbody>${currencies.map((c) => `<tr><td>${escHtml(c.code)}</td><td>${escHtml(c.name)}</td>
        <td><input class="inp cur-rate" type="number" step="1" min="0.0001" data-code="${escHtml(c.code)}" value="${c.rate}" ${c.is_base ? 'disabled' : ''}></td>
        <td>${c.is_base ? '✔' : ''}</td>
        <td>${c.active ? 'نشطة' : 'معطّلة'}</td>
        <td><button class="btn btn-sm cur-save" data-code="${escHtml(c.code)}">حفظ</button></td>
      </tr>`).join('')}</tbody></table>`;
      $$('.cur-save', el).forEach((b) => b.onclick = async () => {
        const code = b.dataset.code, rate = Number($('.cur-rate[data-code="' + code + '"]', el)?.value);
        try { await api('PUT', `/api/finance/currencies/${code}`, { rate }); toast('تم حفظ سعر الصرف'); } catch (e) { toast(e.message, false); }
      });
    } catch (e) { el.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
  }
  async function renderCostCenters(el) {
    el.innerHTML = `<div class="fin-toolbar"><button class="btn btn-primary" id="fin-new-cc">+ مركز كلفة</button></div><div id="fin-cc-list"><p class="loading">…</p></div>`;
    $('#fin-new-cc', el).onclick = () => openCcForm(el);
    const list = $('#fin-cc-list', el);
    try {
      const { costCenters } = await api('GET', '/api/finance/cost-centers');
      list.innerHTML = `<table class="tbl"><thead><tr><th>الرمز</th><th>الاسم</th><th>الوحدة</th><th>الحالة</th><th>إجراء</th></tr></thead>
      <tbody>${costCenters.map((c) => `<tr><td>${escHtml(c.code)}</td><td>${escHtml(c.name)}</td><td>${escHtml(c.unit_name || '—')}</td><td>${c.active ? 'نشط' : 'معطّل'}</td>
      <td><button class="btn btn-sm fin-edit-cc" data-id="${c.id}">تعديل</button> <button class="btn btn-sm fin-toggle-cc" data-id="${c.id}" data-active="${c.active ? 1 : 0}">${c.active ? 'تعطيل' : 'تفعيل'}</button></td></tr>`).join('')}</tbody></table>`;
      $$('.fin-edit-cc', list).forEach((b) => b.onclick = async () => { const cc = costCenters.find((x) => x.id == b.dataset.id); if (!cc) return; const name = prompt('اسم مركز الكلفة:', cc.name); if (!name) return; try { await api('PUT', `/api/finance/cost-centers/${b.dataset.id}`, { name }); toast('تم التعديل'); renderCostCenters(el); } catch (e) { toast(e.message, false); } });
      $$('.fin-toggle-cc', list).forEach((b) => b.onclick = async () => { try { await api('POST', `/api/finance/cost-centers/${b.dataset.id}/toggle`, { active: b.dataset.active === '0' }); toast('تم التحديث'); renderCostCenters(el); } catch (e) { toast(e.message, false); } });
    } catch (e) { list.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
  }
  function openCcForm(parent) {
    const dlg = document.createElement('dialog'); dlg.className = 'fin-dlg';
    dlg.innerHTML = `<h2>مركز كلفة جديد</h2><form id="fin-cc-frm">
      <label>الرمز <input name="code" class="inp" required maxlength="20"></label>
      <label>الاسم <input name="name" class="inp full" required maxlength="100"></label>
      <div class="dlg-actions"><button type="submit" class="btn btn-primary">إضافة</button><button type="button" class="btn btn-cancel" id="fin-cc-cancel">إلغاء</button></div>
    </form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#fin-cc-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#fin-cc-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try { await api('POST', '/api/finance/cost-centers', { code: f.code.value, name: f.name.value }); toast('تم الإنشاء'); dlg.close(); dlg.remove(); renderCostCenters(parent); } catch (e) { toast(e.message, false); }
    };
  }
  async function renderParties(el) {
    el.innerHTML = `<div class="fin-toolbar"><button class="btn btn-primary" id="fin-new-party">+ طرف جديد</button>
    <select id="fin-party-kind" class="inp"><option value="">كل الأنواع</option><option value="supplier">مورد</option><option value="customer">عميل</option><option value="employee">موظف</option></select>
    <input id="fin-party-q" type="search" class="inp" placeholder="بحث بالاسم…">
    <button class="btn" id="fin-party-search">بحث</button>
    </div><div id="fin-party-list"><p class="loading">…</p></div>`;
    const loadP = async () => {
      const kind = $('#fin-party-kind', el)?.value, q = $('#fin-party-q', el)?.value;
      const params = new URLSearchParams(); if (kind) params.set('kind', kind); if (q) params.set('q', q);
      const list = $('#fin-party-list', el); list.innerHTML = '<p class="loading">…</p>';
      try {
        const { parties } = await api('GET', `/api/finance/parties?${params}`);
        _parties = parties;
        list.innerHTML = `<table class="tbl"><thead><tr><th>الاسم</th><th>النوع</th><th>الهاتف</th><th>البريد</th><th>الحالة</th><th>إجراء</th></tr></thead>
        <tbody>${parties.map((p) => `<tr><td>${escHtml(p.name)}</td><td>${escHtml(p.kind)}</td><td>${escHtml(p.phone || '—')}</td><td>${escHtml(p.email || '—')}</td><td>${p.active ? 'نشط' : 'معطّل'}</td>
        <td><button class="btn btn-sm fin-edit-party" data-id="${p.id}">تعديل</button></td></tr>`).join('')}</tbody></table>`;
        $$('.fin-edit-party', list).forEach((b) => b.onclick = () => openPartyForm(el, Number(b.dataset.id)));
      } catch (e) { list.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
    };
    $('#fin-new-party', el).onclick = () => openPartyForm(el);
    $('#fin-party-search', el).onclick = loadP; loadP();
  }
  function openPartyForm(parent, editId = null) {
    const p = editId ? _parties.find((x) => x.id === editId) : null;
    const dlg = document.createElement('dialog'); dlg.className = 'fin-dlg';
    dlg.innerHTML = `<h2>${editId ? 'تعديل طرف' : 'طرف جديد'}</h2><form id="fin-party-frm">
      <label>الاسم <input name="name" class="inp full" required value="${escHtml(p?.name || '')}" maxlength="100"></label>
      <label>النوع <select name="kind" class="inp"><option value="supplier" ${p?.kind === 'supplier' ? 'selected' : ''}>مورد</option><option value="customer" ${p?.kind === 'customer' ? 'selected' : ''}>عميل</option><option value="employee" ${p?.kind === 'employee' ? 'selected' : ''}>موظف</option><option value="other" ${!p || p.kind === 'other' ? 'selected' : ''}>آخر</option></select></label>
      <label>الهاتف <input name="phone" class="inp" value="${escHtml(p?.phone || '')}" maxlength="30"></label>
      <label>البريد <input name="email" type="email" class="inp" value="${escHtml(p?.email || '')}" maxlength="100"></label>
      <label>ملاحظات <textarea name="notes" class="inp full" maxlength="400">${escHtml(p?.notes || '')}</textarea></label>
      <div class="dlg-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn btn-cancel" id="fin-party-cancel">إلغاء</button></div>
    </form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#fin-party-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#fin-party-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      const body = { name: f.name.value, kind: f.kind.value, phone: f.phone.value, email: f.email.value, notes: f.notes.value };
      try {
        if (editId) await api('PUT', `/api/finance/parties/${editId}`, body);
        else await api('POST', '/api/finance/parties', body);
        toast('تم الحفظ'); dlg.close(); dlg.remove(); renderParties(parent);
      } catch (e) { toast(e.message, false); }
    };
  }

  /* ============================================================
     رسوم الطالب (self — واجهة الطالب)
  ============================================================ */
  async function renderMyFees(el) {
    el.innerHTML = '<p class="loading">جارٍ التحميل…</p>';
    try {
      const d = await api('GET', '/api/me/fees');
      el.innerHTML = `<h2>رسومي المالية</h2>
      <div class="fin-kpis">
        <div class="fin-kpi"><span class="fin-kpi-label">المستحق الكلي</span><span class="fin-kpi-val">${fmt(d.totalCharged)}</span></div>
        <div class="fin-kpi"><span class="fin-kpi-label">المدفوع</span><span class="fin-kpi-val g-ok">${fmt(d.totalPaid)}</span></div>
        <div class="fin-kpi"><span class="fin-kpi-label">الرصيد المتبقي</span><span class="fin-kpi-val ${d.balance > 0 ? 'g-err' : 'g-ok'}">${fmt(d.balance)} (${d.side})</span></div>
      </div>
      <h3>الاستحقاقات</h3>
      <table class="tbl"><thead><tr><th>نوع الرسم</th><th>المبلغ</th><th>تاريخ الاستحقاق</th><th>العام الدراسي</th><th>الحالة</th></tr></thead>
      <tbody>${d.charges.map((c) => `<tr><td>${escHtml(c.feeType)}</td><td class="ltr">${fmt(c.amount)}</td><td>${c.dueDay}</td><td>${c.academicYear}</td><td>${badge(c.status, STD)}</td></tr>`).join('')}</tbody></table>
      <h3>الدفعات</h3>
      <table class="tbl"><thead><tr><th>رقم الإيصال</th><th>المبلغ</th><th>التاريخ</th><th>طريقة الدفع</th><th>الحالة</th></tr></thead>
      <tbody>${d.payments.map((p) => `<tr><td>${escHtml(p.receiptNo)}</td><td class="ltr">${fmt(p.amount)}</td><td>${p.paidDay}</td><td>${p.method === 'cash' ? 'نقد' : 'بنك'}</td><td>${badge(p.status, STD)}</td></tr>`).join('')}</tbody></table>`;
    } catch (e) { el.innerHTML = `<p class="error">${escHtml(e.message)}</p>`; }
  }

  /* ============================================================
     تجميع التبويبات الرئيسية
  ============================================================ */
  const TABS = [
    { key: 'overview', label: 'لوحة المعلومات', icon: '📊', render: renderOverview, perm: 'finance:read' },
    { key: 'entries',  label: 'القيود اليومية', icon: '📋', render: renderEntries,  perm: 'finance:entry' },
    { key: 'accounts', label: 'دليل الحسابات',  icon: '🌳', render: renderAccounts, perm: 'finance:setup' },
    { key: 'reports',  label: 'التقارير',        icon: '📈', render: renderReports,  perm: 'finance:read' },
    { key: 'fees',     label: 'رسوم الطلاب',     icon: '💰', render: renderFees,     perm: 'finance:fees' },
    { key: 'setup',    label: 'الإعداد',          icon: '⚙️',  render: renderSetup,   perm: 'finance:setup' },
    { key: 'myfees',   label: 'رسومي',            icon: '🧾', render: renderMyFees,  perm: 'fees:read_own', studentOnly: true },
  ];

  window.UA.views = window.UA.views || {};
  window.UA.views.finance = async function (el, user) {
    await loadMeta();
    const perms = user?.permissions ?? [], role = user?.role;
    const avail = TABS.filter((t) => {
      if (t.studentOnly) return role === 'student';
      if (role === 'student') return false;
      return perms.includes(t.perm) || role === 'admin';
    });
    if (!avail.length) { el.innerHTML = '<p class="error">لا توجد صلاحيات للوصول إلى وحدة المالية.</p>'; return; }
    el.innerHTML = `
    <style>
      .fin-kpis{display:flex;flex-wrap:wrap;gap:.8rem;margin:1rem 0}
      .fin-kpi{background:var(--card-bg,#fff);border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:.9rem 1.2rem;min-width:130px;text-align:center}
      .fin-kpi-wide{min-width:220px}.fin-kpi-warn{border-color:#f59e0b;background:#fffbeb}
      .fin-kpi-label{display:block;font-size:.78rem;color:var(--muted,#64748b);margin-bottom:.3rem}
      .fin-kpi-val{font-size:1.35rem;font-weight:700;color:var(--text,#1e293b)}
      .fin-toolbar{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem;align-items:center}
      .fin-section-title{margin:1.2rem 0 .5rem;font-size:1rem;font-weight:600;color:var(--text)}
      .fin-dlg{border:none;border-radius:12px;padding:2rem;max-width:700px;width:96vw;direction:rtl;box-shadow:0 8px 32px rgba(0,0,0,.18)}
      .fin-dlg::backdrop{background:rgba(0,0,0,.4)}.fin-dlg h2{margin-top:0}
      .fin-dlg label{display:flex;flex-direction:column;gap:.3rem;margin-bottom:.7rem;font-size:.9rem;font-weight:500}
      .fin-dlg .form-row{display:flex;gap:.8rem;flex-wrap:wrap}.fin-dlg .form-row label{flex:1}
      .dlg-actions{display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap}
      .btn-cancel{background:var(--surface,#f8fafc);border:1px solid var(--border,#e2e8f0)}
      .fin-report-body{padding-top:.5rem}
      .acc-parent td{font-weight:600;background:var(--surface,#f8fafc)}
      .row-muted{opacity:.55}.g-ok{color:#16a34a}.g-warn{color:#d97706}.g-err{color:#dc2626}
      .fin-count{font-size:.85rem;color:var(--muted);margin-bottom:.4rem}
      .fin-meta{font-size:.8rem;color:var(--muted);margin-top:.8rem}
      .tbl-total td{font-weight:600;border-top:2px solid var(--border,#e2e8f0)}
    </style>
    <div class="sub-tabs fin-sub-tabs" style="margin-bottom:1rem">
      ${avail.map((t) => `<button class="sub-tab-btn" data-tab="${t.key}">${t.icon} ${t.label}</button>`).join('')}
    </div>
    <div id="fin-content"></div>`;
    const content = el.querySelector('#fin-content');
    let activeTab = avail[0].key;
    function activate(key) {
      activeTab = key;
      $$('.sub-tab-btn', el).forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
      const t = avail.find((x) => x.key === key); if (t) t.render(content);
    }
    $$('.sub-tab-btn', el).forEach((b) => b.onclick = () => activate(b.dataset.tab));
    activate(avail[0].key);
  };

  /* -------- تسجيل القسم في الشريط الجانبي -------- */
  if (window.UA.viewsFor) window.UA.viewsFor.finance = 'المالية والمحاسبة';

})();

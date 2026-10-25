/* procurement.js — وحدة المشتريات والمخازن والأصول (v34) */
'use strict';
(function () {
  if (!window.UA) return;
  const api = window.UA.api ?? (async (m, u, b) => {
    const r = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined, credentials: 'same-origin' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw Object.assign(new Error(e.message || r.statusText), { code: e.code, status: r.status }); }
    return r.status === 204 ? {} : r.json();
  });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Number(n) || 0).toLocaleString('ar-SY');
  const $ = (s, ctx = document) => ctx.querySelector(s);
  const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];
  const STATUS = { draft: 'مسودة', pending: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض', ordered: 'مرسل', received: 'مستلم', cancelled: 'ملغى', available: 'متاح', in_use: 'قيد الاستخدام', maintenance: 'صيانة', disposed: 'مستبعد' };
  const BADGE = { draft: 'draft', pending: 'review', approved: 'success', rejected: 'danger', ordered: 'info', received: 'success', cancelled: 'danger', available: 'success', in_use: 'info', maintenance: 'warn', disposed: 'danger' };
  const badge = (s) => `<span class="badge badge-${BADGE[s] || 'default'}">${esc(STATUS[s] || s)}</span>`;

  function toast(msg, ok = true) {
    let t = document.getElementById('proc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'proc-toast'; t.style.cssText = 'position:fixed;bottom:1.2rem;left:1.2rem;padding:.65rem 1rem;border-radius:8px;color:#fff;z-index:9999;max-width:360px;direction:rtl'; document.body.appendChild(t); }
    t.style.background = ok ? '#16a34a' : '#dc2626'; t.textContent = msg; t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => t.style.display = 'none', 3500);
  }

  let _cache = { wh: [], sup: [], items: [], cats: [] };
  async function loadCache() {
    try {
      const [a, b, c, d] = await Promise.all([
        api('GET', '/api/procurement/warehouses').then(x => x.warehouses || []),
        api('GET', '/api/procurement/suppliers').then(x => x.suppliers || []),
        api('GET', '/api/procurement/categories').then(x => x.categories || []),
        api('GET', '/api/procurement/items').then(x => x.items || []),
      ]);
      _cache = { wh: a, sup: b, cats: c, items: d };
    } catch {}
  }
  const whOpts = (sel) => _cache.wh.map(x => `<option value="${x.id}" ${x.id == sel ? 'selected' : ''}>${esc(x.name)} (${esc(x.code)})</option>`).join('');
  const supOpts = (sel) => _cache.sup.map(x => `<option value="${x.id}" ${x.id == sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const catOpts = (sel) => _cache.cats.map(x => `<option value="${x.id}" ${x.id == sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const itemOpts = (sel) => _cache.items.map(x => `<option value="${x.id}" ${x.id == sel ? 'selected' : ''}>${esc(x.code)} — ${esc(x.name)} (رصيد: ${x.qtyOnHand})</option>`).join('');

  /* ===== نظرة عامة ===== */
  async function renderOverview(el) {
    el.innerHTML = '<p class="loading">جار التحميل…</p>';
    try {
      const d = await api('GET', '/api/procurement/overview');
      el.innerHTML = `
      <div class="proc-kpis">
        <div class="proc-kpi"><span class="kpi-l">المستودعات</span><strong>${fmt(d.warehouses)}</strong></div>
        <div class="proc-kpi"><span class="kpi-l">الموردون</span><strong>${fmt(d.suppliers)}</strong></div>
        <div class="proc-kpi"><span class="kpi-l">الأصناف</span><strong>${fmt(d.items)}</strong></div>
        <div class="proc-kpi ${d.lowStock ? 'kpi-warn' : ''}"><span class="kpi-l">أصناف دون الحد</span><strong>${fmt(d.lowStock)}</strong></div>
        <div class="proc-kpi"><span class="kpi-l">قيمة المخزون</span><strong class="ltr">${fmt(d.totalStockValue)}</strong></div>
        <div class="proc-kpi"><span class="kpi-l">طلبات معلقة</span><strong>${fmt(d.pendingRequests)}</strong></div>
        <div class="proc-kpi"><span class="kpi-l">أوامر مرسلة</span><strong>${fmt(d.pendingOrders)}</strong></div>
        <div class="proc-kpi"><span class="kpi-l">الأصول (غير مستبعدة)</span><strong>${fmt(d.totalAssets)}</strong></div>
      </div>
      <div class="proc-two">
        <div><h3>آخر طلبات الشراء</h3><table class="tbl"><thead><tr><th>الرقم</th><th>العنوان</th><th>الحالة</th></tr></thead><tbody>${d.recentRequests.map(x => `<tr><td class="mono">${esc(x.no)}</td><td>${esc(x.title)}</td><td>${badge(x.status)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">—</td></tr>'}</tbody></table></div>
        <div><h3>آخر أوامر التوريد</h3><table class="tbl"><thead><tr><th>الرقم</th><th>المورد</th><th>الحالة</th></tr></thead><tbody>${d.recentOrders.map(x => `<tr><td class="mono">${esc(x.no)}</td><td>${esc(x.supplierName)}</td><td>${badge(x.status)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">—</td></tr>'}</tbody></table></div>
      </div>`;
    } catch (e) { el.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }

  /* ===== المخازن ===== */
  async function renderWarehouses(el) {
    el.innerHTML = `<div class="proc-bar"><button class="btn btn-primary" id="proc-wh-new">+ مخزن جديد</button></div><div id="proc-wh-list"><p class="loading">…</p></div>`;
    $('#proc-wh-new', el).onclick = () => openWarehouseForm(el);
    await refreshWarehouses(el);
  }
  async function refreshWarehouses(el) {
    const list = $('#proc-wh-list', el); list.innerHTML = '<p class="loading">…</p>';
    try {
      const { warehouses } = await api('GET', '/api/procurement/warehouses');
      _cache.wh = warehouses;
      list.innerHTML = `<table class="tbl"><thead><tr><th>الرمز</th><th>الاسم</th><th>الموقع</th><th>المسؤول</th><th>الحالة</th><th></th></tr></thead><tbody>${warehouses.map(w => `<tr class="${!w.active ? 'row-muted' : ''}"><td class="mono">${esc(w.code)}</td><td>${esc(w.name)}</td><td>${esc(w.location || '—')}</td><td>${esc(w.managerName || '—')}</td><td>${w.active ? badge('available') : badge('disposed')}</td><td><button class="btn btn-sm proc-wh-edit" data-id="${w.id}">تعديل</button> <button class="btn btn-sm ${w.active ? 'btn-warn' : ''} proc-wh-toggle" data-id="${w.id}" data-a="${w.active ? 1 : 0}">${w.active ? 'تعطيل' : 'تفعيل'}</button> <button class="btn btn-sm btn-danger proc-wh-del" data-id="${w.id}">حذف</button></td></tr>`).join('')}</tbody></table>`;
      $$('.proc-wh-edit', list).forEach(b => b.onclick = () => openWarehouseForm(el, warehouses.find(x => x.id == b.dataset.id)));
      $$('.proc-wh-toggle', list).forEach(b => b.onclick = async () => { try { await api('POST', `/api/procurement/warehouses/${b.dataset.id}/toggle`, { active: b.dataset.a === '0' }); toast('تم التحديث'); refreshWarehouses(el); } catch (e) { toast(e.message, false); } });
      $$('.proc-wh-del', list).forEach(b => b.onclick = async () => { if (!confirm('حذف المخزن؟')) return; try { await api('DELETE', `/api/procurement/warehouses/${b.dataset.id}`); toast('تم الحذف'); refreshWarehouses(el); } catch (e) { toast(e.message, false); } });
    } catch (e) { list.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  function openWarehouseForm(parent, cur) {
    const dlg = document.createElement('dialog'); dlg.className = 'proc-dlg';
    dlg.innerHTML = `<h2>${cur ? 'تعديل مخزن' : 'مخزن جديد'}</h2><form id="proc-wh-frm"><label>الرمز <input name="code" class="inp" required maxlength="20" value="${esc(cur?.code || '')}"></label><label>الاسم <input name="name" class="inp full" required maxlength="80" value="${esc(cur?.name || '')}"></label><label>الموقع <input name="location" class="inp full" maxlength="120" value="${esc(cur?.location || '')}"></label><div class="dlg-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn btn-cancel" id="proc-wh-cancel">إلغاء</button></div></form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#proc-wh-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#proc-wh-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      const body = { code: f.code.value, name: f.name.value, location: f.location.value };
      try { if (cur) await api('PUT', `/api/procurement/warehouses/${cur.id}`, body); else await api('POST', '/api/procurement/warehouses', body); toast('تم الحفظ'); dlg.close(); dlg.remove(); refreshWarehouses(parent); } catch (e) { toast(e.message, false); }
    };
  }

  /* ===== الموردون ===== */
  async function renderSuppliers(el) {
    el.innerHTML = `<div class="proc-bar"><button class="btn btn-primary" id="proc-sup-new">+ مورد جديد</button> <input id="proc-sup-q" type="search" class="inp" placeholder="بحث بالاسم أو الرمز…"> <button class="btn" id="proc-sup-search">بحث</button></div><div id="proc-sup-list"><p class="loading">…</p></div>`;
    $('#proc-sup-new', el).onclick = () => openSupplierForm(el);
    $('#proc-sup-search', el).onclick = () => refreshSuppliers(el);
    $('#proc-sup-q', el).onkeydown = (e) => e.key === 'Enter' && refreshSuppliers(el);
    await refreshSuppliers(el);
  }
  async function refreshSuppliers(el) {
    const q = $('#proc-sup-q', el)?.value?.trim() || '';
    const list = $('#proc-sup-list', el); list.innerHTML = '<p class="loading">…</p>';
    try {
      const { suppliers } = await api('GET', `/api/procurement/suppliers${q ? '?q=' + encodeURIComponent(q) : ''}`);
      _cache.sup = suppliers;
      list.innerHTML = `<table class="tbl"><thead><tr><th>الرمز</th><th>الاسم</th><th>الهاتف</th><th>العنوان</th><th></th></tr></thead><tbody>${suppliers.map(s => `<tr class="${!s.active ? 'row-muted' : ''}"><td class="mono">${esc(s.code)}</td><td>${esc(s.name)}</td><td>${esc(s.phone || '—')}</td><td>${esc(s.address || '—')}</td><td><button class="btn btn-sm proc-sup-edit" data-id="${s.id}">تعديل</button> <button class="btn btn-sm proc-sup-toggle" data-id="${s.id}" data-a="${s.active ? 1 : 0}">${s.active ? 'تعطيل' : 'تفعيل'}</button> <button class="btn btn-sm btn-danger proc-sup-del" data-id="${s.id}">حذف</button></td></tr>`).join('')}</tbody></table>`;
      $$('.proc-sup-edit', list).forEach(b => b.onclick = () => openSupplierForm(el, suppliers.find(x => x.id == b.dataset.id)));
      $$('.proc-sup-toggle', list).forEach(b => b.onclick = async () => { try { await api('POST', `/api/procurement/suppliers/${b.dataset.id}/toggle`, { active: b.dataset.a === '0' }); toast('تم التحديث'); refreshSuppliers(el); } catch (e) { toast(e.message, false); } });
      $$('.proc-sup-del', list).forEach(b => b.onclick = async () => { if (!confirm('حذف المورد؟')) return; try { await api('DELETE', `/api/procurement/suppliers/${b.dataset.id}`); toast('تم الحذف'); refreshSuppliers(el); } catch (e) { toast(e.message, false); } });
    } catch (e) { list.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  function openSupplierForm(parent, cur) {
    const dlg = document.createElement('dialog'); dlg.className = 'proc-dlg';
    dlg.innerHTML = `<h2>${cur ? 'تعديل مورد' : 'مورد جديد'}</h2><form id="proc-sup-frm"><label>الرمز <input name="code" class="inp" required maxlength="20" value="${esc(cur?.code || '')}"></label><label>الاسم <input name="name" class="inp full" required maxlength="80" value="${esc(cur?.name || '')}"></label><label>الهاتف <input name="phone" class="inp" maxlength="30" value="${esc(cur?.phone || '')}"></label><label>البريد <input name="email" type="email" class="inp" maxlength="80" value="${esc(cur?.email || '')}"></label><label>العنوان <input name="address" class="inp full" maxlength="120" value="${esc(cur?.address || '')}"></label><label>الرقم الضريبي <input name="taxNo" class="inp" maxlength="30" value="${esc(cur?.taxNo || '')}"></label><div class="dlg-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn btn-cancel" id="proc-sup-cancel">إلغاء</button></div></form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#proc-sup-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#proc-sup-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      const body = { code: f.code.value, name: f.name.value, phone: f.phone.value, email: f.email.value, address: f.address.value, taxNo: f.taxNo.value };
      try { if (cur) await api('PUT', `/api/procurement/suppliers/${cur.id}`, body); else await api('POST', '/api/procurement/suppliers', body); toast('تم الحفظ'); dlg.close(); dlg.remove(); refreshSuppliers(parent); } catch (e) { toast(e.message, false); }
    };
  }

  /* ===== الأصناف ===== */
  async function renderItems(el) {
    el.innerHTML = `<div class="proc-bar"><button class="btn btn-primary" id="proc-item-new">+ صنف جديد</button> <input id="proc-item-q" type="search" class="inp" placeholder="بحث…"> <select id="proc-item-wh" class="inp"><option value="">كل المستودعات</option>${whOpts()}</select> <label style="display:inline-flex;align-items:center;gap:.3rem"><input type="checkbox" id="proc-item-low"> دون الحد فقط</label> <button class="btn" id="proc-item-search">بحث</button> <a class="btn" id="proc-item-xlsx" href="/api/procurement/items.xlsx">تصدير Excel</a></div><div id="proc-item-list"><p class="loading">…</p></div>`;
    $('#proc-item-new', el).onclick = () => openItemForm(el);
    const doSearch = () => refreshItems(el);
    $('#proc-item-search', el).onclick = doSearch;
    $('#proc-item-q', el).onkeydown = (e) => e.key === 'Enter' && doSearch();
    await refreshItems(el);
  }
  async function refreshItems(el) {
    const q = $('#proc-item-q', el)?.value?.trim() || '', wh = $('#proc-item-wh', el)?.value || '', low = $('#proc-item-low', el)?.checked ? '1' : '';
    const params = new URLSearchParams(); if (q) params.set('q', q); if (wh) params.set('warehouse', wh); if (low) params.set('low', '1');
    const list = $('#proc-item-list', el); list.innerHTML = '<p class="loading">…</p>';
    try {
      const { items } = await api('GET', `/api/procurement/items?${params}`);
      list.innerHTML = `<table class="tbl"><thead><tr><th>الرمز</th><th>الصنف</th><th>التصنيف</th><th>المستودع</th><th>الرصيد</th><th>متوسط التكلفة</th><th>القيمة</th><th>الحد الأدنى</th><th></th></tr></thead><tbody>${items.map(it => `<tr class="${!it.active ? 'row-muted' : it.low ? 'row-warn' : ''}"><td class="mono">${esc(it.code)}</td><td>${esc(it.name)} <span class="mono small">${esc(it.unit)}</span>${it.low ? ' <span class="badge badge-danger">دون الحد</span>' : ''}</td><td>${esc(it.categoryName || '—')}</td><td>${esc(it.warehouseName || '—')}</td><td class="ltr ${it.low ? 'g-err' : ''}">${fmt(it.qtyOnHand)}</td><td class="ltr">${fmt(it.avgCost)}</td><td class="ltr">${fmt(it.qtyOnHand * it.avgCost)}</td><td class="ltr">${fmt(it.minStock)}</td><td><button class="btn btn-sm proc-item-edit" data-id="${it.id}">تعديل</button> <button class="btn btn-sm btn-danger proc-item-del" data-id="${it.id}">حذف</button></td></tr>`).join('')}</tbody></table>`;
      const allItems = items;
      $$('.proc-item-edit', list).forEach(b => b.onclick = () => openItemForm(el, allItems.find(x => x.id == b.dataset.id)));
      $$('.proc-item-del', list).forEach(b => b.onclick = async () => { if (!confirm('حذف الصنف؟')) return; try { await api('DELETE', `/api/procurement/items/${b.dataset.id}`); toast('تم الحذف'); refreshItems(el); } catch (e) { toast(e.message, false); } });
    } catch (e) { list.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  function openItemForm(parent, cur) {
    const dlg = document.createElement('dialog'); dlg.className = 'proc-dlg';
    dlg.innerHTML = `<h2>${cur ? 'تعديل صنف' : 'صنف جديد'}</h2><form id="proc-item-frm"><label>الرمز <input name="code" class="inp" required maxlength="20" value="${esc(cur?.code || '')}"></label><label>الاسم <input name="name" class="inp full" required maxlength="80" value="${esc(cur?.name || '')}"></label><label>التصنيف <select name="categoryId" class="inp"><option value="">—</option>${catOpts(cur?.categoryId)}</select></label><label>المستودع <select name="warehouseId" class="inp"><option value="">—</option>${whOpts(cur?.warehouseId)}</select></label><label>الوحدة <input name="unit" class="inp" maxlength="20" value="${esc(cur?.unit || 'قطعة')}"></label><label>الحد الأدنى <input name="minStock" type="number" min="0" class="inp" value="${cur?.minStock ?? 0}"></label><label>الحد الأقصى <input name="maxStock" type="number" min="0" class="inp" value="${cur?.maxStock ?? 0}"></label><label>ملاحظات <input name="notes" class="inp full" maxlength="300" value="${esc(cur?.notes || '')}"></label><div class="dlg-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn btn-cancel" id="proc-item-cancel">إلغاء</button></div></form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#proc-item-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#proc-item-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      const body = { code: f.code.value, name: f.name.value, categoryId: f.categoryId.value || null, warehouseId: f.warehouseId.value || null, unit: f.unit.value, minStock: Number(f.minStock.value) || 0, maxStock: Number(f.maxStock.value) || 0, notes: f.notes.value };
      try { if (cur) await api('PUT', `/api/procurement/items/${cur.id}`, body); else await api('POST', '/api/procurement/items', body); toast('تم الحفظ'); dlg.close(); dlg.remove(); refreshItems(parent); } catch (e) { toast(e.message, false); }
    };
  }

  /* ===== طلبات الشراء ===== */
  async function renderRequests(el) {
    el.innerHTML = `<div class="proc-bar"><button class="btn btn-primary" id="proc-req-new">+ طلب شراء</button> <select id="proc-req-status" class="inp"><option value="">كل الحالات</option><option value="draft">مسودة</option><option value="pending">قيد المراجعة</option><option value="approved">معتمد</option><option value="rejected">مرفوض</option><option value="ordered">تم توريد أمر</option><option value="cancelled">ملغى</option></select> <button class="btn" id="proc-req-search">تحديث</button></div><div id="proc-req-list"><p class="loading">…</p></div><div id="proc-req-detail"></div>`;
    $('#proc-req-new', el).onclick = () => openRequestForm(el);
    $('#proc-req-search', el).onclick = () => refreshRequests(el);
    await refreshRequests(el);
  }
  async function refreshRequests(el) {
    const status = $('#proc-req-status', el)?.value || '';
    const list = $('#proc-req-list', el); list.innerHTML = '<p class="loading">…</p>';
    try {
      const { requests } = await api('GET', `/api/procurement/requests${status ? '?status=' + status : ''}`);
      list.innerHTML = `<table class="tbl"><thead><tr><th>الرقم</th><th>العنوان</th><th>الطالب</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead><tbody>${requests.map(r => `<tr><td class="mono">${esc(r.no)}</td><td>${esc(r.title)}</td><td>${esc(r.requesterName || '—')}</td><td>${badge(r.status)}</td><td>${new Date(r.createdAt).toLocaleDateString('ar-SY')}</td><td><button class="btn btn-sm proc-req-open" data-id="${r.id}">عرض</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">—</td></tr>'}</tbody></table>`;
      $$('.proc-req-open', list).forEach(b => b.onclick = () => openRequestDetail(el, b.dataset.id));
    } catch (e) { list.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  async function openRequestDetail(parent, id) {
    const det = $('#proc-req-detail', parent); det.innerHTML = '<p class="loading">…</p>';
    try {
      const { request: r } = await api('GET', `/api/procurement/requests/${id}`);
      det.innerHTML = `<div class="proc-detail card"><h3>${esc(r.no)} — ${esc(r.title)}</h3><p>${badge(r.status)} | ${esc(r.requesterName || '')} | ${new Date(r.createdAt).toLocaleString('ar-SY')}</p>
        <p>${esc(r.description || '—')}</p>
        <table class="tbl"><thead><tr><th>الوصف</th><th>الصنف</th><th>الكمية</th><th>التكلفة التقديرية</th></tr></thead><tbody>${r.lines.map(l => `<tr><td>${esc(l.description)}</td><td>${esc(l.itemName || '—')}</td><td class="ltr">${fmt(l.qty)}</td><td class="ltr">${fmt(l.estCost)}</td></tr>`).join('')}</tbody></table>
        ${r.decisionNote ? `<p class="hint">قرار: ${esc(r.decisionNote)}</p>` : ''}
        <div class="dlg-actions">
          ${r.status === 'draft' ? `<button class="btn btn-primary proc-req-submit" data-id="${r.id}">إرسال للمراجعة</button> <button class="btn proc-req-edit" data-id="${r.id}">تعديل</button> <button class="btn btn-danger proc-req-cancel" data-id="${r.id}">إلغاء</button>` : ''}
          ${r.status === 'pending' ? `<button class="btn btn-primary proc-req-approve" data-id="${r.id}">اعتماد</button> <button class="btn btn-danger proc-req-reject" data-id="${r.id}">رفض</button>` : ''}
          ${r.status === 'approved' ? `<button class="btn btn-primary proc-req-order" data-id="${r.id}">إنشاء أمر توريد</button>` : ''}
        </div>
      </div>`;
      $('.proc-req-submit', det)?.addEventListener('click', async () => { try { await api('POST', `/api/procurement/requests/${id}/submit`); toast('تم الإرسال'); refreshRequests(parent); det.innerHTML = ''; } catch (e) { toast(e.message, false); } });
      $('.proc-req-cancel', det)?.addEventListener('click', async () => { if (!confirm('إلغاء الطلب؟')) return; try { await api('POST', `/api/procurement/requests/${id}/cancel`); toast('تم الإلغاء'); refreshRequests(parent); det.innerHTML = ''; } catch (e) { toast(e.message, false); } });
      $('.proc-req-approve', det)?.addEventListener('click', async () => { try { await api('POST', `/api/procurement/requests/${id}/approve`, {}); toast('تم الاعتماد'); refreshRequests(parent); det.innerHTML = ''; } catch (e) { toast(e.message, false); } });
      $('.proc-req-reject', det)?.addEventListener('click', async () => { const note = prompt('سبب الرفض:'); if (note === null) return; try { await api('POST', `/api/procurement/requests/${id}/reject`, { note }); toast('تم الرفض'); refreshRequests(parent); det.innerHTML = ''; } catch (e) { toast(e.message, false); } });
      $('.proc-req-order', det)?.addEventListener('click', () => openOrderForm(parent, r.id));
      $('.proc-req-edit', det)?.addEventListener('click', () => openRequestForm(parent, r));
    } catch (e) { det.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  function openRequestForm(parent, cur) {
    const isEdit = !!cur;
    const dlg = document.createElement('dialog'); dlg.className = 'proc-dlg proc-req-form';
    const linesHtml = isEdit ? cur.lines.map(l => reqLineRow(l)).join('') : reqLineRow() + reqLineRow();
    dlg.innerHTML = `<h2>${isEdit ? 'تعديل طلب شراء' : 'طلب شراء جديد'}</h2><form id="proc-req-frm"><label>العنوان <input name="title" class="inp full" required maxlength="100" value="${esc(cur?.title || '')}"></label><label>الوصف <textarea name="description" class="inp full" maxlength="500" rows="2">${esc(cur?.description || '')}</textarea></label><label>المستودع <select name="warehouseId" class="inp"><option value="">—</option>${whOpts(cur?.warehouseId)}</select></label><h3>البنود <button type="button" class="btn btn-sm" id="proc-req-add-line">+ بند</button></h3><table class="tbl" id="proc-req-lines"><thead><tr><th>الوصف</th><th>الصنف (اختياري)</th><th>الكمية</th><th>تكلفة تقديرية</th><th></th></tr></thead><tbody>${linesHtml}</tbody></table><div class="dlg-actions"><button type="submit" name="act" value="draft" class="btn">حفظ مسودة</button><button type="submit" name="act" value="submit" class="btn btn-primary">حفظ وإرسال</button><button type="button" class="btn btn-cancel" id="proc-req-cancel">إلغاء</button></div></form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#proc-req-add-line', dlg).onclick = () => $('tbody', $('#proc-req-lines', dlg)).insertAdjacentHTML('beforeend', reqLineRow());
    dlg.addEventListener('click', (e) => { if (e.target.closest('.proc-req-rem')) e.target.closest('tr').remove(); });
    $('#proc-req-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#proc-req-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault(); const submit = ev.submitter?.value === 'submit';
      const lines = [...$$('tbody tr', $('#proc-req-lines', dlg))].map(tr => ({ description: $('.rl-desc', tr).value, itemId: $('.rl-item', tr).value || null, qty: Number($('.rl-qty', tr).value) || 0, estCost: Number($('.rl-cost', tr).value) || 0 }));
      const body = { title: ev.target.title.value, description: ev.target.description.value, warehouseId: ev.target.warehouseId.value || null, lines, submit };
      try {
        if (isEdit) await api('PUT', `/api/procurement/requests/${cur.id}`, body);
        else await api('POST', '/api/procurement/requests', body);
        toast(submit ? 'تم الإرسال' : 'تم الحفظ'); dlg.close(); dlg.remove(); refreshRequests(parent);
      } catch (e) { toast(e.message, false); }
    };
  }
  function reqLineRow(l) {
    return `<tr><td><input class="inp rl-desc" required maxlength="100" value="${esc(l?.description || '')}" placeholder="وصف البند"></td><td><select class="inp rl-item"><option value="">—</option>${itemOpts(l?.itemId)}</select></td><td><input class="inp rl-qty" type="number" min="1" required value="${l?.qty || ''}" style="width:80px"></td><td><input class="inp rl-cost" type="number" min="0" value="${l?.estCost || ''}" style="width:100px"></td><td><button type="button" class="btn btn-sm btn-danger proc-req-rem">✕</button></td></tr>`;
  }

  /* ===== أوامر التوريد ===== */
  async function renderOrders(el) {
    el.innerHTML = `<div class="proc-bar"><button class="btn btn-primary" id="proc-ord-new">+ أمر توريد</button> <select id="proc-ord-status" class="inp"><option value="">كل الحالات</option><option value="draft">مسودة</option><option value="ordered">مرسل</option><option value="received">مستلم</option><option value="cancelled">ملغى</option></select> <button class="btn" id="proc-ord-refresh">تحديث</button></div><div id="proc-ord-list"><p class="loading">…</p></div><div id="proc-ord-detail"></div>`;
    $('#proc-ord-new', el).onclick = () => openOrderForm(el);
    $('#proc-ord-refresh', el).onclick = () => refreshOrders(el);
    await refreshOrders(el);
  }
  async function refreshOrders(el) {
    const status = $('#proc-ord-status', el)?.value || '';
    const list = $('#proc-ord-list', el); list.innerHTML = '<p class="loading">…</p>';
    try {
      const { orders } = await api('GET', `/api/procurement/orders${status ? '?status=' + status : ''}`);
      list.innerHTML = `<table class="tbl"><thead><tr><th>الرقم</th><th>المورد</th><th>طلب الشراء</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead><tbody>${orders.map(o => `<tr><td class="mono">${esc(o.no)}</td><td>${esc(o.supplierName)}</td><td>${esc(o.requestNo || '—')}</td><td class="ltr">${fmt(o.totalAmount)}</td><td>${badge(o.status)}</td><td><button class="btn btn-sm proc-ord-open" data-id="${o.id}">عرض</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">—</td></tr>'}</tbody></table>`;
      $$('.proc-ord-open', list).forEach(b => b.onclick = () => openOrderDetail(el, b.dataset.id));
    } catch (e) { list.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  async function openOrderDetail(parent, id) {
    const det = $('#proc-ord-detail', parent); det.innerHTML = '<p class="loading">…</p>';
    try {
      const { order: o } = await api('GET', `/api/procurement/orders/${id}`);
      det.innerHTML = `<div class="proc-detail card"><h3>${esc(o.no)}</h3><p>المورد: ${esc(o.supplierName)} | ${badge(o.status)} | ${fmt(o.totalAmount)}</p><table class="tbl"><thead><tr><th>الوصف</th><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${o.lines.map(l => `<tr><td>${esc(l.description)}</td><td>${esc(l.itemName || '—')}</td><td class="ltr">${fmt(l.qty)}</td><td class="ltr">${fmt(l.unitCost)}</td><td class="ltr">${fmt(l.lineTotal)}</td></tr>`).join('')}</tbody></table><p>${esc(o.note || '')}</p><div class="dlg-actions">${o.status === 'draft' ? `<button class="btn btn-primary proc-ord-send" data-id="${o.id}">إرسال للمورد</button> <button class="btn btn-danger proc-ord-cancel" data-id="${o.id}">إلغاء</button>` : ''}${o.status === 'ordered' ? `<button class="btn btn-primary proc-ord-recv" data-id="${o.id}">تسجيل الاستلام</button> <button class="btn btn-danger proc-ord-cancel" data-id="${o.id}">إلغاء</button>` : ''}</div></div>`;
      $('.proc-ord-send', det)?.addEventListener('click', async () => { try { await api('POST', `/api/procurement/orders/${id}/order`); toast('تم الإرسال'); refreshOrders(parent); det.innerHTML = ''; } catch (e) { toast(e.message, false); } });
      $('.proc-ord-cancel', det)?.addEventListener('click', async () => { if (!confirm('إلغاء الأمر؟')) return; try { await api('POST', `/api/procurement/orders/${id}/cancel`); toast('تم الإلغاء'); refreshOrders(parent); det.innerHTML = ''; } catch (e) { toast(e.message, false); } });
      $('.proc-ord-recv', det)?.addEventListener('click', () => openReceiptForm(parent, o));
    } catch (e) { det.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  function openOrderForm(parent, requestId) {
    const dlg = document.createElement('dialog'); dlg.className = 'proc-dlg proc-ord-form';
    dlg.innerHTML = `<h2>أمر توريد جديد</h2><form id="proc-ord-frm"><label>المورد <select name="supplierId" class="inp" required><option value="">— اختر مورداً —</option>${supOpts()}</select></label><label>مرتبط بطلب شراء (اختياري) <input name="requestId" type="number" class="inp" value="${requestId || ''}" placeholder="رقم الطلب"></label><label>ملاحظات <input name="note" class="inp full" maxlength="300"></label><h3>البنود <button type="button" class="btn btn-sm" id="proc-ord-add-line">+ بند</button></h3><table class="tbl" id="proc-ord-lines"><thead><tr><th>الوصف</th><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th></th></tr></thead><tbody>${ordLineRow()}${ordLineRow()}</tbody></table><div class="dlg-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn btn-cancel" id="proc-ord-cancel">إلغاء</button></div></form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#proc-ord-add-line', dlg).onclick = () => $('tbody', $('#proc-ord-lines', dlg)).insertAdjacentHTML('beforeend', ordLineRow());
    dlg.addEventListener('click', (e) => { if (e.target.closest('.proc-ord-rem')) e.target.closest('tr').remove(); });
    $('#proc-ord-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#proc-ord-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault();
      const lines = [...$$('tbody tr', $('#proc-ord-lines', dlg))].map(tr => ({ description: $('.ol-desc', tr).value, itemId: $('.ol-item', tr).value || null, qty: Number($('.ol-qty', tr).value) || 0, unitCost: Number($('.ol-cost', tr).value) || 0 }));
      const body = { supplierId: Number(ev.target.supplierId.value), requestId: ev.target.requestId.value || null, note: ev.target.note.value, lines };
      try { await api('POST', '/api/procurement/orders', body); toast('تم إنشاء أمر التوريد'); dlg.close(); dlg.remove(); refreshOrders(parent); } catch (e) { toast(e.message, false); }
    };
  }
  function ordLineRow() { return `<tr><td><input class="inp ol-desc" required maxlength="100" placeholder="الوصف"></td><td><select class="inp ol-item"><option value="">—</option>${itemOpts()}</select></td><td><input class="inp ol-qty" type="number" min="1" required style="width:80px"></td><td><input class="inp ol-cost" type="number" min="0" required style="width:100px"></td><td><button type="button" class="btn btn-sm btn-danger proc-ord-rem">✕</button></td></tr>`; }
  function openReceiptForm(parent, order) {
    const dlg = document.createElement('dialog'); dlg.className = 'proc-dlg';
    const rows = order.lines.map(l => `<tr><td>${esc(l.description)}</td><td><select class="inp rl-item-req"><option value="">— اختر صنفاً —</option>${itemOpts(l.itemId)}</select></td><td><input class="inp rl-qty-req" type="number" min="1" value="${l.qty}" style="width:80px"></td><td><input class="inp rl-cost-req" type="number" min="0" value="${l.unitCost}" style="width:100px"></td></tr>`).join('');
    dlg.innerHTML = `<h2>استلام توريد — ${esc(order.no)}</h2><form id="proc-recv-frm"><table class="tbl" id="proc-recv-lines"><thead><tr><th>الوصف</th><th>الصنف (إلزامي)</th><th>الكمية المستلمة</th><th>سعر الوحدة</th></tr></thead><tbody>${rows}</tbody></table><label>ملاحظات <input name="note" class="inp full" maxlength="300"></label><div class="dlg-actions"><button type="submit" class="btn btn-primary">تأكيد الاستلام</button><button type="button" class="btn btn-cancel" id="proc-recv-cancel">إلغاء</button></div></form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#proc-recv-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#proc-recv-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault();
      const lines = [...$$('tbody tr', $('#proc-recv-lines', dlg))].map(tr => ({ itemId: $('.rl-item-req', tr).value, qty: Number($('.rl-qty-req', tr).value) || 0, unitCost: Number($('.rl-cost-req', tr).value) || 0 })).filter(x => x.itemId && x.qty > 0);
      if (!lines.length) { toast('حدد صنفاً وكمية صحيحة لكل بند', false); return; }
      try { await api('POST', '/api/procurement/receipts', { orderId: order.id, note: ev.target.note.value, lines }); toast('تم تسجيل الاستلام'); dlg.close(); dlg.remove(); refreshOrders(parent); } catch (e) { toast(e.message, false); }
    };
  }

  /* ===== الحركة المخزنية (صرف) ===== */
  async function renderStock(el) {
    el.innerHTML = `
    <div class="gsub"><button class="gsubbtn active" data-tab="issue">صرف مخزني</button><button class="gsubbtn" data-tab="receipts">سجل الاستلام</button></div>
    <div id="proc-stock-body"></div>`;
    const body = $('#proc-stock-body', el);
    const activate = (t) => {
      $$('.gsubbtn', el).forEach(b => b.classList.toggle('active', b.dataset.tab === t));
      if (t === 'issue') renderIssues(body);
      else renderReceipts(body);
    };
    $$('.gsubbtn', el).forEach(b => b.onclick = () => activate(b.dataset.tab));
    activate('issue');
  }
  async function renderIssues(el) {
    el.innerHTML = `<div class="proc-bar"><button class="btn btn-primary" id="proc-issue-new">+ صرف مخزني</button> <button class="btn" id="proc-issue-refresh">تحديث</button></div><div id="proc-issue-list"><p class="loading">…</p></div>`;
    $('#proc-issue-new', el).onclick = () => openIssueForm(el);
    $('#proc-issue-refresh', el).onclick = () => loadIssues(el);
    await loadIssues(el);
  }
  async function loadIssues(el) {
    const list = $('#proc-issue-list', el); list.innerHTML = '<p class="loading">…</p>';
    try {
      const { issues } = await api('GET', '/api/procurement/issues');
      list.innerHTML = `<table class="tbl"><thead><tr><th>الرقم</th><th>المستودع</th><th>الجهة</th><th>الغرض</th><th>التاريخ</th><th>البنود</th></tr></thead><tbody>${issues.map(x => `<tr><td class="mono">${esc(x.no)}</td><td>${esc(x.warehouseName)}</td><td>${esc(x.issuedTo)}</td><td>${esc(x.purpose || '—')}</td><td>${new Date(x.issuedAt).toLocaleDateString('ar-SY')}</td><td>${x.lines.map(l => `${esc(l.itemCode)} × ${l.qty}`).join('، ')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">—</td></tr>'}</tbody></table>`;
    } catch (e) { list.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  function openIssueForm(parent) {
    const dlg = document.createElement('dialog'); dlg.className = 'proc-dlg';
    dlg.innerHTML = `<h2>صرف مخزني</h2><form id="proc-issue-frm"><label>المستودع <select name="warehouseId" class="inp" required><option value="">—</option>${whOpts()}</select></label><label>الجهة المستلمة <input name="issuedTo" class="inp" required maxlength="60"></label><label>الغرض <input name="purpose" class="inp full" maxlength="200"></label><h3>البنود <button type="button" class="btn btn-sm" id="proc-issue-add">+ بند</button></h3><table class="tbl" id="proc-issue-lines"><thead><tr><th>الصنف</th><th>الكمية</th><th></th></tr></thead><tbody>${issueRow()}${issueRow()}</tbody></table><div class="dlg-actions"><button type="submit" class="btn btn-primary">تأكيد الصرف</button><button type="button" class="btn btn-cancel" id="proc-issue-cancel">إلغاء</button></div></form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#proc-issue-add', dlg).onclick = () => $('tbody', $('#proc-issue-lines', dlg)).insertAdjacentHTML('beforeend', issueRow());
    dlg.addEventListener('click', (e) => { if (e.target.closest('.proc-issue-rem')) e.target.closest('tr').remove(); });
    $('#proc-issue-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#proc-issue-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault();
      const lines = [...$$('tbody tr', $('#proc-issue-lines', dlg))].map(tr => ({ itemId: $('.il-item', tr).value, qty: Number($('.il-qty', tr).value) || 0 })).filter(x => x.itemId && x.qty > 0);
      if (!lines.length) { toast('أضف بنداً واحداً على الأقل', false); return; }
      try { await api('POST', '/api/procurement/issues', { warehouseId: Number(ev.target.warehouseId.value), issuedTo: ev.target.issuedTo.value, purpose: ev.target.purpose.value, lines }); toast('تم الصرف'); dlg.close(); dlg.remove(); loadIssues(parent); } catch (e) { toast(e.message, false); }
    };
  }
  function issueRow() { return `<tr><td><select class="inp il-item" required><option value="">— اختر صنفاً —</option>${itemOpts()}</select></td><td><input class="inp il-qty" type="number" min="1" required style="width:100px"></td><td><button type="button" class="btn btn-sm btn-danger proc-issue-rem">✕</button></td></tr>`; }
  async function renderReceipts(el) {
    el.innerHTML = '<p class="loading">…</p>';
    try {
      const { receipts } = await api('GET', '/api/procurement/receipts');
      el.innerHTML = `<table class="tbl"><thead><tr><th>أمر التوريد</th><th>المورد</th><th>التاريخ</th><th>البنود</th></tr></thead><tbody>${receipts.map(r => `<tr><td class="mono">${esc(r.orderNo)}</td><td>${esc(r.supplierName)}</td><td>${new Date(r.receivedAt).toLocaleDateString('ar-SY')}</td><td>${r.lines.map(l => `${esc(l.itemCode)} × ${l.qty}`).join('، ')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">—</td></tr>'}</tbody></table>`;
    } catch (e) { el.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }

  /* ===== الأصول ===== */
  async function renderAssets(el) {
    el.innerHTML = `<div class="proc-bar"><button class="btn btn-primary" id="proc-asset-new">+ أصل جديد</button> <input id="proc-asset-q" type="search" class="inp" placeholder="بحث بالاسم أو الرمز…"> <select id="proc-asset-status" class="inp"><option value="">كل الحالات</option><option value="available">متاح</option><option value="in_use">قيد الاستخدام</option><option value="maintenance">صيانة</option><option value="disposed">مستبعد</option></select> <button class="btn" id="proc-asset-search">بحث</button></div><div id="proc-asset-list"><p class="loading">…</p></div><div id="proc-asset-detail"></div>`;
    $('#proc-asset-new', el).onclick = () => openAssetForm(el);
    $('#proc-asset-search', el).onclick = () => refreshAssets(el);
    $('#proc-asset-q', el).onkeydown = (e) => e.key === 'Enter' && refreshAssets(el);
    await refreshAssets(el);
  }
  async function refreshAssets(el) {
    const q = $('#proc-asset-q', el)?.value?.trim() || '', st = $('#proc-asset-status', el)?.value || '';
    const params = new URLSearchParams(); if (q) params.set('q', q); if (st) params.set('status', st);
    const list = $('#proc-asset-list', el); list.innerHTML = '<p class="loading">…</p>';
    try {
      const { assets } = await api('GET', `/api/procurement/assets?${params}`);
      list.innerHTML = `<table class="tbl"><thead><tr><th>الرمز</th><th>الاسم</th><th>التصنيف</th><th>المستودع</th><th>الحالة</th><th>التكلفة</th><th>المخصص له</th><th></th></tr></thead><tbody>${assets.map(a => `<tr><td class="mono">${esc(a.code)}</td><td>${esc(a.name)}</td><td>${esc(a.category)}</td><td>${esc(a.warehouseName || '—')}</td><td>${badge(a.status)}</td><td class="ltr">${fmt(a.cost)}</td><td>${esc(a.assignedTo || '—')}</td><td><button class="btn btn-sm proc-asset-open" data-id="${a.id}">عرض</button> <button class="btn btn-sm proc-asset-edit" data-id="${a.id}">تعديل</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">—</td></tr>'}</tbody></table>`;
      $$('.proc-asset-open', list).forEach(b => b.onclick = () => openAssetDetail(el, b.dataset.id));
      $$('.proc-asset-edit', list).forEach(b => b.onclick = () => { const a = assets.find(x => x.id == b.dataset.id); if (a) openAssetForm(el, a); });
    } catch (e) { list.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  async function openAssetDetail(parent, id) {
    const det = $('#proc-asset-detail', parent); det.innerHTML = '<p class="loading">…</p>';
    try {
      const { assets } = await api('GET', `/api/procurement/assets`);
      const a = assets.find(x => x.id == id); if (!a) return;
      det.innerHTML = `<div class="proc-detail card"><h3>${esc(a.code)} — ${esc(a.name)}</h3><p>${badge(a.status)} | ${esc(a.category)} | ${esc(a.warehouseName || '—')} | ${fmt(a.cost)}</p><p>المخصص له: ${esc(a.assignedTo || '—')} | المورد: ${esc(a.supplierName || '—')}</p><p>${esc(a.notes || '')}</p><div class="dlg-actions"><button class="btn proc-asset-move" data-id="${a.id}">نقل / حركة</button> <button class="btn btn-danger proc-asset-del" data-id="${a.id}">حذف</button></div></div>`;
      $('.proc-asset-move', det).onclick = () => openAssetMove(parent, a);
      $('.proc-asset-del', det).onclick = async () => { if (!confirm('حذف الأصل؟')) return; try { await api('DELETE', `/api/procurement/assets/${a.id}`); toast('تم الحذف'); refreshAssets(parent); det.innerHTML = ''; } catch (e) { toast(e.message, false); } };
    } catch (e) { det.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  function openAssetForm(parent, cur) {
    const dlg = document.createElement('dialog'); dlg.className = 'proc-dlg';
    dlg.innerHTML = `<h2>${cur ? 'تعديل أصل' : 'أصل جديد'}</h2><form id="proc-asset-frm"><label>الرمز <input name="code" class="inp" required maxlength="20" value="${esc(cur?.code || '')}"></label><label>الاسم <input name="name" class="inp full" required maxlength="80" value="${esc(cur?.name || '')}"></label><label>التصنيف <input name="category" class="inp" maxlength="30" value="${esc(cur?.category || 'عام')}"></label><label>المستودع <select name="warehouseId" class="inp"><option value="">—</option>${whOpts(cur?.warehouseId)}</select></label><label>الحالة <select name="status" class="inp"><option value="available" ${cur?.status === 'available' ? 'selected' : ''}>متاح</option><option value="in_use" ${cur?.status === 'in_use' ? 'selected' : ''}>قيد الاستخدام</option><option value="maintenance" ${cur?.status === 'maintenance' ? 'selected' : ''}>صيانة</option><option value="disposed" ${cur?.status === 'disposed' ? 'selected' : ''}>مستبعد</option></select></label><label>تاريخ الشراء <input name="purchaseDay" type="date" class="inp" value="${cur?.purchaseDay || ''}"></label><label>التكلفة <input name="cost" type="number" min="0" class="inp" value="${cur?.cost ?? ''}"></label><label>المورد <select name="supplierId" class="inp"><option value="">—</option>${supOpts(cur?.supplierId)}</select></label><label>المخصص له <input name="assignedTo" class="inp" maxlength="80" value="${esc(cur?.assignedTo || '')}"></label><label>ملاحظات <input name="notes" class="inp full" maxlength="300" value="${esc(cur?.notes || '')}"></label><div class="dlg-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn btn-cancel" id="proc-asset-cancel">إلغاء</button></div></form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#proc-asset-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#proc-asset-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      const body = { code: f.code.value, name: f.name.value, category: f.category.value, warehouseId: f.warehouseId.value || null, status: f.status.value, purchaseDay: f.purchaseDay.value || null, cost: Number(f.cost.value) || 0, supplierId: f.supplierId.value || null, assignedTo: f.assignedTo.value, notes: f.notes.value };
      try { if (cur) await api('PUT', `/api/procurement/assets/${cur.id}`, body); else await api('POST', '/api/procurement/assets', body); toast('تم الحفظ'); dlg.close(); dlg.remove(); refreshAssets(parent); } catch (e) { toast(e.message, false); }
    };
  }
  function openAssetMove(parent, asset) {
    const dlg = document.createElement('dialog'); dlg.className = 'proc-dlg';
    dlg.innerHTML = `<h2>حركة أصل — ${esc(asset.code)}</h2><form id="proc-move-frm"><label>نوع الحركة <select name="kind" class="inp"><option value="transfer">نقل إلى مستودع</option><option value="maintenance">إرسال للصيانة</option><option value="return">إعادة إلى متاح</option><option value="dispose">استبعاد نهائي</option></select></label><label>المستودع الهدف (للنقل) <select name="toWarehouseId" class="inp"><option value="">—</option>${whOpts()}</select></label><label>إلى المستخدم <input name="toUser" class="inp" maxlength="80"></label><label>السبب <input name="reason" class="inp full" maxlength="200"></label><div class="dlg-actions"><button type="submit" class="btn btn-primary">تأكيد</button><button type="button" class="btn btn-cancel" id="proc-move-cancel">إلغاء</button></div></form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $('#proc-move-cancel', dlg).onclick = () => { dlg.close(); dlg.remove(); };
    $('#proc-move-frm', dlg).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try { await api('POST', `/api/procurement/assets/${asset.id}/move`, { kind: f.kind.value, toWarehouseId: f.toWarehouseId.value || null, toUser: f.toUser.value, reason: f.reason.value }); toast('تم تسجيل الحركة'); dlg.close(); dlg.remove(); refreshAssets(parent); } catch (e) { toast(e.message, false); }
    };
  }

  /* ===== التبويبات ===== */
  const TABS = [
    { key: 'overview', label: 'نظرة عامة', icon: '📊', render: renderOverview, perm: 'procurement:read' },
    { key: 'warehouses', label: 'المستودعات', icon: '🏬', render: renderWarehouses, perm: 'procurement:manage' },
    { key: 'suppliers', label: 'الموردون', icon: '🏢', render: renderSuppliers, perm: 'procurement:manage' },
    { key: 'items', label: 'الأصناف والمخزون', icon: '📦', render: renderItems, perm: 'procurement:read' },
    { key: 'requests', label: 'طلبات الشراء', icon: '📝', render: renderRequests, perm: 'procurement:read' },
    { key: 'orders', label: 'أوامر التوريد', icon: '📋', render: renderOrders, perm: 'procurement:read' },
    { key: 'stock', label: 'الحركة المخزنية', icon: '↔️', render: renderStock, perm: 'procurement:stock' },
    { key: 'assets', label: 'الأصول الثابتة', icon: '🏛️', render: renderAssets, perm: 'procurement:assets' },
  ];

  UA.views.procurement = async function (el, user) {
    await loadCache();
    const perms = user?.permissions ?? [], role = user?.role;
    const avail = TABS.filter(t => role === 'admin' || perms.includes(t.perm) || (t.perm === 'procurement:read' && (perms.includes('procurement:request') || perms.includes('procurement:manage'))));
    if (!avail.length) { el.innerHTML = '<p class="error">لا تملك صلاحية الوصول إلى وحدة المشتريات والمخازن.</p>'; return; }
    el.innerHTML = `
    <style>
      .proc-kpis{display:flex;flex-wrap:wrap;gap:.7rem;margin:1rem 0}
      .proc-kpi{background:var(--card-bg,#fff);border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:.8rem 1rem;min-width:120px;text-align:center}
      .kpi-l{display:block;font-size:.78rem;color:var(--muted,#64748b);margin-bottom:.25rem}
      .kpi-warn{border-color:#f59e0b;background:#fffbeb}
      .proc-two{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem}
      @media(max-width:700px){.proc-two{grid-template-columns:1fr}}
      .proc-bar{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem;align-items:center}
      .proc-detail{margin-top:1rem}
      .proc-dlg{border:none;border-radius:12px;padding:1.6rem;max-width:760px;width:96vw;direction:rtl;box-shadow:0 8px 32px rgba(0,0,0,.18);max-height:92vh;overflow:auto}
      .proc-dlg::backdrop{background:rgba(0,0,0,.4)}.proc-dlg h2{margin-top:0}
      .proc-dlg label{display:flex;flex-direction:column;gap:.25rem;margin-bottom:.6rem;font-size:.9rem;font-weight:500}
      .proc-dlg .dlg-actions{display:flex;gap:.5rem;margin-top:1rem;flex-wrap:wrap}
      .btn-cancel{background:var(--surface,#f8fafc);border:1px solid var(--border,#e2e8f0)}
      .row-muted{opacity:.55}.row-warn{background:#fef3c7}
      .g-err{color:#dc2626}
    </style>
    <div class="sub-tabs proc-sub-tabs" style="margin-bottom:1rem">
      ${avail.map(t => `<button class="sub-tab-btn" data-tab="${t.key}">${t.icon} ${t.label}</button>`).join('')}
    </div>
    <div id="proc-content"></div>`;
    const content = el.querySelector('#proc-content');
    function activate(key) {
      $$('.sub-tab-btn', el).forEach(b => b.classList.toggle('active', b.dataset.tab === key));
      const t = avail.find(x => x.key === key); if (t) t.render(content);
    }
    $$('.sub-tab-btn', el).forEach(b => b.onclick = () => activate(b.dataset.tab));
    activate(avail[0].key);
  };
})();

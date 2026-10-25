/* «الموظفون والرواتب» (وحدة 5.8): سجل الموظفين، الراتب الحالي وتاريخه، طلبات الإجازة، العقود. صلاحية hr:manage. */
(function () {
  const UA = window.UA, { api, esc, toast } = UA;
  const fresh = () => ({ tab: 'emp', f: { search: '', unitId: '', status: '' }, emps: null, total: 0, opts: null, sel: null, form: null, err: '', leaves: null, contracts: null, lf: { status: '' }, lform: null, cform: null });
  const B = fresh();
  const prevReset = UA.reset; UA.reset = () => { if (prevReset) prevReset(); Object.assign(B, fresh()); };
  const $id = (i) => document.getElementById(i);
  const num = (n) => new Intl.NumberFormat('en-US').format(n ?? 0);
  const dt = (ms) => (ms ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date(ms)) : '—');
  const label = (list, k) => ((list || []).find((x) => x.key === k) || {}).label || k;
  const money = (n) => `${num(n)} ${esc(B.opts ? B.opts.currency : '')}`;
  const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();

  async function load() {
    if (!B.opts) B.opts = await api('GET', '/api/admin/hr/options');
    if (B.tab === 'emp') { const r = await api('GET', '/api/admin/hr/employees?' + qs({ ...B.f, size: 200 })); B.emps = r.employees; B.total = r.total; }
    if (B.tab === 'leave') B.leaves = (await api('GET', '/api/admin/hr/leaves?' + qs({ status: B.lf.status, size: 200 }))).leaves;
    if (B.tab === 'contract') B.contracts = (await api('GET', '/api/admin/hr/contracts?size=200')).contracts;
    if (B.sel) B.sel = (await api('GET', `/api/admin/hr/employee/${B.sel.id}`)).employee;
  }
  UA.loaders.payroll = load;

  const sel = (id, list, cur, any) => `<select id="${id}">${any ? `<option value="">${any}</option>` : ''}${list.map((x) => `<option value="${esc(x.key ?? x.id)}"${String(x.key ?? x.id) === String(cur) ? ' selected' : ''}>${esc(x.label ?? x.name)}</option>`).join('')}</select>`;

  function empForm() {
    const f = B.form, o = B.opts, e = f.e || {};
    return `<section class="card"><h2>${f.e ? 'تعديل موظف' : 'موظف جديد'}</h2><form id="pyemp" class="inline-form">
      <label>الاسم *<input id="pe-name" maxlength="100" required value="${esc(e.name || '')}"></label>
      <label>الرقم الوظيفي *<input id="pe-no" dir="ltr" required value="${esc(e.employeeNo || '')}"${f.e ? ' disabled' : ''}></label>
      <label>الرقم الشخصي *<input id="pe-pid" dir="ltr" required value="${esc(e.personalId || '')}"></label>
      <label>البريد *<input id="pe-mail" type="email" required value="${esc(e.email || '')}"></label>
      <label>الهاتف *<input id="pe-tel" dir="ltr" required value="${esc(e.phone || '')}"></label>
      <label>تاريخ التعيين *<input id="pe-hire" type="date" required value="${esc(e.hireDate || '')}"></label>
      <label>الوحدة *${sel('pe-unit', o.units, e.unitId, '— اختر —')}</label>
      <label>المسمى الوظيفي *<input id="pe-pos" maxlength="80" required value="${esc(e.position || '')}"></label>
      <label>الراتب الأساسي (${esc(o.currency)})<input id="pe-sal" type="number" min="0" value="${esc(e.salary && e.salary.amount !== undefined ? e.salary.amount : (e.salary || ''))}"></label>
      ${B.err ? `<div class="err" role="alert">${esc(B.err)}</div>` : ''}
      <div class="actions"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-act="pyclose">إلغاء</button></div></form></section>`;
  }
  function detail() {
    const e = B.sel, o = B.opts;
    const lv = (e.leaves || []).map((l) => `<tr><td>${esc(label(o.leaveTypes, l.type))}</td><td>${esc(l.startDate || l.start || '')} ← ${esc(l.endDate || l.end || '')}</td><td>${l.days}</td><td>${esc(label(o.leaveStatuses, l.status))}</td></tr>`).join('');
    const ct = (e.contracts || []).map((c) => `<tr><td>${esc(label(o.contractTypes, c.contractType || c.type))}</td><td>${esc(c.title || '')}</td><td>${esc(c.start || c.startDate || '')} ← ${esc(c.end || c.endDate || '')}</td><td>${money(c.salary)}</td></tr>`).join('');
    return `<section class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><h2 style="margin:0">${esc(e.name)} <span class="small mono">${esc(e.employeeNo)}</span></h2><button class="btn sm" data-act="pyclose">إغلاق</button></div>
      <p class="small">${esc(e.position || '')} · ${esc(e.unitName || '')} · ${esc(label(o.statuses, e.status))} · تعيين ${esc(e.hireDate || '')}</p>
      <p><b>الراتب الحالي:</b> ${e.salary ? `${money(e.salary.amount)} <span class="small">منذ ${dt(e.salary.effectiveAt)}</span>` : '<span class="hint">لم يُسجَّل</span>'}</p>
      <form id="pysal" class="inline-form"><label>راتب جديد (${esc(o.currency)})<input id="ps-amt" type="number" min="1" required></label><button class="btn pri" type="submit">تسجيل راتب</button></form>
      <h3>الإجازات</h3>${lv ? `<div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>النوع</th><th>الفترة</th><th>الأيام</th><th>الحالة</th></tr></thead><tbody>${lv}</tbody></table></div>` : '<p class="hint">لا إجازات.</p>'}
      <h3>العقود</h3>${ct ? `<div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>النوع</th><th>العنوان</th><th>المدة</th><th>الراتب</th></tr></thead><tbody>${ct}</tbody></table></div>` : '<p class="hint">لا عقود.</p>'}
      <div class="actions"><button class="btn" data-act="pyedit" data-id="${e.id}">تعديل البيانات</button> <button class="btn" data-act="pytoggle" data-id="${e.id}" data-on="${e.status === 'active' ? 0 : 1}">${e.status === 'active' ? 'تحويل إلى «في إجازة»' : 'تفعيل'}</button> <button class="btn bad" data-act="pydel" data-id="${e.id}">حذف</button></div></section>`;
  }
  function empTab() {
    const o = B.opts, rows = (B.emps || []).map((e) => `<tr class="row" tabindex="0" data-act="pyopen" data-id="${e.id}"><td class="mono">${esc(e.employeeNo)}</td><td><b>${esc(e.name)}</b><div class="small">${esc(e.position || '')}</div></td><td>${esc(e.unitName || '—')}</td><td>${esc(label(o.statuses, e.status))}</td><td>${money(e.salary)}</td></tr>`).join('');
    return `${B.form ? empForm() : ''}${B.sel && !B.form ? detail() : ''}<section class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><h2 style="margin:0">الموظفون <span class="small">(${B.total})</span></h2><button class="btn pri" data-act="pynew">موظف جديد</button></div>
      <form id="pyfilter" class="inline-form"><label>بحث<input id="pf-q" value="${esc(B.f.search)}" placeholder="الاسم أو الرقم الوظيفي أو الشخصي"></label><label>الوحدة${sel('pf-unit', o.units, B.f.unitId, 'الكل')}</label><label>الحالة${sel('pf-st', o.statuses, B.f.status, 'الكل')}</label><button class="btn" type="submit">تصفية</button></form>
      <div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>الرقم</th><th>الموظف</th><th>الوحدة</th><th>الحالة</th><th>الراتب</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="hint">لا موظفين.</td></tr>'}</tbody></table></div></section>`;
  }
  function leaveTab() {
    const o = B.opts, emps = (B.emps || []);
    const form = B.lform ? `<section class="card"><h3>طلب إجازة لموظف</h3><form id="pylv" class="inline-form">
      <label>الموظف *<select id="pl-emp" required><option value="">— اختر —</option>${emps.filter((e) => e.status === 'active').map((e) => `<option value="${e.id}">${esc(e.name)} (${esc(e.employeeNo)})</option>`).join('')}</select></label>
      <label>النوع *${sel('pl-type', o.leaveTypes, 'annual')}</label><label>من *<input id="pl-from" type="date" required></label><label>إلى *<input id="pl-to" type="date" required></label>
      <label>الأيام *<input id="pl-days" type="number" min="1" required></label><label>السبب *<input id="pl-reason" required maxlength="200"></label>
      ${B.err ? `<div class="err" role="alert">${esc(B.err)}</div>` : ''}<div class="actions"><button class="btn pri" type="submit">إرسال</button><button class="btn" type="button" data-act="pylvclose">إلغاء</button></div></form></section>` : '';
    const rows = (B.leaves || []).map((l) => `<tr><td><b>${esc(l.employeeName)}</b><div class="small mono">${esc(l.employeeNo)}</div></td><td>${esc(label(o.leaveTypes, l.leaveType))}</td><td>${esc(l.startDate)} ← ${esc(l.endDate)}</td><td>${l.days}</td><td>${esc(l.statusLabel)}</td>
      <td style="white-space:nowrap">${l.status === 'pending' ? `<button class="btn sm pri" data-act="pylok" data-id="${l.id}">اعتماد</button> <button class="btn sm" data-act="pylno" data-id="${l.id}">رفض</button> <button class="btn sm" data-act="pylx" data-id="${l.id}">إلغاء</button>` : ''}</td></tr>`).join('');
    return `${form}<section class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><h2 style="margin:0">إجازات الموظفين</h2><button class="btn pri" data-act="pylvnew">طلب إجازة</button></div>
      <div class="inline-form"><label>الحالة${sel('pl-st', o.leaveStatuses, B.lf.status, 'الكل')}</label><button class="btn" data-act="pylfilter">تصفية</button></div>
      <div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>الموظف</th><th>النوع</th><th>الفترة</th><th>أيام</th><th>الحالة</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="hint">لا إجازات.</td></tr>'}</tbody></table></div></section>`;
  }
  function contractTab() {
    const o = B.opts, emps = (B.emps || []);
    const form = B.cform ? `<section class="card"><h3>عقد جديد</h3><form id="pyct" class="inline-form">
      <label>الموظف *<select id="pc-emp" required><option value="">— اختر —</option>${emps.map((e) => `<option value="${e.id}">${esc(e.name)} (${esc(e.employeeNo)})</option>`).join('')}</select></label>
      <label>النوع *${sel('pc-type', o.contractTypes, 'fixed')}</label><label>العنوان<input id="pc-title" maxlength="100"></label><label>من *<input id="pc-from" type="date" required></label><label>إلى *<input id="pc-to" type="date" required></label>
      <label>الراتب (${esc(o.currency)}) *<input id="pc-sal" type="number" min="1" required></label>
      ${B.err ? `<div class="err" role="alert">${esc(B.err)}</div>` : ''}<div class="actions"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-act="pyctclose">إلغاء</button></div></form></section>` : '';
    const rows = (B.contracts || []).map((c) => `<tr><td><b>${esc(c.employeeName)}</b><div class="small mono">${esc(c.employeeNo)}</div></td><td>${esc(label(o.contractTypes, c.contractType))}</td><td>${esc(c.title || '')}</td><td>${esc(c.start)} ← ${esc(c.end)}</td><td>${money(c.salary)}</td></tr>`).join('');
    return `${form}<section class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><h2 style="margin:0">العقود</h2><button class="btn pri" data-act="pyctnew">عقد جديد</button></div>
      <div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>الموظف</th><th>النوع</th><th>العنوان</th><th>المدة</th><th>الراتب</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="hint">لا عقود.</td></tr>'}</tbody></table></div></section>`;
  }
  UA.views.payroll = () => {
    if (!B.opts) return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>';
    const bar = `<div class="sub-tabs no-print" role="tablist">${[['emp', 'الموظفون'], ['leave', 'الإجازات'], ['contract', 'العقود']].map((t) => `<button class="chip" role="tab" data-act="pytab" data-t="${t[0]}" aria-pressed="${B.tab === t[0]}">${t[1]}</button>`).join('')}</div>`;
    return bar + (B.tab === 'emp' ? empTab() : B.tab === 'leave' ? leaveTab() : contractTab());
  };

  const run = async (fn) => { try { await fn(); } catch (e) { if (!e.status) throw e; B.err = e.message; toast(e.message); UA.render(); } };
  const reload = async () => { await load(); UA.render(); };
  Object.assign(UA.actions, {
    pytab: async (el, d) => { B.tab = d.t; B.sel = null; B.form = B.lform = B.cform = null; B.err = ''; if (d.t !== 'emp' && !B.emps) { B.emps = (await api('GET', '/api/admin/hr/employees?size=200')).employees; } await reload(); },
    pynew: () => { B.form = { e: null }; B.err = ''; B.sel = null; UA.render(); window.scrollTo(0, 0); },
    pyclose: () => { B.form = null; B.sel = null; B.err = ''; UA.render(); },
    pyopen: (el, d) => run(async () => { B.sel = (await api('GET', `/api/admin/hr/employee/${d.id}`)).employee; B.form = null; UA.render(); window.scrollTo(0, 0); }),
    pyedit: () => { B.form = { e: B.sel }; B.err = ''; UA.render(); },
    pytoggle: (el, d) => run(async () => { await api('POST', `/api/admin/hr/employee/${d.id}/toggle`, { enabled: d.on === '1' }); await reload(); toast('تم'); }),
    pydel: (el, d) => run(async () => { if (!confirm('حذف الموظف نهائياً؟')) return; await api('DELETE', `/api/admin/hr/employee/${d.id}`); B.sel = null; await reload(); toast('حُذف'); }),
    pylvnew: () => { B.lform = {}; B.err = ''; UA.render(); }, pylvclose: () => { B.lform = null; UA.render(); },
    pyctnew: () => { B.cform = {}; B.err = ''; UA.render(); }, pyctclose: () => { B.cform = null; UA.render(); },
    pylfilter: () => run(async () => { B.lf.status = $id('pl-st').value; await reload(); }),
    pylok: (el, d) => run(async () => { await api('POST', `/api/admin/hr/leave/${d.id}/approve`, {}); await reload(); toast('اعتُمدت الإجازة'); }),
    pylno: (el, d) => run(async () => { const r = prompt('سبب الرفض'); if (r === null) return; await api('POST', `/api/admin/hr/leave/${d.id}/reject`, { reason: r }); await reload(); toast('رُفضت'); }),
    pylx: (el, d) => run(async () => { await api('POST', `/api/admin/hr/leave/${d.id}/cancel`, {}); await reload(); toast('أُلغيت'); }),
  });
  UA.forms.pyfilter = () => run(async () => { B.f = { search: $id('pf-q').value.trim(), unitId: $id('pf-unit').value, status: $id('pf-st').value }; await reload(); });
  UA.forms.pyemp = () => run(async () => {
    const e = B.form.e, body = { name: $id('pe-name').value, personalId: $id('pe-pid').value, email: $id('pe-mail').value, phone: $id('pe-tel').value, hireDate: $id('pe-hire').value, unit_id: $id('pe-unit').value, position: $id('pe-pos').value, salary: Number($id('pe-sal').value) || 0 };
    if (e) await api('PUT', `/api/admin/hr/employee/${e.id}`, body); else await api('POST', '/api/admin/hr/employees', { ...body, employeeNo: $id('pe-no').value });
    B.form = null; B.err = ''; await reload(); toast('حُفظ');
  });
  UA.forms.pysal = () => run(async () => { await api('POST', '/api/admin/hr/salaries', { employee_id: B.sel.id, amount: Number($id('ps-amt').value) }); await reload(); toast('سُجّل الراتب'); });
  UA.forms.pylv = () => run(async () => {
    await api('POST', '/api/admin/hr/leaves', { employee_id: Number($id('pl-emp').value), leave_type: $id('pl-type').value, start_date: $id('pl-from').value, end_date: $id('pl-to').value, days: Number($id('pl-days').value), reason: $id('pl-reason').value });
    B.lform = null; B.err = ''; await reload(); toast('أُرسل الطلب');
  });
  UA.forms.pyct = () => run(async () => {
    await api('POST', '/api/admin/hr/contracts', { employee_id: Number($id('pc-emp').value), contract_type: $id('pc-type').value, title: $id('pc-title').value, start_date: $id('pc-from').value, end_date: $id('pc-to').value, salary: Number($id('pc-sal').value) });
    B.cform = null; B.err = ''; await reload(); toast('حُفظ العقد');
  });
})();

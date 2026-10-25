/* حضور وانصراف الموظفين ورصيد الإجازات: «حضوري» لكل موظف، و«تقرير الموظفين/الأرصدة» للمسؤول */
(function () {
  const UA = window.UA, { api, esc, toast, can } = UA;
  const fresh = () => ({ tab: 'me', set: null, me: null, date: '', report: null, bal: null, busy: false });
  const B = fresh();
  const prevReset = UA.reset; UA.reset = () => { if (prevReset) prevReset(); Object.assign(B, fresh()); };
  const tm = (ms) => (ms ? new Date(ms).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Damascus' }) : '—');
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date());
  const tabs = () => [...(can('staffatt:self') ? [['me', 'حضوري']] : []), ...(can('staffatt:manage') ? [['report', 'تقرير الموظفين'], ['bal', 'أرصدة الإجازات'], ['set', 'الإعدادات']] : [])];

  async function load() {
    const t = tabs(); if (!t.some((x) => x[0] === B.tab)) B.tab = t[0] && t[0][0];
    if (!B.date) B.date = today();
    if (B.tab === 'me') B.me = await api('GET', '/api/hr/attendance/me');
    else if (B.tab === 'report') B.report = await api('GET', '/api/hr/attendance?date=' + B.date);
    else if (B.tab === 'bal') B.bal = await api('GET', '/api/hr/leaves');
    else if (B.tab === 'set') B.set = (await api('GET', '/api/hr/settings')).settings;
  }
  UA.loaders.hr = load;

  function me() {
    const m = B.me; if (!m) return '<p class="hint">جارٍ التحميل…</p>';
    const t = m.today, state = !t ? 'لم تسجّل دخولك اليوم' : t.out ? `انصرفت الساعة ${tm(t.out)} (يتحدّث الخروج عند كل بصمة)` : `سُجّل دخولك الساعة ${tm(t.in)}`;
    const L = m.leave;
    return `<section class="card"><h2>حضوري اليوم</h2><p style="font-size:18px">${esc(state)}</p>
      <div class="actions"><button class="btn pri" data-act="sapunch"${B.busy ? ' disabled' : ''}>${!t ? 'تسجيل الدخول' : 'تسجيل الانصراف'}</button></div></section>
      <section class="card"><h2>رصيد الإجازة الاعتيادية ${L.year}</h2><div class="imp-sum"><div class="stat"><small>الاستحقاق</small><b>${L.entitlement}</b></div><div class="stat"><small>المستهلك</small><b>${L.used}</b></div><div class="stat"><small>المتبقي</small><b>${L.remaining}</b></div></div>
      <div class="actions"><button class="btn pri" data-act="saleave">طلب إجازة</button></div><p class="small">تُحسب أيام العمل دون العطلة الأسبوعية المعتمدة في الإعدادات. الطلب يُرسل إلى الموارد البشرية للاعتماد.</p>
      ${m.leaves.length ? `<div class="tbl-wrap"><table><thead><tr><th>النوع</th><th>من</th><th>إلى</th><th>أيام العمل</th></tr></thead><tbody>${m.leaves.map((l) => `<tr><td>${esc(l.type)}</td><td>${esc(l.from)}</td><td>${esc(l.to)}</td><td>${l.days}</td></tr>`).join('')}</tbody></table></div>` : ''}</section>
      <section class="card"><h2>سجلي</h2><p class="small">هذا الشهر: ${m.month.days} يوم حضور، ${m.month.hours} ساعة.</p><div class="tbl-wrap"><table><thead><tr><th>اليوم</th><th>الدخول</th><th>الخروج</th></tr></thead><tbody>${m.history.map((h) => `<tr><td>${esc(h.day)}</td><td>${tm(h.in)}</td><td>${tm(h.out)}</td></tr>`).join('') || '<tr><td colspan="3" class="hint">لا سجل بعد.</td></tr>'}</tbody></table></div></section>`;
  }
  function report() {
    const r = B.report; if (!r) return '<p class="hint">جارٍ التحميل…</p>';
    return `<section class="card"><div class="inline-form"><label>اليوم<input id="sa-date" type="date" value="${esc(B.date)}"></label><button class="btn" data-act="sadate">عرض</button>
      <a class="btn" href="/api/hr/attendance/export.xlsx?month=${esc(B.date.slice(0, 7))}" download>تصدير شهر ${esc(B.date.slice(0, 7))} (Excel)</a></div>
      <div class="tbl-wrap"><table><thead><tr><th>الموظف</th><th>الوحدة</th><th>الدخول</th><th>الخروج</th><th>الساعات</th><th>الحالة</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.unit || '')}</td><td>${tm(x.in)}</td><td>${tm(x.out)}</td><td>${x.hours ?? '—'}</td><td>${x.leave ? `<span class="pill p-review">إجازة ${esc(x.leave)}</span>` : x.in ? '<span class="pill p-approved">حاضر</span>' : '<span class="pill p-rejected">غائب</span>'}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function bal() {
    const b = B.bal; if (!b) return '<p class="hint">جارٍ التحميل…</p>';
    return `<section class="card"><h2>أرصدة الإجازات ${b.year}</h2><div class="tbl-wrap"><table><thead><tr><th>الموظف</th><th>الوحدة</th><th>الاستحقاق</th><th>المستهلك</th><th>المتبقي</th><th></th></tr></thead><tbody>${b.rows.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.unit || '')}</td><td>${x.entitlement}</td><td>${x.used}</td><td>${x.remaining}</td><td><button class="btn sm" data-act="saent" data-id="${x.id}" data-y="${b.year}" data-d="${x.entitlement}">تعديل الاستحقاق</button></td></tr>`).join('')}</tbody></table></div></section>`;
  }
  // إعدادات الحضور والإجازات: تظهر هنا (لمسؤول الموارد البشرية) وفي «الإدارة» (للمدير)
  function settingsView() {
    const s = B.set; if (!s) return '<p class="hint">جارٍ التحميل…</p>';
    return `<section class="card"><h2>إعدادات الحضور والإجازات</h2>
      <form id="hrset" class="inline-form"><label>الاستحقاق السنوي الافتراضي للإجازة الاعتيادية (أيام)<input id="hs-days" type="number" min="0" max="366" step="1" value="${esc(s.leaveDefaultDays)}" required></label>
        <label>العطلة الأسبوعية (لا تُحسب ضمن الإجازة)<select id="hs-weekend">${s.weekendOptions.map((o) => `<option value="${esc(o.value)}"${o.value === s.weekend ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
        <button class="btn pri" type="submit">حفظ</button></form>
      <p class="small">يسري الاستحقاق الافتراضي على كل موظف لا استحقاق مخصّص له (يُعدَّل لكل موظف من «أرصدة الإجازات»). تغيير العطلة يؤثر على الإجازات التي تُعتمد بعد الحفظ فقط.</p></section>`;
  }
  UA.forms.hrset = async () => {
    try { B.set = (await api('PUT', '/api/hr/settings', { leaveDefaultDays: Number(document.getElementById('hs-days').value), weekend: document.getElementById('hs-weekend').value })).settings; UA.render(); toast('حُفظت الإعدادات'); }
    catch (e) { if (!e.status) throw e; toast(e.message); }
  };
  UA.views.hr = () => `<div class="sub-tabs no-print" role="tablist">${tabs().map((t) => `<button class="chip" role="tab" data-act="satab" data-t="${t[0]}" aria-pressed="${B.tab === t[0]}">${t[1]}</button>`).join('')}</div>${B.tab === 'me' ? me() : B.tab === 'report' ? report() : B.tab === 'set' ? settingsView() : bal()}`;

  const A = UA.actions;
  A.saleave = async () => { await UA.go('internal'); if (UA.actions.inpick) { UA.actions.inpick(null, { k: 'hr_leave' }); } };
  A.satab = async (el, d) => { B.tab = d.t; await load(); UA.render(); };
  A.sadate = async () => { const v = document.getElementById('sa-date').value; if (v) B.date = v; await load(); UA.render(); };
  A.sapunch = async () => { if (B.busy) return; B.busy = true; try { const r = await api('POST', '/api/hr/attendance/punch', {}); await load(); toast(r.action === 'in' ? 'سُجّل الدخول' : 'سُجّل الانصراف'); } finally { B.busy = false; } UA.render(); };
  A.saent = async (el, d) => {
    const v = window.prompt('الاستحقاق السنوي بالأيام:', d.d); if (v === null) return;
    try { await api('PUT', '/api/hr/leave/entitlement', { userId: Number(d.id), year: Number(d.y), days: Number(v) }); await load(); UA.render(); toast('حُدّث الاستحقاق'); } catch (e) { if (!e.status) throw e; toast(e.message); }
  };
})();

/* تبويب «أعضاء هيئة التدريس» (وحدة 5.6) داخل صفحة المواد والعلامات: السجل الأساسي
   بالدرجات والأقسام والساعات المكتبية، وحساب العبء التدريسي من المقررات المسندة،
   ونافذة إسناد/فك إسناد المقررات. الصلاحية: faculty:manage. */
(function () {
  const UA = window.UA, { S, api, esc, val, toast } = UA;
  const F = { list: null, options: null, summary: null, q: '', rank: '', status: '', modal: null, assign: null, courses: null };
  const DEF_LV = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة'];
  const getLV = () => ((UA.S.limits && UA.S.limits.levels) || DEF_LV);
  const LV = DEF_LV;
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); F.list = null; F.options = null; F.summary = null; F.q = F.rank = F.status = ''; F.modal = null; F.assign = null; F.courses = null; };

  async function loadMembers() {
    const q = new URLSearchParams();
    if (F.q) q.set('q', F.q); if (F.rank) q.set('rank', F.rank); if (F.status) q.set('status', F.status);
    try {
      const r = await api('GET', '/api/faculty' + (q.toString() ? '?' + q : ''));
      F.list = r.members; F.options = r.options; F.summary = r.summary;
    } catch (e) {
      if (F.list === null) { F.list = []; F.options = { ranks: [], statuses: {}, units: [] }; F.summary = { total: 0, active: 0, hours: 0, unassigned: 0 }; }
      throw e;
    }
  }
  const opts = (list, sel, all) => (all ? `<option value="">${all}</option>` : '') + list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const pill = (st) => `<span class="pill ${st === 'active' ? 'p-approved' : st === 'leave' ? 'p-review' : 'p-rejected'}">${esc((F.options.statuses && F.options.statuses[st]) || st)}</span>`;
  const RSTAT = { active: ['on', 'فعّال'], leave: ['on', 'في إجازة'], inactive: ['off', 'معطَّل'] };

  function memberRows() {
    const term = F.q.trim().toLowerCase();
    return F.list.filter((m) => !term || [m.name, m.specialty, m.rank, m.unit].some((x) => String(x).toLowerCase().includes(term)))
      .map((m) => `<tr><td class="nm"><b>${esc(m.name)}</b>${m.email ? ` <span class="small" dir="ltr">${esc(m.email)}</span>` : ''}</td><td class="nowrap">${esc(m.rank)}</td><td class="nm">${esc(m.unit || '—')}</td>
        <td class="nm">${esc(m.specialty || '—')}</td><td>${esc(m.officeHours || '—')}</td>
        <td class="nowrap">${m.courses ? `<button class="link" data-act="fmassign" data-id="${m.id}" title="عرض وإدارة المواد المسندة"><b>${m.hours}</b> ساعة · ${m.courses} مقرر</button>` : '<button class="link small" data-act="fmassign" data-id="' + m.id + '">إسناد مواد</button>'}</td>
        <td>${pill(m.status)}</td>
        <td class="nowrap"><button class="btn sm" data-act="fmedit" data-id="${m.id}">تعديل</button> <button class="btn sm" data-act="fmtoggle" data-id="${m.id}" data-on="${RSTAT[m.status][0] === 'on' ? 0 : 1}">${RSTAT[m.status][0] === 'on' ? 'تعطيل' : 'تفعيل'}</button> <button class="btn sm bad" data-act="fmdel" data-id="${m.id}">حذف</button></td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">لا أعضاء مطابقين. غيّر الفلاتر أو أضف عضواً جديداً.</td></tr>';
  }

  function membersTab() {
    if (!F.list || !F.options) return '<section class="card"><p class="hint">جارٍ تحميل أعضاء هيئة التدريس…</p></section>';
    const s = F.summary, o = F.options;
    return `<section class="card"><div class="tool-row"><h2 style="margin:0">أعضاء هيئة التدريس <span class="small">(${s.total} عضو)</span></h2><button class="btn pri" data-act="fmnew">＋ عضو جديد</button></div>
      <p class="hint">السجل الأساسي لأعضاء هيئة التدريس ودرجاتهم وأقسامهم. العبء التدريسي يُحسب من المقررات المسندة (بالمستوى النشط)، وإسناد مقرر يجعل اسم العضو هو «المدرّس» فيه.</p>
      <div class="imp-sum"><div class="stat"><small>الأعضاء</small><b>${s.total}</b></div><div class="stat"><small>على رأس العمل</small><b>${s.active}</b></div>
        <div class="stat"><small>ساعات مسندة</small><b>${s.hours}</b></div><div class="stat"><small>مقررات بلا إسناد</small><b>${s.unassigned}</b></div></div>
      <div class="filters no-print"><label class="grow">بحث<input data-fmq="1" id="fm-q" value="${esc(F.q)}" placeholder="الاسم، التخصص، الدرجة، القسم…" maxlength="60"></label>
        <label>الدرجة العلمية<select data-fm="rank">${opts(o.ranks.map((r) => [r, r]), F.rank, 'الكل')}</select></label>
        <label>الحالة<select data-fm="status">${opts(Object.entries(o.statuses), F.status, 'الكل')}</select></label>
        ${F.q || F.rank || F.status ? '<button class="btn sm" data-act="fmclear">مسح الفلاتر</button>' : ''}</div>
      <div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>العضو</th><th>الدرجة</th><th>القسم / الإدارة</th><th>التخصص</th><th>الساعات المكتبية</th><th>العبء التدريسي</th><th>الحالة</th><th></th></tr></thead>
        <tbody id="fm-body">${memberRows()}</tbody></table></div></section>` + modalHtml();
  }

  /* ---------- النافذون: نموذج العضو + إسناد المقررات ---------- */
  function formModal() {
    const m = (F.modal && F.modal.edit) ? (F.list || []).find((x) => x.id === F.modal.edit) : null, o = F.options;
    if (!o || !o.ranks) return '<h2 id="fmttl">جارٍ التحميل…</h2><p class="hint">تعذر تحميل القوائم.</p><div class="actions"><button class="btn" type="button" data-act="fmclose">إغلاق</button></div>';
    const v = (k, d = '') => esc(m ? m[k] ?? d : d);
    const hire = m && m.hireDate ? new Date(m.hireDate).toISOString().slice(0, 10) : '';
    return `<h2 id="fmttl">${m ? 'تعديل: ' + esc(m.name) : 'عضو هيئة تدريس جديد'}</h2>
      <form class="form" id="fmform" style="border:0;margin:0;padding:0">
        <div class="two"><label>الاسم<input id="fm-name" maxlength="80" required value="${v('name')}" placeholder="الاسم الثلاثي"></label>
          <label>الدرجة العلمية<select id="fm-rank" required>${opts(o.ranks.map((r) => [r, r]), m && m.rank, '— اختر —')}</select></label></div>
        <div class="two"><label>القسم / الإدارة<select id="fm-unit">${opts(o.units.map((u) => [u.id, u.name]), m && m.unitId, '— بدون —')}</select></label>
          <label>التخصص<input id="fm-spec" maxlength="100" value="${v('specialty')}" placeholder="مثال: أمن الشبكات"></label></div>
        <div class="two"><label>البريد الإلكتروني<input id="fm-mail" type="email" maxlength="100" dir="ltr" value="${v('email')}"></label>
          <label>الهاتف<input id="fm-phone" maxlength="20" dir="ltr" value="${v('phone')}"></label></div>
        <div class="two"><label>الساعات المكتبية<input id="fm-office" maxlength="200" value="${v('officeHours')}" placeholder="مثال: الأحد والثلاثاء 10:00 – 12:00"></label>
          <label>مكتب الاستقبال<input id="fm-loc" maxlength="60" value="${v('officeLocation')}" placeholder="مثال: مبنى 2 — مكتب 214"></label></div>
        <div class="two"><label>تاريخ التعيين<input id="fm-hire" type="date" value="${hire}"></label>
          <label>الحالة<select id="fm-status">${opts(Object.entries(o.statuses), m && m.status, 'active')}</select></label></div>
        <label>ملاحظات<textarea id="fm-notes" rows="2" maxlength="300">${v('notes')}</textarea></label>
        <div class="actions"><button class="btn pri" type="submit">${m ? 'حفظ التعديل' : 'إضافة العضو'}</button><button class="btn" type="button" data-act="fmclose">إلغاء</button></div>
      </form>`;
  }

  function assignModal() {
    const m = F.list.find((x) => x.id === F.assign.id); if (!m) return '';
    const mine = (F.courses || []).filter((c) => c.memberId === m.id);
    const free = (F.courses || []).filter((c) => c.active && c.memberId === null);
    const row = (c) => `<tr><td class="nm"><b>${esc(c.name)}</b>${c.code ? ` <span class="mono small">${esc(c.code)}</span>` : ''}</td><td class="nowrap">${c.hours} ساعة</td><td class="nowrap">${LV[c.level - 1] || c.level} / ${c.semester === 1 ? 'الأول' : 'الثاني'}</td>
      <td class="nm">${esc(c.program || '—')}</td><td><button class="btn sm bad" data-act="fmassignrm" data-c="${c.id}">فك الإسناد</button></td></tr>`;
    return `<h2 id="fmttl">العبء التدريسي: ${esc(m.name)}</h2>
      <p class="small" style="margin-top:0">${esc(m.rank)}${m.unit ? ' · ' + esc(m.unit) : ''} · إجمالي ${m.hours} ساعة من ${m.courses} مقرر. إسناد مقرر يجعل اسم العضو هو «المدرّس» فيه.</p>
      <div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>المقرر المسند</th><th>الساعات</th><th>المستوى / الفصل</th><th>البرنامج</th><th></th></tr></thead><tbody>
        ${mine.map(row).join('') || '<tr><td colspan="5" class="empty">لا مقررات مسندة بعد.</td></tr>'}</tbody></table></div>
      <div class="inline-form" style="margin-top:10px"><label class="grow">إسناد مقرر نشط<select id="fm-assign-sel">${opts(free.map((c) => [c.id, `${c.faculty || ''} · ${LV[c.level - 1] || c.level}/${c.semester === 1 ? 'أ' : 'ث'} — ${c.name} (${c.hours} ساعة)`]), '', '— اختر مقرراً غير مسنَد —')}</select></label>
        <button class="btn pri" data-act="fmassigngo"${free.length ? '' : ' disabled'}>إسناد</button></div>
      <div class="actions"><button class="btn" type="button" data-act="fmclose">إغلاق</button></div>`;
  }

  function modalHtml() {
    if (!F.modal && !F.assign) return '';
    const body = F.assign ? assignModal() : formModal();
    return `<div class="modal-back" data-act="fmclose"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="fmttl">${body}</div></div>`;
  }
  UA.facultyView = membersTab;

  // تغليف محمّل وأحداث التبويب بعد تسجيلهما في staff.js — لا يُسقط واجهة المواد والعلامات عند فشل الهيئة التدريسية
  const prevLoad = UA.loaders.academics;
  UA.loaders.academics = async () => {
    try { await prevLoad(); } catch (e) { if (!(e.status === 403 && !UA.can('course:manage') && !UA.can('grade:manage'))) throw e; }
    if (UA.acTab && UA.acTab() === 'members') {
      try { await loadMembers(); } catch (e) { if (e.status !== 403) toast(e.message); }
    }
  };
  const prevActab = UA.actions.actab;
  UA.actions.actab = async (el, d) => {
    if (d && d.t === 'members') {
      try { await loadMembers(); } catch (e) { if (e.status !== 403) toast(e.message); }
      await prevActab(el, d);
      return;
    }
    await prevActab(el, d);
  };

  /* ---------- الإجراءات والنماذج ---------- */
  const run = async (fn) => { try { await fn(); } catch (e) { if (!e.status) { console.error(e); toast(String(e.message || e)); return; } toast(e.message); } };
  const refreshBody = () => { const el = document.getElementById('fm-body'); if (el && F.list) el.innerHTML = memberRows(); };
  Object.assign(UA.actions, {
    fmnew: () => { F.assign = null; F.modal = { edit: null }; UA.render(); window.scrollTo(0, 0); },
    fmedit: (el, d) => { F.assign = null; F.modal = { edit: Number(d.id) }; UA.render(); window.scrollTo(0, 0); },
    fmclose: () => { F.modal = null; F.assign = null; UA.render(); },
    fmtoggle: (el, d) => run(async () => {
      await api('POST', `/api/faculty/${d.id}/toggle`, { enabled: d.on === '1' });
      await loadMembers(); UA.render(); toast(d.on === '1' ? 'فُعّل العضو' : 'عُطّل العضو');
    }),
    fmdel: (el, d) => run(async () => {
      const m = F.list.find((x) => x.id === Number(d.id)); if (!m) return;
      if (!confirm(`حذف «${m.name}» من قائمة أعضاء هيئة التدريس نهائياً؟${m.courses ? `\nله ${m.courses} مقرر مسنَد وسيُرفض الحذف؛ ألغِ الإسنادات أولاً.` : ''}`)) return;
      await api('DELETE', '/api/faculty/' + d.id); await loadMembers(); UA.render(); toast('حُذف العضو');
    }),
    fmclear: async () => { Object.assign(F, { q: '', rank: '', status: '' }); await loadMembers(); UA.render(); },
    fmassign: (el, d) => run(async () => {
      if (!F.courses) F.courses = (await api('GET', '/api/courses')).courses;
      F.modal = null; F.assign = { id: Number(d.id) }; UA.render(); window.scrollTo(0, 0);
    }),
    fmassigngo: (el, d) => run(async () => {
      const sel = document.getElementById('fm-assign-sel'); const cid = sel && sel.value;
      if (!cid) { toast('اختر مقرراً أولاً'); return; }
      await api('PUT', '/api/courses/' + cid, { memberId: F.assign.id });
      F.courses = (await api('GET', '/api/courses')).courses; await loadMembers(); UA.render(); toast('أُسند المقرر');
    }),
    fmassignrm: (el, d) => run(async () => {
      await api('PUT', '/api/courses/' + d.c, { memberId: null });
      F.courses = (await api('GET', '/api/courses')).courses; await loadMembers(); UA.render(); toast('أُلغي الإسناد');
    }),
  });
  Object.assign(UA.forms, {
    fmform: () => run(async () => {
      if (!F.options || !F.options.ranks || !F.options.ranks.length) { toast('الدرجات العلمية غير محمّلة — حاول تحديث الصفحة'); return; }
      const hire = val('fm-hire');
      const rank = val('fm-rank');
      if (!rank) { toast('اختر الدرجة العلمية'); return; }
      const name = val('fm-name').trim();
      if (name.length < 2) { toast('الاسم يجب أن يكون حرفين على الأقل'); return; }
      const body = { name, rank, unitId: val('fm-unit') ? Number(val('fm-unit')) : null,
        specialty: val('fm-spec'), email: val('fm-mail'), phone: val('fm-phone'), officeHours: val('fm-office'),
        officeLocation: val('fm-loc'), hireDate: hire ? Date.parse(hire + 'T00:00:00') : null, status: val('fm-status') || 'active', notes: val('fm-notes') };
      const edit = F.modal && F.modal.edit;
      if (edit) await api('PUT', '/api/faculty/' + edit, body); else await api('POST', '/api/faculty', body);
      F.modal = null; await loadMembers(); UA.render(); toast(edit ? 'حُفظ التعديل — تم بنجاح ✅' : 'أُضيف العضو إلى هيئة التدريس بنجاح ✅');
    }),
  });
  let searchTimer = null;
  document.addEventListener('input', (e) => {
    const t = e.target; if (!t || !t.dataset || !t.dataset.fmq || !F.list) return;
    F.q = t.value; clearTimeout(searchTimer);
    // حقل البحث المحلي (تصفية فورية بلا طلب خادم) — مثبط قصير لتخفيف إعادة الرسم
    searchTimer = setTimeout(() => { refreshBody(); }, 120);
    // تحديث سريع للعرض الحالي بلا انتظار
    refreshBody();
  });
  document.addEventListener('change', async (e) => {
    const t = e.target; if (!t || !t.dataset || !t.dataset.fm) return;
    F[t.dataset.fm] = t.value; await run(loadMembers()); refreshBody();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (F.modal || F.assign)) { F.modal = null; F.assign = null; UA.render(); } });
})();

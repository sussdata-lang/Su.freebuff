/* «مكتبي»: واجهة الموظف الشخصية. تتبدّل هويتها البصرية بحسب نوع العضو: هيئة إدارية (ديوان رسمي أخضر/ذهبي) أو هيئة تدريسية (أكاديمي: نيلي/عنابي بخط كتابي) */
(function () {
  const UA = window.UA, { S, api, esc, fmt, toast } = UA;
  const fresh = () => ({ tab: 'home', d: null, pw: { err: '', busy: false } });
  const B = fresh();
  const prevReset = UA.reset; UA.reset = () => { if (prevReset) prevReset(); Object.assign(B, fresh()); };
  const $id = (i) => document.getElementById(i);
  const kindOf = () => (S.me && S.me.staffKind === 'faculty' ? 'faculty' : 'admin');
  const KIND = { admin: 'عضو هيئة إدارية', faculty: 'عضو هيئة تدريسية' };
  const RS = { review: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض', pending: 'قيد الاعتماد', cancelled: 'ملغى', draft: 'مسودة' };
  const ICON = { affairs: 'affairs', internal: 'tx', corr: 'news', hr: 'idcard', dashboard: 'dashboard', academics: 'academics', comms: 'comms', attendance: 'hall', exchange: 'import', admin: 'admin', access: 'access', audit: 'audit', overview: 'dashboard' };
  // ترتيب المختصرات بحسب طبيعة العمل
  const ORDER = {
    admin: ['affairs', 'internal', 'corr', 'hr', 'exchange', 'dashboard', 'comms', 'admin', 'access', 'audit', 'overview', 'academics', 'attendance'],
    faculty: ['academics', 'attendance', 'corr', 'internal', 'hr', 'comms', 'affairs', 'dashboard', 'exchange', 'overview', 'admin', 'access', 'audit'],
  };
  const TXT = {
    admin: { sub: 'ديوان العمل الإداري', tile: 'أعمالي الإدارية', hint: 'متابعة الطلبات والمعاملات والمراسلات الرسمية.' },
    faculty: { sub: 'مجلس الهيئة التدريسية', tile: 'أعمالي الأكاديمية', hint: 'المواد والعلامات وسجل القاعات والمراسلات.' },
  };
  const dateAr = () => new Intl.DateTimeFormat('ar-SY', { dateStyle: 'full', timeZone: 'Asia/Damascus' }).format(new Date());
  const tm = (ms) => (ms ? new Date(ms).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Damascus' }) : '—');

  async function load() { B.d = (await api('GET', '/api/me/desk')).desk; }
  UA.loaders.desk = load;

  function kpis(d) {
    const k = [], c = d.counts;
    if (c.queue !== undefined) k.push(['بانتظار وحدتي', c.queue, 'طلب', 'affairs', 1]);
    if (c.myOpen !== undefined) k.push(['طلباتي المفتوحة', c.myOpen, 'طلب', 'internal']);
    if (c.corrTurn !== undefined) k.push(['مراسلات تنتظر اعتمادي', c.corrTurn, 'مستند', 'corr', 1]);
    if (c.corrUnread !== undefined) k.push(['إشعارات غير مقروءة', c.corrUnread, 'إشعار', 'corr', 1]);
    if (d.hr) k.push(['رصيد الإجازة', d.hr.leave.remaining, `يوماً من ${d.hr.leave.entitlement}`, 'hr']);
    if (d.hr) k.push(['حضور هذا الشهر', d.hr.month.days, `يوماً · ${d.hr.month.hours} س`, 'hr']);
    return k.map(([l, n, u, v, h]) => `<button class="sd-k${n && h ? ' hot' : ''}" data-act="view" data-v="${v}"><small>${esc(l)}</small><b>${n}</b><span>${esc(u)}</span></button>`).join('');
  }
  function punchBox(d) {
    if (!d.hr) return '';
    const t = d.hr.today;
    return `<div class="sd-punch"><div><small>بصمة اليوم</small><b>${t ? `دخول ${tm(t.in)}${t.out ? ` · انصراف ${tm(t.out)}` : ' · على رأس العمل'}` : 'لم تسجّل دخولك بعد'}</b></div>
      <button class="btn pri sm" data-act="sdpunch">${!t ? 'تسجيل الدخول' : 'تسجيل الانصراف'}</button></div>`;
  }
  function tiles() {
    const k = kindOf(), all = UA.viewsFor(S.me.role).filter((v) => !['desk', 'verify'].includes(v[0]));
    const rank = (x) => { const i = ORDER[k].indexOf(x[0]); return i < 0 ? 99 : i; };
    return all.sort((a, b) => rank(a) - rank(b)).map((v) => `<button class="sd-tile" data-act="view" data-v="${v[0]}">${UA.icon(ICON[v[0]] || 'sheet', 22)}<span>${esc(v[1])}</span></button>`).join('');
  }
  function lists(d) {
    const mine = d.requests.mine.length ? `<ul class="sd-list">${d.requests.mine.map((r) => `<li><b>${esc(r.service)}</b><span class="small mono">${esc(r.no)}</span><em class="sd-st st-${r.status}">${RS[r.status] || r.status}</em><span class="small">${fmt(r.at)}</span></li>`).join('')}</ul>` : '<p class="hint">لا طلبات بعد.</p>';
    const corr = d.corr && d.corr.length ? `<ul class="sd-list">${d.corr.map((x) => `<li><b>${esc(x.title)}</b><span class="small mono">${esc(x.no)}</span><em class="sd-st st-${x.status}">${RS[x.status] || x.status}</em><span class="small">${fmt(x.at)}</span></li>`).join('')}</ul>` : '<p class="hint">لا مراسلات بعد.</p>';
    return `<div class="sd-cols">${d.counts.myOpen !== undefined ? `<section class="card"><h3>آخر طلباتي</h3>${mine}<div class="actions"><button class="btn sm" data-act="view" data-v="internal">كل طلباتي</button></div></section>` : ''}
      ${d.corr ? `<section class="card"><h3>آخر المراسلات</h3>${corr}<div class="actions"><button class="btn sm" data-act="view" data-v="corr">فتح المراسلات</button></div></section>` : ''}</div>`;
  }
  function profile(d) {
    const m = d.me, perms = d.permissions.map((g) => `<details><summary><b>${esc(g.group)}</b> <span class="small">(${g.items.length})</span></summary><ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></details>`).join('');
    const row = (k, v) => `<div class="sd-row"><span>${k}</span><b>${v || '<span class="hint">—</span>'}</b></div>`;
    return `<div class="sd-cols"><section class="card"><h3>ملفي الوظيفي</h3>${row('الاسم', esc(m.name))}${row('اسم المستخدم', `<span class="mono">${esc(m.username)}</span>`)}${row('المسمى الوظيفي', esc(m.jobTitle))}${row('النوع', KIND[kindOf()])}${row('الوحدة / القسم', m.unit ? esc(m.unit.name) : '')}${row('الدور', esc(m.roleLabel))}</section>
      <section class="card"><h3>صلاحياتي <span class="small">(${d.permissions.reduce((n, g) => n + g.items.length, 0)})</span></h3>${perms || '<p class="hint">لا صلاحيات ممنوحة بعد. راجع مسؤول الحسابات.</p>'}</section></div>`;
  }
  function settings() {
    return `<div class="sd-cols"><section class="card"><h3>المظهر والتنبيهات</h3><p class="small">المظهر: ${window.UAtheme ? window.UAtheme.button() : ''} (تلقائي ← فاتح ← ليلي)</p>${UA.push ? UA.push.panel() : ''}</section>
      <section class="card"><h3>تغيير كلمة المرور</h3><form id="sdpw" class="inline-form" style="display:grid;gap:10px">
        <label>كلمة المرور الحالية<input id="sdpw-cur" type="password" autocomplete="current-password" required></label>
        <label>كلمة المرور الجديدة<input id="sdpw-new" type="password" autocomplete="new-password" minlength="10" required></label>
        <label>تأكيد الجديدة<input id="sdpw-new2" type="password" autocomplete="new-password" required></label>
        ${B.pw.err ? `<div class="err" role="alert">${esc(B.pw.err)}</div>` : ''}
        <div><button class="btn pri" type="submit"${B.pw.busy ? ' disabled' : ''}>حفظ</button></div></form></section></div>`;
  }

  UA.views.desk = () => {
    const d = B.d, k = kindOf(), m = S.me;
    if (!d) return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>';
    const tabs = [['home', 'مكتبي'], ['prof', 'ملفي وصلاحياتي'], ['set', 'إعداداتي']];
    return `<div class="sdesk sd-${k}"><section class="sd-hero"><div class="sd-ornament" aria-hidden="true"></div>
      <div class="sd-id"><span class="sd-badge">${KIND[k]}</span><h1>مرحباً، ${esc(m.name)}</h1>
        <p>${m.jobTitle ? `${esc(m.jobTitle)} · ` : ''}${m.unit ? esc(m.unit.name) : esc(TXT[k].sub)} · ${esc(m.roleLabel || '')}</p><p class="sd-date">${dateAr()}</p></div>${punchBox(d)}</section>
      <div class="sub-tabs no-print" role="tablist">${tabs.map((t) => `<button class="chip" role="tab" data-act="sdtab" data-t="${t[0]}" aria-pressed="${B.tab === t[0]}">${t[1]}</button>`).join('')}</div>
      ${B.tab === 'home' ? `<div class="sd-kpis">${kpis(d)}</div><section class="card"><h3>${TXT[k].tile}</h3><p class="small">${TXT[k].hint}</p><div class="sd-tiles">${tiles()}</div></section>${lists(d)}` : B.tab === 'prof' ? profile(d) : settings()}</div>`;
  };

  Object.assign(UA.actions, {
    sdtab: (el, d) => { B.tab = d.t; UA.render(); },
    sdpunch: async () => { try { const r = await api('POST', '/api/hr/attendance/punch', {}); await load(); UA.render(); toast(r.action === 'in' ? 'سُجّل الدخول' : 'سُجّل الانصراف'); } catch (e) { if (!e.status) throw e; toast(e.message); } },
  });
  UA.forms.sdpw = async () => {
    const cur = $id('sdpw-cur').value, nw = $id('sdpw-new').value; B.pw.err = '';
    if (nw !== $id('sdpw-new2').value) { B.pw.err = 'تأكيد كلمة المرور غير مطابق.'; UA.render(); return; }
    try { await api('POST', '/api/auth/change-password', { current: cur, next: nw }); toast('تم تغيير كلمة المرور'); B.pw.err = ''; }
    catch (e) { if (!e.status) throw e; B.pw.err = e.message; }
    UA.render();
  };
})();

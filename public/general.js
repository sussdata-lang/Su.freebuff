/* «الإعدادات العامة» في لوحة الإدارة: تبويب لكل قسم يعرض كل ما كان ثابتاً في النظام ويسمح بتعديله.
   الواجهة مرسومة من مخطط الخادم (/api/admin/general) فأي إعداد جديد يظهر هنا دون تعديل هذا الملف. */
(function () {
  const UA = window.UA, { api, esc, toast, can } = UA;
  const fresh = () => ({ tab: 'index', cfg: null, err: '', busy: false });
  const B = fresh();
  const prevReset = UA.reset; UA.reset = () => { if (prevReset) prevReset(); Object.assign(B, fresh()); };
  const $id = (i) => document.getElementById(i);
  const fid = (k) => 'g-' + k.replace(/\./g, '-');
  // روابط الأقسام التي تُدار من صفحاتها (بيانات جدولية لا قيم مفردة)
  const LINKS = [
    ['اللجنة التأديبية وحواجز الطلبات', 'holds', 'admin'], ['قواعد الفحص الآلي', 'rules', 'admin'], ['الكليات والبرامج (السنوات والأسماء)', 'programs', 'admin'],
    ['الخدمات ونماذج الطلبات (المدة والحقول والمرفقات)', 'services', 'admin'], ['هوية الموقع', 'identity', 'admin'], ['النسخ الاحتياطي', 'backup', 'admin'],
    ['الحسابات والأدوار والصلاحيات', null, 'access'], ['قوالب المراسلات', null, 'corr'], ['أرصدة الإجازات لكل موظف', null, 'hr'],
  ];

  async function load() { B.cfg = await api('GET', '/api/admin/general'); }
  const tabOf = () => (B.cfg ? B.cfg.tabs.find((t) => t.key === B.tab) : null);

  function control(it) {
    const id = fid(it.key), v = it.value;
    if (it.type === 'int') return `<span class="g-num"><input id="${id}" type="number" inputmode="numeric" min="${it.min}" max="${it.max}" value="${esc(v)}">${it.unit ? `<em>${esc(it.unit)}</em>` : ''}</span>`;
    if (it.type === 'text') return `<input id="${id}" maxlength="${it.max ?? 200}" value="${esc(v)}">`;
    if (it.type === 'select') return `<select id="${id}">${it.options.map((o) => `<option value="${esc(o.value)}"${o.value === v ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    if (it.type === 'bool') return `<input id="${id}" type="checkbox"${v ? ' checked' : ''}>`;
    return `<textarea id="${id}" rows="${Math.min(14, Math.max(4, v.length + 1))}" spellcheck="false">${esc(v.join('\n'))}</textarea>`;
  }
  function item(it) {
    const def = it.type === 'list' ? `${it.default.length} عنصراً` : it.type === 'select' ? (it.options.find((o) => o.value === it.default) || {}).label : String(it.default);
    return `<div class="g-item${it.changed ? ' chg' : ''}"><div class="g-l"><label for="${fid(it.key)}"><b>${esc(it.label)}</b></label>${it.hint ? `<span class="small">${esc(it.hint)}</span>` : ''}
      <span class="small g-def">الافتراضي: ${esc(def)}${it.unit ? ' ' + esc(it.unit) : ''}${it.changed ? ` · <button type="button" class="link" data-act="gres" data-k="${esc(it.key)}">إعادة إلى الافتراضي</button>` : ''}</span></div>
      <div class="g-c">${control(it)}</div></div>`;
  }
  function indexTab() {
    const cards = B.cfg.tabs.map((t) => { const n = t.items.filter((i) => i.changed).length;
      return `<button class="g-card" data-act="gtab" data-t="${t.key}"><b>${esc(t.label)}</b><span class="small">${esc(t.desc)}</span><span class="small">${t.items.length} إعداداً${n ? ` · <em class="g-badge">${n} معدَّل</em>` : ''}</span></button>`; }).join('');
    const links = LINKS.map(([l, t, v]) => `<button class="link g-link" data-act="${t ? 'gadmin' : 'view'}" data-v="${v}"${t ? ` data-t="${t}"` : ''}>${esc(l)} ←</button>`).join('');
    return `<section class="card"><h2>الإعدادات العامة</h2><p class="hint">كل قيمة يعمل بها النظام قابلة للتعديل: اختر القسم لتعديل حدوده وقوائمه. التغييرات تسري فوراً على العمليات الجديدة وتُسجَّل في سجل التدقيق بقيمتها القديمة والجديدة.</p><div class="g-cards">${cards}</div></section>
      <section class="card"><h3>بيانات تُدار من صفحاتها</h3><p class="small">الجداول الكبيرة (الخدمات والبرامج والأدوار…) لها صفحات مخصّصة:</p><div class="g-links">${links}</div></section>`;
  }
  function sectionTab(t) {
    return `<section class="card"><h2>${esc(t.label)}</h2><p class="hint">${esc(t.desc)}</p>
      <form id="gform" class="g-form">${t.items.map(item).join('')}${B.err ? `<div class="err" role="alert">${esc(B.err)}</div>` : ''}
      <div class="actions"><button class="btn pri" type="submit"${B.busy ? ' disabled' : ''}>حفظ ${esc(t.label)}</button></div></form></section>`;
  }
  function view() {
    if (!B.cfg) return '<section class="card"><p class="hint">جارٍ التحميل…</p></section>';
    const bar = `<div class="gsub" role="tablist">${[['index', 'الفهرس'], ...B.cfg.tabs.map((t) => [t.key, t.label])].map((t) => `<button class="chip" role="tab" data-act="gtab" data-t="${t[0]}" aria-pressed="${B.tab === t[0]}">${esc(t[1])}</button>`).join('')}</div>`;
    return bar + (B.tab === 'index' || !tabOf() ? indexTab() : sectionTab(tabOf()));
  }
  UA.general = { view, load };

  const collect = (t) => {
    const out = {};
    for (const it of t.items) {
      const el = $id(fid(it.key)); if (!el) continue;
      out[it.key] = it.type === 'bool' ? el.checked : it.type === 'list' ? el.value.split('\n') : el.value;
    }
    return out;
  };
  UA.forms.gform = async () => {
    const t = tabOf(); if (!t || B.busy) return;
    B.busy = true; B.err = '';
    try { const r = await api('PUT', '/api/admin/general', { values: collect(t) }); B.cfg = { tabs: r.tabs }; try { UA.S.limits = (await api('GET', '/api/me')).limits || {}; } catch { /* */ } toast(r.changed ? `حُفظ (${r.changed} تغيير)` : 'لا تغييرات للحفظ'); }
    catch (e) { if (!e.status) throw e; B.err = e.message; }
    finally { B.busy = false; }
    UA.render();
  };
  Object.assign(UA.actions, {
    gtab: (el, d) => { B.tab = d.t; B.err = ''; UA.render(); window.scrollTo(0, 0); },
    gres: async (el, d) => { if (!confirm('إعادة هذا الإعداد إلى قيمته الافتراضية؟')) return; try { const r = await api('POST', '/api/admin/general/reset', { keys: [d.k] }); B.cfg = { tabs: r.tabs }; toast('أُعيد إلى الافتراضي'); UA.render(); } catch (e) { if (!e.status) throw e; toast(e.message); } },
    gadmin: async (el, d) => { UA.S.adminTab = d.t; await UA.go('admin'); if (UA.adminCfg && UA.adminCfg.tabs.some((x) => x[0] === d.t)) { await UA.adminCfg.load(d.t); UA.render(); } },
  });
})();

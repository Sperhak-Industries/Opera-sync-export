// ==UserScript==
// @name         Opera sync export
// @namespace    Sperhak Industries
// @author       Sperhak
// @version      1.0
// @description  Načíta priečinky záložiek z sync.opera.com a umožní ich stiahnuť (JSON/HTML/CSV/TXT)
// @icon         https://sync.opera.com/favicon.ico
// @match        *://*.sync.opera.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(() => {
  'use strict';
  const C = { bg: '#18181c', fg: '#ececf0', mut: '#8d8d99', acc: '#ff1b2d', line: '#2d2d35', card: '#34343d' };
  const CL = '[class*=_clickable_]';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  let cancel = false, busy = false, nodes = [];
  window.__opexp = () => nodes;

  // ---------- pomocné ----------
  const h = (tag, st = {}, props = {}, ...kids) => {
    const e = document.createElement(tag);
    Object.assign(e.style, st);
    Object.assign(e, props);
    for (const k of kids) e.append(k);
    return e;
  };
  const dateOf = s => {
    const m = s.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  };
  const slug = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'export';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fname = n => n.date || slug(n.title);

  const download = (name, text, mime) => {
    const a = h('a', { display: 'none' }, { href: URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };

  // ---------- formáty ----------
  const flat = ns => ns.flatMap(n => n.items.map(b => ({ title: b.title, url: b.url, path: n.path.join(' / ') })));
  const FORMATS = {
    json: { label: 'JSON', ext: 'json', mime: 'application/json', make: ns => JSON.stringify(flat(ns), null, 1) },
    html: {
      label: 'HTML (import do prehliadača)', ext: 'html', mime: 'text/html',
      make: ns => {
        let o = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n';
        for (const n of ns) {
          o += '  <DT><H3>' + esc(n.path.slice(1).join(' / ') || n.path[0]) + '</H3>\n  <DL><p>\n';
          for (const b of n.items) o += '    <DT><A HREF="' + esc(b.url) + '">' + esc(b.title || b.url) + '</A>\n';
          o += '  </DL><p>\n';
        }
        return o + '</DL><p>\n';
      }
    },
    csv: {
      label: 'CSV', ext: 'csv', mime: 'text/csv',
      make: ns => '\uFEFF' + ['title', 'url', 'path'].join(',') + '\r\n' +
        flat(ns).map(r => [r.title, r.url, r.path].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n')
    },
    txt: { label: 'TXT (len URL)', ext: 'txt', mime: 'text/plain', make: ns => flat(ns).map(r => r.url).join('\n') }
  };

  // ---------- čítanie stránky ----------
  const getMain = () => document.querySelector('[class*=contentWrapper]') || document.body;

  // breadcrumb: odkazy (rodičia) + posledná položka (_caption_ = aktuálny priečinok)
  const crumbs = () => {
    const box = document.querySelector('[class*=_breadcrumbsContainer_]');
    if (!box) return [];
    return [...box.children]
      .filter(e => !/Separator/.test(e.className))
      .map(e => ({ el: e, text: norm(e.textContent) }))
      .filter(c => c.text && c.text !== '/');
  };

  const view = () => {
    const bm = [], folders = [];
    for (const e of getMain().querySelectorAll(CL)) {
      const title = norm(e.querySelector('[class*=_title_]')?.textContent);
      const url = norm(e.querySelector('[class*=_url_]')?.textContent) || e.getAttribute('href') || '';
      if (url) bm.push({ title, url }); else folders.push({ el: e, title: title || '(bez názvu)' });
    }
    return { bm, folders };
  };

  const sig = () => {
    const items = getMain().querySelectorAll(CL);
    const n = items.length;
    const t = e => (e ? norm(e.textContent).slice(0, 60) : '');
    return { n, s: crumbs().map(c => c.text).join('>') + '|' + n + '|' + t(items[0]) + '|' + t(items[n - 1]) };
  };

  const stable = async () => {
    const t0 = Date.now();
    let last = '', same = 0;
    while (Date.now() - t0 < 60000) {
      if (cancel) throw new Error('Zrušené');
      const g = sig();
      same = g.s === last ? same + 1 : 0; last = g.s;
      if (same >= (g.n === 0 ? 16 : 4)) return;
      await sleep(150);
    }
  };
  const settle = async (prev, tag) => {
    const t0 = Date.now();
    while (sig().s === prev) {
      if (cancel) throw new Error('Zrušené');
      if (Date.now() - t0 > 6000) throw new Error('Pohľad sa nezmenil (' + tag + ')');
      await sleep(100);
    }
    await stable();
  };

  const crawl = async (path, out, prog) => {
    if (path.length > 8) return;
    const { bm, folders } = view();
    if (bm.length) out.push({ path: [...path], items: bm });
    prog(path, out);
    for (let i = 0; i < folders.length; i++) {
      const f = view().folders[i];
      if (!f) break;
      const before = sig().s;
      f.el.click();
      await settle(before, 'vstup do ' + f.title);
      await crawl([...path, f.title], out, prog);
      const target = crumbs()[path.length - 1];
      if (!target) throw new Error('Nenašiel som breadcrumb pre návrat');
      const b2 = sig().s;
      target.el.click();
      await settle(b2, 'návrat do ' + path[path.length - 1]);
    }
  };

  const scan = async (out, prog) => {
    if (!location.pathname.startsWith('/bookmarks')) {
      const a = document.querySelector('a[href="/bookmarks"]');
      if (!a) throw new Error('Otvorte najprv stránku Bookmarks');
      a.click();
      const t0 = Date.now();
      while (!(location.pathname.startsWith('/bookmarks') && crumbs().length)) {
        if (Date.now() - t0 > 8000) throw new Error('Bookmarks sa neotvorili');
        await sleep(200);
      }
    }
    const cr = crumbs();
    if (!cr.length) throw new Error('Nenašiel som breadcrumb');
    cr[0].el.click(); // späť na koreň
    await sleep(300);
    await stable();
    await crawl([crumbs()[0].text], out, prog);
  };

  // ---------- UI ----------
  const mk = () => {
    if (document.getElementById('opexp') || !document.body) return;
    const btn = (label, primary) => h('button', {
      padding: '8px 12px', border: 'none', borderRadius: '8px', cursor: 'pointer', font: 'inherit',
      fontWeight: '600', background: primary ? C.acc : C.card, color: '#fff'
    }, { type: 'button', textContent: label });

    const status = h('div', { color: C.mut, fontSize: '12px', wordBreak: 'break-word', minHeight: '18px' },
      { textContent: 'Otvorte Bookmarks a kliknite na „Načítať priečinky“.' });
    const scanBtn = btn('Načítať priečinky', true);
    const stop = btn('Stop');
    stop.style.display = 'none';
    const list = h('div', { display: 'none', maxHeight: '36vh', overflowY: 'auto', border: '1px solid ' + C.line, borderRadius: '8px', background: '#1f1f25' });
    const all = btn('Označiť všetko'), none = btn('Zrušiť výber');
    const fmtSel = h('select', { flex: '1', padding: '7px', borderRadius: '8px', border: '1px solid ' + C.line, background: C.card, color: '#fff', font: 'inherit' });
    for (const [k, f] of Object.entries(FORMATS)) fmtSel.append(new Option(f.label, k));
    const merge = h('input', {}, { type: 'checkbox' });
    const go = btn('Nič nie je vybraté', true);
    go.style.width = '100%';

    const upd = () => {
      const sel = nodes.filter(n => n.sel);
      const cnt = sel.reduce((a, n) => a + n.items.length, 0);
      go.textContent = sel.length ? `Stiahnuť (${sel.length} priečinkov, ${cnt} záložiek)` : 'Nič nie je vybraté';
      go.disabled = !sel.length || busy;
      go.style.opacity = go.disabled ? '.5' : '1';
      all.disabled = none.disabled = !nodes.length;
    };

    const render = () => {
      list.textContent = '';
      list.style.display = nodes.length ? 'block' : 'none';
      const sorted = [...nodes].sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
      for (const n of sorted) {
        const cb = h('input', {}, { type: 'checkbox', checked: n.sel, onchange: () => { n.sel = cb.checked; upd(); } });
        list.append(h('label', { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', borderBottom: '1px solid ' + C.line, cursor: 'pointer' }, {},
          cb,
          h('div', { flex: '1', minWidth: '0' }, {},
            h('div', { fontWeight: '600' }, { textContent: n.title }),
            h('div', { color: C.mut, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              { textContent: (n.date ? n.date + ' · ' : '') + n.path.slice(0, -1).join(' / ') })),
          h('span', { background: C.card, borderRadius: '10px', padding: '2px 8px', fontSize: '12px' }, { textContent: String(n.items.length) })));
      }
      upd();
    };

    const total = ns => ns.reduce((a, n) => a + n.items.length, 0);
    const prog = (path, ns) => { status.textContent = `Skenujem: ${path.join(' / ')} — nájdených ${total(ns)} záložiek v ${ns.length} priečinkoch`; };

    scanBtn.onclick = async () => {
      if (busy) return;
      busy = true; cancel = false; nodes = []; render();
      scanBtn.disabled = true; stop.style.display = '';
      const found = [];
      try {
        await scan(found, prog);
        status.textContent = `Hotovo: ${found.length} priečinkov so záložkami, spolu ${total(found)} záložiek.`;
      } catch (e) {
        status.textContent = (e.message === 'Zrušené' ? 'Zrušené. ' : 'Chyba: ' + e.message + '. ') + `Zozbierané: ${total(found)} záložiek.`;
      } finally {
        busy = false; scanBtn.disabled = false; stop.style.display = 'none';
        nodes = found.map(f => {
          const title = f.path[f.path.length - 1];
          return { path: f.path, title, date: dateOf(title), items: f.items, sel: true };
        });
        render();
      }
    };
    stop.onclick = () => { cancel = true; };
    all.onclick = () => { nodes.forEach(n => n.sel = true); render(); };
    none.onclick = () => { nodes.forEach(n => n.sel = false); render(); };

    go.onclick = async () => {
      const ns = nodes.filter(n => n.sel);
      if (!ns.length || busy) return;
      const f = FORMATS[fmtSel.value];
      try {
        if (merge.checked || ns.length === 1) {
          const ds = [...new Set(ns.map(n => n.date).filter(Boolean))].sort();
          const base = ns.length === 1 ? fname(ns[0])
            : ds.length ? (ds.length === 1 ? ds[0] : `${ds[0]}_${ds[ds.length - 1]}`) + `_${ns.length}x` : 'merged';
          download(`opera_bookmarks_${base}.${f.ext}`, f.make(ns), f.mime);
          status.textContent = `Stiahnutý 1 súbor (${total(ns)} záložiek).`;
        } else {
          const used = new Map();
          for (const n of ns) {
            let b = fname(n); const k = used.get(b) || 0; used.set(b, k + 1);
            if (k) b += '_' + (k + 1);
            download(`opera_bookmarks_${b}.${f.ext}`, f.make([n]), f.mime);
            await sleep(400);
          }
          status.textContent = `Stiahnutých ${ns.length} súborov.`;
        }
      } catch (e) { status.textContent = 'Chyba pri sťahovaní: ' + e.message; }
    };

    const body = h('div', { padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }, {},
      h('div', { display: 'flex', gap: '8px' }, {}, scanBtn, stop),
      status, list,
      h('div', { display: 'flex', gap: '8px' }, {}, all, none),
      h('div', { display: 'flex', gap: '8px', alignItems: 'center' }, {}, h('span', { color: C.mut }, { textContent: 'Formát' }), fmtSel),
      h('label', { display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer' }, {}, merge, 'Spojiť vybrané do jedného súboru'),
      go);

    const toggle = btn('–'); toggle.style.padding = '2px 10px';
    toggle.onclick = () => { const hide = body.style.display !== 'none'; body.style.display = hide ? 'none' : 'flex'; toggle.textContent = hide ? '+' : '–'; };
    const head = h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid ' + C.line, background: '#111115' }, {},
      h('div', {}, {},
        h('div', { fontWeight: '700' }, { textContent: 'Opera sync export' }),
        h('div', { color: C.mut, fontSize: '11px' }, { textContent: 'Sperhak Industries' })),
      toggle);

    const root = h('div', {
      position: 'fixed', right: '10px', bottom: '10px', zIndex: '2147483647', width: 'min(390px, 94vw)', maxHeight: '88vh',
      display: 'flex', flexDirection: 'column', background: C.bg, color: C.fg, border: '1px solid ' + C.line,
      borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,.5)', font: '13px/1.4 system-ui, sans-serif', overflow: 'hidden'
    }, { id: 'opexp' }, head, body);
    document.body.append(root);
    upd();
  };
  const iv = setInterval(() => { try { mk(); if (document.getElementById('opexp')) clearInterval(iv); } catch (e) { /* ticho */ } }, 500);
})();
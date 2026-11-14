// ==UserScript==
// @name         Opera sync export
// @namespace    Sperhak Industries
// @author       Sperhak
// @version      1.4
// @description  Scans your bookmark folders on sync.opera.com, exports them as JSON/HTML/CSV/TXT and opens pages from exported files one by one (Import tab)
// @icon         https://cdn-production-opera-website.operacdn.com/staticfiles/assets/images/favicon/opera/android-chrome-192x192.48af36cc8f36.png
// @match        *://*.sync.opera.com/*
// @match        *://auth.opera.com/*
// @run-at       document-start
// @grant        GM_openInTab
// @grant        unsafeWindow
// ==/UserScript==
(() => {
  'use strict';

  const C = { bg: '#18181c', fg: '#ececf0', mut: '#8d8d99', acc: '#ff1b2d', line: '#2d2d35', card: '#34343d' };
  const CL = '[class*=_clickable_]'; // row of a bookmark or a folder
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  let cancel = false, busy = false, nodes = [];
  (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).__opexp = () => nodes; // handy for debugging from the console

  // ---------- helpers ----------
  const h = (tag, st = {}, props = {}, ...kids) => {
    const e = document.createElement(tag);
    Object.assign(e.style, st);
    Object.assign(e, props);
    for (const k of kids) e.append(k);
    return e;
  };

  // Extracts a date from a folder name: "D. M. YYYY" or "YYYY-MM-DD" -> "YYYY-MM-DD"
  const dateOf = s => {
    let m = s.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[0] : '';
  };
  const slug = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'export';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fname = n => n.date || slug(n.title);

  const download = (name, text, mime) => {
    const a = h('a', { display: 'none' }, { href: URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };

  // ---------- export formats ----------
  const flat = ns => ns.flatMap(n => n.items.map(b => ({ title: b.title, url: b.url, path: n.path.join(' / ') })));
  const FORMATS = {
    json: { label: 'JSON', ext: 'json', mime: 'application/json', make: ns => JSON.stringify(flat(ns), null, 1) },
    html: {
      label: 'HTML (browser import)', ext: 'html', mime: 'text/html',
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
    txt: { label: 'TXT (URLs only)', ext: 'txt', mime: 'text/plain', make: ns => flat(ns).map(r => r.url).join('\n') }
  };

  // ---------- reading the page ----------
  const getMain = () => document.querySelector('[class*=contentWrapper]') || document.body;

  // Breadcrumb: parent folders (role=link) + the last item (_caption_ = current folder)
  const crumbs = () => {
    const box = document.querySelector('[class*=_breadcrumbsContainer_]');
    if (!box) return [];
    return [...box.children]
      .filter(e => !/Separator/.test(e.className))
      .map(e => ({ el: e, text: norm(e.textContent) }))
      .filter(c => c.text && c.text !== '/');
  };

  // Bookmarks and sub-folders of the currently open folder
  const view = () => {
    const bm = [], folders = [];
    for (const e of getMain().querySelectorAll(CL)) {
      const title = norm(e.querySelector('[class*=_title_]')?.textContent);
      const url = norm(e.querySelector('[class*=_url_]')?.textContent) || e.getAttribute('href') || '';
      if (url) bm.push({ title, url });
      else {
        const cnt = e.querySelector('[class*=_itemsCount_]');
        const count = cnt ? parseInt(norm(cnt.textContent), 10) : NaN;
        folders.push({ el: e, title: title || '(untitled)', count });
      }
    }
    return { bm, folders };
  };

  // Signature of the current view, used to detect navigation and "loaded" state
  const sig = () => {
    const items = getMain().querySelectorAll(CL);
    const n = items.length;
    const t = e => (e ? norm(e.textContent).slice(0, 60) : '');
    return { n, s: crumbs().map(c => c.text).join('>') + '|' + n + '|' + t(items[0]) + '|' + t(items[n - 1]) };
  };

  // Wait until the view stops changing (an empty view needs a longer quiet period)
  const stable = async () => {
    const t0 = Date.now();
    let last = '', same = 0;
    while (Date.now() - t0 < 60000) {
      if (cancel) throw new Error('Cancelled');
      const g = sig();
      same = g.s === last ? same + 1 : 0; last = g.s;
      if (same >= (g.n === 0 ? 16 : 4)) return;
      await sleep(150);
    }
  };
  // Wait for the view to change after a click, then for it to settle
  const settle = async (prev, tag) => {
    const t0 = Date.now();
    while (sig().s === prev) {
      if (cancel) throw new Error('Cancelled');
      if (Date.now() - t0 > 6000) throw new Error('View did not change (' + tag + ')');
      await sleep(100);
    }
    await stable();
  };

  // Depth-first walk through the folder tree
  const crawl = async (path, out, prog, opts) => {
    if (path.length > 8) return;
    const { bm, folders } = view();
    if (bm.length) out.push({ path: [...path], items: bm });
    prog(path, out);
    for (let i = 0; i < folders.length; i++) {
      const f = view().folders[i]; // re-query: the DOM is re-rendered after navigating back
      if (!f) break;
      if (opts.skipZero && f.count === 0) { opts.skipped.push(f.title); continue; }
      const before = sig().s;
      f.el.click();
      await settle(before, 'entering ' + f.title);
      await crawl([...path, f.title], out, prog, opts);
      const target = crumbs()[path.length - 1];
      if (!target) throw new Error('Breadcrumb for going back not found');
      const b2 = sig().s;
      target.el.click();
      await settle(b2, 'going back to ' + path[path.length - 1]);
    }
  };

  const scan = async (out, prog, opts) => {
    if (!location.pathname.startsWith('/bookmarks')) {
      const a = document.querySelector('a[href="/bookmarks"]');
      if (!a) throw new Error('Open the Bookmarks page first');
      a.click();
      const t0 = Date.now();
      while (!(location.pathname.startsWith('/bookmarks') && crumbs().length)) {
        if (Date.now() - t0 > 8000) throw new Error('Bookmarks did not open');
        await sleep(200);
      }
    }
    const cr = crumbs();
    if (!cr.length) throw new Error('Breadcrumb not found');
    cr[0].el.click(); // go back to the root
    await sleep(300);
    await stable();
    await crawl([crumbs()[0].text], out, prog, opts);
  };

  // ---------- import: file parsing ----------
  // Detects the format from the content: JSON, HTML (Netscape bookmarks), CSV (title,url,path) or TXT (one URL per line)
  const decodeEnt = t => new DOMParser().parseFromString(t, 'text/html').documentElement.textContent;

  const fromJSON = text => {
    const out = [];
    const walk = (v, path) => {
      if (typeof v === 'string') out.push({ title: '', url: v, path });
      else if (Array.isArray(v)) v.forEach(x => walk(x, path));
      else if (v && typeof v === 'object') {
        const p = Array.isArray(v.path) ? v.path.join(' / ') : (v.path || path);
        if (typeof v.url === 'string') out.push({ title: v.title || '', url: v.url, path: p });
        else Object.values(v).forEach(x => walk(x, p));
      }
    };
    walk(JSON.parse(text), '');
    return out;
  };

  const fromHTML = text => {
    const out = [];
    let folder = '';
    const re = /<H3[^>]*>([\s\S]*?)<\/H3>|<A\s[^>]*?HREF\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/A>/gi;
    let m;
    while ((m = re.exec(text))) {
      if (m[1] !== undefined) folder = decodeEnt(m[1]).trim();
      else out.push({ title: decodeEnt(m[4] || '').trim(), url: decodeEnt(m[2] ?? m[3] ?? ''), path: folder });
    }
    return out;
  };

  const csvRows = text => {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  };
  const fromCSV = text => {
    const rows = csvRows(text);
    const head = (rows[0] || []).map(x => x.trim().toLowerCase());
    const iu = head.indexOf('url'), it = head.indexOf('title'), ip = head.indexOf('path');
    const hasHead = iu >= 0;
    return rows.slice(hasHead ? 1 : 0).map(r => {
      const url = hasHead ? r[iu] : r.find(c => /^\s*https?:\/\//i.test(c));
      return { title: hasHead && it >= 0 ? r[it] || '' : '', url: url || '', path: hasHead && ip >= 0 ? r[ip] || '' : '' };
    });
  };

  const fromTXT = text => text.split(/\r?\n/).map(l => (l.match(/https?:\/\/\S+/i) || [''])[0]).map(url => ({ title: '', url, path: '' }));

  const parseImport = text => {
    text = text.replace(/^\uFEFF/, '');
    const t = text.trimStart();
    let out;
    if (/^[\[{]/.test(t)) out = fromJSON(text);
    else if (/<A\s[^>]*HREF\s*=/i.test(t)) out = fromHTML(text);
    else if (/^\s*"?(title|url|path)"?\s*,/i.test(t.split(/\r?\n/, 1)[0]) || /^"/.test(t)) out = fromCSV(text);
    else out = fromTXT(text);
    return out.map(x => ({ ...x, url: String(x.url).trim() })).filter(x => /^https?:\/\//i.test(x.url));
  };

  // ---------- UI ----------
  const mk = () => {
    if (document.getElementById('opexp') || !document.body) return;
    const btn = (label, primary) => h('button', {
      padding: '8px 12px', border: 'none', borderRadius: '8px', cursor: 'pointer', font: 'inherit',
      fontWeight: '600', background: primary ? C.acc : C.card, color: '#fff'
    }, { type: 'button', textContent: label });

    const status = h('div', { color: C.mut, fontSize: '12px', wordBreak: 'break-word', minHeight: '18px' },
      { textContent: 'Open Bookmarks and click "Load folders".' });
    const scanBtn = btn('Load folders', true);
    const stop = btn('Stop');
    stop.style.display = 'none';
    const list = h('div', { display: 'none', maxHeight: '36vh', overflowY: 'auto', border: '1px solid ' + C.line, borderRadius: '8px', background: '#1f1f25' });
    const all = btn('Select all'), none = btn('Clear selection');
    const fmtSel = h('select', { flex: '1', padding: '7px', borderRadius: '8px', border: '1px solid ' + C.line, background: C.card, color: '#fff', font: 'inherit' });
    for (const [k, f] of Object.entries(FORMATS)) fmtSel.append(new Option(f.label, k));
    const merge = h('input', {}, { type: 'checkbox' });
    const go = btn('Nothing selected', true);
    go.style.width = '100%';

    const upd = () => {
      const sel = nodes.filter(n => n.sel);
      const cnt = sel.reduce((a, n) => a + n.items.length, 0);
      go.textContent = sel.length ? `Download (${sel.length} folders, ${cnt} bookmarks)` : 'Nothing selected';
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
    const prog = (path, ns) => { status.textContent = `Scanning: ${path.join(' / ')} — found ${total(ns)} bookmarks in ${ns.length} folders`; };
    const skippedTxt = o => o.skipped.length
      ? ` Skipped (count 0): ${o.skipped.slice(0, 6).join(', ')}${o.skipped.length > 6 ? ' and more (' + o.skipped.length + ')' : ''}.` : '';

    scanBtn.onclick = async () => {
      if (busy) return;
      busy = true; cancel = false; nodes = []; render();
      scanBtn.disabled = true; stop.style.display = '';
      const found = [];
      let opts = { skipZero: true, skipped: [] }; // folders showing a count of 0 are not opened
      try {
        await scan(found, prog, opts);
        if (!found.length && !cancel) { // safety net: nothing found -> retry without skipping
          status.textContent = 'Nothing found, retrying without skipping…';
          opts = { skipZero: false, skipped: [] };
          await scan(found, prog, opts);
        }
        status.textContent = `Done: ${found.length} folders with bookmarks, ${total(found)} bookmarks in total.` + skippedTxt(opts);
      } catch (e) {
        status.textContent = (e.message === 'Cancelled' ? 'Cancelled. ' : 'Error: ' + e.message + '. ') + `Collected: ${total(found)} bookmarks.` + skippedTxt(opts);
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
          status.textContent = `Downloaded 1 file (${total(ns)} bookmarks).`;
        } else {
          const used = new Map();
          for (const n of ns) {
            let b = fname(n); const k = used.get(b) || 0; used.set(b, k + 1);
            if (k) b += '_' + (k + 1);
            download(`opera_bookmarks_${b}.${f.ext}`, f.make([n]), f.mime);
            await sleep(400);
          }
          status.textContent = `Downloaded ${ns.length} files.`;
        }
      } catch (e) { status.textContent = 'Download error: ' + e.message; }
    };

    const exportPane = h('div', { padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }, {},
      h('div', { display: 'flex', gap: '8px' }, {}, scanBtn, stop),
      status, list,
      h('div', { display: 'flex', gap: '8px' }, {}, all, none),
      h('div', { display: 'flex', gap: '8px', alignItems: 'center' }, {}, h('span', { color: C.mut }, { textContent: 'Format' }), fmtSel),
      h('label', { display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer' }, {}, merge, 'Merge selected into one file'),
      go);

    // ---------- Import tab ----------
    const inputSt = { padding: '7px', borderRadius: '8px', border: '1px solid ' + C.line, background: C.card, color: '#fff', font: 'inherit', width: '70px' };
    let perFile = [], items = [], pos = 0, running = false, loadErr = '';
    const impStatus = h('div', { color: C.mut, fontSize: '12px', wordBreak: 'break-word', minHeight: '18px', whiteSpace: 'pre-wrap' },
      { textContent: 'Choose one or more exported files (JSON, HTML, CSV, TXT).' });
    const curLine = h('div', { color: C.fg, fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minHeight: '18px' }, { textContent: '' });
    const fileIn = h('input', { color: C.fg, font: 'inherit', maxWidth: '100%' }, { type: 'file', multiple: true, accept: '.json,.html,.htm,.csv,.txt,application/json,text/html,text/csv,text/plain' });
    const startIn = h('input', inputSt, { type: 'number', min: '1', value: '1' });
    const dedupe = h('input', {}, { type: 'checkbox', checked: true });
    const bgTabs = h('input', {}, { type: 'checkbox', checked: true });
    const startBtn = btn('Start', true), pauseBtn = btn('Pause'), nextBtn = btn('Open next'), resetBtn = btn('Reset');
    pauseBtn.style.display = 'none';

    const show = () => {
      startIn.value = String(Math.min(pos + 1, Math.max(items.length, 1)));
      const nx = items[pos];
      if (items.length) impStatus.textContent = pos >= items.length ? `Done: opened ${items.length} of ${items.length}.` : `Opened ${pos} of ${items.length}.`;
      curLine.textContent = !items.length ? '' : pos >= items.length ? '' : 'Next: ' + nx.url;
      curLine.title = curLine.textContent;
      const off = !items.length || pos >= items.length;
      startBtn.style.display = running ? 'none' : '';
      pauseBtn.style.display = running ? '' : 'none';
      for (const b of [startBtn, nextBtn]) { b.disabled = off || running; b.style.opacity = b.disabled ? '.5' : '1'; }
      resetBtn.disabled = !items.length || running; resetBtn.style.opacity = resetBtn.disabled ? '.5' : '1';
    };

    // Merges all loaded files in order, removes duplicates across all of them,
    // then reports every file separately followed by the combined total
    const apply = () => {
      const seen = new Set();
      items = [];
      const lines = [];
      let total = 0;
      for (const f of perFile) {
        for (const x of f.list) {
          if (dedupe.checked && seen.has(x.url)) continue;
          seen.add(x.url); items.push(x);
        }
        total += f.list.length;
        lines.push(`• ${f.name}: ${f.list.length} URLs`);
      }
      pos = 0;
      show();
      impStatus.textContent = (perFile.length
        ? lines.join('\n') + `\nTotal: ${total} URLs from ${perFile.length} file${perFile.length === 1 ? '' : 's'}` + (dedupe.checked ? `, ${total - items.length} duplicates removed → ${items.length} to open.` : ` → ${items.length} to open.`)
        : 'No valid http(s) URLs found.') + loadErr;
    };

    // Opens one page. Uses Tampermonkey's GM_openInTab (not affected by the popup blocker);
    // falls back to window.open. Returns false if the browser blocked it.
    const openOne = () => {
      const it = items[pos];
      if (typeof GM_openInTab === 'function') {
        try { GM_openInTab(it.url, { active: !bgTabs.checked, insert: true }); pos++; return true; }
        catch (e) { /* fall through to window.open */ }
      }
      const w = window.open(it.url, '_blank');
      if (!w) return false;
      try { w.opener = null; } catch (e) { /* cross-origin, ignore */ }
      pos++;
      return true;
    };
    const blockedMsg = () => { impStatus.textContent = 'Popup blocked. Allow popups for this site, then continue with "Open next" or "Start".'; };

    fileIn.onchange = async () => {
      const files = [...fileIn.files];
      if (!files.length) return;
      perFile = []; loadErr = '';
      for (const f of files) {
        try { perFile.push({ name: f.name, list: parseImport(await f.text()) }); }
        catch (e) { loadErr += `\n• ${f.name}: skipped, unreadable file`; }
      }
      apply();
    };
    dedupe.onchange = () => { if (perFile.length && !running) apply(); };
    startIn.onchange = () => { if (!running && items.length) { pos = Math.min(Math.max((parseInt(startIn.value, 10) || 1) - 1, 0), items.length); show(); } };
    nextBtn.onclick = () => { if (pos < items.length && !running) { if (openOne()) show(); else blockedMsg(); } };
    resetBtn.onclick = () => { pos = 0; show(); };
    pauseBtn.onclick = () => { running = false; };
    startBtn.onclick = async () => { // the first page opens synchronously inside the click, so it is not treated as a popup
      if (running || pos >= items.length) return;
      running = true; show();
      let blocked = false;
      while (running && pos < items.length) {
        const url = items[pos].url;
        if (!openOne()) { blocked = true; break; }
        impStatus.textContent = `Opened ${pos} of ${items.length}…`;
        curLine.textContent = 'Opened: ' + url; curLine.title = url;
        await sleep(0); // yield so the UI updates and Pause works
      }
      running = false; show();
      if (blocked) blockedMsg();
    };

    const importPane = h('div', { padding: '10px', display: 'none', flexDirection: 'column', gap: '8px' }, {},
      fileIn, impStatus, curLine,
      h('div', { display: 'flex', gap: '8px', alignItems: 'center' }, {}, h('span', { color: C.mut }, { textContent: 'Start from #' }), startIn),
      h('label', { display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer' }, {}, dedupe, 'Skip duplicate URLs'),
      h('label', { display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer' }, {}, bgTabs, 'Open in background tabs'),
      h('div', { display: 'flex', gap: '8px' }, {}, startBtn, pauseBtn, nextBtn, resetBtn));
    show();

    // ---------- Tabs ----------
    const tabExp = btn('Export', true), tabImp = btn('Import');
    const setTab = t => {
      exportPane.style.display = t === 'exp' ? 'flex' : 'none';
      importPane.style.display = t === 'imp' ? 'flex' : 'none';
      tabExp.style.background = t === 'exp' ? C.acc : C.card;
      tabImp.style.background = t === 'imp' ? C.acc : C.card;
    };
    tabExp.onclick = () => setTab('exp'); tabImp.onclick = () => setTab('imp');
    tabExp.style.flex = tabImp.style.flex = '1';
    const body = h('div', { display: 'flex', flexDirection: 'column', overflowY: 'auto' }, {},
      h('div', { display: 'flex', gap: '8px', padding: '8px 10px 0' }, {}, tabExp, tabImp), exportPane, importPane);

    const toggle = btn('–'); toggle.style.padding = '2px 10px';
    toggle.onclick = () => { const hide = body.style.display !== 'none'; body.style.display = hide ? 'none' : 'flex'; toggle.textContent = hide ? '+' : '–'; };
    const head = h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid ' + C.line, background: '#111115' }, {},
      h('div', {}, {},
        h('div', { fontWeight: '700' }, { textContent: 'Opera sync export' }),
        h('div', { color: C.mut, fontSize: '11px' }, { textContent: 'Created by Sperhak' })),
      toggle);

    const root = h('div', {
      position: 'fixed', right: '10px', bottom: '10px', zIndex: '2147483647', width: 'min(390px, 94vw)', maxHeight: '88vh',
      display: 'flex', flexDirection: 'column', background: C.bg, color: C.fg, border: '1px solid ' + C.line,
      borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,.5)', font: '13px/1.4 system-ui, sans-serif', overflow: 'hidden'
    }, { id: 'opexp' }, head, body);
    document.body.append(root);
    upd();
  };

  // The page is a SPA and we run at document-start, so wait for <body> to exist
  const iv = setInterval(() => { try { mk(); if (document.getElementById('opexp')) clearInterval(iv); } catch (e) { /* silent */ } }, 500);
})();

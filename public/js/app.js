/* Kernel & Co. storefront — vanilla JS single-page app */
(() => {
  'use strict';

  // ================= Utilities =================
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const main = $('#main');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (paise) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const pctOff = (v) => (v.mrp > v.price ? Math.round(((v.mrp - v.price) / v.mrp) * 100) : 0);
  const fmtDate = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  async function api(url, { method = 'GET', body } = {}) {
    const res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const e = new Error(data?.error || 'Something went wrong. Please try again.');
      e.status = res.status; e.data = data; throw e;
    }
    return data;
  }

  let toastTimer;
  function toast(html, ms = 2600) {
    const t = $('#toast');
    t.innerHTML = html; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function modal(html) {
    const m = $('#modal');
    $('#modalCard').innerHTML = html; m.hidden = false;
    return { close: () => { m.hidden = true; $('#modalCard').innerHTML = ''; }, el: $('#modalCard') };
  }

  function showErrors(form, errors = {}) {
    $$('.field', form).forEach((f) => { f.classList.remove('invalid'); const e = $('.err', f); if (e) e.textContent = ''; });
    let first;
    for (const [k, msg] of Object.entries(errors)) {
      const input = form.querySelector(`[name="${k}"]`);
      const f = input?.closest('.field');
      if (!f) continue;
      f.classList.add('invalid');
      let e = $('.err', f); if (!e) { e = document.createElement('div'); e.className = 'err'; f.append(e); }
      e.textContent = msg; first ||= input;
    }
    first?.focus();
  }

  const field = (name, label, { type = 'text', value = '', attrs = '', full = false } = {}) => `
    <div class="field${full ? ' full' : ''}"><label for="f-${name}">${label}</label>
      <input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}><div class="err"></div></div>`;

  function loadScript(src) {
    return new Promise((ok, fail) => {
      if ($(`script[src="${src}"]`)) return ok();
      const s = document.createElement('script'); s.src = src; s.onload = ok;
      s.onerror = () => fail(new Error('Could not load the payment window. Check your connection and try again.'));
      document.head.append(s);
    });
  }

  // ================= Product artwork (generated SVG, no image files needed) =================
  function rng(seed) {
    let s = 2166136261; for (const c of String(seed)) s = Math.imul(s ^ c.charCodeAt(0), 16777619) >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  }
  function mix(hex, to, t) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
    const ch = (x, sh) => (x >> sh) & 255;
    const m = (sh) => Math.round(ch(a, sh) + (ch(b, sh) - ch(a, sh)) * t);
    return '#' + ((1 << 24) + (m(16) << 16) + (m(8) << 8) + m(0)).toString(16).slice(1);
  }
  const GLYPH = {
    almond: (c, d) => `<path d="M0-27C15-14 16 9 0 27C-16 9-15-14 0-27Z" fill="${c}"/><path d="M0-19C6-6 6 8 0 19M-6-10c2 6 2 14 0 20" stroke="${d}" stroke-width="1.6" fill="none" opacity=".35"/>`,
    cashew: (c, d) => `<path d="M-21-4C-23-24 10-30 21-12C29 3 19 24 2 23C10 12 11-1 1-6C-8-10-14-4-12 5C-18 4-21 0-21-4Z" fill="${c}"/><path d="M-13-12C-4-20 12-18 17-7" stroke="${d}" stroke-width="1.4" fill="none" opacity=".3"/>`,
    walnut: (c, d) => `<path d="M-23 0C-23-17-11-23 0-19C11-23 23-17 23 0C23 17 11 23 0 19C-11 23-23 17-23 0Z" fill="${c}"/><path d="M0-19V19M-12-9c5 5 5 13 0 18M12-9c-5 5-5 13 0 18M-19-3h7M12 4h7" stroke="${d}" fill="none" stroke-width="2" opacity=".45" stroke-linecap="round"/>`,
    pistachio: (c, d) => `<ellipse rx="19" ry="25" fill="#DCC9A1"/><path d="M-2-24C-14-12-14 12-2 24" stroke="#B49B6B" stroke-width="2" fill="none"/><ellipse cx="5" rx="10" ry="18" fill="${c}"/><ellipse cx="7" cy="-4" rx="4" ry="8" fill="${mix(c, '#ffffff', .3)}" opacity=".6"/>`,
    seed: (c, d) => `<ellipse rx="5.5" ry="8.5" fill="${c}"/><ellipse cx="-1.5" cy="-2" rx="1.6" ry="3.4" fill="#fff" opacity=".22"/>`,
    date: (c, d) => `<ellipse rx="15" ry="31" fill="${c}"/><path d="M-6-22C-10-6-10 8-5 24" stroke="${mix(c, '#ffffff', .35)}" stroke-width="3" fill="none" opacity=".45" stroke-linecap="round"/><path d="M3-26c4 10 5 34 0 50" stroke="${d}" stroke-width="1.5" fill="none" opacity=".4"/>`,
    raisin: (c, d) => `<path d="M-11-3C-13-11-4-14 2-12C10-13 14-5 12 2C13 9 4 14-2 12C-10 13-13 5-11-3Z" fill="${c}"/><path d="M-6-5c4 2 8 1 11-2M-5 4c3 2 7 2 10 0" stroke="${d}" stroke-width="1.4" fill="none" opacity=".55"/>`,
    makhana: (c, d) => `<circle r="23" fill="#F6EEE1"/><circle r="23" fill="none" stroke="#D9C8AE" stroke-width="1.5"/><path d="M-12-10c4-3 7-2 9 1M6 8c4 1 6 4 5 7M-3 12c-2 2-5 3-8 2" stroke="#9C7652" stroke-width="3" stroke-linecap="round" fill="none" opacity=".7"/>`,
  };
  const DENSITY = { seed: 150, raisin: 60, makhana: 22, date: 20, almond: 26, cashew: 24, walnut: 22, pistachio: 22 };
  const MIX_SET = [['almond', '#B9804E'], ['cashew', '#E6C99A'], ['raisin', '#3F2A2E'], ['raisin', '#9B2D3A'], ['seed', '#6E8B4E'], ['seed', '#9C9480']];

  function art(p, { bg, count, scale = 1, label } = {}) {
    const r = rng(p.slug || p.shape || 'x');
    const color = p.color || '#B07A45';
    const back = bg || mix(color, '#F7F1E6', color === '#EFE3CF' || color === '#E2C9A6' ? 0.25 : 0.82);
    const n = count || (p.shape === 'mix' ? 60 : DENSITY[p.shape] || 24);
    let g = '';
    for (let i = 0; i < n; i++) {
      let shape = p.shape, c = color;
      if (shape === 'mix' || !GLYPH[shape]) [shape, c] = MIX_SET[Math.floor(r() * MIX_SET.length)];
      const tone = r();
      const fill = tone < 0.5 ? mix(c, '#000000', tone * 0.25) : mix(c, '#ffffff', (tone - 0.5) * 0.3);
      const s = (0.75 + r() * 0.55) * scale * (shape === 'seed' ? 1.2 : 1);
      g += `<g transform="translate(${(r() * 440 - 20).toFixed(1)} ${(r() * 440 - 20).toFixed(1)}) rotate(${Math.floor(r() * 360)}) scale(${s.toFixed(2)})">${GLYPH[shape](fill, mix(c, '#000000', 0.45))}</g>`;
    }
    return `<svg class="art" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(label || p.name || '')}">
      <rect width="400" height="400" fill="${back}"/>${g}</svg>`;
  }
  const CAT_ART = {
    'dry-fruits': { slug: 'cat-dry', shape: 'almond', color: '#B9804E' },
    seeds: { slug: 'cat-seeds', shape: 'seed', color: '#6E8B4E' },
    'dates-berries': { slug: 'cat-dates', shape: 'date', color: '#6B3A22' },
    'mixes-snacks': { slug: 'cat-mix', shape: 'makhana', color: '#E2C9A6' },
  };

  // ================= State =================
  const state = { config: null, user: null, categories: [], cart: store.get('ns_cart', []) };

  function saveCart() { store.set('ns_cart', state.cart); updateCartBadge(); }
  function updateCartBadge() {
    const n = state.cart.reduce((s, l) => s + l.qty, 0);
    const b = $('#cartCount'); b.textContent = n; b.hidden = n === 0;
  }
  function addToCart(p, v, qty = 1) {
    const line = state.cart.find((l) => l.variantId === v.id);
    const current = line ? line.qty : 0;
    const next = Math.min(current + qty, 20, v.stock);
    if (next <= current) { toast(v.stock ? `Max ${Math.min(20, v.stock)} per item` : 'Out of stock'); return; }
    if (line) line.qty = next;
    else state.cart.push({ variantId: v.id, qty: next, slug: p.slug, name: p.name, label: v.label, price: v.price, color: p.color, shape: p.shape });
    saveCart();
    toast(`Added ${esc(p.name)} · ${esc(v.label)} <a href="/cart" data-link>View cart</a>`);
  }
  const cartItems = () => state.cart.map((l) => ({ variantId: l.variantId, qty: l.qty }));

  function updateHeader() {
    const link = $('#accountLink');
    if (state.user) {
      link.href = state.user.role === 'admin' ? '/admin' : '/account';
      $('#accountLabel').textContent = state.user.role === 'admin' ? 'Admin' : state.user.name.split(' ')[0];
    } else { link.href = '/login'; $('#accountLabel').textContent = 'Login'; }
  }

  function rememberGuestOrder(orderNo, token) {
    const list = store.get('ns_guest_orders', []).filter((o) => o.orderNo !== orderNo);
    list.unshift({ orderNo, token, at: Date.now() });
    store.set('ns_guest_orders', list.slice(0, 10));
  }

  // ================= Router =================
  const routes = [];
  const route = (pattern, view) => routes.push([pattern, view]);
  function navigate(url, { replace = false } = {}) {
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
    render();
  }
  async function render() {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    const params = new URLSearchParams(location.search);
    document.body.classList.remove('sticky-on');
    for (const [re, view] of routes) {
      const m = path.match(re);
      if (!m) continue;
      main.innerHTML = '<div class="loading"><div class="spinner"></div>Loading…</div>';
      try { await view(m, params); }
      catch (e) {
        console.error(e);
        main.innerHTML = `<div class="wrap page"><div class="empty"><h2>We hit a snag</h2><p class="muted">${esc(e.message)}</p>
          <a class="btn" href="/" data-link>Back to home</a></div></div>`;
      }
      highlightCategory(params.get('c'), path);
      window.scrollTo(0, 0);
      main.focus({ preventScroll: true });
      return;
    }
    view404();
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault(); navigate(a.getAttribute('href'));
  });
  window.addEventListener('popstate', render);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !$('#modal').dataset.locked) { $('#modal').hidden = true; } });

  function setTitle(t) { document.title = t ? `${t} — ${state.config.store.name}` : `${state.config.store.name} — Nuts, Seeds & Dry Fruits`; }

  function highlightCategory(c, path) {
    $$('#catNav .chip').forEach((ch) => ch.classList.toggle('active',
      (path === '/shop' && (ch.dataset.cat || '') === (c || '')) || false));
  }

  // ================= Shared fragments =================
  function productCard(p) {
    const v = p.variants.find((x) => x.stock > 0) || p.variants[0];
    const off = pctOff(v);
    const allOut = p.variants.every((x) => x.stock <= 0);
    return `<article class="pcard" data-slug="${esc(p.slug)}">
      <a class="thumb" href="/p/${esc(p.slug)}" data-link aria-label="${esc(p.name)}">${art(p)}${off ? `<span class="tag">${off}% OFF</span>` : ''}</a>
      <div class="body">
        <a class="name" href="/p/${esc(p.slug)}" data-link>${esc(p.name)}</a>
        <div class="short">${esc(p.short)}</div>
        ${p.variants.length > 1
          ? `<select aria-label="Pack size" class="vsel">${p.variants.map((x) => `<option value="${x.id}" ${x.id === v.id ? 'selected' : ''} ${x.stock <= 0 ? 'disabled' : ''}>${esc(x.label)} — ${money(x.price)}${x.stock <= 0 ? ' (sold out)' : ''}</option>`).join('')}</select>`
          : `<div class="small muted">${esc(v.label)}</div>`}
        <div class="foot">
          <div><span class="price">${money(v.price)}</span>${v.mrp > v.price ? `<span class="mrp">${money(v.mrp)}</span>` : ''}</div>
          ${allOut ? '<span class="oos">Sold out</span>' : '<button class="add-btn" type="button">Add</button>'}
        </div>
      </div></article>`;
  }
  function bindCards(root, products) {
    $$('.pcard', root).forEach((card) => {
      const p = products.find((x) => x.slug === card.dataset.slug);
      const sel = $('.vsel', card);
      const cur = () => (sel ? p.variants.find((x) => x.id === Number(sel.value)) : p.variants[0]);
      sel?.addEventListener('change', () => {
        const v = cur();
        $('.foot > div', card).innerHTML = `<span class="price">${money(v.price)}</span>${v.mrp > v.price ? `<span class="mrp">${money(v.mrp)}</span>` : ''}`;
      });
      $('.add-btn', card)?.addEventListener('click', () => addToCart(p, cur(), 1));
    });
  }

  function summaryBox(q, { title = 'Order summary', lines = false } = {}) {
    const cfg = state.config;
    const remaining = Math.max(0, cfg.freeShippingAbove - q.subtotal);
    const pct = Math.min(100, (q.subtotal / cfg.freeShippingAbove) * 100);
    return `<div class="card summary"><h3>${title}</h3>
      ${lines ? q.lines.map((l) => `<div class="mini-line"><span>${esc(l.name)} · ${esc(l.label)} × ${l.qty}</span><span>${money(l.lineTotal)}</span></div>`).join('') + '<hr style="border:0;border-top:1px solid var(--line);margin:8px 0">' : ''}
      <div class="sum-row"><span>Subtotal</span><span>${money(q.subtotal)}</span></div>
      <div class="sum-row"><span>Shipping</span><span>${q.shipping ? money(q.shipping) : '<b style="color:var(--ok)">FREE</b>'}</span></div>
      ${remaining > 0 ? `<div class="small muted">Add ${money(remaining)} more for free shipping</div><div class="ship-meter"><i style="width:${pct}%"></i></div>` : ''}
      <div class="sum-row total"><span>Total</span><span>${money(q.total)}</span></div>
      <div class="small muted">Prices include GST.</div>
      <div id="summaryAction"></div></div>`;
  }

  // ================= Views =================
  route(/^\/$/, async () => {
    setTitle();
    const featured = await api('/api/products?featured=1');
    const cfg = state.config;
    main.innerHTML = `
      <section class="hero"><div class="wrap hero-inner">
        <div>
          <h1>Real nuts. Real seeds. <em>Nothing extra.</em></h1>
          <p>${esc(cfg.store.tagline)}. Hand-graded, nitrogen-flushed packs delivered across India — free shipping above ${money(cfg.freeShippingAbove)}.</p>
          <div class="hero-ctas"><a class="btn" href="/shop" data-link>Shop the range</a><a class="btn btn-ghost" href="/shop?c=seeds" data-link>Explore seeds</a></div>
        </div>
        <div class="hero-art">${art({ slug: 'hero', shape: 'mix' }, { bg: '#E9DCC4', count: 120, scale: 1.25, label: 'Assorted nuts, seeds and dried fruit' })}</div>
      </div></section>

      <section class="wrap section">
        <div class="trust">
          <div><strong>Packed fresh weekly</strong>Small batches, never warehoused for months</div>
          <div><strong>No added sugar</strong>Nothing artificial in our dry fruits</div>
          <div><strong>Secure payments</strong>UPI, cards, net banking, wallets</div>
          <div><strong>Cash on Delivery</strong>Pay at your doorstep, pan-India</div>
        </div>
      </section>

      <section class="wrap section" style="padding-top:0">
        <div class="section-head"><h2>Shop by category</h2><a href="/shop" data-link>View all →</a></div>
        <div class="cat-grid">${state.categories.map((c) => `
          <a class="cat-card" href="/shop?c=${c.slug}" data-link>${art(CAT_ART[c.slug] || { slug: c.slug, shape: 'mix' }, { label: c.name })}
            <h3>${esc(c.name)}</h3><span>${c.count} products</span></a>`).join('')}</div>
      </section>

      <section class="wrap section" style="padding-top:0">
        <div class="section-head"><h2>Bestsellers</h2><a href="/shop" data-link>See everything →</a></div>
        <div class="grid" id="featGrid">${featured.map(productCard).join('')}</div>
      </section>`;
    bindCards($('#featGrid'), featured);
  });

  route(/^\/shop$/, async (_m, params) => {
    const c = params.get('c') || '';
    const q = params.get('q') || '';
    const qs = new URLSearchParams(); if (c) qs.set('category', c); if (q) qs.set('q', q);
    const products = await api('/api/products?' + qs);
    const cat = state.categories.find((x) => x.slug === c);
    setTitle(cat ? cat.name : q ? `Search: ${q}` : 'Shop all');
    $('#searchInput').value = q;
    main.innerHTML = `<div class="wrap page">
      <div class="crumbs"><a href="/" data-link>Home</a> / ${cat ? `<a href="/shop" data-link>Shop</a> / ${esc(cat.name)}` : 'Shop'}</div>
      <div class="page-head"><h1>${q ? `Results for “${esc(q)}”` : esc(cat ? cat.name : 'All products')}</h1>
        ${cat ? `<p class="muted">${esc(cat.blurb)}</p>` : ''}</div>
      <div class="shop-bar"><span class="muted small">${products.length} product${products.length === 1 ? '' : 's'}</span>
        <select id="sort" aria-label="Sort" class="chip" style="padding-right:8px">
          <option value="">Sort: Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="name">Name A–Z</option>
        </select></div>
      <div class="grid" id="shopGrid"></div></div>`;
    const draw = (list) => {
      $('#shopGrid').innerHTML = list.length ? list.map(productCard).join('')
        : `<div class="empty" style="grid-column:1/-1"><h3>Nothing matched</h3><p class="muted">Try “almond”, “seeds” or “makhana”.</p><a class="btn" href="/shop" data-link>Browse all</a></div>`;
      bindCards($('#shopGrid'), list);
    };
    draw(products);
    $('#sort').addEventListener('change', (e) => {
      const minP = (p) => Math.min(...p.variants.map((v) => v.price));
      const sorted = [...products];
      if (e.target.value === 'low') sorted.sort((a, b) => minP(a) - minP(b));
      if (e.target.value === 'high') sorted.sort((a, b) => minP(b) - minP(a));
      if (e.target.value === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
      draw(sorted);
    });
  });

  route(/^\/p\/([\w-]+)$/, async (m) => {
    const { product: p, related } = await api(`/api/products/${m[1]}`);
    setTitle(p.name);
    let v = p.variants.find((x) => x.stock > 0) || p.variants[0];
    let qty = 1;
    main.innerHTML = `<div class="wrap page has-sticky">
      <div class="crumbs"><a href="/" data-link>Home</a> / <a href="/shop?c=${p.category}" data-link>${esc(p.category_name)}</a> / ${esc(p.name)}</div>
      <div class="pdp">
        <div class="pdp-art">${art(p, { scale: 1.6, count: Math.round((DENSITY[p.shape] || 40) * 0.55) })}</div>
        <div class="pdp-info">
          <h1>${esc(p.name)}</h1>
          <p class="muted">${esc(p.short)}</p>
          <div class="price-row" id="priceRow"></div>
          <div class="tax-note">Inclusive of all taxes · Free shipping above ${money(state.config.freeShippingAbove)}</div>
          <div class="opt-label">Pack size</div>
          <div class="variants" id="variants">${p.variants.map((x) => `
            <button type="button" class="variant" data-id="${x.id}" ${x.stock <= 0 ? 'disabled' : ''}>
              <b>${esc(x.label)}</b><small>${x.stock <= 0 ? 'Sold out' : money(x.price)}</small></button>`).join('')}</div>
          <div class="buy-row">
            <div class="qty" aria-label="Quantity"><button type="button" id="qMinus" aria-label="Decrease">−</button><span id="qVal">1</span><button type="button" id="qPlus" aria-label="Increase">+</button></div>
            <button class="btn btn-block" id="addBtn" type="button">Add to cart</button>
          </div>
          <div id="stockNote" class="small" style="margin:-10px 0 16px"></div>
          <ul class="benefits">${p.benefits.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
          <div class="facts">
            <div><span class="muted">Origin</span><b>${esc(p.origin || '—')}</b></div>
            <div><span class="muted">Shelf life</span><b>${esc(p.shelf_life || '—')}</b></div>
            <div><span class="muted">Packaging</span><b>Zip-lock, nitrogen flushed</b></div>
            <div><span class="muted">Storage</span><b>Cool, dry place</b></div>
          </div>
          <h3>About this product</h3>
          <p class="muted">${esc(p.description)}</p>
        </div>
      </div>
      ${related.length ? `<section class="section"><div class="section-head"><h2>You may also like</h2></div><div class="grid" id="relGrid">${related.map(productCard).join('')}</div></section>` : ''}
    </div>
    <div class="sticky-buy"><div><div class="price" id="stickyPrice"></div><div class="small muted" id="stickyLabel"></div></div><button class="btn" id="stickyAdd" type="button">Add to cart</button></div>`;
    document.body.classList.add('sticky-on');

    const sync = () => {
      $$('#variants .variant').forEach((b) => b.classList.toggle('active', Number(b.dataset.id) === v.id));
      const off = pctOff(v);
      $('#priceRow').innerHTML = `<span class="price">${money(v.price)}</span>${v.mrp > v.price ? `<span class="mrp">MRP ${money(v.mrp)}</span><span class="off">${off}% off</span>` : ''}`;
      $('#qVal').textContent = qty;
      const out = v.stock <= 0;
      $('#addBtn').disabled = $('#stickyAdd').disabled = out;
      $('#addBtn').textContent = $('#stickyAdd').textContent = out ? 'Sold out' : 'Add to cart';
      $('#stockNote').innerHTML = !out && v.stock < 10 ? `<span class="oos">Only ${v.stock} left</span>` : '';
      $('#stickyPrice').textContent = money(v.price * qty);
      $('#stickyLabel').textContent = `${v.label} × ${qty}`;
    };
    $('#variants').addEventListener('click', (e) => {
      const b = e.target.closest('.variant'); if (!b || b.disabled) return;
      v = p.variants.find((x) => x.id === Number(b.dataset.id)); qty = Math.min(qty, Math.max(1, v.stock)); sync();
    });
    $('#qMinus').onclick = () => { qty = Math.max(1, qty - 1); sync(); };
    $('#qPlus').onclick = () => { qty = Math.min(20, v.stock, qty + 1); sync(); };
    $('#addBtn').onclick = $('#stickyAdd').onclick = () => addToCart(p, v, qty);
    sync();
    if (related.length) bindCards($('#relGrid'), related);
  });

  route(/^\/cart$/, async () => {
    setTitle('Your cart');
    if (!state.cart.length) {
      main.innerHTML = `<div class="wrap page"><div class="empty"><div class="art">${art({ slug: 'empty', shape: 'almond', color: '#B9804E' })}</div>
        <h2>Your cart is empty</h2><p class="muted">Start with our bestselling almonds or a seed mix.</p><a class="btn" href="/shop" data-link>Start shopping</a></div></div>`;
      return;
    }
    let quote, problem = '';
    try { quote = await api('/api/orders/quote', { method: 'POST', body: { items: cartItems() } }); }
    catch (e) { problem = e.message; }
    // keep displayed prices in line with the server
    if (quote) {
      for (const l of quote.lines) { const c = state.cart.find((x) => x.variantId === l.variantId); if (c) c.price = l.unitPrice; }
      saveCart();
    }
    const subtotal = state.cart.reduce((s, l) => s + l.price * l.qty, 0);
    const q = quote || { subtotal, shipping: 0, total: subtotal, lines: [] };

    main.innerHTML = `<div class="wrap page"><div class="page-head"><h1>Your cart</h1></div>
      ${problem ? `<div class="alert">${esc(problem)}</div>` : ''}
      <div class="two-col">
        <div class="card" style="padding-top:6px;padding-bottom:6px">${state.cart.map((l) => `
          <div class="cart-line" data-id="${l.variantId}">
            <a class="art" href="/p/${esc(l.slug)}" data-link>${art(l, { count: 14, scale: 1.4 })}</a>
            <div><a class="ttl" href="/p/${esc(l.slug)}" data-link>${esc(l.name)}</a><div class="meta">${esc(l.label)} · ${money(l.price)}</div>
              <div class="qty sm" style="margin-top:8px"><button type="button" data-act="dec" aria-label="Decrease">−</button><span>${l.qty}</span><button type="button" data-act="inc" aria-label="Increase">+</button></div></div>
            <div class="right"><b>${money(l.price * l.qty)}</b><button class="remove" type="button" data-act="rm">Remove</button></div>
          </div>`).join('')}</div>
        <aside>${summaryBox(q)}</aside>
      </div></div>`;
    $('#summaryAction').innerHTML = `<a class="btn btn-block" style="margin-top:16px" href="/checkout" data-link ${problem ? 'aria-disabled="true"' : ''}>Proceed to checkout</a>
      <a class="btn btn-ghost btn-block" style="margin-top:8px" href="/shop" data-link>Continue shopping</a>`;
    main.querySelector('.card').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const id = Number(b.closest('.cart-line').dataset.id);
      const line = state.cart.find((x) => x.variantId === id);
      if (b.dataset.act === 'inc') line.qty = Math.min(20, line.qty + 1);
      if (b.dataset.act === 'dec') line.qty -= 1;
      if (b.dataset.act === 'rm' || line.qty <= 0) state.cart = state.cart.filter((x) => x.variantId !== id);
      saveCart(); render();
    });
  });

  route(/^\/checkout$/, async () => {
    setTitle('Checkout');
    if (!state.cart.length) return navigate('/cart', { replace: true });
    const cfg = state.config;
    let quote;
    try { quote = await api('/api/orders/quote', { method: 'POST', body: { items: cartItems() } }); }
    catch (e) { toast(esc(e.message), 4000); return navigate('/cart', { replace: true }); }
    const addresses = state.user ? await api('/api/auth/addresses') : [];
    const onlineOk = cfg.razorpay || cfg.demoPayments;
    const codOk = quote.codAvailable;
    const states = cfg.states.map((s) => `<option>${esc(s)}</option>`).join('');

    main.innerHTML = `<div class="wrap page"><div class="crumbs"><a href="/cart" data-link>Cart</a> / Checkout</div>
      <div class="page-head"><h1>Checkout</h1></div>
      <form class="two-col" id="coForm" novalidate>
        <div class="stack">
          <section class="card">
            <div class="step-title"><span class="num">1</span><h3>Contact</h3></div>
            ${state.user
              ? `<p style="margin:0">Signed in as <b>${esc(state.user.email)}</b></p>`
              : `<div class="alert info" style="margin-bottom:16px">Checking out as a guest. <a href="/login?next=/checkout" data-link><b>Log in</b></a> or <a href="/register?next=/checkout" data-link><b>create an account</b></a> to track orders and save addresses.</div>
                 ${field('email', 'Email for order updates', { type: 'email', attrs: 'autocomplete="email" required' })}`}
          </section>
          <section class="card">
            <div class="step-title"><span class="num">2</span><h3>Delivery address</h3></div>
            ${addresses.length ? `<div id="savedAddr">${addresses.map((a, i) => `
              <label class="addr-opt"><input type="radio" name="addrChoice" value="${a.id}" ${i === 0 ? 'checked' : ''}>
                <span><b>${esc(a.name)} · ${esc(a.phone)}</b><small>${esc([a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', '))}</small></span></label>`).join('')}
              <label class="addr-opt"><input type="radio" name="addrChoice" value="new"><span><b>Deliver to a new address</b></span></label></div>` : ''}
            <div id="addrFields" ${addresses.length ? 'hidden' : ''}>
              <div class="grid-2">
                ${field('name', 'Full name', { value: state.user?.name || '', attrs: 'autocomplete="name"' })}
                ${field('phone', 'Mobile number', { type: 'tel', value: state.user?.phone || '', attrs: 'autocomplete="tel" inputmode="numeric" maxlength="14" placeholder="10-digit mobile"' })}
              </div>
              ${field('line1', 'Flat / house no., building, street', { attrs: 'autocomplete="address-line1"' })}
              ${field('line2', 'Area, landmark (optional)', { attrs: 'autocomplete="address-line2"' })}
              <div class="grid-2">
                ${field('pincode', 'PIN code', { attrs: 'autocomplete="postal-code" inputmode="numeric" maxlength="6"' })}
                ${field('city', 'City / district', { attrs: 'autocomplete="address-level2"' })}
              </div>
              <div class="field"><label for="f-state">State</label><select id="f-state" name="state" autocomplete="address-level1"><option value="">Select state</option>${states}</select><div class="err"></div></div>
              ${state.user ? '<label class="check"><input type="checkbox" name="saveAddress" checked> Save this address for next time</label>' : ''}
            </div>
          </section>
          <section class="card">
            <div class="step-title"><span class="num">3</span><h3>Payment</h3></div>
            <label class="pay-opt ${onlineOk ? '' : 'disabled'}"><input type="radio" name="paymentMethod" value="online" ${onlineOk ? 'checked' : 'disabled'}>
              <span><b>Pay online</b><small>UPI, debit/credit cards, net banking, wallets — secured by Razorpay${cfg.demoPayments ? ' (demo mode)' : ''}</small></span></label>
            <label class="pay-opt ${codOk ? '' : 'disabled'}"><input type="radio" name="paymentMethod" value="cod" ${codOk ? (onlineOk ? '' : 'checked') : 'disabled'}>
              <span><b>Cash on Delivery</b><small>${codOk ? 'Pay in cash or UPI when your order arrives' : `Available on orders up to ${money(cfg.codMaxOrder)}`}</small></span></label>
            <div id="coError"></div>
          </section>
        </div>
        <aside>${summaryBox(quote, { lines: true })}</aside>
      </form></div>`;
    $('#summaryAction').innerHTML = `<button class="btn btn-almond btn-block" style="margin-top:16px" type="submit" form="coForm" id="placeBtn">Place order · ${money(quote.total)}</button>
      <p class="small muted" style="margin:10px 0 0">By placing the order you agree to our <a href="/pages/terms" data-link>terms</a> and <a href="/pages/refunds" data-link>refund policy</a>.</p>`;

    const form = $('#coForm');
    $('#savedAddr')?.addEventListener('change', () => { $('#addrFields').hidden = form.addrChoice.value !== 'new'; });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      let address;
      const choice = fd.get('addrChoice');
      if (choice && choice !== 'new') {
        const a = addresses.find((x) => String(x.id) === choice);
        address = { name: a.name, phone: a.phone, line1: a.line1, line2: a.line2, city: a.city, state: a.state, pincode: a.pincode };
      } else {
        address = Object.fromEntries(['name', 'phone', 'line1', 'line2', 'city', 'state', 'pincode'].map((k) => [k, fd.get(k) || '']));
      }
      const method = fd.get('paymentMethod');
      $('#coError').innerHTML = '';
      if (!method) { $('#coError').innerHTML = '<div class="alert">Choose a payment method.</div>'; return; }
      const btn = $('#placeBtn'); btn.disabled = true; btn.textContent = 'Placing order…';
      try {
        const res = await api('/api/orders', { method: 'POST', body: {
          items: cartItems(), email: fd.get('email') || undefined, address, paymentMethod: method, saveAddress: !!fd.get('saveAddress'),
        } });
        state.cart = []; saveCart();
        if (!state.user) rememberGuestOrder(res.orderNo, res.token);
        const orderUrl = `/order/${res.orderNo}?t=${res.token}`;
        if (res.razorpay) return openRazorpay(res.orderNo, res.token, res.razorpay);
        if (res.demo) return openDemoPay(res.orderNo, res.token, res.total);
        navigate(orderUrl + '&placed=1', { replace: true });
      } catch (err) {
        btn.disabled = false; btn.textContent = `Place order · ${money(quote.total)}`;
        if (err.data?.errors) {
          if (choice && choice !== 'new' && !err.data.errors.email) { form.addrChoice.value = 'new'; $('#addrFields').hidden = false; }
          showErrors(form, err.data.errors);
        }
        $('#coError').innerHTML = `<div class="alert">${esc(err.message)}</div>`;
        if (!err.data?.errors) $('#coError').scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  });

  // ---------- Payments ----------
  async function openRazorpay(orderNo, token, rp) {
    const orderUrl = `/order/${orderNo}?t=${token}`;
    try { await loadScript('https://checkout.razorpay.com/v1/checkout.js'); }
    catch (e) { toast(esc(e.message), 4000); return navigate(orderUrl, { replace: true }); }
    const rz = new window.Razorpay({
      key: rp.keyId, amount: rp.amount, currency: rp.currency, name: rp.name, description: rp.description,
      order_id: rp.orderId, prefill: rp.prefill, theme: { color: '#24412B' },
      handler: async (resp) => {
        main.innerHTML = '<div class="loading"><div class="spinner"></div>Confirming your payment…</div>';
        try { await api(`/api/orders/${orderNo}/verify`, { method: 'POST', body: { ...resp, t: token } }); }
        catch (e) { toast(esc(e.message), 5000); }
        navigate(orderUrl + '&placed=1', { replace: true });
      },
      modal: { ondismiss: () => navigate(orderUrl, { replace: true }) },
    });
    rz.on('payment.failed', (r) => toast(esc(r?.error?.description || 'Payment failed. You can retry from the order page.'), 4500));
    rz.open();
  }

  function openDemoPay(orderNo, token, total) {
    const orderUrl = `/order/${orderNo}?t=${token}`;
    const m = modal(`<h3>Demo payment</h3>
      <p class="muted small">Razorpay keys are not configured, so this simulates the payment window for local testing. Add your keys in <code>.env</code> to take real payments.</p>
      <div class="sum-row total" style="border:0;padding-top:0"><span>Amount</span><span>${money(total)}</span></div>
      <button class="btn btn-block" id="demoOk" style="margin-top:12px">Simulate successful payment</button>
      <button class="btn btn-ghost btn-block" id="demoCancel" style="margin-top:8px">Cancel (leave unpaid)</button>`);
    $('#demoOk', m.el).onclick = async () => {
      $('#demoOk', m.el).disabled = true;
      try { await api(`/api/orders/${orderNo}/demo-pay`, { method: 'POST', body: { t: token } }); } catch (e) { toast(esc(e.message)); }
      m.close(); navigate(orderUrl + '&placed=1', { replace: true });
    };
    $('#demoCancel', m.el).onclick = () => { m.close(); navigate(orderUrl, { replace: true }); };
  }

  // ---------- Order detail / confirmation ----------
  const STEPS = ['confirmed', 'packed', 'shipped', 'delivered'];
  function orderDetail(o, { placed } = {}) {
    const paid = o.paymentStatus === 'paid' || o.paymentStatus === 'cod';
    const needsPay = o.paymentMethod === 'online' && !['paid'].includes(o.paymentStatus) && o.status !== 'cancelled';
    const stepIdx = STEPS.indexOf(o.status);
    const a = o.address;
    return `
      ${placed && paid ? `<div class="card" style="margin-bottom:16px"><div class="success-icon"><svg width="30" height="30" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <h1 style="font-size:28px">Thank you, ${esc(o.name.split(' ')[0])}!</h1>
        <p class="muted" style="margin:0">Your order <b>${esc(o.orderNo)}</b> is confirmed. We've noted <b>${esc(o.email)}</b> for updates${o.paymentMethod === 'cod' ? ` — please keep ${money(o.total)} ready at delivery` : ''}.</p></div>` : ''}
      ${needsPay ? `<div class="alert warn" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">
        <span><b>Payment ${o.paymentStatus === 'failed' ? 'failed' : 'pending'}.</b> Your order will be confirmed once payment is complete.</span>
        <button class="btn btn-sm btn-almond" id="payNow">Pay ${money(o.total)} now</button></div>` : ''}
      <div class="two-col">
        <div class="card">
          <div class="order-card" style="border:0;padding:0;margin:0">
            <div class="top"><div><h2 style="margin:0">Order ${esc(o.orderNo)}</h2><div class="small muted">${fmtDate(o.createdAt)}</div></div>
              <div><span class="status ${o.status}">${esc(o.status)}</span></div></div>
          </div>
          ${o.status !== 'cancelled' && stepIdx >= 0 ? `<div class="timeline">${STEPS.map((s, i) => `<div class="${i <= stepIdx ? 'done' : ''}">${s[0].toUpperCase() + s.slice(1)}</div>`).join('')}</div>` : ''}
          ${o.items.map((i) => `<div class="mini-line"><span>${esc(i.name)} · ${esc(i.label)} × ${i.qty}</span><span>${money(i.lineTotal)}</span></div>`).join('')}
          <hr style="border:0;border-top:1px solid var(--line);margin:12px 0">
          <div class="grid-2">
            <div><div class="opt-label">Delivering to</div><p class="small">${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? '<br>' + esc(a.line2) : ''}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.pincode)}<br>📞 ${esc(a.phone)}</p></div>
            <div><div class="opt-label">Payment</div><p class="small">${o.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Online (Razorpay)'}<br>
              <span class="status ${o.paymentStatus === 'cod' ? 'confirmed' : o.paymentStatus}">${o.paymentStatus === 'cod' ? 'Pay on delivery' : esc(o.paymentStatus)}</span>
              ${o.paymentRef ? `<br><span class="muted">Ref: ${esc(o.paymentRef)}</span>` : ''}</p></div>
          </div>
        </div>
        <aside><div class="card summary"><h3>Bill details</h3>
          <div class="sum-row"><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
          <div class="sum-row"><span>Shipping</span><span>${o.shipping ? money(o.shipping) : 'FREE'}</span></div>
          <div class="sum-row total"><span>Total</span><span>${money(o.total)}</span></div>
          <div class="small muted">Inclusive of GST</div>
          <a class="btn btn-ghost btn-block" style="margin-top:16px" href="/shop" data-link>Continue shopping</a></div></aside>
      </div>`;
  }

  route(/^\/order\/([A-Z0-9]+)$/, async (m, params) => {
    const t = params.get('t') || '';
    let o;
    try { o = await api(`/api/orders/${m[1]}${t ? `?t=${encodeURIComponent(t)}` : ''}`); }
    catch (e) {
      if (e.status === 404 && !state.user) return navigate(`/track`, { replace: true });
      throw e;
    }
    setTitle(`Order ${o.orderNo}`);
    main.innerHTML = `<div class="wrap page">${orderDetail(o, { placed: params.has('placed') })}</div>`;
    $('#payNow')?.addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try {
        const r = await api(`/api/orders/${o.orderNo}/pay`, { method: 'POST', body: { t } });
        if (r.razorpay) openRazorpay(o.orderNo, t || '', r.razorpay);
        else if (r.demo) openDemoPay(o.orderNo, t || '', o.total);
      } catch (e) { toast(esc(e.message), 4000); ev.target.disabled = false; }
    });
  });

  route(/^\/track$/, async () => {
    setTitle('Track your order');
    const recent = store.get('ns_guest_orders', []);
    main.innerHTML = `<div class="wrap page auth"><h1>Track your order</h1>
      <p class="muted">Enter the order number from your confirmation and the email you used at checkout.</p>
      <form class="card" id="trackForm" novalidate>
        ${field('orderNo', 'Order number', { attrs: 'placeholder="e.g. NS2610151234567" autocapitalize="characters"' })}
        ${field('email', 'Email', { type: 'email', attrs: 'autocomplete="email"' })}
        <div id="trackErr"></div><button class="btn btn-block">Find my order</button>
      </form>
      ${recent.length ? `<h3 style="margin-top:26px">Recent orders on this device</h3>${recent.map((r) => `<a class="order-card" style="display:block;text-decoration:none" href="/order/${esc(r.orderNo)}?t=${esc(r.token)}" data-link><b>${esc(r.orderNo)}</b><div class="small muted">${new Date(r.at).toLocaleDateString('en-IN')}</div></a>`).join('')}` : ''}
      ${state.user ? '' : '<p class="small muted" style="margin-top:16px">Have an account? <a href="/login?next=/account" data-link>Log in</a> to see all your orders.</p>'}</div>`;
    $('#trackForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const o = await api('/api/orders/track', { method: 'POST', body: { orderNo: fd.get('orderNo'), email: fd.get('email') } });
        navigate(`/order/${o.orderNo}?t=${o.token}`);
      } catch (err) { $('#trackErr').innerHTML = `<div class="alert">${esc(err.message)}</div>`; }
    });
  });

  // ---------- Auth ----------
  function authAfter(params) {
    const next = params.get('next');
    return next && next.startsWith('/') && !next.startsWith('//') ? next : (state.user?.role === 'admin' ? '/admin' : '/account');
  }
  route(/^\/login$/, async (_m, params) => {
    setTitle('Log in');
    if (state.user) return navigate(authAfter(params), { replace: true });
    const next = params.get('next') || '';
    main.innerHTML = `<div class="wrap page auth"><h1>Welcome back</h1><p class="muted">Log in to track orders and check out faster.</p>
      <form class="card" id="loginForm" novalidate>
        ${field('email', 'Email', { type: 'email', attrs: 'autocomplete="email" required' })}
        ${field('password', 'Password', { type: 'password', attrs: 'autocomplete="current-password" required' })}
        <div id="loginErr"></div><button class="btn btn-block">Log in</button>
        <div class="divider">New here?</div>
        <a class="btn btn-ghost btn-block" href="/register${next ? `?next=${encodeURIComponent(next)}` : ''}" data-link>Create an account</a>
        ${next === '/checkout' ? '<a class="btn btn-ghost btn-block" style="margin-top:8px;border-color:transparent" href="/checkout" data-link>Continue as guest →</a>' : ''}
      </form></div>`;
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const r = await api('/api/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
        state.user = r.user; updateHeader(); toast(`Welcome back, ${esc(r.user.name.split(' ')[0])}`);
        navigate(authAfter(params), { replace: true });
      } catch (err) { $('#loginErr').innerHTML = `<div class="alert">${esc(err.message)}</div>`; }
    });
  });

  route(/^\/register$/, async (_m, params) => {
    setTitle('Create account');
    if (state.user) return navigate(authAfter(params), { replace: true });
    const next = params.get('next') || '';
    main.innerHTML = `<div class="wrap page auth"><h1>Create your account</h1><p class="muted">Save addresses, track every order, reorder in two taps.</p>
      <form class="card" id="regForm" novalidate>
        ${field('name', 'Full name', { attrs: 'autocomplete="name"' })}
        ${field('email', 'Email', { type: 'email', attrs: 'autocomplete="email"' })}
        ${field('phone', 'Mobile number', { type: 'tel', attrs: 'autocomplete="tel" inputmode="numeric" maxlength="14" placeholder="10-digit mobile"' })}
        ${field('password', 'Password', { type: 'password', attrs: 'autocomplete="new-password" placeholder="8+ characters, letters & numbers"' })}
        <div id="regErr"></div><button class="btn btn-block">Create account</button>
        <p class="small muted" style="margin:12px 0 0">Already registered? <a href="/login${next ? `?next=${encodeURIComponent(next)}` : ''}" data-link>Log in</a></p>
      </form></div>`;
    $('#regForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target; const fd = new FormData(form);
      try {
        const r = await api('/api/auth/register', { method: 'POST', body: Object.fromEntries(fd) });
        state.user = r.user; updateHeader(); toast('Account created — welcome!');
        navigate(authAfter(params), { replace: true });
      } catch (err) {
        showErrors(form, err.data?.errors);
        $('#regErr').innerHTML = `<div class="alert">${esc(err.message)}</div>`;
      }
    });
  });

  // ---------- Account ----------
  route(/^\/account$/, async (_m, params) => {
    if (!state.user) return navigate('/login?next=/account', { replace: true });
    setTitle('My account');
    const tab = params.get('tab') || 'orders';
    const tabs = [['orders', 'Orders'], ['addresses', 'Addresses'], ['profile', 'Profile']];
    main.innerHTML = `<div class="wrap page"><div class="page-head" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <div><h1 style="margin:0">Hi, ${esc(state.user.name.split(' ')[0])}</h1><span class="muted small">${esc(state.user.email)}</span></div>
        <div style="display:flex;gap:8px">${state.user.role === 'admin' ? '<a class="btn btn-sm" href="/admin" data-link>Admin desk</a>' : ''}<button class="btn btn-sm btn-ghost" id="logout">Log out</button></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<a class="chip ${k === tab ? 'active' : ''}" href="/account?tab=${k}" data-link>${l}</a>`).join('')}</div>
      <div id="tabBody"><div class="loading"><div class="spinner"></div></div></div></div>`;
    $('#logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); state.user = null; updateHeader(); navigate('/'); };
    const body = $('#tabBody');

    if (tab === 'orders') {
      const orders = await api('/api/orders/mine');
      body.innerHTML = orders.length ? orders.map((o) => `
        <a class="order-card" style="display:block;text-decoration:none" href="/order/${o.orderNo}" data-link>
          <div class="top"><div><b>${esc(o.orderNo)}</b><div class="small muted">${fmtDate(o.createdAt)} · ${o.items.reduce((s, i) => s + i.qty, 0)} items</div></div>
            <div style="text-align:right"><b>${money(o.total)}</b><br><span class="status ${o.status}">${esc(o.status)}</span>
            ${o.paymentMethod === 'online' && o.paymentStatus !== 'paid' && o.status !== 'cancelled' ? ' <span class="status failed">unpaid</span>' : ''}</div></div>
          <div class="small muted">${o.items.map((i) => `${esc(i.name)} (${esc(i.label)})`).join(', ')}</div></a>`).join('')
        : `<div class="empty"><h3>No orders yet</h3><a class="btn" href="/shop" data-link>Start shopping</a></div>`;
    }

    if (tab === 'addresses') {
      const draw = async () => {
        const list = await api('/api/auth/addresses');
        body.innerHTML = `${list.map((a) => `<div class="order-card"><div class="top"><b>${esc(a.name)} · ${esc(a.phone)}</b><button class="remove" data-del="${a.id}">Delete</button></div>
          <div class="small muted">${esc([a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', '))}</div></div>`).join('') || '<p class="muted">No saved addresses yet.</p>'}
          <form class="card" id="addrForm" novalidate style="margin-top:16px"><h3>Add an address</h3>
            <div class="grid-2">${field('name', 'Full name', { value: state.user.name })}${field('phone', 'Mobile', { type: 'tel', value: state.user.phone || '', attrs: 'inputmode="numeric"' })}</div>
            ${field('line1', 'Flat / house no., building, street')}${field('line2', 'Area, landmark (optional)')}
            <div class="grid-2">${field('pincode', 'PIN code', { attrs: 'inputmode="numeric" maxlength="6"' })}${field('city', 'City / district')}</div>
            <div class="field"><label for="f-state">State</label><select id="f-state" name="state"><option value="">Select state</option>${state.config.states.map((s) => `<option>${esc(s)}</option>`).join('')}</select><div class="err"></div></div>
            <button class="btn">Save address</button></form>`;
        $$('[data-del]', body).forEach((b) => b.onclick = async () => { await api(`/api/auth/addresses/${b.dataset.del}`, { method: 'DELETE', body: {} }); draw(); });
        $('#addrForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          try { await api('/api/auth/addresses', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Address saved'); draw(); }
          catch (err) { showErrors(e.target, err.data?.errors); toast(esc(err.message)); }
        });
      };
      await draw();
    }

    if (tab === 'profile') {
      body.innerHTML = `<div class="grid-2" style="gap:16px">
        <form class="card" id="profForm"><h3>Profile</h3>${field('name', 'Full name', { value: state.user.name })}${field('phone', 'Mobile', { type: 'tel', value: state.user.phone || '' })}
          <div class="field"><label>Email</label><input value="${esc(state.user.email)}" disabled></div><button class="btn">Save</button></form>
        <form class="card" id="pwForm"><h3>Change password</h3>${field('current', 'Current password', { type: 'password', attrs: 'autocomplete="current-password"' })}
          ${field('next', 'New password', { type: 'password', attrs: 'autocomplete="new-password"' })}<button class="btn">Update password</button></form></div>`;
      $('#profForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { const r = await api('/api/auth/me', { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); state.user = r.user; updateHeader(); toast('Profile updated'); }
        catch (err) { toast(esc(err.message)); }
      });
      $('#pwForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('/api/auth/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('Password updated'); }
        catch (err) { toast(esc(err.message), 3500); }
      });
    }
  });

  // ---------- Admin desk ----------
  route(/^\/admin$/, async (_m, params) => {
    if (!state.user) return navigate('/login?next=/admin', { replace: true });
    if (state.user.role !== 'admin') return navigate('/account', { replace: true });
    setTitle('Admin');
    const tab = params.get('tab') || 'orders';
    const stats = await api('/api/admin/stats');
    main.innerHTML = `<div class="wrap page">
      <div class="page-head" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><h1 style="margin:0">Order desk</h1>
        <button class="btn btn-sm btn-ghost" id="logout">Log out</button></div>
      <div class="stats">
        <div class="stat"><b>${stats.today.n}</b><span>Orders today (${money(stats.today.amt)})</span></div>
        <div class="stat"><b>${stats.toShip}</b><span>To pack & ship</span></div>
        <div class="stat"><b>${stats.unpaid}</b><span>Awaiting online payment</span></div>
        <div class="stat"><b>${stats.customers}</b><span>Registered customers</span></div>
      </div>
      <div class="tabs"><a class="chip ${tab === 'orders' ? 'active' : ''}" href="/admin" data-link>Orders</a>
        <a class="chip ${tab === 'inventory' ? 'active' : ''}" href="/admin?tab=inventory" data-link>Inventory & prices${stats.lowStock.length ? ` (${stats.lowStock.length} low)` : ''}</a></div>
      <div id="adminBody"></div></div>`;
    $('#logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); state.user = null; updateHeader(); navigate('/'); };
    const body = $('#adminBody');
    const STATUSES = ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];

    if (tab === 'orders') {
      body.innerHTML = `<div class="shop-bar"><input class="chip" style="flex:1;min-width:200px;padding:9px 14px" id="aq" placeholder="Search order no., name, email, phone">
        <select class="chip" id="as"><option value="">All statuses</option>${STATUSES.map((s) => `<option>${s}</option>`).join('')}</select></div><div id="aTable"></div>`;
      const load = async () => {
        const qs = new URLSearchParams({ q: $('#aq').value, status: $('#as').value });
        const orders = await api('/api/admin/orders?' + qs);
        $('#aTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>
          ${orders.map((o) => `<tr><td><a href="/order/${o.orderNo}" data-link><b>${o.orderNo}</b></a><br><span class="small muted">${fmtDate(o.createdAt)}</span></td>
            <td>${esc(o.name)}${o.guest ? ' <span class="status">guest</span>' : ''}<br><span class="small muted">${esc(o.phone)} · ${esc(o.address.city)} ${esc(o.address.pincode)}</span></td>
            <td class="small">${o.items.map((i) => `${esc(i.name)} ${esc(i.label)} ×${i.qty}`).join('<br>')}</td>
            <td><b>${money(o.total)}</b></td>
            <td>${o.paymentMethod === 'cod' ? 'COD' : 'Online'}<br><span class="status ${o.paymentStatus === 'cod' ? 'confirmed' : o.paymentStatus}">${o.paymentStatus}</span></td>
            <td><select data-order="${o.orderNo}" ${o.status === 'cancelled' ? 'disabled' : ''}>${STATUSES.map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`).join('')
          || '<tr><td colspan="6" class="muted">No orders found.</td></tr>'}</tbody></table></div>`;
        $$('select[data-order]', body).forEach((sel) => sel.addEventListener('change', async () => {
          if (sel.value === 'cancelled' && !confirm(`Cancel order ${sel.dataset.order}? Stock will be returned.`)) { load(); return; }
          try { const r = await api(`/api/admin/orders/${sel.dataset.order}`, { method: 'PATCH', body: { status: sel.value } }); toast(r.note ? esc(r.note) : `Marked ${sel.value}`, r.note ? 6000 : 2200); }
          catch (e) { toast(esc(e.message), 4000); }
          load();
        }));
      };
      let deb; $('#aq').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(load, 250); });
      $('#as').addEventListener('change', load);
      await load();
    } else {
      const inv = await api('/api/admin/inventory');
      body.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Price ₹</th><th>MRP ₹</th><th>Stock</th><th></th></tr></thead><tbody>
        ${inv.map((v) => `<tr data-id="${v.id}"><td><b>${esc(v.name)}</b><br><span class="small muted">${esc(v.label)}</span></td><td class="small">${esc(v.sku)}</td>
          <td><input name="price" type="number" min="1" step="1" value="${v.price / 100}"></td><td><input name="mrp" type="number" min="1" step="1" value="${v.mrp / 100}"></td>
          <td><input name="stock" type="number" min="0" step="1" value="${v.stock}" class="${v.stock < 15 ? 'low' : ''}"></td>
          <td><button class="btn btn-sm">Save</button></td></tr>`).join('')}</tbody></table></div>`;
      body.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        const tr = b.closest('tr'); const val = (n) => $(`[name=${n}]`, tr).value;
        try { await api(`/api/admin/inventory/${tr.dataset.id}`, { method: 'PATCH', body: { price: val('price'), mrp: val('mrp'), stock: val('stock') } }); toast('Saved'); }
        catch (err) { toast(esc(err.message), 3500); }
      });
    }
  });

  // ---------- Policy pages (Razorpay requires these to activate your account) ----------
  const PAGES = {
    contact: ['Contact us', (s) => `<p>We're happy to help with orders, bulk and corporate gifting enquiries.</p>
      <ul><li><b>Email:</b> ${esc(s.supportEmail)}</li><li><b>Phone / WhatsApp:</b> ${esc(s.supportPhone)} (Mon–Sat, 10am–6pm IST)</li>
      <li><b>Registered address:</b> [Your business address, City, State, PIN]</li></ul>`],
    shipping: ['Shipping policy', () => `<ul><li>We ship across India through reputed courier partners.</li>
      <li>Orders are packed and dispatched within 1–2 business days. Delivery usually takes 3–7 business days depending on your PIN code.</li>
      <li>Shipping is free on orders above ${money(state.config.freeShippingAbove)}; a flat fee of ${money(state.config.shippingFee)} applies below that.</li>
      <li>You'll receive tracking details by email once your order ships. You can also check status on the <a href="/track" data-link>Track order</a> page.</li></ul>`],
    refunds: ['Cancellation & refund policy', () => `<h2>Cancellations</h2><p>You can cancel an order before it is shipped by contacting us with your order number. Prepaid cancellations are refunded in full.</p>
      <h2>Returns</h2><p>Because these are food products, we can't accept returns of opened packs. If your order arrives damaged, incorrect or past its best-before date, write to us within 48 hours of delivery with photos and we'll replace it or refund you.</p>
      <h2>Refund timelines</h2><p>Approved refunds are issued to the original payment method within 5–7 business days. COD refunds are made by bank transfer or UPI.</p>`],
    privacy: ['Privacy policy', (s) => `<p>${esc(s.name)} collects only the information needed to process and deliver your orders: your name, contact details and delivery address. Payments are processed by Razorpay; we never see or store your card or UPI credentials.</p>
      <p>We use your email and phone only for order updates and support, and (if you opt in) occasional offers. We do not sell your data. Contact ${esc(s.supportEmail)} to access or delete your information.</p>`],
    terms: ['Terms & conditions', (s) => `<p>By placing an order on this website you agree to these terms. All prices are in Indian Rupees and include GST. Product images are illustrative; natural products vary in size and colour.</p>
      <p>We reserve the right to cancel orders in case of pricing errors, stock unavailability or suspected fraud, with a full refund of any amount paid. These terms are governed by the laws of India.</p>`],
  };
  route(/^\/pages\/([a-z]+)$/, async (m) => {
    const page = PAGES[m[1]]; if (!page) return view404();
    setTitle(page[0]);
    main.innerHTML = `<div class="wrap page prose"><h1>${page[0]}</h1>${page[1](state.config.store)}
      <p class="small muted" style="margin-top:30px">Last updated: ${new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</p></div>`;
  });

  function view404() {
    setTitle('Page not found');
    main.innerHTML = `<div class="wrap page"><div class="empty"><h2>Page not found</h2><p class="muted">That page may have moved.</p><a class="btn" href="/" data-link>Go home</a></div></div>`;
  }

  // ================= Boot =================
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    navigate(q ? `/shop?q=${encodeURIComponent(q)}` : '/shop');
  });

  async function boot() {
    const [config, me, categories] = await Promise.all([api('/api/config'), api('/api/auth/me'), api('/api/categories')]);
    state.config = config; state.user = me.user; state.categories = categories;
    const s = config.store;
    $('#brandName').textContent = s.name; $('#footBrand').textContent = s.name;
    $('#footTag').textContent = s.tagline;
    $('#footLegal').textContent = [s.fssai && `FSSAI Lic. No. ${s.fssai}`, s.gstin && `GSTIN ${s.gstin}`].filter(Boolean).join(' · ');
    $('#footBase').textContent = `© ${new Date().getFullYear()} ${s.name}. All prices in INR, inclusive of GST.`;
    $('#announce').textContent = `Free shipping above ${money(config.freeShippingAbove)}${config.codEnabled ? ' · Cash on Delivery available' : ''} · Packed fresh every week`;
    $('#catNav').innerHTML = `<a class="chip" data-cat="" href="/shop" data-link>All</a>` +
      categories.map((c) => `<a class="chip" data-cat="${c.slug}" href="/shop?c=${c.slug}" data-link>${esc(c.name)}</a>`).join('') +
      `<a class="chip" href="/track" data-link>Track order</a>`;
    $('#footCats').innerHTML = categories.map((c) => `<li><a href="/shop?c=${c.slug}" data-link>${esc(c.name)}</a></li>`).join('');
    updateHeader(); updateCartBadge();
    await render();
  }
  boot().catch((e) => { main.innerHTML = `<div class="wrap page"><div class="alert">Could not load the store: ${esc(e.message)}</div></div>`; });
})();

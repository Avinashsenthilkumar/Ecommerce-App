/* Admin back office — loaded on demand from /admin. Uses helpers shared by app.js (window.NS). */
(() => {
  'use strict';
  const { $, $$, esc, money, fmtDate, api, toast, modal, showErrors, field, pic, state, navigate, main } = window.NS;

  const toRs = (paise) => (paise == null ? '' : String(paise / 100));
  const toPaise = (v) => Math.round(Number(v) * 100);
  const pctLabel = (bp) => `${(bp / 100).toLocaleString('en-IN')}%`;
  const SHAPES = ['almond', 'cashew', 'walnut', 'pistachio', 'seed', 'date', 'raisin', 'makhana', 'mix'];
  const STATUSES = ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];
  const TABS = [['orders', 'Orders'], ['products', 'Products'], ['categories', 'Categories'], ['inventory', 'Stock & prices'],
    ['taxes', 'Taxes'], ['shipping', 'Shipping'], ['settings', 'Settings']];

  const switchEl = (name, label, checked) => `<label class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}> ${label}</label>`;
  const moneyField = (name, label, paise, hint = '') => `<div class="field"><label for="f-${name}">${label}</label>
    <div class="money-in"><input id="f-${name}" name="${name}" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(toRs(paise))}"></div>
    ${hint ? `<div class="hint">${hint}</div>` : ''}<div class="err"></div></div>`;
  const textArea = (name, label, value, hint = '') => `<div class="field span-2"><label for="f-${name}">${label}</label>
    <textarea id="f-${name}" name="${name}">${esc(value)}</textarea>${hint ? `<div class="hint">${hint}</div>` : ''}<div class="err"></div></div>`;
  const catOptions = (cats, selected, exclude = new Set(), emptyLabel) =>
    (emptyLabel ? `<option value="">${emptyLabel}</option>` : '') +
    cats.filter((c) => !exclude.has(c.id)).map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${'— '.repeat(c.depth)}${esc(c.name)}${c.is_active ? '' : ' (hidden)'}</option>`).join('');

  // Refresh the storefront's category tree after catalogue changes
  async function refreshStoreNav() {
    try { state.categories = await api('/api/categories'); } catch { /* ignore */ }
  }

  // ======================= Shell =======================
  window.NSAdmin = async (_m, params) => {
    const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'orders';
    const stats = await api('/api/admin/stats');
    main.innerHTML = `<div class="wrap page">
      <div class="page-head" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <h1 style="margin:0">Back office</h1>
        <div style="display:flex;gap:8px"><a class="btn btn-sm btn-ghost" href="/" data-link>View store</a><button class="btn btn-sm btn-ghost" id="logout">Log out</button></div></div>
      <div class="stats">
        <div class="stat"><b>${stats.today.n}</b><span>Orders today (${money(stats.today.amt)})</span></div>
        <div class="stat"><b>${stats.toShip}</b><span>To pack & ship</span></div>
        <div class="stat"><b>${stats.products}</b><span>Live products</span></div>
        <div class="stat"><b class="${stats.lowStock.length ? 'low' : ''}">${stats.lowStock.length}</b><span>Pack sizes low on stock</span></div>
      </div>
      <nav class="admin-tabs">${TABS.map(([k, l]) => `<a class="chip ${k === tab ? 'active' : ''}" href="/admin?tab=${k}" data-link>${l}</a>`).join('')}</nav>
      <div id="adminBody"><div class="loading"><div class="spinner"></div></div></div></div>`;
    $('#logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); state.user = null; location.href = '/'; };
    await VIEWS[tab]($('#adminBody'), params, stats);
  };

  const VIEWS = {};

  // ======================= Orders =======================
  VIEWS.orders = async (body) => {
    body.innerHTML = `<div class="toolbar"><input class="input grow" id="aq" placeholder="Search order no., name, email, phone">
      <select class="input" style="width:auto" id="as"><option value="">All statuses</option>${STATUSES.map((s) => `<option>${s}</option>`).join('')}</select></div><div id="aTable"></div>`;
    const load = async () => {
      const qs = new URLSearchParams({ q: $('#aq').value, status: $('#as').value });
      const orders = await api('/api/admin/orders?' + qs);
      $('#aTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>
        ${orders.map((o) => `<tr><td><a href="/order/${o.orderNo}" data-link><b>${o.orderNo}</b></a><br><span class="small muted">${fmtDate(o.createdAt)}</span></td>
          <td>${esc(o.name)}${o.guest ? ' <span class="status">guest</span>' : ''}<br><span class="small muted">${esc(o.phone)} · ${esc(o.address.city)}, ${esc(o.address.state)} ${esc(o.address.pincode)}</span></td>
          <td class="small">${o.items.map((i) => `${esc(i.name)} ${esc(i.label)} ×${i.qty}`).join('<br>')}</td>
          <td><b>${money(o.total)}</b>${o.taxTotal ? `<br><span class="small muted">GST ${money(o.taxTotal)}</span>` : ''}</td>
          <td>${o.paymentMethod === 'cod' ? 'COD' : 'Online'}<br><span class="status ${o.paymentStatus === 'cod' ? 'confirmed' : o.paymentStatus}">${o.paymentStatus}</span></td>
          <td><select class="input" style="width:auto" data-order="${o.orderNo}" ${o.status === 'cancelled' ? 'disabled' : ''}>${STATUSES.map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`).join('')
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
  };

  // ======================= Products =======================
  VIEWS.products = async (body, params) => {
    if (params.get('edit')) return productEditor(body, params.get('edit'));
    const cats = await api('/api/admin/categories');
    body.innerHTML = `<div class="toolbar"><input class="input grow" id="pq" placeholder="Search products">
      <select class="input" style="width:auto;max-width:240px" id="pc">${catOptions(cats, null, new Set(), 'All categories')}</select>
      <a class="btn btn-sm" href="/admin?tab=products&edit=new" data-link>+ Add product</a></div><div id="pTable"></div>`;
    const load = async () => {
      const qs = new URLSearchParams({ q: $('#pq').value, category: $('#pc').value });
      const list = await api('/api/admin/products?' + qs);
      $('#pTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>From</th><th>Stock</th><th>Tax</th><th>Live</th><th>Featured</th><th></th></tr></thead><tbody>
        ${list.map((p) => `<tr data-id="${p.id}">
          <td><div class="cell-flex"><div class="thumb-sm">${pic(p, { count: 14, scale: 1.4 })}</div><div><b>${esc(p.name)}</b><br><span class="small muted">${p.variant_count} pack size${p.variant_count === 1 ? '' : 's'}</span></div></div></td>
          <td class="small wrap-cell">${esc(p.category_path)}</td>
          <td>${p.from_price ? money(p.from_price) : '—'}</td>
          <td class="${p.stock < 15 ? 'low' : ''}">${p.stock}</td>
          <td class="small">${esc(p.tax_name || 'Default')}</td>
          <td><button class="pill-toggle ${p.is_active ? 'on' : ''}" data-flag="is_active">${p.is_active ? 'Live' : 'Hidden'}</button></td>
          <td><button class="pill-toggle ${p.featured ? 'on' : ''}" data-flag="featured">${p.featured ? 'Yes' : 'No'}</button></td>
          <td><a class="btn btn-sm btn-ghost" href="/admin?tab=products&edit=${p.id}" data-link>Edit</a></td></tr>`).join('')
        || '<tr><td colspan="8" class="muted">No products match.</td></tr>'}</tbody></table></div>`;
    };
    $('#pTable').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-flag]'); if (!b) return;
      const id = b.closest('tr').dataset.id; const on = !b.classList.contains('on');
      try { await api(`/api/admin/products/${id}/flags`, { method: 'PATCH', body: { [b.dataset.flag]: on } }); load(); refreshStoreNav(); }
      catch (err) { toast(esc(err.message)); }
    });
    let deb; $('#pq').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(load, 250); });
    $('#pc').addEventListener('change', load);
    await load();
  };

  async function productEditor(body, editId) {
    const isNew = editId === 'new';
    const [cats, taxes, p] = await Promise.all([
      api('/api/admin/categories'), api('/api/admin/taxes'),
      isNew ? Promise.resolve({ name: '', slug: '', category_id: null, tax_class_id: null, hsn: '', short: '', description: '', benefits: [], origin: '', shelf_life: '',
        color: '#B07A45', shape: 'mix', image: null, featured: 0, is_active: 1, variants: [{ label: '250 g', grams: 250, price: '', mrp: '', stock: 0, sku: '' }] })
        : api(`/api/admin/products/${editId}`),
    ]);
    if (!cats.length) { body.innerHTML = '<div class="alert warn">Create a category first, then add products to it. <a href="/admin?tab=categories" data-link>Go to categories</a></div>'; return; }
    const defTax = taxes.find((t) => t.is_default);
    let image = p.image;

    body.innerHTML = `<div class="crumbs"><a href="/admin?tab=products" data-link>Products</a> / ${isNew ? 'New product' : esc(p.name)}</div>
      <form id="pForm" class="editor" novalidate>
        <div class="stack">
          <section class="card"><h3>Product details</h3>
            <div class="form-grid">
              <div class="span-2">${field('name', 'Product name', { value: p.name, attrs: 'required maxlength="120"' })}</div>
              <div class="field"><label for="f-category_id">Category</label><select id="f-category_id" name="category_id"><option value="">Choose…</option>${catOptions(cats, p.category_id)}</select><div class="err"></div></div>
              <div class="field"><label for="f-slug">URL slug</label><input id="f-slug" name="slug" value="${esc(p.slug)}" placeholder="auto from name"><div class="hint">/p/<span id="slugPrev">${esc(p.slug || '…')}</span></div><div class="err"></div></div>
              <div class="span-2">${field('short', 'Short description (shown on cards)', { value: p.short || '', attrs: 'maxlength="160"' })}</div>
              ${textArea('description', 'Full description', p.description || '')}
              ${textArea('benefits', 'Highlights', (p.benefits || []).join('\n'), 'One per line, e.g. “Rich in Vitamin E”. Up to 8.')}
              ${field('origin', 'Origin', { value: p.origin || '', attrs: 'placeholder="e.g. Kerala, India"' })}
              ${field('shelf_life', 'Shelf life', { value: p.shelf_life || '', attrs: 'placeholder="e.g. 9 months"' })}
            </div></section>

          <section class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">Pack sizes, prices & stock</h3>
              <button type="button" class="btn btn-sm btn-ghost" id="addVar">+ Add pack size</button></div>
            <p class="small muted" style="margin:6px 0 12px">Prices are ${state.config.pricesIncludeTax ? '<b>inclusive</b>' : '<b>exclusive</b>'} of GST (change under Taxes). MRP must be at least the selling price.</p>
            <div class="table-wrap"><table class="vtable"><thead><tr><th>Label</th><th>Weight (g)</th><th>Price ₹</th><th>MRP ₹</th><th>Stock</th><th>SKU</th><th></th></tr></thead><tbody id="vBody"></tbody></table></div>
            <div class="err" id="varErr" style="color:var(--danger);font-size:13px;margin-top:8px"></div></section>

          <section class="card"><h3>Tax</h3><div class="form-grid">
            <div class="field"><label for="f-tax_class_id">GST class</label><select id="f-tax_class_id" name="tax_class_id">
              <option value="">Store default${defTax ? ` (${esc(defTax.name)})` : ''}</option>
              ${taxes.map((t) => `<option value="${t.id}" ${t.id === p.tax_class_id ? 'selected' : ''}>${esc(t.name)} — ${pctLabel(t.rate_bp)}</option>`).join('')}</select><div class="err"></div></div>
            ${field('hsn', 'HSN code', { value: p.hsn || '', attrs: 'inputmode="numeric" maxlength="8" placeholder="e.g. 0802"' })}
            <p class="small muted span-2" style="margin:0">Confirm HSN codes and GST rates with your tax consultant — they appear on orders for invoicing.</p>
          </div></section>
        </div>

        <aside class="stack">
          <section class="card"><h3>Photo</h3>
            <div class="img-drop" id="imgBox"></div>
            <div class="img-actions"><label class="btn btn-sm btn-ghost" style="cursor:pointer">Upload photo<input type="file" id="imgFile" accept="image/png,image/jpeg,image/webp" hidden></label>
              <button type="button" class="btn btn-sm btn-ghost" id="imgRemove" ${image ? '' : 'hidden'}>Remove</button></div>
            <p class="small muted" style="margin:10px 0 0">Square photos work best. Images are resized to 1200 px. Without a photo, the store shows generated artwork:</p>
            <div class="grid-2" style="margin-top:8px">
              <div class="field"><label for="f-color">Art colour</label><input id="f-color" name="color" type="color" value="${esc(p.color || '#B07A45')}" style="padding:4px;min-height:40px"></div>
              <div class="field"><label for="f-shape">Art style</label><select id="f-shape" name="shape">${SHAPES.map((s) => `<option ${s === p.shape ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
            </div></section>
          <section class="card"><h3>Visibility</h3>
            ${switchEl('is_active', 'Live on store', p.is_active)}
            ${switchEl('featured', 'Show in Bestsellers', p.featured)}
            <div id="pErr"></div>
            <button class="btn btn-block" id="pSave">${isNew ? 'Create product' : 'Save changes'}</button>
            ${!isNew ? `<a class="btn btn-ghost btn-block" style="margin-top:8px" href="/p/${esc(p.slug)}" data-link>View on store</a>
              <button type="button" class="btn btn-ghost btn-block" id="pDelete" style="margin-top:8px;color:var(--danger);border-color:var(--danger)">Delete product</button>` : ''}
          </section>
        </aside>
      </form>`;

    const form = $('#pForm');
    const vBody = $('#vBody');
    const varRow = (v = {}) => `<tr data-vid="${v.id || ''}">
      <td><input name="label" value="${esc(v.label || '')}" placeholder="250 g"></td>
      <td><input name="grams" type="number" min="1" value="${esc(v.grams ?? '')}"></td>
      <td><input name="price" type="number" min="0" step="0.01" value="${esc(toRs(v.price === '' ? null : v.price))}"></td>
      <td><input name="mrp" type="number" min="0" step="0.01" value="${esc(toRs(v.mrp === '' ? null : v.mrp))}"></td>
      <td><input name="stock" type="number" min="0" value="${esc(v.stock ?? 0)}"></td>
      <td><input name="sku" value="${esc(v.sku || '')}" placeholder="auto" style="min-width:120px"></td>
      <td><button type="button" class="icon-x" aria-label="Remove pack size" title="Remove">×</button></td></tr>`;
    vBody.innerHTML = p.variants.map(varRow).join('');
    $('#addVar').onclick = () => { vBody.insertAdjacentHTML('beforeend', varRow({ stock: 0 })); $('tr:last-child input', vBody).focus(); };
    vBody.addEventListener('click', (e) => {
      if (!e.target.closest('.icon-x')) return;
      if ($$('tr', vBody).length === 1) { toast('A product needs at least one pack size'); return; }
      e.target.closest('tr').remove();
    });

    const drawImg = () => {
      $('#imgBox').innerHTML = pic({ image, name: form.name.value || 'Product', slug: form.slug.value || 'preview', color: form.color.value, shape: form.shape.value });
      $('#imgRemove').hidden = !image;
    };
    drawImg();
    form.color.addEventListener('input', drawImg);
    form.shape.addEventListener('change', drawImg);
    const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    form.name.addEventListener('input', () => { $('#slugPrev').textContent = form.slug.value || slugify(form.name.value) || '…'; });
    form.slug.addEventListener('input', () => { $('#slugPrev').textContent = slugify(form.slug.value) || slugify(form.name.value) || '…'; });

    $('#imgRemove').onclick = () => { image = null; drawImg(); };
    $('#imgFile').onchange = async (e) => {
      const file = e.target.files[0]; e.target.value = '';
      if (!file) return;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('Choose a PNG, JPG or WebP image'); return; }
      try {
        toast('Uploading…', 8000);
        const dataUrl = await resizeImage(file, 1200);
        const r = await api('/api/admin/uploads', { method: 'POST', body: { dataUrl } });
        image = r.url; drawImg(); toast('Photo uploaded — save to apply');
      } catch (err) { toast(esc(err.message), 4000); }
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const variants = $$('tr', vBody).map((tr) => {
        const g = (n) => $(`[name=${n}]`, tr).value.trim();
        return { id: tr.dataset.vid ? Number(tr.dataset.vid) : undefined, label: g('label'), grams: g('grams'),
          price: g('price') === '' ? '' : toPaise(g('price')), mrp: g('mrp') === '' ? '' : toPaise(g('mrp')), stock: g('stock'), sku: g('sku') };
      });
      const payload = {
        name: fd.get('name'), slug: fd.get('slug'), category_id: fd.get('category_id'), short: fd.get('short'), description: fd.get('description'),
        benefits: fd.get('benefits'), origin: fd.get('origin'), shelf_life: fd.get('shelf_life'), tax_class_id: fd.get('tax_class_id') || null,
        hsn: fd.get('hsn'), color: fd.get('color'), shape: fd.get('shape'), image,
        is_active: !!fd.get('is_active'), featured: !!fd.get('featured'), variants,
      };
      $('#pErr').innerHTML = ''; $('#varErr').textContent = '';
      $$('input', vBody).forEach((i) => { i.classList.remove('bad'); i.title = ''; });
      const btn = $('#pSave'); btn.disabled = true;
      try {
        const r = await api(isNew ? '/api/admin/products' : `/api/admin/products/${editId}`, { method: isNew ? 'POST' : 'PATCH', body: payload });
        toast(isNew ? 'Product created' : 'Saved');
        refreshStoreNav();
        if (isNew) navigate(`/admin?tab=products&edit=${r.id}`, { replace: true });
        else navigate(`/admin?tab=products&edit=${editId}`, { replace: true });
      } catch (err) {
        btn.disabled = false;
        showErrors(form, err.data?.errors || {});
        if (err.data?.errors?.variants) $('#varErr').textContent = err.data.errors.variants;
        (err.data?.variantErrors || []).forEach((ve, i) => {
          if (!ve) return;
          const tr = $$('tr', vBody)[i];
          for (const [k, msg] of Object.entries(ve)) { const inp = $(`[name=${k}]`, tr); if (inp) { inp.classList.add('bad'); inp.title = msg; } }
        });
        $('#pErr').innerHTML = `<div class="alert">${esc(err.message)}</div>`;
      }
    });

    $('#pDelete')?.addEventListener('click', async () => {
      if (!confirm(`Delete “${p.name}”? Products with past orders are hidden instead of deleted.`)) return;
      try {
        const r = await api(`/api/admin/products/${editId}`, { method: 'DELETE', body: {} });
        toast(esc(r.note || 'Product deleted'), r.note ? 5000 : 2200);
        refreshStoreNav();
        navigate('/admin?tab=products', { replace: true });
      } catch (err) { toast(esc(err.message)); }
    });
  }

  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
      img.src = url;
    });
  }

  // ======================= Categories =======================
  VIEWS.categories = async (body) => {
    const cats = await api('/api/admin/categories');
    body.innerHTML = `<div class="toolbar"><p class="muted small grow" style="margin:0">Nest categories as deep as you like — e.g. Healthy Snacks › Makhana › Flavoured Makhana. Products can sit at any level; a category page shows products from all its sub-categories.</p>
      <button class="btn btn-sm" id="addCat">+ Add category</button></div>
      <div class="table-wrap"><table><thead><tr><th>Category</th><th>Slug</th><th>Products</th><th>Order</th><th>Status</th><th></th></tr></thead><tbody>
      ${cats.map((c) => `<tr><td><span class="depth-pad">${c.depth ? '&nbsp;&nbsp;'.repeat(c.depth - 1) + '└ ' : ''}</span><b style="${c.depth ? 'font-weight:600' : ''}">${esc(c.name)}</b>
          ${c.children ? `<span class="small muted"> · ${c.children} sub</span>` : ''}</td>
        <td class="small muted">${esc(c.slug)}</td><td>${c.products}</td><td>${c.sort}</td>
        <td>${c.is_active ? (c.visible ? '<span class="status delivered">Visible</span>' : '<span class="status">Parent hidden</span>') : '<span class="status cancelled">Hidden</span>'}</td>
        <td style="display:flex;gap:6px"><button class="btn btn-sm btn-ghost" data-edit="${c.id}">Edit</button><button class="btn btn-sm btn-ghost" data-add="${c.id}" title="Add sub-category">+ Sub</button>
          <a class="btn btn-sm btn-ghost" href="/shop?c=${esc(c.slug)}" data-link>View</a></td></tr>`).join('')
      || '<tr><td colspan="6" class="muted">No categories yet.</td></tr>'}</tbody></table></div>`;

    const openForm = (c, parentId) => {
      const isNew = !c;
      c = c || { name: '', slug: '', blurb: '', parent_id: parentId || null, sort: 0, is_active: true };
      // exclude self and descendants from parent choices
      const exclude = new Set();
      if (!isNew) {
        const idx = cats.findIndex((x) => x.id === c.id);
        exclude.add(c.id);
        for (let i = idx + 1; i < cats.length && cats[i].depth > cats[idx].depth; i++) exclude.add(cats[i].id);
      }
      const m = modal(`<h3>${isNew ? 'New category' : 'Edit category'}</h3>
        <form id="cForm" novalidate>
          ${field('name', 'Name', { value: c.name })}
          <div class="field"><label for="f-parent_id">Parent</label><select id="f-parent_id" name="parent_id">${catOptions(cats, c.parent_id, exclude, '— Top level —')}</select><div class="err"></div></div>
          ${field('slug', 'URL slug', { value: c.slug, attrs: 'placeholder="auto from name"' })}
          ${field('blurb', 'Short description', { value: c.blurb || '' })}
          ${field('sort', 'Display order', { type: 'number', value: c.sort })}
          ${switchEl('is_active', 'Visible on store', c.is_active)}
          <div id="cErr"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn">${isNew ? 'Create' : 'Save'}</button>
            <button type="button" class="btn btn-ghost" id="cCancel">Cancel</button>
            ${!isNew ? '<button type="button" class="btn btn-ghost" id="cDel" style="color:var(--danger);border-color:var(--danger);margin-left:auto">Delete</button>' : ''}</div>
        </form>`);
      $('#cCancel', m.el).onclick = m.close;
      $('#cForm', m.el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = { name: fd.get('name'), parent_id: fd.get('parent_id') || null, slug: fd.get('slug'), blurb: fd.get('blurb'), sort: fd.get('sort'), is_active: !!fd.get('is_active') };
        try {
          await api(isNew ? '/api/admin/categories' : `/api/admin/categories/${c.id}`, { method: isNew ? 'POST' : 'PATCH', body: payload });
          m.close(); toast('Category saved'); await refreshStoreNav(); rebuildNav(); VIEWS.categories(body);
        } catch (err) { showErrors(e.target, err.data?.errors || {}); $('#cErr', m.el).innerHTML = `<div class="alert">${esc(err.message)}</div>`; }
      });
      $('#cDel', m.el)?.addEventListener('click', async () => {
        if (!confirm(`Delete “${c.name}”?`)) return;
        try { await api(`/api/admin/categories/${c.id}`, { method: 'DELETE', body: {} }); m.close(); toast('Category deleted'); await refreshStoreNav(); rebuildNav(); VIEWS.categories(body); }
        catch (err) { $('#cErr', m.el).innerHTML = `<div class="alert">${esc(err.message)}</div>`; }
      });
      $('[name=name]', m.el).focus();
    };
    $('#addCat').onclick = () => openForm(null);
    body.querySelector('table').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit]'); const ad = e.target.closest('[data-add]');
      if (ed) openForm(cats.find((c) => c.id === Number(ed.dataset.edit)));
      if (ad) openForm(null, Number(ad.dataset.add));
    });
  };
  // Header nav is built by app.js; reload the page section that holds it
  function rebuildNav() { window.dispatchEvent(new CustomEvent('ns:categories-changed')); }

  // ======================= Stock & prices =======================
  VIEWS.inventory = async (body) => {
    const rows = await api('/api/admin/inventory');
    body.innerHTML = `<div class="toolbar"><input class="input grow" id="iq" placeholder="Filter by product, SKU or category">
      <label class="check" style="margin:0"><input type="checkbox" id="iLow"> Low stock only (&lt; 15)</label>
      <button class="btn btn-sm" id="iSaveAll" disabled>Save all changes</button></div>
      <p class="small muted">Edit prices and stock directly, or type <b>+20</b> / <b>-5</b> in “Adjust” to receive or write off stock.</p>
      <div class="table-wrap"><table class="vtable"><thead><tr><th>Product</th><th>SKU</th><th>Price ₹</th><th>MRP ₹</th><th>Stock</th><th>Adjust</th><th></th></tr></thead><tbody id="iBody"></tbody></table></div>`;
    const draw = () => {
      const q = $('#iq').value.toLowerCase(); const low = $('#iLow').checked;
      const list = rows.filter((r) => (!q || `${r.name} ${r.sku} ${r.category}`.toLowerCase().includes(q)) && (!low || r.stock < 15));
      $('#iBody').innerHTML = list.map((v) => `<tr data-id="${v.id}"><td><b>${esc(v.name)}</b> <span class="small muted">${esc(v.label)}</span>${v.is_active ? '' : ' <span class="status">hidden</span>'}<br><span class="small muted">${esc(v.category)}</span></td>
        <td class="small">${esc(v.sku)}</td>
        <td><input name="price" type="number" min="0" step="0.01" value="${v.price / 100}"></td>
        <td><input name="mrp" type="number" min="0" step="0.01" value="${v.mrp / 100}"></td>
        <td><input name="stock" type="number" min="0" step="1" value="${v.stock}" class="${v.stock < 15 ? 'bad' : ''}"></td>
        <td><input name="adjust" placeholder="+0" style="width:70px"></td>
        <td><button class="btn btn-sm" data-save disabled>Save</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nothing to show.</td></tr>';
    };
    draw();
    $('#iq').addEventListener('input', draw); $('#iLow').addEventListener('change', draw);
    const dirty = () => { $('#iSaveAll').disabled = !$$('[data-save]:not([disabled])', body).length; };
    $('#iBody').addEventListener('input', (e) => { const tr = e.target.closest('tr'); $('[data-save]', tr).disabled = false; dirty(); });
    const saveRow = async (tr) => {
      const g = (n) => $(`[name=${n}]`, tr).value.trim();
      const adj = g('adjust');
      const payload = { price: toPaise(g('price')), mrp: toPaise(g('mrp')) };
      if (adj && /^[+-]?\d+$/.test(adj) && Number(adj) !== 0) payload.adjust = Number(adj); else payload.stock = Number(g('stock'));
      const r = await api(`/api/admin/inventory/${tr.dataset.id}`, { method: 'PATCH', body: payload });
      const row = rows.find((x) => x.id === Number(tr.dataset.id));
      Object.assign(row, { price: payload.price, mrp: payload.mrp, stock: r.stock });
      $('[name=stock]', tr).value = r.stock; $('[name=stock]', tr).classList.toggle('bad', r.stock < 15);
      $('[name=adjust]', tr).value = ''; $('[data-save]', tr).disabled = true;
    };
    $('#iBody').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-save]'); if (!b) return;
      try { await saveRow(b.closest('tr')); toast('Saved'); } catch (err) { toast(esc(err.message), 3500); }
      dirty();
    });
    $('#iSaveAll').onclick = async () => {
      let n = 0;
      for (const b of $$('[data-save]:not([disabled])', body)) {
        try { await saveRow(b.closest('tr')); n++; } catch (err) { toast(esc(err.message), 3500); break; }
      }
      if (n) toast(`Saved ${n} row${n === 1 ? '' : 's'}`);
      dirty();
    };
  };

  // ======================= Taxes =======================
  VIEWS.taxes = async (body) => {
    const [taxes, settings] = await Promise.all([api('/api/admin/taxes'), api('/api/admin/settings')]);
    body.innerHTML = `<section class="card section-card"><h3>How prices are entered</h3>
        <p class="muted">Indian retail usually shows prices <b>including</b> GST (MRP style). Switch off to enter prices before tax — GST is then added at checkout.</p>
        <form id="incForm">${switchEl('prices_include_tax', 'Product prices include GST', settings.prices_include_tax)}</form></section>
      <div class="toolbar"><h3 class="grow" style="margin:0">GST classes</h3><button class="btn btn-sm" id="addTax">+ Add tax class</button></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Rate</th><th>Products</th><th>Default</th><th></th></tr></thead><tbody>
        ${taxes.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td>${pctLabel(t.rate_bp)}</td><td>${t.products}</td>
          <td>${t.is_default ? '<span class="status delivered">Default</span>' : `<button class="pill-toggle" data-default="${t.id}">Make default</button>`}</td>
          <td><button class="btn btn-sm btn-ghost" data-edit="${t.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>
      <p class="small muted" style="margin-top:12px">The default class applies to every product that doesn't pick one. GST collected is recorded on each order line with its HSN code.</p>`;
    $('#incForm').addEventListener('change', async (e) => {
      try { await api('/api/admin/settings', { method: 'PATCH', body: { prices_include_tax: e.target.checked } }); state.config.pricesIncludeTax = e.target.checked; toast('Saved'); }
      catch (err) { toast(esc(err.message)); }
    });
    const openForm = (t) => {
      const isNew = !t; t = t || { name: '', rate_bp: 500, is_default: false };
      const m = modal(`<h3>${isNew ? 'New tax class' : 'Edit tax class'}</h3><form id="tForm" novalidate>
        ${field('name', 'Name', { value: t.name, attrs: 'placeholder="e.g. GST 5%"' })}
        ${field('rate', 'Rate (%)', { type: 'number', value: t.rate_bp / 100, attrs: 'min="0" max="50" step="0.01"' })}
        ${switchEl('is_default', 'Default for products without a tax class', t.is_default)}
        <div id="tErr"></div>
        <div style="display:flex;gap:8px"><button class="btn">${isNew ? 'Create' : 'Save'}</button><button type="button" class="btn btn-ghost" id="tCancel">Cancel</button>
        ${!isNew ? '<button type="button" class="btn btn-ghost" id="tDel" style="color:var(--danger);border-color:var(--danger);margin-left:auto">Delete</button>' : ''}</div></form>`);
      $('#tCancel', m.el).onclick = m.close;
      $('#tForm', m.el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api(isNew ? '/api/admin/taxes' : `/api/admin/taxes/${t.id}`, { method: isNew ? 'POST' : 'PATCH',
            body: { name: fd.get('name'), rate_bp: Math.round(Number(fd.get('rate')) * 100), is_default: !!fd.get('is_default') } });
          m.close(); toast('Tax class saved'); VIEWS.taxes(body);
        } catch (err) { showErrors(e.target, { name: err.data?.errors?.name, rate: err.data?.errors?.rate_bp }); $('#tErr', m.el).innerHTML = `<div class="alert">${esc(err.message)}</div>`; }
      });
      $('#tDel', m.el)?.addEventListener('click', async () => {
        try { await api(`/api/admin/taxes/${t.id}`, { method: 'DELETE', body: {} }); m.close(); toast('Deleted'); VIEWS.taxes(body); }
        catch (err) { $('#tErr', m.el).innerHTML = `<div class="alert">${esc(err.message)}</div>`; }
      });
    };
    $('#addTax').onclick = () => openForm(null);
    body.querySelector('table').addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]'); const df = e.target.closest('[data-default]');
      if (ed) openForm(taxes.find((t) => t.id === Number(ed.dataset.edit)));
      if (df) {
        const t = taxes.find((x) => x.id === Number(df.dataset.default));
        await api(`/api/admin/taxes/${t.id}`, { method: 'PATCH', body: { name: t.name, rate_bp: t.rate_bp, is_default: true } });
        toast(`${esc(t.name)} is now the default`); VIEWS.taxes(body);
      }
    });
  };

  // ======================= Shipping =======================
  VIEWS.shipping = async (body) => {
    const [s, zones] = await Promise.all([api('/api/admin/settings'), api('/api/admin/shipping-zones')]);
    body.innerHTML = `<form class="card section-card" id="shipForm" novalidate><h3>Standard shipping</h3>
        <p class="muted">Applies to every state not covered by a zone below.</p>
        <div class="form-grid">
          ${moneyField('shipping_fee', 'Shipping fee', s.shipping_fee, 'Set 0 to always ship free')}
          ${moneyField('free_shipping_above', 'Free shipping on orders above', s.free_shipping_above, 'Order value incl. GST. Set 0 to never waive the fee')}
        </div>
        <h3 style="margin-top:8px">Cash on Delivery</h3>
        ${switchEl('cod_enabled', 'Offer Cash on Delivery', s.cod_enabled)}
        <div class="form-grid">
          ${moneyField('cod_max_order', 'Maximum COD order value', s.cod_max_order)}
          ${moneyField('cod_fee', 'COD handling charge', s.cod_fee, 'Added only when the customer picks COD')}
        </div>
        <div id="shipErr"></div><button class="btn">Save shipping settings</button></form>

      <div class="toolbar"><div class="grow"><h3 style="margin:0">Shipping zones</h3><span class="small muted">Different fees for specific states, e.g. North-East or J&amp;K.</span></div>
        <button class="btn btn-sm" id="addZone">+ Add zone</button></div>
      <div class="table-wrap"><table><thead><tr><th>Zone</th><th>States</th><th>Fee</th><th>Free above</th><th>Status</th><th></th></tr></thead><tbody>
        ${zones.map((z) => `<tr><td><b>${esc(z.name)}</b></td><td class="small wrap-cell" style="max-width:360px">${z.states.map(esc).join(', ')}</td>
          <td>${money(z.fee)}</td><td>${z.free_above ? money(z.free_above) : 'Never'}</td>
          <td>${z.is_active ? '<span class="status delivered">Active</span>' : '<span class="status">Off</span>'}</td>
          <td><button class="btn btn-sm btn-ghost" data-edit="${z.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No zones — standard shipping applies everywhere.</td></tr>'}</tbody></table></div>`;

    $('#shipForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = { cod_enabled: !!fd.get('cod_enabled') };
      for (const k of ['shipping_fee', 'free_shipping_above', 'cod_max_order', 'cod_fee']) payload[k] = toPaise(fd.get(k) || 0);
      try { const r = await api('/api/admin/settings', { method: 'PATCH', body: payload }); Object.assign(state.config, { shippingFee: r.shipping_fee, freeShippingAbove: r.free_shipping_above, codEnabled: r.cod_enabled, codMaxOrder: r.cod_max_order, codFee: r.cod_fee }); toast('Shipping settings saved'); $('#shipErr').innerHTML = ''; }
      catch (err) { showErrors(e.target, err.data?.errors || {}); $('#shipErr').innerHTML = `<div class="alert">${esc(err.message)}</div>`; }
    });

    const openZone = (z) => {
      const isNew = !z; z = z || { name: '', states: [], fee: 0, free_above: 0, is_active: true, sort: 0 };
      const taken = new Map(zones.filter((x) => x.id !== z.id).flatMap((x) => x.states.map((st) => [st, x.name])));
      const m = modal(`<h3>${isNew ? 'New shipping zone' : 'Edit zone'}</h3><form id="zForm" novalidate>
        ${field('name', 'Zone name', { value: z.name, attrs: 'placeholder="e.g. North-East"' })}
        <div class="field"><label>States in this zone</label><div class="states-grid">${state.config.states.map((st) => `
          <label title="${taken.has(st) ? `In ${esc(taken.get(st))}` : ''}"><input type="checkbox" name="states" value="${esc(st)}" ${z.states.includes(st) ? 'checked' : ''} ${taken.has(st) ? 'disabled' : ''}> ${esc(st)}${taken.has(st) ? ' <span class="muted">·</span>' : ''}</label>`).join('')}</div>
          <input type="hidden" name="states_err"><div class="err" id="statesErr"></div></div>
        <div class="grid-2">${moneyField('fee', 'Shipping fee', z.fee)}${moneyField('free_above', 'Free above', z.free_above, '0 = never free')}</div>
        ${switchEl('is_active', 'Active', z.is_active)}
        <div id="zErr"></div>
        <div style="display:flex;gap:8px"><button class="btn">${isNew ? 'Create' : 'Save'}</button><button type="button" class="btn btn-ghost" id="zCancel">Cancel</button>
        ${!isNew ? '<button type="button" class="btn btn-ghost" id="zDel" style="color:var(--danger);border-color:var(--danger);margin-left:auto">Delete</button>' : ''}</div></form>`);
      m.el.style.maxWidth = '640px';
      $('#zCancel', m.el).onclick = () => { m.el.style.maxWidth = ''; m.close(); };
      $('#zForm', m.el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = { name: fd.get('name'), states: fd.getAll('states'), fee: toPaise(fd.get('fee') || 0), free_above: toPaise(fd.get('free_above') || 0), is_active: !!fd.get('is_active') };
        try {
          await api(isNew ? '/api/admin/shipping-zones' : `/api/admin/shipping-zones/${z.id}`, { method: isNew ? 'POST' : 'PATCH', body: payload });
          m.el.style.maxWidth = ''; m.close(); toast('Zone saved'); VIEWS.shipping(body);
        } catch (err) {
          showErrors(e.target, err.data?.errors || {});
          $('#statesErr', m.el).textContent = err.data?.errors?.states || '';
          $('#zErr', m.el).innerHTML = `<div class="alert">${esc(err.message)}</div>`;
        }
      });
      $('#zDel', m.el)?.addEventListener('click', async () => {
        if (!confirm(`Delete zone “${z.name}”? Its states will use standard shipping.`)) return;
        await api(`/api/admin/shipping-zones/${z.id}`, { method: 'DELETE', body: {} });
        m.el.style.maxWidth = ''; m.close(); toast('Zone deleted'); VIEWS.shipping(body);
      });
    };
    $('#addZone').onclick = () => openZone(null);
    body.querySelector('table').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit]'); if (ed) openZone(zones.find((z) => z.id === Number(ed.dataset.edit)));
    });
  };

  // ======================= Store settings =======================
  VIEWS.settings = async (body) => {
    const s = await api('/api/admin/settings');
    body.innerHTML = `<form class="card section-card" id="setForm" novalidate><h3>Store details</h3>
      <p class="muted">Shown in the header, footer, policy pages and the Razorpay payment window.</p>
      <div class="form-grid">
        ${field('store_name', 'Store name', { value: s.store_name })}
        ${field('store_tagline', 'Tagline', { value: s.store_tagline })}
        ${field('support_email', 'Support email', { type: 'email', value: s.support_email })}
        ${field('support_phone', 'Support phone / WhatsApp', { value: s.support_phone })}
        ${textArea('store_address', 'Registered business address', s.store_address, 'Required on the Contact page for Razorpay activation.')}
        ${field('store_gstin', 'GSTIN', { value: s.store_gstin, attrs: 'maxlength="15" placeholder="33ABCDE1234F1Z5" style="text-transform:uppercase"' })}
        ${field('store_fssai', 'FSSAI licence no.', { value: s.store_fssai, attrs: 'maxlength="20"' })}
      </div>
      <div id="setErr"></div><button class="btn">Save settings</button></form>
      <p class="small muted">Prices-include-GST lives under <a href="/admin?tab=taxes" data-link>Taxes</a>; fees and COD under <a href="/admin?tab=shipping" data-link>Shipping</a>.</p>`;
    $('#setForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(e.target));
      try {
        await api('/api/admin/settings', { method: 'PATCH', body: payload });
        toast('Settings saved — reloading');
        setTimeout(() => location.reload(), 600);
      } catch (err) { showErrors(e.target, err.data?.errors || {}); $('#setErr').innerHTML = `<div class="alert">${esc(err.message)}</div>`; }
    });
  };
})();

// Category tree helpers (any depth). Categories are few, so the tree is built in memory per request.
const { db } = require('./db');

function loadTree() {
  const rows = db.prepare('SELECT id, slug, name, blurb, parent_id, sort, is_active FROM categories ORDER BY sort, name').all();
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const bySlug = new Map();
  const roots = [];
  for (const n of byId.values()) {
    bySlug.set(n.slug, n);
    const parent = n.parent_id && byId.get(n.parent_id);
    if (parent) parent.children.push(n); else roots.push(n);
  }
  // visible = itself and every ancestor active
  const mark = (n, parentVisible) => { n.visible = parentVisible && !!n.is_active; n.children.forEach((c) => mark(c, n.visible)); };
  roots.forEach((r) => mark(r, true));

  const descendants = (n) => [n.id, ...n.children.flatMap(descendants)];
  const path = (n) => { const out = []; for (let c = n; c; c = c.parent_id && byId.get(c.parent_id)) out.unshift(c); return out; };
  const visibleIds = () => [...byId.values()].filter((n) => n.visible).map((n) => n.id);
  return { byId, bySlug, roots, descendants, path, visibleIds };
}

// Would making `parentId` the parent of `id` create a loop?
function createsCycle(tree, id, parentId) {
  for (let c = tree.byId.get(parentId); c; c = c.parent_id && tree.byId.get(c.parent_id)) if (c.id === id) return true;
  return false;
}

module.exports = { loadTree, createsCycle };

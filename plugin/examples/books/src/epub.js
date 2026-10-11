// Books — reading EPUB and comic archives.
// (Part of one script: the files listed under entry.script run in order and share a scope.)

// ---------------------------------------------------------------- EPUB parsing
const lname = (node) => String(node.localName || node.nodeName || '').toLowerCase().replace(/^.*:/, '');
const byTag = (root, name) => [...(root.getElementsByTagNameNS ? root.getElementsByTagNameNS('*', name) : root.getElementsByTagName(name))];
const kids = (el, name) => [...el.childNodes].filter((node) => node.nodeType === 1 && (!name || lname(node) === name));
const textOf = (el) => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '');
const VOID_HTML = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function parseXml(text, type = 'application/xml') {
  if (text == null) return null;
  try {
    const doc = new DOMParser().parseFromString(String(text).replace(/^﻿/, ''), type);
    if (!doc || doc.getElementsByTagName('parsererror').length) return null;
    return doc;
  } catch { return null; }
}
// Many EPUB 2 chapters use HTML entities (&nbsp;) that are not valid XML; those are read
// as HTML instead, after self-closing tags such as <a id="p12"/> have been expanded.
function parseXhtml(text) {
  const doc = parseXml(text, 'application/xhtml+xml');
  if (doc) return doc;
  const fixed = String(text).replace(/^﻿/, '').replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<([a-zA-Z][\w:.-]*)(\s[^<>]*?)?\/>/g, (match, tag, attrs = '') => (VOID_HTML.has(tag.toLowerCase()) ? match : `<${tag}${attrs}></${tag}>`));
  try { return new DOMParser().parseFromString(fixed, 'text/html'); } catch { return null; }
}
function normPath(path) {
  const out = [];
  for (const part of String(path || '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}
const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');
function splitHref(base, href) {
  const raw = String(href || '');
  const hashAt = raw.indexOf('#');
  let file = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const frag = hashAt >= 0 ? raw.slice(hashAt + 1) : '';
  file = file.split('?')[0];
  try { file = decodeURIComponent(file); } catch {}
  let fragment = frag;
  try { fragment = decodeURIComponent(frag); } catch {}
  return { path: file ? normPath(dirOf(base) + file) : normPath(base), frag: fragment };
}
const isImagePath = (path) => /\.(jpe?g|png|gif|webp|svg|bmp|avif)$/i.test(path);
const imageMime = (path) => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' }[path.split('.').pop().toLowerCase()] || 'application/octet-stream');

// The extracted archive: entries by path, plus the stored files this book keeps.
class Package {
  constructor(entries) {
    this.entries = (entries || []).filter((entry) => entry && entry.path && !/\/$/.test(entry.path));
    this.byPath = new Map(); this.byLower = new Map();
    for (const entry of this.entries) { const path = normPath(entry.path); this.byPath.set(path, entry); this.byLower.set(path.toLowerCase(), entry); }
    this.kept = new Set();
  }
  get(path) { const key = normPath(path); return this.byPath.get(key) || this.byLower.get(key.toLowerCase()) || null; }
  async text(path) {
    const entry = this.get(path);
    if (!entry) return null;
    if (typeof entry.text === 'string') return entry.text;
    if (entry.file?.id) return macos.files.read(entry.file.id, { as: 'text' });
    return null;
  }
  // A picture the book shows: keep its stored file (small SVGs arrive inline and are stored now).
  async keepImage(path) {
    const entry = this.get(path);
    if (!entry) return '';
    if (entry.file?.id) { this.kept.add(entry.file.id); return entry.file.id; }
    if (typeof entry.text === 'string' && /\.svg$/i.test(path)) {
      const info = await macos.files.put({ text: entry.text, name: path.split('/').pop(), type: 'image/svg+xml' });
      entry.file = info; this.kept.add(info.id); return info.id;
    }
    return '';
  }
  // Pixel size of a picture: from the host's file info, an SVG's own attributes, or the file header.
  async imageSize(path) {
    const entry = this.get(path);
    if (!entry) return null;
    const file = entry.file || {};
    if (file.width > 0 && file.height > 0) return { w: Math.round(file.width), h: Math.round(file.height) };
    if (/\.svg$/i.test(path)) {
      const text = typeof entry.text === 'string' ? entry.text : await macos.files.read(file.id, { as: 'text' });
      return svgSize(text);
    }
    if (!file.id) return null;
    return imageHeaderSize(await macos.files.read(file.id, { as: 'base64' }));
  }
  images() { return this.entries.filter((entry) => isImagePath(entry.path) && !/(^|\/)(__MACOSX\/|\._)/.test(entry.path)); }
  async cleanup() {
    for (const entry of this.entries) if (entry.file?.id && !this.kept.has(entry.file.id)) await macos.files.remove(entry.file.id).catch(() => {});
  }
}

function svgSize(text) {
  const head = String(text).slice(0, 2000);
  const num = (name) => { const m = head.match(new RegExp(`<svg[^>]*\\s${name}="([\\d.]+)(px)?"`, 'i')); return m ? Number(m[1]) : 0; };
  const w = num('width'); const h = num('height');
  if (w && h) return { w: Math.round(w), h: Math.round(h) };
  const box = head.match(/viewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/i);
  return box ? { w: Math.round(Number(box[1])), h: Math.round(Number(box[2])) } : null;
}
function imageHeaderSize(base64) {
  const binary = atob(String(base64).slice(0, 2_800_000).replace(/=+$/, '').slice(0, Math.floor(Math.min(String(base64).length, 2_800_000) / 4) * 4));
  const b = (i) => binary.charCodeAt(i);
  if (b(0) === 0x89 && b(1) === 0x50) return { w: (b(16) << 24 | b(17) << 16 | b(18) << 8 | b(19)) >>> 0, h: (b(20) << 24 | b(21) << 16 | b(22) << 8 | b(23)) >>> 0 };
  if (b(0) === 0x47 && b(1) === 0x49) return { w: b(6) | b(7) << 8, h: b(8) | b(9) << 8 };
  if (b(0) === 0x52 && b(8) === 0x57 && b(9) === 0x45) {
    const kind = binary.slice(12, 16);
    if (kind === 'VP8X') return { w: 1 + (b(24) | b(25) << 8 | b(26) << 16), h: 1 + (b(27) | b(28) << 8 | b(29) << 16) };
    if (kind === 'VP8 ') return { w: (b(26) | b(27) << 8) & 0x3fff, h: (b(28) | b(29) << 8) & 0x3fff };
    if (kind === 'VP8L') { const bits = (b(21) | b(22) << 8 | b(23) << 16 | b(24) << 24) >>> 0; return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }; }
  }
  if (b(0) === 0xff && b(1) === 0xd8) {
    let i = 2;
    while (i + 9 < binary.length) {
      if (b(i) !== 0xff) { i += 1; continue; }
      const marker = b(i + 1);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: b(i + 5) << 8 | b(i + 6), w: b(i + 7) << 8 | b(i + 8) };
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + (b(i + 2) << 8 | b(i + 3));
    }
  }
  return null;
}

// Chapter HTML: an allow-list of elements and attributes, re-serialised as HTML.
const KEEP = new Set('p div span h1 h2 h3 h4 h5 h6 em i b strong u s strike sub sup small big br hr blockquote pre code ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col figure figcaption img section article aside header footer cite q abbr mark ruby rt rp rb del ins kbd var samp address center tt font a nav main'.split(' '));
const RENAME = { center: 'div', big: 'span', font: 'span', tt: 'code', a: 'span', nav: 'div', main: 'div', strike: 's', section: 'div', article: 'div', header: 'div', footer: 'div', aside: 'div' };
const DROP = new Set('script style link meta head title iframe object embed form input button select textarea noscript math audio video canvas template'.split(' '));
const CONTAINERS = new Set(['body', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside']);
const TARGET = 50000;  // characters per stored part; pages are made by the column layout
const escText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (text) => escText(text).replace(/"/g, '&quot;');
const XLINK = 'http://www.w3.org/1999/xlink';

function serialize(node, ctx) {
  if (node.nodeType === 3 || node.nodeType === 4) {
    const text = node.nodeValue || '';
    const visible = text.replace(/\s+/g, '');
    ctx.chars += visible.length;
    for (const ch of visible) if (isCjk(ch)) ctx.cjk += 1;
    return escText(text);
  }
  if (node.nodeType !== 1) return '';
  const name = lname(node);
  const id = node.getAttribute('id') || (name === 'a' ? node.getAttribute('name') : '');
  if (id && ctx.wanted.has(id)) ctx.found.push(id);
  if (DROP.has(name)) return '';
  if (name === 'svg' || name === 'image' || name === 'img') {
    const target = name === 'img' ? node : name === 'image' ? node : byTag(node, 'image')[0] || byTag(node, 'img')[0];
    if (!target) return '';
    const src = target.getAttribute('src') || target.getAttribute('href') || target.getAttributeNS?.(XLINK, 'href') || target.getAttribute('xlink:href');
    if (!src || /^(https?:|data:)/i.test(src)) return '';
    const index = ctx.images.push(splitHref(ctx.base, src).path) - 1;
    ctx.chars += 400;
    return `<img src="@@BKIMG${index}@@" alt="${escAttr(target.getAttribute('alt') || '')}">`;
  }
  const inner = () => [...node.childNodes].map((child) => serialize(child, ctx)).join('');
  const anchor = id && ctx.wanted.has(id) ? ` id="${escAttr(id)}"` : '';
  if (!KEEP.has(name)) return anchor ? `<span${anchor}></span>${inner()}` : inner();
  const tag = RENAME[name] || name;
  let attrs = anchor;
  const dir = node.getAttribute('dir'); if (dir === 'rtl' || dir === 'ltr') attrs += ` dir="${dir}"`;
  const lang = node.getAttribute('lang') || node.getAttribute('xml:lang'); if (lang && /^[a-zA-Z-]{2,20}$/.test(lang)) attrs += ` lang="${lang}"`;
  for (const attr of ['colspan', 'rowspan', 'start']) { const value = node.getAttribute(attr); if (value && /^\d{1,4}$/.test(value)) attrs += ` ${attr}="${value}"`; }
  if (tag === 'ol') { const type = node.getAttribute('type'); if (type && /^[1aAiI]$/.test(type)) attrs += ` type="${type}"`; }
  if (name === 'br' || name === 'hr' || name === 'col') return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${inner()}</${tag}>`;
}

// The blocks a chapter is split between pages at: descend through lone wrappers, and
// open up any container too large to sit on one page.
function chapterBlocks(body) {
  let node = body;
  for (let guard = 0; guard < 24; guard += 1) {
    const meaningful = [...node.childNodes].filter((child) => child.nodeType === 1 || ((child.nodeType === 3 || child.nodeType === 4) && child.nodeValue.trim()));
    if (meaningful.length === 1 && meaningful[0].nodeType === 1 && CONTAINERS.has(lname(meaningful[0]))) node = meaningful[0]; else break;
  }
  const expand = (nodes) => nodes.flatMap((child) => (child.nodeType === 1 && CONTAINERS.has(lname(child)) && textOf(child).length > TARGET * 1.4 ? expand([...child.childNodes]) : [child]));
  return expand([...node.childNodes]);
}

function convertChapter(doc, path, wanted) {
  const body = byTag(doc, 'body')[0] || doc.documentElement;
  const ctx = { base: path, images: [], chars: 0, cjk: 0, wanted: wanted || new Set(), found: [] };
  const parts = []; const chars = []; const anchors = {};
  let html = ''; let count = 0;
  const heading = byTag(body, 'h1')[0] || byTag(body, 'h2')[0] || byTag(body, 'h3')[0];
  const title = (textOf(heading) || textOf(byTag(doc, 'title')[0])).slice(0, 140);
  const flush = () => { parts.push(html); chars.push(count); html = ''; count = 0; };
  for (const block of chapterBlocks(body)) {
    const before = ctx.chars;
    ctx.found = [];
    const out = serialize(block, ctx);
    const size = ctx.chars - before;
    const startsSection = block.nodeType === 1 && /^h[1-3]$/.test(lname(block));
    if (count > 0 && ((count + size > TARGET && count > TARGET * 0.35) || (startsSection && count > TARGET * 0.5))) flush();
    for (const id of ctx.found) if (!(id in anchors)) anchors[id] = parts.length;
    html += out; count += size;
  }
  if (html.trim() || !parts.length) flush();
  // A short tail joins the page before it.
  if (parts.length > 1 && chars[chars.length - 1] < TARGET * 0.25) {
    parts[parts.length - 2] += parts.pop(); chars[chars.length - 2] += chars.pop();
    for (const id of Object.keys(anchors)) if (anchors[id] >= parts.length) anchors[id] = parts.length - 1;
  }
  return { parts, chars, anchors, title, images: ctx.images, totalChars: ctx.chars, cjk: ctx.cjk };
}

function parseNav(doc, navPath) {
  const navs = byTag(doc, 'nav');
  const nav = navs.find((el) => /\btoc\b/.test(el.getAttribute('epub:type') || el.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || el.getAttribute('role') || '')) || navs[0];
  const out = [];
  const walk = (list, depth) => {
    for (const li of kids(list, 'li')) {
      const link = kids(li, 'a')[0] || kids(li, 'span')[0] || byTag(li, 'a')[0];
      const title = textOf(link);
      const href = link?.getAttribute('href');
      if (title && href) out.push({ title, depth, ...splitHref(navPath, href) });
      for (const sub of kids(li, 'ol')) walk(sub, depth + 1);
    }
  };
  const root = nav && (kids(nav, 'ol')[0] || byTag(nav, 'ol')[0]);
  if (root) walk(root, 0);
  return out;
}
function parseNcx(doc, ncxPath) {
  const out = [];
  const walk = (parent, depth) => {
    for (const point of kids(parent, 'navpoint')) {
      const title = textOf(byTag(kids(point, 'navlabel')[0] || point, 'text')[0]);
      const src = (kids(point, 'content')[0] || byTag(point, 'content')[0])?.getAttribute('src');
      if (title && src) out.push({ title, depth, ...splitHref(ncxPath, src) });
      walk(point, depth + 1);
    }
  };
  const map = byTag(doc, 'navMap')[0];
  if (map) walk(map, 0);
  return out;
}

async function importEpub(file, pkg, report) {
  const container = parseXml(await pkg.text('META-INF/container.xml'));
  const opfPath = normPath(container && byTag(container, 'rootfile')[0]?.getAttribute('full-path'));
  const opf = parseXml(await pkg.text(opfPath));
  if (!opf) throw new Error(T('badEpub', 'The book’s package document could not be read.'));
  const meta = (name) => textOf(byTag(opf, name)[0]);
  const creators = byTag(opf, 'creator');
  const authors = creators.filter((el) => /aut/i.test(el.getAttribute('opf:role') || el.getAttribute('role') || 'aut'));
  const items = new Map();
  for (const item of byTag(opf, 'item')) {
    const href = item.getAttribute('href');
    if (!href) continue;
    items.set(item.getAttribute('id'), { id: item.getAttribute('id'), path: splitHref(opfPath, href).path, type: item.getAttribute('media-type') || '', props: item.getAttribute('properties') || '' });
  }
  const spineEl = byTag(opf, 'spine')[0];
  const spineItems = byTag(opf, 'itemref').map((ref) => items.get(ref.getAttribute('idref'))).filter((item) => item && /x?html|xml/i.test(item.type) && !/\bnav\b/.test(item.props));

  // Table of contents: the EPUB 3 navigation document, else the EPUB 2 NCX.
  let toc = [];
  const navItem = [...items.values()].find((item) => /\bnav\b/.test(item.props));
  if (navItem) { const navDoc = parseXhtml(await pkg.text(navItem.path)); if (navDoc) toc = parseNav(navDoc, navItem.path); }
  if (!toc.length) {
    const ncxItem = items.get(spineEl?.getAttribute('toc')) || [...items.values()].find((item) => /ncx/i.test(item.type));
    if (ncxItem) { const ncxDoc = parseXml(await pkg.text(ncxItem.path)); if (ncxDoc) toc = parseNcx(ncxDoc, ncxItem.path); }
  }
  const wanted = new Map();
  for (const entry of toc) if (entry.frag) { if (!wanted.has(entry.path)) wanted.set(entry.path, new Set()); wanted.get(entry.path).add(entry.frag); }

  const bookId = uid('b');
  const spine = []; const keep = []; const pathToSpine = new Map(); const anchors = new Map();
  let chars = 0; let cjk = 0;
  for (let i = 0; i < spineItems.length; i += 1) {
    report(i, spineItems.length);
    const item = spineItems[i];
    const doc = parseXhtml(await pkg.text(item.path));
    if (!doc) continue;
    const chapter = convertChapter(doc, item.path, wanted.get(item.path));
    if (!chapter.totalChars) continue;
    // Pictures: stored files of this book, referenced by id.
    const refs = [];
    for (const imagePath of chapter.images) {
      const id = await pkg.keepImage(imagePath).catch(() => '');
      const size = id ? await pkg.imageSize(imagePath).catch(() => null) : null;
      refs.push(id ? `bkimg:${id}${size ? `|${size.w}|${size.h}` : ''}` : '');
      if (id) keep.push(id);
    }
    const parts = chapter.parts.map((part) => part.replace(/<img src="@@BKIMG(\d+)@@"[^>]*>/g, (match, n) => (refs[Number(n)] ? match.replace(`@@BKIMG${n}@@`, refs[Number(n)]) : '')));
    const stored = await macos.files.put({ text: parts.join(PART_MARK), name: `${bookId}-${String(spine.length).padStart(3, '0')}.html`, type: 'text/html' });
    keep.push(stored.id);
    pathToSpine.set(item.path, spine.length);
    for (const [id, part] of Object.entries(chapter.anchors)) anchors.set(`${item.path}#${id}`, part);
    spine.push({ fileId: stored.id, parts: chapter.chars, title: chapter.title });
    chars += chapter.totalChars; cjk += chapter.cjk;
  }
  if (!spine.length) throw new Error(T('emptyEpub', 'This book has no readable chapters.'));

  let entries = toc.map((entry) => {
    const part = entry.frag ? anchors.get(`${entry.path}#${entry.frag}`) : undefined;
    return { title: entry.title.slice(0, 160), depth: entry.depth, s: pathToSpine.get(entry.path), p: part ?? 0, a: part != null ? entry.frag : '' };
  }).filter((entry) => entry.s != null);
  if (!entries.length) entries = spine.map((item, s) => ({ title: item.title || fmt('chapterN', 'Chapter {n}', { n: s + 1 }), depth: 0, s, p: 0, a: '' }));

  // Cover: the manifest's cover-image, the EPUB 2 <meta name="cover">, or a picture named so.
  const coverMeta = byTag(opf, 'meta').find((el) => el.getAttribute('name') === 'cover')?.getAttribute('content');
  const images = [...items.values()].filter((item) => /^image\//.test(item.type));
  const coverItem = images.find((item) => /\bcover-image\b/.test(item.props)) || items.get(coverMeta) || [...items.values()].find((item) => item.path === coverMeta)
    || images.find((item) => /cover/i.test(item.id) || /cover/i.test(item.path));
  let coverId = '';
  if (coverItem && /^image\//.test(coverItem.type || imageMime(coverItem.path))) coverId = await pkg.keepImage(coverItem.path).catch(() => '');
  if (coverId) keep.push(coverId);

  const language = meta('language');
  const description = meta('description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
  return {
    id: bookId, kind: 'epub', title: meta('title').slice(0, 200) || file.name.replace(/\.[^.]+$/, ''),
    author: (authors.length ? authors : creators).map(textOf).filter(Boolean).join(', ').slice(0, 200),
    publisher: meta('publisher').slice(0, 200), language, description,
    coverId, customCover: '', sourceId: file.id, sourceName: file.name, size: file.size || 0,
    added: Date.now(), opened: 0, finished: false, finishedAt: 0, pos: { s: 0, p: 0, f: 0 }, format: FORMAT,
    spine, toc: entries, files: [...new Set(keep)], bookmarks: [],
    cpm: (/^(zh|ja|ko)/i.test(language) || cjk > chars * 0.3) ? 450 : 1000
  };
}

async function importComic(file, pkg, report) {
  const pages = pkg.images().sort((a, b) => compare(a.path, b.path));
  let title = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim(); let author = '';
  const infoEntry = pkg.entries.find((entry) => /(^|\/)comicinfo\.xml$/i.test(entry.path));
  if (infoEntry) {
    const info = parseXml(await pkg.text(infoEntry.path));
    if (info) {
      const field = (name) => textOf(byTag(info, name)[0]);
      const series = field('Series'); const number = field('Number');
      title = field('Title') || (series ? `${series}${number ? ` #${number}` : ''}` : title);
      author = field('Writer');
    }
  }
  const ids = [];
  for (let i = 0; i < pages.length; i += 1) { report(i, pages.length); const id = await pkg.keepImage(pages[i].path); if (id) ids.push(id); }
  if (!ids.length) throw new Error(T('emptyComic', 'This archive contains no pictures.'));
  return {
    id: uid('b'), kind: 'comic', title: title.slice(0, 200), author: author.slice(0, 200), publisher: '', language: '', description: '',
    coverId: ids[0], customCover: '', sourceId: file.id, sourceName: file.name, size: file.size || 0,
    added: Date.now(), opened: 0, finished: false, finishedAt: 0, pos: { s: 0, p: 0, f: 0 }, format: FORMAT,
    spine: [{ fileId: '', parts: ids.map(() => 1), title: '' }], pages: ids, toc: [], files: ids, bookmarks: [], cpm: 1
  };
}

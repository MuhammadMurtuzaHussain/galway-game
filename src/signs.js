// Shopfront signs with the real shop, pub and café names from OpenStreetMap,
// and bilingual street name plates (Irish above English) on corner walls.
// All the lettering is painted into a few shared atlas textures.
import * as THREE from 'three';

const TOWN = [-280, 280];
const CELL_W = 256, CELL_H = 32, ATLAS = 2048;
const COLS = ATLAS / CELL_W, ROWS = ATLAS / CELL_H;
const STREET_KINDS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian', 'trunk', 'secondary_link']);

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// Sign colours by what the place is: pubs in dark paint with gold letters,
// cafés and restaurants in cream, shops in anything bright.
function style(kind, name) {
  const h = hash(name);
  if (kind === 'pub' || kind === 'bar') {
    const bg = ['#1f3d2b', '#5a1a1f', '#1c2a4a', '#151515', '#2b4a5a'][h % 5];
    return { bg, fg: '#e0bd62', font: 'bold {s}px Georgia, "Times New Roman", serif', caps: true };
  }
  if (['restaurant', 'cafe', 'fast_food', 'ice_cream', 'hotel', 'guest_house', 'hostel'].includes(kind)) {
    const bg = ['#efe6cf', '#2e2a26', '#7a1f2b', '#f4efe4', '#36524a'][h % 5];
    const fg = bg === '#efe6cf' || bg === '#f4efe4' ? '#2a2420' : '#f3ead7';
    return { bg, fg, font: 'italic bold {s}px Georgia, serif', caps: false };
  }
  if (kind === 'pharmacy') return { bg: '#1f7a4a', fg: '#ffffff', font: 'bold {s}px Arial, sans-serif', caps: true };
  if (kind === 'bank') return { bg: '#1a3a6b', fg: '#ffffff', font: 'bold {s}px Arial, sans-serif', caps: false };
  const bg = ['#ffffff', '#111111', '#c4473a', '#2d5f9a', '#e2b546', '#3f8197', '#6b3d8f', '#e86a25'][h % 8];
  const fg = bg === '#ffffff' || bg === '#e2b546' ? '#1a1a1a' : '#ffffff';
  return { bg, fg, font: 'bold {s}px "Arial Narrow", Arial, sans-serif', caps: true };
}

class Atlas {
  constructor() {
    this.pages = [];
  }

  page() {
    let p = this.pages[this.pages.length - 1];
    if (!p || p.used >= COLS * ROWS) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = ATLAS;
      p = { canvas, g: canvas.getContext('2d'), used: 0, pos: [], uv: [], idx: [] };
      this.pages.push(p);
    }
    return p;
  }

  // Reserve `rows` cells stacked vertically; returns the page and pixel rect.
  alloc(rows) {
    let p = this.page();
    let col = Math.floor(p.used / ROWS), row = p.used % ROWS;
    if (row + rows > ROWS) { p.used += ROWS - row; p = this.page(); col = Math.floor(p.used / ROWS); row = p.used % ROWS; }
    p.used += rows;
    return { p, x: col * CELL_W, y: row * CELL_H, h: rows * CELL_H };
  }
}

function fitFont(g, text, font, size, maxW) {
  let s = size;
  g.font = font.replace('{s}', s);
  while (g.measureText(text).width > maxW && s > 10) g.font = font.replace('{s}', --s);
  return g.measureText(text).width;
}

// Paint one fascia; returns its cell and how wide the lettering came out (px).
function paintShop(atlas, name, kind) {
  const st = style(kind, name);
  const text = st.caps ? name.toUpperCase() : name;
  const c = atlas.alloc(1);
  const g = c.p.g;
  const tw = fitFont(g, text, st.font, 22, CELL_W - 20);
  const w = Math.min(CELL_W, Math.ceil(tw) + 20);
  g.fillStyle = st.bg;
  g.fillRect(c.x, c.y, w, CELL_H);
  g.strokeStyle = st.fg;
  g.globalAlpha = 0.5;
  g.lineWidth = 1.5;
  g.strokeRect(c.x + 2.5, c.y + 2.5, w - 5, CELL_H - 5);
  g.globalAlpha = 1;
  g.fillStyle = st.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.x + w / 2, c.y + CELL_H / 2 + 1);
  return { ...c, w };
}

// Galway street plate: white, green border, Irish in italics above English capitals.
function paintStreet(atlas, en, ga) {
  const c = atlas.alloc(2);
  const g = c.p.g;
  g.fillStyle = '#f4f4ef';
  g.fillRect(c.x, c.y, CELL_W, c.h);
  g.strokeStyle = '#1f5a3a';
  g.lineWidth = 4;
  g.strokeRect(c.x + 3, c.y + 3, CELL_W - 6, c.h - 6);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#1f5a3a';
  if (ga) {
    fitFont(g, ga, 'italic {s}px Georgia, serif', 19, CELL_W - 24);
    g.fillText(ga, c.x + CELL_W / 2, c.y + 20);
  }
  g.fillStyle = '#151515';
  fitFont(g, en.toUpperCase(), 'bold {s}px Arial, sans-serif', 21, CELL_W - 24);
  g.fillText(en.toUpperCase(), c.x + CELL_W / 2, c.y + (ga ? 44 : 32));
  return { ...c, w: CELL_W };
}

// Quad flat against a wall at (x, z) facing outward along (nx, nz).
function quad(c, x, z, nx, nz, yc, w, h) {
  const rx = nz, rz = -nx; // viewer's right when facing the wall
  const ox = x + nx * 0.07, oz = z + nz * 0.07;
  const P = (a, b) => [ox + rx * a * w / 2, yc + b * h / 2, oz + rz * a * w / 2];
  const base = c.p.pos.length / 3;
  for (const v of [P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)]) c.p.pos.push(...v);
  const u0 = c.x / ATLAS, u1 = (c.x + c.w) / ATLAS, v1 = 1 - c.y / ATLAS, v0 = 1 - (c.y + c.h) / ATLAS;
  c.p.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
  c.p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function buildSigns(map, skipBuildings) {
  // spatial index of building outlines (with outward normals per edge)
  const G = 24, grid = new Map();
  const rings = [];
  for (const b of map.buildings) {
    if (skipBuildings.has(b.n)) continue;
    const p = b.p, n = p.length / 2;
    let area = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
    const ring = { p, s: area > 0 ? 1 : -1, h: b.h, used: [] };
    const idx = rings.push(ring) - 1;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
    for (let cx = Math.floor(x0 / G); cx <= Math.floor(x1 / G); cx++)
      for (let cz = Math.floor(z0 / G); cz <= Math.floor(z1 / G); cz++) {
        const k = cx * 100003 + cz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(idx);
      }
  }
  const near = (x, z) => {
    const out = new Set();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const i of grid.get((Math.floor(x / G) + dx) * 100003 + Math.floor(z / G) + dz) || []) out.add(i);
    return out;
  };
  const inside = (x, z, p) => {
    let c = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const open = (x, z) => { for (const i of near(x, z)) if (inside(x, z, rings[i].p)) return false; return true; };

  // Nearest wall to (x, z) that faces open ground, with room for a sign `w` wide.
  // `faces` optionally requires the wall to face that direction.
  const wallNear = (x, z, w, maxD, faces) => {
    let best = null;
    for (const i of near(x, z)) {
      const r = rings[i], p = r.p, n = p.length / 2;
      for (let e = 0; e < n; e++) {
        const ax = p[e * 2], az = p[e * 2 + 1], bx = p[((e + 1) % n) * 2], bz = p[((e + 1) % n) * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < w + 0.6) continue;
        const ex = (bx - ax) / len, ez = (bz - az) / len, nx = ez * r.s, nz = -ex * r.s;
        if (faces && nx * faces[0] + nz * faces[1] < 0.6) continue;
        const t = Math.max(w / 2 + 0.3, Math.min(len - w / 2 - 0.3, (x - ax) * ex + (z - az) * ez));
        const px = ax + ex * t, pz = az + ez * t;
        const d = Math.hypot(x - px, z - pz);
        if (d > maxD || (best && d >= best.d)) continue;
        if (r.used.some(([e2, t2, w2]) => e2 === e && Math.abs(t2 - t) < (w + w2) / 2 + 0.3)) continue;
        if (!open(px + nx * 2.5, pz + nz * 2.5)) continue;
        best = { d, x: px, z: pz, nx, nz, ring: r, e, t, h: r.h };
      }
    }
    return best;
  };

  const atlas = new Atlas();
  const PX = 0.7 / CELL_H; // fascia lettering scale: metres per pixel

  // shopfronts
  for (const [x, z, kind, name] of map.pois) {
    const c0 = paintShop(atlas, name, kind);
    let w = c0.w * PX;
    let spot = wallNear(x, z, Math.min(w, 2.2), 14);
    if (!spot || spot.h < 4) { c0.p.used--; continue; } // nowhere sensible to hang it
    const len = Math.hypot(...[0, 1].map((k) => spot.ring.p[((spot.e + 1) % (spot.ring.p.length / 2)) * 2 + k] - spot.ring.p[spot.e * 2 + k]));
    w = Math.min(w, len - 0.6);
    const big = kind === 'pub' || kind === 'bar';
    spot.ring.used.push([spot.e, spot.t, w]);
    quad(c0, spot.x, spot.z, spot.nx, spot.nz, big ? 3.15 : 3.05, w, big ? 0.8 : 0.7);
  }

  // street plates where streets meet, on a corner wall facing the street
  const plates = new Map(); // street name -> painted cell
  const placed = [];
  for (const r of map.roads) {
    if (!r.n || !STREET_KINDS.has(r.k) || r.b || r.p.length < 4) continue;
    const [x0, z0] = r.p;
    if (Math.hypot(x0 - TOWN[0], z0 - TOWN[1]) > 1500 && !(x0 < -1300 && z0 > 1100)) continue;
    const last = r.p.length - 2;
    for (const [i, j] of [[0, 2], [last, last - 2]]) {
      const ex = r.p[i], ez = r.p[i + 1];
      let dx = r.p[j] - ex, dz = r.p[j + 1] - ez;
      const l = Math.hypot(dx, dz);
      if (l < 8) continue;
      dx /= l; dz /= l;
      if (placed.some(([n, px, pz]) => n === r.n && Math.hypot(px - ex, pz - ez) < 90)) continue;
      for (const side of [1, -1]) {
        const sx = ex + dx * 5 - dz * side * (r.w / 2 + 2), sz = ez + dz * 5 + dx * side * (r.w / 2 + 2);
        // the wall must face back across the street
        const spot = wallNear(sx, sz, 1.6, 6, [dz * side, -dx * side]);
        if (!spot || spot.h < 5) continue;
        let cell = plates.get(r.n);
        if (!cell) plates.set(r.n, (cell = paintStreet(atlas, r.n, r.ga)));
        spot.ring.used.push([spot.e, spot.t, 1.6]);
        quad(cell, spot.x, spot.z, spot.nx, spot.nz, 4.2, 1.5, 0.375);
        placed.push([r.n, ex, ez]);
        break;
      }
    }
  }

  const group = new THREE.Group();
  for (const p of atlas.pages) {
    if (!p.idx.length) continue;
    const tex = new THREE.CanvasTexture(p.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
    geo.setIndex(p.idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.22, polygonOffset: true, polygonOffsetFactor: -2 });
    group.add(new THREE.Mesh(geo, mat));
  }
  group.userData.counts = { shops: map.pois.length, plates: placed.length, streets: plates.size, pages: atlas.pages.length };
  return group;
}

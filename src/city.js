// Turns the map JSON into chunked, merged meshes: buildings, roofs, roads,
// bridges/piers, trees and street lamps. Also fills the collision world.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tintedWallMaterial, lampMaterial } from './textures.js';

const CHUNK = 400;
const TOWN_CENTRE = [-280, 280];

const PALETTES = {
  town: ['#c4473a', '#e2b546', '#3c6c9e', '#efe7d4', '#6b9a5a', '#d9783a', '#8b3a5b', '#f1dba9', '#4a8b8b', '#b5523b', '#f4efe4', '#2f5f7f', '#e9c8c2', '#7e9cc2', '#d1a64b'],
  house: ['#dcd6c8', '#d1c8b2', '#e6dfce', '#c2baa8', '#d6c9aa', '#ebe5d9', '#cbbb9c', '#e0d4c0', '#bfc4c2'],
  plain: ['#9d978d', '#a8a49a', '#8f9295', '#b3ac9c'],
  church: ['#8d8a83', '#9a958a'],
};
const ROOF_PITCHED = ['#4b4f57', '#55514c', '#3f434b', '#5c5a58', '#6b4a3e'];
const ROOF_FLAT = ['#6f6c66', '#5d5a55', '#77736b', '#66655f'];
const POT = new THREE.Color('#9a5a3c');
const shade = (c, f) => c.clone().multiplyScalar(f);
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'secondary_link']);
const FOOT = new Set(['footway', 'path', 'cycleway', 'steps', 'track', 'pedestrian']);

const col = (hex) => new THREE.Color(hex);
const pick = (arr, seed) => arr[seed % arr.length];
// OSM colour tags are hex or CSS names; ignore anything else
const osmColour = (c) => (c && (/^#[0-9a-f]{6}$/i.test(c) || THREE.Color.NAMES[c.toLowerCase()] !== undefined) ? c.toLowerCase() : null);
const PITCHED_SHAPES = new Set(['gabled', 'hipped', 'half-hipped', 'saltbox', 'pyramidal', 'gambrel', 'mansard']);

// Smallest rectangle around a ring, as corners [A, B, C, D] with A→B along the
// long side, plus how much of it the ring fills (1 = the ring is a rectangle).
function rectOf(ring) {
  const n = ring.length / 2;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  area = Math.abs(area) / 2;
  let best = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = ring[j * 2] - ring[i * 2], uz = ring[j * 2 + 1] - ring[i * 2 + 1];
    const l = Math.hypot(ux, uz);
    if (l < 0.5) continue;
    ux /= l; uz /= l;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = ring[k * 2], z = ring[k * 2 + 1];
      const a = x * ux + z * uz, b = -x * uz + z * ux;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const ra = (a1 - a0) * (b1 - b0);
    if (!best || ra < best.ra) best = { ra, ux, uz, a0, a1, b0, b1 };
  }
  if (!best) return null;
  const { ux, uz, a0, a1, b0, b1 } = best;
  const at = (a, b) => [a * ux - b * uz, a * uz + b * ux];
  let corners = [at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)];
  if (a1 - a0 < b1 - b0) corners = [corners[1], corners[2], corners[3], corners[0]];
  return { corners, fill: area / best.ra, long: Math.max(a1 - a0, b1 - b0), short: Math.min(a1 - a0, b1 - b0) };
}

// Upright box on a footprint of four (x, z) corners, sides and top only.
function prism(g, q, y0, y1, color) {
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    g.vert(a[0], y0, a[1], 0, 0, color); g.vert(b[0], y0, b[1], 1, 0, color); g.vert(b[0], y1, b[1], 1, 1, color);
    g.vert(a[0], y0, a[1], 0, 0, color); g.vert(b[0], y1, b[1], 1, 1, color); g.vert(a[0], y1, a[1], 0, 1, color);
  }
  g.vert(q[0][0], y1, q[0][1], 0, 0, color); g.vert(q[2][0], y1, q[2][1], 1, 1, color); g.vert(q[1][0], y1, q[1][1], 1, 0, color);
  g.vert(q[0][0], y1, q[0][1], 0, 0, color); g.vert(q[3][0], y1, q[3][1], 0, 1, color); g.vert(q[2][0], y1, q[2][1], 1, 1, color);
}

class Geo {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.col = [];
  }
  vert(x, y, z, u, v, c) {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    if (c) this.col.push(c.r, c.g, c.b);
  }
  get empty() {
    return this.pos.length === 0;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function signedArea(f) {
  let a = 0;
  const n = f.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += f[i * 2] * f[j * 2 + 1] - f[j * 2] * f[i * 2 + 1];
  }
  return a / 2;
}

function reverseRing(f) {
  const out = [];
  for (let i = f.length - 2; i >= 0; i -= 2) out.push(f[i], f[i + 1]);
  return out;
}

// Drop duplicate and nearly-collinear points so simple houses become quads.
function cleanRing(f) {
  let pts = [];
  for (let i = 0; i < f.length; i += 2) pts.push([f[i], f[i + 1]]);
  for (let pass = 0; pass < 2; pass++) {
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
      const ax = c[0] - p[0], az = c[1] - p[1], bx = q[0] - c[0], bz = q[1] - c[1];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 0.3) continue;
      const cross = Math.abs(ax * bz - az * bx) / (la * lb || 1);
      if (cross < 0.12 && ax * bx + az * bz > 0) continue; // < ~7° turn
      out.push(c);
    }
    pts = out;
    if (pts.length < 3) return null;
  }
  return pts.flat();
}

export function buildCity(map, tex, collision, isWater) {
  const mats = {
    town: tintedWallMaterial(tex.townWall),
    shop: tintedWallMaterial(tex.shopWall),
    house: tintedWallMaterial(tex.houseWall),
    plain: tintedWallMaterial(tex.plainWall),
    roof: new THREE.MeshLambertMaterial({ map: tex.roof, vertexColors: true }),
    major: new THREE.MeshLambertMaterial({ map: tex.roadMajor, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    minor: new THREE.MeshLambertMaterial({ map: tex.roadMinor, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    foot: new THREE.MeshLambertMaterial({ map: tex.footway, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    stone: new THREE.MeshLambertMaterial({ color: '#8f8a80', side: THREE.DoubleSide }),
  };

  const chunks = new Map();
  const chunkOf = (x, z) => {
    const k = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = {}));
    return c;
  };
  const geo = (chunk, name) => chunk[name] || (chunk[name] = new Geo());

  // ---------- Buildings ----------
  const wall = (g, ring, y0, y1, vScale, color, tileW = 3.5) => {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const u1 = Math.max(1, Math.round(len / tileW));
      const v0 = 0, v1 = (y1 - y0) / vScale;
      const A = [ax, y0, az], B = [bx, y0, bz], C = [bx, y1, bz], D = [ax, y1, az];
      g.vert(...A, 0, v0, color); g.vert(...B, u1, v0, color); g.vert(...C, u1, v1, color);
      g.vert(...A, 0, v0, color); g.vert(...C, u1, v1, color); g.vert(...D, 0, v1, color);
    }
  };

  for (const b of map.buildings) {
    let ring = cleanRing(b.p);
    if (!ring) continue;
    if (signedArea(ring) > 0) ring = reverseRing(ring);
    const holes = (b.holes || []).map((h) => cleanRing(h)).filter(Boolean).map((h) => (signedArea(h) < 0 ? reverseRing(h) : h));

    collision.addRing(ring, b.h + 3);
    for (const h of holes) collision.addRing(h, b.h + 3);

    const cx = ring[0], cz = ring[1];
    const chunk = chunkOf(cx, cz);
    const dTown = Math.hypot(cx - TOWN_CENTRE[0], cz - TOWN_CENTRE[1]);
    let style = b.k === 'shed' ? 'plain' : b.k === 'church' ? 'church' : b.k === 'house' ? 'house' : dTown < 900 ? 'town' : b.h > 11 ? 'town' : 'house';
    const color = col(b.c || osmColour(b.bc) || pick(PALETTES[style], b.s));
    const h = b.h;

    const all = [ring, ...holes];
    if (style === 'town' && dTown < 450 && h >= 6) {
      for (const r of all) wall(geo(chunk, 'shop'), r, 0, 3.6, 3.6, color);
      for (const r of all) wall(geo(chunk, 'town'), r, 3.6, h, 3.1, color);
    } else if (style === 'town') {
      for (const r of all) wall(geo(chunk, 'town'), r, 0, h, 3.1, color);
    } else if (style === 'house') {
      for (const r of all) wall(geo(chunk, 'house'), r, 0, h, 2.9, color, 3.2);
    } else {
      for (const r of all) wall(geo(chunk, 'plain'), r, 0, h, 4, color, 4);
    }

    // Roof: pitched (gabled, hipped or pyramid) where OSM says so, or on small
    // near-rectangular buildings; otherwise flat behind a parapet.
    const n = ring.length / 2;
    const rect = holes.length ? null : rectOf(ring);
    const tagged = b.rs && b.rs !== 'flat';
    const wantPitch = tagged ? PITCHED_SHAPES.has(b.rs) || b.rs === 'round' : !b.rs && style !== 'plain' && h < 16;
    const pitched = rect && wantPitch && rect.fill > (tagged ? 0.72 : 0.86) && rect.short > 2.5 && rect.long < 60;
    const roofG = geo(chunk, 'roof');
    if (pitched) {
      const roofCol = col(osmColour(b.rc) || pick(ROOF_PITCHED, b.s >> 3));
      // a true quad keeps its own corners; anything else uses its bounding rectangle
      const P = (i) => [ring[(i % n) * 2], ring[(i % n) * 2 + 1]];
      let [A, B, C, D] = rect.corners;
      if (n === 4) {
        const lenAB = Math.hypot(P(1)[0] - P(0)[0], P(1)[1] - P(0)[1]), lenBC = Math.hypot(P(2)[0] - P(1)[0], P(2)[1] - P(1)[1]);
        [A, B, C, D] = lenAB >= lenBC ? [P(0), P(1), P(2), P(3)] : [P(1), P(2), P(3), P(0)];
      }
      const short = rect.short;
      const rh = Math.min(short * 0.38, 3.2);
      let R1 = [(B[0] + C[0]) / 2, h + rh, (B[1] + C[1]) / 2];
      let R2 = [(D[0] + A[0]) / 2, h + rh, (D[1] + A[1]) / 2];
      const hip = b.rs === 'hipped' || b.rs === 'half-hipped' || b.rs === 'mansard';
      if (b.rs === 'pyramidal') {
        const m = [(A[0] + C[0]) / 2, h + rh, (A[1] + C[1]) / 2];
        R1 = R2 = m;
      } else if (hip) {
        // pull the ridge ends in so the short ends slope too
        const k = Math.min(0.45, (short * 0.5) / rect.long);
        const r1 = [...R1], r2 = [...R2];
        R1 = [r1[0] + (r2[0] - r1[0]) * k, r1[1], r1[2] + (r2[2] - r1[2]) * k];
        R2 = [r2[0] + (r1[0] - r2[0]) * k, r2[1], r2[2] + (r1[2] - r2[2]) * k];
      }
      const a = [A[0], h, A[1]], bb = [B[0], h, B[1]], c = [C[0], h, C[1]], d = [D[0], h, D[1]];
      const uvw = (p) => [p[0] / 3, p[2] / 3];
      const roofTris = [[a, bb, R1], [a, R1, R2], [c, d, R2], [c, R2, R1]];
      const ends = [[bb, c, R1], [d, a, R2]];
      if (hip || b.rs === 'pyramidal') roofTris.push(...ends);
      for (const [p, q, r] of roofTris) {
        const ux = q[0] - p[0], uz = q[2] - p[2], vx = r[0] - p[0], vz = r[2] - p[2];
        const tri = uz * vx - ux * vz < 0 ? [p, r, q] : [p, q, r];
        for (const v of tri) roofG.vert(...v, ...uvw(v), roofCol);
      }
      if (!hip && b.rs !== 'pyramidal') {
        // gable ends use the wall material
        const gw = geo(chunk, style === 'town' ? 'town' : style === 'church' ? 'plain' : 'house');
        const vs = style === 'house' ? 2.9 : 3.1;
        const yb = style === 'town' && dTown < 450 && h >= 6 ? 3.6 : 0;
        for (const [p, q, r] of ends) {
          gw.vert(...p, 0, (h - yb) / vs, color);
          gw.vert(...q, 1, (h - yb) / vs, color);
          gw.vert(...r, 0.5, (h - yb + rh) / vs, color);
        }
      }
      // chimney stacks at the ridge ends of houses and terraces
      if (style !== 'church' && R1 !== R2 && short < 14) {
        const ex = R2[0] - R1[0], ez = R2[2] - R1[2], el = Math.hypot(ex, ez) || 1;
        const ax = ex / el, az = ez / el;
        const stack = shade(color, 0.82);
        for (const [f, on] of [[0.06, true], [0.94, el > 7 || (b.s & 1) === 0]]) {
          if (!on) continue;
          const x = R1[0] + ex * f, z = R1[2] + ez * f;
          const q = [[-0.55, -0.35], [0.55, -0.35], [0.55, 0.35], [-0.55, 0.35]].map(([u, v]) => [x + ax * v - az * u, z + az * v + ax * u]);
          prism(geo(chunk, 'plain'), q, h + rh * 0.4, h + rh + 0.9, stack);
          for (const o of [-0.25, 0.25]) {
            const px = x - az * o, pz = z + ax * o;
            const pot = [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]].map(([u, v]) => [px + u, pz + v]);
            prism(geo(chunk, 'plain'), pot, h + rh + 0.9, h + rh + 1.25, POT);
          }
        }
      }
    } else {
      const roofCol = col(pick(ROOF_FLAT, b.s >> 3));
      const toV2 = (f) => {
        const out = [];
        for (let i = 0; i < f.length; i += 2) out.push(new THREE.Vector2(f[i], f[i + 1]));
        return out;
      };
      const contour = toV2(ring);
      const holeV = holes.map(toV2);
      const tris = THREE.ShapeUtils.triangulateShape(contour, holeV);
      const pts = contour.concat(...holeV);
      const y = h + 0.05;
      for (const t of tris) {
        const [p, q, r] = t.map((i) => [pts[i].x, y, pts[i].y]);
        const ux = q[0] - p[0], uz = q[2] - p[2], vx = r[0] - p[0], vz = r[2] - p[2];
        const tri = uz * vx - ux * vz < 0 ? [p, r, q] : [p, q, r];
        for (const v of tri) roofG.vert(...v, v[0] / 3, v[2] / 3, roofCol);
      }
      // little parapet lip so flat roofs read as flat roofs
      if (h > 5) wall(geo(chunk, 'plain'), ring, h, h + 0.6, 4, roofCol, 4);
    }
  }

  // ---------- Roads, bridges, piers ----------
  const ribbon = (g, flat, w, y, vTile) => {
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) {
      const p = [flat[i], flat[i + 1]];
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.05) pts.push(p);
    }
    if (pts.length < 2) return null;
    const L = [], R = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      // miter factor from the angle between this and the previous segment
      let k = 1;
      if (i > 0 && i < pts.length - 1) {
        const p = pts[i - 1], q = pts[i];
        let sx = q[0] - p[0], sz = q[1] - p[1];
        const sl = Math.hypot(sx, sz) || 1;
        const cos = (sx / sl) * dx + (sz / sl) * dz;
        k = 1 / Math.max(0.5, cos);
      }
      const nx = -dz * (w / 2) * k, nz = dx * (w / 2) * k;
      L.push([pts[i][0] + nx, pts[i][1] + nz]);
      R.push([pts[i][0] - nx, pts[i][1] - nz]);
    }
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      const v0 = acc / vTile, v1 = (acc + seg) / vTile;
      acc += seg;
      const l0 = [L[i][0], y, L[i][1]], r0 = [R[i][0], y, R[i][1]], l1 = [L[i + 1][0], y, L[i + 1][1]], r1 = [R[i + 1][0], y, R[i + 1][1]];
      // pick winding so the face points up
      const ux = r0[0] - l0[0], uz = r0[2] - l0[2], vx = r1[0] - l0[0], vz = r1[2] - l0[2];
      if (uz * vx - ux * vz >= 0) {
        g.vert(...l0, 0, v0); g.vert(...r0, 1, v0); g.vert(...r1, 1, v1);
        g.vert(...l0, 0, v0); g.vert(...r1, 1, v1); g.vert(...l1, 0, v1);
      } else {
        g.vert(...l0, 0, v0); g.vert(...r1, 1, v1); g.vert(...r0, 1, v0);
        g.vert(...l0, 0, v0); g.vert(...l1, 0, v1); g.vert(...r1, 1, v1);
      }
    }
    return { L, R };
  };

  const sideWalls = (g, edges, yTop, yBot) => {
    for (const side of [edges.L, edges.R]) {
      for (let i = 0; i < side.length - 1; i++) {
        const a = side[i], b = side[i + 1];
        const A = [a[0], yBot, a[1]], B = [b[0], yBot, b[1]], C = [b[0], yTop, b[1]], D = [a[0], yTop, a[1]];
        g.vert(...A, 0, 0); g.vert(...B, 1, 0); g.vert(...C, 1, 1);
        g.vert(...A, 0, 0); g.vert(...C, 1, 1); g.vert(...D, 0, 1);
      }
    }
  };

  for (const r of map.roads) {
    const chunk = chunkOf(r.p[0], r.p[1]);
    const kind = MAJOR.has(r.k) ? 'major' : FOOT.has(r.k) ? 'foot' : 'minor';
    const vTile = kind === 'major' ? 12 : kind === 'minor' ? 8 : r.w;
    const edges = ribbon(geo(chunk, kind), r.p, r.w, 0.03, vTile);
    if (edges && r.b) {
      sideWalls(geo(chunk, 'stone'), edges, 0.03, -1.6);
      sideWalls(geo(chunk, 'stone'), edges, 1.0, 0.03);
    }
  }
  for (const l of map.lines) {
    if (l.k !== 'pier') continue;
    const chunk = chunkOf(l.p[0], l.p[1]);
    const edges = ribbon(geo(chunk, 'foot'), l.p, 5, 0.05, 5);
    if (edges) sideWalls(geo(chunk, 'stone'), edges, 0.05, -1.6);
  }

  // ---------- Assemble chunk meshes ----------
  const group = new THREE.Group();
  for (const chunk of chunks.values()) {
    for (const [name, g] of Object.entries(chunk)) {
      if (g.empty) continue;
      const mesh = new THREE.Mesh(g.build(), mats[name]);
      const solid = name !== 'major' && name !== 'minor' && name !== 'foot';
      mesh.castShadow = solid;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // ---------- Trees ----------
  const treePts = [];
  for (let i = 0; i < map.trees.length; i += 2) treePts.push([map.trees[i], map.trees[i + 1]]);
  const inPoly = (x, z, f) => {
    let inside = false;
    for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
      const xi = f[i], zi = f[i + 1], xj = f[j], zj = f[j + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const density = { wood: 90, park: 450, cemetery: 500, grass: 1400 };
  for (const a of map.areas) {
    const d = density[a.k];
    if (!d) continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < a.p.length; i += 2) {
      minX = Math.min(minX, a.p[i]); maxX = Math.max(maxX, a.p[i]);
      minZ = Math.min(minZ, a.p[i + 1]); maxZ = Math.max(maxZ, a.p[i + 1]);
    }
    const count = Math.min(400, Math.floor(((maxX - minX) * (maxZ - minZ)) / d));
    for (let i = 0; i < count; i++) {
      const x = minX + rnd() * (maxX - minX), z = minZ + rnd() * (maxZ - minZ);
      if (inPoly(x, z, a.p) && !isWater(x, z)) treePts.push([x, z]);
    }
  }

  const trunk = new THREE.CylinderGeometry(0.14, 0.22, 2.4, 5).toNonIndexed();
  trunk.translate(0, 1.2, 0);
  const crown = new THREE.IcosahedronGeometry(1.7, 0);
  crown.scale(1, 1.15, 1);
  crown.translate(0, 3.6, 0);
  const crown2 = new THREE.IcosahedronGeometry(1.2, 0);
  crown2.translate(0.7, 4.6, 0.3);
  const paint = (g, hex) => {
    const c = col(hex);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g;
  };
  const treeGeo = mergeGeometries([paint(trunk, '#5a4330'), paint(crown, '#ffffff'), paint(crown2, '#ffffff')]);
  treeGeo.computeVertexNormals();
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const leafCols = ['#4f7a35', '#5f8a3a', '#3f6a2e', '#6b8f3f', '#557d34'].map(col);

  const treeChunks = new Map();
  for (const [x, z] of treePts) {
    const k = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
    if (!treeChunks.has(k)) treeChunks.set(k, []);
    treeChunks.get(k).push([x, z]);
    collision.addCircle(x, z, 0.3);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const list of treeChunks.values()) {
    const inst = new THREE.InstancedMesh(treeGeo, treeMat, list.length);
    list.forEach(([x, z], i) => {
      const s = 0.75 + rnd() * 0.6;
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      m4.compose(pos.set(x, 0, z), q, sc.set(s, s * (0.85 + rnd() * 0.4), s));
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, leafCols[i % leafCols.length]);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }

  // ---------- Street lamps ----------
  const pole = new THREE.CylinderGeometry(0.06, 0.09, 6, 5).toNonIndexed();
  pole.translate(0, 3, 0);
  const arm = new THREE.BoxGeometry(1.1, 0.08, 0.08).toNonIndexed();
  arm.translate(0.5, 5.95, 0);
  const head = new THREE.BoxGeometry(0.5, 0.14, 0.26).toNonIndexed();
  head.translate(1.0, 5.85, 0);
  for (const g of [pole, arm, head]) g.deleteAttribute('uv');
  const lampGeo = mergeGeometries([paint(pole, '#3a3d40'), paint(arm, '#3a3d40'), paint(head, '#fff4c8')]);
  const lampMat = lampMaterial();
  const lamps = [];
  for (const r of map.roads) {
    if (r.w < 6 || r.b) continue;
    let carry = 14;
    for (let i = 0; i < r.p.length - 2; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      let t = carry;
      for (; t < len; t += 30) {
        const side = lamps.length % 2 ? 1 : -1;
        const off = r.w / 2 + 1.6;
        const x = ax + dx * t - dz * off * side, z = az + dz * t + dx * off * side;
        if (!isWater(x, z)) lamps.push([x, z, Math.atan2(dx * side, dz * side)]);
      }
      carry = t - len;
    }
  }
  const lampInst = new THREE.InstancedMesh(lampGeo, lampMat, lamps.length);
  lamps.forEach(([x, z, rot], i) => {
    q.setFromAxisAngle(up, rot);
    m4.compose(pos.set(x, 0, z), q, sc.set(1, 1, 1));
    lampInst.setMatrixAt(i, m4);
    collision.addCircle(x, z, 0.12);
  });
  lampInst.castShadow = true;
  lampInst.computeBoundingSphere();
  group.add(lampInst);

  return { group, lamps, stats: { trees: treePts.length, lamps: lamps.length } };
}

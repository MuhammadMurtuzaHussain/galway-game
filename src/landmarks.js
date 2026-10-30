// Hand-built models of Galway's landmarks, placed where OpenStreetMap has them:
// Spanish Arch, the Cathedral dome, the Quincentennial Fountain and Browne
// Doorway in Eyre Square, Lynch's Castle, the Hall of the Red Earl, Salmon
// Weir Bridge and the weir, hookers and swans at the Claddagh, the Long Walk
// colours, Leisureland, Blackrock diving tower (climbable), and the Prom
// railings with the wall at the Blackrock end that everyone kicks.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Map buildings that a model here replaces (left out of the generic extrusion).
export const REPLACED_BUILDINGS = new Set(['Spanish Arch', 'Galway Cathedral', "Lynch's Castle", 'Hall of the Red Earl']);

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);

// Box whose UVs are in metres, so tiling textures keep their scale on any size.
function boxM(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++)
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
  return g;
}

function stoneTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#7d776c';
  g.fillRect(0, 0, S, S);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rows = 4, rh = S / rows; // one tile = 2 m, so courses are 0.5 m
  for (let r = 0; r < rows; r++) {
    let x = rnd() * 60;
    const start = x;
    while (x < start + S) {
      const w = Math.min(45 + rnd() * 70, start + S - x);
      const l = (150 + rnd() * 45) | 0;
      g.fillStyle = `rgb(${l + 6},${l + 2},${l - 10})`;
      for (const off of [0, -S]) g.fillRect(x + off + 2, r * rh + 2, w - 4, rh - 4);
      x += w;
    }
  }
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '40,36,30' : '230,226,215'},${0.05 + rnd() * 0.1})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.5, 0.5);
  t.anisotropy = 4;
  return t;
}

// Collects geometry per material in a local frame (u along `dir`, v to its
// left, y up), adds matching collision in world space, then merges.
class Kit {
  constructor(collision, ox, oz, dx = 1, dz = 0) {
    const l = Math.hypot(dx, dz);
    this.collision = collision;
    this.ox = ox; this.oz = oz;
    this.dx = dx / l; this.dz = dz / l;
    this.parts = new Map();
  }
  w(u, v) {
    return [this.ox + this.dx * u - this.dz * v, this.oz + this.dz * u + this.dx * v];
  }
  push(mat, g) {
    if (g.index) g = g.toNonIndexed();
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return g;
  }
  add(mat, g, u = 0, y = 0, v = 0, rotY = 0) {
    g = this.push(mat, g);
    if (rotY) g.rotateY(rotY);
    g.translate(u, y, v);
    return g;
  }
  box(mat, u0, u1, y0, y1, v0, v1) {
    this.add(mat, boxM(u1 - u0, y1 - y0, v1 - v0), (u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2);
  }
  // Bar of width w and height h between two local points.
  beam(mat, a, b, w, h = w) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const g = this.push(mat, boxM(len, h, w));
    g.applyQuaternion(_q.setFromUnitVectors(X, _v.set(dx / len, dy / len, dz / len)));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  }
  wall(u0, v0, u1, v1, h, y0 = 0) {
    this.collision.addSegment(...this.w(u0, v0), ...this.w(u1, v1), h, y0);
  }
  rect(u0, u1, v0, v1, h, y0 = 0) {
    this.wall(u0, v0, u1, v0, h, y0);
    this.wall(u1, v0, u1, v1, h, y0);
    this.wall(u1, v1, u0, v1, h, y0);
    this.wall(u0, v1, u0, v0, h, y0);
  }
  platform(u0, u1, v0, v1, top) {
    this.collision.addPlatform([...this.w(u0, v0), ...this.w(u1, v0), ...this.w(u1, v1), ...this.w(u0, v1)], top);
  }
  // Posts and two rails along a path of local [u, floorY, v] points; solid to walk into.
  railing(mat, path, h = 1.05) {
    for (let i = 0; i < path.length - 1; i++) {
      const [u0, y0, v0] = path[i], [u1, y1, v1] = path[i + 1];
      const n = Math.max(1, Math.round(Math.hypot(u1 - u0, v1 - v0) / 1.4));
      for (let k = i ? 1 : 0; k <= n; k++) {
        const f = k / n;
        const u = u0 + (u1 - u0) * f, y = y0 + (y1 - y0) * f, v = v0 + (v1 - v0) * f;
        this.box(mat, u - 0.035, u + 0.035, y, y + h, v - 0.035, v + 0.035);
      }
      this.beam(mat, [u0, y0 + h, v0], [u1, y1 + h, v1], 0.07);
      this.beam(mat, [u0, y0 + h * 0.5, v0], [u1, y1 + h * 0.5, v1], 0.045);
      this.wall(u0, v0, u1, v1, Math.max(y0, y1) + h, Math.min(y0, y1));
    }
  }
  build() {
    const group = new THREE.Group();
    for (const [mat, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    group.position.set(this.ox, 0, this.oz);
    group.rotation.y = Math.atan2(-this.dz, this.dx);
    return group;
  }
}

// Battlements along a local line at height y.
function merlons(k, mat, u0, u1, v, y, thick = 0.6) {
  for (let u = u0 + 0.3; u + 0.6 <= u1; u += 1.3) k.box(mat, u, u + 0.65, y, y + 0.6, v - thick / 2, v + thick / 2);
}

function spanishArch(k, m) {
  // 16th-century extension of the town wall: a deep block pierced by two
  // arches, with the thin wall running on along the river.
  const H = 7.2, D = 6.3;
  k.box(m.stone, 0, 21, 0, 5.2, -0.5, 0.5);
  k.rect(0, 21, -0.5, 0.5, 5.2);
  merlons(k, m.stone, 0, 20.5, 0, 5.2, 0.9);

  const s = new THREE.Shape();
  s.moveTo(20.5, 0);
  s.lineTo(23.0, 0);
  s.lineTo(23.0, 3.0);
  s.absarc(24.8, 3.0, 1.8, Math.PI, 0, true);
  s.lineTo(26.6, 0);
  s.lineTo(28.4, 0);
  s.lineTo(28.4, 3.3);
  s.absarc(30.6, 3.3, 2.2, Math.PI, 0, true);
  s.lineTo(32.8, 0);
  s.lineTo(35.5, 0);
  s.lineTo(35.5, H);
  s.lineTo(20.5, H);
  s.closePath();
  k.add(m.stone, new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false, curveSegments: 12 }));
  // arch rings in a darker dressed stone
  for (const [cu, r, spring] of [[24.8, 1.8, 3.0], [30.6, 2.2, 3.3]]) {
    for (const v of [-0.05, D + 0.05]) {
      const ring = new THREE.TorusGeometry(r + 0.18, 0.2, 4, 14, Math.PI);
      k.add(m.dressed, ring, cu, spring, v);
    }
  }
  merlons(k, m.stone, 20.5, 35.5, 0.3, H);
  merlons(k, m.stone, 20.5, 35.5, D - 0.3, H);
  // piers between the arches are solid; you can walk through both arches
  k.rect(20.5, 23.0, 0, D, H);
  k.rect(26.6, 28.4, 0, D, H);
  k.rect(32.8, 35.5, 0, D, H);
}

// A map building's outline in a Kit's local frame (the Kit's dir must be +x),
// with each edge's direction and outward normal, and an extrude helper.
function footprint(k, b) {
  const pts = [];
  for (let i = 0; i < b.p.length; i += 2) pts.push([b.p[i] - k.ox, b.p[i + 1] - k.oz]);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    area += a[0] * c[1] - c[0] * a[1];
  }
  const s = area > 0 ? 1 : -1;
  const edges = pts.map((a, i) => {
    const c = pts[(i + 1) % pts.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1e-6;
    const eu = (c[0] - a[0]) / len, ev = (c[1] - a[1]) / len;
    const nu = ev * s, nv = -eu * s;
    return {
      len, eu, ev, nu, nv,
      rot: Math.atan2(-ev, eu), // turns a box's x along the edge
      face: Math.atan2(nu, nv), // turns a plane's front outwards
      at: (t, out = 0) => [a[0] + eu * t + nu * out, a[1] + ev * t + nv * out],
    };
  });
  // the outline pushed out by d (in, if negative)
  const grown = (d) => pts.map((p, i) => {
    const e1 = edges[(i + pts.length - 1) % pts.length], e2 = edges[i];
    const f = d / Math.max(0.3, 1 + e1.nu * e2.nu + e1.nv * e2.nv);
    return [p[0] + (e1.nu + e2.nu) * f, p[1] + (e1.nv + e2.nv) * f];
  });
  const extrude = (mat, y0, h, d = 0) => {
    const shape = new THREE.Shape(grown(d).map(([u, v]) => new THREE.Vector2(u, -v)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    k.add(mat, g, 0, y0, 0);
  };
  return { pts, edges, extrude };
}

function cathedral(k, m, b) {
  // Limestone walls from the OSM footprint, tall windows, and the green
  // copper dome over the crossing (the frame origin).
  const base = b.h;
  const f = footprint(k, b);
  f.extrude(m.stone, 0, base);
  f.extrude(m.dressed, base, 0.9);
  k.collision.addRing(b.p, base + 3);

  for (const e of f.edges) {
    if (e.len < 4.5) continue;
    const count = Math.floor(e.len / 4.5);
    for (let j = 0; j < count; j++) {
      const [u, v] = e.at((j + 0.5) * (e.len / count), 0.06);
      k.add(m.glass, boxM(1.5, 7.5, 0.2), u, 10.5, v, e.rot);
      const arch = new THREE.CylinderGeometry(0.75, 0.75, 0.2, 10, 1, false, Math.PI / 2, Math.PI);
      arch.rotateX(Math.PI / 2); // half-disc in the wall plane, rounded side up
      k.add(m.glass, arch, u, 14.25, v, e.rot);
    }
  }

  k.add(m.stone, new THREE.CylinderGeometry(8.4, 8.4, 1.2, 24), 0, base + 0.6, 0);
  k.add(m.stone, new THREE.CylinderGeometry(7.6, 7.6, 6.5, 24), 0, base + 4.45, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.add(m.glass, boxM(1.1, 3.8, 0.3), Math.cos(a) * 7.62, base + 4.6, Math.sin(a) * 7.62, -a + Math.PI / 2);
  }
  k.add(m.stone, new THREE.CylinderGeometry(8.1, 8.1, 0.6, 24), 0, base + 8.0, 0);
  const prof = [];
  const top = Math.acos(1.3 / 7.8);
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * top;
    prof.push(new THREE.Vector2(7.8 * Math.cos(t), base + 8.3 + 8.8 * Math.sin(t)));
  }
  k.add(m.copper, new THREE.LatheGeometry(prof, 16));
  const lt = base + 8.3 + 8.8 * Math.sin(top);
  k.add(m.stone, new THREE.CylinderGeometry(1.3, 1.3, 2.6, 8), 0, lt + 1.3, 0);
  k.add(m.copper, new THREE.ConeGeometry(1.6, 1.4, 8), 0, lt + 3.3, 0);
  k.box(m.gold, -0.13, 0.13, lt + 4, lt + 7, -0.13, 0.13);
  k.box(m.gold, -0.7, 0.7, lt + 5.9, lt + 6.2, -0.13, 0.13);
}

function quincentennialFountain(k, m) {
  // Rust-brown steel sails of a Galway hooker over a stone pool.
  k.box(m.stone, -5.5, 5.5, 0, 0.62, -3.5, -3.0);
  k.box(m.stone, -5.5, 5.5, 0, 0.62, 3.0, 3.5);
  k.box(m.stone, -5.5, -5.0, 0, 0.62, -3.0, 3.0);
  k.box(m.stone, 5.0, 5.5, 0, 0.62, -3.0, 3.0);
  k.box(m.pool, -5.0, 5.0, 0, 0.42, -3.0, 3.0);
  k.box(m.dressed, -1.4, 1.4, 0.4, 1.3, -0.8, 0.8);
  k.rect(-5.5, 5.5, -3.5, 3.5, 0.62);

  const sail = (pts, u, y, v, rot, lean) => {
    const s = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
    g.rotateZ(lean);
    k.add(m.rust, g, u, y, v, rot);
    k.add(m.rust, new THREE.CylinderGeometry(0.07, 0.09, pts[pts.length - 1][1] + 0.6, 6), u, y + (pts[pts.length - 1][1] + 0.6) / 2, v);
  };
  sail([[0, 0], [4.3, 0.5], [3.4, 5.4], [0.2, 7.6]], -1.2, 1.2, 0.2, 0.25, 0.05);
  sail([[0, 0], [3.1, 0.3], [0.2, 5.6]], 1.3, 1.1, 0.7, -0.9, -0.04);
  sail([[0, 0], [2.6, 0.2], [0.1, 4.4]], -2.4, 0.9, -1.2, 2.3, 0.08);
  sail([[0, 0], [2.0, 0.2], [0.1, 3.3]], 2.6, 0.9, -1.0, 3.7, -0.06);
  sail([[0, 0], [1.6, 0.1], [0.1, 2.6]], 0.2, 0.9, -1.7, 1.2, 0.1);
  // water spilling off the sails
  for (const [u, v, h] of [[2.6, 0.8, 1.7], [-2.3, -1.3, 1.6], [1.8, -1.5, 1.5], [-3.2, 1.0, 1.7]]) {
    k.box(m.spray, u - 0.35, u + 0.35, 0.42, 0.42 + h, v - 0.04, v + 0.04);
  }
}

function browneDoorway(k, m) {
  // The 1627 doorway and window of the Browne family's town house, standing alone.
  const s = new THREE.Shape();
  s.moveTo(-3.2, 0);
  s.lineTo(-1.0, 0);
  s.lineTo(-1.0, 2.5);
  s.absarc(0, 2.5, 1.0, Math.PI, 0, true);
  s.lineTo(1.0, 0);
  s.lineTo(3.2, 0);
  s.lineTo(3.2, 9.4);
  s.lineTo(-3.2, 9.4);
  s.closePath();
  const win = new THREE.Path();
  win.moveTo(-2.1, 4.5);
  win.lineTo(2.1, 4.5);
  win.lineTo(2.1, 7.1);
  win.lineTo(-2.1, 7.1);
  win.closePath();
  s.holes.push(win);
  k.add(m.stone, new THREE.ExtrudeGeometry(s, { depth: 0.8, bevelEnabled: false, curveSegments: 10 }));
  for (const u of [-1.05, 0, 1.05]) k.box(m.dressed, u - 0.08, u + 0.08, 4.5, 7.1, 0.3, 0.5);
  k.box(m.dressed, -2.1, 2.1, 5.75, 5.9, 0.3, 0.5);
  k.box(m.dressed, -3.45, 3.45, 9.4, 9.75, -0.15, 0.95);
  k.box(m.dressed, -2.4, 2.4, 4.25, 4.5, -0.25, 1.05); // sill
  k.box(m.dressed, -0.7, 0.7, 7.5, 8.9, -0.08, 0); // coat of arms panel
  k.rect(-3.2, -1.0, 0, 0.8, 9.4);
  k.rect(1.0, 3.2, 0, 0.8, 9.4);
}

function seeded(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

function lynchsCastle(k, m, b) {
  // The Lynch family's tower house (c. 1500) on the corner of Shop Street and
  // Abbeygate Street: grey limestone, stone-mullioned windows, carved panels
  // and gargoyles under a crenellated parapet. It's a bank now.
  const H = 12.5;
  const f = footprint(k, b);
  f.extrude(m.grey, 0, H);
  f.extrude(m.dressed, 0, 0.6, 0.08); // plinth
  f.extrude(m.dressed, 4.3, 0.22, 0.1); // string course
  f.extrude(m.dressed, H, 0.35, 0.15); // coping under the battlements
  k.collision.addRing(b.p, H + 3);

  const at = (e, t, out, mat, w, h, d, y) => {
    const [u, v] = e.at(t, out);
    k.add(mat, boxM(w, h, d), u, y, v, e.rot);
  };
  const lights = (e, t, y, w, h, mullion) => {
    at(e, t, 0.04, m.dressed, w + 0.3, h + 0.3, 0.12, y);
    at(e, t, 0.08, m.glass, w, h, 0.1, y);
    if (mullion) at(e, t, 0.12, m.dressed, 0.12, h, 0.06, y);
    at(e, t, 0.12, m.dressed, w + 0.6, 0.14, 0.22, y + h / 2 + 0.25); // hood mould
  };
  for (const e of f.edges) {
    if (e.len < 2.5) continue;
    for (let t = 0.3; t + 0.6 <= e.len - 0.1; t += 1.2) at(e, t + 0.3, -0.1, m.grey, 0.6, 0.85, 0.5, H + 0.35 + 0.42);
    if (e.len < 4) continue;
    const n = Math.max(1, Math.floor(e.len / 3.4)), gap = e.len / n;
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) * gap;
      lights(e, t, 2.2, 1.3, 2.3, false);
      lights(e, t, 6.4, 1.2, 1.5, true);
      lights(e, t, 9.6, 1.2, 1.5, true);
      if (j) at(e, j * gap, 0.06, m.dressed, 0.9, 1.0, 0.14, 8.0); // carved panels between the bays
      if (j % 2 === 0) at(e, t, 0.45, m.dressed, 0.22, 0.22, 0.9, H - 0.2); // gargoyles
    }
  }
}

function hallOfTheRedEarl(k, m, b) {
  // Footings of the de Burgo hall (13th century), dug up in 1997 and kept
  // under a glass-walled shelter you can walk into from Druid Lane.
  const H = 4.4;
  const f = footprint(k, b);
  const door = f.edges.reduce((a, e) => (e.len > a.len ? e : a));
  f.extrude(m.steel, H, 0.3, 0.7);
  f.extrude(m.gravel, 0, 0.05);
  for (const e of f.edges) {
    const runs = e === door ? [[0, e.len / 2 - 1], [e.len / 2 + 1, e.len]] : [[0, e.len]];
    for (const [t0, t1] of runs) {
      if (t1 - t0 < 0.05) continue;
      const [u, v] = e.at((t0 + t1) / 2);
      k.add(m.clear, boxM(t1 - t0, H, 0.06), u, H / 2, v, e.rot);
      k.wall(...e.at(t0), ...e.at(t1), H);
    }
    for (let t = 0; t < e.len; t += 2.4) {
      const [u, v] = e.at(t);
      k.add(m.steel, boxM(0.14, H, 0.14), u, H / 2, v, e.rot);
    }
  }
  const [du, dv] = door.at(door.len / 2);
  k.add(m.steel, boxM(2.2, 0.3, 0.14), du, H - 0.15, dv, door.rot);

  // the excavated walls, ragged and knee to chest high
  const rnd = seeded(1997);
  const cu = f.pts.reduce((a, p) => a + p[0], 0) / f.pts.length;
  const cv = f.pts.reduce((a, p) => a + p[1], 0) / f.pts.length;
  const inner = f.pts.map(([u, v]) => [cu + (u - cu) * 0.72, cv + (v - cv) * 0.72]);
  // the footprint isn't convex, so keep only pieces well inside the glass
  const inside = (u, v) => {
    let c = false;
    for (let i = 0, j = f.pts.length - 1; i < f.pts.length; j = i++) {
      const [ui, vi] = f.pts[i], [uj, vj] = f.pts[j];
      if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) c = !c;
    }
    return c;
  };
  const clear = (u, v) => [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].every(([a, b]) => inside(u + a, v + b));
  for (let i = 0; i < inner.length; i++) {
    const [au, av] = inner[i], [bu, bv] = inner[(i + 1) % inner.length];
    const len = Math.hypot(bu - au, bv - av);
    const n = Math.max(1, Math.round(len / 2.2));
    for (let j = 0; j < n; j++) {
      if (rnd() < 0.18) continue;
      const h = 0.45 + rnd() * 1.0;
      const f0 = j / n, f1 = (j + 1) / n;
      const p0 = [au + (bu - au) * f0, av + (bv - av) * f0], p1 = [au + (bu - au) * f1, av + (bv - av) * f1];
      if (!clear(p0[0], p0[1]) || !clear(p1[0], p1[1])) continue;
      k.add(m.stone, boxM(len / n + 0.3, h, 0.75), (p0[0] + p1[0]) / 2, h / 2, (p0[1] + p1[1]) / 2, Math.atan2(-(bv - av), bu - au));
      k.wall(...p0, ...p1, h);
    }
  }
  // stumps of the pillars that held up the hall's roof
  for (const f2 of [-0.25, 0, 0.25]) {
    const u = cu + (inner[0][0] - cu) * f2 * 2, v = cv + (inner[0][1] - cv) * f2 * 2;
    if (!clear(u, v)) continue;
    k.box(m.stone, u - 0.4, u + 0.4, 0, 0.7, v - 0.4, v + 0.4);
    k.rect(u - 0.4, u + 0.4, v - 0.4, v + 0.4, 0.7);
  }
}

function salmonWeirBridge(k, m, len, w, isWater) {
  // The 1818 stone bridge from the Cathedral over to Newtownsmith, with the
  // weir just upstream where the salmon jump. Frame: u along the deck, v south.
  const half = w / 2;
  const wet = (u, v) => isWater(...k.w(u, v));
  let u0 = null, u1 = null;
  for (let u = 0; u <= len; u += 0.5) if (wet(u, half + 3) || wet(u, -half - 3)) { if (u0 === null) u0 = u; u1 = u; } // the deck itself counts as land

  for (const s of [-1, 1]) {
    const v = s * (half + 0.2);
    k.box(m.stone, -1, len + 1, -1.6, 1.05, v - 0.25, v + 0.25);
    k.box(m.dressed, -1.1, len + 1.1, 1.05, 1.2, v - 0.33, v + 0.33);
    k.wall(-1, s * (half - 0.05), len + 1, s * (half - 0.05), 1.2);
  }
  if (u0 !== null) {
    const n = Math.max(3, Math.round((u1 - u0) / 6.5)), a = (u1 - u0) / n, r = a * 0.42;
    for (let i = 0; i < n; i++) {
      const uc = u0 + a * (i + 0.5);
      for (const s of [-1, 1]) {
        const arch = new THREE.CylinderGeometry(r, r, 0.04, 14, 1, false, Math.PI / 2, Math.PI);
        arch.rotateX(Math.PI / 2);
        k.add(m.shadow, arch, uc, -0.05 - r, s * (half + 0.47));
        k.add(m.dressed, new THREE.TorusGeometry(r + 0.12, 0.13, 4, 14, Math.PI), uc, -0.05 - r, s * (half + 0.47));
      }
    }
    // cutwaters on the piers, upstream and down
    for (let i = 1; i < n; i++) {
      const up = u0 + a * i;
      for (const s of [-1, 1]) {
        k.add(m.stone, boxM(1.3, 2.6, 1.3), up, -0.65, s * (half + 0.45), Math.PI / 4);
        k.add(m.dressed, new THREE.ConeGeometry(0.92, 0.5, 4), up, 0.9, s * (half + 0.45));
      }
    }
  }

  // the weir: a stone sill across the river with white water below it
  const WV = -40, foam = [];
  let run = null;
  const runs = [];
  for (let u = -60; u <= len + 60; u += 1) {
    if (wet(u, WV) && wet(u, WV + 4)) {
      if (!run) runs.push((run = [u, u]));
      else run[1] = u;
    } else run = null;
  }
  for (const [a, c] of runs) {
    if (c - a < 6) continue;
    k.box(m.dressed, a - 0.5, c + 0.5, -1.2, -0.22, WV - 0.7, WV + 0.7);
    k.box(m.foam, a, c, -0.43, -0.37, WV + 0.7, WV + 3.2);
    for (let u = a + 1; u < c; u += 3) foam.push(k.w(u, WV + 2));
  }
  return foam;
}

function divingTower(k, m) {
  // Blackrock's 1950s concrete tower: a walkway out from the Prom, then
  // three flights of steps up to platforms at about 3.4 m, 6.4 m and 8.5 m.
  const C = m.concrete, R = m.rail, DECK = 0.4, RISE = 0.3, RUN = 0.45;
  const slab = (u0, u1, v0, v1, top) => {
    k.box(C, u0, u1, top - 0.4, top, v0, v1);
    k.platform(u0, u1, v0, v1, top);
    k.rect(u0, u1, v0, v1, top, top - 0.4);
  };
  const pillar = (u, v, y0, y1) => {
    k.box(C, u - 0.25, u + 0.25, y0, y1, v - 0.25, v + 0.25);
    k.rect(u - 0.25, u + 0.25, v - 0.25, v + 0.25, y1, y0);
  };
  const flight = (uStart, dir, v0, v1, yStart, n) => {
    for (let i = 0; i < n; i++) {
      const top = yStart + RISE * (i + 1);
      const a = uStart + dir * RUN * i, b = a + dir * RUN;
      const u0 = Math.min(a, b), u1 = Math.max(a, b);
      k.box(C, u0, u1, top - 0.5, top, v0, v1);
      k.platform(u0, u1, v0, v1, top);
      k.rect(u0, u1, v0, v1, top, top - 0.5);
    }
    return uStart + dir * RUN * n;
  };

  // walkway and landing
  slab(0, 14, -1.4, 1.4, DECK);
  for (let u = 2; u <= 12; u += 4) pillar(u, 0, -3, DECK - 0.4);
  slab(14, 16.5, -3.5, 3.5, DECK);
  k.railing(R, [[0.4, DECK, -1.4], [14, DECK, -1.4], [14, DECK, -3.5], [16.5, DECK, -3.5]]);
  k.railing(R, [[0.4, DECK, 1.4], [14, DECK, 1.4], [14, DECK, 3.5], [16.5, DECK, 3.5]]);

  // central column the stairs wind around
  k.box(C, 16.5, 19.5, -3, 8.1, -1.5, 1.5);
  k.rect(16.5, 19.5, -1.5, 1.5, 8.1, -3);

  // flight 1 up the left side to the low board
  flight(16.5, 1, -3.5, -1.5, DECK, 10);
  k.railing(R, [[16.5, DECK, -3.5], [21, DECK + 3, -3.5]]);
  const P1 = DECK + 3;
  slab(21, 23.2, -3.5, 3.5, P1);
  slab(19.5, 21, -1.5, 1.5, P1);
  pillar(22.9, -3.2, -3, P1 - 0.4);
  pillar(22.9, 3.2, -3, P1 - 0.4);
  k.railing(R, [[21, P1, -3.5], [23.2, P1, -3.5]]);
  k.railing(R, [[21, P1, 3.5], [23.2, P1, 3.5]]);

  // flight 2 back along the right side to the middle platform
  flight(21, -1, 1.5, 3.5, P1, 10);
  k.railing(R, [[21, P1, 3.5], [16.5, P1 + 3, 3.5]]);
  const P2 = P1 + 3;
  slab(14.5, 16.5, -3.5, 3.5, P2);
  pillar(14.8, -3.2, DECK, P2 - 0.4);
  pillar(14.8, 3.2, DECK, P2 - 0.4);
  k.railing(R, [[16.5, P2, 3.5], [14.5, P2, 3.5], [14.5, P2, -3.5], [16.5, P2, -3.5]]);

  // flight 3 to the top
  const end = flight(16.5, 1, -3.5, -1.5, P2, 7);
  k.railing(R, [[16.5, P2, -3.5], [end, P2 + 2.1, -3.5]]);
  const TOP = P2 + 2.1;
  slab(19.5, 23.2, -3.5, 1.5, TOP);
  pillar(22.9, -3.2, P1, TOP - 0.4);
  pillar(22.9, 1.2, P1, TOP - 0.4);
  k.railing(R, [[end, TOP, -3.5], [23.2, TOP, -3.5]]);
  k.railing(R, [[19.5, TOP, -1.5], [19.5, TOP, 1.5], [23.2, TOP, 1.5]]);
  k.railing(R, [[23.2, TOP, -3.5], [23.2, TOP, -0.6]]);
  // the board itself
  k.box(m.board, 23.2, 25.6, TOP - 0.15, TOP, -0.5, 0.5);
  k.platform(23.2, 25.6, -0.5, 0.5, TOP);

  // the wall at the end of the Prom, beside the walkway: walk the Prom, kick the wall, walk back
  k.box(m.stone, -1.3, -0.6, 0, 1.15, 1.8, 5.2);
  k.box(m.dressed, -1.36, -0.54, 1.15, 1.3, 1.74, 5.26);
  k.rect(-1.3, -0.6, 1.8, 5.2, 1.3);
  const [wx, wz] = k.w(-0.95, 3.5);
  return { top: TOP, wall: { x: wx, z: wz, nx: -k.dx, nz: -k.dz } };
}

// Point and direction at fraction f of the way along a flat polyline.
function alongPath(p, f) {
  let total = 0;
  for (let i = 0; i < p.length - 2; i += 2) total += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  let want = total * f;
  for (let i = 0; i < p.length - 2; i += 2) {
    const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (want <= len || i === p.length - 4) {
      const t = Math.min(1, want / (len || 1));
      return { x: p[i] + (p[i + 2] - p[i]) * t, z: p[i + 1] + (p[i + 3] - p[i + 1]) * t, dx: (p[i + 2] - p[i]) / len, dz: (p[i + 3] - p[i + 1]) / len };
    }
    want -= len;
  }
}

// A spot `margin` metres out from the water's edge beside a path point, with
// open water `depth` metres beyond the edge, or null.
function offshore(isWater, pt, from, depth, margin = 0) {
  const at = (d, s) => [pt.x - pt.dz * d * s, pt.z + pt.dx * d * s];
  for (const s of [1, -1])
    for (let d = from; d <= from + 20; d += 1) {
      if (isWater(...at(d, s)) && isWater(...at(d + depth, s))) {
        const [x, z] = at(d + margin, s);
        return { x, z };
      }
    }
  return null;
}

// Galway hooker: black tarred hull with a coloured gunwale, one mast well
// forward, a big tan mainsail on a gaff and two headsails out on the bowsprit.
// Built along +x (bow) in its own frame, waterline at y = 0.
function hooker(m, trim) {
  const L = 9.6, N = 12;
  const hb = (s) => 1.45 * Math.sin(Math.PI * (0.3 + 0.7 * s)); // stern s=0 … bow s=1
  const xs = (s) => -L / 2 + L * s;
  const top = (s) => 1.0 + 0.35 * s * s; // sheer rises to the bow
  const bot = (s) => -0.75 + 0.6 * s * s;
  const hull = [], band = [], deck = [];
  const quad = (arr, a, b, c, d) => arr.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < N; i++) {
    const s0 = i / N, s1 = (i + 1) / N;
    for (const side of [1, -1]) {
      const P = (s, y, f) => [xs(s), y, side * hb(s) * f];
      quad(band, P(s0, top(s0) - 0.2, 0.98), P(s1, top(s1) - 0.2, 0.98), P(s1, top(s1), 1), P(s0, top(s0), 1));
      quad(hull, P(s0, bot(s0), 0.2), P(s1, bot(s1), 0.2), P(s1, top(s1) - 0.2, 0.98), P(s0, top(s0) - 0.2, 0.98));
    }
    const Y0 = top(s0) - 0.12, Y1 = top(s1) - 0.12;
    quad(deck, [xs(s0), Y0, -hb(s0)], [xs(s1), Y1, -hb(s1)], [xs(s1), Y1, hb(s1)], [xs(s0), Y0, hb(s0)]);
    quad(hull, [xs(s0), bot(s0), -hb(s0) * 0.2], [xs(s1), bot(s1), -hb(s1) * 0.2], [xs(s1), bot(s1), hb(s1) * 0.2], [xs(s0), bot(s0), hb(s0) * 0.2]);
  }
  quad(hull, [xs(0), bot(0), -hb(0) * 0.2], [xs(0), bot(0), hb(0) * 0.2], [xs(0), top(0), hb(0)], [xs(0), top(0), -hb(0)]); // transom

  const mastX = xs(0.64), D = top(0.64);
  const sails = [
    [mastX, D + 0.9, -L / 2 - 0.8, D + 1.2, -3.4, D + 9.0, mastX, D + 6.6], // main, on the gaff
    [L / 2 + 0.1, D + 0.5, mastX + 0.15, D + 7.4, mastX + 0.6, D + 0.8], // staysail
    [L / 2 + 2.8, D + 0.4, mastX + 0.1, D + 8.8, L / 2 + 0.4, D + 1.4], // jib
  ];
  const sail = [];
  for (const q of sails) {
    const v = (i) => [q[i * 2], q[i * 2 + 1], 0];
    sail.push(...v(0), ...v(1), ...v(2));
    if (q.length === 8) sail.push(...v(0), ...v(2), ...v(3));
  }

  const g = new THREE.Group();
  const mesh = (arr, mat) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    const me = new THREE.Mesh(geo, mat);
    me.castShadow = true;
    g.add(me);
  };
  mesh(hull, m.hull);
  mesh(band, trim);
  mesh(deck, m.deck);
  mesh(sail, m.sail);
  const k = new Kit(null, 0, 0);
  k.add(m.wood, new THREE.CylinderGeometry(0.08, 0.12, 10.2, 6), mastX, D + 5.1, 0);
  k.beam(m.wood, [mastX, D + 0.9, 0], [-L / 2 - 0.8, D + 1.2, 0], 0.12);
  k.beam(m.wood, [mastX, D + 6.6, 0], [-3.4, D + 9.0, 0], 0.1);
  k.beam(m.wood, [L / 2 - 0.4, D - 0.1, 0], [L / 2 + 3, D + 0.3, 0], 0.1);
  k.beam(m.rope, [L / 2 + 2.8, D + 0.4, 0], [mastX, D + 9.6, 0], 0.03);
  k.beam(m.rope, [-L / 2, D, 0], [mastX, D + 9.6, 0], 0.03);
  g.add(k.build());
  return g;
}

function swan(m) {
  // faces +x, floats with its waterline at y = 0
  const k = new Kit(null, 0, 0);
  const egg = (mat, sx, sy, sz, x, y, z) => {
    const g = new THREE.SphereGeometry(1, 10, 7);
    g.scale(sx, sy, sz);
    k.add(mat, g, x, y, z);
  };
  egg(m.feather, 0.5, 0.24, 0.3, 0, 0.1, 0);
  egg(m.feather, 0.36, 0.13, 0.15, -0.08, 0.24, 0.13);
  egg(m.feather, 0.36, 0.13, 0.15, -0.08, 0.24, -0.13);
  egg(m.feather, 0.18, 0.12, 0.14, -0.42, 0.22, 0); // tail
  const neck = new THREE.CatmullRomCurve3([[0.34, 0.15], [0.5, 0.4], [0.42, 0.68], [0.5, 0.82]].map(([x, y]) => new THREE.Vector3(x, y, 0)));
  k.add(m.feather, new THREE.TubeGeometry(neck, 8, 0.05, 5));
  egg(m.feather, 0.1, 0.075, 0.07, 0.55, 0.84, 0);
  const beak = new THREE.ConeGeometry(0.04, 0.17, 5);
  beak.rotateZ(-Math.PI / 2);
  k.add(m.beak, beak, 0.7, 0.82, 0);
  k.box(m.black, 0.6, 0.65, 0.81, 0.88, -0.035, 0.035);
  return k.build();
}

// Moored hookers and a bevy of swans along Claddagh Quay. Returns per-frame motion.
function claddagh(map, collision, isWater, m) {
  const group = new THREE.Group();
  const quay = map.roads.find((r) => r.n === 'Claddagh Quay' && r.p.length > 20);
  if (!quay) return { group, update() {} };
  const boats = [];
  const trims = ['#b23a2e', '#2f6b4f', '#2d5f9a', '#d9a33b'].map((c) => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }));
  // whole hull (and bowsprit) over water
  const afloat = (x, z, h) => {
    const ax = Math.cos(h), az = -Math.sin(h);
    for (const u of [-5.5, -2.5, 0, 2.5, 5, 8])
      for (const v of [-1.8, 0, 1.8]) if (!isWater(x + ax * u + az * v, z + az * u - ax * v)) return false;
    return true;
  };
  [0.62, 0.72, 0.83, 0.9].forEach((f, i) => {
    const pt = alongPath(quay.p, f);
    const heading = Math.atan2(-pt.dz, pt.dx) + (i % 2 ? Math.PI : 0) + (i - 1.5) * 0.08;
    let spot = null;
    for (let margin = 3; margin <= 14 && !spot; margin++) {
      const s2 = offshore(isWater, pt, 5, 8, margin);
      if (s2 && afloat(s2.x, s2.z, heading)) spot = s2;
    }
    if (!spot) return;
    const boat = hooker(m, trims[i]);
    boat.position.set(spot.x, -0.5, spot.z);
    boat.rotation.y = heading;
    group.add(boat);
    boats.push({ mesh: boat, ph: i * 1.7 });
    for (const x of [-3, 0, 3]) collision.addCircle(spot.x + Math.cos(heading) * x, spot.z - Math.sin(heading) * x, 1.4, 1.6);
  });

  const model = swan(m);
  const rnd = seeded(42);
  const swans = [];
  for (let tries = 0; swans.length < 9 && tries < 200; tries++) {
    const pt = alongPath(quay.p, 0.3 + rnd() * 0.25);
    const spot = offshore(isWater, pt, 3 + rnd() * 14, 3);
    if (!spot) continue;
    const mesh = model.clone();
    group.add(mesh);
    swans.push({ mesh, x: spot.x, z: spot.z, h: rnd() * 6.28, want: rnd() * 6.28, turnT: rnd() * 4, ph: rnd() * 6 });
  }

  const update = (dt, t, player) => {
    for (const b of boats) {
      b.mesh.position.y = -0.5 + Math.sin(t * 1.1 + b.ph) * 0.05;
      b.mesh.rotation.x = Math.sin(t * 0.8 + b.ph) * 0.035;
    }
    for (const s of swans) {
      // wander, and drift over to anyone standing at the water's edge (they expect bread)
      const dx = player.x - s.x, dz = player.z - s.z, d = Math.hypot(dx, dz);
      const curious = d < 18 && d > 3;
      if ((s.turnT -= dt) < 0) {
        s.turnT = 3 + rnd() * 5;
        s.want = s.h + (rnd() - 0.5) * 2;
      }
      if (curious) s.want = Math.atan2(dx, dz);
      let dh = Math.atan2(Math.sin(s.want - s.h), Math.cos(s.want - s.h));
      s.h += Math.sign(dh) * Math.min(Math.abs(dh), dt * 0.9);
      const sp = (curious ? 0.6 : 0.25) * dt;
      const nx = s.x + Math.sin(s.h) * sp, nz = s.z + Math.cos(s.h) * sp;
      if (isWater(nx + Math.sin(s.h) * 1.2, nz + Math.cos(s.h) * 1.2)) { s.x = nx; s.z = nz; }
      else s.want = s.h + Math.PI;
      s.mesh.position.set(s.x, -0.45 + Math.sin(t * 1.4 + s.ph) * 0.02, s.z);
      s.mesh.rotation.y = s.h - Math.PI / 2;
    }
  };
  return { group, update };
}

// The terrace along the Long Walk is painted every colour going.
export function paintLongWalk(map) {
  const COLS = ['#d8423b', '#f2c84b', '#3d7cc9', '#ee9cbb', '#5fae6b', '#f4efe2', '#e27a3c', '#82c4d8', '#b84c7d', '#f5da8f'];
  const segs = [];
  for (const r of map.roads) {
    if (r.n !== 'The Long Walk') continue;
    for (let i = 0; i < r.p.length - 2; i += 2) segs.push(r.p.slice(i, i + 4));
  }
  if (!segs.length) return;
  const near = [];
  for (const b of map.buildings) {
    let cx = 0, cz = 0;
    const n = b.p.length / 2;
    for (let i = 0; i < b.p.length; i += 2) { cx += b.p[i]; cz += b.p[i + 1]; }
    cx /= n; cz /= n;
    if (cx < -340 || cx > -20 || cz < 520 || cz > 720 || b.h > 16) continue;
    for (const [ax, az, bx, bz] of segs) {
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(cx - ax - dx * t, cz - az - dz * t) < 20) { near.push([cx - cz, b]); break; }
    }
  }
  near.sort((a, b) => a[0] - b[0]).forEach(([, b], i) => (b.c = COLS[i % COLS.length]));
}

function signTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 144;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg;
  g.font = 'bold 104px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function leisureland(k, m, b) {
  // Salthill's swimming pool: a big lit sign on the roof, facing the Prom.
  const f = footprint(k, b);
  const e = f.edges.filter((e) => e.len > 12).reduce((a, e) => (e.nv > a.nv ? e : a));
  const w = Math.min(e.len - 2, 18), h = w / 7;
  const [u, v] = e.at(e.len / 2, -0.6);
  k.add(m.steel, boxM(w + 0.3, h + 0.3, 0.2), u, b.h + 0.6 + h / 2, v, e.rot);
  for (const t of [-w / 3, w / 3]) {
    const [lu, lv] = e.at(e.len / 2 + t, -0.8);
    k.add(m.steel, boxM(0.15, 0.7, 0.4), lu, b.h + 0.3, lv, e.rot);
  }
  const face = new THREE.PlaneGeometry(w, h);
  face.rotateY(e.face);
  const [fu, fv] = e.at(e.len / 2, -0.48);
  k.add(m.sign, face, fu, b.h + 0.6 + h / 2, fv);
}

// Railings on a low sea wall along the seaward edge of the Prom footway,
// with a gap every 70 m for steps down to the beach.
function promRailings(map, collision, isWater, m) {
  const k = new Kit(collision, 0, 0);
  for (const r of map.roads) {
    if (r.n !== 'Salthill Promenade') continue;
    const off = r.w / 2 + 0.25;
    let acc = 0;
    for (let i = 0; i < r.p.length - 2; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len, nx = -dz, nz = dx;
      // the sea is on whichever side reaches water first
      let side = 0, best = Infinity;
      for (const s of [1, -1])
        for (let d = 3; d <= 60; d += 3) {
          if (isWater((ax + bx) / 2 + nx * d * s, (az + bz) / 2 + nz * d * s)) {
            if (d < best) { best = d; side = s; }
            break;
          }
        }
      if (side) {
        const n = Math.max(1, Math.round(len / 2.2));
        for (let j = 0; j < n; j++) {
          if ((acc + (j / n) * len) % 70 < 3) continue;
          const f0 = j / n, f1 = (j + 1) / n;
          const p0 = [ax + dx * len * f0 + nx * off * side, az + dz * len * f0 + nz * off * side];
          const p1 = [ax + dx * len * f1 + nx * off * side, az + dz * len * f1 + nz * off * side];
          k.beam(m.concrete, [p0[0], 0.22, p0[1]], [p1[0], 0.22, p1[1]], 0.4, 0.44);
          k.box(m.rail, p0[0] - 0.04, p0[0] + 0.04, 0.44, 1.15, p0[1] - 0.04, p0[1] + 0.04);
          k.beam(m.rail, [p0[0], 1.12, p0[1]], [p1[0], 1.12, p1[1]], 0.07);
          k.beam(m.rail, [p0[0], 0.78, p0[1]], [p1[0], 0.78, p1[1]], 0.045);
          collision.addSegment(p0[0], p0[1], p1[0], p1[1], 1.15);
        }
      }
      acc += len;
    }
  }
  return k.build();
}

// Builds every landmark. Call addWater(flatPolygon) on the ground for each of
// the returned `water` polygons before anything else queries the sea mask.
export function buildLandmarks(map, collision, isWater) {
  const stoneMap = stoneTexture();
  const lam = (opts) => new THREE.MeshLambertMaterial(opts);
  const m = {
    stone: lam({ map: stoneMap, color: '#d6cfbf' }),
    dressed: lam({ color: '#a9a294' }),
    copper: lam({ color: '#5f9c86', flatShading: true }),
    gold: lam({ color: '#c9a54c', emissive: '#3a2a08' }),
    glass: lam({ color: '#2b3038' }),
    rust: lam({ color: '#80401f', side: THREE.DoubleSide }),
    pool: new THREE.MeshPhongMaterial({ color: '#3f8197', shininess: 90, specular: '#cfe8ff' }),
    spray: lam({ color: '#e8f4f8', transparent: true, opacity: 0.45, depthWrite: false }),
    concrete: lam({ color: '#d4d0c6' }),
    board: lam({ color: '#3f7fa8' }),
    rail: lam({ color: '#93a2aa' }),
    grey: lam({ map: stoneMap, color: '#b2afa7' }),
    steel: lam({ color: '#3b4046' }),
    gravel: lam({ color: '#8c857a' }),
    clear: lam({ color: '#bcd8e2', transparent: true, opacity: 0.22, depthWrite: false }),
    shadow: lam({ color: '#1c2125' }),
    foam: lam({ color: '#f4fbff', transparent: true, opacity: 0.8, depthWrite: false }),
    hull: lam({ color: '#1c1c1e', side: THREE.DoubleSide }),
    deck: lam({ color: '#8a6a45', side: THREE.DoubleSide }),
    sail: lam({ color: '#5e2f1e', side: THREE.DoubleSide }),
    wood: lam({ color: '#6b4f32' }),
    rope: lam({ color: '#c8b98f' }),
    feather: lam({ color: '#f6f4ee' }),
    beak: lam({ color: '#e57a2a' }),
    black: lam({ color: '#141414' }),
    sign: new THREE.MeshBasicMaterial({ map: signTexture('LEISURELAND', '#1d5fae', '#ffffff') }),
  };

  const group = new THREE.Group();
  const place = (fn, ox, oz, dx, dz) => {
    const k = new Kit(collision, ox, oz, dx, dz);
    const out = fn(k, m);
    group.add(k.build());
    return out;
  };

  // Positions from OpenStreetMap (local metres, origin Eyre Square).
  place(spanishArch, -316.3, 506.2, -22.5, 27.5);
  const cat = map.buildings.find((b) => b.n === 'Galway Cathedral');
  if (cat) place((k, mm) => cathedral(k, mm, cat), -572.5, -73.0, 1, 0);
  place(quincentennialFountain, -26.7, -22.5, 1, 0.2);
  place(browneDoorway, -45.5, -26.8, -4.3, 18.8);
  const byName = (n) => map.buildings.filter((b) => b.n === n);
  for (const b of byName("Lynch's Castle")) place((k, mm) => lynchsCastle(k, mm, b), b.p[0], b.p[1], 1, 0);
  for (const b of byName('Hall of the Red Earl')) place((k, mm) => hallOfTheRedEarl(k, mm, b), b.p[0], b.p[1], 1, 0);
  const pool = byName('Leisureland').sort((a, b) => b.p.length - a.p.length)[0];
  if (pool) place((k, mm) => leisureland(k, mm, pool), pool.p[0], pool.p[1], 1, 0);

  // Salmon Weir Bridge is the University Road bridge beside the Cathedral
  let foam = [];
  const swb = map.roads.find((r) => r.b && r.n === 'University Road' && Math.hypot(r.p[0] + 499.5, r.p[1] + 105) < 5);
  if (swb) {
    const [ax, az] = swb.p, [bx, bz] = swb.p.slice(-2);
    foam = place((k, mm) => salmonWeirBridge(k, mm, Math.hypot(bx - ax, bz - az), swb.w, isWater), ax, az, bx - ax, bz - az);
  }

  const cl = claddagh(map, collision, isWater, m);
  group.add(cl.group);
  const tower = place(divingTower, -2885.75, 2009.4, 10.55, 15.5);
  // the tower stands in the sea at high tide
  const tk = new Kit(collision, -2885.75, 2009.4, 10.55, 15.5);
  const water = [[...tk.w(17, -10), ...tk.w(40, -10), ...tk.w(40, 10), ...tk.w(17, 10)]];

  group.add(promRailings(map, collision, isWater, m));

  // a salmon leaping at the weir every few seconds
  const salmon = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6).scale(0.34, 0.1, 0.08), lam({ color: '#a7b1b6' }));
  salmon.visible = false;
  group.add(salmon);
  let leapT = 2, leap = null;
  const P = { x: 0, z: 0 };
  const update = (dt, t, player) => {
    cl.update(dt, t, player || P);
    m.foam.opacity = 0.72 + Math.sin(t * 7) * 0.08;
    if (!foam.length) return;
    if (!leap && (leapT -= dt) < 0) {
      const [x, z] = foam[Math.floor(Math.random() * foam.length)];
      leap = { x, z, t: 0, a: Math.random() * 6.28 };
    }
    if (leap) {
      leap.t += dt / 0.8;
      const f = leap.t, up = Math.cos(leap.a), side = Math.sin(leap.a);
      salmon.visible = f < 1;
      salmon.position.set(leap.x - up * f * 1.2, -0.45 + Math.sin(f * Math.PI) * 1.3, leap.z - side * f * 1.2);
      salmon.rotation.set(0, Math.atan2(side, -up) + Math.PI / 2, Math.cos(f * Math.PI) * 0.9);
      if (f >= 1) { leap = null; leapT = 2 + Math.random() * 4; }
    }
  };

  return { group, kickWall: tower.wall, towerTop: tower.top, water, update };
}

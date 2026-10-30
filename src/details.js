// Street details in the Latin Quarter and around town: buskers with an open
// guitar case and a few people listening, bunting strung across the
// pedestrian streets, tables and parasols outside the cafés and pubs, and a
// front door for every shop with a sign.
import * as THREE from 'three';
import { makeCharacter } from './player.js';
import { Kit, boxM } from './landmarks.js';

const TOWN = [-280, 280];
const CAFE_KINDS = new Set(['cafe', 'restaurant', 'pub', 'bar', 'ice_cream', 'fast_food']);
const FLAG_COLOURS = ['#d8423b', '#f2c84b', '#3d7cc9', '#5fae6b', '#f4efe2', '#e27a3c'].map((c) => new THREE.Color(c));
const PARASOLS = ['#7a1f2b', '#1f3d2b', '#f4efe2', '#2d5f9a', '#c4473a'];
const pick = (a, i) => a[i % a.length];

// point and direction at fraction f along a polyline
function along(p, f) {
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

function guitar(m) {
  const k = new Kit(null, 0, 0);
  k.add(m.wood, boxM(0.36, 0.44, 0.1), 0, 0, 0);
  k.add(m.dark, new THREE.CylinderGeometry(0.06, 0.06, 0.11, 10).rotateX(Math.PI / 2), 0, 0.06, 0);
  k.add(m.dark, boxM(0.06, 0.62, 0.05), 0, 0.52, 0);
  return k.build();
}

export class Details {
  constructor(scene, map, collision, fronts) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
    const m = {
      wood: lam('#9a5a2a'), dark: lam('#2a1d14'), velvet: lam('#7a1f2b'), metal: lam('#4a4f55'),
      table: lam('#e8e2d2'), chair: lam('#3a3a3a'), string: lam('#222222'),
      glassDoor: lam('#2b3540'), brass: lam('#c9a54c', { emissive: '#2a1c04' }),
      flags: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    };
    const peds = map.roads.filter((r) => r.k === 'pedestrian' && r.n && Math.hypot(r.p[0] - TOWN[0], r.p[1] - TOWN[1]) < 520);

    // --- buskers: Shop Street, Quay Street and High Street ---
    this.buskers = [];
    const spots = [['Shop Street', 0.45, 1], ['Quay Street', 0.35, -1], ['High Street', 0.5, 1]];
    spots.forEach(([name, f, side], i) => {
      const road = peds.filter((r) => r.n === name).sort((a, b) => b.p.length - a.p.length)[0];
      if (!road) return;
      const p = along(road.p, f);
      const nx = -p.dz * side, nz = p.dx * side; // towards the side they stand on
      const x = p.x + nx * 2.2, z = p.z + nz * 2.2, face = Math.atan2(-nx, -nz); // facing across the street
      const char = makeCharacter({ shirt: pick(['#2f3f5f', '#5a1a1f', '#3f6b3a'], i), pants: '#2b2b2b', hair: pick(['#7a5230', '#1b1612', '#c9a15a'], i) });
      char.root.position.set(x, 0, z);
      char.root.rotation.y = face;
      const g = guitar(m);
      g.position.set(0.05, 1.18, 0.22);
      g.rotation.set(0.15, 0, 1.0);
      char.body.add(g);
      this.group.add(char.root);
      // open guitar case on the ground in front, a few coins in it
      const ck = new Kit(null, x + Math.sin(face) * 1.1, z + Math.cos(face) * 1.1, Math.cos(face), -Math.sin(face));
      ck.box(m.dark, -0.55, 0.55, 0, 0.1, -0.2, 0.2);
      ck.box(m.velvet, -0.5, 0.5, 0.1, 0.11, -0.16, 0.16);
      for (let c = 0; c < 6; c++) ck.add(m.table, new THREE.CylinderGeometry(0.03, 0.03, 0.01, 8), -0.35 + c * 0.13, 0.12, ((c * 37) % 9) / 40 - 0.1);
      this.group.add(ck.build());
      // a few people stopped to listen
      const crowd = [];
      for (let j = 0; j < 3; j++) {
        const a = face + (j - 1) * 0.55, d = 3 + (j % 2) * 0.8;
        const lx = x + Math.sin(a) * d, lz = z + Math.cos(a) * d;
        const l = makeCharacter({ shirt: pick(['#c4473a', '#e8e2d2', '#2d5f9a', '#d9a33b', '#6b3d8f', '#1d1d1f'], i * 3 + j), pants: pick(['#2d3a52', '#4a4a4a', '#5b4a3a'], j), hair: pick(['#3a2a1e', '#9a3a1e', '#d8d2c8'], i + j), skin: pick(['#e2b59a', '#c99579', '#f0c8b0'], i + j) });
        l.root.position.set(lx, 0, lz);
        l.root.rotation.y = Math.atan2(x - lx, z - lz);
        this.group.add(l.root);
        crowd.push(l);
        collision.addCircle(lx, lz, 0.3, 1.8);
      }
      collision.addCircle(x, z, 0.35, 1.8);
      this.buskers.push({ x, z, char, crowd, phase: i * 2 });
    });

    // --- bunting across the pedestrian streets, wall to wall ---
    const pos = [], col = [];
    const k = new Kit(collision, 0, 0);
    let flagI = 0;
    for (const r of peds) {
      let acc = 7;
      for (let i = 0; i < r.p.length - 2; i += 2) {
        const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3];
        const len = Math.hypot(bx - ax, bz - az);
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        for (; acc < len; acc += 13) {
          const cx = ax + dx * acc, cz = az + dz * acc, y = 6.4;
          const ends = [1, -1].map((s) => {
            const ex = cx - dz * s * 10, ez = cz + dx * s * 10;
            const f = collision.rayFraction(cx, y, cz, ex, y, ez);
            return f < 1 ? [cx + (ex - cx) * (f - 0.012), cz + (ez - cz) * (f - 0.012)] : null;
          });
          if (!ends[0] || !ends[1]) continue;
          const [[x0, z0], [x1, z1]] = ends;
          const span = Math.hypot(x1 - x0, z1 - z0);
          if (span < 3 || span > 18) continue;
          const sag = (t) => y - Math.sin(t * Math.PI) * Math.min(0.9, span * 0.06);
          const N = Math.max(4, Math.round(span / 0.45));
          for (let j = 0; j < N; j++) {
            const t0 = j / N, t1 = (j + 1) / N;
            const p0 = [x0 + (x1 - x0) * t0, sag(t0), z0 + (z1 - z0) * t0], p1 = [x0 + (x1 - x0) * t1, sag(t1), z0 + (z1 - z0) * t1];
            k.beam(m.string, p0, p1, 0.02);
            // a pennant hanging from this stretch of string
            const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - 0.36, (p0[2] + p1[2]) / 2];
            const lift = [p0[0] + (p1[0] - p0[0]) * 0.1, p0[1], p0[2] + (p1[2] - p0[2]) * 0.1];
            const lift2 = [p0[0] + (p1[0] - p0[0]) * 0.9, p1[1], p0[2] + (p1[2] - p0[2]) * 0.9];
            pos.push(...lift, ...lift2, ...mid);
            const c = FLAG_COLOURS[flagI++ % FLAG_COLOURS.length];
            for (let v = 0; v < 3; v++) col.push(c.r, c.g, c.b);
          }
        }
        acc -= len;
      }
    }
    if (pos.length) {
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      fg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      fg.computeVertexNormals();
      this.flags = new THREE.Mesh(fg, m.flags);
      this.group.add(this.flags);
    }

    // --- tables and parasols outside cafés and pubs on pedestrian streets ---
    const nearPed = (x, z) => peds.some((r) => {
      for (let i = 0; i < r.p.length - 2; i += 2) {
        const ax = r.p[i], az = r.p[i + 1], vx = r.p[i + 2] - ax, vz = r.p[i + 3] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
        if (Math.hypot(x - ax - vx * t, z - az - vz * t) < 5) return true;
      }
      return false;
    });
    let tables = 0;
    fronts.forEach((f, i) => {
      if (!CAFE_KINDS.has(f.kind)) return;
      const ox = f.x + f.nx * 1.5, oz = f.z + f.nz * 1.5;
      if (!nearPed(ox, oz)) return;
      const tx = -f.nz, tz = f.nx; // along the shopfront
      const n = f.w > 3.5 ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const s = n === 1 ? 0 : (j - 0.5) * 2.2;
        const x = ox + tx * s, z = oz + tz * s;
        k.add(m.table, new THREE.CylinderGeometry(0.4, 0.4, 0.04, 12), x, 0.74, z);
        k.add(m.metal, new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6), x, 0.37, z);
        k.add(m.metal, new THREE.CylinderGeometry(0.22, 0.22, 0.03, 10), x, 0.02, z);
        for (const side of [-1, 1]) {
          const cx = x + tx * side * 0.7, cz = z + tz * side * 0.7, rot = Math.atan2(-tz * side, tx * side);
          k.add(m.chair, boxM(0.42, 0.05, 0.42), cx, 0.45, cz, rot);
          const bx = cx + tx * side * 0.2, bz = cz + tz * side * 0.2;
          k.add(m.chair, boxM(0.05, 0.45, 0.42), bx, 0.7, bz, rot);
          for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) k.add(m.chair, boxM(0.03, 0.45, 0.03), cx + lx, 0.22, cz + lz);
        }
        if ((i + j) % 2 === 0) {
          const pm = m['p' + ((i + j) % PARASOLS.length)] || (m['p' + ((i + j) % PARASOLS.length)] = lam(PARASOLS[(i + j) % PARASOLS.length], { side: THREE.DoubleSide }));
          k.add(m.metal, new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6), x, 1.55, z);
          k.add(pm, new THREE.ConeGeometry(1.25, 0.45, 8, 1, true), x, 2.45, z);
        }
        collision.addCircle(x, z, 0.5, 1);
        tables++;
      }
    });
    // a front door for every shop and pub with a sign, at one end of the frontage
    const DOORS = ['#1f3d2b', '#7a1f2b', '#1c2a4a', '#151515', '#6b4f32', '#2b4a5a', '#c4473a'];
    fronts.forEach((f, i) => {
      if (f.w < 1.6) return;
      const tx = -f.nz, tz = f.nx, s = (i % 2 ? 1 : -1) * Math.max(0, f.w / 2 - 0.65);
      const x = f.x + tx * s, z = f.z + tz * s, rot = Math.atan2(-tz, tx);
      const dm = m['d' + (i % DOORS.length)] || (m['d' + (i % DOORS.length)] = lam(DOORS[i % DOORS.length]));
      k.add(m.table, boxM(1.2, 2.4, 0.06), x + f.nx * 0.03, 1.2, z + f.nz * 0.03, rot); // painted surround
      k.add(dm, boxM(1.0, 2.2, 0.08), x + f.nx * 0.06, 1.1, z + f.nz * 0.06, rot);
      k.add(m.glassDoor, boxM(0.62, 0.8, 0.04), x + f.nx * 0.11, 1.6, z + f.nz * 0.11, rot);
      k.add(m.brass, boxM(0.05, 0.16, 0.05), x + f.nx * 0.12 + tx * 0.36, 1.05, z + f.nz * 0.12 + tz * 0.36);
    });

    this.group.add(k.build());
    this.counts = { buskers: this.buskers.length, flags: pos.length / 9, tables, doors: fronts.length };
  }

  // strumming, and the listeners shifting their weight
  update(dt, t, player) {
    for (const b of this.buskers) {
      if (Math.hypot(b.x - player.pos.x, b.z - player.pos.z) > 150) continue;
      const c = b.char;
      c.arms[0].rotation.x = -0.9 + Math.sin(t * 9 + b.phase) * 0.25; // strumming hand
      c.arms[0].rotation.z = 0.45;
      c.arms[1].rotation.x = -1.1; // fretting hand out along the neck
      c.arms[1].rotation.z = -0.55;
      c.body.position.y = Math.abs(Math.sin(t * 2.3 + b.phase)) * 0.03;
      c.head.rotation.x = Math.sin(t * 2.3 + b.phase) * 0.08;
      b.crowd.forEach((l, j) => {
        l.body.rotation.z = Math.sin(t * 0.8 + j * 1.7) * 0.03;
        l.head.rotation.x = Math.sin(t * 2.3 + j) * 0.05;
      });
    }
    if (this.flags) this.flags.position.y = Math.sin(t * 1.3) * 0.02;
  }

  nearestBusker(x, z) {
    let d = Infinity;
    for (const b of this.buskers) d = Math.min(d, Math.hypot(b.x - x, b.z - z));
    return d;
  }
}

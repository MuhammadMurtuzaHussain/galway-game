// Life on the streets: pedestrians on the pavements, cars and buses on the
// roads (driving on the left), and seagulls overhead. A fixed cast follows
// the player around: anyone who ends up far behind is moved to a street ahead.
// Each body part type is one InstancedMesh, so the whole crowd is a few draw calls.
import * as THREE from 'three';

const WALK_KINDS = new Set(['pedestrian', 'footway', 'living_street', 'residential', 'tertiary', 'secondary', 'primary', 'unclassified', 'path']);
const DRIVE_KINDS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk', 'secondary_link', 'living_street']);
const MAIN_ROADS = new Set(['primary', 'secondary', 'tertiary', 'trunk']);

const SHIRTS = ['#7a1f2b', '#2d5f9a', '#2f7a3f', '#d9a33b', '#1d1d1f', '#c4473a', '#6b3d8f', '#e8e2d2', '#4a6b8a', '#8a6a45', '#c96f9a', '#3f8197'];
const PANTS = ['#2d3a52', '#1d1d1f', '#4a4a4a', '#5b4a3a', '#2f3f5f', '#6b6b70'];
const SKINS = ['#e2b59a', '#f0c8b0', '#c99579', '#8d5a3e', '#f3d2bd', '#b07a5a'];
const HAIRS = ['#3a2a1e', '#1b1612', '#7a5230', '#c9a15a', '#9a3a1e', '#d8d2c8'];
const CARS = ['#c4473a', '#2d5f9a', '#e8e2d2', '#1d1d1f', '#8a8f96', '#2f7a3f', '#d9a33b', '#5a1a1f', '#f4f4ef', '#4a6b8a'];

const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _r = new THREE.Matrix4(), _c = new THREE.Color();
const _s = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion();
const pick = (a) => a[(Math.random() * a.length) | 0];
const TOWN = [-280, 280];
// how lively a street is: pedestrian streets and the town centre fill up first
const busy = (r, c) => {
  const x = r.p[c.v * 2], z = r.p[c.v * 2 + 1];
  const town = Math.hypot(x - TOWN[0], z - TOWN[1]) < 450 || r.n === 'Salthill Promenade' ? 2.5 : 1;
  return (r.k === 'pedestrian' ? 4 : r.k === 'footway' ? 1.4 : r.k === 'residential' ? 0.7 : 1) * town;
};

// Every vertex of every usable way, so agents can turn at any junction.
class Network {
  constructor(roads, kinds) {
    this.roads = roads.filter((r) => kinds.has(r.k) && r.p.length >= 4);
    this.at = new Map(); // "x,z" -> [[road, vertex], ...]
    this.cells = new Map(); // coarse grid of [road, vertex] for spawning
    this.roads.forEach((r, ri) => {
      for (let v = 0; v < r.p.length / 2; v++) {
        const key = r.p[v * 2] + ',' + r.p[v * 2 + 1];
        if (!this.at.has(key)) this.at.set(key, []);
        this.at.get(key).push([ri, v]);
        const ck = Math.floor(r.p[v * 2] / 60) + ',' + Math.floor(r.p[v * 2 + 1] / 60);
        if (!this.cells.has(ck)) this.cells.set(ck, []);
        this.cells.get(ck).push([ri, v]);
      }
    });
  }

  // a random vertex between rMin and rMax metres from (x, z); with `score`,
  // the best of a few candidates (busy streets first)
  spawnNear(x, z, rMin, rMax, tries = 30, score = null) {
    if (score) {
      let best = null, bs = -1;
      for (let k = 0; k < 6; k++) {
        const c = this.spawnNear(x, z, rMin, rMax, tries);
        if (!c) continue;
        const sc = score(this.roads[c.ri], c) * (0.6 + Math.random() * 0.8);
        if (sc > bs) { bs = sc; best = c; }
      }
      return best;
    }
    for (let t = 0; t < tries; t++) {
      const a = Math.random() * Math.PI * 2, d = rMin + Math.random() * (rMax - rMin);
      const list = this.cells.get(Math.floor((x + Math.cos(a) * d) / 60) + ',' + Math.floor((z + Math.sin(a) * d) / 60));
      if (!list) continue;
      const [ri, v] = list[(Math.random() * list.length) | 0];
      const r = this.roads[ri], px = r.p[v * 2], pz = r.p[v * 2 + 1];
      const dd = Math.hypot(px - x, pz - z);
      if (dd >= rMin && dd <= rMax) return { ri, v };
    }
    return null;
  }

  // where to go from vertex v of road ri, arriving with direction dir
  next(ri, v, dir, turnChance) {
    const r = this.roads[ri], n = r.p.length / 2;
    const atEnd = dir > 0 ? v >= n - 1 : v <= 0;
    const options = [];
    for (const [rj, vj] of this.at.get(r.p[v * 2] + ',' + r.p[v * 2 + 1]) || []) {
      if (rj === ri) continue;
      const m = this.roads[rj].p.length / 2;
      if (vj < m - 1) options.push([rj, vj, 1]);
      if (vj > 0) options.push([rj, vj, -1]);
    }
    if (options.length && (atEnd || Math.random() < turnChance)) return pick(options);
    if (!atEnd) return [ri, v, dir];
    return [ri, v, -dir]; // dead end: turn round
  }
}

// Walks or drives along the network; keeps a lateral offset (pavement or lane).
class Mover {
  place(net, ri, v, dir) {
    const r = net.roads[ri], n = r.p.length / 2;
    if (dir > 0 && v >= n - 1) dir = -1;
    if (dir < 0 && v <= 0) dir = 1;
    Object.assign(this, { ri, v, dir, s: 0 });
    this.update(net, 0);
    this.x = this.tx; this.z = this.tz; this.h = this.th;
  }

  update(net, dist, turnChance = 0.3) {
    let r = net.roads[this.ri];
    let ax, az, bx, bz, len;
    for (let guard = 0; guard < 20; guard++) {
      ax = r.p[this.v * 2]; az = r.p[this.v * 2 + 1];
      bx = r.p[(this.v + this.dir) * 2]; bz = r.p[(this.v + this.dir) * 2 + 1];
      len = Math.hypot(bx - ax, bz - az) || 0.01;
      if (this.s + dist < len) break;
      dist -= len - this.s;
      this.s = 0;
      const [ri, v, dir] = net.next(this.ri, this.v + this.dir, this.dir, turnChance);
      Object.assign(this, { ri, v, dir });
      r = net.roads[ri];
    }
    this.s += dist;
    const dx = (bx - ax) / len, dz = (bz - az) / len, f = this.s / len;
    const off = this.offset(r);
    // offset to the left of the direction of travel (Irish roads: drive on the left)
    this.tx = ax + (bx - ax) * f + dz * off;
    this.tz = az + (bz - az) * f - dx * off;
    this.th = Math.atan2(dx, dz);
    this.road = r;
  }

  follow(dt, rate = 8) {
    const k = Math.min(1, dt * rate);
    this.x += (this.tx - this.x) * k;
    this.z += (this.tz - this.z) * k;
    const d = Math.atan2(Math.sin(this.th - this.h), Math.cos(this.th - this.h));
    this.h += d * Math.min(1, dt * 6);
  }
}

class Walker extends Mover {
  offset(r) {
    if (r.k === 'pedestrian') return this.lane * 2.2;
    if (r.k === 'footway' || r.k === 'path') return this.lane * 0.5;
    return r.w / 2 + 1.4; // the pavement on their left
  }
}

class Driver extends Mover {
  offset(r) {
    return Math.max(1.3, r.w / 4);
  }
}

function instanced(geo, count, color) {
  const mat = new THREE.MeshLambertMaterial({ color: color || '#ffffff' });
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false; // instances move; the default bounds would go stale
  m.castShadow = true;
  if (!color) for (let i = 0; i < count; i++) m.setColorAt(i, _c.set('#ffffff'));
  return m;
}

// geometry whose origin is the joint it swings from
const part = (w, h, d, ox = 0, oy = 0, oz = 0) => new THREE.BoxGeometry(w, h, d).translate(ox, oy, oz);

export class Life {
  constructor(scene, map, collision, isWater, { people = 110, cars = 34, buses = 5, gulls = 22 } = {}) {
    this.collision = collision;
    this.isWater = isWater;
    this.walkNet = new Network(map.roads, WALK_KINDS);
    this.driveNet = new Network(map.roads, DRIVE_KINDS);
    this.group = new THREE.Group();
    scene.add(this.group);

    // --- people ---
    const P = people;
    this.body = {
      torso: instanced(part(0.5, 0.62, 0.28), P),
      legs: instanced(part(0.19, 0.9, 0.21, 0, -0.45), P * 2),
      arms: instanced(part(0.15, 0.62, 0.17, 0, -0.29), P * 2),
      head: instanced(part(0.27, 0.3, 0.28), P),
      hair: instanced(part(0.29, 0.12, 0.3), P),
    };
    for (const m of Object.values(this.body)) this.group.add(m);
    this.people = [];
    for (let i = 0; i < P; i++) {
      const w = new Walker();
      w.lane = Math.random() < 0.5 ? -1 : 1;
      w.speed = 1.1 + Math.random() * 0.6;
      w.phase = Math.random() * 6;
      w.placed = false;
      const shirt = pick(SHIRTS), pants = pick(PANTS), skin = pick(SKINS), hair = pick(HAIRS);
      this.body.torso.setColorAt(i, _c.set(shirt));
      this.body.head.setColorAt(i, _c.set(skin));
      this.body.hair.setColorAt(i, _c.set(hair));
      for (const k of [0, 1]) {
        this.body.legs.setColorAt(i * 2 + k, _c.set(pants));
        this.body.arms.setColorAt(i * 2 + k, _c.set(shirt));
      }
      this.people.push(w);
    }

    // --- cars and buses: body, glasshouse, wheels ---
    const V = cars + buses;
    this.car = {
      body: instanced(part(1, 1, 1), V),
      glass: instanced(part(1, 1, 1), V, '#26303a'),
      wheels: instanced(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10).rotateZ(Math.PI / 2), V * 4, '#161616'),
    };
    for (const m of Object.values(this.car)) this.group.add(m);
    this.vehicles = [];
    for (let i = 0; i < V; i++) {
      const d = new Driver();
      d.bus = i >= cars;
      d.len = d.bus ? 11.5 : 4.1;
      d.wid = d.bus ? 2.5 : 1.8;
      d.cruise = d.bus ? 7.5 : 8 + Math.random() * 4;
      d.spd = 0;
      d.placed = false;
      this.car.body.setColorAt(i, _c.set(d.bus ? '#efe7d4' : pick(CARS)));
      d.circles = d.bus ? [-4.2, -1.4, 1.4, 4.2] : [-1.1, 1.1];
      this.vehicles.push(d);
    }
    collision.dynamic = [];

    // --- seagulls ---
    const G = gulls;
    this.gullMesh = {
      body: instanced(part(0.16, 0.15, 0.5), G, '#f4f4f0'),
      wings: instanced(part(0.62, 0.03, 0.22, 0.31), G * 2, '#9aa3ab'),
    };
    for (const m of Object.values(this.gullMesh)) this.group.add(m);
    this.gulls = Array.from({ length: G }, () => ({ placed: false }));

    for (const set of [this.body, this.car, this.gullMesh])
      for (const m of Object.values(set)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  // nearest pub, gull and vehicle distances, for the sound mix
  nearest(x, z) {
    let gull = Infinity, car = Infinity;
    for (const g of this.gulls) if (g.placed) gull = Math.min(gull, Math.hypot(g.x - x, g.z - z) + Math.abs(g.y) * 0.5);
    for (const d of this.vehicles) if (d.placed) car = Math.min(car, Math.hypot(d.x - x, d.z - z));
    return { gull, car };
  }

  update(dt, t, player) {
    const px = player.pos.x, pz = player.pos.z;
    // after fast travel, fill the new place straight away
    if (this.last && Math.hypot(px - this.last[0], pz - this.last[1]) > 60) {
      for (const set of [this.people, this.vehicles, this.gulls]) for (const a of set) a.placed = false;
    }
    this.last = [px, pz];
    this.updatePeople(dt, t, px, pz);
    this.updateTraffic(dt, px, pz);
    this.updateGulls(dt, t, px, pz);
  }

  updatePeople(dt, t, px, pz) {
    const B = this.body;
    this.people.forEach((w, i) => {
      const far = w.placed && Math.hypot(w.x - px, w.z - pz) > 140;
      if (!w.placed || far) {
        const s = this.walkNet.spawnNear(px, pz, w.placed ? 70 : 6, 125, 30, busy);
        if (!s) return;
        w.place(this.walkNet, s.ri, s.v, Math.random() < 0.5 ? 1 : -1);
        w.placed = true;
      }
      // stop for a moment if the player is right in front
      const ahead = Math.hypot(w.x + Math.sin(w.h) * 0.9 - px, w.z + Math.cos(w.h) * 0.9 - pz) < 0.8;
      const step = ahead ? 0 : w.speed * dt;
      w.update(this.walkNet, step, 0.25);
      w.follow(dt);
      if (this.isWater(w.tx, w.tz)) { w.placed = false; return; }
      w.phase += step * 3.6;
      const swing = ahead ? 0 : Math.sin(w.phase) * 0.6;
      const bob = Math.abs(Math.cos(w.phase)) * 0.05;

      _r.makeRotationY(w.h).setPosition(w.x, bob, w.z);
      B.torso.setMatrixAt(i, _m.copy(_r).multiply(_l.makeTranslation(0, 1.26, 0)));
      B.head.setMatrixAt(i, _m.copy(_r).multiply(_l.makeTranslation(0, 1.75, 0)));
      B.hair.setMatrixAt(i, _m.copy(_r).multiply(_l.makeTranslation(0, 1.92, -0.01)));
      for (const k of [0, 1]) {
        const side = k ? 1 : -1, a = k ? swing : -swing;
        _l.makeRotationX(a).setPosition(0.11 * side, 0.95, 0);
        B.legs.setMatrixAt(i * 2 + k, _m.copy(_r).multiply(_l));
        _l.makeRotationX(-a * 0.9).setPosition(0.33 * side, 1.53, 0);
        B.arms.setMatrixAt(i * 2 + k, _m.copy(_r).multiply(_l));
      }
    });
    for (const m of Object.values(B)) m.instanceMatrix.needsUpdate = true;
  }

  updateTraffic(dt, px, pz) {
    const C = this.car, dyn = this.collision.dynamic;
    dyn.length = 0;
    this.vehicles.forEach((d, i) => {
      const far = d.placed && Math.hypot(d.x - px, d.z - pz) > 260;
      if (!d.placed || far) {
        let s = null;
        for (let k = 0; k < 6 && !s; k++) {
          s = this.driveNet.spawnNear(px, pz, d.placed ? 140 : 25, 230);
          if (s && d.bus && !MAIN_ROADS.has(this.driveNet.roads[s.ri].k)) s = null;
        }
        if (!s) return;
        d.place(this.driveNet, s.ri, s.v, Math.random() < 0.5 ? 1 : -1);
        d.placed = true;
        d.spd = d.cruise * 0.5;
      }
      // brake for the player or a vehicle close ahead in the same lane
      const fx = Math.sin(d.h), fz = Math.cos(d.h);
      const clear = (ox, oz, gap) => {
        const rx = ox - d.x, rz = oz - d.z, along = rx * fx + rz * fz, across = Math.abs(rx * fz - rz * fx);
        return !(along > 0 && along < gap && across < 1.6);
      };
      let ok = clear(px, pz, d.len / 2 + 6);
      for (const o of this.vehicles) if (ok && o !== d && o.placed) ok = clear(o.x, o.z, (d.len + o.len) / 2 + 3);
      const want = ok ? d.cruise * (d.road && d.road.k === 'residential' ? 0.75 : 1) : 0;
      d.spd += Math.max(-9 * dt, Math.min(3 * dt, want - d.spd));
      d.update(this.driveNet, Math.max(0, d.spd) * dt, 0.35);
      d.follow(dt, 6);

      _r.makeRotationY(d.h).setPosition(d.x, 0, d.z);
      const L = d.len, W = d.wid;
      _s.set(W, d.bus ? 2.5 : 0.8, L);
      C.body.setMatrixAt(i, _m.copy(_r).multiply(_l.compose(_p.set(0, d.bus ? 1.65 : 0.62, 0), _q.identity(), _s)));
      if (d.bus) _s.set(W + 0.04, 0.85, L + 0.04), _p.set(0, 2.15, 0);
      else _s.set(W - 0.12, 0.62, L * 0.5), _p.set(0, 1.3, -0.25);
      C.glass.setMatrixAt(i, _m.copy(_r).multiply(_l.compose(_p, _q, _s)));
      const wx = W / 2 - 0.05, wz = L / 2 - (d.bus ? 1.8 : 0.8);
      [[-wx, wz], [wx, wz], [-wx, -wz], [wx, -wz]].forEach(([ox, oz], k) => {
        C.wheels.setMatrixAt(i * 4 + k, _m.copy(_r).multiply(_l.makeTranslation(ox, 0.33, oz)));
      });
      for (const c of d.circles) dyn.push({ x: d.x + fx * c, z: d.z + fz * c, r: d.bus ? 1.35 : 1.0 });
    });
    for (const m of Object.values(C)) m.instanceMatrix.needsUpdate = true;
  }

  updateGulls(dt, t, px, pz) {
    const G = this.gullMesh;
    this.gulls.forEach((g, i) => {
      if (!g.placed || Math.hypot(g.cx - px, g.cz - pz) > 260) {
        // circle somewhere ahead, mostly over the water if there's any about
        let cx = px, cz = pz;
        for (let k = 0; k < 8; k++) {
          const a = Math.random() * Math.PI * 2, d = (g.placed ? 120 : 15) + Math.random() * 110;
          cx = px + Math.cos(a) * d; cz = pz + Math.sin(a) * d;
          if (this.isWater(cx, cz)) break;
        }
        Object.assign(g, { placed: true, cx, cz, r: 8 + Math.random() * 25, y0: 9 + Math.random() * 18, w: (0.15 + Math.random() * 0.25) * (Math.random() < 0.5 ? 1 : -1), a: Math.random() * 6.28, flap: Math.random() * 6 });
      }
      g.a += g.w * dt;
      g.x = g.cx + Math.cos(g.a) * g.r;
      g.z = g.cz + Math.sin(g.a) * g.r;
      g.y = g.y0 + Math.sin(t * 0.4 + g.r) * 2;
      // tangent heading; flap in bursts, glide in between
      const h = Math.atan2(-Math.sin(g.a) * g.w, Math.cos(g.a) * g.w);
      g.flap += dt;
      const flapping = Math.sin(g.flap * 0.6) > 0.3;
      const wing = flapping ? Math.sin(g.flap * 11) * 0.7 : 0.12;
      _r.makeRotationY(h).setPosition(g.x, g.y, g.z);
      _m.copy(_r).multiply(_l.makeRotationZ(Math.sign(g.w) * 0.35));
      G.body.setMatrixAt(i, _m);
      for (const k of [0, 1]) {
        const side = k ? 1 : -1;
        _l.makeRotationY(k ? 0 : Math.PI).multiply(_c2.makeRotationZ(wing)).setPosition(0.05 * side, 0.03, 0.02);
        G.wings.setMatrixAt(i * 2 + k, _p2.copy(_m).multiply(_l));
      }
    });
    for (const m of Object.values(G)) m.instanceMatrix.needsUpdate = true;
  }
}

const _c2 = new THREE.Matrix4(), _p2 = new THREE.Matrix4();

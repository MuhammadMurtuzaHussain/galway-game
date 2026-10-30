// 2D collision world: building walls as line segments, trees as circles,
// bucketed into a uniform grid. Segments span heights y0..h, so raised
// walkways only block you when you're beside them, not on top or underneath.
// Platforms are walkable convex quads with a top height (stairs, decks).
const CELL = 16;
const STEP = 0.55; // how high you can step up without jumping

export class CollisionWorld {
  constructor() {
    this.cells = new Map();
    this.dynamic = []; // moving circles (cars), refilled every frame: { x, z, r }
  }

  key(cx, cz) {
    return cx * 100003 + cz;
  }

  bucket(cx, cz) {
    const k = this.key(cx, cz);
    let b = this.cells.get(k);
    if (!b) this.cells.set(k, (b = []));
    return b;
  }

  addSegment(ax, az, bx, bz, h, y0 = 0) {
    const seg = { t: 0, ax, az, bx, bz, h, y0 };
    const c0x = Math.floor(Math.min(ax, bx) / CELL), c1x = Math.floor(Math.max(ax, bx) / CELL);
    const c0z = Math.floor(Math.min(az, bz) / CELL), c1z = Math.floor(Math.max(az, bz) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) this.bucket(cx, cz).push(seg);
  }

  addRing(flat, h, y0 = 0) {
    const n = flat.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.addSegment(flat[i * 2], flat[i * 2 + 1], flat[j * 2], flat[j * 2 + 1], h, y0);
    }
  }

  addCircle(x, z, r, h = Infinity) {
    this.bucket(Math.floor(x / CELL), Math.floor(z / CELL)).push({ t: 1, x, z, r, h, y0: 0 });
  }

  // Walkable convex quad [x0,z0, x1,z1, x2,z2, x3,z3] whose surface is at height `top`.
  addPlatform(quad, top) {
    const p = { t: 2, quad, top };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < 8; i += 2) {
      minX = Math.min(minX, quad[i]); maxX = Math.max(maxX, quad[i]);
      minZ = Math.min(minZ, quad[i + 1]); maxZ = Math.max(maxZ, quad[i + 1]);
    }
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) this.bucket(cx, cz).push(p);
  }

  // Highest platform under (x, z) that a body at height y can stand on, or null.
  platformAt(x, z, y) {
    let best = null;
    const b = this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!b) return null;
    for (const o of b) {
      if (o.t !== 2 || o.top > y + STEP || (best !== null && o.top <= best)) continue;
      const q = o.quad;
      let pos = 0, neg = 0;
      for (let i = 0; i < 8; i += 2) {
        const j = (i + 2) % 8;
        const c = (q[j] - q[i]) * (z - q[i + 1]) - (q[j + 1] - q[i + 1]) * (x - q[i]);
        if (c > 0) pos++; else if (c < 0) neg++;
      }
      if (!pos || !neg) best = o.top;
    }
    return best;
  }

  near(x, z, fn) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const seen = new Set();
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const b = this.cells.get(this.key(cx + dx, cz + dz));
        if (!b) continue;
        for (const o of b) {
          if (seen.has(o)) continue;
          seen.add(o);
          fn(o);
        }
      }
  }

  // Push a circle (feet at height y) out of anything it overlaps. Returns the corrected position.
  resolve(x, z, r, y = 0) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.near(x, z, (o) => {
        if (o.t === 2 || y + STEP >= o.h || Math.max(y, 0) + 1.7 < o.y0) return;
        if (o.t === 0) {
          const dx = o.bx - o.ax, dz = o.bz - o.az;
          const len2 = dx * dx + dz * dz || 1;
          let t = ((x - o.ax) * dx + (z - o.az) * dz) / len2;
          t = Math.max(0, Math.min(1, t));
          const qx = o.ax + dx * t, qz = o.az + dz * t;
          const ex = x - qx, ez = z - qz;
          const d2 = ex * ex + ez * ez;
          if (d2 < r * r) {
            const d = Math.sqrt(d2) || 1e-4;
            x = qx + (ex / d) * r;
            z = qz + (ez / d) * r;
            moved = true;
          }
        } else {
          const ex = x - o.x, ez = z - o.z;
          const rr = r + o.r;
          const d2 = ex * ex + ez * ez;
          if (d2 < rr * rr) {
            const d = Math.sqrt(d2) || 1e-4;
            x = o.x + (ex / d) * rr;
            z = o.z + (ez / d) * rr;
            moved = true;
          }
        }
      });
      if (y < 1.5)
        for (const o of this.dynamic) {
          const ex = x - o.x, ez = z - o.z, rr = r + o.r, d2 = ex * ex + ez * ez;
          if (d2 < rr * rr) {
            const d = Math.sqrt(d2) || 1e-4;
            x = o.x + (ex / d) * rr;
            z = o.z + (ez / d) * rr;
            moved = true;
          }
        }
      if (!moved) break;
    }
    return [x, z];
  }

  // How far along the line from (ax,az) to (bx,bz) can a camera go before a
  // wall taller than the line's height at that point blocks it. Returns 0..1.
  rayFraction(ax, ay, az, bx, by, bz) {
    let best = 1;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
    const seen = new Set();
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const cx = Math.floor((ax + (bx - ax) * f) / CELL), cz = Math.floor((az + (bz - az) * f) / CELL);
      const b = this.cells.get(this.key(cx, cz));
      if (!b) continue;
      for (const o of b) {
        if (o.t !== 0 || seen.has(o)) continue;
        seen.add(o);
        const rx = bx - ax, rz = bz - az, sx = o.bx - o.ax, sz = o.bz - o.az;
        const den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-9) continue;
        const qx = o.ax - ax, qz = o.az - az;
        const t = (qx * sz - qz * sx) / den;
        const u = (qx * rz - qz * rx) / den;
        if (t > 0 && t < best && u >= 0 && u <= 1) {
          const y = ay + (by - ay) * t;
          if (y < o.h) best = t;
        }
      }
    }
    return best;
  }
}

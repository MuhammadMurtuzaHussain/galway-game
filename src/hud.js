// HUD: circular radar, area-name popups, current street, clock.
export const ZONES = [
  // name, x, z, radius (metres, local map coords). Smaller zones win ties.
  ['Eyre Square', -20, 20, 120],
  ['Shop Street', -255, 215, 70],
  ['Latin Quarter', -345, 380, 80],
  ['Spanish Arch', -330, 470, 45],
  ['The Long Walk', -142, 647, 70],
  ['The Docks', -140, 470, 130],
  ['Woodquay', -250, -150, 110],
  ['Galway Cathedral', -553, -77, 80],
  ['University', -720, -230, 200],
  ['The Quadrangle', -870, -352, 60],
  ['Newcastle', -1000, -450, 260],
  ['Westend', -640, 420, 120],
  ['The Claddagh', -420, 760, 150],
  ["Nimmo's Pier", -170, 840, 110],
  ['South Park', -650, 1020, 180],
  ['Fr. Griffin Road', -850, 760, 150],
  ['Grattan Beach', -1080, 1250, 160],
  ['Salthill Prom', -1800, 1630, 260],
  ['Salthill Prom', -2330, 1830, 280],
  ['Salthill', -1750, 1300, 450],
  ["Taylor's Hill", -1850, 700, 350],
  ['Blackrock', -2850, 1900, 280],
  ['Blackrock Diving Tower', -2876, 2022, 30],
  ["Lynch's Castle", -226, 143, 32],
  ['Hall of the Red Earl', -306, 397, 14],
  ['Salmon Weir Bridge', -464, -120, 45],
  ['Leisureland', -2225, 1725, 50],
  ['Lough Atalia', 430, 160, 220],
  ['Forster Street', 205, -65, 100],
  ['Bohermore', 150, -320, 250],
];

const CELL = 32;

export class Hud {
  constructor(map, radar) {
    this.radar = radar;
    this.el = {
      radar: document.getElementById('radar'),
      zone: document.getElementById('zone'),
      street: document.getElementById('street'),
      clock: document.getElementById('clock'),
    };
    this.ctx = this.el.radar.getContext('2d');
    this.zone = null;
    this.zoneTimer = 0;
    this.streetName = '';

    // spatial index of named street segments
    this.grid = new Map();
    for (const r of map.roads) {
      if (!r.n) continue;
      for (let i = 0; i < r.p.length - 2; i += 2) {
        const seg = [r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3], r.n, r.ga || ''];
        const k = Math.floor((seg[0] + seg[2]) / 2 / CELL) + ',' + Math.floor((seg[1] + seg[3]) / 2 / CELL);
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(seg);
      }
    }
  }

  zoneAt(x, z) {
    let best = null, bestR = Infinity;
    for (const [name, zx, zz, r] of ZONES) {
      if (Math.hypot(x - zx, z - zz) < r && r < bestR) {
        best = name;
        bestR = r;
      }
    }
    return best || 'Galway';
  }

  streetAt(x, z) {
    let best = '', ga = '', bd = 22;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.grid.get(cx + dx + ',' + (cz + dz));
        if (!list) continue;
        for (const [ax, az, bx, bz, n, g] of list) {
          const vx = bx - ax, vz = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
          const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
          if (d < bd) { bd = d; best = n; ga = g; }
        }
      }
    return [best, ga];
  }

  // Pop a message in the area-name slot (e.g. after kicking the wall).
  flash(text) {
    this.el.zone.textContent = text;
    this.el.zone.classList.remove('show');
    void this.el.zone.offsetWidth;
    this.el.zone.classList.add('show');
  }

  update(dt, player, camYaw, clock) {
    const { x, z } = player.pos;
    const zone = this.zoneAt(x, z);
    if (zone !== this.zone) {
      this.zone = zone;
      this.flash(zone);
    }
    this.streetTimer = (this.streetTimer || 0) - dt;
    if (this.streetTimer <= 0) {
      this.streetTimer = 0.25;
      const [s, ga] = this.streetAt(x, z);
      if (s !== this.streetName) {
        this.streetName = s;
        this.el.street.textContent = s;
        if (ga) {
          const small = document.createElement('small');
          small.textContent = ga;
          this.el.street.append(small);
        }
      }
    }
    this.el.clock.textContent = clock;
    this.drawRadar(x, z, camYaw, player.heading);
  }

  drawRadar(x, z, yaw, heading) {
    const c = this.ctx, cv = this.el.radar;
    const S = cv.width, R = S / 2;
    const { canvas, scale, x0, z0 } = this.radar;
    const zoom = 1.0; // radar px per map px
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath();
    c.arc(R, R, R - 4, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#3b6f8f';
    c.fillRect(0, 0, S, S);
    c.translate(R, R);
    c.rotate(yaw);
    c.scale(zoom, zoom);
    c.drawImage(canvas, -(x - x0) * scale, -(z - z0) * scale);
    c.restore();

    // friends: coloured dots, pinned to the rim when they're off the map
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    for (const o of this.others || []) {
      const dx = (o.x - x) * scale * zoom, dz = (o.z - z) * scale * zoom;
      let px = dx * cos - dz * sin, py = dx * sin + dz * cos;
      const d = Math.hypot(px, py), max = R - 14;
      if (d > max) { px *= max / d; py *= max / d; }
      c.beginPath();
      c.arc(R + px, R + py, d > max ? 5 : 6, 0, Math.PI * 2);
      c.fillStyle = o.color;
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = '#000';
      c.stroke();
    }

    // player arrow
    c.save();
    c.translate(R, R);
    c.rotate(yaw - heading + Math.PI);
    c.fillStyle = '#fff';
    c.strokeStyle = '#000';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6.5, 7);
    c.lineTo(0, 3.5);
    c.lineTo(-6.5, 7);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();

    // ring + north marker
    c.lineWidth = 6;
    c.strokeStyle = '#111';
    c.beginPath();
    c.arc(R, R, R - 4, 0, Math.PI * 2);
    c.stroke();
    const na = -Math.PI / 2 + yaw;
    const nx = R + Math.cos(na) * (R - 6), ny = R + Math.sin(na) * (R - 6);
    c.fillStyle = '#111';
    c.beginPath();
    c.arc(nx, ny, 10, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff';
    c.font = 'bold 13px "Bebas Neue", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', nx, ny + 1);
  }
}

// Ground: one big painted map texture (grass, parks, sand, pavements),
// a water mask used for both rendering and collision, the sea, and a radar map.
import * as THREE from 'three';

const AREA_COLORS = {
  grass: '#6c8a46', park: '#5d8a3c', pitch: '#4f9140', playground: '#a58463', cemetery: '#5c7444',
  wood: '#40602f', wetland: '#5a7350', sand: '#dcc892', parking: '#7c7c78', plaza: '#aaa49b', pier: '#8e8982',
};
const LAND = '#667449';
const PAVEMENT = '#9d988f';

export function buildGround(map, tex) {
  const [x0, z0, x1, z1] = map.bounds;
  const W = x1 - x0, H = z1 - z0;
  const s = Math.min(4096 / W, 4096 / H); // pixels per metre
  const cw = Math.round(W * s), ch = Math.round(H * s);

  const toPx = (x, z) => [(x - x0) * s, (z - z0) * s];
  const path = (ctx, flat, close) => {
    for (let i = 0; i < flat.length; i += 2) {
      const [px, py] = toPx(flat[i], flat[i + 1]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    if (close) ctx.closePath();
  };
  const fillPoly = (ctx, a) => {
    ctx.beginPath();
    path(ctx, a.p, true);
    if (a.holes) for (const h of a.holes) path(ctx, h, true);
    ctx.fill('evenodd');
  };
  const strokeLine = (ctx, flat, widthM) => {
    ctx.lineWidth = Math.max(1, widthM * s);
    ctx.beginPath();
    path(ctx, flat, false);
    ctx.stroke();
  };

  // ---------- Water mask ----------
  const mc = document.createElement('canvas');
  mc.width = cw; mc.height = ch;
  const m = mc.getContext('2d', { willReadFrequently: true });
  m.fillStyle = '#000';
  m.fillRect(0, 0, cw, ch);
  m.strokeStyle = '#f00';
  m.lineCap = m.lineJoin = 'round';
  for (const c of map.coast) strokeLine(m, c, 3 / s);
  const coastPx = m.getImageData(0, 0, cw, ch).data;

  // 0 land, 1 coastline barrier, 2 sea
  const water = new Uint8Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) if (coastPx[i * 4] > 100) water[i] = 1;

  // Flood the sea from points out in Galway Bay. The download clips the
  // coastline at the map edge, which leaves a false shore cutting the inner
  // bay (Claddagh, docks, river mouth) off from Salthill, so it gets its own seed.
  const [LAT0, LON0] = map.origin;
  const stack = [];
  for (const [seedLat, seedLon] of [[53.2545, -9.080], [53.265, -9.049]]) {
    const sx = (seedLon - LON0) * 111320 * Math.cos((LAT0 * Math.PI) / 180);
    const sz = -(seedLat - LAT0) * 110540;
    const [px, py] = toPx(sx, sz).map(Math.round);
    stack.push(py * cw + px);
  }
  while (stack.length) {
    const i = stack.pop();
    if (water[i] !== 0) continue;
    let l = i, r = i;
    const row = (i / cw) | 0, rs = row * cw, re = rs + cw - 1;
    while (l > rs && water[l - 1] === 0) l--;
    while (r < re && water[r + 1] === 0) r++;
    for (let k = l; k <= r; k++) {
      water[k] = 2;
      if (row > 0 && water[k - cw] === 0) stack.push(k - cw);
      if (row < ch - 1 && water[k + cw] === 0) stack.push(k + cw);
    }
  }
  let seaCount = 0;
  for (let i = 0; i < water.length; i++) if (water[i] === 2) seaCount++;
  if (seaCount > water.length * 0.75) {
    // Flood leaked through a coastline gap; fall back to no sea.
    console.warn('Sea flood leaked, disabling sea mask');
    for (let i = 0; i < water.length; i++) if (water[i] === 2) water[i] = 0;
  }

  // Rivers, canals, lakes on top; then piers, bridges and beaches back to land.
  m.fillStyle = '#000';
  m.fillRect(0, 0, cw, ch);
  m.fillStyle = m.strokeStyle = '#0f0';
  for (const a of map.areas) if (a.k === 'water') fillPoly(m, a);
  for (const l of map.lines) if (l.k === 'river') strokeLine(m, l.p, 6);
  m.fillStyle = m.strokeStyle = '#00f';
  for (const a of map.areas) if (a.k === 'pier' || a.k === 'sand') fillPoly(m, a);
  for (const l of map.lines) if (l.k === 'pier') strokeLine(m, l.p, 5);
  for (const r of map.roads) if (r.b) strokeLine(m, r.p, r.w + 2);
  const over = m.getImageData(0, 0, cw, ch).data;
  for (let i = 0; i < cw * ch; i++) {
    if (over[i * 4 + 2] > 100) water[i] = 0;
    else if (over[i * 4 + 1] > 100) water[i] = 2;
    else if (water[i] === 1) water[i] = 0;
  }

  const isWater = (x, z) => {
    const ix = Math.floor((x - x0) * s), iz = Math.floor((z - z0) * s);
    if (ix < 0 || iz < 0 || ix >= cw || iz >= ch) return true;
    return water[iz * cw + ix] === 2;
  };

  // ---------- Painted ground ----------
  const gc = document.createElement('canvas');
  gc.width = cw; gc.height = ch;
  const g = gc.getContext('2d', { willReadFrequently: true });
  g.fillStyle = LAND;
  g.fillRect(0, 0, cw, ch);
  // speckle so big lawns aren't flat
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '30,40,10' : '150,140,90'},0.08)`;
    g.fillRect(Math.random() * cw, Math.random() * ch, 2 + Math.random() * 14, 2 + Math.random() * 14);
  }
  const order = ['grass', 'wood', 'wetland', 'park', 'cemetery', 'pitch', 'playground', 'sand', 'parking', 'plaza', 'pier'];
  for (const k of order) {
    g.fillStyle = AREA_COLORS[k];
    for (const a of map.areas) if (a.k === k) fillPoly(g, a);
  }
  // pitch markings
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 1;
  for (const a of map.areas) if (a.k === 'pitch') { g.beginPath(); path(g, a.p, true); g.stroke(); }
  // pavements alongside streets
  g.strokeStyle = PAVEMENT;
  g.lineCap = g.lineJoin = 'round';
  for (const r of map.roads) if (r.w >= 4) strokeLine(g, r.p, r.w + 5);
  // dark footprints under buildings (reads as contact shadow from a distance)
  g.fillStyle = '#5b5955';
  for (const b of map.buildings) fillPoly(g, b);

  // knock out water so the sea plane shows through
  const img = g.getImageData(0, 0, cw, ch);
  for (let i = 0; i < cw * ch; i++) img.data[i * 4 + 3] = water[i] === 2 ? 0 : 255;
  g.putImageData(img, 0, 0);

  const groundTex = new THREE.CanvasTexture(gc);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = 8;
  groundTex.premultiplyAlpha = false;

  const groundMat = new THREE.MeshLambertMaterial({ map: groundTex, alphaTest: 0.5 });
  groundMat.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: tex.detail };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDetailUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvDetailUv = position.xy / 5.0;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDetailUv;\nuniform sampler2D detailMap;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= texture2D( detailMap, vDetailUv ).rgb * 1.6;');
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(x0 + W / 2, 0, z0 + H / 2);
  ground.receiveShadow = true;

  const group = new THREE.Group();
  group.add(ground);

  // Land beyond the mapped area (north, and the western/eastern shores) so the
  // city doesn't look like an island. Water edge rows found from the mask.
  const firstWaterRow = (col) => {
    for (let y = 0; y < ch; y++) if (water[y * cw + col] === 2) return y;
    return ch;
  };
  const skirtMat = new THREE.MeshLambertMaterial({ color: LAND });
  const addSkirt = (ax, az, bx, bz) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(bx - ax, bz - az), skirtMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((ax + bx) / 2, -0.02, (az + bz) / 2);
    group.add(mesh);
  };
  const far = 4000;
  addSkirt(x0 - far, z0 - far, x1 + far, z0 + 1);
  const wz = z0 + firstWaterRow(2) / s, ez = z0 + firstWaterRow(cw - 3) / s;
  addSkirt(x0 - far, z0, x0 + 1, wz);
  addSkirt(x1 - 1, z0, x1 + far, ez);

  // Sea
  tex.water.repeat.set(600, 600);
  const seaMat = new THREE.MeshPhongMaterial({
    color: '#2f7088', specular: '#ffd9a8', shininess: 80, map: tex.water,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(x0 + W / 2, -0.45, z0 + H / 2);
  sea.receiveShadow = true;
  group.add(sea);

  // ---------- Radar map (low-res, top-down) ----------
  const rs = 0.6; // px per metre
  const rc = document.createElement('canvas');
  rc.width = Math.round(W * rs); rc.height = Math.round(H * rs);
  const r = rc.getContext('2d');
  r.drawImage(gc, 0, 0, rc.width, rc.height);
  r.globalCompositeOperation = 'destination-over';
  r.fillStyle = '#3b6f8f';
  r.fillRect(0, 0, rc.width, rc.height);
  r.globalCompositeOperation = 'source-over';
  r.setTransform(rs / s, 0, 0, rs / s, 0, 0);
  r.strokeStyle = '#d6d2c8';
  r.lineCap = r.lineJoin = 'round';
  for (const rd of map.roads) if (rd.w >= 4) strokeLine(r, rd.p, rd.w + 2);
  r.fillStyle = '#4a4a48';
  for (const b of map.buildings) fillPoly(r, b);
  r.setTransform(1, 0, 0, 1, 0, 0);

  // Turn a polygon of land into sea after the fact (used around the diving tower).
  const addWater = (flat) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < flat.length; i += 2) {
      const [px, py] = toPx(flat[i], flat[i + 1]);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    const bx = Math.max(0, Math.floor(minX)), by = Math.max(0, Math.floor(minY));
    const bw = Math.min(cw, Math.ceil(maxX) + 1) - bx, bh = Math.min(ch, Math.ceil(maxY) + 1) - by;
    if (bw <= 0 || bh <= 0) return;
    m.fillStyle = '#000';
    m.fillRect(bx, by, bw, bh);
    m.fillStyle = '#fff';
    m.beginPath();
    path(m, flat, true);
    m.fill();
    const mask = m.getImageData(bx, by, bw, bh).data;
    const px = g.getImageData(bx, by, bw, bh);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        if (mask[i * 4] < 128) continue;
        water[(by + y) * cw + bx + x] = 2;
        px.data[i * 4 + 3] = 0;
      }
    g.putImageData(px, bx, by);
    groundTex.needsUpdate = true;
  };

  return {
    group,
    isWater,
    addWater,
    update(t) {
      tex.water.offset.set(t * 0.004, t * 0.0025);
    },
    radar: { canvas: rc, scale: rs, x0, z0 },
  };
}

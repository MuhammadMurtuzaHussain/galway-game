// Converts raw OSM JSON into a compact, game-ready map in local metres.
// x = east, z = south (so north is -z, which is "forward" in Three.js).
// Map data © OpenStreetMap contributors (ODbL).
import { readFile, writeFile } from 'node:fs/promises';

const raw = JSON.parse(await readFile(new URL('../data/osm-raw.json', import.meta.url)));

// Origin: Eyre Square
const LAT0 = 53.2745, LON0 = -9.0490;
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const KZ = 110540;
const r1 = (v) => Math.round(v * 10) / 10;
const proj = (p) => [r1((p.lon - LON0) * KX), r1(-(p.lat - LAT0) * KZ)];

function flat(geom) {
  const out = [];
  for (const g of geom) {
    const [x, z] = proj(g);
    out.push(x, z);
  }
  return out;
}

function isClosed(geom) {
  const a = geom[0], b = geom[geom.length - 1];
  return geom.length > 3 && a.lat === b.lat && a.lon === b.lon;
}

function ring(geom) {
  const f = flat(geom);
  if (isClosed(geom)) f.length -= 2; // drop duplicate closing point
  return f;
}

// Joins way fragments of a multipolygon into closed rings.
function stitch(ways) {
  const segs = ways.filter((w) => w && w.length > 1).map((w) => w.map((p) => [p.lon, p.lat]));
  const rings = [];
  const key = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  while (segs.length) {
    let cur = segs.shift();
    let guard = 0;
    while (key(cur[0]) !== key(cur[cur.length - 1]) && guard++ < 1000) {
      const end = key(cur[cur.length - 1]);
      const i = segs.findIndex((s) => key(s[0]) === end || key(s[s.length - 1]) === end);
      if (i < 0) break;
      let s = segs.splice(i, 1)[0];
      if (key(s[0]) !== end) s = s.reverse();
      cur = cur.concat(s.slice(1));
    }
    if (cur.length > 3) rings.push(ring(cur.map(([lon, lat]) => ({ lon, lat }))));
  }
  return rings;
}

function polygonsOf(el) {
  if (el.type === 'way') {
    if (!el.geometry || !isClosed(el.geometry)) return [];
    return [{ outer: ring(el.geometry), holes: [] }];
  }
  if (el.type === 'relation') {
    const outers = stitch(el.members.filter((m) => m.role === 'outer').map((m) => m.geometry));
    const inners = stitch(el.members.filter((m) => m.role === 'inner').map((m) => m.geometry));
    // Attach every hole to the first outer; good enough for rendering.
    return outers.map((o, i) => ({ outer: o, holes: i === 0 ? inners : [] }));
  }
  return [];
}

// Deterministic pseudo-random from OSM id, so heights don't change between builds.
const rand = (id, salt = 0) => {
  let x = (id * 2654435761 + salt * 97) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822507) >>> 0; x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};

function buildingHeight(t, id) {
  if (t.height) return Math.min(parseFloat(t.height) || 8, 80);
  const name = (t.name || '').toLowerCase();
  if (name === 'galway cathedral') return 22; // walls only; the dome is a landmark model
  if (t['building:levels']) return parseFloat(t['building:levels']) * 3.2 + 1.2;
  const b = t.building;
  const base = {
    house: 6.5, detached: 6.5, semidetached_house: 6.5, terrace: 7, residential: 7.5, bungalow: 4,
    apartments: 12, commercial: 10, retail: 8, office: 12, hotel: 14, church: 13, school: 8,
    university: 12, hospital: 14, garage: 3, garages: 3, shed: 2.6, roof: 4, kiosk: 3, hut: 3,
    industrial: 8, warehouse: 8, service: 3,
  }[b] ?? 7.5;
  return base * (0.85 + rand(id) * 0.35);
}

// Buildings OSM leaves unnamed that a landmark model needs to find.
const NAME_FIX = { 175583920: "Lynch's Castle" };

const ROAD_W = {
  trunk: 11, primary: 10, secondary: 8.5, tertiary: 7.5, secondary_link: 6,
  residential: 6, unclassified: 6, living_street: 5, service: 4, pedestrian: 6,
  footway: 2.2, path: 2, cycleway: 2.2, steps: 2.5, track: 3,
};

const AREA_KIND = (t) => {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.waterway === 'canal' && t.area) return 'water';
  if (t.natural === 'beach' || t.natural === 'sand') return 'sand';
  if (t.natural === 'wood' || t.natural === 'scrub') return 'wood';
  if (t.natural === 'wetland') return 'wetland';
  if (t.natural === 'grassland' || t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'village_green' || t.landuse === 'recreation_ground' || t.leisure === 'common' || t.leisure === 'recreation_ground') return 'grass';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.leisure === 'pitch') return 'pitch';
  if (t.leisure === 'playground') return 'playground';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (t.amenity === 'parking') return 'parking';
  if (t.highway === 'pedestrian' || t.area === 'yes' && t.highway) return 'plaza';
  if (t.man_made) return 'pier';
  return null;
};

const out = { origin: [LAT0, LON0], buildings: [], roads: [], areas: [], coast: [], lines: [], trees: [] };
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

for (const el of raw.elements) {
  const t = el.tags || {};
  if (el.type === 'node') {
    if (t.natural === 'tree') out.trees.push(...proj(el));
    continue;
  }
  if (t.indoor || t.location === 'underground' || t.tunnel === 'yes' && !t.building) continue;

  if (t.building && t.building !== 'no') {
    if (t.building === 'roof' || t.layer && parseInt(t.layer) < 0) continue;
    for (const p of polygonsOf(el)) {
      if (p.outer.length < 6) continue;
      const b = { p: p.outer, h: r1(buildingHeight(t, el.id)), s: Math.floor(rand(el.id, 1) * 1000) };
      if (p.holes.length) b.holes = p.holes;
      if (t.name || NAME_FIX[el.id]) b.n = t.name || NAME_FIX[el.id];
      if (t.building === 'church' || t.building === 'cathedral' || t.amenity === 'place_of_worship') b.k = 'church';
      else if (['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'residential'].includes(t.building)) b.k = 'house';
      else if (['garage', 'garages', 'shed', 'hut', 'service'].includes(t.building)) b.k = 'shed';
      out.buildings.push(b);
      for (let i = 0; i < p.outer.length; i += 2) {
        minX = Math.min(minX, p.outer[i]); maxX = Math.max(maxX, p.outer[i]);
        minZ = Math.min(minZ, p.outer[i + 1]); maxZ = Math.max(maxZ, p.outer[i + 1]);
      }
    }
    continue;
  }

  if (t.natural === 'coastline') {
    out.coast.push(flat(el.geometry));
    continue;
  }

  const ak = AREA_KIND(t);
  const closedArea = el.type === 'relation' || (el.geometry && isClosed(el.geometry) && (t.area === 'yes' || !t.highway && !t.railway && !(t.man_made && !t.area)));
  if (ak && closedArea && (!t.highway || t.area === 'yes')) {
    for (const p of polygonsOf(el)) out.areas.push({ k: ak, p: p.outer, ...(p.holes.length ? { holes: p.holes } : {}) });
    continue;
  }

  if (t.highway && ROAD_W[t.highway] && el.geometry) {
    const r = { p: flat(el.geometry), w: ROAD_W[t.highway], k: t.highway };
    if (t.name === 'Salthill Promenade') r.w = 5; // mapped as a footway, but it's a wide prom
    if (t.name) r.n = t.name;
    if (t.bridge && t.bridge !== 'no') r.b = 1;
    out.roads.push(r);
    continue;
  }

  if (el.geometry && (t.railway === 'rail' || t.man_made || t.waterway)) {
    out.lines.push({ k: t.railway ? 'rail' : t.man_made ? 'pier' : 'river', p: flat(el.geometry) });
  }
}

// Clip world bounds to the requested bbox area (plus a margin).
const pad = 40;
out.bounds = [Math.floor(minX - pad), Math.floor(minZ - pad), Math.ceil(maxX + pad), Math.ceil(maxZ + pad)];

await writeFile(new URL('../public/galway.json', import.meta.url), JSON.stringify(out));
console.log(
  `buildings ${out.buildings.length}, roads ${out.roads.length}, areas ${out.areas.length}, coast ${out.coast.length}, lines ${out.lines.length}, trees ${out.trees.length / 2}`,
);
console.log('bounds', out.bounds);

// Downloads raw OpenStreetMap data for central Galway → Salthill.
// Map data © OpenStreetMap contributors (ODbL).
import { writeFile } from 'node:fs/promises';

// south, west, north, east
export const BBOX = [53.2530, -9.1000, 53.2810, -9.0380];

const q = `
[out:json][timeout:180];
(
  way["building"](${BBOX});
  relation["building"](${BBOX});
  way["highway"](${BBOX});
  way["natural"="coastline"](${BBOX});
  way["natural"~"^(water|beach|sand|wood|scrub|grassland|wetland)$"](${BBOX});
  relation["natural"~"^(water|beach)$"](${BBOX});
  way["waterway"~"^(riverbank|river|canal)$"](${BBOX});
  way["leisure"~"^(park|pitch|garden|playground|common|recreation_ground)$"](${BBOX});
  way["landuse"~"^(grass|recreation_ground|cemetery|meadow|village_green)$"](${BBOX});
  way["man_made"~"^(pier|breakwater|groyne)$"](${BBOX});
  way["amenity"="parking"](${BBOX});
  way["railway"="rail"](${BBOX});
  node["natural"="tree"](${BBOX});
);
out geom;
`;

const endpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

for (const url of endpoints) {
  try {
    console.log('Fetching from', url);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'galway-explore-game/0.1' },
      body: 'data=' + encodeURIComponent(q),
    });
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 200));
    const json = await res.json();
    await writeFile(new URL('../data/osm-raw.json', import.meta.url), JSON.stringify(json));
    console.log('Saved', json.elements.length, 'elements');
    process.exit(0);
  } catch (e) {
    console.warn('Failed:', e.message);
  }
}
process.exit(1);

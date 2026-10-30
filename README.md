# Tribe City · Galway (working title)

A browser exploration game set in real Galway, from Eyre Square through the Latin Quarter,
the Claddagh and along the Prom to Blackrock. Low-poly, golden-hour, early-2000s open-world look.
No missions, just wander.

## Run it

```bash
npm install
npm run dev        # http://localhost:5288
```

Controls: WASD move · Shift sprint · Space jump · mouse look (click to lock) · wheel zoom ·
Q/E turn camera · T skip 2 hours · H hide help · 1–9 fast travel. Touch: left thumb moves, right thumb looks, tap right to jump.

Things to do: climb Blackrock diving tower and jump off the board, swim back to the beach,
walk the Prom to the end and kick the wall, stand at the water at the Claddagh and the swans
come over, watch for salmon jumping at the weir, walk in among the Red Earl's ruins.

## How the city is made

1. `npm run fetch-map`: downloads OpenStreetMap data for the area into `data/osm-raw.json`
2. `npm run build-map`: converts it to `public/galway.json` (local metres, origin = Eyre Square)
3. In the browser, `src/city.js` extrudes ~11,800 buildings, lays roads, trees and lamps, and
   `src/ground.js` paints the ground and floods Galway Bay from the coastline.

Change the area by editing `BBOX` in `scripts/fetch-osm.mjs` and re-running both scripts.

| File | What it does |
|---|---|
| `src/main.js` | Startup, game loop, fast travel, lamp lights |
| `src/city.js` | Buildings, roofs, roads, bridges, piers, trees, street lamps |
| `src/landmarks.js` | Spanish Arch, Cathedral, Eyre Square fountain and Browne Doorway, Lynch's Castle, Hall of the Red Earl, Salmon Weir Bridge and weir, Claddagh hookers and swans, Long Walk colours, Leisureland sign, Blackrock diving tower, Prom railings, the wall |
| `src/ground.js` | Ground texture, water mask, sea, radar map |
| `src/textures.js` | Procedural wall, road and roof textures; night window glow |
| `src/player.js` | Character, movement, swimming, follow camera |
| `src/collision.js` | Wall and tree collision, walkable platforms (stairs, decks), camera wall avoidance |
| `src/sky.js` | Sky, sun, fog, day/night cycle |
| `src/hud.js` | Radar, area names, street names, clock |
| `src/input.js` | Keyboard, mouse, touch |

Map data © OpenStreetMap contributors (ODbL). The on-screen credit must stay.

## Your bits

- [ ] **Pick the name.** It's one word in `index.html` (`<title>` and `<h1>`).
- [ ] **Play it and send notes.** What feels wrong compared to the real place? Missing streets, wrong heights, wrong colours.
- [ ] **Reference photos.** Front-on, daylight, phone is fine. Drop them in `reference/`:
      Spanish Arch, Quay Street shopfronts, Eyre Square (fountain, Browne Doorway), Blackrock diving tower,
      the Prom railings and wall, Galway Cathedral, the Long Walk houses, Claddagh swans, a Galway Hooker.
- [ ] **Describe the reel.** I can't open Instagram. Tell me what you liked: camera, vibe, cars, music?
- [ ] **GitHub repo.** Make an empty repo, or tell me to create one, so the code is backed up and can be deployed.
- [ ] **Hosting accounts** (free tiers are fine): Vercel for the game itself, plus Render or Fly.io later for the multiplayer server.
- [ ] **Later: 3–5 friends** for a multiplayer test night.
- [ ] *Optional:* add `building:levels` to Galway buildings on openstreetmap.org. Every fix there improves the game on the next map rebuild.

## Roadmap

1. ~~Prototype: real map, walking, lighting, radar~~ ✅
2. ~~Landmarks: Spanish Arch, Blackrock tower, Cathedral dome, Eyre Square sails, Prom railings~~ ✅
   ~~Lynch's Castle, Claddagh swans and hookers, Salmon Weir Bridge, Hall of the Red Earl,
   Long Walk colours, Leisureland~~ ✅
   Maybe later: Nimmo's Pier and Mutton Island lighthouse, the Claddagh church, Galway City Museum
3. Multiplayer: nicknames, see each other, chat (Colyseus or PartyKit)
4. Extras: bikes or cars, NPC pedestrians, seagulls and sea sounds, radio

import * as THREE from 'three';
import { makeTextures, nightUniform } from './textures.js';
import { buildGround } from './ground.js';
import { buildCity } from './city.js';
import { CollisionWorld } from './collision.js';
import { Player, FollowCamera } from './player.js';
import { Input } from './input.js';
import { Sky } from './sky.js';
import { Hud, ZONES } from './hud.js';
import { buildLandmarks, paintLongWalk, REPLACED_BUILDINGS } from './landmarks.js';
import { Net, SHIRTS } from './net.js';
import { buildSigns } from './signs.js';
import { Life } from './life.js';
import { Sound } from './sound.js';

const status = document.getElementById('load-status');
const setStatus = (s) => { status.textContent = s; };
// setTimeout rather than rAF so loading also progresses in a background tab
const frame = () => new Promise((r) => setTimeout(r, 16));

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 6000);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

setStatus('Downloading the map of Galway…');
const map = await (await fetch('./galway.json')).json();
await frame();

setStatus('Painting textures…');
const tex = makeTextures();
await frame();

setStatus('Flooding Galway Bay…');
const ground = buildGround(map, tex);
scene.add(ground.group);
await frame();

setStatus(`Building ${map.buildings.length.toLocaleString()} buildings…`);
await frame();
const collision = new CollisionWorld();
paintLongWalk(map);
const city = buildCity({ ...map, buildings: map.buildings.filter((b) => !REPLACED_BUILDINGS.has(b.n)) }, tex, collision, ground.isWater);
scene.add(city.group);
await frame();

setStatus('Carving the Spanish Arch…');
await frame();
const landmarks = buildLandmarks(map, collision, ground.isWater);
for (const w of landmarks.water) ground.addWater(w);
scene.add(landmarks.group);
const signs = buildSigns(map, REPLACED_BUILDINGS);
scene.add(signs);
await frame();

setStatus('Lighting the Prom…');
const sky = new Sky(scene, renderer);
const input = new Input(canvas);
const player = new Player(scene, collision, ground.isWater, map.bounds);
const follow = new FollowCamera(camera, collision);
const hud = new Hud(map, ground.radar);
const life = new Life(scene, map, collision, ground.isWater);
const sound = new Sound();
const pubs = map.pois.filter((p) => p[2] === 'pub' || p[2] === 'bar');
const mix = { sea: 0, height: 0, car: Infinity, gull: Infinity, gullPan: 0, pub: Infinity, rain: 0 };
let mixTimer = 0;
// what the player can hear: how close the sea, pubs, gulls and cars are
function updateMix(dt) {
  const { x, y, z } = player.pos;
  mix.height = Math.max(0, y);
  const n = life.nearest(x, z);
  mix.car = n.car;
  mix.gull = n.gull;
  const gd = Math.hypot(n.gx - x, n.gz - z) || 1;
  mix.gullPan = ((n.gx - x) * Math.cos(follow.yaw) - (n.gz - z) * Math.sin(follow.yaw)) / gd;
  if ((mixTimer -= dt) > 0) return;
  mixTimer = 0.3;
  let sea = 0;
  for (const r of [4, 12, 25, 45, 70])
    for (let a = 0; a < 8; a++)
      if (ground.isWater(x + Math.cos(a * 0.785) * r, z + Math.sin(a * 0.785) * r)) sea = Math.max(sea, 1 - r / 80);
  mix.sea = player.swimming ? 1 : sea;
  mix.pub = Infinity;
  for (const p of pubs) mix.pub = Math.min(mix.pub, Math.hypot(p[0] - x, p[1] - z));
}

// Teleport spots: the nearest street point to each zone (streets are outdoors).
function streetPointNear(x, z) {
  let best = null, bd = Infinity;
  for (const r of map.roads) {
    if (r.b) continue;
    for (let i = 0; i < r.p.length; i += 2) {
      const d = Math.hypot(r.p[i] - x, r.p[i + 1] - z);
      if (d < bd && !ground.isWater(r.p[i], r.p[i + 1])) { bd = d; best = [r.p[i], r.p[i + 1]]; }
    }
  }
  return best;
}
const FAST_TRAVEL = ['Eyre Square', 'Shop Street', 'Spanish Arch', 'The Claddagh', "Nimmo's Pier", 'Grattan Beach', 'Salthill Prom', 'Blackrock', 'Galway Cathedral']
  .map((name) => {
    const z = ZONES.find((zz) => zz[0] === name);
    return { name, at: streetPointNear(z[1], z[2]) };
  });
const travelList = document.getElementById('travel');
travelList.innerHTML = FAST_TRAVEL.map((t, i) => `<li><b>${i + 1}</b> ${t.name}</li>`).join('');

const spawn = FAST_TRAVEL[0].at;
player.teleport(spawn[0], spawn[1]);
player.heading = Math.PI * 0.85;
follow.yaw = player.heading + Math.PI;
follow.target.set(spawn[0], 1.5, spawn[1]);

// Real light pools under the few street lamps nearest the player.
const lampLights = Array.from({ length: 6 }, () => {
  const l = new THREE.PointLight('#ffc477', 0, 24, 1.6);
  scene.add(l);
  return l;
});
let lampTimer = 0;
function updateLampLights(dt) {
  lampTimer -= dt;
  if (lampTimer > 0) return;
  lampTimer = 0.3;
  const { x, z } = player.pos;
  const near = city.lamps
    .map((l) => [l, (l[0] - x) ** 2 + (l[1] - z) ** 2])
    .sort((a, b) => a[1] - b[1])
    .slice(0, lampLights.length);
  near.forEach(([[lx, lz, rot]], i) => {
    lampLights[i].position.set(lx + Math.cos(rot), 5.6, lz - Math.sin(rot));
    lampLights[i].intensity = sky.night * 38;
  });
}

// Splash rings when you land in the water.
const splashGeo = new THREE.RingGeometry(0.5, 0.9, 28);
splashGeo.rotateX(-Math.PI / 2);
const splashes = [];
player.onSplash = (x, z, speed) => {
  if (speed < 3) return;
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.Mesh(splashGeo, new THREE.MeshBasicMaterial({ color: '#f2fbff', transparent: true, depthWrite: false }));
    mesh.position.set(x, -0.42 + i * 0.01, z);
    scene.add(mesh);
    splashes.push({ mesh, t: -i * 0.18, size: 0.6 + speed * 0.12 });
  }
};
function updateSplashes(dt) {
  for (let i = splashes.length - 1; i >= 0; i--) {
    const s = splashes[i];
    s.t += dt;
    const f = Math.max(0, s.t) / 1.4;
    s.mesh.scale.setScalar(s.size * (1 + f * 4));
    s.mesh.material.opacity = 0.85 * (1 - f);
    if (f >= 1) {
      scene.remove(s.mesh);
      s.mesh.material.dispose();
      splashes.splice(i, 1);
    }
  }
}

// The wall at the end of the Prom. You walk the Prom and kick it before you turn back.
let wallKicks = 0;
try { wallKicks = +localStorage.getItem('wallKicks') || 0; } catch {}
let kickReady = true;
function checkWallKick() {
  const w = landmarks.kickWall;
  if (!w) return;
  const dx = player.pos.x - w.x, dz = player.pos.z - w.z;
  const d = Math.hypot(dx, dz);
  if (d > 4) kickReady = true;
  // close, moving, and facing the wall
  const facing = -(Math.sin(player.heading) * w.nx + Math.cos(player.heading) * w.nz);
  if (kickReady && d < 1.6 && player.speed > 0.5 && facing > 0.5) {
    kickReady = false;
    wallKicks++;
    try { localStorage.setItem('wallKicks', wallKicks); } catch {}
    player.kick();
    net.send({ t: 'kick' });
    hud.flash(wallKicks === 1 ? 'Kicked the wall!' : `Kicked the wall ×${wallKicks}`);
  }
}

// Warm up shaders once so the first frame doesn't hitch.
sky.update(0, player.pos);
renderer.compile(scene, camera);

// ---------- Multiplayer: nickname, shirt, chat ----------
const net = new Net(scene);
const nick = document.getElementById('nick');
const shirtsEl = document.getElementById('shirts');
let shirt = SHIRTS[0];
try {
  nick.value = localStorage.getItem('nick') || '';
  shirt = localStorage.getItem('shirt') || shirt;
} catch {}
if (!SHIRTS.includes(shirt)) shirt = SHIRTS[0];
shirtsEl.innerHTML = SHIRTS.map((c) => `<button type="button" data-c="${c}" style="background:${c}" aria-label="Shirt colour"></button>`).join('');
const markShirt = () => { for (const b of shirtsEl.children) b.classList.toggle('on', b.dataset.c === shirt); };
markShirt();
player.setShirt(shirt);
shirtsEl.addEventListener('click', (e) => {
  const c = e.target.dataset?.c;
  if (!c) return;
  shirt = c;
  markShirt();
  player.setShirt(c);
});

const chatEl = document.getElementById('chat');
const chatLog = document.getElementById('chat-log');
const chatIn = document.getElementById('chat-in');
function addChat(name, text, color) {
  const line = document.createElement('div');
  line.className = name ? 'line' : 'line sys';
  if (name) {
    const b = document.createElement('b');
    b.textContent = name + ': ';
    b.style.color = color || '#f3ead7';
    line.append(b);
  }
  line.append(text);
  chatLog.append(line);
  while (chatLog.children.length > 8) chatLog.firstChild.remove();
  setTimeout(() => line.classList.add('old'), 10000);
}
const chatOpen = () => chatEl.classList.contains('open');
function openChat() {
  chatEl.classList.add('open');
  input.release();
  if (document.pointerLockElement) document.exitPointerLock();
  chatIn.focus();
}
function closeChat() {
  chatEl.classList.remove('open');
  chatIn.value = '';
  chatIn.blur();
}
chatIn.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    e.preventDefault();
    const text = chatIn.value.trim();
    if (text) net.chat(text);
    closeChat();
  } else if (e.key === 'Escape') closeChat();
});
document.getElementById('chat-btn').addEventListener('click', openChat);
net.onChat = addChat;
const onlineEl = document.getElementById('online');
net.onStatus = () => {
  onlineEl.classList.toggle('off', net.status !== 'online');
  onlineEl.textContent = net.status === 'online' ? `${net.count} online` : net.status === 'connecting' ? 'connecting…' : 'offline';
};

document.getElementById('loading').classList.add('done');
const title = document.getElementById('title');
let started = false;
const start = () => {
  if (started) return;
  started = true;
  title.classList.add('done');
  document.getElementById('hud').classList.add('on');
  const name = nick.value.trim();
  try {
    localStorage.setItem('nick', name);
    localStorage.setItem('shirt', shirt);
  } catch {}
  nick.blur();
  input.pressed.delete('Enter'); // the Enter that starts the game shouldn't also open chat
  net.connect(name || 'Galwegian', shirt);
  sound.start();
};
document.getElementById('who').addEventListener('click', (e) => e.stopPropagation());
title.addEventListener('click', start);
addEventListener('keydown', (e) => {
  if (e.code === 'Enter' || (e.code === 'Space' && e.target !== nick)) start();
});
canvas.addEventListener('touchstart', start, { passive: true });

const help = document.getElementById('help');
const fps = document.getElementById('fps');
let last = performance.now(), fpsAcc = 0, fpsN = 0;

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  input.update();

  if (started) {
    if ((input.pressed.has('Enter') || input.pressed.has('NumpadEnter')) && !chatOpen()) openChat();
    if (input.pressed.has('KeyH')) help.classList.toggle('hidden');
    if (input.pressed.has('KeyM')) hud.flash(sound.toggleMute() ? 'Sound off' : 'Sound on');
    if (input.pressed.has('KeyT')) sky.hour = (sky.hour + 2) % 24;
    for (let i = 0; i < FAST_TRAVEL.length; i++) {
      if (input.pressed.has('Digit' + (i + 1))) {
        const [x, z] = FAST_TRAVEL[i].at;
        player.teleport(x, z);
        follow.target.set(x, 1.5, z);
        follow.yaw = player.heading + Math.PI;
      }
    }
    player.update(dt, input, follow.yaw);
    checkWallKick();
  } else {
    follow.yaw += dt * 0.08; // slow orbit on the title screen
    player.animate(dt);
  }
  follow.update(dt, player, started ? input : { lookX: 0, lookY: 0, zoom: 0, forward: 0 });
  sky.update(dt, player.pos);
  nightUniform.value = sky.night;
  updateLampLights(dt);
  updateSplashes(dt);
  landmarks.update(dt, now / 1000, player.pos);
  net.update(dt, now, player, camera);
  life.update(dt, now / 1000, player);
  updateMix(dt);
  sound.update(dt, now / 1000, mix);
  ground.update(now / 1000);
  hud.update(dt, player, follow.yaw, sky.clock);

  renderer.render(scene, camera);
  input.endFrame();

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    fps.textContent = Math.round(fpsN / fpsAcc) + ' fps';
    fpsAcc = 0; fpsN = 0;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// handy for debugging from the console
Object.assign(window, { game: { scene, player, sky, city, landmarks, map, renderer, camera, collision, ground, follow, hud, net, signs, life, sound, mix } });

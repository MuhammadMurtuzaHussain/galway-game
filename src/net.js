// Multiplayer client: sends our position ten times a second, draws everyone
// else with a name tag, and carries chat. If there's no server the game just
// runs on its own and keeps retrying in the background.
import * as THREE from 'three';
import { makeCharacter, animateBody } from './player.js';

const SEND_MS = 100;

export const SHIRTS = ['#7a1f2b', '#2d5f9a', '#2f7a3f', '#d9a33b', '#1d1d1f', '#c4473a', '#6b3d8f', '#e8e2d2'];

function serverUrl() {
  const room = new URLSearchParams(location.search).get('room') || '';
  const base = import.meta.env.VITE_MP_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/mp`;
  return room ? `${base}?room=${encodeURIComponent(room)}` : base;
}

function nameTag(text, color) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = '44px "Bebas Neue", Impact, sans-serif';
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 36;
  c.height = 64;
  g.font = font;
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 6, c.width, 52);
  g.fillStyle = color;
  g.fillRect(0, 6, 8, 52);
  g.fillStyle = '#f3ead7';
  g.textBaseline = 'middle';
  g.fillText(text, 20, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set((c.width / c.height) * 0.42, 0.42, 1);
  s.position.y = 2.3;
  s.renderOrder = 5;
  return s;
}

class Remote {
  constructor(scene, id, name, color) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.char = makeCharacter({ shirt: color });
    this.tag = nameTag(name, color);
    this.char.root.add(this.tag);
    this.char.root.visible = false;
    scene.add(this.char.root);
    this.pos = new THREE.Vector3();
    this.target = null;
    this.heading = 0;
    this.targetHeading = 0;
    this.speed = 0;
    this.phase = Math.random() * 6;
    this.swimming = false;
    this.onGround = true;
    this.kickT = 0;
  }

  setState(s) {
    const [x, y, z, h, sp, f] = s;
    if (!this.target || Math.hypot(x - this.pos.x, z - this.pos.z) > 25) this.pos.set(x, y, z); // fast travel: jump there
    this.target = new THREE.Vector3(x, y, z);
    this.targetHeading = h;
    this.speed = sp;
    this.swimming = !!(f & 1);
    this.onGround = !!(f & 2);
    this.char.root.visible = true;
  }

  update(dt, camPos) {
    if (!this.target) return;
    this.pos.lerp(this.target, Math.min(1, dt * 10));
    const d = Math.atan2(Math.sin(this.targetHeading - this.heading), Math.cos(this.targetHeading - this.heading));
    this.heading += d * Math.min(1, dt * 10);
    animateBody(this, dt);
    this.tag.visible = camPos.distanceTo(this.pos) < 70;
  }

  dispose(scene) {
    scene.remove(this.char.root);
    this.tag.material.map.dispose();
    this.tag.material.dispose();
  }
}

export class Net {
  constructor(scene) {
    this.scene = scene;
    this.remotes = new Map();
    this.ws = null;
    this.id = null;
    this.status = 'offline';
    this.retry = 1000;
    this.lastSend = 0;
    this.lastSent = '';
    this.onChat = null; // (name, text, color) => void
    this.onStatus = null; // () => void
  }

  get count() {
    return this.status === 'online' ? this.remotes.size + 1 : 0;
  }

  connect(name, color) {
    this.name = name;
    this.color = color;
    let ws;
    try { ws = new WebSocket(serverUrl()); } catch { return this.scheduleRetry(); }
    this.ws = ws;
    this.setStatus('connecting');
    ws.onopen = () => {
      this.retry = 1000;
      ws.send(JSON.stringify({ t: 'hello', name, color }));
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.handle(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const r of this.remotes.values()) r.dispose(this.scene);
      this.remotes.clear();
      this.setStatus('offline');
      this.scheduleRetry();
    };
  }

  scheduleRetry() {
    setTimeout(() => !this.ws && this.connect(this.name, this.color), this.retry);
    this.retry = Math.min(30000, this.retry * 2);
  }

  setStatus(s) {
    this.status = s;
    this.onStatus?.();
  }

  remote(id, name, color) {
    let r = this.remotes.get(id);
    if (!r) this.remotes.set(id, (r = new Remote(this.scene, id, name, color)));
    return r;
  }

  handle(msg) {
    if (msg.t === 'welcome') {
      this.id = msg.id;
      this.name = msg.name;
      for (const p of msg.players) {
        const r = this.remote(p.id, p.name, p.color);
        if (p.s) r.setState(p.s);
      }
      this.lastSent = '';
      this.setStatus('online');
    } else if (msg.t === 'join') {
      this.remote(msg.id, msg.name, msg.color);
      this.onChat?.(null, `${msg.name} joined`);
      this.setStatus('online');
    } else if (msg.t === 'leave') {
      const r = this.remotes.get(msg.id);
      if (!r) return;
      this.onChat?.(null, `${r.name} left`);
      r.dispose(this.scene);
      this.remotes.delete(msg.id);
      this.setStatus('online');
    } else if (msg.t === 'S') {
      for (const [id, ...s] of msg.p) if (id !== this.id) this.remotes.get(id)?.setState(s);
    } else if (msg.t === 'chat') {
      this.onChat?.(msg.name, msg.text, msg.id === this.id ? this.color : this.remotes.get(msg.id)?.color);
    } else if (msg.t === 'kick') {
      const r = this.remotes.get(msg.id);
      if (!r) return;
      r.kickT = 0.45;
      this.onChat?.(null, `${r.name} kicked the wall`);
    } else if (msg.t === 'full') {
      this.onChat?.(null, 'This room is full. Add ?room=yourname to the address to start your own.');
      this.retry = 30000;
    }
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  chat(text) {
    this.send({ t: 'chat', text });
  }

  update(dt, now, player, camera) {
    if (this.status === 'online' && now - this.lastSend > SEND_MS) {
      const p = player.pos;
      const s = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +player.heading.toFixed(3), +player.speed.toFixed(2), (player.swimming ? 1 : 0) | (player.onGround ? 2 : 0)];
      const key = s.join();
      // standing still: only resend now and then
      if (key !== this.lastSent || now - this.lastSend > 2000) {
        this.send({ t: 's', s });
        this.lastSent = key;
        this.lastSend = now;
      }
    }
    for (const r of this.remotes.values()) r.update(dt, camera.position);
  }
}

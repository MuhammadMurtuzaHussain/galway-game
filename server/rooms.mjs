// Multiplayer rooms over plain WebSockets. No accounts: you pick a nickname,
// the server relays everyone's position ten times a second, plus chat.
// Shared by the Vite dev server (vite.config.js) and the standalone server (index.mjs).
import { WebSocketServer } from 'ws';

const TICK_MS = 100;
const MAX_PER_ROOM = 40;
const CHAT_MAX = 140;

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max).trim();
const num = (v, lim) => (Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);

class Room {
  constructor(name, onEmpty) {
    this.name = name;
    this.players = new Map(); // id -> { ws, name, color, s, dirty }
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.onEmpty = onEmpty;
  }

  send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for (const [id, p] of this.players) if (id !== except && p.ws.readyState === 1) p.ws.send(data);
  }

  uniqueName(name) {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
  }

  join(ws, id, hello) {
    const name = this.uniqueName(clean(hello.name, 16) || 'Galwegian');
    const color = /^#[0-9a-f]{6}$/i.test(hello.color) ? hello.color : '#7a1f2b';
    const p = { ws, name, color, s: null, dirty: false, chat: [] };
    this.send(ws, {
      t: 'welcome', id, name, room: this.name,
      players: [...this.players].map(([pid, o]) => ({ id: pid, name: o.name, color: o.color, s: o.s })),
    });
    this.players.set(id, p);
    this.broadcast({ t: 'join', id, name, color }, id);
    return p;
  }

  leave(id) {
    if (!this.players.delete(id)) return;
    this.broadcast({ t: 'leave', id });
    if (!this.players.size) {
      clearInterval(this.timer);
      this.onEmpty();
    }
  }

  message(id, msg) {
    const p = this.players.get(id);
    if (!p) return;
    if (msg.t === 's' && Array.isArray(msg.s) && msg.s.length === 6) {
      // x, y, z, heading, speed, flags (1 swimming, 2 on ground)
      const [x, y, z, h, sp, f] = msg.s;
      p.s = [num(x, 1e4), num(y, 100), num(z, 1e4), num(h, 100), num(sp, 50), (f | 0) & 3];
      p.dirty = true;
    } else if (msg.t === 'chat') {
      const text = clean(msg.text, CHAT_MAX);
      const now = Date.now();
      p.chat = p.chat.filter((t) => now - t < 5000);
      if (!text || p.chat.length >= 5) return; // five messages per five seconds
      p.chat.push(now);
      this.broadcast({ t: 'chat', id, name: p.name, text });
    } else if (msg.t === 'kick') {
      this.broadcast({ t: 'kick', id }, id);
    } else if (msg.t === 'emote' && ['wave', 'dance', 'sit'].includes(msg.e)) {
      this.broadcast({ t: 'emote', id, e: msg.e }, id);
    }
  }

  tick() {
    const moved = [];
    for (const [id, p] of this.players) if (p.dirty && p.s) { moved.push([id, ...p.s]); p.dirty = false; }
    if (moved.length) this.broadcast({ t: 'S', p: moved });
  }
}

export function attachRooms(httpServer, path = '/mp') {
  if (!httpServer) return;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  const rooms = new Map();
  let nextId = 1;

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== path) return; // leave other upgrades (Vite's hot reload) alone
    wss.handleUpgrade(req, socket, head, (ws) => {
      const roomName = clean(url.searchParams.get('room'), 24).toLowerCase() || 'galway';
      let room = rooms.get(roomName);
      if (room && room.players.size >= MAX_PER_ROOM) {
        ws.send(JSON.stringify({ t: 'full' }));
        ws.close();
        return;
      }
      const id = nextId++;
      let joined = false;
      ws.alive = true;
      ws.on('pong', () => (ws.alive = true));
      // a bad or oversize message closes that one connection, never the server
      ws.on('error', () => ws.terminate());
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (!msg || typeof msg !== 'object') return;
          if (!joined) {
            if (msg.t !== 'hello') return;
            room = rooms.get(roomName) || new Room(roomName, () => rooms.delete(roomName));
            rooms.set(roomName, room);
            room.join(ws, id, msg);
            joined = true;
          } else room.message(id, msg);
        } catch {}
      });
      ws.on('close', () => joined && room.leave(id));
    });
  });

  // drop connections that stop answering pings
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate();
      else { ws.alive = false; ws.ping(); }
    }
  }, 15000);
  httpServer.on('close', () => clearInterval(ping));
  return wss;
}

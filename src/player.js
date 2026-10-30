// Blocky third-person character, movement with collision, and a follow camera.
import * as THREE from 'three';

const RADIUS = 0.35;
const RUN = 5.2, SPRINT = 9.5, WALK = 2.0, SWIM = 2.4, SWIM_FAST = 3.6;
const GRAVITY = -16, JUMP = 5.5;
export const SWIM_Y = -1.75; // feet height while swimming; the sea surface is at -0.45
const STEP_DOWN = 0.6;

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function makeCharacter({ shirt = '#7a1f2b', trim = '#f1ede4', pants = '#2d3a52', skin = '#e2b59a', hair = '#3a2a1e' } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const hipY = 0.95;
  const legs = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.11 * side, hipY, 0);
    pivot.add(box(0.19, 0.86, 0.21, pants, 0, -0.43, 0));
    pivot.add(box(0.2, 0.1, 0.3, '#1d1d1f', 0, -0.9, 0.04));
    body.add(pivot);
    return pivot;
  });

  body.add(box(0.5, 0.62, 0.28, shirt, 0, hipY + 0.31, 0));
  body.add(box(0.51, 0.08, 0.29, trim, 0, hipY + 0.48, 0)); // county-colours band
  body.add(box(0.46, 0.1, 0.26, pants, 0, hipY + 0.02, 0)); // belt line

  const arms = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.33 * side, hipY + 0.58, 0);
    pivot.add(box(0.15, 0.3, 0.17, shirt, 0, -0.14, 0));
    pivot.add(box(0.13, 0.32, 0.15, skin, 0, -0.44, 0));
    body.add(pivot);
    return pivot;
  });

  const head = new THREE.Group();
  head.position.set(0, hipY + 0.8, 0);
  head.add(box(0.27, 0.3, 0.28, skin, 0, 0, 0));
  head.add(box(0.29, 0.1, 0.3, hair, 0, 0.15, -0.01));
  head.add(box(0.29, 0.16, 0.06, hair, 0, 0.05, -0.13));
  head.add(box(0.05, 0.04, 0.02, '#1b1b1b', -0.065, 0.02, 0.145));
  head.add(box(0.05, 0.04, 0.02, '#1b1b1b', 0.065, 0.02, 0.145));
  body.add(head);

  return { root, body, legs, arms, head };
}

export class Player {
  constructor(scene, collision, isWater, bounds) {
    this.collision = collision;
    this.isWater = isWater;
    this.bounds = bounds;
    this.swimming = false;
    this.onSplash = null; // called with (x, z, speed) when hitting the water
    this.kickT = 0;
    this.char = makeCharacter();
    scene.add(this.char.root);
    this.pos = new THREE.Vector3();
    this.vy = 0;
    this.heading = Math.PI;
    this.phase = 0;
    this.speed = 0;
    this.onGround = true;
  }

  teleport(x, z) {
    this.pos.set(x, 0, z);
    this.vy = 0;
    this.swimming = false;
  }

  kick() {
    this.kickT = 0.45;
  }

  setShirt(color) {
    const scene = this.char.root.parent;
    scene.remove(this.char.root);
    this.char = makeCharacter({ shirt: color });
    scene.add(this.char.root);
  }

  // Height of whatever is underfoot: a platform you can reach, else land or water.
  groundAt(x, z, y) {
    const base = this.isWater(x, z) ? SWIM_Y : 0;
    const top = this.collision.platformAt(x, z, y);
    return top !== null && top > base ? top : base;
  }

  // Keep a margin inside the mapped area (the sea mask counts outside as water).
  inBounds(x, z) {
    const [x0, z0, x1, z1] = this.bounds;
    return x > x0 + 10 && x < x1 - 10 && z > z0 + 10 && z < z1 - 10;
  }

  update(dt, input, camYaw) {
    // desired direction relative to the camera
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let mx = fx * input.forward + rx * input.right;
    let mz = fz * input.forward + rz * input.right;
    const mag = Math.hypot(mx, mz);
    const pace = this.swimming ? (input.sprint ? SWIM_FAST : SWIM) : input.sprint ? SPRINT : input.walk ? WALK : RUN;
    const target = mag > 0.05 ? pace * Math.min(1, mag) : 0;
    if (mag > 0.05) { mx /= mag; mz /= mag; }
    this.speed += (target - this.speed) * Math.min(1, dt * 10);

    if (mag > 0.05) {
      const want = Math.atan2(mx, mz);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 12);
    }
    const vx = Math.sin(this.heading) * this.speed, vz = Math.cos(this.heading) * this.speed;

    // move in small steps so we never tunnel through thin walls
    const dist = Math.hypot(vx, vz) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.2));
    let x = this.pos.x, z = this.pos.z;
    for (let i = 0; i < steps; i++) {
      const sx = (vx * dt) / steps, sz = (vz * dt) / steps;
      if (this.inBounds(x + sx, z)) x += sx;
      if (this.inBounds(x, z + sz)) z += sz;
      [x, z] = this.collision.resolve(x, z, RADIUS, this.pos.y);
    }
    this.pos.x = x;
    this.pos.z = z;

    // jumping (not while swimming)
    if (input.jump && this.onGround && !this.swimming) {
      this.vy = JUMP;
      this.onGround = false;
    }
    const ground = this.groundAt(x, z, this.pos.y);
    const wasAir = !this.onGround;
    this.vy += GRAVITY * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      // ease down into the water from a jump, snap onto solid ground
      if (wasAir && ground === SWIM_Y && this.onSplash) this.onSplash(x, z, -this.vy);
      this.pos.y = ground;
      this.vy = 0;
      this.onGround = true;
    } else if (this.pos.y - ground > 0.05 && this.vy <= 0 && this.onGround && this.pos.y - ground < STEP_DOWN) {
      this.pos.y = ground; // walk down steps without hopping
      this.vy = 0;
    } else {
      this.onGround = this.pos.y - ground < 0.01;
    }
    this.swimming = this.onGround && ground === SWIM_Y;

    this.animate(dt);
  }

  animate(dt) {
    animateBody(this, dt);
  }
}

// Poses a character from its movement state. Shared by the local player and
// other players in multiplayer (anything with char, pos, heading, speed,
// phase, swimming, onGround and kickT).
export function animateBody(p, dt) {
  const c = p.char;
  c.root.position.copy(p.pos);
  c.root.rotation.y = p.heading;
  const moving = Math.min(1, p.speed / RUN);
  p.phase += dt * (3 + p.speed * 1.35);
  const swing = Math.sin(p.phase) * 0.75 * moving;
  if (p.swimming) {
    // front crawl when moving, treading water when still
    const sm = Math.min(1, p.speed / SWIM);
    const t = p.phase * 0.8;
    c.body.rotation.x = 1.15 * sm;
    c.body.position.y = 0.55 * sm + Math.sin(t * 2) * 0.04;
    c.arms[0].rotation.x = sm ? -t % (Math.PI * 2) : Math.sin(t * 2) * 0.6 - 0.3;
    c.arms[1].rotation.x = sm ? -(t + Math.PI) % (Math.PI * 2) : -Math.sin(t * 2) * 0.6 - 0.3;
    c.legs[0].rotation.x = Math.sin(t * 4) * 0.35;
    c.legs[1].rotation.x = -Math.sin(t * 4) * 0.35;
  } else if (p.onGround) {
    c.legs[0].rotation.x = swing;
    c.legs[1].rotation.x = -swing;
    c.arms[0].rotation.x = -swing * 0.9;
    c.arms[1].rotation.x = swing * 0.9;
    c.body.position.y = Math.abs(Math.cos(p.phase)) * 0.06 * moving + Math.sin(p.phase * 0.4) * 0.008 * (1 - moving);
    c.body.rotation.x = 0.12 * moving * (p.speed > RUN + 1 ? 1.6 : 1);
  } else {
    c.legs[0].rotation.x = 0.5;
    c.legs[1].rotation.x = -0.2;
    c.arms[0].rotation.x = c.arms[1].rotation.x = -2.4;
  }
  if (p.kickT > 0) {
    p.kickT = Math.max(0, p.kickT - dt);
    const k = Math.sin((1 - p.kickT / 0.45) * Math.PI);
    c.legs[1].rotation.x = -1.5 * k;
    c.legs[0].rotation.x = 0.15 * k;
    c.body.rotation.x = -0.15 * k;
    c.arms[0].rotation.x = 0.6 * k;
    c.arms[1].rotation.x = -0.6 * k;
  }
  c.arms[0].rotation.z = -0.06;
  c.arms[1].rotation.z = 0.06;
}

export class FollowCamera {
  constructor(camera, collision) {
    this.camera = camera;
    this.collision = collision;
    this.yaw = 0;
    this.pitch = 0.32;
    this.dist = 6.5;
    this.curDist = 6.5;
    this.target = new THREE.Vector3();
  }

  update(dt, player, input) {
    this.yaw -= input.lookX;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookY, -0.25, 1.3);
    this.dist = THREE.MathUtils.clamp(this.dist + input.zoom, 2.5, 18);

    // gently swing behind the player while running and not steering the camera
    if (Math.abs(input.lookX) < 1e-4 && player.speed > 1 && Math.abs(input.forward) > 0.1) {
      let d = player.heading + Math.PI - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < 2.4) this.yaw += d * Math.min(1, dt * 0.8);
    }

    this.target.lerp(new THREE.Vector3(player.pos.x, player.pos.y + 1.55, player.pos.z), Math.min(1, dt * 14));
    const cp = Math.cos(this.pitch);
    const ox = Math.sin(this.yaw) * cp, oy = Math.sin(this.pitch), oz = Math.cos(this.yaw) * cp;
    const t = this.target;
    const f = this.collision.rayFraction(t.x, t.y, t.z, t.x + ox * this.dist, t.y + oy * this.dist, t.z + oz * this.dist);
    const want = Math.max(1.2, f * this.dist - 0.35);
    this.curDist += (want - this.curDist) * Math.min(1, dt * (want < this.curDist ? 20 : 4));
    const d = this.curDist;
    this.camera.position.set(t.x + ox * d, Math.max(0.4, t.y + oy * d), t.z + oz * d);
    this.camera.lookAt(t);
  }
}

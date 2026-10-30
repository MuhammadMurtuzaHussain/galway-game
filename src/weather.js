// Galway weather: showers come and go. The schedule is worked out from the
// wall clock, so everyone online gets rained on at the same time.
import * as THREE from 'three';

const CYCLE = 420; // seconds; each cycle may or may not hold a shower
const hash = (n) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// 0 (dry) to 1 (lashing) at a given time in ms
export function rainAt(ms) {
  const t = ms / 1000, c = Math.floor(t / CYCLE), f = (t % CYCLE) / CYCLE;
  if (hash(c) > 0.45) return 0;
  const len = 0.35 + hash(c + 0.5) * 0.35, start = hash(c + 0.7) * (1 - len);
  const x = (f - start) / len;
  if (x < 0 || x > 1) return 0;
  return Math.min(1, x / 0.12, (1 - x) / 0.12) * (0.55 + 0.45 * hash(c + 0.3));
}

export class Weather {
  constructor(scene, drops = 5000) {
    this.rain = 0;
    this.override = null; // R toggles a local shower for the impatient
    const W = 36, H = 24;
    const pos = new Float32Array(drops * 6), tail = new Float32Array(drops * 2), id = new Float32Array(drops * 2);
    for (let i = 0; i < drops; i++) {
      const x = Math.random() * W, y = Math.random() * H, z = Math.random() * W, r = Math.random();
      pos.set([x, y, z, x, y, z], i * 6);
      tail.set([0, 1], i * 2);
      id.set([r, r], i * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('tail', new THREE.BufferAttribute(tail, 1));
    g.setAttribute('id', new THREE.BufferAttribute(id, 1));
    this.uniforms = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAmount: { value: 0 }, uLight: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `attribute float tail; attribute float id;
        uniform vec3 uCam; uniform float uTime; uniform float uAmount;
        varying float vA;
        void main(){
          vec3 p = position;
          float W = ${W.toFixed(1)}, H = ${H.toFixed(1)};
          p.y = mod(p.y - uTime * 17.0, H);
          p.x += uTime * 3.0;
          vec3 w = vec3(uCam.x + mod(p.x - uCam.x, W) - W * 0.5, uCam.y - 9.0 + p.y, uCam.z + mod(p.z - uCam.z, W) - W * 0.5);
          w += vec3(0.22, 1.0, 0.07) * tail; // a streak, leaning in the wind
          vA = tail * 0.5 + 0.2;
          gl_Position = id > uAmount ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: `uniform float uLight; varying float vA;
        void main(){ gl_FragColor = vec4(vec3(0.82, 0.86, 0.92) * uLight, 0.62 * vA); }`,
    });
    this.mesh = new THREE.LineSegments(g, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  toggle() {
    this.override = this.override === null ? (this.rain > 0.2 ? 0 : 1) : null;
    return this.override;
  }

  update(dt, camera, light) {
    const want = this.override ?? rainAt(Date.now());
    this.rain += (want - this.rain) * Math.min(1, dt * 0.5);
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uCam.value.copy(camera.position);
    u.uAmount.value = this.rain;
    u.uLight.value = light;
    this.mesh.visible = this.rain > 0.01;
  }
}

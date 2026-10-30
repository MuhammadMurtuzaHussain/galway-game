// Sky dome, sun, hazy fog and a day/night cycle. Starts at golden hour,
// because Salthill at sunset is the whole point.
import * as THREE from 'three';

// hour → look. Interpolated between neighbours.
const KEYS = [
  { h: 0, zen: '#060b1c', hor: '#1a2238', sun: '#9fb4ff', sunI: 0.15, hemi: 0.35, night: 1 },
  { h: 5.5, zen: '#1d2a52', hor: '#c98a6a', sun: '#ffb27a', sunI: 0.5, hemi: 0.5, night: 0.7 },
  { h: 7.5, zen: '#4f7fc0', hor: '#e8cfb0', sun: '#ffe2bc', sunI: 1.9, hemi: 0.95, night: 0 },
  { h: 12, zen: '#3f78c8', hor: '#cfe0ea', sun: '#fff6e8', sunI: 2.6, hemi: 1.1, night: 0 },
  { h: 17, zen: '#4a7cc0', hor: '#e6dcc6', sun: '#ffe7c4', sunI: 2.3, hemi: 1.0, night: 0 },
  { h: 19.5, zen: '#53689e', hor: '#f0b47c', sun: '#ffb46a', sunI: 2.2, hemi: 0.85, night: 0.15 },
  { h: 20.8, zen: '#2c3264', hor: '#d9785a', sun: '#ff8a5a', sunI: 0.9, hemi: 0.6, night: 0.6 },
  { h: 22.3, zen: '#0a1028', hor: '#26304e', sun: '#9fb4ff', sunI: 0.2, hemi: 0.38, night: 1 },
  { h: 24, zen: '#060b1c', hor: '#1a2238', sun: '#9fb4ff', sunI: 0.15, hemi: 0.35, night: 1 },
];
const parsed = KEYS.map((k) => ({ ...k, zen: new THREE.Color(k.zen), hor: new THREE.Color(k.hor), sun: new THREE.Color(k.sun) }));

export class Sky {
  constructor(scene, renderer) {
    this.hour = 19.4;
    this.speed = 24 / (20 * 60); // a full day every 20 real minutes
    this.night = 0;

    this.uniforms = {
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3() },
      sunColor: { value: new THREE.Color() },
      night: { value: 0 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(4500, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `varying vec3 vDir;
          void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
        fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float night;
          varying vec3 vDir;
          float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
          void main(){
            vec3 d = normalize(vDir);
            float h = max(d.y, 0.0);
            vec3 col = mix(horizon, zenith, pow(h, 0.55));
            if (d.y < 0.0) col = horizon * (1.0 + d.y * 0.6);
            float s = max(dot(d, normalize(sunDir)), 0.0);
            col += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.45 + pow(s, 3.0) * 0.12) * (1.0 - night * 0.7);
            vec3 cell = floor(d * 380.0);
            float star = step(0.9975, hash(cell)) * night * smoothstep(0.05, 0.3, d.y);
            col += vec3(star);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    dome.frustumCulled = false;
    dome.renderOrder = -1;
    scene.add(dome);
    this.dome = dome;

    this.hemi = new THREE.HemisphereLight('#c4d6ff', '#6b5a45', 1);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#ffd2a0', 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -70;
    c.right = c.top = 70;
    c.near = 1;
    c.far = 500;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);

    scene.fog = new THREE.Fog('#f0b47c', 60, 560);
    this.scene = scene;
  }

  sunDirection(hour) {
    // rises in the east ~06:30, sets over the bay in the west ~20:45
    const a = ((hour - 6.5) / 14.25) * Math.PI;
    const elev = Math.sin(a);
    return new THREE.Vector3(Math.cos(a), elev * 0.85 + 0.02, 0.35 + elev * 0.3).normalize();
  }

  update(dt, focus) {
    this.hour = (this.hour + dt * this.speed) % 24;
    let i = 0;
    while (parsed[i + 1].h <= this.hour) i++;
    const a = parsed[i], b = parsed[i + 1];
    const t = (this.hour - a.h) / (b.h - a.h);
    const u = this.uniforms;
    u.zenith.value.copy(a.zen).lerp(b.zen, t);
    u.horizon.value.copy(a.hor).lerp(b.hor, t);
    u.sunColor.value.copy(a.sun).lerp(b.sun, t);
    this.night = a.night + (b.night - a.night) * t;
    u.night.value = this.night;

    let dir = this.sunDirection(this.hour);
    if (dir.y < 0.05) {
      // after sunset the "sun" light becomes a soft moon from the south-east
      dir = new THREE.Vector3(0.4, 0.75, 0.5).normalize();
    }
    u.sunDir.value.copy(this.sunDirection(this.hour));

    this.sun.color.copy(u.sunColor.value);
    this.sun.intensity = a.sunI + (b.sunI - a.sunI) * t;
    this.hemi.intensity = a.hemi + (b.hemi - a.hemi) * t;
    this.hemi.color.copy(u.zenith.value).lerp(new THREE.Color('#ffffff'), 0.55);
    this.scene.fog.color.copy(u.horizon.value);

    this.sun.position.copy(focus).addScaledVector(dir, 200);
    this.sun.target.position.copy(focus);
    this.dome.position.copy(focus);
  }

  get clock() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
}

// Procedural low-res textures in the spirit of early-2000s open-world games.
import * as THREE from 'three';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function grain(ctx, w, h, amount) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function canvasTexture(canvas, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Wall textures carry a tint mask in alpha: 1 = painted wall (takes the
// building colour), 0 = glass/frames (keeps its own colour). Built as a
// DataTexture because canvas alpha is premultiplied and would wreck RGB.
function wallTexture(drawColor, drawMask, size = 128) {
  const [c, ctx] = makeCanvas(size, size);
  const [m, mctx] = makeCanvas(size, size);
  drawColor(ctx, size);
  mctx.fillStyle = '#fff';
  mctx.fillRect(0, 0, size, size);
  mctx.fillStyle = '#000';
  drawMask(mctx, size);
  const col = ctx.getImageData(0, 0, size, size).data;
  const msk = mctx.getImageData(0, 0, size, size).data;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4; // flip: v=0 is the bottom of the wall
    const dst = y * size * 4;
    for (let x = 0; x < size * 4; x += 4) {
      data[dst + x] = col[src + x];
      data[dst + x + 1] = col[src + x + 1];
      data[dst + x + 2] = col[src + x + 2];
      data[dst + x + 3] = msk[src + x];
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function sashWindow(ctx, x, y, w, h) {
  ctx.fillStyle = '#ecebe6';
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#5b7590');
  g.addColorStop(0.5, '#25303c');
  g.addColorStop(1, '#3d4f63');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ecebe6';
  ctx.fillRect(x, y + h / 2 - 2, w, 4);
  ctx.fillRect(x + w / 2 - 1.5, y, 3, h);
  ctx.fillStyle = '#cfcac0';
  ctx.fillRect(x - 7, y + h + 4, w + 14, 6);
}

export function makeTextures() {
  const T = {};

  // Town house bay: painted render with a tall sash window.
  T.townWall = wallTexture(
    (ctx, s) => {
      ctx.fillStyle = '#f2f0ea';
      ctx.fillRect(0, 0, s, s);
      grain(ctx, s, s, 18);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, s - 6, s, 6); // string course
      sashWindow(ctx, 38, 22, 52, 74);
    },
    (m) => {
      m.fillRect(30, 14, 68, 96);
    },
  );

  // Shopfront for ground floors in the old town: painted frame, big glass.
  T.shopWall = wallTexture(
    (ctx, s) => {
      ctx.fillStyle = '#e6e3dc';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#c9c5bc';
      ctx.fillRect(0, 0, s, 30); // signboard
      ctx.fillStyle = '#9a968e';
      ctx.fillRect(0, 28, s, 4);
      ctx.fillRect(0, 0, 4, s);
      ctx.fillRect(s - 4, 0, 4, s);
      const g = ctx.createLinearGradient(0, 38, 0, 112);
      g.addColorStop(0, '#6f8aa3');
      g.addColorStop(0.35, '#2b3846');
      g.addColorStop(1, '#1d252f');
      ctx.fillStyle = g;
      ctx.fillRect(12, 40, s - 24, 70);
      ctx.fillStyle = '#ffd98a';
      ctx.globalAlpha = 0.25;
      ctx.fillRect(16, 80, s - 32, 28); // warm interior glow
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e6e3dc';
      ctx.fillRect(s / 2 - 2, 40, 4, 70);
      // lettering blobs on the signboard
      ctx.fillStyle = '#f7f3e8';
      for (let i = 0; i < 6; i++) ctx.fillRect(22 + i * 14, 10, 9, 10);
      grain(ctx, s, s, 14);
    },
    (m, s) => {
      m.fillRect(12, 40, s - 24, 70);
      m.fillRect(18, 8, 92, 14);
    },
  );

  // Suburban house: pebbledash with a white PVC window.
  T.houseWall = wallTexture(
    (ctx, s) => {
      ctx.fillStyle = '#efece4';
      ctx.fillRect(0, 0, s, s);
      grain(ctx, s, s, 40);
      ctx.fillStyle = '#f7f7f4';
      ctx.fillRect(26, 30, 76, 58);
      const g = ctx.createLinearGradient(30, 34, 98, 84);
      g.addColorStop(0, '#6d87a0');
      g.addColorStop(1, '#2a3541');
      ctx.fillStyle = g;
      ctx.fillRect(31, 35, 66, 48);
      ctx.fillStyle = '#f7f7f4';
      ctx.fillRect(62, 35, 4, 48);
      ctx.fillStyle = '#c8c3b8';
      ctx.fillRect(22, 88, 84, 6);
    },
    (m) => {
      m.fillRect(22, 30, 84, 64);
    },
  );

  // Sheds, garages, warehouses: corrugated cladding.
  T.plainWall = wallTexture(
    (ctx, s) => {
      ctx.fillStyle = '#e8e6e0';
      ctx.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x += 8) {
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(x, 0, 3, s);
      }
      grain(ctx, s, s, 16);
    },
    () => {},
  );

  // Roof: slate rows.
  {
    const [c, ctx] = makeCanvas(64, 64);
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 8) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, y, 64, 2);
      for (let x = (y / 8) % 2 ? 0 : 8; x < 64; x += 16) ctx.fillRect(x, y, 2, 8);
    }
    grain(ctx, 64, 64, 30);
    T.roof = canvasTexture(c);
  }

  // Roads. u runs across the road (0..1), v runs along it.
  {
    const [c, ctx] = makeCanvas(64, 256);
    ctx.fillStyle = '#56575b';
    ctx.fillRect(0, 0, 64, 256);
    grain(ctx, 64, 256, 26);
    ctx.fillStyle = '#d9b84a';
    ctx.fillRect(3, 0, 2, 256);
    ctx.fillRect(59, 0, 2, 256);
    ctx.fillStyle = '#e8e8e2';
    ctx.fillRect(31, 0, 2, 140);
    T.roadMajor = canvasTexture(c);
  }
  {
    const [c, ctx] = makeCanvas(64, 128);
    ctx.fillStyle = '#5a5b5e';
    ctx.fillRect(0, 0, 64, 128);
    grain(ctx, 64, 128, 30);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, 4, 128);
    ctx.fillRect(60, 0, 4, 128);
    T.roadMinor = canvasTexture(c);
  }
  {
    const [c, ctx] = makeCanvas(64, 64);
    ctx.fillStyle = '#b4afa6';
    ctx.fillRect(0, 0, 64, 64);
    grain(ctx, 64, 64, 22);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(0, 0, 64, 2);
    ctx.fillRect(0, 32, 64, 2);
    ctx.fillRect(0, 0, 2, 64);
    ctx.fillRect(32, 0, 2, 64);
    T.footway = canvasTexture(c);
  }

  // Ground detail (multiplied over the big map texture). Linear data.
  {
    const [c, ctx] = makeCanvas(256, 256);
    ctx.fillStyle = 'rgb(160,160,160)';
    ctx.fillRect(0, 0, 256, 256);
    grain(ctx, 256, 256, 46);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.06)`;
      const r = 2 + Math.random() * 10;
      ctx.beginPath();
      ctx.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2);
      ctx.fill();
    }
    T.detail = canvasTexture(c, { srgb: false });
  }

  // Water ripples.
  {
    const [c, ctx] = makeCanvas(256, 256);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 500; i++) {
      ctx.strokeStyle = `rgba(40,70,90,${0.05 + Math.random() * 0.12})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      const x = Math.random() * 256, y = Math.random() * 256, l = 8 + Math.random() * 30;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + l / 2, y - 3, x + l, y);
      ctx.stroke();
    }
    T.water = canvasTexture(c);
  }

  return T;
}

// 0 = day, 1 = full night. Drives lit windows and lamp heads.
export const nightUniform = { value: 0 };

// Lambert material where vertex colour only tints pixels whose texture
// alpha marks them as paintable. Glass (alpha 0) lights up at night in
// a random subset of windows.
export function tintedWallMaterial(map) {
  const m = new THREE.MeshLambertMaterial({ map, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightUniform;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace(
        '#include <color_fragment>',
        `#if defined( USE_COLOR )
          diffuseColor.rgb = sampledDiffuseColor.rgb * mix( vec3( 1.0 ), vColor, sampledDiffuseColor.a ) * diffuse;
          float winSeed = fract( sin( dot( floor( vMapUv ) + vColor.rg * 17.0, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
          float glass = 1.0 - sampledDiffuseColor.a;
          float pane = glass * ( 1.0 - dot( sampledDiffuseColor.rgb, vec3( 0.333 ) ) );
          totalEmissiveRadiance += pane * smoothstep( 0.25, 0.9, uNight ) * step( 0.55, winSeed ) * vec3( 1.0, 0.58, 0.22 ) * ( 0.25 + winSeed * 0.45 );
        #endif
        diffuseColor.a = 1.0;`,
      );
  };
  return m;
}

// Vertex-coloured material where near-white vertices glow at night (lamp heads).
export function lampMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightUniform;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        #if defined( USE_COLOR )
          totalEmissiveRadiance += step( 0.8, vColor.r ) * uNight * vec3( 2.2, 1.7, 0.9 );
        #endif`,
      );
  };
  return m;
}

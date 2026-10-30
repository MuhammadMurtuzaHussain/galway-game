// Ambient sound, all synthesised (no audio files): the sea, wind, traffic,
// seagulls, rain, trad music from the pubs (an original jig on a
// fiddle-ish voice with guitar chords and a bodhrán) and the buskers'
// fingerpicked guitar. M mutes.
const JIG = {
  // MIDI notes, six eighth notes a bar in 6/8; -1 holds the previous note
  tune: [
    62, 66, 69, 74, 69, 66, 67, 71, 74, 71, 69, 67, 66, 69, 74, 69, 66, 62, 64, 66, 67, 69, -1, -1,
    62, 66, 69, 74, 76, 78, 79, 78, 76, 74, 71, 67, 69, 66, 62, 64, 66, 64, 62, -1, -1, 62, -1, -1,
    69, 74, 74, 78, 74, 74, 69, 74, 74, 78, 76, 74, 71, 76, 76, 79, 76, 76, 71, 76, 76, 79, 78, 76,
    69, 74, 78, 81, 78, 74, 79, 76, 73, 69, 71, 73, 74, 69, 66, 67, 64, 61, 62, -1, -1, 62, -1, -1,
  ],
  chords: [50, 55, 50, 57, 50, 55, 57, 50, 50, 50, 52, 52, 50, 57, 57, 50], // root per bar
  minor: new Set([52]),
  eighth: 60 / 112 / 3,
};
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
// the buskers: fingerpicked G–D–Em–C, eight notes a bar
const BUSK = {
  chords: [[43, 47, 50, 55, 59], [38, 45, 50, 54, 57], [40, 47, 52, 55, 59], [36, 43, 48, 52, 55]],
  pattern: [0, 2, 3, 4, 3, 2, 1, 3],
  eighth: 60 / 92 / 2,
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('muted') === '1'; } catch {}
    this.gullT = 2;
    this.rain = 0;
  }

  // needs a user gesture (the click or key that starts the game)
  start() {
    if (this.ctx) return this.ctx.resume();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const bed = (type, freq, q = 0.7) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.playbackRate.value = 0.7 + Math.random() * 0.6;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return g;
    };
    this.sea = bed('lowpass', 520);
    this.wind = bed('bandpass', 380, 0.6);
    this.traffic = bed('lowpass', 160);
    this.rainBed = bed('highpass', 1800, 0.4);

    this.music = ctx.createGain();
    this.music.gain.value = 0;
    this.music.connect(this.master);
    this.nextNote = 0;
    this.step = 0;
    this.busk = ctx.createGain();
    this.busk.gain.value = 0;
    this.busk.connect(this.master);
    this.buskNext = 0;
    this.buskStep = 0;
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('muted', this.muted ? '1' : '0'); } catch {}
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  set(g, v, tc = 0.4) {
    g.gain.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  // mix: { sea 0..1, height m, car m, gull m, gullPan -1..1, pub m, rain 0..1 }
  update(dt, t, mix) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const waves = 0.55 + 0.3 * Math.sin(t * 0.45) + 0.15 * Math.sin(t * 1.3 + 1);
    this.set(this.sea, mix.sea * 0.32 * waves, 0.6);
    this.set(this.wind, 0.025 + Math.min(0.08, mix.height * 0.008) + mix.rain * 0.03, 1);
    this.set(this.traffic, Math.max(0, 1 - mix.car / 45) ** 2 * 0.35, 0.3);
    this.set(this.rainBed, mix.rain * 0.22, 1.5);

    this.gullT -= dt;
    if (this.gullT < 0 && mix.gull < 80) {
      this.gullT = 3 + Math.random() * 7;
      this.cry(Math.max(0.05, 1 - mix.gull / 80) * 0.5, mix.gullPan);
    }

    const pubVol = Math.max(0, 1 - mix.pub / 32) ** 1.5 * 0.5;
    this.set(this.music, pubVol, 0.5);
    if (pubVol > 0.01) this.schedule();
    const buskVol = Math.max(0, 1 - (mix.busker ?? Infinity) / 38) ** 1.5 * 0.7;
    this.set(this.busk, buskVol, 0.5);
    if (buskVol > 0.01) this.scheduleBusk();
  }

  scheduleBusk() {
    const ctx = this.ctx;
    if (this.buskNext < ctx.currentTime) this.buskNext = ctx.currentTime + 0.05;
    while (this.buskNext < ctx.currentTime + 0.25) {
      const bar = Math.floor(this.buskStep / 8) % BUSK.chords.length, i = this.buskStep % 8;
      this.pluck(hz(BUSK.chords[bar][BUSK.pattern[i]] + 12), this.buskNext, i === 0 ? 0.16 : 0.1);
      if (i === 0) this.pluck(hz(BUSK.chords[bar][0]), this.buskNext, 0.14);
      this.buskStep++;
      this.buskNext += BUSK.eighth;
    }
  }

  pluck(f, t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    o2.type = 'sawtooth';
    o2.frequency.value = f * 1.002;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    o.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(g).connect(this.busk);
    o.start(t); o2.start(t);
    o.stop(t + 1.15); o2.stop(t + 1.15);
  }

  // "kee-ow": a rising then falling squeal, two or three times
  cry(vol, pan) {
    const ctx = this.ctx, now = ctx.currentTime;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan || 0)); p.connect(this.master); }
    const n = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const t0 = now + k * (0.34 + Math.random() * 0.08);
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'triangle';
      const base = 1300 + Math.random() * 300;
      o.frequency.setValueAtTime(base, t0);
      o.frequency.linearRampToValueAtTime(base * 1.6, t0 + 0.07);
      o.frequency.exponentialRampToValueAtTime(base * 0.75, t0 + 0.3);
      f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 1.2;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
      o.connect(f).connect(g).connect(p || this.master);
      o.start(t0);
      o.stop(t0 + 0.35);
    }
  }

  // Look-ahead scheduler for the pub session.
  schedule() {
    const ctx = this.ctx;
    if (this.nextNote < ctx.currentTime) this.nextNote = ctx.currentTime + 0.05;
    while (this.nextNote < ctx.currentTime + 0.25) {
      const i = this.step % JIG.tune.length, t = this.nextNote;
      const note = JIG.tune[i];
      if (note > 0) {
        let len = 1;
        while (JIG.tune[(i + len) % JIG.tune.length] === -1) len++;
        this.fiddle(hz(note), t, len * JIG.eighth);
      }
      if (i % 3 === 0) this.drum(t, i % 6 === 0 ? 0.5 : 0.3);
      if (i % 6 === 0) this.strum(JIG.chords[Math.floor(i / 6) % JIG.chords.length], t);
      this.step++;
      this.nextNote += JIG.eighth;
    }
  }

  fiddle(f, t, len) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), vib = ctx.createOscillator(), vg = ctx.createGain();
    const lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = f;
    vib.frequency.value = 5.5;
    vg.gain.value = f * 0.006;
    vib.connect(vg).connect(o.frequency);
    lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.025);
    g.gain.setValueAtTime(0.11, t + len * 0.8);
    g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(lp).connect(g).connect(this.music);
    o.start(t); vib.start(t);
    o.stop(t + len + 0.02); vib.stop(t + len + 0.02);
  }

  strum(root, t) {
    const ctx = this.ctx;
    const third = JIG.minor.has(root) ? 3 : 4;
    [0, 7, 12, 12 + third, 19].forEach((iv, k) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = hz(root + iv);
      const t0 = t + k * 0.012;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + JIG.eighth * 5);
      o.connect(g).connect(this.music);
      o.start(t0);
      o.stop(t0 + JIG.eighth * 5.2);
    });
  }

  drum(t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    g.gain.setValueAtTime(vol * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.2);
  }
}

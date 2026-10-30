// Keyboard + mouse (pointer lock) + touch (left stick, right drag to look).
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.forward = 0;
    this.right = 0;
    this.sprint = false;
    this.walk = false;
    this.jump = false;
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
    this.pressed = new Set(); // one-shot key presses for this frame
    this._mx = 0;
    this._my = 0;
    this._wheel = 0;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.look = { id: null, x: 0, y: 0 };
    this.touchJump = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('click', () => {
      if (!this.isTouch && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this._mx += e.movementX;
        this._my += e.movementY;
      }
    });
    addEventListener('wheel', (e) => { this._wheel += Math.sign(e.deltaY); }, { passive: true });

    this.isTouch = matchMedia('(pointer: coarse)').matches;
    canvas.addEventListener('touchstart', (e) => this.onTouch(e, 'start'), { passive: false });
    canvas.addEventListener('touchmove', (e) => this.onTouch(e, 'move'), { passive: false });
    canvas.addEventListener('touchend', (e) => this.onTouch(e, 'end'), { passive: false });
    canvas.addEventListener('touchcancel', (e) => this.onTouch(e, 'end'), { passive: false });
  }

  onTouch(e, type) {
    e.preventDefault();
    this.isTouch = true;
    for (const t of e.changedTouches) {
      if (type === 'start') {
        if (t.clientX < innerWidth / 2 && this.stick.id === null) {
          Object.assign(this.stick, { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 });
        } else if (this.look.id === null) {
          Object.assign(this.look, { id: t.identifier, x: t.clientX, y: t.clientY, t0: performance.now(), moved: 0 });
        }
      } else if (type === 'move') {
        if (t.identifier === this.stick.id) {
          this.stick.x = Math.max(-1, Math.min(1, (t.clientX - this.stick.ox) / 50));
          this.stick.y = Math.max(-1, Math.min(1, (t.clientY - this.stick.oy) / 50));
        } else if (t.identifier === this.look.id) {
          const dx = t.clientX - this.look.x, dy = t.clientY - this.look.y;
          this._mx += dx * 1.6;
          this._my += dy * 1.6;
          this.look.moved += Math.abs(dx) + Math.abs(dy);
          this.look.x = t.clientX;
          this.look.y = t.clientY;
        }
      } else {
        if (t.identifier === this.stick.id) Object.assign(this.stick, { id: null, x: 0, y: 0 });
        if (t.identifier === this.look.id) {
          // quick tap on the right half = jump
          if (this.look.moved < 10 && performance.now() - this.look.t0 < 250) this.touchJump = true;
          this.look.id = null;
        }
      }
    }
  }

  update() {
    const k = this.keys;
    this.forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    this.right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (this.stick.id !== null) {
      this.forward = -this.stick.y;
      this.right = this.stick.x;
    }
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || (this.stick.id !== null && Math.hypot(this.stick.x, this.stick.y) > 0.95);
    this.walk = k.has('AltLeft') || k.has('ControlLeft');
    this.jump = k.has('Space') || this.touchJump;
    this.touchJump = false;
    this.lookX = this._mx * 0.0024 + ((k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0)) * 0.035;
    this.lookY = this._my * 0.002;
    this.zoom = this._wheel * 0.9;
    this._mx = this._my = this._wheel = 0;
  }

  endFrame() {
    this.pressed.clear();
  }
}

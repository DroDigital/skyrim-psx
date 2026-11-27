// Keyboard / mouse / pointer-lock input. Edge-triggered "pressed" sets are cleared each frame.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false, leftReleased: false, rightReleased: false };
    this.locked = false;
    this.sensitivity = 0.0022;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.target && e.target.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); this.released.add(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) { if (this.mouse.left) this.mouse.leftReleased = true; this.mouse.left = false; }
      if (e.button === 2) { if (this.mouse.right) this.mouse.rightReleased = true; this.mouse.right = false; }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.mouse.left = this.mouse.right = false; }
      this.onLockChange && this.onLockChange(this.locked);
    });
  }
  lock() {
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (_) {} });
    } catch (_) { try { this.canvas.requestPointerLock(); } catch (__) {} }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.leftPressed = this.mouse.rightPressed = this.mouse.leftReleased = this.mouse.rightReleased = false;
  }
}

// 2.5D collision: circles (trees, rocks, actors) and oriented boxes (buildings, walls)
// in a uniform spatial hash. Characters are vertical capsules resolved in XZ, with the
// heightfield providing Y.
const CELL = 8;

export class Colliders {
  constructor() { this.grid = new Map(); this.all = []; }
  _key(i, j) { return i * 73856093 ^ j * 19349663; }
  _insert(c, minx, minz, maxx, maxz) {
    for (let i = Math.floor(minx / CELL); i <= Math.floor(maxx / CELL); i++)
      for (let j = Math.floor(minz / CELL); j <= Math.floor(maxz / CELL); j++) {
        const k = this._key(i, j);
        let a = this.grid.get(k); if (!a) this.grid.set(k, (a = []));
        a.push(c);
      }
    this.all.push(c);
  }
  addCircle(x, z, r, h = 99, tag) { const c = { t: 0, x, z, r, h, tag }; this._insert(c, x - r, z - r, x + r, z + r); return c; }
  addBox(x, z, hw, hd, rot = 0, h = 99, tag) {
    const c = { t: 1, x, z, hw, hd, rot, cos: Math.cos(rot), sin: Math.sin(rot), h, tag };
    const R = Math.hypot(hw, hd);
    this._insert(c, x - R, z - R, x + R, z + R);
    return c;
  }
  query(x, z, r) {
    const out = new Set();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const a = this.grid.get(this._key(i, j));
        if (a) for (const c of a) out.add(c);
      }
    return out;
  }
  // push a circle (x,z,r) out of every overlapping collider; returns corrected position
  resolve(p, r, footY = -1e9) {
    for (const c of this.query(p.x, p.z, r + 2)) {
      if (c.base !== undefined && footY > c.base + c.h - 0.4) continue;
      if (c.t === 0) {
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
        if (d < m && d > 1e-5) { p.x = c.x + (dx / d) * m; p.z = c.z + (dz / d) * m; }
      } else {
        // into box local space
        const dx = p.x - c.x, dz = p.z - c.z;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        const cx = Math.max(-c.hw, Math.min(c.hw, lx)), cz = Math.max(-c.hd, Math.min(c.hd, lz));
        let ox = lx - cx, oz = lz - cz;
        const d = Math.hypot(ox, oz);
        let nx, nz;
        if (d < 1e-5) { // centre inside the box: push out along the shallowest axis
          const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
          if (px < pz) { nx = (lx < 0 ? -1 : 1) * (c.hw + r); nz = lz; } else { nx = lx; nz = (lz < 0 ? -1 : 1) * (c.hd + r); }
        } else if (d < r) { nx = cx + (ox / d) * r; nz = cz + (oz / d) * r; }
        else continue;
        p.x = c.x + nx * c.cos + nz * c.sin; p.z = c.z - nx * c.sin + nz * c.cos;
      }
    }
    return p;
  }
  // cheap line-of-sight test against tall colliders
  blocked(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), steps = Math.ceil(len / 2);
    for (let s = 1; s < steps; s++) {
      const x = ax + (dx * s) / steps, z = az + (dz * s) / steps;
      for (const c of this.query(x, z, 0.5)) {
        if (c.h < 2) continue;
        if (c.t === 0) { if (Math.hypot(x - c.x, z - c.z) < c.r * 0.8) return true; }
        else {
          const lx = (x - c.x) * c.cos - (z - c.z) * c.sin, lz = (x - c.x) * c.sin + (z - c.z) * c.cos;
          if (Math.abs(lx) < c.hw && Math.abs(lz) < c.hd) return true;
        }
      }
    }
    return false;
  }
}

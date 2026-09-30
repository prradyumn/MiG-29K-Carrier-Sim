window.__ap = (() => { const s = window.__sim, ship = s.ship, T = s.ac.pos.constructor; let ie = 0; const gs = 4 * Math.PI / 180;
  return (a) => { const eye = new T(0, 1.12, -5.05).applyQuaternion(a.quat).add(a.pos); const lp = ship.worldToLocal(eye); const d = lp.clone().sub(ship.lensAim);
    const along = -d.dot(ship.landDir), lat = d.dot(ship.landPerp); const eh = Math.max(along, 0) * Math.tan(gs) - d.y; const vsDes = -3.3 + 0.4 * eh;
    a.inp.pitch = Math.max(-0.3, Math.min(0.3, 0.012 * (vsDes - a.vel.y))); ie += (a.t.alpha * 57.3 - 10.5) / 120;
    a.inp.throttle = Math.max(0.1, Math.min(0.8, 0.30 + 0.025 * (a.t.alpha * 57.3 - 10.5) + 0.002 * ie + 0.02 * (vsDes - a.vel.y)));
    const latv = a.vel.clone().sub(ship.velocity).dot(ship.landPerp); const phiDes = Math.max(-0.25, Math.min(0.25, -0.004 * lat - 0.02 * latv));
    a.inp.roll = Math.max(-0.25, Math.min(0.25, 1.2 * (phiDes - (a.t.phi || 0))));
    if (a.onGround) { a.inp.throttle = 0.85; a.inp.pitch = 0.15; a.inp.roll = 0; } if (a.arrest && a.arrest.stopped) a.inp.throttle = 0; }; })(); 1

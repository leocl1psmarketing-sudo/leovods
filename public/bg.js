// LeoVODS ambient background — fully cursor-reactive.
// Canvas layers: drifting aurora blobs (parallax with the pointer), a light
// pool that follows the cursor, twinkling stars, constellation particles that
// link to the cursor and gently flee from it, a comet trail, and click
// shockwaves + sparks. DOM layers: soft halo + crisp dot. The glass card
// tilts subtly toward the pointer with a spotlight riding its border.
//
// Cursor response is deliberately independent of the animation loop: the halo,
// dot and card spotlight update straight from pointer events, so the page
// reacts even when autoplay motion is reduced/paused. The loop only drives the
// autonomous ambience; under prefers-reduced-motion that ambience is frozen
// while the cursor-driven light still tracks the pointer.
(function () {
  'use strict';
  const canvas = document.getElementById('bg');
  const glow = document.getElementById('glow');
  const dot = document.getElementById('cdot');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const fine = !!(window.matchMedia && matchMedia('(pointer: fine)').matches);
  // Hide the native cursor only when we can actually draw a replacement dot and
  // the device has a real hovering pointer (never on touch / no-JS).
  const hideNative = fine && !!dot && !!(window.matchMedia && matchMedia('(hover: hover)').matches);
  function activateCustomCursor() {
    if (hideNative && document.body && !document.body.classList.contains('cursor-none')) {
      document.body.classList.add('cursor-none');
    }
  }

  let W = 0, H = 0, DPR = 1, running = true;
  const mouse = { x: 0, y: 0, tx: -9999, ty: -9999, has: false };
  const head = { x: 0, y: 0 };   // comet head — eases quickly toward pointer
  const aura = { x: 0, y: 0 };   // light pool / blob parallax — eases slowly
  let gx = -9999, gy = -9999;    // DOM halo position

  const trail = [];
  const stars = [];
  const blobs = [];
  const parts = [];
  const sparks = [];
  const rings = [];
  let lastTrail = 0;

  const BLOBS = [
    { fx: 0.20, fy: 0.28, r: 0.62, c: [46, 155, 255], sp: 0.50, ph: 1.2 },
    { fx: 0.80, fy: 0.20, r: 0.55, c: [34, 211, 238], sp: 0.62, ph: 3.4 },
    { fx: 0.64, fy: 0.80, r: 0.60, c: [76, 111, 255], sp: 0.44, ph: 5.1 },
    { fx: 0.28, fy: 0.82, r: 0.48, c: [14, 165, 233], sp: 0.56, ph: 0.7 }
  ];

  function seed() {
    stars.length = 0; blobs.length = 0; parts.length = 0;
    const area = W * H;
    const m = Math.min(W, H);

    const nStars = Math.min(120, Math.floor(area / 14000));
    for (let i = 0; i < nStars; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.4 + Math.random() * 0.9,
        phase: Math.random() * 6.2832,
        speed: 0.4 + Math.random() * 1.1
      });
    }
    for (const b of BLOBS) {
      blobs.push({ x: b.fx * W, y: b.fy * H, r: b.r * m, c: b.c, sp: b.sp, ph: b.ph });
    }
    const nParts = Math.min(110, Math.floor(area / 20000));
    for (let i = 0; i < nParts; i++) {
      parts.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.26, vy: (Math.random() - 0.5) * 0.26,
        r: 0.6 + Math.random() * 1.3
      });
    }
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!mouse.has) { aura.x = W / 2; aura.y = H / 2; head.x = W / 2; head.y = H / 2; }
    seed();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- pointer input (independent of the render loop) ----------
  let updateCard = function () {}; // replaced below when a glass card is present

  function setPointer(x, y) {
    mouse.tx = x; mouse.ty = y;
    if (!mouse.has || reduced) {
      // snap on the very first move (and always under reduced motion, so a
      // single redraw is enough) — nothing glides in from offscreen
      mouse.has = true;
      mouse.x = head.x = aura.x = gx = x;
      mouse.y = head.y = aura.y = gy = y;
    }
    updateCursor();
    updateCard(x, y);
    schedule();
  }
  window.addEventListener('pointermove', function (e) { setPointer(e.clientX, e.clientY); }, { passive: true });
  window.addEventListener('mousemove', function (e) { if (!e.clientX && !e.clientY) return; setPointer(e.clientX, e.clientY); }, { passive: true });
  document.addEventListener('mouseleave', function () { mouse.has = false; mouse.tx = mouse.ty = -9999; updateCursor(); });
  window.addEventListener('touchmove', function (e) { const t = e.touches && e.touches[0]; if (t) setPointer(t.clientX, t.clientY); }, { passive: true });

  function updateCursor() {
    const on = mouse.has;
    if (on) activateCustomCursor();
    if (glow) {
      glow.style.transform = 'translate(' + (gx - 320) + 'px,' + (gy - 320) + 'px)';
      glow.style.opacity = on ? '1' : '0';
    }
    if (dot) {
      dot.style.transform = 'translate(' + (mouse.has ? mouse.tx : gx) + 'px,' + (mouse.has ? mouse.ty : gy) + 'px)';
      dot.style.opacity = on ? '1' : '0';
    }
  }

  window.addEventListener('pointerdown', function (e) {
    if (reduced) return;
    rings.push({ x: e.clientX, y: e.clientY, r: 6, max: 150, life: 1 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.2832, sp = 0.8 + Math.random() * 3.4;
      sparks.push({
        x: e.clientX, y: e.clientY,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.6,
        life: 1, decay: 0.014 + Math.random() * 0.02,
        r: 1.1 + Math.random() * 2.2,
        hue: 184 + Math.random() * 26
      });
    }
    schedule();
  });

  // ---------- glass card: spotlight border + subtle tilt ----------
  const card = document.querySelector('.glass.dl-card');
  if (card) {
    card.classList.add('tilt-ready');
    let raf = 0, cxp = 0, cyp = 0;
    function applyCard() {
      raf = 0;
      const r = card.getBoundingClientRect();
      if (!r.width) return;
      const dx = cxp - (r.left + r.width / 2);
      const dy = cyp - (r.top + r.height / 2);
      const nx = Math.max(-1, Math.min(1, dx / (r.width * 0.75)));
      const ny = Math.max(-1, Math.min(1, dy / (r.height * 0.9)));
      const dist = Math.hypot(dx / r.width, dy / r.height);
      const fall = Math.max(0, 1 - dist * 0.7);
      if (!reduced) {
        card.style.transition = dist < 1.2 ? 'transform .12s ease-out' : '';
        card.style.transform =
          'perspective(1100px) rotateY(' + (nx * 3 * fall).toFixed(2) + 'deg) rotateX(' + (-ny * 3 * fall).toFixed(2) + 'deg)';
      }
      card.style.setProperty('--mx', ((cxp - r.left) / r.width * 100).toFixed(2) + '%');
      card.style.setProperty('--my', ((cyp - r.top) / r.height * 100).toFixed(2) + '%');
    }
    updateCard = function (x, y) {
      cxp = x; cyp = y;
      if (!raf) raf = requestAnimationFrame(applyCard);
    };
    document.addEventListener('mouseleave', function () {
      card.style.transition = '';
      card.style.transform = '';
      card.style.removeProperty('--mx');
      card.style.removeProperty('--my');
    });
  }

  // ---------- render ----------
  function spawnTrail(now) {
    if (reduced || !mouse.has || now - lastTrail < 14) return;
    lastTrail = now;
    const speed = Math.hypot(mouse.tx - head.x, mouse.ty - head.y);
    trail.push({ x: head.x, y: head.y, life: 1, r: 1.4 + Math.min(speed * 0.02, 1.8) });
    if (trail.length > 42) trail.shift();
  }

  function drawBlobs(t) {
    const px = (aura.x - W / 2) / Math.max(W, 1);
    const py = (aura.y - H / 2) / Math.max(H, 1);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const x = b.x + Math.sin(t * 0.05 * b.sp + b.ph) * 90 - px * 150;
      const y = b.y + Math.cos(t * 0.045 * b.sp + b.ph * 1.3) * 70 - py * 130;
      const rad = b.r * (1 + 0.05 * Math.sin(t * 0.3 + b.ph));
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(' + b.c[0] + ',' + b.c[1] + ',' + b.c[2] + ',0.10)');
      g.addColorStop(0.45, 'rgba(' + b.c[0] + ',' + b.c[1] + ',' + b.c[2] + ',0.045)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.2832); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawCursorLight() {
    if (!mouse.has) return;
    const rad = Math.min(W, H) * 0.55;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(aura.x, aura.y, 0, aura.x, aura.y, rad);
    g.addColorStop(0, 'rgba(56,170,255,0.10)');
    g.addColorStop(0.4, 'rgba(34,211,238,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(aura.x, aura.y, rad, 0, 6.2832); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawStars(t) {
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const a = 0.12 + 0.2 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      ctx.fillStyle = 'rgba(175,205,245,' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832); ctx.fill();
    }
  }

  function updateParts() {
    if (reduced) return;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (mouse.has) {
        const dx = p.x - aura.x, dy = p.y - aura.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 44100 && d2 > 1) {
          const d = Math.sqrt(d2), f = (210 - d) / 210 * 0.055;
          p.vx += (dx / d) * f; p.vy += (dy / d) * f;
        }
      }
      p.vx *= 0.985; p.vy *= 0.985;
      if (p.vx * p.vx + p.vy * p.vy < 0.006) {
        p.vx += (Math.random() - 0.5) * 0.03;
        p.vy += (Math.random() - 0.5) * 0.03;
      }
      p.x += p.vx; p.y += p.vy;
      if (p.x < -24) p.x = W + 24; else if (p.x > W + 24) p.x = -24;
      if (p.y < -24) p.y = H + 24; else if (p.y > H + 24) p.y = -24;
    }
  }

  function drawConstellation() {
    ctx.lineWidth = 1;
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i];
      for (let j = i + 1; j < parts.length; j++) {
        const b = parts[j];
        const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < 12100) {
          ctx.strokeStyle = 'rgba(86,140,230,' + (0.11 * (1 - Math.sqrt(d2) / 110)).toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      if (mouse.has) {
        const dx = a.x - mouse.x, dy = a.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 28900) {
          ctx.strokeStyle = 'rgba(103,232,249,' + (0.20 * (1 - Math.sqrt(d2) / 170)).toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
        }
      }
    }
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      ctx.fillStyle = 'rgba(130,175,235,.4)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
    }
  }

  function drawTrail() {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = trail.length - 1; i >= 0; i--) {
      const s = trail[i];
      s.life -= 0.035;
      if (s.life <= 0) { trail.splice(i, 1); continue; }
      ctx.fillStyle = 'rgba(140,235,255,' + (s.life * 0.45).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * s.life + 0.4, 0, 6.2832); ctx.fill();
    }
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      const k = i / trail.length;
      ctx.strokeStyle = 'rgba(160,240,255,' + (k * k * (b.life) * 0.5).toFixed(3) + ')';
      ctx.lineWidth = 0.6 + k * 3;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  function drawFx() {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const b = sparks[i];
      b.x += b.vx; b.y += b.vy; b.vy += 0.05; b.vx *= 0.985; b.vy *= 0.985;
      b.life -= b.decay;
      if (b.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.fillStyle = 'hsla(' + b.hue + ',100%,70%,' + b.life.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * b.life + 0.4, 0, 6.2832); ctx.fill();
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += (r.max - r.r) * 0.12 + 1; r.life -= 0.03;
      if (r.life <= 0) { rings.splice(i, 1); continue; }
      ctx.strokeStyle = 'rgba(103,232,249,' + (r.life * 0.55).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 6.2832); ctx.stroke();
    }
  }

  function frame(now) {
    // t drives only the autonomous ambience — frozen under reduced motion.
    const t = reduced ? 0 : now / 1000;
    if (mouse.has) {
      mouse.x += (mouse.tx - mouse.x) * 0.32;
      mouse.y += (mouse.ty - mouse.y) * 0.32;
      head.x += (mouse.tx - head.x) * 0.38;
      head.y += (mouse.ty - head.y) * 0.38;
      aura.x += (mouse.tx - aura.x) * 0.08;
      aura.y += (mouse.ty - aura.y) * 0.08;
      gx += (mouse.tx - gx) * 0.22;
      gy += (mouse.ty - gy) * 0.22;
    }
    ctx.clearRect(0, 0, W, H);
    drawBlobs(t);
    drawCursorLight();
    drawStars(t);
    if (!reduced) spawnTrail(now);
    updateParts();
    drawConstellation();
    drawTrail();
    drawFx();
    updateCursor();
  }

  let loopRaf = 0, dirty = false;
  function loop(now) {
    if (!running) { loopRaf = 0; return; }
    loopRaf = 0;
    dirty = false;
    try { frame(typeof now === 'number' ? now : performance.now()); } catch (err) { /* keep the loop alive */ }
    if (!reduced) loopRaf = requestAnimationFrame(loop);
    else if (dirty) loopRaf = requestAnimationFrame(loop);
  }
  // Wake the loop on demand (used by pointer input). Under reduced motion the
  // loop stops between draws; a pointer event requests exactly one more frame.
  function schedule() {
    if (!running) return;
    if (reduced) { dirty = true; if (!loopRaf) loopRaf = requestAnimationFrame(loop); }
    else if (!loopRaf) loopRaf = requestAnimationFrame(loop);
  }

  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    if (running && !loopRaf) loopRaf = requestAnimationFrame(loop);
  });

  loopRaf = requestAnimationFrame(loop);
})();

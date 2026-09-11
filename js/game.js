(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const STATE = { TITLE: "title", PLAYING: "playing", DEAD: "dead" };
  const BEST_KEY = "noah-bird-dunnagan-best";
  const BASE_H = 844;

  const world = {
    w: 390,
    h: 844,
    dpr: 1,
    scale: 1,
    groundH: 140,
    safeTop: 48,
    safeBottom: 20,
  };

  const game = {
    state: STATE.TITLE,
    time: 0,
    score: 0,
    best: Number(localStorage.getItem(BEST_KEY) || 0),
    shake: 0,
    flash: 0,
    deadAt: 0,
    pipes: [],
    clouds: [],
    hills: [],
    sparks: [],
    groundX: 0,
    spawnX: 0,
  };

  const noah = {
    x: 0,
    y: 0,
    vy: 0,
    rot: 0,
    bob: 0,
  };

  let audioCtx = null;
  let lastTs = 0;
  let raf = 0;
  let fontsReady = false;

  function now() {
    return performance.now();
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function isStandalone() {
    return (
      window.navigator.standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches
    );
  }

  function unit(n) {
    return n * world.scale;
  }

  function ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function beep(freq, dur, type, gain) {
    const ac = ensureAudio();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    g.gain.setValueAtTime(gain ?? 0.05, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  }

  function playFlap() {
    beep(620, 0.08, "square", 0.045);
    beep(880, 0.06, "triangle", 0.03);
    try {
      navigator.vibrate?.(8);
    } catch (_) {}
  }

  function playScore() {
    beep(880, 0.09, "triangle", 0.05);
    beep(1180, 0.12, "sine", 0.035);
  }

  function playHit() {
    beep(140, 0.22, "sawtooth", 0.07);
    try {
      navigator.vibrate?.([18, 30, 28]);
    } catch (_) {}
  }

  function resize() {
    const vv = window.visualViewport;
    const cssW = Math.max(1, Math.round(vv?.width || window.innerWidth));
    const cssH = Math.max(1, Math.round(vv?.height || window.innerHeight));
    world.dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(cssW * world.dpr);
    canvas.height = Math.round(cssH * world.dpr);
    ctx.setTransform(world.dpr, 0, 0, world.dpr, 0, 0);
    world.w = cssW;
    world.h = cssH;
    world.scale = cssH / BASE_H;
    world.groundH = unit(128);
    const rootStyle = getComputedStyle(document.documentElement);
    const insetTop = parseFloat(rootStyle.getPropertyValue("env(safe-area-inset-top)")) || 0;
    world.safeTop = Math.max(unit(28), insetTop + unit(12));
    world.safeBottom = unit(16);
    if (game.state === STATE.TITLE) {
      noah.x = world.w * 0.38;
      noah.y = world.h * 0.46;
    }
  }

  function noahSize() {
    const font = Math.round(clamp(unit(38), 30, 48));
    return {
      font,
      w: font * 3.05,
      h: font * 1.35,
    };
  }

  function resetRun() {
    game.score = 0;
    game.pipes = [];
    game.sparks = [];
    game.shake = 0;
    game.flash = 0;
    game.deadAt = 0;
    noah.x = world.w * 0.32;
    noah.y = world.h * 0.42;
    noah.vy = 0;
    noah.rot = 0;
  }

  function seedDecor() {
    game.clouds = [];
    for (let i = 0; i < 6; i++) {
      game.clouds.push({
        x: rand(0, world.w),
        y: rand(world.h * 0.06, world.h * 0.38),
        s: rand(0.7, 1.4),
        v: rand(0.08, 0.22),
      });
    }
    game.hills = [
      { x: 0, h: unit(70), w: world.w * 0.7, shade: 0 },
      { x: world.w * 0.45, h: unit(92), w: world.w * 0.8, shade: 1 },
    ];
  }

  function pipeGap() {
    const shrink = Math.min(game.score * unit(2.2), unit(28));
    return clamp(unit(208) - shrink, unit(168), unit(220));
  }

  function pipeSpeed() {
    return unit(2.55) + Math.min(game.score * unit(0.045), unit(1.15));
  }

  function randomGapY() {
    const gap = pipeGap();
    const topMin = world.safeTop + unit(70);
    const topMax = world.h - world.groundH - gap - unit(70);
    return rand(topMin, Math.max(topMin + 8, topMax));
  }

  function spawnPipe(x) {
    game.pipes.push({
      x,
      w: unit(72),
      gapY: randomGapY(),
      gap: pipeGap(),
      passed: false,
    });
  }

  function seedPipes() {
    const spacing = unit(248);
    spawnPipe(world.w + unit(220));
    spawnPipe(world.w + unit(220) + spacing);
    spawnPipe(world.w + unit(220) + spacing * 2);
  }

  function flap() {
    if (game.state === STATE.DEAD) {
      if (now() - game.deadAt < 520) return;
      game.pipes = [];
      game.sparks = [];
      game.score = 0;
      game.state = STATE.TITLE;
      noah.x = world.w * 0.38;
      noah.y = world.h * 0.46;
      noah.vy = 0;
      noah.rot = 0;
      return;
    }
    if (game.state === STATE.TITLE) {
      resetRun();
      seedPipes();
      game.state = STATE.PLAYING;
    }
    noah.vy = unit(-9.6);
    playFlap();
  }

  function noahHitbox() {
    const { w, h } = noahSize();
    const padX = w * 0.16;
    const padY = h * 0.2;
    return {
      x: noah.x - w / 2 + padX,
      y: noah.y - h / 2 + padY,
      w: w - padX * 2,
      h: h - padY * 2,
    };
  }

  function hitsPipe(box, pipe) {
    const top = { x: pipe.x, y: 0, w: pipe.w, h: pipe.gapY };
    const bot = {
      x: pipe.x,
      y: pipe.gapY + pipe.gap,
      w: pipe.w,
      h: world.h - world.groundH - (pipe.gapY + pipe.gap),
    };
    return overlaps(box, top) || overlaps(box, bot);
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function burst(x, y) {
    for (let i = 0; i < 14; i++) {
      game.sparks.push({
        x,
        y,
        vx: rand(-unit(3.2), unit(3.2)),
        vy: rand(-unit(6), unit(1.5)),
        life: rand(0.35, 0.7),
        age: 0,
        c: Math.random() > 0.5 ? "#FFE66D" : "#fff6c7",
      });
    }
  }

  function die() {
    if (game.state !== STATE.PLAYING) return;
    game.state = STATE.DEAD;
    game.deadAt = now();
    game.shake = unit(10);
    game.flash = 0.55;
    playHit();
    burst(noah.x, noah.y);
    if (game.score > game.best) {
      game.best = game.score;
      localStorage.setItem(BEST_KEY, String(game.best));
    }
  }

  function step(dt) {
    const t = clamp(dt, 0, 0.034);
    game.time += t;
    game.shake *= Math.pow(0.001, t);
    game.flash = Math.max(0, game.flash - t * 1.8);
    game.groundX = (game.groundX + (game.state === STATE.DEAD ? 0 : pipeSpeed()) * t * 60) % unit(48);

    for (const cloud of game.clouds) {
      cloud.x -= cloud.v * unit(18) * t * 60 * (game.state === STATE.DEAD ? 0.15 : 1);
      if (cloud.x < -unit(90)) {
        cloud.x = world.w + rand(20, 80);
        cloud.y = rand(world.h * 0.06, world.h * 0.38);
      }
    }

    for (const s of game.sparks) {
      s.age += t;
      s.x += s.vx * t * 60;
      s.y += s.vy * t * 60;
      s.vy += unit(0.22) * t * 60;
    }
    game.sparks = game.sparks.filter((s) => s.age < s.life);

    noah.bob += t;

    if (game.state === STATE.TITLE) {
      noah.y = world.h * 0.46 + Math.sin(noah.bob * 2.6) * unit(7);
      noah.rot = Math.sin(noah.bob * 2.6) * 0.12;
      return;
    }

    const grav = unit(0.42);
    noah.vy += grav * t * 60;
    noah.vy = Math.min(noah.vy, unit(12.5));
    noah.y += noah.vy * t * 60;
    noah.rot = clamp(noah.vy / unit(12), -0.55, 1.15);

    const floor = world.h - world.groundH - noahSize().h * 0.38;
    const ceiling = world.safeTop + unit(8);
    if (noah.y > floor) {
      noah.y = floor;
      die();
    }
    if (noah.y < ceiling) {
      noah.y = ceiling;
      noah.vy = 0;
    }

    if (game.state === STATE.DEAD) return;

    const speed = pipeSpeed() * t * 60;
    for (const pipe of game.pipes) {
      pipe.x -= speed;
      if (!pipe.passed && pipe.x + pipe.w < noah.x) {
        pipe.passed = true;
        game.score += 1;
        playScore();
      }
    }
    game.pipes = game.pipes.filter((p) => p.x + p.w > -unit(20));
    const last = game.pipes[game.pipes.length - 1];
    if (!last || last.x < world.w - unit(248)) {
      spawnPipe((last ? last.x : world.w) + unit(248));
    }

    const box = noahHitbox();
    for (const pipe of game.pipes) {
      if (hitsPipe(box, pipe)) {
        die();
        break;
      }
    }
  }

  function roundRect(x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, world.h);
    g.addColorStop(0, "#5fd0d8");
    g.addColorStop(0.45, "#7edce3");
    g.addColorStop(0.78, "#d9f3c7");
    g.addColorStop(1, "#f7e7a3");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, world.w, world.h);

    ctx.fillStyle = "rgba(255, 236, 150, 0.55)";
    ctx.beginPath();
    ctx.arc(world.w * 0.82, world.h * 0.16, unit(38), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 248, 210, 0.85)";
    ctx.beginPath();
    ctx.arc(world.w * 0.82, world.h * 0.16, unit(24), 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCloud(c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(c.s, c.s);
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    const blobs = [
      [0, 0, unit(22)],
      [unit(20), unit(6), unit(16)],
      [-unit(18), unit(8), unit(15)],
      [unit(6), unit(10), unit(18)],
    ];
    ctx.beginPath();
    for (const [x, y, r] of blobs) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }

  function drawHills() {
    const base = world.h - world.groundH;
    ctx.fillStyle = "#7fc36a";
    ctx.beginPath();
    ctx.moveTo(0, base);
    ctx.quadraticCurveTo(world.w * 0.18, base - unit(54), world.w * 0.38, base - unit(22));
    ctx.quadraticCurveTo(world.w * 0.58, base - unit(78), world.w * 0.8, base - unit(18));
    ctx.quadraticCurveTo(world.w * 0.92, base - unit(40), world.w, base - unit(10));
    ctx.lineTo(world.w, base);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#6bb35b";
    ctx.beginPath();
    ctx.moveTo(0, base);
    ctx.quadraticCurveTo(world.w * 0.25, base - unit(28), world.w * 0.5, base - unit(8));
    ctx.quadraticCurveTo(world.w * 0.75, base - unit(42), world.w, base - unit(6));
    ctx.lineTo(world.w, base);
    ctx.closePath();
    ctx.fill();
  }

  function drawPipe(pipe) {
    const { x, w, gapY, gap } = pipe;
    const lip = unit(10);
    const body = "#59c44f";
    const dark = "#2c7f34";

    function column(y, h, capAt) {
      if (h <= 0) return;
      ctx.fillStyle = dark;
      ctx.fillRect(x - 1, y, w + 2, h);
      ctx.fillStyle = body;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.fillRect(x + unit(7), y, unit(10), h);
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(x + w - unit(8), y, unit(8), h);

      const capH = unit(32);
      const capY = capAt === "bottom" ? y + h - capH : y;
      ctx.fillStyle = dark;
      roundRect(x - lip, capY, w + lip * 2, capH, unit(7));
      ctx.fill();
      ctx.fillStyle = "#6ed65f";
      roundRect(x - lip + 2, capY + 2, w + lip * 2 - 4, capH - 4, unit(6));
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(x - lip + unit(8), capY + unit(6), unit(12), capH - unit(12));
    }

    column(0, gapY, "bottom");
    const botY = gapY + gap;
    column(botY, world.h - world.groundH - botY, "top");
  }

  function drawGround() {
    const y = world.h - world.groundH;
    ctx.fillStyle = "#ded895";
    ctx.fillRect(0, y + unit(18), world.w, world.groundH);
    ctx.fillStyle = "#5fc14f";
    ctx.fillRect(0, y, world.w, unit(22));
    ctx.fillStyle = "#4aa642";
    ctx.fillRect(0, y + unit(18), world.w, unit(6));

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, world.w, unit(22));
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    for (let i = -1; i < world.w / unit(24) + 2; i++) {
      const gx = i * unit(24) - (game.groundX % unit(24));
      ctx.beginPath();
      ctx.moveTo(gx, y + unit(22));
      ctx.lineTo(gx + unit(12), y);
      ctx.lineTo(gx + unit(24), y + unit(22));
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = "#cbb56a";
    for (let i = 0; i < 18; i++) {
      const sx = ((i * 47 + game.groundX * 0.4) % (world.w + 20)) - 10;
      ctx.fillRect(sx, y + unit(40) + ((i * 13) % 50), unit(6), unit(4));
    }
  }

  function drawNoah() {
    const { font, w, h } = noahSize();
    ctx.save();
    ctx.translate(noah.x, noah.y);
    ctx.rotate(noah.rot * 0.5);

    ctx.fillStyle = "rgba(45, 52, 54, 0.16)";
    roundRect(-w / 2 + unit(8), h / 2 - unit(4), w * 0.72, unit(10), unit(8));
    ctx.fill();

    ctx.fillStyle = "#ffe566";
    ctx.strokeStyle = "#2d3436";
    ctx.lineWidth = unit(5);
    roundRect(-w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.28)";
    roundRect(-w / 2 + unit(10), -h / 2 + unit(6), w * 0.55, unit(10), unit(8));
    ctx.fill();

    ctx.fillStyle = "#2d3436";
    ctx.font = `700 ${font}px Fredoka, Avenir Next, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Noah", 0, unit(1));

    ctx.restore();
  }

  function drawScore() {
    if (game.state === STATE.TITLE) return;
    const text = String(game.score);
    const size = Math.round(unit(64));
    ctx.save();
    ctx.font = `700 ${size}px Fredoka, Avenir Next, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    ctx.lineWidth = unit(10);
    ctx.strokeStyle = "#2d3436";
    ctx.fillStyle = "#fff8e7";
    ctx.strokeText(text, world.w / 2, world.safeTop);
    ctx.fillText(text, world.w / 2, world.safeTop);
    ctx.restore();
  }

  function drawTitle() {
    if (game.state !== STATE.TITLE) return;
    const title = Math.round(clamp(unit(44), 32, 52));
    const sub = Math.round(clamp(unit(16), 13, 18));
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const cardW = Math.min(world.w - unit(40), unit(340));
    const cardH = unit(168);
    const cardX = (world.w - cardW) / 2;
    const cardY = world.h * 0.16;
    ctx.fillStyle = "rgba(255,248,231,0.92)";
    ctx.strokeStyle = "#2d3436";
    ctx.lineWidth = unit(5);
    roundRect(cardX, cardY, cardW, cardH, unit(28));
    ctx.fill();
    ctx.stroke();

    ctx.font = `700 ${title}px Fredoka, Avenir Next, system-ui, sans-serif`;
    ctx.fillStyle = "#2d3436";
    ctx.fillText("Noah Bird", world.w / 2, cardY + unit(58));
    ctx.font = `600 ${sub}px Fredoka, Avenir Next, system-ui, sans-serif`;
    ctx.fillStyle = "#6b5b2e";
    ctx.letterSpacing = "0.28em";
    ctx.fillText("D U N N A G A N", world.w / 2, cardY + unit(100));
    ctx.letterSpacing = "0";
    ctx.font = `600 ${Math.round(unit(15))}px Fredoka, Avenir Next, system-ui, sans-serif`;
    ctx.fillStyle = "#3d6b6f";
    ctx.fillText("Tap to fly", world.w / 2, cardY + unit(134));

    if (!isStandalone()) {
      ctx.font = `500 ${Math.round(unit(13))}px Fredoka, Avenir Next, system-ui, sans-serif`;
      ctx.fillStyle = "rgba(45,52,54,0.72)";
      ctx.fillText("On iPhone: Share → Add to Home Screen", world.w / 2, world.h - world.groundH - unit(36));
    }

    if (game.best > 0) {
      ctx.font = `600 ${Math.round(unit(16))}px Fredoka, Avenir Next, system-ui, sans-serif`;
      ctx.fillStyle = "#2d3436";
      ctx.fillText("Best  " + game.best, world.w / 2, world.h - world.groundH - unit(64));
    }
    ctx.restore();
  }

  function drawDead() {
    if (game.state !== STATE.DEAD) return;
    if (now() - game.deadAt < 280) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const cardW = Math.min(world.w - unit(40), unit(320));
    const cardH = unit(230);
    const cardX = (world.w - cardW) / 2;
    const cardY = world.h * 0.28;
    ctx.fillStyle = "rgba(255,248,231,0.95)";
    ctx.strokeStyle = "#2d3436";
    ctx.lineWidth = unit(5);
    roundRect(cardX, cardY, cardW, cardH, unit(28));
    ctx.fill();
    ctx.stroke();

    ctx.font = `700 ${Math.round(unit(36))}px Fredoka, Avenir Next, system-ui, sans-serif`;
    ctx.fillStyle = "#2d3436";
    ctx.fillText("Oof", world.w / 2, cardY + unit(48));

    ctx.font = `600 ${Math.round(unit(15))}px Fredoka, Avenir Next, system-ui, sans-serif`;
    ctx.fillStyle = "#7a6a3a";
    ctx.fillText("SCORE", world.w / 2 - cardW * 0.2, cardY + unit(96));
    ctx.fillText("BEST", world.w / 2 + cardW * 0.2, cardY + unit(96));

    ctx.font = `700 ${Math.round(unit(40))}px Fredoka, Avenir Next, system-ui, sans-serif`;
    ctx.fillStyle = "#2d3436";
    ctx.fillText(String(game.score), world.w / 2 - cardW * 0.2, cardY + unit(138));
    ctx.fillText(String(game.best), world.w / 2 + cardW * 0.2, cardY + unit(138));

    ctx.font = `600 ${Math.round(unit(16))}px Fredoka, Avenir Next, system-ui, sans-serif`;
    ctx.fillStyle = "#3d6b6f";
    ctx.fillText("Tap to try again", world.w / 2, cardY + unit(186));
    ctx.restore();
  }

  function drawSparks() {
    for (const s of game.sparks) {
      const a = 1 - s.age / s.life;
      ctx.fillStyle = s.c;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(s.x, s.y, unit(3.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    ctx.save();
    if (game.shake > 0.4) {
      ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
    }
    drawSky();
    for (const c of game.clouds) drawCloud(c);
    drawHills();
    for (const p of game.pipes) drawPipe(p);
    drawGround();
    drawNoah();
    drawSparks();
    drawScore();
    drawTitle();
    drawDead();
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${game.flash * 0.55})`;
      ctx.fillRect(0, 0, world.w, world.h);
    }
    ctx.restore();
  }

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function onPointer(e) {
    e.preventDefault();
    flap();
  }

  function onKey(e) {
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      flap();
    }
  }

  function boot() {
    resize();
    seedDecor();
    resetRun();
    game.state = STATE.TITLE;
    noah.x = world.w * 0.38;
    noah.y = world.h * 0.46;
    lastTs = 0;
    raf = requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize, { passive: true });
  window.visualViewport?.addEventListener("resize", resize, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resize, 250));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) lastTs = 0;
  });

  canvas.addEventListener("pointerdown", onPointer, { passive: false });
  window.addEventListener("keydown", onKey, { passive: false });
  document.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      fontsReady = true;
    });
  }

  boot();
})();

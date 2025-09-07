/* =========================
   K-WORLD — Dash & Collect
   Pure JS + Tailwind + WebAudio
   ========================= */

// --------- Helpers: Sound (Web Audio, no external files) ----------
class Sound {
  constructor() {
    this.ctx = null;
    this.gain = null;
    this.enabled = true;
  }
  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.15;
      this.gain.connect(this.ctx.destination);
    }
  }
  setEnabled(on) {
    this.enabled = on;
    if (this.gain) this.gain.gain.value = on ? 0.15 : 0.0;
  }
  tone(freq = 440, dur = 0.1, type = "sine", attack = 0.005, release = 0.05) {
    if (!this.enabled) return;
    this.ensure();
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(1, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + attack + dur + release);
    osc.connect(env).connect(this.gain);
    osc.start(t0);
    osc.stop(t0 + attack + dur + release + 0.05);
  }
  chord(freqs = [220, 277, 330], dur = 0.6) {
    if (!this.enabled) return;
    this.ensure();
    freqs.forEach((f, i) => this.tone(f, dur - i * 0.05, "triangle", 0.01, 0.2));
  }
}
const SFX = new Sound();

// --------- DOM ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hudScore = document.getElementById("hudScore");
const hudBest = document.getElementById("hudBest");
const hudCoins = document.getElementById("hudCoins");
const hudLives = document.getElementById("hudLives");
const overlay = document.getElementById("overlay");
const overlayContent = document.getElementById("overlayContent");

const btnStart = document.getElementById("btnStart");
const btnHow = document.getElementById("btnHow");
const btnPause = document.getElementById("btnPause");
const btnMute = document.getElementById("btnMute");
const btnReset = document.getElementById("btnReset");

// --------- Game State ----------
const state = {
  running: false,
  paused: false,
  score: 0,
  best: Number(localStorage.getItem("kw_best") || 0),
  coins: 0,
  lives: 3,
  t: 0,
  speed: 1,
  player: { x: 0.5, y: 0.8, r: 16, vx: 0, vy: 0 },
  pickups: [],
  hazards: [],
  keys: { up: false, down: false, left: false, right: false },
  pad: { up: false, down: false, left: false, right: false },
};

// --------- Resize / Responsive Canvas (16:9 inside container) ----------
function fitCanvas() {
  const box = canvas.parentElement.getBoundingClientRect();
  // device pixel ratio for crisp rendering
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(box.width * dpr);
  canvas.height = Math.floor(box.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", fitCanvas, { passive: true });
fitCanvas();

// --------- Controls ----------
window.addEventListener("keydown", (e) => {
  if (e.code === "ArrowUp" || e.code === "KeyW") state.keys.up = true;
  if (e.code === "ArrowDown" || e.code === "KeyS") state.keys.down = true;
  if (e.code === "ArrowLeft" || e.code === "KeyA") state.keys.left = true;
  if (e.code === "ArrowRight" || e.code === "KeyD") state.keys.right = true;
  if (e.code === "Space") togglePause();
});
window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowUp" || e.code === "KeyW") state.keys.up = false;
  if (e.code === "ArrowDown" || e.code === "KeyS") state.keys.down = false;
  if (e.code === "ArrowLeft" || e.code === "KeyA") state.keys.left = false;
  if (e.code === "ArrowRight" || e.code === "KeyD") state.keys.right = false;
});

// Mobile pad
document.querySelectorAll(".pad-btn").forEach((btn) => {
  const dir = btn.dataset.dir;
  const set = (on) => (state.pad[dir] = on);
  btn.addEventListener("touchstart", (e) => { e.preventDefault(); set(true); }, { passive: false });
  btn.addEventListener("touchend", () => set(false));
  btn.addEventListener("touchcancel", () => set(false));
});

// Buttons
btnStart.addEventListener("click", () => {
  overlay.classList.add("hidden");
  startGame();
  SFX.chord([261.6, 329.6, 392.0], 0.4);
});

btnHow.addEventListener("click", () => {
  overlayContent.innerHTML = `
    <h2 class="text-xl sm:text-2xl font-bold mb-2">How to play</h2>
    <ul class="text-left text-sm sm:text-base space-y-2 text-slate-300">
      <li>• Move with <b>WASD</b> / <b>Arrow Keys</b> or use the on-screen pad.</li>
      <li>• Collect <b class="text-amber-300">coins</b> (+10) to increase score.</li>
      <li>• Avoid <b class="text-rose-300">hazards</b> (−1 life). 3 lives total.</li>
      <li>• Survive and collect to increase difficulty and speed.</li>
      <li>• Press <b>Space</b> or ⏸ to pause/resume. 🔊 toggles sound.</li>
    </ul>
    <div class="text-center mt-4">
      <button id="howClose" class="px-4 py-2 rounded-lg bg-emerald-500 text-slate-900 font-semibold">Got it</button>
    </div>
  `;
  document.getElementById("howClose").addEventListener("click", () => {
    overlay.classList.add("hidden");
  });
});

btnPause.addEventListener("click", togglePause);
btnMute.addEventListener("click", () => {
  const next = !SFX.enabled;
  SFX.setEnabled(next);
  btnMute.textContent = next ? "🔊 Sound" : "🔇 Muted";
});
btnReset.addEventListener("click", () => {
  localStorage.removeItem("kw_best");
  state.best = 0;
  updateHUD();
});

// --------- Game Loop ----------
let rafId = null;
function startGame() {
  Object.assign(state, {
    running: true,
    paused: false,
    score: 0,
    coins: 0,
    lives: 3,
    t: 0,
    speed: 1,
    player: { x: canvas.width / 2, y: canvas.height / 2, r: 16, vx: 0, vy: 0 },
    pickups: [],
    hazards: [],
  });
  spawnInitial();
  cancelAnimationFrame(rafId);
  loop();
}

function togglePause() {
  if (!state.running) return;
  state.paused = !state.paused;
  btnPause.textContent = state.paused ? "▶ Resume" : "⏸ Pause";
  overlay.classList.toggle("hidden", !state.paused);
  overlayContent.innerHTML = `
    <h2 class="text-xl sm:text-2xl font-bold mb-2">${state.paused ? "Paused" : ""}</h2>
    <p class="text-slate-300 text-sm sm:text-base mb-4">Press Space or the button to resume.</p>
    <button id="resumeBtn" class="px-4 py-2 rounded-lg bg-emerald-500 text-slate-900 font-semibold">Resume</button>
  `;
  document.getElementById("resumeBtn")?.addEventListener("click", togglePause);
}

function loop() {
  rafId = requestAnimationFrame(loop);
  if (!state.running || state.paused) return;
  update();
  render();
}

function update() {
  state.t += 1 / 60;

  // Responsive safety: if container changed, keep player on-screen
  const w = canvas.width, h = canvas.height;

  // Movement
  const accel = 0.9;
  const maxSpeed = 4 + state.speed * 0.6;
  const inputX = (state.keys.left || state.pad.left ? -1 : 0) + (state.keys.right || state.pad.right ? 1 : 0);
  const inputY = (state.keys.up || state.pad.up ? -1 : 0) + (state.keys.down || state.pad.down ? 1 : 0);
  state.player.vx += inputX * accel;
  state.player.vy += inputY * accel;
  // Friction
  state.player.vx *= 0.92;
  state.player.vy *= 0.92;
  // Clamp
  state.player.vx = Math.max(-maxSpeed, Math.min(maxSpeed, state.player.vx));
  state.player.vy = Math.max(-maxSpeed, Math.min(maxSpeed, state.player.vy));
  // Integrate
  state.player.x += state.player.vx;
  state.player.y += state.player.vy;

  // Keep in bounds
  state.player.x = Math.max(16, Math.min(w - 16, state.player.x));
  state.player.y = Math.max(16, Math.min(h - 16, state.player.y));

  // Spawn logic (gets harder)
  if (Math.random() < 0.02 + state.speed * 0.002) spawnCoin();
  if (Math.random() < 0.015 + state.speed * 0.003) spawnHazard();

  // Increase difficulty over time
  if (state.t % 5 < 1 / 60) state.speed += 0.05;

  // Collisions
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i];
    p.y += p.vy;
    p.x += p.vx;
    if (dist(p, state.player) < state.player.r + 10) {
      state.pickups.splice(i, 1);
      state.score += 10;
      state.coins += 1;
      bumpScore();
      SFX.tone(880, 0.08, "square");
      if (navigator.vibrate) navigator.vibrate(15);
    } else if (offScreen(p)) {
      state.pickups.splice(i, 1);
    }
  }

  for (let i = state.hazards.length - 1; i >= 0; i--) {
    const z = state.hazards[i];
    z.y += z.vy;
    z.x += z.vx;
    z.life -= 1;
    if (dist(z, state.player) < state.player.r + 12) {
      state.hazards.splice(i, 1);
      state.lives -= 1;
      SFX.tone(200, 0.15, "sawtooth");
      flashRed(120);
      if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
      if (state.lives <= 0) return gameOver();
    } else if (offScreen(z) || z.life <= 0) {
      state.hazards.splice(i, 1);
    }
  }

  updateHUD();
}

function render() {
  const w = canvas.width;
  const h = canvas.height;
  // Clear
  ctx.clearRect(0, 0, w, h);

  // Background grid
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1;
  const step = 40;
  for (let x = (state.t * 10) % step; x < w; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = (state.t * 10) % step; y < h; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.restore();

  // Coins
  state.pickups.forEach((p) => {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((p.spin += 0.08));
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.moveTo(0, -10);
    for (let i = 1; i < 5; i++) {
      const angle = i * (Math.PI * 2) / 5;
      ctx.lineTo(Math.sin(angle) * 10, -Math.cos(angle) * 10);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });

  // Hazards
  state.hazards.forEach((z) => {
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.rotate((z.rot += 0.05));
    ctx.fillStyle = "rgba(244,63,94,0.85)";
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(12, 12);
    ctx.lineTo(-12, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });

  // Player (glow)
  ctx.save();
  ctx.shadowColor = "#38bdf8";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#22d3ee";
  circle(ctx, state.player.x, state.player.y, state.player.r);
  ctx.fill();
  ctx.restore();
}

// --------- Entities / Spawn ----------
function spawnInitial() {
  for (let i = 0; i < 4; i++) spawnCoin();
  for (let i = 0; i < 2; i++) spawnHazard();
}

function spawnCoin() {
  const { width: w, height: h } = canvas;
  state.pickups.push({
    x: Math.random() * w,
    y: -10,
    vx: (Math.random() - 0.5) * (0.8 + state.speed * 0.2),
    vy: 1.2 + Math.random() * (0.6 + state.speed * 0.3),
    spin: Math.random() * Math.PI,
  });
}
function spawnHazard() {
  const { width: w, height: h } = canvas;
  const edge = Math.random() < 0.5 ? "top" : "side";
  const dir = Math.random() < 0.5 ? -1 : 1;
  state.hazards.push({
    x: edge === "top" ? Math.random() * w : dir > 0 ? -16 : w + 16,
    y: edge === "top" ? -16 : Math.random() * h,
    vx: edge === "top" ? (Math.random() - 0.5) * (1.4 + state.speed * 0.3) : dir * (1.8 + state.speed * 0.4),
    vy: edge === "top" ? (1.8 + state.speed * 0.4) : (Math.random() - 0.5) * (1.2 + state.speed * 0.3),
    rot: Math.random() * Math.PI,
    life: 60 * (6 + Math.random() * 6),
  });
}

// --------- HUD / Effects / Utils ----------
function updateHUD() {
  hudScore.textContent = state.score.toString();
  hudBest.textContent = state.best.toString();
  hudCoins.textContent = `${state.coins} ✨`;
  hudLives.textContent = `${state.lives} ❤️`;
}
function bumpScore() {
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem("kw_best", String(state.best));
  }
}
function gameOver() {
  state.running = false;
  SFX.chord([196, 164, 130], 0.6);
  overlay.classList.remove("hidden");
  overlayContent.innerHTML = `
    <h2 class="text-xl sm:text-2xl font-bold mb-2">Game Over</h2>
    <p class="text-slate-300 mb-2">Score: <b>${state.score}</b> • Best: <b>${state.best}</b></p>
    <p class="text-slate-400 text-sm mb-4">Tap play to try again.</p>
    <div class="flex gap-2 justify-center">
      <button id="againBtn" class="px-4 py-2 rounded-lg bg-emerald-500 text-slate-900 font-semibold">▶ Play Again</button>
      <button id="shareBtn" class="px-4 py-2 rounded-lg btn-ghost">📤 Share</button>
    </div>
  `;
  document.getElementById("againBtn").addEventListener("click", () => {
    overlay.classList.add("hidden");
    startGame();
  });
  document.getElementById("shareBtn").addEventListener("click", async () => {
    const text = `I scored ${state.score} in K-WORLD — Dash & Collect!`;
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
    } catch {}
  });
}
function flashRed(ms = 120) {
  const start = performance.now();
  const draw = (t) => {
    const k = Math.min(1, (t - start) / ms);
    ctx.save();
    ctx.fillStyle = `rgba(244,63,94,${0.3 * (1 - k)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (k < 1 && state.running) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

function circle(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.closePath();
}
function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}
function offScreen(o) {
  return o.x < -40 || o.x > canvas.width + 40 || o.y < -40 || o.y > canvas.height + 40;
}

// Start with overlay visible; game begins on Play
updateHUD();

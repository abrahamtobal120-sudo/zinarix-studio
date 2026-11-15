import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

/**
 * Two small canvas games offered while there is nothing to talk to (no AI provider
 * connected, or no internet): a side-scrolling dinosaur runner and a top-down board
 * ride. Both are drawn with plain shapes in the theme colors; no assets.
 */

type GameId = 'dino' | 'board';

/** True while the browser reports a network connection. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export function OfflineGames({ offline }: { offline: boolean }) {
  const [game, setGame] = useState<GameId | null>(null);
  return (
    <div className="offline-games">
      {offline && <p className="offline-games-note">{t('gamesOffline')}</p>}
      {game ? (
        <div className="offline-game">
          <GameCanvas key={game} game={game} />
          <div className="offline-game-bar">
            <span className="dim">{t(game === 'dino' ? 'gameDinoKeys' : 'gameBoardKeys')}</span>
            <button onClick={() => setGame(null)}>{t('gameClose')}</button>
          </div>
        </div>
      ) : (
        <div className="offline-games-pick">
          <span className="dim">{t('gamesWhileWaiting')}</span>
          <button onClick={() => setGame('dino')}>🦖 {t('gameDino')}</button>
          <button onClick={() => setGame('board')}>🏄 {t('gameBoard')}</button>
        </div>
      )}
    </div>
  );
}

const W = 600;
const H = 200;

function css(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function best(game: GameId): number {
  return Number(localStorage.getItem(`zinarix.game.${game}`) ?? 0) || 0;
}
function saveBest(game: GameId, score: number): void {
  if (score > best(game)) localStorage.setItem(`zinarix.game.${game}`, String(Math.floor(score)));
}

function GameCanvas({ game }: { game: GameId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    canvas.focus();
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const stop = (game === 'dino' ? dinoGame : boardGame)(canvas, ctx);
    return stop;
  }, [game]);
  return (
    <canvas
      ref={ref}
      className="offline-game-canvas"
      tabIndex={0}
      style={{ aspectRatio: `${W} / ${H}` }}
    />
  );
}

/** Shared loop: keyboard/pointer input, pause when the canvas loses focus. */
function loop(
  canvas: HTMLCanvasElement,
  step: (dt: number) => void,
  onKey: (key: string, down: boolean) => void,
  /** `move` is true for a drag with the button held (not a new press). */
  onPointer: (y: number, down: boolean, move: boolean) => void,
): () => void {
  let raf = 0;
  let last = performance.now();
  let paused = false;
  const held = new Set<string>();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!paused) step(dt);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const kd = (e: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    // Auto-repeat is not a new press (it would restart the game the instant you lose).
    if (e.repeat) return;
    held.add(e.key);
    onKey(e.key, true);
  };
  const ku = (e: KeyboardEvent) => {
    held.delete(e.key);
    onKey(e.key, false);
  };
  // Focus elsewhere: keyup never arrives, so release everything and pause.
  const blur = () => {
    paused = true;
    for (const k of held) onKey(k, false);
    held.clear();
    onPointer(0, false, false);
  };
  const focus = () => {
    paused = false;
    last = performance.now();
  };
  const y = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientY - r.top) / r.height) * H;
  };
  const pd = (e: PointerEvent) => {
    canvas.focus();
    canvas.setPointerCapture(e.pointerId);
    onPointer(y(e), true, false);
  };
  const pm = (e: PointerEvent) => {
    if (e.buttons) onPointer(y(e), true, true);
  };
  const pu = (e: PointerEvent) => onPointer(y(e), false, false);
  canvas.addEventListener('keydown', kd);
  canvas.addEventListener('keyup', ku);
  canvas.addEventListener('pointerdown', pd);
  canvas.addEventListener('pointermove', pm);
  canvas.addEventListener('pointerup', pu);
  canvas.addEventListener('blur', blur);
  canvas.addEventListener('focus', focus);
  return () => {
    cancelAnimationFrame(raf);
    canvas.removeEventListener('keydown', kd);
    canvas.removeEventListener('keyup', ku);
    canvas.removeEventListener('pointerdown', pd);
    canvas.removeEventListener('pointermove', pm);
    canvas.removeEventListener('pointerup', pu);
    canvas.removeEventListener('blur', blur);
    canvas.removeEventListener('focus', focus);
  };
}

function hud(ctx: CanvasRenderingContext2D, fg: string, score: number, hi: number): void {
  ctx.fillStyle = fg;
  ctx.font = '600 13px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`HI ${String(Math.floor(hi)).padStart(5, '0')}   ${String(Math.floor(score)).padStart(5, '0')}`, W - 12, 22);
  ctx.textAlign = 'left';
}

function banner(ctx: CanvasRenderingContext2D, fg: string, title: string, sub: string): void {
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.font = '700 18px system-ui, sans-serif';
  ctx.fillText(title, W / 2, H / 2 - 6);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(sub, W / 2, H / 2 + 16);
  ctx.textAlign = 'left';
}

/* ───────────── Dino runner ───────────── */

type Obstacle = { x: number; w: number; h: number; y: number; kind: 'rock' | 'bird' };

function dinoGame(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): () => void {
  const GROUND = H - 34;
  const fg = css('--fg', '#c8ccd4');
  const dim = css('--fg-dim', '#8a8f9a');
  const brand = css('--brand', '#7c6cff');
  const ok = css('--ok', '#83d6a0');
  let state: 'ready' | 'run' | 'over' = 'ready';
  let y = 0; // height above the ground
  let vy = 0;
  let ducking = false;
  let speed = 320;
  let score = 0;
  let hi = best('dino');
  let obstacles: Obstacle[] = [];
  let nextGap = 400;
  let t0 = 0;
  const clouds = Array.from({ length: 4 }, (_, i) => ({ x: i * 170 + 40, y: 30 + (i % 2) * 30 }));

  const reset = () => {
    state = 'run';
    y = 0;
    vy = 0;
    speed = 320;
    score = 0;
    obstacles = [];
    nextGap = 400;
  };
  const jump = () => {
    if (state !== 'run') return reset();
    if (y === 0) vy = 640;
  };

  const spawn = () => {
    const bird = score > 250 && Math.random() < 0.3;
    if (bird) {
      const high = Math.random() < 0.5;
      obstacles.push({ x: W + 20, w: 34, h: 18, y: high ? 52 : 26, kind: 'bird' });
    } else {
      const n = 1 + Math.floor(Math.random() * (score > 400 ? 3 : 2));
      obstacles.push({ x: W + 20, w: 14 * n + 4, h: 24 + Math.random() * 18, y: 0, kind: 'rock' });
    }
    nextGap = 260 + Math.random() * 260 + speed * 0.35;
  };

  const drawDino = (px: number, py: number) => {
    const top = GROUND - py;
    const leg = state === 'run' && py === 0 ? Math.floor(t0 * 12) % 2 : 0;
    ctx.fillStyle = ok;
    if (ducking && py === 0) {
      ctx.beginPath();
      ctx.roundRect(px - 6, top - 22, 54, 20, 8);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(px + 34, top - 30, 24, 16, 6);
      ctx.fill();
      ctx.fillStyle = '#1a1b1e';
      ctx.fillRect(px + 50, top - 26, 3, 3);
    } else {
      // tail
      ctx.beginPath();
      ctx.moveTo(px - 14, top - 26);
      ctx.lineTo(px + 4, top - 34);
      ctx.lineTo(px + 4, top - 22);
      ctx.fill();
      // body + neck + head
      ctx.beginPath();
      ctx.roundRect(px, top - 40, 30, 26, 10);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(px + 16, top - 56, 26, 20, 7);
      ctx.fill();
      // back plates
      ctx.fillStyle = brand;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(px + 2 + i * 8, top - 38);
        ctx.lineTo(px + 6 + i * 8, top - 46 + i * 2);
        ctx.lineTo(px + 10 + i * 8, top - 38);
        ctx.fill();
      }
      ctx.fillStyle = '#1a1b1e';
      ctx.fillRect(px + 34, top - 51, 3, 3);
      ctx.fillStyle = ok;
    }
    // legs
    ctx.fillRect(px + 6, top - 14, 6, leg ? 8 : 14);
    ctx.fillRect(px + 18, top - 14, 6, leg ? 14 : 8);
  };

  const drawObstacle = (o: Obstacle) => {
    if (o.kind === 'rock') {
      ctx.fillStyle = dim;
      const n = Math.round((o.w - 4) / 14);
      for (let i = 0; i < n; i++) {
        const h = o.h - (i % 2) * 6;
        ctx.beginPath();
        ctx.roundRect(o.x + i * 14, GROUND - h, 16, h, [7, 7, 2, 2]);
        ctx.fill();
      }
    } else {
      const flap = Math.floor(t0 * 6) % 2;
      const by = GROUND - o.y - o.h;
      ctx.fillStyle = brand;
      ctx.beginPath();
      ctx.ellipse(o.x + 17, by + 10, 15, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(o.x + 10, by + 8);
      ctx.lineTo(o.x + 18, flap ? by - 8 : by + 26);
      ctx.lineTo(o.x + 24, by + 8);
      ctx.fill();
    }
  };

  const hit = (o: Obstacle) => {
    const px = 50;
    const top = ducking && y === 0 ? 30 : 56;
    const a = { l: px + 2, r: px + (ducking && y === 0 ? 54 : 40), b: y + 2, t: y + top - 4 };
    const bl = o.x + 3;
    const br = o.x + o.w - 3;
    const bb = o.y + 2;
    const bt = o.y + o.h - 2;
    return a.l < br && a.r > bl && a.b < bt && a.t > bb;
  };

  const step = (dt: number) => {
    t0 += dt;
    if (state === 'run') {
      speed += dt * 6;
      score += dt * speed * 0.03;
      vy -= 1900 * dt;
      y = Math.max(0, y + vy * dt);
      if (y === 0) vy = 0;
      for (const o of obstacles) o.x -= speed * dt;
      obstacles = obstacles.filter((o) => o.x + o.w > -10);
      const lastX = obstacles.at(-1)?.x ?? -Infinity;
      if (W + 20 - lastX >= nextGap) spawn();
      for (const c of clouds) {
        c.x -= speed * dt * 0.15;
        if (c.x < -60) c.x = W + Math.random() * 80;
      }
      if (obstacles.some(hit)) {
        state = 'over';
        saveBest('dino', score);
        hi = Math.max(hi, score);
      }
    }
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = dim;
    ctx.globalAlpha = 0.35;
    for (const c of clouds) {
      ctx.beginPath();
      ctx.roundRect(c.x, c.y, 46, 12, 6);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillRect(0, GROUND, W, 1.5);
    for (let i = 0; i < 20; i++) {
      const gx = (((i * 53 - t0 * (state === 'run' ? speed : 0)) % W) + W) % W;
      ctx.fillRect(gx, GROUND + 6 + (i % 3) * 5, 3 + (i % 4), 1.5);
    }
    obstacles.forEach(drawObstacle);
    drawDino(50, y);
    hud(ctx, fg, score, hi);
    if (state === 'ready') banner(ctx, fg, t('gameDino'), t('gameStart'));
    if (state === 'over') banner(ctx, fg, t('gameOver'), t('gameRetry'));
  };

  return loop(
    canvas,
    step,
    (key, down) => {
      if (down && (key === ' ' || key === 'ArrowUp' || key === 'w')) jump();
      if (key === 'ArrowDown' || key === 's') {
        ducking = down && state === 'run';
        if (down && y > 0) vy = Math.min(vy, -700);
      }
    },
    (_y, down, move) => {
      if (down && !move) jump();
    },
  );
}

/* ───────────── Board ride (top-down) ───────────── */

type Thing = { x: number; y: number; r: number; kind: 'rock' | 'buoy' | 'star' };

function boardGame(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): () => void {
  // The ride goes left to right: the rider stays near the left, the sea flows past.
  const fg = css('--fg', '#c8ccd4');
  const brand = css('--brand', '#7c6cff');
  const warn = css('--warn', '#e0b341');
  const danger = css('--danger', '#f1595b');
  let state: 'ready' | 'run' | 'over' = 'ready';
  let py = H / 2;
  let target: number | null = null;
  let up = false;
  let down = false;
  let speed = 220;
  let score = 0;
  let lives = 3;
  let hurt = 0;
  let hi = best('board');
  let things: Thing[] = [];
  let spawnIn = 0;
  let t0 = 0;
  const PX = 90;

  const reset = () => {
    state = 'run';
    py = H / 2;
    speed = 220;
    score = 0;
    lives = 3;
    hurt = 0;
    things = [];
  };

  const spawn = () => {
    const r = Math.random();
    const kind: Thing['kind'] = r < 0.22 ? 'star' : r < 0.6 ? 'buoy' : 'rock';
    things.push({
      x: W + 30,
      y: 20 + Math.random() * (H - 40),
      r: kind === 'rock' ? 12 + Math.random() * 10 : kind === 'buoy' ? 9 : 8,
      kind,
    });
    spawnIn = Math.max(0.28, 0.9 - speed / 900) * (0.6 + Math.random() * 0.8);
  };

  const step = (dt: number) => {
    t0 += dt;
    if (state === 'run') {
      speed += dt * 5;
      score += dt * speed * 0.03;
      const v = 260;
      if (up) py -= v * dt;
      if (down) py += v * dt;
      if (target !== null) py += Math.sign(target - py) * Math.min(Math.abs(target - py), v * dt);
      py = Math.max(16, Math.min(H - 16, py));
      hurt = Math.max(0, hurt - dt);
      spawnIn -= dt;
      if (spawnIn <= 0) spawn();
      for (const o of things) o.x -= speed * dt;
      things = things.filter((o) => {
        if (o.x < -40) return false;
        const d = Math.hypot(o.x - PX, o.y - py);
        if (d > o.r + 12) return true;
        if (o.kind === 'star') {
          score += 25;
          return false;
        }
        if (hurt > 0) return true;
        lives -= 1;
        hurt = 1.2;
        if (lives <= 0) {
          state = 'over';
          saveBest('board', score);
          hi = Math.max(hi, score);
        }
        return false;
      });
    }

    // sea
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(42, 123, 214, 0.18)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    const off = (t0 * (state === 'run' ? speed : 40)) % 80;
    for (let row = 0; row < 6; row++) {
      ctx.beginPath();
      for (let x = -80; x < W + 80; x += 80) {
        const sx = x - off + (row % 2) * 40;
        const sy = 18 + row * 34;
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + 10, sy - 6, sx + 20, sy);
      }
      ctx.stroke();
    }

    for (const o of things) {
      if (o.kind === 'rock') {
        ctx.fillStyle = '#6b6f7a';
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, o.r, o.r * 0.8, 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, o.r + 4, o.r * 0.8 + 4, 0.4, 0, Math.PI * 2);
        ctx.stroke();
      } else if (o.kind === 'buoy') {
        ctx.fillStyle = danger;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(o.x - o.r, o.y - 2, o.r * 2, 4);
      } else {
        ctx.fillStyle = warn;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (i * Math.PI) / 5 - Math.PI / 2 + t0 * 2;
          const rr = i % 2 ? o.r * 0.45 : o.r;
          ctx.lineTo(o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr);
        }
        ctx.fill();
      }
    }

    // rider on the board
    if (!(hurt > 0 && Math.floor(t0 * 10) % 2)) {
      const tilt = (up ? -0.25 : down ? 0.25 : 0) + (target !== null ? Math.sign(target - py) * 0.2 : 0);
      ctx.save();
      ctx.translate(PX, py);
      ctx.rotate(tilt);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(-30, -6);
      ctx.lineTo(-48, -10);
      ctx.moveTo(-30, 6);
      ctx.lineTo(-48, 10);
      ctx.stroke();
      ctx.fillStyle = brand;
      ctx.beginPath();
      ctx.ellipse(0, 0, 26, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f2c6a0';
      ctx.beginPath();
      ctx.arc(2, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a2a1e';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    hud(ctx, fg, score, hi);
    ctx.fillStyle = danger;
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('♥'.repeat(Math.max(0, lives)), 12, 22);
    if (state === 'ready') banner(ctx, fg, t('gameBoard'), t('gameStart'));
    if (state === 'over') banner(ctx, fg, t('gameOver'), t('gameRetry'));
  };

  return loop(
    canvas,
    step,
    (key, isDown) => {
      if (key === 'ArrowUp' || key === 'w') up = isDown;
      if (key === 'ArrowDown' || key === 's') down = isDown;
      if (isDown && key === ' ' && state !== 'run') reset();
      if (isDown && (key === 'ArrowUp' || key === 'ArrowDown') && state === 'ready') reset();
    },
    (y, isDown, move) => {
      if (isDown && !move && state !== 'run') return reset();
      target = isDown ? y : null;
    },
  );
}

import '@fontsource/grenze-gotisch/600.css';
import '@fontsource/alegreya-sans/500.css';
import '@fontsource/alegreya-sans/700.css';
import '@fontsource/alegreya-sans/800.css';
import './styles.css';
import Phaser from 'phaser';
import { Sfx } from './audio/sfx';
import { Controls } from './input/controls';
import { SaveStore } from './meta/save';
import { registerServiceWorker } from './pwa/register';
import { BootScene } from './scenes/BootScene';
import { GameScene, type Services } from './scenes/GameScene';
import { Hud } from './ui/hud';

/** Render at device resolution (capped at 2× to protect fill-rate on phones). */
const dpr = (): number => Math.min(window.devicePixelRatio || 1, 2);

const el = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id) as T | null;
  if (!e) throw new Error(`#${id} missing`);
  return e;
};

async function boot(): Promise<void> {
  // Damage numbers are drawn on the canvas, so the face must be ready first.
  const fonts = Promise.all([document.fonts.load('800 20px "Alegreya Sans"'), document.fonts.load('600 40px "Grenze Gotisch"')]);
  const save = new SaveStore();
  await Promise.all([Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]), save.load()]);

  const app = el('app');
  const hud = new Hud();
  const sfx = new Sfx();
  const controls = new Controls(el('stick-zone'), el('stick'), el('stick-knob'), el('btn-dodge'), [el('btn-skill'), el('btn-skill2'), el('btn-skill3')]);
  const services: Services = { hud, controls, sfx, save, dpr };

  // Any gesture anywhere may unlock / resume audio (iOS needs a gesture after every interruption).
  for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) {
    window.addEventListener(type, () => sfx.unlock(), { capture: true, passive: true });
  }

  const size = () => ({ w: Math.max(1, app.clientWidth), h: Math.max(1, app.clientHeight) });
  const s0 = size();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#07080a',
    scale: { mode: Phaser.Scale.NONE, width: s0.w * dpr(), height: s0.h * dpr(), zoom: 1 / dpr() },
    render: { antialias: true, powerPreference: 'high-performance' },
    // All input is handled by the DOM layer (src/input/controls.ts).
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    audio: { noAudio: true },
    disableContextMenu: true,
    banner: false,
    callbacks: {
      preBoot: (g) => g.registry.set('services', services),
    },
    scene: [BootScene, GameScene],
  });

  const fit = () => {
    const { w, h } = size();
    const d = dpr();
    game.scale.setZoom(1 / d);
    game.scale.resize(Math.round(w * d), Math.round(h * d));
    // ScaleManager.resize skips the CSS size when zoom is 1, so pin it explicitly.
    game.canvas.style.width = `${w}px`;
    game.canvas.style.height = `${h}px`;
  };
  new ResizeObserver(fit).observe(app);
  window.addEventListener('orientationchange', () => setTimeout(fit, 250));

  // Test / debug hook: read-only access for automated browser tests.
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('test')) {
    (window as unknown as { __abyss: unknown }).__abyss = {
      game,
      sfx,
      save,
      get scene() {
        return game.scene.getScene('game') as GameScene;
      },
    };
  }

  registerServiceWorker();
}

void boot().catch((err: unknown) => {
  console.error(err);
  const box = document.getElementById('fatal');
  if (box) {
    box.hidden = false;
    box.querySelector('p')!.textContent = 'Nie udało się uruchomić gry. Twoja przeglądarka może nie obsługiwać WebGL.';
  }
});

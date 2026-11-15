import './ui/styles.css';
import { Game } from './core/Game';
import { installDebugAPI } from './debug/DebugAPI';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

const loading = document.createElement('div');
loading.className = 'loading';
loading.innerHTML = `<div class="loading-box"><div class="loading-title">Tiger</div><div class="loading-bar"><div class="loading-fill"></div></div><div class="loading-label">Načítání…</div></div>`;
ui.appendChild(loading);
const fill = loading.querySelector('.loading-fill') as HTMLDivElement;
const label = loading.querySelector('.loading-label') as HTMLDivElement;

async function boot(): Promise<void> {
  const game = new Game(canvas);
  installDebugAPI(game);
  game.onLoadProgress = (text, f) => {
    fill.style.width = `${Math.round(f * 100)}%`;
    label.textContent = text;
  };
  await game.init();
  loading.remove();
  game.setState('playing');
  game.start();
}

boot().catch((err) => {
  console.error(err);
  label.textContent = 'Hru se nepodařilo spustit: ' + (err instanceof Error ? err.message : String(err));
});

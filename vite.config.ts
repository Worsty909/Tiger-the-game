import { defineConfig, type Plugin } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Sloty pro vlastní zvuky: soubory `public/audio/<název>.ogg` přepíší procedurální syntézu.
 * Seznam souborů se vloží do bundlu jako virtuální modul (žádné 404 při zjišťování za běhu).
 */
function audioSlots(): Plugin {
  const id = 'virtual:tiger-audio';
  const resolved = '\0' + id;
  const dir = resolve(import.meta.dirname, 'public/audio');
  const list = () => (existsSync(dir) ? readdirSync(dir).filter((f) => /\.(ogg|mp3|wav)$/i.test(f)) : []);
  return {
    name: 'tiger-audio-slots',
    resolveId(source) {
      return source === id ? resolved : null;
    },
    load(loadId) {
      return loadId === resolved ? `export const slots = ${JSON.stringify(list())};` : null;
    },
    configureServer(server) {
      server.watcher.add(dir);
      const refresh = (file: string) => {
        if (!file.startsWith(dir)) return;
        const mod = server.moduleGraph.getModuleById(resolved);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', refresh);
      server.watcher.on('unlink', refresh);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [audioSlots()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 9000,
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});

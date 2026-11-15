# PLAN – 3D úniková hra „Tiger“

Cíl: po `npm install && npm run dev` hratelná hra od úvodu až po balkon. Jedna vyladěná místnost
(obývák s kuchyňským koutem), realistické světlo, procedurálně animovaná bengálka Tiger, 8 kroků
hádanek + tajemství.

## Technologie

- Vite + TypeScript + Three.js (WebGL2), fyzika Rapier (`@dimforge/rapier3d-compat`),
  post-processing `postprocessing` + `n8ao`.
- Assety CC0 z Poly Haven (stahuje `tools/fetch_assets.mjs`, jsou i přímo v repozitáři).
- Rig Tigera: varianta A (Blender/`bpy` skript `tools/rig_tiger.py` → `public/models/tiger_rigged.glb`),
  varianta B (rig za běhu v `src/cat/RuntimeRig.ts`) jako fallback, který funguje vždy.

## Milníky

### M1 – místnost, materiály, osvětlení, pohyb provizorního Tigera
- [ ] Kostra projektu (Vite, TS, struktura `src/core|world|cat|puzzles|ui|debug`).
- [ ] Jádro: smyčka s pevným krokem fyziky, vstupy (klávesnice, myš, gamepad), nastavení, assety.
- [ ] Místnost 6 × 5 × 2,7 m v reálném měřítku: stěny, okno s parapetem, balkonové dveře, balkon.
- [ ] Nábytek a rekvizity (Poly Haven + procedurální geometrie se zkosenými hranami).
- [ ] PBR materiály (Poly Haven textury + procedurální náhrady).
- [ ] Světlo: slunce se stíny, fáze západu, HDRI obloha, město za oknem, GI (mřížka světelných
      sond), odrazová sonda místnosti, vnitřní světla.
- [ ] Post-processing: N8AO, bloom, SMAA, AgX, grading, vinětace, zrno, DOF, god rays, prach.
- [ ] Fyzika: statické kolize, dynamické předměty, kinematický controller (provizorní kapsle).
- [ ] Kamera třetí osoby s kolizemi.
- [ ] Ověření: `npm run build`, Playwright screenshoty, kontrola konzole.

### M2 – model Tigera, rig, procedurální animace, srst
- [ ] Normalizace modelu (orientace +Z, tlapky na Y = 0, reálná velikost), oprava sítě.
- [ ] Varianta A: `tools/rig_tiger.py` (analýza tvaru, kostra, automatic weights, export GLB).
- [ ] Varianta B: runtime rig (průřezy sítě, váhy podle vzdálenosti k úsečkám kostí, max 4 vlivy).
- [ ] Procedurální animace: chůze/klus/běh, foot IK, páteř, skok (přikrčení, odraz, let, dopad),
      sezení, plížení, švih tlapkou, čichání, olizování, dýchání, ocas (pružiny), look-at, uši.
- [ ] Shell fur (16–32 vrstev), sheen, glitter, oči s clearcoatem a tapetum lucidum.
- [ ] Ověření: screenshoty póz a pohybu.

### M3 – hádanky včetně tajemství
- [ ] Datově řízený graf hádanek se závislostmi, každý krok vlastní modul.
- [ ] Interakce E/F, mířený skok s obloukem, kočičí smysly (pach, zvuk, noční vidění).
- [ ] Kroky 1–8: čich → lísteček → falešné stopy → průkaz pod gaučem → parkour a fotka →
      kódový zámek → vysavač a balkonové dveře → finále.
- [ ] Tajemství: zlatý pamlsek přes houpající se svítidlo, achievement „Král výšek“.
- [ ] Ověření: průchod každým krokem přes debug API.

### M4 – UI, zvuk, ukládání
- [ ] Hlavní menu s živou scénou, nastavení, ovládání, pauza, deník, nápovědy, titulky, výzvy.
- [ ] Procedurální zvuk (Web Audio, PannerNode), sloty `public/audio/*.ogg`, ambientní hudba.
- [ ] Autosave do localStorage, Pokračovat.
- [ ] Úvodní scéna a závěrečné titulky se statistikou.

### M5 – vizuální ladění a výkon
- [ ] Iterace světla, materiálů, kompozice podle screenshotů.
- [ ] Předvolby kvality Nízká/Střední/Vysoká/Ultra, měření FPS, optimalizace (instancing,
      rozlišení stínů, culling).
- [ ] Automatický průchod celou hrou (`tools/playthrough.mjs`), konzole bez chyb.
- [ ] `README.md`, `CREDITS.md`, `DECISIONS.md`.

## Ověřování

Po každém milníku: `npm run build` bez chyb + Playwright (headless Chromium, WebGL přes
SwiftShader) se screenshoty do `screenshots/`. Nástroje: `tools/screenshots.mjs`,
`tools/playthrough.mjs`, `tools/fps.mjs`.

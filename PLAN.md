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
- [x] Kostra projektu (Vite, TS, struktura `src/core|world|cat|puzzles|ui|debug`).
- [x] Jádro: smyčka s pevným krokem fyziky, vstupy (klávesnice, myš, gamepad), nastavení, assety.
- [x] Místnost 6 × 5 × 2,7 m v reálném měřítku: stěny, okno s parapetem, balkonové dveře, balkon.
- [x] Nábytek a rekvizity (Poly Haven + procedurální geometrie se zkosenými hranami).
- [x] PBR materiály (Poly Haven textury + procedurální náhrady).
- [x] Světlo: slunce se stíny, fáze západu, HDRI obloha, město za oknem, GI (mřížka světelných
      sond), odrazová sonda místnosti, vnitřní světla.
- [x] Post-processing: N8AO, bloom, SMAA, AgX, grading, vinětace, zrno, DOF, god rays, prach.
- [x] Fyzika: statické kolize, dynamické předměty, kinematický controller (provizorní kapsle).
- [x] Kamera třetí osoby s kolizemi.
- [x] Ověření: `npm run build`, Playwright screenshoty, kontrola konzole.

### M2 – model Tigera, rig, procedurální animace, srst
- [x] Normalizace modelu (orientace +Z, tlapky na Y = 0, reálná velikost), oprava sítě.
- [x] Varianta A: `tools/rig_tiger.py` (analýza tvaru, kostra, automatic weights, export GLB).
- [x] Varianta B: runtime rig (průřezy sítě, váhy podle vzdálenosti k úsečkám kostí, max 4 vlivy).
- [x] Procedurální animace: chůze/klus/běh, foot IK, páteř, skok (přikrčení, odraz, let, dopad),
      sezení, plížení, švih tlapkou, čichání, olizování, dýchání, ocas (pružiny), look-at, uši.
- [x] Shell fur (16–32 vrstev), sheen, glitter, oči s clearcoatem a tapetum lucidum.
- [x] Ověření: screenshoty póz a pohybu.

### M3 – hádanky včetně tajemství
- [x] Datově řízený graf hádanek se závislostmi, každý krok vlastní modul.
- [x] Interakce E/F, mířený skok s obloukem, kočičí smysly (pach, zvuk, noční vidění).
- [x] Kroky 1–8: čich → lísteček → falešné stopy → průkaz pod gaučem → parkour a fotka →
      kódový zámek → vysavač a balkonové dveře → finále.
- [x] Tajemství: zlatý pamlsek přes houpající se svítidlo, achievement „Král výšek“.
- [x] Ověření: průchod každým krokem přes debug API.

### M4 – UI, zvuk, ukládání
- [x] Hlavní menu s živou scénou, nastavení, ovládání, pauza, deník, nápovědy, titulky, výzvy.
- [x] Procedurální zvuk (Web Audio, PannerNode), sloty `public/audio/*.ogg`, ambientní hudba.
- [x] Autosave do localStorage, Pokračovat.
- [x] Úvodní scéna a závěrečné titulky se statistikou.

### M5 – vizuální ladění a výkon
- [x] Iterace světla, materiálů, kompozice podle screenshotů.
- [x] Předvolby kvality Nízká/Střední/Vysoká/Ultra, měření FPS, optimalizace (instancing,
      rozlišení stínů, culling).
- [x] Automatický průchod celou hrou (`tools/playthrough.mjs`), konzole bez chyb.
- [x] `README.md`, `CREDITS.md`, `DECISIONS.md`.

## Ověřování

Po každém milníku: `npm run build` bez chyb + Playwright (headless Chromium, WebGL přes
SwiftShader) se screenshoty do `screenshots/`. Nástroje: `tools/screenshots.mjs`,
`tools/playthrough.mjs`, `tools/fps.mjs`.

## Stav

Všechny milníky M1–M5 jsou hotové.

| Co | Jak ověřeno | Výsledek |
| --- | --- | --- |
| Sestavení | `npm run build` (kontrola typů + Vite) | bez chyb |
| Spuštění | `npm run dev` → menu → Nová hra → intro | běží, konzole bez chyb |
| Průchod hrou | `npm run test:playthrough` – 78 kontrol: dosažitelnost skoků, všech 8 kroků skutečnými vstupy, tajemství, nápovědy, autosave, finále | **PRŮCHOD HROU: OK**, konzole bez chyb |
| Klíčové záběry | `npm run test:shots` – 16 záběrů (`screenshots/01_…16_`) na předvolbě Střední | prohlédnuto a laděno v několika iteracích |
| Výkon | `npm run test:fps` na předvolbě Vysoká | viz README, oddíl Výkon |

Co se v tomto prostředí ověřit nedalo: FPS na skutečné grafické kartě (testy běží na softwarovém
rasterizéru) a poslech zvuku. Obojí je popsáno v README.

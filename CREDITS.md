# CREDITS

## Model Tigera

- `public/models/tiger.glb` – model bengálské kočky dodaný se zadáním (vznikl z referenční fotky
  skutečného Tigera). V repozitáři je uložen beze změny.
- `public/models/tiger_rigged.glb` – tentýž model po normalizaci, opravě sítě a rigování skriptem
  `tools/rig_tiger.py` (Blender / `bpy`, 35 kostí, automatické váhy).

## Poly Haven (CC0)

Všechny převzaté modely, textury a HDRI pocházejí z [Poly Haven](https://polyhaven.com) a jsou
pod licencí [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) – volné dílo, uvedení
autora se nevyžaduje. Stahuje je `tools/fetch_assets.mjs` podle `tools/assets.manifest.json`
do `public/assets/`.

### Modely (`public/assets/models/`, glTF, textury 1k)

| ID na Poly Haven | Kde ve hře |
| --- | --- |
| `Sofa_01` | pohovka |
| `Ottoman_01` | taburet (posouvá se pod parapet) |
| `modern_coffee_table_01` | konferenční stolek |
| `bar_chair_round_01` | barová židle u pultu |
| `modern_arm_chair_01` | křeslo |
| `potted_plant_02`, `potted_plant_04` | pokojové rostliny |
| `throw_pillows_01` | polštáře na pohovce |
| `ceramic_vase_01`, `ceramic_vase_03` | vázy |
| `book_encyclopedia_set_01` | encyklopedie v knihovně |
| `wicker_basket_01` | koš na prádlo |
| `rubber_boots` | bota v cestě vysavači |
| `wall_clock` | nástěnné hodiny |

### Textury (`public/assets/textures/`, PBR sady 1k–2k)

| ID na Poly Haven | Kde ve hře |
| --- | --- |
| `herringbone_parquet` | dubové parkety |
| `white_plaster_02` | stěny a strop |
| `wool_boucle` | koberec |
| `long_white_tiles` | kuchyňský obklad |
| `marble_01` | dlažba v kuchyni |
| `large_grey_tiles` | dlažba balkonu |
| `oak_veneer_01`, `walnut_veneer` | dýhy nábytku (knihovna, komoda, TV stolek, skříňky) |
| `rough_linen` | látky (stínidla, textilie) |
| `clay_roof_tiles_02` | střechy města |
| `concrete_tiles` | beton (balkon, exteriér) |
| `yellow_plaster` | fasády domů |

### HDRI (`public/assets/hdri/`, 1k–2k)

| ID na Poly Haven | Kde ve hře |
| --- | --- |
| `qwantani_sunset_puresky` | obloha při západu slunce |
| `qwantani_dusk_1_puresky` | růžový soumrak |
| `qwantani_dusk_2_puresky` | modrá hodinka |

## Vlastní tvorba (součást tohoto repozitáře)

- Veškerý kód hry, shadery (srst, obloha, god rays, grading, kočičí smysly) a nástroje.
- Procedurální geometrie: místnost, okno, balkon, kuchyň, lednice, knihovna, komoda, TV, police,
  svítidla, radiátor, krmítko, vysavač, kódový zámek a drobné rekvizity.
- Procedurální textury a kresby: lísteček, kalendář, svatební fotka, očkovací průkaz, rub fotky,
  etikety, displeje (`src/world/Labels.ts`, `src/world/ProcTextures.ts`).
- Zvuky a hudba: procedurální syntéza přes Web Audio (`src/core/Audio.ts`).

## Knihovny

| Knihovna | Licence |
| --- | --- |
| [three.js](https://threejs.org) | MIT |
| [@dimforge/rapier3d-compat](https://rapier.rs) | Apache-2.0 |
| [postprocessing](https://github.com/pmndrs/postprocessing) | Zlib |
| [n8ao](https://github.com/N8python/n8ao) | ISC |
| [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org), [Playwright](https://playwright.dev) (vývoj a testy) | MIT / Apache-2.0 |

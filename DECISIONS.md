# DECISIONS – rozhodnutí nad rámec zadání

Vše, co zadání nechalo otevřené, je rozhodnuto tak, aby to podpořilo realismus a hratelnost.

## Rozvržení místnosti

- Místnost 6 × 5 × 2,7 m, souřadnice X ∈ [−3, 3] (západ → východ), Z ∈ [−2,5; 2,5] (sever → jih).
  Všechny rozměry jsou v `src/world/Layout.ts`.
- **Západní stěna** (zapadá za ní slunce): okno s parapetem (nad radiátorem) u SZ rohu, uprostřed
  balkonové dveře, u JZ rohu komoda. Balkon je za západní stěnou – závěrečný pohled míří přímo do západu.
- **Severní stěna**: závěsná police u okna → knihovna 2,2 m → kalendář → kuchyňská linka → lednice v SV rohu.
- **Kuchyň** je do L: linka u severní stěny + poloostrov s dřezem a barovou židlí. Závěsné svítidlo
  visí nad poloostrovem, mezi knihovnou a horními skříňkami (kvůli tajné cestě ke zlatému pamlsku).
- **Obývací část** na jihu: gauč zády ke kuchyni, konferenční stolek, TV na jižní stěně, křeslo, lampa.
- Za gaučem vede volný pruh od východní stěny (dokovací stanice vysavače) k balkonovým dveřím –
  v něm leží bota a koš na prádlo.
- Balkonové dveře se otevírají **ven** a závěsy mají na severní hraně, aby je vysavač nárazem mohl dorazit.

## Skok

- Zadání říká „max ~1,6 m výšky“. Aby dávala smysl cesta „na linku přes barovou židli“ a „taburet pod
  parapet“, je to vyloženo jako **dosah tlapek ve výskoku** (~1,5 m: švih po magnetu na lednici).
  Těžiště vystoupá max ~0,9 m (odrazová rychlost 4,2 m/s), dopadnout lze na plochu do +0,86 m.
- Díky tomu: ze země nelze vyskočit na linku (0,92 m), komodu (0,88 m) ani parapet (0,98 m);
  barová židle (sedák 0,64 m – model je zmenšen na 88 %), taburet (0,47 m) a gauč jsou dostupné přímo.
- Na hřeben opěradla gauče, digestoř, stínidla, květináče apod. se nedá postavit (plochy „noStand“) –
  jinak by šly hádanky obejít (z opěradla by se dalo na parapet bez taburetu).
- Krátký stisk mezerníku = skok vpřed; pokud je před Tigerem hrana, na kterou dosáhne, skočí sám na ni.
- **Mířený skok je deterministický:** řešič najde balistický oblouk (včetně rychlosti pohyblivé
  plošiny – police, svítidlo, vysavač), ověří ho proti kolizím a Tiger pak letí přesně po něm.
  Co oblouk ukáže zeleně, to Tiger doskočí; fyzika do letu nezasahuje.
- Parkour vede taburet → parapet → závěsná police → knihovna. Police visí ve výšce 1,68 m, aby byl
  skok z parapetu (0,98 m) právě v dosahu; po dopadu se rozhoupe a po 2 s se nakloní tak, že Tiger sklouzne.
- Závěsné svítidlo se po dopadu rozkývá (kyvadlo, max ±0,38 rad) a dokud na něm Tiger sedí, kývání
  neuhasne – okno pro odraz ke skříňkám se tedy vždy vrátí.

## Světlo a rendering

- Globální osvětlení: mřížka světelných sond (`LightProbeGridWebGL`, novinka Three.js r187) zapékaná
  za běhu, při změně fáze západu se přepočítá inkrementálně do zadní mřížky a pak se prohodí.
  Na předvolbě Nízká se místo ní použije IBL z odrazové sondy (a nižší expozice).
- Odrazy: krychlová sonda uprostřed místnosti → PMREM → `scene.environment`.
- Obloha: tři HDRI z Poly Haven (qwantani sunset / dusk), mezi kterými se prolíná; sluneční kotouč
  a jeho záře jsou dokresleny procedurálně, aby seděly s výškou herního slunce.
- God rays: ray-marching proti stínové mapě slunce v polovičním rozlišení + rozmazání.
- Statická geometrie se po postavení slučuje podle materiálu (cca 600 → 250 draw calls).
- „Kamera“ dělá částečné vyvážení bílé jen do té míry, do jaké scéně dominuje slunce, a čím je
  světlo teplejší, tím méně – polední světlo je neutrální, západ zůstává oranžový.
- **Fáze západu:** 9 fází (`PHASES` v `src/world/Lighting.ts`). Úvod = fáze 0 (slunce 13°, 4500 K),
  každý vyřešený krok posune o jednu: pach 1, lísteček 2, falešné stopy 3, průkaz 4, fotka 5
  (2500 K), zámek 6, vysavač 7 (1900 K, slunce 5,6° těsně nad střechami). Fáze 8 (modrá hodinka)
  nastupuje až během finále. Expozice s fázemi klesá – večer je v pokoji opravdu šero a svítí lampy
  (stojací od fáze 3, podsvícení linky od 4, závěsné svítidlo od 6).
- Výšky slunce jsou o něco větší než „fyzikálně správné“ pro dané barevné teploty: jinak by slunce
  zmizelo za střechami města dřív, než Tiger vyjde na balkon, a finále by nemělo co ukázat.
- DOF je zapnutý jen v detailech (čtení stop, zámek) a ve finále.

## Herní tok, UI a ukládání

- **Finále:** kamera stojí ve dveřích na balkon a dívá se přímo na západ. Tiger sedí v pravé třetině
  obrazu, slunce zapadá za střechy a věž kostela vpravo od něj, levá část obrazu patří titulkům.
  Se zlatým pamlskem Tiger leží jako socha lva, bez něj sedí.
- Robotický vysavač po vyražení dveří projede na balkon a zaparkuje stranou, aby neblokoval průchod.
- **Autosave** po každém vyřešeném kroku do `localStorage` (`tiger.save.v1`): vyřešené kroky, deník,
  statistiky, poloha Tigera a pohyblivých předmětů. „Nová hra“ a „Pokračovat“ z menu stránku znovu
  načtou (`?autostart=new|continue`) – svět se tak vždy postaví z čistého stavu a nic se nemusí
  pracně vracet.
- **Nápovědy** (`H`): tři úrovně pro každý krok, další úroveň se odemkne 60 s po předchozí.
  Počet použitých nápověd je ve statistice na konci.
- **Fotka koťátka** v rámečku je skutečný snímek modelu Tigera ve zmenšené „koťátkové“ póze,
  vyrenderovaný při startu do textury (když se render nepovede, použije se kreslená náhrada).
- Krmítko v intru bliká červeně a pípá; krok „falešné stopy“ je splněn prozkoumáním všech tří
  (kalendář, svatební fotka, lísteček na TV), aby hráč věděl, že je může pustit z hlavy.
- Tajemství (zlatý pamlsek) je volitelný krok grafu bez závislostí – nezdržuje hlavní linku a lze
  ho získat kdykoli, jakmile se hráč dostane na vršek knihovny.

## Zvuk

- Všechny zvuky i hudba jsou procedurální syntéza (Web Audio) s prostorovým zvukem (HRTF panner).
- Sloty pro vlastní nahrávky: seznam souborů v `public/audio/` se při buildu/dev startu zapíše do
  virtuálního modulu (`virtual:tiger-audio` ve `vite.config.ts`), takže hra při běhu nezkouší
  neexistující soubory a konzole zůstává bez chyb 404.

## Model a rig

- Model je v repozitáři uložen beze změny (`tiger.glb`); normalizace (natočení, měřítko, posun na
  podlahu) a oprava sítě probíhá ve skriptu / při načtení.
- Varianta A (`tools/rig_tiger.py`) se pouští v Blenderu nebo s pip modulem `bpy`. Automatické váhy
  („bone heat“) na původní síti selhávají, proto se počítají na voxelově přemeshované kopii
  a přenášejí zpět; kdyby selhaly i tam, použijí se váhy podle vzdálenosti ke kostem.
- Varianta B (`src/cat/RuntimeRig.ts`) dělá tutéž analýzu tvaru v prohlížeči a funguje s libovolným
  podobným modelem; použije se automaticky, když `tiger_rigged.glb` chybí.
- Srst: délka vrstev je u každého vrcholu omezena podle tloušťky sítě v daném místě (uši, vousky,
  tlapky mají kratší chlup), jinak by tenké části vypadaly jako peří.

## Testování a výkon

- Automatické testy běží v headless Chromiu na softwarovém rasterizéru (SwiftShader) – proto mají
  ruční krokování (`setManual`, `simulate`, `renderFrame`) a ve výchozím stavu nižší předvolbu.
- Průchod hrou (`tools/playthrough.mjs`) používá skutečné vstupy (virtuální klávesy, mířené skoky,
  tlapku), ne jen `solveStep` – ověřuje tedy i dosažitelnost všech plošin.
- FPS na skutečné grafické kartě v tomto prostředí změřit nešlo (není tu GPU); `tools/fps.mjs`
  měření umí a v README jsou uvedena softwarová čísla i rozpočet draw calls / trojúhelníků.

## Assety

- Gauč, taburet, konferenční stolek, barová židle, křeslo, rostliny, polštáře, vázy, hodiny,
  encyklopedie, košík a holínka jsou modely z Poly Haven (CC0). Ostatní (kuchyň, lednice, knihovna,
  komoda, TV, police, svítidla, okno, dveře, radiátor…) je procedurální geometrie se zkosenými hranami.
- Gauč stojí na podložkách – pod rámem je ~17 cm, takže se pod něj dá jen proplížit.

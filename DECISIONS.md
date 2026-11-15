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
  barová židle (0,72 m), taburet (0,47 m) a gauč jsou dostupné přímo.
- Na hřeben opěradla gauče, digestoř, stínidla, květináče apod. se nedá postavit (plochy „noStand“) –
  jinak by šly hádanky obejít.
- Krátký stisk mezerníku = skok vpřed; pokud je před Tigerem hrana, na kterou dosáhne, skočí sám na ni.

## Světlo a rendering

- Globální osvětlení: mřížka světelných sond (`LightProbeGridWebGL`, novinka Three.js r187) zapékaná
  za běhu, při změně fáze západu se přepočítá inkrementálně do zadní mřížky a pak se prohodí.
  Na předvolbě Nízká se místo ní použije IBL z odrazové sondy.
- Odrazy: krychlová sonda uprostřed místnosti → PMREM → `scene.environment`.
- Obloha: tři HDRI z Poly Haven (qwantani sunset / dusk), mezi kterými se prolíná; sluneční kotouč
  je dokreslen procedurálně, aby seděl s výškou herního slunce.
- God rays: ray-marching proti stínové mapě slunce v polovičním rozlišení + rozmazání.
- Statická geometrie se po postavení slučuje podle materiálu (cca 600 → 250 draw calls).
- „Kamera“ dělá částečné vyvážení bílé (70 %), jinak by byl interiér při západu přehnaně oranžový.

## Assety

- Gauč, taburet, konferenční stolek, barová židle, křeslo, rostliny, polštáře, vázy, hodiny,
  encyklopedie, košík a holínka jsou modely z Poly Haven (CC0). Ostatní (kuchyň, lednice, knihovna,
  komoda, TV, police, svítidla, okno, dveře, radiátor…) je procedurální geometrie se zkosenými hranami.
- Gauč stojí na podložkách – pod rámem je ~17 cm, takže se pod něj dá jen proplížit.

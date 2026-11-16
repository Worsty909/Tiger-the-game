// Jediný zdroj pravdy pro rozměry a rozmístění místnosti (metry, Y nahoru).
// Místnost: X ∈ [-3, 3] (západ → východ), Z ∈ [-2.5, 2.5] (sever → jih), strop 2,7 m.
// Západní stěna má okno a balkonové dveře; slunce zapadá na západě.

export const ROOM = {
  minX: -3,
  maxX: 3,
  minZ: -2.5,
  maxZ: 2.5,
  h: 2.7,
  wallT: 0.3,
} as const;

/** Okno v západní stěně (nad radiátorem), parapet = odrazový můstek k závěsné polici. */
export const WINDOW = {
  z0: -2.2,
  z1: -1.0,
  sill: 0.98,
  head: 2.3,
  /** Parapetní deska: horní plocha ve výšce `sill`, přesahuje do místnosti. */
  boardX0: -3.28,
  boardX1: -2.72,
  boardZ0: -2.26,
  boardZ1: -0.94,
} as const;

/** Balkonové dveře v západní stěně. Otevírají se ven, závěsy na severní hraně. */
export const BALCONY_DOOR = {
  z0: -0.75,
  z1: 0.15,
  y0: 0.03,
  head: 2.25,
  ajarAngle: 0.105, // ~6° – štěrbina ~9 cm, kočka neprojde
  openAngle: 1.75,
} as const;

export const BALCONY = {
  minX: -4.45,
  maxX: -3.3,
  minZ: -1.6,
  maxZ: 1.0,
  floorY: -0.02,
  railH: 1.05,
} as const;

/** Vchodové dveře ve východní stěně (jen kulisa + zvuk zámku v intru). */
export const ENTRY_DOOR = { z0: 0.95, z1: 1.8, head: 2.05 } as const;

export const SOFA = {
  x: -1.0,
  z: 0.5,
  scale: 1.2,
  pad: 0.045, // podložky pod nohama – světlá výška pod rámem ~17 cm
  w: 1.9,
  d: 0.8,
  seatH: 0.5,
  backH: 1.0,
  underH: 0.17,
} as const;

export const COFFEE_TABLE = { x: -1.0, z: 1.69, scale: 0.9, w: 1.08, d: 0.54, h: 0.351 } as const;

export const TV = {
  x: -1.0,
  consoleW: 1.6,
  consoleD: 0.3,
  consoleH: 0.42,
  screenW: 1.23,
  screenH: 0.71,
  screenY: 1.08,
} as const;

/** Komoda u západní stěny (svatební fotka). */
export const KOMODA = { x0: -3, x1: -2.56, z0: 1.1, z1: 2.2, h: 0.88 } as const;

/** Taburet – výchozí poloha a cílová zóna pod parapetem. */
export const TABURET = {
  start: { x: -2.42, z: 0.32 },
  scale: 0.75,
  w: 0.66,
  d: 0.47,
  h: 0.468,
  zone: { minX: -2.95, maxX: -2.15, minZ: -2.3, maxZ: -0.9 },
} as const;

/** Závěsná police na severní stěně u okna – houpe se a naklání. */
export const HANG_SHELF = { x0: -2.85, x1: -2.0, y: 1.68, depth: 0.27, thick: 0.035 } as const;

/** Knihovna u severní stěny, 2,2 m. */
export const BOOKSHELF = { x0: -1.6, x1: -0.6, depth: 0.34, h: 2.2 } as const;

/** Kuchyň: linka podél severní stěny + poloostrov, lednice v SV rohu. */
export const KITCHEN = {
  runX0: 0.5,
  runX1: 2.35,
  runDepth: 0.62,
  counterH: 0.92,
  topT: 0.04,
  // poloostrov (barový pult) vybíhá na jih
  penX0: 0.5,
  penX1: 1.1,
  penTopX0: 0.24, // přesah desky pro barovou židli
  penZ0: -1.88,
  penZ1: -0.7,
  penH: 0.92,
  // horní skříňky
  upperX0: 1.75,
  upperX1: 2.35,
  upperY0: 1.5,
  upperY1: 2.25,
  upperDepth: 0.35,
  hoodX0: 1.13,
  hoodX1: 1.72,
  // lednice
  fridgeX0: 2.36,
  fridgeX1: 2.99,
  fridgeZ1: -1.82,
  fridgeH: 1.86,
  // dlažba
  tileX0: 0.24,
  tileZ1: -0.62,
} as const;

export const PENDANT = { x: 0.64, z: -1.2, topY: 1.95, radius: 0.27 } as const;

export const BAR_CHAIR = { x: 0.02, z: -1.0, seatH: 0.64, scale: 0.88 } as const;

export const FEEDER = { x: 2.76, z: -1.25 } as const;
export const TRASH_BIN = { x: 0.2, z: -2.25 } as const;
export const VACUUM_DOCK = { x: 2.8, z: -0.3 } as const;
export const BOOT = { x: 1.55, z: -0.27 } as const;
export const LAUNDRY = { x: -1.25, z: -0.33 } as const;
export const FLOOR_LAMP = { x: 0.26, z: 0.42 } as const;
export const ARMCHAIR = { x: 1.25, z: 1.55, rotY: -2.2 } as const;
export const BIG_PLANT = { x: 2.5, z: 2.1 } as const;
export const CALENDAR = { x: -0.05, y: 1.45 } as const;
export const CLOCK = { y: 2.0, z: 0.35 } as const;

/** Směr slunce: vodorovná složka paprsků (od slunce do místnosti), normalizováno později. */
export const SUN_HEADING = { x: 0.94, z: 0.34 } as const;

/** Parametry skoku (viz DECISIONS.md). */
export const JUMP = {
  maxSpeed: 4.2, // m/s → vrchol ~0,9 m nad odrazem, tlapkami dosáhne ~1,5 m
  clearance: 0.04, // o kolik musí vrchol oblouku převýšit cílovou plochu
  gravity: 9.81,
} as const;

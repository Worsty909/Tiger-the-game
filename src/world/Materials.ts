import * as THREE from 'three';
import { assets, type PBRSet } from '../core/Assets';
import { brushedMetalNormal, microNormal, smudgeRoughness } from './ProcTextures';

/** Knihovna PBR materiálů. UV geometrie jsou v metrech, `tile` = velikost dlaždice textury v metrech. */

function tiled(t: THREE.Texture, tile: number, rotate = 0): THREE.Texture {
  const c = t.clone();
  c.repeat.set(1 / tile, 1 / tile);
  c.rotation = rotate;
  c.needsUpdate = true;
  return c;
}

interface PBROpts {
  tile: number;
  color?: number;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  rotate?: number;
  useMap?: boolean;
  ao?: boolean;
  envMapIntensity?: number;
}

function pbrMaterial(set: PBRSet, o: PBROpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? 0,
  });
  if (o.useMap !== false) m.map = tiled(set.map, o.tile, o.rotate);
  m.normalMap = tiled(set.normalMap, o.tile, o.rotate);
  const ns = o.normalScale ?? 1;
  m.normalScale.set(ns, ns);
  if (set.armMap) {
    const arm = tiled(set.armMap, o.tile, o.rotate);
    m.roughnessMap = arm;
    if (o.ao !== false) m.aoMap = arm;
  }
  if (o.envMapIntensity !== undefined) m.envMapIntensity = o.envMapIntensity;
  return m;
}

export interface MaterialLib {
  parquet: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  skirting: THREE.MeshStandardMaterial;
  kitchenTile: THREE.MeshStandardMaterial;
  backsplash: THREE.MeshStandardMaterial;
  oak: THREE.MeshStandardMaterial;
  oakDark: THREE.MeshStandardMaterial;
  walnut: THREE.MeshStandardMaterial;
  cabinet: THREE.MeshStandardMaterial;
  cabinetInner: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  blackMetal: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  frameWhite: THREE.MeshStandardMaterial;
  plasticWhite: THREE.MeshStandardMaterial;
  plasticDark: THREE.MeshStandardMaterial;
  plasticGrey: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  linen: THREE.MeshStandardMaterial;
  linenWarm: THREE.MeshStandardMaterial;
  carpet: THREE.MeshStandardMaterial;
  paper: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial;
  screen: THREE.MeshStandardMaterial;
  radiator: THREE.MeshStandardMaterial;
  balconyTile: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  roofTile: THREE.MeshStandardMaterial;
  roofGrey: THREE.MeshStandardMaterial;
  facade: THREE.MeshStandardMaterial;
  facadeLight: THREE.MeshStandardMaterial;
  cardboard: THREE.MeshStandardMaterial;
  sets: Record<string, PBRSet>;
}

export async function createMaterials(): Promise<MaterialLib> {
  const [parquetS, plasterS, wool, whiteTiles, marble, greyTiles, oakS, walnutS, linenS, roofS, concreteS, facadeS] = await Promise.all([
    assets.pbr('herringbone_parquet', 'wood'),
    assets.pbr('white_plaster_02', 'plaster'),
    assets.pbr('wool_boucle', 'fabric'),
    assets.pbr('long_white_tiles', 'tile'),
    assets.pbr('marble_01', 'tile'),
    assets.pbr('large_grey_tiles', 'stone'),
    assets.pbr('oak_veneer_01', 'wood'),
    assets.pbr('walnut_veneer', 'wood'),
    assets.pbr('rough_linen', 'fabric'),
    assets.pbr('clay_roof_tiles_02', 'roof'),
    assets.pbr('concrete_tiles', 'stone'),
    assets.pbr('yellow_plaster', 'plaster'),
  ]);

  const micro = microNormal();
  const smudge = smudgeRoughness();
  const brushed = brushedMetalNormal();

  const lacquer = (color: number, roughness: number, tile = 0.25): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    m.normalMap = tiled(micro, tile);
    m.normalScale.set(0.12, 0.12);
    m.roughnessMap = tiled(smudge, 0.9);
    return m;
  };

  const steel = new THREE.MeshStandardMaterial({ color: 0xc4c7cb, roughness: 0.34, metalness: 1 });
  steel.normalMap = tiled(brushed, 0.35);
  steel.normalScale.set(0.25, 0.25);
  steel.roughnessMap = tiled(smudge, 0.8);

  const chrome = new THREE.MeshStandardMaterial({ color: 0xe6e8ea, roughness: 0.14, metalness: 1 });

  const blackMetal = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.48, metalness: 0.75 });
  blackMetal.normalMap = tiled(micro, 0.2);
  blackMetal.normalScale.set(0.2, 0.2);

  const brass = new THREE.MeshStandardMaterial({ color: 0xb8935a, roughness: 0.3, metalness: 1 });
  brass.roughnessMap = tiled(smudge, 0.4);

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.03,
    metalness: 0,
    transparent: true,
    opacity: 0.09,
    envMapIntensity: 1.6,
    specularIntensity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const wall = pbrMaterial(plasterS, { tile: 1.6, color: 0xf1ebe0, roughness: 0.93, normalScale: 0.35, useMap: false, ao: false });
  const ceiling = pbrMaterial(plasterS, { tile: 2.1, color: 0xf7f5f0, roughness: 0.96, normalScale: 0.2, useMap: false, ao: false });

  const carpet = pbrMaterial(wool, { tile: 0.35, color: 0xb9ad9c, roughness: 1, normalScale: 1.6, useMap: false });
  carpet.roughnessMap = null;

  const linen = pbrMaterial(linenS, { tile: 0.3, color: 0xdfe6ee, roughness: 1, normalScale: 1 });
  const linenWarm = pbrMaterial(linenS, { tile: 0.3, color: 0xd9cdb8, roughness: 1, normalScale: 1.2, useMap: false });

  const lib: MaterialLib = {
    parquet: pbrMaterial(parquetS, { tile: 2.2, roughness: 0.85, normalScale: 0.8, color: 0xffffff }),
    wall,
    ceiling,
    skirting: lacquer(0xf3f1ec, 0.42),
    kitchenTile: pbrMaterial(marble, { tile: 1.3, roughness: 0.75, normalScale: 0.9, color: 0xe9e4da }),
    backsplash: pbrMaterial(whiteTiles, { tile: 0.62, roughness: 0.55, normalScale: 1.0, color: 0xfafafa }),
    oak: pbrMaterial(oakS, { tile: 0.9, roughness: 0.85, normalScale: 0.7 }),
    oakDark: pbrMaterial(oakS, { tile: 0.9, roughness: 0.7, normalScale: 0.7, color: 0xb89a78 }),
    walnut: pbrMaterial(walnutS, { tile: 0.9, roughness: 0.8, normalScale: 0.7, color: 0xd8c4b0 }),
    cabinet: lacquer(0xf1efea, 0.38),
    cabinetInner: lacquer(0xe6e2d8, 0.7),
    steel,
    chrome,
    blackMetal,
    brass,
    glass,
    frameWhite: lacquer(0xf4f4f1, 0.4),
    plasticWhite: lacquer(0xeeeeea, 0.45),
    plasticDark: lacquer(0x1b1c1f, 0.42),
    plasticGrey: lacquer(0x7d8187, 0.5),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
    linen,
    linenWarm,
    carpet,
    paper: new THREE.MeshStandardMaterial({ color: 0xf6f1e4, roughness: 0.92 }),
    ceramic: lacquer(0xf5f3ee, 0.22),
    screen: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.1, metalness: 0.0, envMapIntensity: 1.2 }),
    radiator: lacquer(0xf2f1ee, 0.5),
    balconyTile: pbrMaterial(greyTiles, { tile: 1.4, roughness: 1, normalScale: 1 }),
    concrete: pbrMaterial(concreteS, { tile: 1.5, roughness: 1, normalScale: 0.8, color: 0xc9c5bd }),
    roofTile: pbrMaterial(roofS, { tile: 2.4, roughness: 1, normalScale: 1 }),
    roofGrey: pbrMaterial(roofS, { tile: 2.4, roughness: 1, normalScale: 1, color: 0x6f7378 }),
    facade: pbrMaterial(facadeS, { tile: 3.0, roughness: 1, normalScale: 0.8, color: 0xf0dcb8 }),
    facadeLight: pbrMaterial(plasterS, { tile: 3.0, roughness: 1, normalScale: 0.8, color: 0xe2d6c6 }),
    cardboard: new THREE.MeshStandardMaterial({ color: 0xb28b5e, roughness: 0.9 }),
    sets: { parquet: parquetS, plaster: plasterS, wool, oak: oakS, walnut: walnutS, linen: linenS },
  };
  return lib;
}

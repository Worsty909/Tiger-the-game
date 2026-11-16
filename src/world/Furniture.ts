import * as THREE from 'three';
import { RAPIER } from '../core/Physics';
import { assets } from '../core/Assets';
import type { WorldCtx } from './Ctx';
import { boxSpan, boxAt, mesh, cylinder, rbox, lathe, placeOnFloor, boundsOf } from './Geo';
import { rng, makeCanvas, canvasTexture } from './ProcTextures';
import {
  ROOM, SOFA, COFFEE_TABLE, TV, KOMODA, TABURET, HANG_SHELF, BOOKSHELF, PENDANT, BAR_CHAIR, FLOOR_LAMP, ARMCHAIR,
  BIG_PLANT, CLOCK, WINDOW, KITCHEN,
} from './Layout';

/** Nábytek: procedurální kusy + modely z Poly Haven s ručně nastavenými kolizemi. */
export async function buildFurniture(ctx: WorldCtx): Promise<void> {
  buildBookshelf(ctx);
  buildKomoda(ctx);
  buildTV(ctx);
  buildHangingShelf(ctx);
  buildPendant(ctx);
  buildFloorLamp(ctx);
  buildCarpet(ctx);
  await Promise.all([
    placeSofa(ctx),
    placeCoffeeTable(ctx),
    placeTaburet(ctx),
    placeBarChair(ctx),
    placeArmchair(ctx),
    placePlants(ctx),
    placeDecor(ctx),
  ]);
}

// ---------------------------------------------------------------- knihovna
function spineTexture(): THREE.Texture {
  const [c, g] = makeCanvas(64, 256);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = 'rgba(0,0,0,0.16)';
  g.fillRect(0, 150, 64, 44);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(8, 160, 48, 3);
  g.fillRect(14, 170, 36, 2);
  g.fillRect(14, 178, 36, 2);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 22, 64, 3);
  g.fillRect(0, 232, 64, 3);
  const t = canvasTexture(c, true, false);
  return t;
}

function buildBookshelf(ctx: WorldCtx): void {
  const { mats, physics: ph, root, detail } = ctx;
  const B = BOOKSHELF;
  const zN = ROOM.minZ;
  const zF = zN + B.depth;
  const t = 0.022;
  const g = new THREE.Group();
  g.name = 'bookshelf';
  root.add(g);
  const M = mats.oak;
  boxSpan(g, M, B.x0, 0, zN + 0.004, B.x0 + t, B.h - t, zF, 0.003, 'y');
  boxSpan(g, M, B.x1 - t, 0, zN + 0.004, B.x1, B.h - t, zF, 0.003, 'y');
  boxSpan(g, M, B.x0 - 0.006, B.h - t, zN + 0.002, B.x1 + 0.006, B.h, zF + 0.008, 0.004, 'x');
  boxSpan(g, mats.oakDark, B.x0 + t, 0.06, zN + 0.004, B.x1 - t, B.h - t, zN + 0.012, 0.001, 'y');
  boxSpan(g, M, B.x0 + t, 0, zN + 0.02, B.x1 - t, 0.06, zF - 0.02, 0.002, 'x');
  const shelfYs = [0.06, 0.44, 0.8, 1.15, 1.5, 1.85];
  for (const y of shelfYs) boxSpan(g, M, B.x0 + t, y, zN + 0.012, B.x1 - t, y + t, zF - 0.004, 0.003, 'x');
  ph.addStaticAABB(B.x0, 0, zN, B.x1, B.h, zF, { surface: 'wood', tag: 'bookshelf' });

  // knihy – jedna instancovaná síť s barvou na instanci
  const R = rng(4242);
  const palette = [0x7b2d26, 0x1f3a5f, 0x2f5d50, 0xc9a227, 0x4a4e69, 0x9a8c98, 0xe0d8c8, 0x283618, 0xbc6c25, 0x22223b, 0x6d597a, 0xb56576, 0x355070, 0xd8d2c4, 0x3d405b];
  const bookMat = new THREE.MeshStandardMaterial({ roughness: 0.75, map: spineTexture() });
  const bookGeo = new THREE.BoxGeometry(1, 1, 1);
  const max = 260;
  const books = new THREE.InstancedMesh(bookGeo, bookMat, max);
  books.castShadow = true;
  books.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let n = 0;
  const inner0 = B.x0 + t + 0.004;
  const inner1 = B.x1 - t - 0.004;
  const decorSlots: Array<{ x: number; y: number; w: number }> = [];
  shelfYs.forEach((sy, si) => {
    const top = sy + t;
    const clear = (si < shelfYs.length - 1 ? shelfYs[si + 1] : B.h - t) - top;
    let x = inner0;
    // na každé polici jedna mezera na dekoraci
    const gapAt = inner0 + (inner1 - inner0) * (0.15 + R() * 0.6);
    const gapW = si === 0 ? 0 : 0.2 + R() * 0.12;
    while (x < inner1 - 0.02 && n < max) {
      if (gapW > 0 && x >= gapAt && x < gapAt + 0.02) {
        decorSlots.push({ x: x + gapW / 2, y: top, w: gapW });
        x += gapW;
        continue;
      }
      const w = 0.018 + R() * 0.03;
      const h = Math.min(clear - 0.03, 0.17 + R() * 0.11);
      const d = 0.13 + R() * 0.07;
      if (x + w > inner1) break;
      const lean = R() < 0.07 ? (R() - 0.5) * 0.3 : 0;
      dummy.position.set(x + w / 2 + Math.abs(lean) * h * 0.4, top + h / 2, zF - 0.02 - d / 2 - R() * 0.02);
      dummy.rotation.set(0, 0, lean);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();
      books.setMatrixAt(n, dummy.matrix);
      col.setHex(palette[Math.floor(R() * palette.length)]).multiplyScalar(0.75 + R() * 0.4);
      books.setColorAt(n, col);
      n++;
      x += w + 0.001 + Math.abs(lean) * h * 0.8;
    }
  });
  books.count = n;
  books.instanceMatrix.needsUpdate = true;
  if (books.instanceColor) books.instanceColor.needsUpdate = true;
  detail.add(books);
  ctx.refs.bookshelfDecorSlots = decorSlots;
  ctx.refs.bookshelfTop = new THREE.Vector3((B.x0 + B.x1) / 2, B.h, zN + B.depth / 2);
}

// ---------------------------------------------------------------- komoda
function buildKomoda(ctx: WorldCtx): void {
  const { mats, physics: ph, root } = ctx;
  const K = KOMODA;
  const g = new THREE.Group();
  g.name = 'komoda';
  root.add(g);
  const legH = 0.13;
  const x0 = K.x0 + 0.012;
  boxSpan(g, mats.walnut, x0, legH, K.z0, K.x1 - 0.02, K.h - 0.025, K.z1, 0.006, 'z');
  boxSpan(g, mats.walnut, x0 - 0.004, K.h - 0.025, K.z0 - 0.012, K.x1 + 0.006, K.h, K.z1 + 0.012, 0.006, 'z');
  // zásuvky 3 × 2
  const fh = (K.h - 0.025 - legH - 0.02) / 3;
  const zw = (K.z1 - K.z0 - 0.03) / 2;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      const y0 = legH + 0.012 + r * fh;
      const za = K.z0 + 0.012 + c * (zw + 0.006);
      boxSpan(g, mats.walnut, K.x1 - 0.02, y0, za, K.x1, y0 + fh - 0.006, za + zw, 0.005, 'z');
      const knob = mesh(new THREE.SphereGeometry(0.014, 14, 10), mats.brass, K.x1 + 0.016, y0 + fh / 2, za + zw / 2);
      g.add(knob);
      const stem = mesh(cylinder(0.005, 0.005, 0.016, 8), mats.brass, K.x1 + 0.007, y0 + fh / 2, za + zw / 2);
      stem.rotation.z = Math.PI / 2;
      g.add(stem);
    }
  }
  for (const [lx, lz] of [[x0 + 0.05, K.z0 + 0.06], [K.x1 - 0.06, K.z0 + 0.06], [x0 + 0.05, K.z1 - 0.06], [K.x1 - 0.06, K.z1 - 0.06]] as const) {
    g.add(mesh(cylinder(0.022, 0.014, legH, 12), mats.walnut, lx, legH / 2, lz));
  }
  ph.addStaticAABB(K.x0, legH, K.z0 - 0.01, K.x1 + 0.005, K.h, K.z1 + 0.01, { surface: 'wood', tag: 'komoda' });
  ph.addStaticAABB(K.x0, 0, K.z0, K.x1 - 0.03, legH, K.z1, { surface: 'wood' }, { camera: false });
  ctx.refs.komodaTop = new THREE.Vector3((K.x0 + K.x1) / 2, K.h, (K.z0 + K.z1) / 2);
}

// ---------------------------------------------------------------- televize
function buildTV(ctx: WorldCtx): void {
  const { mats, physics: ph, root, detail } = ctx;
  const zS = ROOM.maxZ;
  const x0 = TV.x - TV.consoleW / 2;
  const x1 = TV.x + TV.consoleW / 2;
  const zc0 = zS - TV.consoleD;
  const g = new THREE.Group();
  g.name = 'tv';
  root.add(g);
  const legH = 0.12;
  boxSpan(g, mats.walnut, x0, legH, zc0, x1, TV.consoleH, zS - 0.005, 0.008, 'x');
  const dw = (TV.consoleW - 0.02) / 3;
  for (let i = 0; i < 3; i++) {
    boxSpan(g, mats.walnut, x0 + 0.01 + i * dw + 0.003, legH + 0.012, zc0 - 0.016, x0 + 0.01 + (i + 1) * dw - 0.003, TV.consoleH - 0.012, zc0, 0.005, 'x');
  }
  for (const lx of [x0 + 0.07, x1 - 0.07]) {
    for (const lz of [zc0 + 0.05, zS - 0.05]) g.add(mesh(cylinder(0.02, 0.013, legH, 12), mats.blackMetal, lx, legH / 2, lz));
  }
  ph.addStaticAABB(x0, legH, zc0 - 0.016, x1, TV.consoleH, zS, { surface: 'wood', tag: 'tvConsole' });

  // televize na stěně
  const sy = TV.screenY;
  const bezel = boxAt(g, mats.plasticDark, TV.x, sy, zS - 0.03, TV.screenW + 0.016, TV.screenH + 0.016, 0.03, 0.006);
  bezel.castShadow = true;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(TV.screenW, TV.screenH), mats.screen.clone());
  screen.rotation.y = Math.PI;
  screen.position.set(TV.x, sy, zS - 0.0462);
  g.add(screen);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.003, 10), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
  led.rotation.y = Math.PI;
  led.position.set(TV.x + TV.screenW / 2 - 0.03, sy - TV.screenH / 2 - 0.004, zS - 0.0465);
  g.add(led);
  ph.addStaticAABB(TV.x - TV.screenW / 2, sy - TV.screenH / 2, zS - 0.05, TV.x + TV.screenW / 2, sy + TV.screenH / 2, zS, { surface: 'glass', tag: 'noStand' }, { camera: false });
  // soundbar a ovladač
  boxAt(detail, mats.plasticDark, TV.x, TV.consoleH + 0.03, zS - 0.1, 0.8, 0.06, 0.09, 0.02);
  ctx.refs.tv = {
    screen,
    notePos: new THREE.Vector3(TV.x - TV.screenW / 2 + 0.12, sy - TV.screenH / 2 + 0.05, zS - 0.048),
    center: new THREE.Vector3(TV.x, sy, zS - 0.05),
  };
}

// ---------------------------------------------------------------- závěsná police
function buildHangingShelf(ctx: WorldCtx): void {
  const { mats, physics: ph, root } = ctx;
  const S = HANG_SHELF;
  const zN = ROOM.minZ;
  // pivot = osa u stěny, kolem které se police naklání
  const pivot = new THREE.Group();
  pivot.name = 'hangShelf';
  pivot.position.set((S.x0 + S.x1) / 2, S.y, zN + 0.004);
  root.add(pivot);
  const w = S.x1 - S.x0;
  boxSpan(pivot, mats.oak, -w / 2, -S.thick, 0, w / 2, 0, S.depth, 0.006, 'x');
  // kožené popruhy k háčkům na stěně
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.7 });
  const hookY = 0.42;
  for (const sx of [-w / 2 + 0.09, w / 2 - 0.09]) {
    const len = Math.hypot(hookY, S.depth - 0.03);
    const strap = boxAt(pivot, strapMat, sx, hookY / 2, (S.depth - 0.03) / 2, 0.028, len, 0.004, 0.0015);
    strap.rotation.x = Math.atan2(S.depth - 0.03, hookY);
    // smyčka pod policí
    boxAt(pivot, strapMat, sx, -S.thick - 0.002, S.depth / 2, 0.028, 0.004, S.depth, 0.0015);
    boxAt(pivot, strapMat, sx, -S.thick / 2, S.depth + 0.002, 0.028, S.thick + 0.006, 0.004, 0.0015);
  }
  // háčky (pevné na stěně)
  for (const sx of [S.x0 + 0.09, S.x1 - 0.09]) {
    const hook = mesh(cylinder(0.008, 0.008, 0.03, 10), mats.brass, sx, S.y + hookY, zN + 0.015);
    hook.rotation.x = Math.PI / 2;
    root.add(hook);
    root.add(mesh(cylinder(0.018, 0.018, 0.004, 14), mats.brass, sx, S.y + hookY, zN + 0.002).rotateX(Math.PI / 2));
  }
  const body = ph.addKinematic(
    pivot,
    [RAPIER.ColliderDesc.cuboid(w / 2, S.thick / 2, S.depth / 2).setTranslation(0, -S.thick / 2, S.depth / 2).setFriction(0.9)],
    { surface: 'wood', tag: 'hangShelf' },
  );
  ctx.refs.hangShelf = { pivot, body, tilt: 0, basePos: pivot.position.clone(), width: w };
}

// ---------------------------------------------------------------- závěsné svítidlo
function buildPendant(ctx: WorldCtx): void {
  const { mats, physics: ph, root } = ctx;
  const P = PENDANT;
  const pivot = new THREE.Group();
  pivot.name = 'pendant';
  pivot.position.set(P.x, ROOM.h, P.z);
  root.add(pivot);
  const drop = ROOM.h - P.topY; // délka závěsu ke stínidlu
  const shadeH = 0.13;
  // baldachýn u stropu (nehoupe se)
  root.add(mesh(cylinder(0.05, 0.055, 0.025, 20), mats.blackMetal, P.x, ROOM.h - 0.0125, P.z));
  // lanko
  pivot.add(mesh(cylinder(0.004, 0.004, drop, 6), mats.blackMetal, 0, -drop / 2, 0));
  // stínidlo: plochý kovový buben
  const shade = mesh(
    lathe([[0.0, 0], [P.radius - 0.012, 0], [P.radius, -0.012], [P.radius, -shadeH], [P.radius - 0.006, -shadeH], [P.radius - 0.006, -0.018], [0, -0.018]], 48),
    mats.blackMetal, 0, -drop, 0,
  );
  (shade.material as THREE.Material).side = THREE.DoubleSide;
  pivot.add(shade);
  pivot.add(mesh(cylinder(0.02, 0.03, 0.04, 14), mats.brass, 0, -drop + 0.02, 0));
  // difuzor (svítí, až se rozsvítí)
  const diffMat = new THREE.MeshStandardMaterial({ color: 0xfff6e6, roughness: 0.6, emissive: 0xffd9a0, emissiveIntensity: 0 });
  const diff = new THREE.Mesh(new THREE.CircleGeometry(P.radius - 0.012, 40), diffMat);
  diff.rotation.x = Math.PI / 2;
  diff.position.y = -drop - shadeH + 0.012;
  pivot.add(diff);
  const body = ph.addKinematic(
    pivot,
    [RAPIER.ColliderDesc.cylinder(shadeH / 2, P.radius).setTranslation(0, -drop - shadeH / 2, 0).setFriction(1)],
    { surface: 'metal', tag: 'pendant', carries: true },
  );
  // směr houpání: od knihovny k horním skříňkám
  const swingDir = new THREE.Vector3(KITCHEN.upperX0 + 0.15 - P.x, 0, ROOM.minZ + 0.2 - P.z).normalize();
  ctx.refs.pendant = { pivot, body, diffMat, drop, shadeH, swingDir, angle: 0.05, vel: 0, top: new THREE.Vector3(P.x, P.topY, P.z) };
}

// ---------------------------------------------------------------- stojací lampa
function buildFloorLamp(ctx: WorldCtx): void {
  const { mats, physics: ph, root } = ctx;
  const { x, z } = FLOOR_LAMP;
  const g = new THREE.Group();
  g.name = 'floorLamp';
  g.position.set(x, 0, z);
  root.add(g);
  g.add(mesh(cylinder(0.14, 0.15, 0.022, 32), mats.blackMetal, 0, 0.011, 0));
  g.add(mesh(cylinder(0.011, 0.011, 1.42, 10), mats.brass, 0, 0.73, 0));
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xe9dfcc, roughness: 0.95, side: THREE.DoubleSide, emissive: 0xffc98a, emissiveIntensity: 0,
    normalMap: mats.linenWarm.normalMap, normalScale: new THREE.Vector2(0.6, 0.6),
  });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.27, 40, 1, true), shadeMat);
  shade.position.y = 1.52;
  shade.castShadow = false;
  g.add(shade);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff3dd, emissive: 0xffd7a3, emissiveIntensity: 0 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), bulbMat);
  bulb.position.y = 1.5;
  g.add(bulb);
  ph.addStaticCylinder(x, 0.011, z, 0.011, 0.15, { surface: 'metal' }, false);
  ph.addStaticCylinder(x, 0.73, z, 0.71, 0.02, { surface: 'metal' }, false);
  ph.addStaticCylinder(x, 1.52, z, 0.135, 0.2, { surface: 'fabric', tag: 'noStand' }, false);
  ctx.refs.floorLamp = { shadeMat, bulbMat, pos: new THREE.Vector3(x, 1.5, z) };
}

// ---------------------------------------------------------------- koberec
function buildCarpet(ctx: WorldCtx): void {
  const { mats, physics: ph, root } = ctx;
  const x0 = -2.2;
  const x1 = 0.2;
  const z0 = 0.78;
  const z1 = 2.14;
  const m = boxSpan(root, mats.carpet, x0, 0, z0, x1, 0.014, z1, 0.007);
  m.castShadow = false;
  // tmavší lem
  const edge = new THREE.MeshStandardMaterial({ color: 0x8d8272, roughness: 1, normalMap: mats.carpet.normalMap });
  for (const [a, b, c, d] of [[x0, z0, x1, z0 + 0.05], [x0, z1 - 0.05, x1, z1], [x0, z0, x0 + 0.05, z1], [x1 - 0.05, z0, x1, z1]] as const) {
    const e = boxSpan(root, edge, a - 0.001, 0, b - 0.001, c + 0.001, 0.0152, d + 0.001, 0.007);
    e.castShadow = false;
  }
  ph.addStaticAABB(x0, 0, z0, x1, 0.014, z1, { surface: 'carpet', tag: 'carpet' }, { camera: false });
}

// ---------------------------------------------------------------- modely z Poly Haven
function fallbackBox(ctx: WorldCtx, w: number, h: number, d: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(rbox(w, h, d, 0.03), mat, 0, h / 2, 0));
  return g;
}

async function placeSofa(ctx: WorldCtx): Promise<void> {
  const { physics: ph, root, mats } = ctx;
  const S = SOFA;
  let model = await assets.model('Sofa_01');
  if (model) model.scale.setScalar(S.scale);
  else model = fallbackBox(ctx, S.w, S.backH - S.pad, S.d, mats.linenWarm);
  root.add(model);
  const b = placeOnFloor(model, S.x, S.pad, S.z);
  // podložky pod nohy (zvýší světlou výšku pod gaučem)
  const cx = S.x;
  const cz = S.z;
  const hw = (b.max.x - b.min.x) / 2;
  const hd = (b.max.z - b.min.z) / 2;
  const legPts: Array<[number, number]> = [];
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    const v = new THREE.Vector3();
    const cells = new Map<string, { x: number; z: number; n: number }>();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (v.y > S.pad + 0.012) continue;
      const key = Math.round(v.x / 0.25) + ',' + Math.round(v.z / 0.25);
      const c = cells.get(key) ?? { x: 0, z: 0, n: 0 };
      c.x += v.x;
      c.z += v.z;
      c.n++;
      cells.set(key, c);
    }
    for (const c of cells.values()) legPts.push([c.x / c.n, c.z / c.n]);
  });
  if (legPts.length === 0) {
    for (const sx of [-0.9, 0, 0.9]) for (const sz of [-0.85, 0.85]) legPts.push([cx + sx * hw, cz + sz * hd]);
  }
  for (const [lx, lz] of legPts) {
    root.add(mesh(cylinder(0.04, 0.045, S.pad, 16), mats.walnut, lx, S.pad / 2, lz));
    ph.addStaticCylinder(lx, 0.09, lz, 0.09, 0.04, { surface: 'wood' }, false);
  }
  // kolize: rám, sedák, područky, opěradlo
  const fab = { surface: 'fabric' as const, tag: 'sofa' };
  const under = S.underH;
  const seatU = 0.31;
  ph.addStaticAABB(cx - hw + 0.14, seatU, cz - 0.2, cx + hw - 0.14, S.seatH, cz + hd - 0.01, fab);
  ph.addStaticAABB(cx - hw + 0.04, under, cz + hd - 0.07, cx + hw - 0.04, seatU, cz + hd - 0.01, { surface: 'wood', tag: 'sofaRail' });
  ph.addStaticAABB(cx - hw + 0.04, under, cz - hd + 0.02, cx + hw - 0.04, seatU, cz - hd + 0.08, { surface: 'wood', tag: 'sofaRail' });
  ph.addStaticAABB(cx - hw + 0.02, under, cz - hd + 0.02, cx - hw + 0.08, seatU, cz + hd - 0.01, { surface: 'wood', tag: 'sofaRail' });
  ph.addStaticAABB(cx + hw - 0.08, under, cz - hd + 0.02, cx + hw - 0.02, seatU, cz + hd - 0.01, { surface: 'wood', tag: 'sofaRail' });
  ph.addStaticAABB(cx - hw, seatU, cz - 0.28, cx - hw + 0.17, 0.63, cz + hd - 0.02, fab);
  ph.addStaticAABB(cx + hw - 0.17, seatU, cz - 0.28, cx + hw, 0.63, cz + hd - 0.02, fab);
  ph.addStaticAABB(cx - hw + 0.02, seatU, cz - hd, cx + hw - 0.02, 0.9, cz - 0.2, fab);
  // hřeben opěradla – úzká vyřezávaná lišta, na které se nedá stát
  ph.addStaticAABB(cx - hw, 0.88, cz - hd - 0.01, cx + hw, b.max.y - 0.02, cz - 0.19, { surface: 'wood', tag: 'noStand' });
  ctx.refs.sofa = {
    model, cx, cz, hw, hd, seatY: S.seatH,
    underMin: new THREE.Vector3(cx - hw + 0.1, 0, cz - hd + 0.1),
    underMax: new THREE.Vector3(cx + hw - 0.1, seatU, cz + hd - 0.09),
    /** Kde Tiger spí v intru. */
    sleepPos: new THREE.Vector3(cx - 0.35, S.seatH, cz + 0.08),
    /** Průkaz zapadlý vzadu pod gaučem. */
    cardPos: new THREE.Vector3(cx + 0.38, 0.004, cz - 0.04),
  };
}

async function placeCoffeeTable(ctx: WorldCtx): Promise<void> {
  const { physics: ph, root, mats } = ctx;
  const T = COFFEE_TABLE;
  let model = await assets.model('modern_coffee_table_01');
  if (model) {
    model.scale.setScalar(T.scale);
    model.rotation.y = Math.PI / 2;
  } else model = fallbackBox(ctx, T.w, T.h, T.d, mats.oak);
  root.add(model);
  placeOnFloor(model, T.x, 0, T.z);
  ph.addStaticAABB(T.x - T.w / 2, T.h - 0.055, T.z - T.d / 2, T.x + T.w / 2, T.h, T.z + T.d / 2, { surface: 'stone', tag: 'coffeeTable' });
  for (const s of [-1, 1]) {
    ph.addStaticAABB(T.x + s * (T.w / 2 - 0.05) - 0.03, 0, T.z - T.d / 2, T.x + s * (T.w / 2 - 0.05) + 0.03, T.h - 0.055, T.z + T.d / 2, { surface: 'wood' }, { camera: false });
  }
  ctx.refs.coffeeTableTop = new THREE.Vector3(T.x, T.h, T.z);
}

async function placeTaburet(ctx: WorldCtx): Promise<void> {
  const { physics: ph, root, mats } = ctx;
  const T = TABURET;
  const holder = new THREE.Group();
  holder.name = 'taburet';
  let model = await assets.model('Ottoman_01');
  if (model) model.scale.setScalar(T.scale);
  else model = fallbackBox(ctx, T.w, T.h, T.d, mats.plasticDark);
  holder.add(model);
  placeOnFloor(model, 0, -T.h / 2, 0);
  holder.position.set(T.start.x, T.h / 2, T.start.z);
  holder.rotation.y = Math.PI / 2; // delší stranou podél stěny
  root.add(holder);
  const entry = ph.addDynamic(
    holder,
    [RAPIER.ColliderDesc.cuboid(T.w / 2, T.h / 2 - 0.004, T.d / 2).setTranslation(0, 0.004, 0).setFriction(0.55).setRestitution(0.0).setDensity(42)],
    { info: { surface: 'fabric', tag: 'taburet' }, tag: 'taburet', linDamp: 2.2, angDamp: 4 },
  );
  entry.body.setEnabledRotations(false, true, false, true);
  ctx.refs.taburet = entry;
}

async function placeBarChair(ctx: WorldCtx): Promise<void> {
  const { physics: ph, root, mats } = ctx;
  let model = await assets.model('bar_chair_round_01');
  if (!model) model = fallbackBox(ctx, 0.4, BAR_CHAIR.seatH, 0.4, mats.walnut);
  model.rotation.y = -Math.PI / 2; // opěrka dál od pultu
  model.scale.setScalar(BAR_CHAIR.scale);
  root.add(model);
  placeOnFloor(model, BAR_CHAIR.x, 0, BAR_CHAIR.z);
  // změř skutečnou výšku sedáku: nejvyšší bod v okolí středu
  const b = boundsOf(model);
  const seatY = Math.min(b.max.y - 0.025, BAR_CHAIR.seatH);
  ph.addStaticCylinder(BAR_CHAIR.x, seatY - 0.03, BAR_CHAIR.z, 0.03, 0.18, { surface: 'wood', tag: 'barChair' }, false);
  // nohy: čtyři tenké válce
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    ph.addStaticCylinder(BAR_CHAIR.x + dx * 0.13, (seatY - 0.06) / 2, BAR_CHAIR.z + dz * 0.13, (seatY - 0.06) / 2, 0.022, { surface: 'wood' }, false);
  }
  ctx.refs.barChairSeat = new THREE.Vector3(BAR_CHAIR.x, seatY, BAR_CHAIR.z);
}

async function placeArmchair(ctx: WorldCtx): Promise<void> {
  const { physics: ph, root, mats } = ctx;
  const A = ARMCHAIR;
  const holder = new THREE.Group();
  let model = await assets.model('modern_arm_chair_01');
  if (!model) model = fallbackBox(ctx, 0.8, 0.45, 0.8, mats.plasticDark);
  holder.add(model);
  placeOnFloor(model, 0, 0, 0);
  holder.position.set(A.x, 0, A.z);
  holder.rotation.y = A.rotY;
  root.add(holder);
  const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, A.rotY);
  const local = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, surface: 'fabric' | 'wood', tag?: string) => {
    const p = new THREE.Vector3(lx, ly, lz).applyQuaternion(q);
    ph.addStaticBox(A.x + p.x, ly, A.z + p.z, hx, hy, hz, { surface, tag }, { quat: q });
  };
  local(0, 0.33, 0.06, 0.3, 0.1, 0.33, 'fabric', 'armchair'); // sedák (horní plocha ~0,43)
  local(0, 0.72, -0.3, 0.3, 0.3, 0.09, 'fabric', 'noStand'); // opěradlo
  local(-0.37, 0.3, 0.05, 0.035, 0.3, 0.38, 'wood', 'noStand');
  local(0.37, 0.3, 0.05, 0.035, 0.3, 0.38, 'wood', 'noStand');
}

async function placePlants(ctx: WorldCtx): Promise<void> {
  const { physics: ph, root, detail, mats } = ctx;
  const big = await assets.model('potted_plant_02');
  if (big) {
    big.scale.setScalar(1.25);
    root.add(big);
    placeOnFloor(big, BIG_PLANT.x, 0, BIG_PLANT.z);
    big.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.transparent || mat.alphaTest > 0 || mat.name.toLowerCase().includes('lea')) {
          mat.alphaTest = Math.max(mat.alphaTest, 0.4);
          mat.transparent = false;
          mat.side = THREE.DoubleSide;
        }
      }
    });
    ph.addStaticCylinder(BIG_PLANT.x, 0.2, BIG_PLANT.z, 0.2, 0.22, { surface: 'stone', tag: 'noStand' }, false);
  }
  const small = await assets.model('potted_plant_04');
  if (small) {
    // sukulent na parapetu (jižní konec) a na komodě
    const a = small.clone(true);
    a.scale.setScalar(0.9);
    detail.add(a);
    placeOnFloor(a, WINDOW.boardX0 + 0.3, WINDOW.sill, WINDOW.boardZ1 - 0.16);
    ph.addStaticCylinder(WINDOW.boardX0 + 0.3, WINDOW.sill + 0.09, WINDOW.boardZ1 - 0.16, 0.09, 0.075, { surface: 'stone', tag: 'noStand' }, false);
    const b = small.clone(true);
    b.rotation.y = 1.3;
    detail.add(b);
    placeOnFloor(b, -2.78, 0.88, 1.32);
    ph.addStaticCylinder(-2.78, 0.88 + 0.09, 1.32, 0.09, 0.08, { surface: 'stone', tag: 'noStand' }, false);
  }
  void mats;
}

async function placeDecor(ctx: WorldCtx): Promise<void> {
  const { detail, mats, physics: ph } = ctx;
  const [pillows, vase1, vase3, books, clock, basket] = await Promise.all([
    assets.model('throw_pillows_01'),
    assets.model('ceramic_vase_01'),
    assets.model('ceramic_vase_03'),
    assets.model('book_encyclopedia_set_01'),
    assets.model('wall_clock'),
    assets.model('wicker_basket_01'),
  ]);
  const sofa = ctx.refs.sofa;
  if (pillows && sofa) {
    pillows.scale.setScalar(0.85);
    detail.add(pillows);
    placeOnFloor(pillows, sofa.cx + sofa.hw - 0.55, sofa.seatY - 0.01, sofa.cz - 0.1);
  }
  const slots: Array<{ x: number; y: number; w: number }> = ctx.refs.bookshelfDecorSlots ?? [];
  const zShelf = ROOM.minZ + BOOKSHELF.depth / 2 + 0.02;
  const decorModels = [vase3, vase1, vase3, vase1];
  slots.forEach((s, i) => {
    const src = decorModels[i % decorModels.length];
    if (!src) return;
    const m = src.clone(true);
    const sc = i % 2 === 0 ? 0.62 : 0.5;
    m.scale.setScalar(sc);
    detail.add(m);
    placeOnFloor(m, s.x, s.y, zShelf);
  });
  if (books) {
    // encyklopedie naležato na TV konzoli
    const e = books.clone(true);
    e.scale.setScalar(0.9);
    detail.add(e);
    placeOnFloor(e, TV.x + 0.5, TV.consoleH, ROOM.maxZ - 0.14);
  }
  if (clock) {
    clock.rotation.y = -Math.PI / 2;
    clock.position.set(ROOM.maxX - 0.002, CLOCK.y, CLOCK.z);
    detail.add(clock);
    (ctx.refs.noMerge ??= []).push(clock);
    ctx.refs.clock = { model: clock, pos: clock.position.clone() };
  } else {
    ctx.refs.clock = { model: null, pos: new THREE.Vector3(ROOM.maxX - 0.02, CLOCK.y, CLOCK.z) };
  }
  if (basket) {
    detail.add(basket);
    placeOnFloor(basket, COFFEE_TABLE.x + 0.28, COFFEE_TABLE.h, COFFEE_TABLE.z + 0.02);
    // ovladač a pár drobností v košíku
    boxAt(detail, mats.plasticDark, COFFEE_TABLE.x + 0.25, COFFEE_TABLE.h + 0.03, COFFEE_TABLE.z + 0.02, 0.045, 0.016, 0.17, 0.006);
    ph.addStaticAABB(COFFEE_TABLE.x + 0.1, COFFEE_TABLE.h, COFFEE_TABLE.z - 0.13, COFFEE_TABLE.x + 0.46, COFFEE_TABLE.h + 0.1, COFFEE_TABLE.z + 0.17, { surface: 'wood', tag: 'noStand' }, { camera: false });
  }
  // časopisy na stolku
  const magMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c5, roughness: 0.6 });
  const mag = boxAt(detail, magMat, COFFEE_TABLE.x - 0.25, COFFEE_TABLE.h + 0.006, COFFEE_TABLE.z - 0.03, 0.21, 0.012, 0.29, 0.003);
  mag.rotation.y = 0.3;
  const mag2 = boxAt(detail, new THREE.MeshStandardMaterial({ color: 0x45617a, roughness: 0.5 }), COFFEE_TABLE.x - 0.23, COFFEE_TABLE.h + 0.017, COFFEE_TABLE.z - 0.02, 0.2, 0.008, 0.27, 0.003);
  mag2.rotation.y = -0.15;
}

import * as THREE from 'three';
import { RAPIER } from '../core/Physics';
import type { WorldCtx, Hinged } from './Ctx';
import { boxSpan, boxAt, floorPlane, mesh, rbox, cylinder } from './Geo';
import { ROOM, WINDOW, BALCONY_DOOR, BALCONY, ENTRY_DOOR, KITCHEN } from './Layout';

/** Hrubá stavba: podlaha, stěny s otvory, strop, okno, balkonové dveře, balkon. */
export function buildRoom(ctx: WorldCtx): void {
  const { mats, physics: ph, root, exterior } = ctx;
  const W = ROOM;
  const T = W.wallT;

  // ---------- podlaha ----------
  const addFloor = (mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y = 0) => {
    const m = mesh(floorPlane(x1 - x0, z1 - z0), mat, (x0 + x1) / 2, y, (z0 + z1) / 2, { cast: false });
    // UV navazují ve světových souřadnicích
    const uv = m.geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + (x0 + x1) / 2, uv.getY(i) + (z0 + z1) / 2);
    root.add(m);
    return m;
  };
  addFloor(mats.parquet, W.minX, W.minZ, KITCHEN.tileX0, W.maxZ);
  addFloor(mats.parquet, KITCHEN.tileX0, KITCHEN.tileZ1, W.maxX, W.maxZ);
  addFloor(mats.kitchenTile, KITCHEN.tileX0, W.minZ, W.maxX, KITCHEN.tileZ1);
  // přechodové lišty mezi parketami a dlažbou
  boxSpan(root, mats.brass, KITCHEN.tileX0 - 0.015, 0, W.minZ, KITCHEN.tileX0 + 0.015, 0.004, KITCHEN.tileZ1 + 0.015, 0.0015, undefined, { cast: false });
  boxSpan(root, mats.brass, KITCHEN.tileX0 - 0.015, 0, KITCHEN.tileZ1 - 0.015, W.maxX, 0.004, KITCHEN.tileZ1 + 0.015, 0.0015, undefined, { cast: false });
  // deska pod podlahou (stíny, sondy)
  boxSpan(root, mats.concrete, W.minX - T, -0.25, W.minZ - T, W.maxX + T, -0.004, W.maxZ + T, 0);
  ph.addStaticAABB(W.minX, -0.5, W.minZ, KITCHEN.tileX0, 0, W.maxZ, { surface: 'wood', tag: 'floor' });
  ph.addStaticAABB(KITCHEN.tileX0, -0.5, KITCHEN.tileZ1, W.maxX, 0, W.maxZ, { surface: 'wood', tag: 'floor' });
  ph.addStaticAABB(KITCHEN.tileX0, -0.5, W.minZ, W.maxX, 0, KITCHEN.tileZ1, { surface: 'tile', tag: 'floor' });

  // ---------- strop ----------
  boxSpan(root, mats.ceiling, W.minX - T, W.h, W.minZ - T, W.maxX + T, W.h + 0.2, W.maxZ + T, 0);
  ph.addStaticAABB(W.minX, W.h, W.minZ, W.maxX, W.h + 0.2, W.maxZ, { surface: 'stone' });

  // ---------- stěny ----------
  const wallSeg = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    boxSpan(root, mats.wall, x0, y0, z0, x1, y1, z1, 0);
    ph.addStaticAABB(x0, y0, z0, x1, y1, z1, { surface: 'stone', tag: 'wall' });
  };
  // sever, jih, východ
  wallSeg(W.minX - T, 0, W.minZ - T, W.maxX + T, W.h, W.minZ);
  wallSeg(W.minX - T, 0, W.maxZ, W.maxX + T, W.h, W.maxZ + T);
  wallSeg(W.maxX, 0, W.minZ, W.maxX + T, W.h, W.maxZ);
  // západ – s oknem a balkonovými dveřmi
  const wx0 = W.minX - T;
  const wx1 = W.minX;
  wallSeg(wx0, 0, W.minZ, wx1, W.h, WINDOW.z0);
  wallSeg(wx0, 0, WINDOW.z0, wx1, WINDOW.sill - 0.035, WINDOW.z1);
  wallSeg(wx0, WINDOW.head, WINDOW.z0, wx1, W.h, WINDOW.z1);
  wallSeg(wx0, 0, WINDOW.z1, wx1, W.h, BALCONY_DOOR.z0);
  wallSeg(wx0, BALCONY_DOOR.head, BALCONY_DOOR.z0, wx1, W.h, BALCONY_DOOR.z1);
  wallSeg(wx0, 0, BALCONY_DOOR.z1, wx1, W.h, W.maxZ);
  // fasáda zvenku
  const fx = wx0 - 0.012;
  const fac = (y0: number, z0: number, y1: number, z1: number) => boxSpan(exterior, mats.facadeLight, fx, y0, z0, wx0 + 0.001, y1, z1, 0);
  fac(-3, W.minZ - 3, W.h + 3, WINDOW.z0);
  fac(-3, WINDOW.z0, WINDOW.sill - 0.035, WINDOW.z1);
  fac(WINDOW.head, WINDOW.z0, W.h + 3, WINDOW.z1);
  fac(-3, WINDOW.z1, W.h + 3, BALCONY_DOOR.z0);
  fac(BALCONY_DOOR.head, BALCONY_DOOR.z0, W.h + 3, BALCONY_DOOR.z1);
  fac(-3, BALCONY_DOOR.z1, W.h + 3, W.maxZ + 3);
  fac(-3, BALCONY_DOOR.z0, -0.02, BALCONY_DOOR.z1);

  // ---------- soklové lišty ----------
  const sk = (x0: number, z0: number, x1: number, z1: number) =>
    boxSpan(root, mats.skirting, x0, 0, z0, x1, 0.075, z1, 0.004, undefined, { cast: false });
  const st = 0.014;
  sk(W.minX, W.minZ, W.maxX, W.minZ + st);
  sk(W.minX, W.maxZ - st, W.maxX, W.maxZ);
  sk(W.maxX - st, W.minZ, W.maxX, ENTRY_DOOR.z0 - 0.06);
  sk(W.maxX - st, ENTRY_DOOR.z1 + 0.06, W.maxX, W.maxZ);
  sk(W.minX, W.minZ, W.minX + st, BALCONY_DOOR.z0 - 0.02);
  sk(W.minX, BALCONY_DOOR.z1 + 0.02, W.minX + st, W.maxZ);

  buildWindow(ctx);
  buildBalconyDoor(ctx);
  buildBalcony(ctx);
  buildEntryDoor(ctx);
  buildFixtures(ctx);
}

function buildWindow(ctx: WorldCtx): void {
  const { mats, physics: ph, root } = ctx;
  const { z0, z1, sill, head } = WINDOW;
  const xf = ROOM.minX - 0.2; // rovina zasklení
  const fw = 0.06; // šířka profilu
  const fd = 0.07; // hloubka profilu
  const F = mats.frameWhite;
  const g = new THREE.Group();
  g.name = 'window';
  root.add(g);
  // vnější rám
  boxSpan(g, F, xf - fd / 2, sill, z0, xf + fd / 2, sill + fw, z1, 0.006);
  boxSpan(g, F, xf - fd / 2, head - fw, z0, xf + fd / 2, head, z1, 0.006);
  boxSpan(g, F, xf - fd / 2, sill, z0, xf + fd / 2, head, z0 + fw, 0.006);
  boxSpan(g, F, xf - fd / 2, sill, z1 - fw, xf + fd / 2, head, z1, 0.006);
  // dvě křídla
  const zm = (z0 + z1) / 2;
  const sash = (a: number, b: number) => {
    const sw = 0.055;
    const sx0 = xf - 0.03;
    const sx1 = xf + 0.05;
    const y0 = sill + fw - 0.01;
    const y1 = head - fw + 0.01;
    boxSpan(g, F, sx0, y0, a, sx1, y0 + sw, b, 0.008);
    boxSpan(g, F, sx0, y1 - sw, a, sx1, y1, b, 0.008);
    boxSpan(g, F, sx0, y0, a, sx1, y1, a + sw, 0.008);
    boxSpan(g, F, sx0, y0, b - sw, sx1, y1, b, 0.008);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(b - a - sw * 2, y1 - y0 - sw * 2), mats.glass);
    pane.rotation.y = Math.PI / 2;
    pane.position.set(xf + 0.01, (y0 + y1) / 2, (a + b) / 2);
    pane.renderOrder = 5;
    g.add(pane);
  };
  sash(z0 + fw - 0.012, zm + 0.004);
  sash(zm - 0.004, z1 - fw + 0.012);
  // klika
  boxAt(g, mats.chrome, xf + 0.075, (sill + head) / 2, zm - 0.03, 0.03, 0.14, 0.022, 0.008);
  boxAt(g, mats.chrome, xf + 0.058, (sill + head) / 2 + 0.05, zm - 0.03, 0.03, 0.03, 0.03, 0.008);
  ph.addStaticAABB(xf - 0.04, sill, z0, xf + 0.05, head, z1, { surface: 'glass', tag: 'window' });

  // parapetní deska
  const b = WINDOW;
  boxSpan(g, mats.frameWhite, b.boardX0, sill - 0.035, b.boardZ0, b.boardX1, sill, b.boardZ1, 0.012);
  ph.addStaticAABB(b.boardX0, sill - 0.035, b.boardZ0, b.boardX1, sill, b.boardZ1, { surface: 'wood', tag: 'parapet' });
  // vnější plechový parapet
  boxSpan(ctx.exterior, mats.steel, ROOM.minX - 0.36, sill - 0.02, z0 - 0.03, xf - 0.03, sill - 0.005, z1 + 0.03, 0.002);

  // roleta v kazetě
  boxSpan(g, mats.frameWhite, ROOM.minX - 0.17, head - 0.075, z0 + 0.005, ROOM.minX - 0.1, head - 0.005, z1 - 0.005, 0.012);
  const blind = boxSpan(g, mats.linenWarm, ROOM.minX - 0.137, head - 0.36, z0 + 0.03, ROOM.minX - 0.133, head - 0.07, z1 - 0.03, 0.001);
  (blind.material as THREE.Material).side = THREE.DoubleSide;
  boxSpan(g, mats.frameWhite, ROOM.minX - 0.145, head - 0.375, z0 + 0.03, ROOM.minX - 0.125, head - 0.355, z1 - 0.03, 0.006);

  // radiátor pod oknem
  const rz0 = z0 + 0.1;
  const rz1 = z1 - 0.1;
  const rx = ROOM.minX + 0.03;
  boxSpan(g, mats.radiator, rx, 0.16, rz0, rx + 0.1, 0.76, rz1, 0.012);
  // žebrování – svislé drážky naznačené lištami
  const ribs = Math.round((rz1 - rz0) / 0.045);
  const ribGeo = rbox(0.008, 0.52, 0.02, 0.003);
  const ribMesh = new THREE.InstancedMesh(ribGeo, mats.radiator, ribs);
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < ribs; i++) {
    mtx.makeTranslation(rx + 0.103, 0.46, rz0 + 0.03 + ((rz1 - rz0 - 0.06) * i) / (ribs - 1));
    ribMesh.setMatrixAt(i, mtx);
  }
  ribMesh.castShadow = false;
  ribMesh.receiveShadow = true;
  g.add(ribMesh);
  // mřížka nahoře, ventil a trubky
  boxSpan(g, mats.radiator, rx - 0.005, 0.755, rz0 - 0.004, rx + 0.108, 0.775, rz1 + 0.004, 0.006);
  const pipe = mesh(cylinder(0.011, 0.011, 0.17, 10), mats.chrome, rx + 0.05, 0.085, rz1 - 0.06);
  g.add(pipe);
  const pipe2 = pipe.clone();
  pipe2.position.z = rz1 - 0.12;
  g.add(pipe2);
  const valve = mesh(cylinder(0.022, 0.024, 0.07, 14), mats.plasticWhite, rx + 0.05, 0.7, rz1 + 0.045);
  valve.rotation.x = Math.PI / 2;
  g.add(valve);
  ph.addStaticAABB(rx - 0.03, 0.14, rz0, rx + 0.11, 0.775, rz1, { surface: 'metal', tag: 'radiator' }, { camera: false });
}

function buildBalconyDoor(ctx: WorldCtx): void {
  const { mats, physics: ph, root } = ctx;
  const D = BALCONY_DOOR;
  const xf = ROOM.minX - 0.2;
  const F = mats.frameWhite;
  const g = new THREE.Group();
  g.name = 'balconyDoorFrame';
  root.add(g);
  const fw = 0.055;
  // zárubeň
  boxSpan(g, F, xf - 0.04, 0, D.z0, xf + 0.04, D.head, D.z0 + fw, 0.006);
  boxSpan(g, F, xf - 0.04, 0, D.z1 - fw, xf + 0.04, D.head, D.z1, 0.006);
  boxSpan(g, F, xf - 0.04, D.head - fw, D.z0, xf + 0.04, D.head, D.z1, 0.006);
  // práh
  boxSpan(g, mats.steel, ROOM.minX - 0.3, 0, D.z0 + fw, ROOM.minX, D.y0, D.z1 - fw, 0.004);
  ph.addStaticAABB(ROOM.minX - 0.3, -0.02, D.z0, ROOM.minX, D.y0 * 0.6, D.z1, { surface: 'metal' }, { camera: false });
  ph.addStaticAABB(xf - 0.04, 0, D.z0, xf + 0.04, D.head, D.z0 + fw, { surface: 'plastic' });
  ph.addStaticAABB(xf - 0.04, 0, D.z1 - fw, xf + 0.04, D.head, D.z1, { surface: 'plastic' });

  // křídlo – pant na severní hraně, otevírá se ven (na balkon)
  const pivot = new THREE.Group();
  pivot.name = 'balconyDoor';
  pivot.position.set(xf, 0, D.z0 + fw);
  root.add(pivot);
  const lw = D.z1 - D.z0 - fw * 2; // šířka křídla
  const y0 = D.y0 + 0.005;
  const y1 = D.head - fw - 0.005;
  const sw = 0.085;
  const t0 = -0.03;
  const t1 = 0.035;
  boxSpan(pivot, F, t0, y0, 0, t1, y0 + sw, lw, 0.008);
  boxSpan(pivot, F, t0, y1 - sw, 0, t1, y1, lw, 0.008);
  boxSpan(pivot, F, t0, y0, 0, t1, y1, sw, 0.008);
  boxSpan(pivot, F, t0, y0, lw - sw, t1, y1, lw, 0.008);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(lw - sw * 2, y1 - y0 - sw * 2), mats.glass);
  pane.rotation.y = Math.PI / 2;
  pane.position.set(0.004, (y0 + y1) / 2, lw / 2);
  pane.renderOrder = 5;
  pivot.add(pane);
  // klika
  boxAt(pivot, mats.chrome, t1 + 0.03, 1.05, lw - 0.045, 0.02, 0.025, 0.13, 0.008);
  boxAt(pivot, mats.chrome, t1 + 0.012, 1.05, lw - 0.045, 0.03, 0.03, 0.03, 0.008);
  boxAt(pivot, mats.chrome, t0 - 0.03, 1.05, lw - 0.045, 0.02, 0.025, 0.13, 0.008);

  pivot.rotation.y = -D.ajarAngle;
  const body = ph.addKinematic(
    pivot,
    [RAPIER.ColliderDesc.cuboid(0.035, (y1 - y0) / 2, lw / 2).setTranslation(0, (y0 + y1) / 2, lw / 2)],
    { surface: 'glass', tag: 'balconyDoor' },
  );
  const hinge: Hinged = { pivot, body, angle: D.ajarAngle, target: D.ajarAngle, speed: 0 };
  ctx.refs.balconyDoor = hinge;
  ctx.refs.balconyDoorLeafWidth = lw;
}

function buildBalcony(ctx: WorldCtx): void {
  const { mats, physics: ph, exterior } = ctx;
  const B = BALCONY;
  const g = new THREE.Group();
  g.name = 'balcony';
  exterior.add(g);
  // deska s dlažbou
  boxSpan(g, mats.concrete, B.minX, B.floorY - 0.22, B.minZ, ROOM.minX - ROOM.wallT, B.floorY - 0.012, B.maxZ, 0.01);
  const tiles = mesh(floorPlane(ROOM.minX - ROOM.wallT - B.minX, B.maxZ - B.minZ), mats.balconyTile, (B.minX + ROOM.minX - ROOM.wallT) / 2, B.floorY, (B.minZ + B.maxZ) / 2, { cast: false });
  g.add(tiles);
  ph.addStaticAABB(B.minX, B.floorY - 0.22, B.minZ, ROOM.minX - ROOM.wallT + 0.02, B.floorY, B.maxZ, { surface: 'stone', tag: 'balcony' });

  // zábradlí: sloupky, madlo, skleněné výplně
  const rail = mats.blackMetal;
  const top = B.floorY + B.railH;
  const post = (x: number, z: number) => boxAt(g, rail, x, B.floorY + B.railH / 2, z, 0.04, B.railH, 0.04, 0.006);
  const zs = [B.minZ + 0.02, (B.minZ + B.maxZ) / 2, B.maxZ - 0.02];
  for (const z of zs) post(B.minX + 0.02, z);
  post(ROOM.minX - ROOM.wallT - 0.03, B.minZ + 0.02);
  post(ROOM.minX - ROOM.wallT - 0.03, B.maxZ - 0.02);
  // madla
  boxSpan(g, rail, B.minX, top - 0.03, B.minZ, B.minX + 0.05, top + 0.015, B.maxZ, 0.012);
  boxSpan(g, rail, B.minX, top - 0.03, B.minZ, ROOM.minX - ROOM.wallT, top + 0.015, B.minZ + 0.05, 0.012);
  boxSpan(g, rail, B.minX, top - 0.03, B.maxZ - 0.05, ROOM.minX - ROOM.wallT, top + 0.015, B.maxZ, 0.012);
  // skleněné výplně
  const glassPanel = (x0: number, z0: number, x1: number, z1: number) => {
    const w = Math.hypot(x1 - x0, z1 - z0);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.06, B.railH - 0.2), mats.glass);
    p.position.set((x0 + x1) / 2, B.floorY + B.railH / 2 - 0.02, (z0 + z1) / 2);
    p.rotation.y = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
    p.renderOrder = 4;
    g.add(p);
  };
  glassPanel(B.minX + 0.02, zs[0], B.minX + 0.02, zs[1]);
  glassPanel(B.minX + 0.02, zs[1], B.minX + 0.02, zs[2]);
  glassPanel(B.minX + 0.02, B.minZ + 0.02, ROOM.minX - ROOM.wallT, B.minZ + 0.02);
  glassPanel(B.minX + 0.02, B.maxZ - 0.02, ROOM.minX - ROOM.wallT, B.maxZ - 0.02);
  // kolize zábradlí
  const info = { surface: 'glass' as const, tag: 'railing' };
  ph.addStaticAABB(B.minX - 0.02, B.floorY, B.minZ, B.minX + 0.05, top + 0.6, B.maxZ, info, { camera: false });
  ph.addStaticAABB(B.minX, B.floorY, B.minZ - 0.02, ROOM.minX - ROOM.wallT, top + 0.6, B.minZ + 0.05, info, { camera: false });
  ph.addStaticAABB(B.minX, B.floorY, B.maxZ - 0.05, ROOM.minX - ROOM.wallT, top + 0.6, B.maxZ + 0.02, info, { camera: false });

  // truhlík s bylinkami na zábradlí a skládací stolek
  const planter = boxSpan(g, mats.plasticDark, B.minX + 0.07, top - 0.19, B.maxZ - 0.9, B.minX + 0.25, top - 0.03, B.maxZ - 0.15, 0.015);
  planter.castShadow = true;
  const soil = boxSpan(g, new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 1 }), B.minX + 0.085, top - 0.05, B.maxZ - 0.885, B.minX + 0.235, top - 0.04, B.maxZ - 0.165, 0.002);
  soil.castShadow = false;
  ctx.refs.balconyPlanter = { x: B.minX + 0.16, y: top - 0.04, z0: B.maxZ - 0.87, z1: B.maxZ - 0.18 };
}

function buildEntryDoor(ctx: WorldCtx): void {
  const { mats, root } = ctx;
  const E = ENTRY_DOOR;
  const x = ROOM.maxX;
  const g = new THREE.Group();
  g.name = 'entryDoor';
  root.add(g);
  // zárubeň
  boxSpan(g, mats.frameWhite, x - 0.035, 0, E.z0 - 0.07, x, E.head + 0.07, E.z0, 0.006);
  boxSpan(g, mats.frameWhite, x - 0.035, 0, E.z1, x, E.head + 0.07, E.z1 + 0.07, 0.006);
  boxSpan(g, mats.frameWhite, x - 0.035, E.head, E.z0 - 0.07, x, E.head + 0.07, E.z1 + 0.07, 0.006);
  // křídlo s kazetami
  boxSpan(g, mats.cabinet, x - 0.022, 0.008, E.z0 + 0.004, x - 0.002, E.head - 0.004, E.z1 - 0.004, 0.004);
  const pw = (E.z1 - E.z0 - 0.3) / 1;
  boxSpan(g, mats.cabinet, x - 0.028, 0.18, E.z0 + 0.15, x - 0.02, 0.95, E.z0 + 0.15 + pw, 0.012);
  boxSpan(g, mats.cabinet, x - 0.028, 1.1, E.z0 + 0.15, x - 0.02, 1.9, E.z0 + 0.15 + pw, 0.012);
  // klika a zámek
  boxAt(g, mats.chrome, x - 0.045, 1.03, E.z0 + 0.09, 0.02, 0.022, 0.13, 0.008);
  boxAt(g, mats.chrome, x - 0.03, 1.03, E.z0 + 0.14, 0.028, 0.05, 0.05, 0.01);
  const lock = mesh(cylinder(0.018, 0.018, 0.012, 16), mats.brass, x - 0.028, 0.93, E.z0 + 0.14);
  lock.rotation.z = Math.PI / 2;
  g.add(lock);
  ctx.refs.entryDoorPos = new THREE.Vector3(x - 0.05, 1.0, (E.z0 + E.z1) / 2);
  // rohožka
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 });
  boxSpan(g, mat, x - 0.75, 0, E.z0 + 0.1, x - 0.1, 0.012, E.z1 - 0.1, 0.005, undefined, { cast: false });
}

function buildFixtures(ctx: WorldCtx): void {
  const { mats, root } = ctx;
  // stropní svítidlo (zhasnuté přisazené světlo)
  const base = mesh(cylinder(0.19, 0.2, 0.035, 40), mats.frameWhite, -0.6, ROOM.h - 0.018, 1.0, { cast: false });
  root.add(base);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xf7f4ec, roughness: 0.35, transparent: true, opacity: 0.92 }),
  );
  dome.scale.y = 0.42;
  dome.position.set(-0.6, ROOM.h - 0.035, 1.0);
  root.add(dome);

  // vypínač u vchodových dveří a zásuvky
  const plate = (x: number, y: number, z: number, onEast: boolean, twin = false) => {
    const w = twin ? 0.155 : 0.082;
    if (onEast) {
      boxAt(root, mats.plasticWhite, x - 0.005, y, z, 0.01, 0.082, w, 0.004, undefined, { cast: false });
      boxAt(root, mats.plasticWhite, x - 0.012, y, z, 0.006, 0.05, w - 0.03, 0.003, undefined, { cast: false });
    } else {
      boxAt(root, mats.plasticWhite, x, y, z + 0.005, w, 0.082, 0.01, 0.004, undefined, { cast: false });
      boxAt(root, mats.plasticWhite, x, y, z + 0.012, w - 0.03, 0.05, 0.006, 0.003, undefined, { cast: false });
    }
  };
  plate(ROOM.maxX, 1.1, ENTRY_DOOR.z0 - 0.22, true);
  plate(ROOM.maxX, 0.3, 0.45, true, true);
  plate(-2.2, 0.3, ROOM.minZ, false, true);
  plate(0.9, 0.3, ROOM.maxZ - 0.02, false);
}

/** Animace závěsů (dveře, dvířka) – volat v pevném kroku. */
export function updateHinge(h: Hinged, dt: number, sign = -1): void {
  const diff = h.target - h.angle;
  if (Math.abs(diff) < 1e-4 && Math.abs(h.speed) < 1e-4) return;
  // kriticky tlumená pružina
  const k = 30;
  const c = 9;
  h.speed += (diff * k - h.speed * c) * dt;
  h.angle += h.speed * dt;
  h.pivot.rotation.y = sign * h.angle;
  if (h.body) {
    h.pivot.updateWorldMatrix(true, false);
    const q = h.pivot.getWorldQuaternion(new THREE.Quaternion());
    const p = h.pivot.getWorldPosition(new THREE.Vector3());
    h.body.body.setNextKinematicTranslation(p);
    h.body.body.setNextKinematicRotation(q);
  }
}

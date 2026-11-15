import * as THREE from 'three';
import { RAPIER } from '../core/Physics';
import { assets } from '../core/Assets';
import type { WorldCtx } from './Ctx';
import { boxAt, mesh, cylinder, lathe, rbox, placeOnFloor } from './Geo';
import { canvasTexture, makeCanvas } from './ProcTextures';
import * as L from './Labels';
import {
  ROOM, FEEDER, TRASH_BIN, VACUUM_DOCK, BOOT, LAUNDRY, CALENDAR, KOMODA, BOOKSHELF, KITCHEN, ENTRY_DOOR,
} from './Layout';

/** Rekvizity hádanek. Vše, na co se dá sáhnout, má odkaz v ctx.refs. */
export async function buildProps(ctx: WorldCtx): Promise<void> {
  const noMerge: THREE.Object3D[] = (ctx.refs.noMerge ??= []);
  const dyn = new THREE.Group();
  dyn.name = 'dynamicProps';
  ctx.scene.add(dyn);
  ctx.refs.dynamicGroup = dyn;
  buildFeeder(ctx, noMerge);
  buildTrashBin(ctx, dyn);
  buildVacuum(ctx, dyn);
  buildLaundry(ctx, dyn);
  buildCalendar(ctx);
  buildWeddingPhoto(ctx);
  buildTvNote(ctx, noMerge);
  buildFridgeNote(ctx, dyn);
  buildCard(ctx, dyn);
  buildKittenFrame(ctx, dyn);
  buildTreats(ctx, dyn);
  buildLock(ctx, noMerge);
  await buildBoots(ctx, dyn);
}

function paperMat(canvas: HTMLCanvasElement, rough = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: canvasTexture(canvas, true, false), roughness: rough, side: THREE.DoubleSide });
}

// ------------------------------------------------------------------ dávkovač granulí
function buildFeeder(ctx: WorldCtx, noMerge: THREE.Object3D[]): void {
  const { mats, physics: ph, detail } = ctx;
  const g = new THREE.Group();
  g.name = 'feeder';
  g.position.set(FEEDER.x, 0, FEEDER.z);
  detail.add(g);
  noMerge.push(g);
  boxAt(g, mats.plasticWhite, 0.02, 0.07, 0, 0.2, 0.14, 0.24, 0.03);
  // zásobník (kouřový plast) a víko
  const hopperMat = new THREE.MeshPhysicalMaterial({ color: 0x8a8f96, roughness: 0.25, transparent: true, opacity: 0.55, depthWrite: false });
  const hopper = mesh(rbox(0.17, 0.22, 0.2, 0.03), hopperMat, 0.03, 0.25, 0, { cast: true });
  hopper.renderOrder = 3;
  g.add(hopper);
  // granule uvnitř
  const kibble = mesh(rbox(0.15, 0.12, 0.18, 0.025), new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 }), 0.03, 0.2, 0);
  g.add(kibble);
  boxAt(g, mats.plasticDark, 0.03, 0.37, 0, 0.18, 0.02, 0.21, 0.008);
  // výdejní skluz a miska (směrem do místnosti = −X)
  boxAt(g, mats.plasticWhite, -0.1, 0.035, 0, 0.08, 0.05, 0.12, 0.015);
  const bowl = mesh(lathe([[0, 0.004], [0.06, 0.004], [0.075, 0.03], [0.072, 0.034], [0.058, 0.012], [0, 0.012]], 28), mats.steel, -0.2, 0, 0);
  g.add(bowl);
  // displej
  const texOn = canvasTexture(L.feederDisplay('ERROR', true), true, false);
  const texOff = canvasTexture(L.feederDisplay('ERROR', false), true, false);
  const dispMat = new THREE.MeshStandardMaterial({ map: texOn, emissiveMap: texOn, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.3 });
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.03), dispMat);
  disp.rotation.y = -Math.PI / 2;
  disp.position.set(-0.0815, 0.105, 0);
  g.add(disp);
  boxAt(g, mats.plasticDark, -0.08, 0.105, 0, 0.004, 0.04, 0.09, 0.002);
  const btn = mesh(cylinder(0.009, 0.009, 0.004, 14), mats.plasticGrey, -0.082, 0.062, 0.03);
  btn.rotation.z = Math.PI / 2;
  g.add(btn);
  ph.addStaticAABB(FEEDER.x - 0.09, 0, FEEDER.z - 0.12, FEEDER.x + 0.13, 0.38, FEEDER.z + 0.12, { surface: 'plastic', tag: 'noStand' }, { camera: false });
  ph.addStaticCylinder(FEEDER.x - 0.2, 0.017, FEEDER.z, 0.017, 0.075, { surface: 'metal' }, false);
  ctx.refs.feeder = {
    group: g, dispMat, texOn, texOff,
    pos: new THREE.Vector3(FEEDER.x - 0.09, 0.1, FEEDER.z),
    bowlPos: new THREE.Vector3(FEEDER.x - 0.2, 0.03, FEEDER.z),
  };
}

// ------------------------------------------------------------------ odpadkový koš s plechovkou
function buildTrashBin(ctx: WorldCtx, dyn: THREE.Group): void {
  const { mats, physics: ph } = ctx;
  const h = 0.32;
  const r = 0.125;
  const g = new THREE.Group();
  g.name = 'trashBin';
  const binMat = new THREE.MeshStandardMaterial({ color: 0x3f5c4f, roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide });
  const body = mesh(lathe([[0, -h / 2 + 0.004], [r * 0.86, -h / 2 + 0.004], [r * 0.86, -h / 2], [r, h / 2], [r - 0.006, h / 2], [r * 0.86 - 0.006, -h / 2 + 0.01], [0, -h / 2 + 0.01]], 30), binMat);
  g.add(body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 8, 30), mats.chrome);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = h / 2;
  g.add(rim);
  // zmuchlaný papír uvnitř
  const junk = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 1, flatShading: true }));
  junk.position.set(0.02, -0.02, -0.01);
  g.add(junk);
  g.position.set(TRASH_BIN.x, h / 2, TRASH_BIN.z);
  dyn.add(g);
  g.traverse((o) => (o.castShadow = true));
  const entry = ph.addDynamic(
    g,
    [RAPIER.ColliderDesc.cylinder(h / 2, r * 0.95).setFriction(0.6).setRestitution(0.15).setDensity(55)],
    { info: { surface: 'metal', tag: 'noStand' }, tag: 'trashBin', linDamp: 0.5, angDamp: 0.7 },
  );
  // plechovka od tuňáka (objeví se, až se koš převrátí)
  const can = new THREE.Group();
  const label = canvasTexture(L.tunaLabel(), true, true);
  const side = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.035, 28, 1, true), new THREE.MeshStandardMaterial({ map: label, roughness: 0.5, metalness: 0.2 }));
  can.add(side);
  can.add(mesh(cylinder(0.042, 0.042, 0.002, 28), mats.steel, 0, -0.0175, 0));
  const inner = mesh(cylinder(0.04, 0.04, 0.002, 28), new THREE.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.35, metalness: 1 }), 0, -0.012, 0);
  can.add(inner);
  can.visible = false;
  can.traverse((o) => (o.castShadow = true));
  dyn.add(can);
  ctx.refs.trashBin = { entry, group: g, can, canEntry: null, tipped: false, height: h };
}

// ------------------------------------------------------------------ robotický vysavač
function buildVacuum(ctx: WorldCtx, dyn: THREE.Group): void {
  const { mats, physics: ph, root } = ctx;
  // dokovací stanice u východní stěny
  const dock = new THREE.Group();
  dock.position.set(VACUUM_DOCK.x, 0, VACUUM_DOCK.z);
  root.add(dock);
  boxAt(dock, mats.plasticDark, 0.13, 0.045, 0, 0.1, 0.09, 0.22, 0.02);
  boxAt(dock, mats.plasticDark, 0.02, 0.006, 0, 0.3, 0.012, 0.2, 0.004);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.004, 10), new THREE.MeshBasicMaterial({ color: 0x40ff80 }));
  led.rotation.y = -Math.PI / 2;
  led.position.set(0.079, 0.07, 0.07);
  dock.add(led);
  ph.addStaticAABB(VACUUM_DOCK.x + 0.08, 0, VACUUM_DOCK.z - 0.11, ROOM.maxX, 0.09, VACUUM_DOCK.z + 0.11, { surface: 'plastic', tag: 'noStand' }, { camera: false });

  const R = 0.17;
  const H = 0.085;
  const g = new THREE.Group();
  g.name = 'vacuum';
  const top = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.18, metalness: 0.1 });
  g.add(mesh(lathe([[0, 0.012], [R - 0.012, 0.012], [R, 0.022], [R, H - 0.012], [R - 0.008, H], [0, H]], 48), top));
  // nárazník
  const bumper = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.003, R + 0.003, 0.04, 40, 1, true, Math.PI * 0.5, Math.PI), mats.plasticDark);
  bumper.position.y = 0.042;
  g.add(bumper);
  // věžička lidaru
  g.add(mesh(cylinder(0.045, 0.048, 0.022, 28), mats.plasticDark, -0.02, H + 0.011, 0));
  // tlačítko se svítícím kroužkem
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x66ccff, emissiveIntensity: 0.4 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.022, 28), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(-0.1, H + 0.0012, 0);
  g.add(ring);
  g.add(mesh(cylinder(0.015, 0.015, 0.003, 20), mats.plasticGrey, -0.1, H + 0.001, 0));
  // kolečka
  for (const s of [-1, 1]) {
    const w = mesh(cylinder(0.03, 0.03, 0.02, 16), mats.rubber, 0.02, 0.03, s * 0.11);
    w.rotation.x = Math.PI / 2;
    g.add(w);
  }
  g.traverse((o) => (o.castShadow = true));
  // vysavač „kouká“ na západ (−X): přední strana = −X
  const start = new THREE.Vector3(VACUUM_DOCK.x - 0.2, 0, VACUUM_DOCK.z);
  g.position.copy(start);
  dyn.add(g);
  const body = ph.addKinematic(
    g,
    [RAPIER.ColliderDesc.cylinder(H / 2, R).setTranslation(0, H / 2 + 0.008, 0).setFriction(1)],
    { surface: 'plastic', tag: 'vacuum', carries: true },
  );
  ctx.refs.vacuum = {
    group: g, body, ringMat, radius: R, height: H, start, dir: new THREE.Vector3(-1, 0, 0),
    button: new THREE.Vector3(-0.1, H, 0),
  };
}

// ------------------------------------------------------------------ koš na prádlo
function buildLaundry(ctx: WorldCtx, dyn: THREE.Group): void {
  const { mats, physics: ph } = ctx;
  const h = 0.5;
  const r = 0.2;
  const g = new THREE.Group();
  g.name = 'laundry';
  const fabric = mats.linenWarm.clone();
  fabric.side = THREE.DoubleSide;
  g.add(mesh(lathe([[0, -h / 2 + 0.006], [r * 0.82, -h / 2 + 0.006], [r * 0.82, -h / 2], [r, h / 2], [r - 0.01, h / 2], [r * 0.82 - 0.01, -h / 2 + 0.012], [0, -h / 2 + 0.012]], 32), fabric));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r - 0.004, 0.012, 8, 32), mats.oak);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = h / 2;
  g.add(rim);
  // ucha z provazu
  const rope = new THREE.MeshStandardMaterial({ color: 0xcdb892, roughness: 1 });
  for (const s of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.007, 6, 16, Math.PI), rope);
    handle.position.set(s * (r + 0.004), h / 2 - 0.07, 0);
    handle.rotation.set(Math.PI, Math.PI / 2, 0);
    g.add(handle);
  }
  // prádlo: pár „hadříků“ přes okraj
  const cloth = (color: number, x: number, y: number, z: number, rx: number, rz: number, w = 0.2, d = 0.16) => {
    const m = mesh(rbox(w, 0.05, d, 0.02), new THREE.MeshStandardMaterial({ color, roughness: 1, normalMap: mats.linen.normalMap }), x, y, z);
    m.rotation.set(rx, 0.4, rz);
    g.add(m);
  };
  cloth(0x3d5a80, 0.02, h / 2 - 0.03, 0.02, 0.2, -0.15, 0.26, 0.22);
  cloth(0xd9d2c5, -0.05, h / 2 + 0.005, -0.04, -0.25, 0.2);
  cloth(0xa23b3b, 0.09, h / 2 - 0.01, -0.06, 0.1, 0.5, 0.14, 0.2);
  g.position.set(LAUNDRY.x, h / 2, LAUNDRY.z);
  g.traverse((o) => (o.castShadow = true));
  dyn.add(g);
  const entry = ph.addDynamic(
    g,
    [RAPIER.ColliderDesc.cylinder(h / 2, r * 0.93).setFriction(0.5).setRestitution(0).setDensity(28)],
    { info: { surface: 'fabric', tag: 'noStand' }, tag: 'laundry', linDamp: 2.4, angDamp: 4 },
  );
  entry.body.setEnabledRotations(false, true, false, true);
  ctx.refs.laundry = entry;
}

// ------------------------------------------------------------------ kalendář
function buildCalendar(ctx: WorldCtx): void {
  const { mats, detail } = ctx;
  const w = 0.3;
  const hh = (w * 720) / 512;
  const g = new THREE.Group();
  g.position.set(CALENDAR.x, CALENDAR.y, ROOM.minZ + 0.004);
  detail.add(g);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), paperMat(L.calendar(), 0.8));
  m.castShadow = true;
  g.add(m);
  g.add(mesh(cylinder(0.004, 0.004, 0.012, 8), mats.steel, 0, hh / 2 - 0.012, 0.004).rotateX(Math.PI / 2));
  ctx.refs.calendar = { pos: new THREE.Vector3(CALENDAR.x, CALENDAR.y, ROOM.minZ + 0.01), floor: new THREE.Vector3(CALENDAR.x, 0, ROOM.minZ + 0.7) };
}

// ------------------------------------------------------------------ svatební fotka na komodě
function buildWeddingPhoto(ctx: WorldCtx): void {
  const { mats, physics: ph, detail } = ctx;
  const g = new THREE.Group();
  const x = KOMODA.x0 + 0.17;
  const z = KOMODA.z0 + 0.62;
  g.position.set(x, KOMODA.h, z);
  g.rotation.y = Math.PI / 2 - 0.12; // čelem do místnosti
  detail.add(g);
  const w = 0.2;
  const hh = 0.25;
  const frame = new THREE.Group();
  frame.rotation.x = -0.16;
  frame.position.y = 0.002;
  g.add(frame);
  boxAt(frame, mats.blackMetal, 0, hh / 2, 0, w, hh, 0.014, 0.004);
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.03, hh - 0.03), new THREE.MeshStandardMaterial({ map: canvasTexture(L.matted(L.weddingPhoto()), true, false), roughness: 0.25 }));
  photo.position.set(0, hh / 2, 0.0075);
  frame.add(photo);
  // opěrka
  const stand = boxAt(g, mats.blackMetal, 0, 0.09, -0.045, 0.03, 0.2, 0.004, 0.001);
  stand.rotation.x = 0.35;
  ph.addStaticBox(x, KOMODA.h + hh / 2, z, 0.035, hh / 2, w / 2, { surface: 'glass', tag: 'noStand' }, { camera: false });
  ctx.refs.weddingPhoto = { pos: new THREE.Vector3(x + 0.02, KOMODA.h + hh / 2, z), group: g };
}

// ------------------------------------------------------------------ lísteček na televizi
function buildTvNote(ctx: WorldCtx, noMerge: THREE.Object3D[]): void {
  const tv = ctx.refs.tv;
  if (!tv) return;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.062), paperMat(L.tvNote()));
  m.position.copy(tv.notePos);
  m.rotation.set(0.04, Math.PI, 0.06);
  m.castShadow = false;
  ctx.detail.add(m);
  noMerge.push(m);
  ctx.refs.tvNote = { mesh: m, pos: tv.notePos.clone() };
}

// ------------------------------------------------------------------ lísteček a magnet na lednici
function buildFridgeNote(ctx: WorldCtx, dyn: THREE.Group): void {
  const f = ctx.refs.fridge;
  if (!f) return;
  const g = new THREE.Group();
  g.name = 'fridgeNote';
  g.position.copy(f.magnetPos);
  dyn.add(g);
  const note = new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.082), paperMat(L.noteFridge()));
  note.position.set(0, -0.03, 0.0015);
  note.rotation.z = -0.05;
  g.add(note);
  const magnetMat = new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.3 });
  const magnet = mesh(cylinder(0.016, 0.016, 0.008, 24), magnetMat, 0, 0, 0.006);
  magnet.rotation.x = Math.PI / 2;
  g.add(magnet);
  ctx.refs.fridgeNote = { group: g, note, magnet, state: 'onFridge' as 'onFridge' | 'falling' | 'under' | 'out' | 'taken', t: 0, pulls: 0 };
}

// ------------------------------------------------------------------ očkovací průkaz pod gaučem
function buildCard(ctx: WorldCtx, dyn: THREE.Group): void {
  const s = ctx.refs.sofa;
  if (!s) return;
  const tex = canvasTexture(L.vaccinationCard(), true, false);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.09), mat);
  m.rotation.set(-Math.PI / 2, 0, 0.5);
  m.position.copy(s.cardPos);
  m.receiveShadow = true;
  dyn.add(m);
  ctx.refs.card = { mesh: m, mat, pos: s.cardPos.clone(), taken: false };
}

// ------------------------------------------------------------------ fotka koťátka na knihovně
function buildKittenFrame(ctx: WorldCtx, dyn: THREE.Group): void {
  const { mats } = ctx;
  const w = 0.2;
  const hh = 0.16;
  const g = new THREE.Group();
  g.name = 'kittenFrame';
  const x = (BOOKSHELF.x0 + BOOKSHELF.x1) / 2 + 0.22;
  const z = ROOM.minZ + BOOKSHELF.depth / 2 - 0.02;
  g.position.set(x, BOOKSHELF.h + hh / 2 + 0.002, z);
  g.rotation.x = -0.13;
  dyn.add(g);
  const frameMat = mats.oakDark.clone();
  const bars = new THREE.Group();
  g.add(bars);
  const t = 0.016;
  boxAt(bars, frameMat, 0, hh / 2 - t / 2, 0, w, t, 0.018, 0.003);
  boxAt(bars, frameMat, 0, -hh / 2 + t / 2, 0, w, t, 0.018, 0.003);
  boxAt(bars, frameMat, -w / 2 + t / 2, 0, 0, t, hh - t * 2, 0.018, 0.003);
  boxAt(bars, frameMat, w / 2 - t / 2, 0, 0, t, hh - t * 2, 0.018, 0.003);
  // fotka (líc se doplní snímkem Tigera), rub s nápisem
  const frontCanvas = L.kittenFrontFallback();
  const frontTex = canvasTexture(frontCanvas, true, false);
  const photoFront = new THREE.Mesh(new THREE.PlaneGeometry(w - t * 2, hh - t * 2), new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.4 }));
  photoFront.position.z = 0.002;
  const photoBack = new THREE.Mesh(new THREE.PlaneGeometry(w - t * 2, hh - t * 2), new THREE.MeshStandardMaterial({ map: canvasTexture(L.kittenBack(), true, false), roughness: 0.85 }));
  photoBack.rotation.y = Math.PI;
  photoBack.position.z = -0.002;
  const photo = new THREE.Group();
  photo.add(photoFront, photoBack);
  g.add(photo);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - t * 2, hh - t * 2), mats.glass.clone());
  (glass.material as THREE.MeshPhysicalMaterial).opacity = 0.14;
  glass.position.z = 0.006;
  glass.renderOrder = 6;
  g.add(glass);
  const stand = boxAt(g, frameMat, 0, -0.01, -0.04, 0.03, hh * 0.9, 0.004, 0.001);
  stand.rotation.x = 0.42;
  g.traverse((o) => (o.castShadow = true));
  glass.castShadow = false;
  ctx.refs.kittenFrame = {
    group: g, bars, photo, glass, stand, frontCanvas, frontTex, w, h: hh,
    state: 'onShelf' as 'onShelf' | 'falling' | 'broken' | 'read',
    entry: null as null | import('../core/Physics').BodyEntry,
    photoEntry: null as null | import('../core/Physics').BodyEntry,
    home: g.position.clone(),
  };
}

// ------------------------------------------------------------------ pamlsky: sáček, granulky, zlatý pamlsek
function buildTreats(ctx: WorldCtx, dyn: THREE.Group): void {
  const cab = ctx.refs.treatCabinet;
  // sáček ve skříňce
  const bag = new THREE.Group();
  bag.name = 'treatBag';
  const tex = canvasTexture(L.treatBagLabel(), true, false);
  const bagMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.15 });
  const body = mesh(rbox(0.11, 0.16, 0.045, 0.018), bagMat);
  // UV přední/zadní plochy 0..1
  const uv = body.geometry.getAttribute('uv') as THREE.BufferAttribute;
  const pos = body.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 0.11 + 0.5, pos.getY(i) / 0.16 + 0.5);
  bag.add(body);
  boxAt(bag, new THREE.MeshStandardMaterial({ color: 0xc9c9c9, roughness: 0.3, metalness: 0.6 }), 0, 0.083, 0, 0.11, 0.012, 0.006, 0.002);
  bag.traverse((o) => (o.castShadow = true));
  if (cab) bag.position.set(cab.inner.x, cab.inner.y + 0.082, cab.inner.z + 0.02);
  bag.rotation.y = 0.2;
  dyn.add(bag);
  // granulky – instancovaná síť řízená fyzikou (vytvoří se při rozsypání)
  const treatGeo = new THREE.DodecahedronGeometry(0.009, 0);
  const treatMat = new THREE.MeshStandardMaterial({ color: 0xa5672f, roughness: 0.85, flatShading: true });
  ctx.refs.treats = { bag, bagEntry: null, geo: treatGeo, mat: treatMat, pieces: [] as Array<{ mesh: THREE.Mesh; entry: import('../core/Physics').BodyEntry; eaten: boolean }>, state: 'locked' };

  // zlatý pamlsek nahoře na skříňkách
  const gp: THREE.Vector3 = ctx.refs.goldenTreatPos;
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc94a, roughness: 0.22, metalness: 1, emissive: 0x5a3a00, emissiveIntensity: 0.6 });
  const g = new THREE.Group();
  g.name = 'goldenTreat';
  // rybička: tělo + ocásek
  const fish = new THREE.Mesh(new THREE.SphereGeometry(0.02, 20, 14), gold);
  fish.scale.set(1.5, 0.75, 0.5);
  g.add(fish);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.022, 3), gold);
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -0.036;
  tail.scale.z = 0.4;
  g.add(tail);
  g.position.set(gp.x, gp.y + 0.018, gp.z);
  g.rotation.y = 0.6;
  g.traverse((o) => (o.castShadow = true));
  dyn.add(g);
  // podložka: víčko od zavařovačky, na kterém pamlsek leží
  ctx.root.add(mesh(cylinder(0.04, 0.04, 0.004, 24), ctx.mats.brass, gp.x, gp.y + 0.002, gp.z));
  ctx.refs.goldenTreat = { group: g, pos: g.position.clone(), taken: false };
}

// ------------------------------------------------------------------ kódový zámek na skříňce
function buildLock(ctx: WorldCtx, noMerge: THREE.Object3D[]): void {
  const cab = ctx.refs.treatCabinet;
  if (!cab) return;
  const { mats } = ctx;
  const g = new THREE.Group();
  g.name = 'codeLock';
  // zámek sedí na volné (východní) hraně dvířek dole a zasahuje přes bok korpusu
  const x = KITCHEN.upperX1 - 0.085;
  const y = KITCHEN.upperY0 + 0.085;
  const z = cab.front.z + 0.022;
  g.position.set(x, y, z);
  ctx.root.add(g);
  noMerge.push(g);
  // tělo zámku a petlice
  boxAt(g, mats.steel, 0, 0, -0.004, 0.13, 0.05, 0.03, 0.006);
  boxAt(g, mats.brass, 0.08, 0, -0.012, 0.05, 0.03, 0.012, 0.004);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 8, 18, Math.PI), mats.chrome);
  shackle.position.set(0.085, 0.022, -0.004);
  g.add(shackle);
  // 4 kolečka s číslicemi – osa X, číslice jdou po obvodu
  const [dc, dg] = makeCanvas(1024, 128);
  const src = L.lockDigits();
  // číslice otočit o 90°, aby na válci s vodorovnou osou stály svisle
  for (let d = 0; d < 10; d++) {
    dg.save();
    dg.translate(d * 102.4 + 51.2, 64);
    dg.rotate(-Math.PI / 2);
    dg.drawImage(src, d * 102.4, 0, 102.4, 128, -64, -51.2, 128, 102.4);
    dg.restore();
  }
  const tex = canvasTexture(dc, true, true);
  const wheels: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.CylinderGeometry(0.0155, 0.0155, 0.019, 40, 1, true);
    geo.rotateZ(Math.PI / 2);
    const w = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.6 }));
    w.position.set(-0.042 + i * 0.024, 0, 0.004);
    w.castShadow = true;
    g.add(w);
    wheels.push(w);
    const cap = mesh(cylinder(0.0158, 0.0158, 0.0025, 24), mats.blackMetal, -0.042 + i * 0.024 + 0.0108, 0, 0.004);
    cap.rotation.z = Math.PI / 2;
    g.add(cap);
  }
  // ryska ukazující čtenou řadu
  boxAt(g, new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.4 }), -0.062, 0, 0.012, 0.006, 0.003, 0.006, 0.001);
  ctx.refs.lock = { group: g, wheels, pos: new THREE.Vector3(x, y, z + 0.02), digits: [0, 0, 0, 0], angles: [0, 0, 0, 0] };
}

// ------------------------------------------------------------------ holínky
async function buildBoots(ctx: WorldCtx, dyn: THREE.Group): Promise<void> {
  const { physics: ph, mats, detail } = ctx;
  const model = await assets.model('rubber_boots');
  const holder = new THREE.Group();
  holder.name = 'boot';
  let bootH = 0.36;
  if (model) {
    // jedna holínka jako pohyblivá překážka, pár u dveří jako kulisa
    const single = model.getObjectByName('rubber_boots_l') ?? model.children[0];
    const pairA = model.getObjectByName('rubber_boots_dirty_l');
    const pairB = model.getObjectByName('rubber_boots_dirt_r');
    if (pairA && pairB) {
      const pair = new THREE.Group();
      pair.add(pairA.clone(true), pairB.clone(true));
      detail.add(pair);
      pair.rotation.y = Math.PI / 2;
      placeOnFloor(pair, ROOM.maxX - 0.45, 0.012, ENTRY_DOOR.z1 - 0.28);
    }
    const s = single.clone(true);
    holder.add(s);
    const b = placeOnFloor(s, 0, 0, 0);
    bootH = b.max.y - b.min.y;
    s.position.y -= bootH / 2;
  } else {
    holder.add(mesh(rbox(0.1, 0.36, 0.12, 0.03), mats.rubber, 0, 0, -0.06));
    holder.add(mesh(rbox(0.1, 0.1, 0.27, 0.03), mats.rubber, 0, -0.13, 0.02));
  }
  holder.position.set(BOOT.x, bootH / 2, BOOT.z);
  holder.rotation.y = -0.5;
  dyn.add(holder);
  const entry = ph.addDynamic(
    holder,
    [
      RAPIER.ColliderDesc.cuboid(0.048, bootH / 2, 0.055).setTranslation(0, 0, -0.07).setFriction(0.7).setDensity(110),
      RAPIER.ColliderDesc.cuboid(0.048, 0.05, 0.13).setTranslation(0, -bootH / 2 + 0.05, 0.01).setFriction(0.7).setDensity(160),
    ],
    { info: { surface: 'plastic', tag: 'noStand' }, tag: 'boot', linDamp: 1.6, angDamp: 2.5 },
  );
  ctx.refs.boot = entry;
}


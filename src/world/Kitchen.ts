import * as THREE from 'three';
import type { WorldCtx, Hinged } from './Ctx';
import { boxSpan, boxAt, mesh, cylinder, lathe } from './Geo';
import { ROOM, KITCHEN as K } from './Layout';

/** Kuchyňský kout: linka u severní stěny, poloostrov s dřezem, digestoř, horní skříňky, lednice. */
export function buildKitchen(ctx: WorldCtx): void {
  const { mats, physics: ph, root, detail } = ctx;
  const g = new THREE.Group();
  g.name = 'kitchen';
  root.add(g);
  const zN = ROOM.minZ;
  const zF = zN + K.runDepth; // čelo linky (-1.88)
  const bodyTop = K.counterH - K.topT; // 0.88
  const plinth = 0.1;
  const ft = 0.019; // tloušťka dvířek

  // ----- korpus linky u stěny -----
  boxSpan(g, mats.cabinet, K.runX0, plinth, zN, K.runX1, bodyTop, zF - ft, 0.004);
  boxSpan(g, mats.plasticDark, K.runX0, 0, zN, K.runX1, plinth, zF - 0.06, 0.003);
  ph.addStaticAABB(K.runX0, 0, zN, K.runX1, K.counterH, zF + 0.02, { surface: 'wood', tag: 'counter' });

  const handle = (parent: THREE.Object3D, x: number, y: number, z: number, len: number, axis: 'x' | 'z' | 'y', out: [number, number, number]) => {
    const bar = mesh(cylinder(0.006, 0.006, len, 10), mats.steel, x + out[0] * 0.03, y + out[1] * 0.03, z + out[2] * 0.03);
    if (axis === 'x') bar.rotation.z = Math.PI / 2;
    if (axis === 'z') bar.rotation.x = Math.PI / 2;
    parent.add(bar);
    for (const s of [-1, 1]) {
      const d = (len / 2 - 0.02) * s;
      const post = mesh(cylinder(0.005, 0.005, 0.03, 8), mats.steel,
        x + out[0] * 0.015 + (axis === 'x' ? d : 0), y + out[1] * 0.015 + (axis === 'y' ? d : 0), z + out[2] * 0.015 + (axis === 'z' ? d : 0));
      if (out[2] !== 0) post.rotation.x = Math.PI / 2;
      if (out[0] !== 0) post.rotation.z = Math.PI / 2;
      parent.add(post);
    }
  };

  // čela: zásuvky pod varnou deskou (1.1–1.75), dvířka (1.75–2.35)
  const gap = 0.003;
  const drawerHs = [0.16, 0.28, 0.33];
  let dy = plinth + 0.005;
  for (const h of [...drawerHs].reverse()) {
    boxSpan(g, mats.cabinet, K.penX1 + gap, dy, zF - ft, K.upperX0 - gap, dy + h - gap, zF, 0.004);
    handle(g, (K.penX1 + K.upperX0) / 2, dy + h - 0.045, zF, 0.3, 'x', [0, 0, 1]);
    dy += h;
  }
  boxSpan(g, mats.cabinet, K.upperX0 + gap, plinth + 0.005, zF - ft, K.runX1 - gap, bodyTop - gap, zF, 0.004);
  handle(g, K.upperX0 + 0.06, bodyTop - 0.2, zF, 0.22, 'y', [0, 0, 1]);

  // pracovní deska (dub)
  boxSpan(g, mats.oakDark, K.runX0, bodyTop, zN, K.runX1 + 0.012, K.counterH, zF + 0.02, 0.006, 'x');

  // indukční deska
  const hob = boxSpan(g, mats.screen, K.hoodX0 + 0.03, K.counterH, zN + 0.09, K.hoodX1 - 0.03, K.counterH + 0.006, zF - 0.07, 0.003);
  hob.castShadow = false;
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.3 });
  for (const [rx, rz, rr] of [[-0.13, -0.1, 0.09], [0.13, -0.1, 0.075], [-0.13, 0.11, 0.075], [0.13, 0.11, 0.09]] as const) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(rr - 0.004, rr, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set((K.hoodX0 + K.hoodX1) / 2 + rx, K.counterH + 0.0066, (zN + zF) / 2 + rz);
    g.add(ring);
  }

  // obklad nad linkou
  const splash = boxSpan(g, mats.backsplash, K.runX0 - 0.26, K.counterH, zN, K.runX1, K.upperY0, zN + 0.012, 0.002);
  splash.castShadow = false;

  // ----- digestoř (komínová, šikmá – nedá se na ní stát) -----
  const hood = new THREE.Group();
  g.add(hood);
  const hx = (K.hoodX0 + K.hoodX1) / 2;
  const hw = K.hoodX1 - K.hoodX0;
  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.19, hw / 2 / Math.cos(Math.PI / 4), 0.16, 4, 1), mats.steel);
  canopy.rotation.y = Math.PI / 4;
  canopy.scale.z = 0.5 / hw;
  canopy.position.set(hx, 1.7, zN + 0.25);
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  hood.add(canopy);
  boxSpan(hood, mats.steel, K.hoodX0, 1.585, zN, K.hoodX1, 1.62, zN + 0.5, 0.004);
  boxSpan(hood, mats.steel, hx - 0.13, 1.76, zN, hx + 0.13, ROOM.h, zN + 0.24, 0.004);
  ph.addStaticAABB(K.hoodX0, 1.585, zN, K.hoodX1, 1.7, zN + 0.5, { surface: 'metal', tag: 'noStand' });
  ph.addStaticAABB(hx - 0.13, 1.7, zN, hx + 0.13, ROOM.h, zN + 0.24, { surface: 'metal' });
  // pod digestoří LED
  const hoodLed = new THREE.Mesh(new THREE.PlaneGeometry(hw - 0.2, 0.05), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff1d6, emissiveIntensity: 0 }));
  hoodLed.rotation.x = Math.PI / 2;
  hoodLed.position.set(hx, 1.583, zN + 0.3);
  hood.add(hoodLed);
  ctx.refs.hoodLed = hoodLed;

  // ----- horní skříňka s pamlsky (kódový zámek) -----
  const uz1 = zN + K.upperDepth; // čelo korpusu
  const cab = new THREE.Group();
  cab.name = 'treatCabinet';
  g.add(cab);
  const t = 0.018;
  // korpus: boky, dno, strop, záda, police
  boxSpan(cab, mats.cabinet, K.upperX0, K.upperY0, zN, K.upperX0 + t, K.upperY1, uz1, 0.003);
  boxSpan(cab, mats.cabinet, K.upperX1 - t, K.upperY0, zN, K.upperX1, K.upperY1, uz1, 0.003);
  boxSpan(cab, mats.cabinet, K.upperX0, K.upperY0, zN, K.upperX1, K.upperY0 + t, uz1, 0.003);
  boxSpan(cab, mats.cabinet, K.upperX0, K.upperY1 - t, zN, K.upperX1, K.upperY1, uz1, 0.003);
  boxSpan(cab, mats.cabinetInner, K.upperX0 + t, K.upperY0 + t, zN, K.upperX1 - t, K.upperY1 - t, zN + 0.008, 0.001);
  boxSpan(cab, mats.cabinetInner, K.upperX0 + t, 1.86, zN + 0.008, K.upperX1 - t, 1.86 + t, uz1 - 0.03, 0.003);
  ph.addStaticAABB(K.upperX0, K.upperY0, zN, K.upperX1, K.upperY1, uz1 + 0.02, { surface: 'wood', tag: 'upperCabinet' });
  // dvířka – pant na západní hraně
  const doorPivot = new THREE.Group();
  doorPivot.position.set(K.upperX0 + 0.002, 0, uz1);
  cab.add(doorPivot);
  const dw = K.upperX1 - K.upperX0 - 0.004;
  boxSpan(doorPivot, mats.cabinet, 0, K.upperY0 + 0.002, 0.002, dw, K.upperY1 - 0.002, 0.002 + ft, 0.004);
  handle(doorPivot, dw - 0.05, K.upperY0 + 0.34, 0.002 + ft, 0.2, 'y', [0, 0, 1]);
  const door: Hinged = { pivot: doorPivot, body: null, angle: 0, target: 0, speed: 0 };
  ctx.refs.treatDoor = door;
  ctx.refs.treatCabinet = {
    group: cab,
    inner: new THREE.Vector3((K.upperX0 + K.upperX1) / 2, K.upperY0 + t, zN + 0.2),
    front: new THREE.Vector3((K.upperX0 + K.upperX1) / 2, K.upperY0 + 0.2, uz1 + ft),
    doorPivot,
    doorWidth: dw,
  };

  // skříňka nad lednicí
  boxSpan(g, mats.cabinet, K.fridgeX0 - 0.01, K.fridgeH + 0.012, zN, ROOM.maxX, K.upperY1, zN + 0.6, 0.004);
  boxSpan(g, mats.cabinet, K.fridgeX0 - 0.01 + gap, K.fridgeH + 0.016, zN + 0.6, ROOM.maxX - gap, K.upperY1 - gap, zN + 0.6 + ft, 0.004);
  handle(g, (K.fridgeX0 + ROOM.maxX) / 2, K.fridgeH + 0.07, zN + 0.6 + ft, 0.25, 'x', [0, 0, 1]);
  ph.addStaticAABB(K.fridgeX0 - 0.01, K.fridgeH, zN, ROOM.maxX, K.upperY1, zN + 0.62, { surface: 'wood', tag: 'upperCabinet' });
  // vršek skříněk: lišta – a místo pro zlatý pamlsek
  ctx.refs.goldenTreatPos = new THREE.Vector3(2.72, K.upperY1, zN + 0.3);

  // ----- poloostrov s dřezem -----
  const pz0 = K.penZ0;
  const pz1 = K.penZ1;
  const sink = { x0: 0.6, x1: 1.0, z0: -1.62, z1: -1.2, bottom: 0.745 };
  boxSpan(g, mats.cabinet, K.penX0, plinth, pz0, K.penX1 - ft, bodyTop, pz1, 0.004);
  boxSpan(g, mats.plasticDark, K.penX0 + 0.05, 0, pz0, K.penX1 - 0.06, plinth, pz1 - 0.05, 0.003);
  // čela směrem do kuchyně (východ): dřezová dvířka + myčka
  const fe = K.penX1;
  boxSpan(g, mats.cabinet, fe - ft, plinth + 0.005, pz0 + 0.06 + gap, fe, bodyTop - gap, -1.3 - gap, 0.004);
  handle(g, fe, bodyTop - 0.2, -1.36, 0.22, 'y', [1, 0, 0]);
  boxSpan(g, mats.cabinet, fe - ft, plinth + 0.005, -1.3 + gap, fe, bodyTop - gap, pz1 - gap, 0.004);
  handle(g, fe, bodyTop - 0.06, (-1.3 + pz1) / 2, 0.4, 'z', [1, 0, 0]);
  // deska s výřezem pro dřez (přesah na západ pro barové sezení)
  const tx0 = K.penTopX0;
  const tx1 = K.penX1 + 0.012;
  const tz1 = pz1 + 0.02;
  const top = (x0: number, z0: number, x1: number, z1: number) => {
    boxSpan(g, mats.oakDark, x0, bodyTop, z0, x1, K.penH, z1, 0.005, 'z');
    ph.addStaticAABB(x0, bodyTop, z0, x1, K.penH, z1, { surface: 'wood', tag: 'counter' });
  };
  top(tx0, pz0 + 0.02, tx1, sink.z0);
  top(tx0, sink.z1, tx1, tz1);
  top(tx0, sink.z0, sink.x0, sink.z1);
  top(sink.x1, sink.z0, tx1, sink.z1);
  // dřez (nerez vanička)
  const sm = mats.steel;
  boxSpan(g, sm, sink.x0, sink.bottom - 0.01, sink.z0, sink.x1, sink.bottom, sink.z1, 0.002);
  boxSpan(g, sm, sink.x0 - 0.004, sink.bottom, sink.z0 - 0.004, sink.x0 + 0.002, K.penH - 0.002, sink.z1 + 0.004, 0.001);
  boxSpan(g, sm, sink.x1 - 0.002, sink.bottom, sink.z0 - 0.004, sink.x1 + 0.004, K.penH - 0.002, sink.z1 + 0.004, 0.001);
  boxSpan(g, sm, sink.x0, sink.bottom, sink.z0 - 0.004, sink.x1, K.penH - 0.002, sink.z0 + 0.002, 0.001);
  boxSpan(g, sm, sink.x0, sink.bottom, sink.z1 - 0.002, sink.x1, K.penH - 0.002, sink.z1 + 0.004, 0.001);
  const drain = mesh(cylinder(0.028, 0.028, 0.004, 20), mats.chrome, (sink.x0 + sink.x1) / 2, sink.bottom + 0.002, (sink.z0 + sink.z1) / 2, { cast: false });
  g.add(drain);
  // kolize těla poloostrova (s prohlubní dřezu)
  ph.addStaticAABB(K.penX0, 0, pz0, K.penX1, sink.bottom, pz1, { surface: 'metal', tag: 'peninsula' });
  ph.addStaticAABB(K.penX0, sink.bottom, pz0, K.penX1, bodyTop, sink.z0, { surface: 'wood' });
  ph.addStaticAABB(K.penX0, sink.bottom, sink.z1, K.penX1, bodyTop, pz1, { surface: 'wood' });
  ph.addStaticAABB(K.penX0, sink.bottom, sink.z0, sink.x0, bodyTop, sink.z1, { surface: 'wood' });
  ph.addStaticAABB(sink.x1, sink.bottom, sink.z0, K.penX1, bodyTop, sink.z1, { surface: 'wood' });
  // baterie
  const fx = (sink.x0 + sink.x1) / 2;
  const fz = sink.z0 - 0.07;
  g.add(mesh(cylinder(0.024, 0.027, 0.05, 20), mats.chrome, fx, K.penH + 0.025, fz));
  const neck = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(fx, K.penH + 0.05, fz),
        new THREE.Vector3(fx, K.penH + 0.3, fz),
        new THREE.Vector3(fx, K.penH + 0.36, fz + 0.06),
        new THREE.Vector3(fx, K.penH + 0.33, fz + 0.15),
        new THREE.Vector3(fx, K.penH + 0.26, fz + 0.17),
      ]),
      24, 0.011, 10,
    ),
    mats.chrome,
  );
  neck.castShadow = true;
  g.add(neck);
  const lever = boxAt(g, mats.chrome, fx + 0.045, K.penH + 0.07, fz, 0.07, 0.012, 0.016, 0.005);
  lever.rotation.z = 0.35;

  // ----- lednice -----
  buildFridge(ctx, g);

  // ----- drobnosti na lince (detail – nezapékají se do GI) -----
  const kettle = new THREE.Group();
  kettle.position.set(0.78, K.counterH, zN + 0.3);
  kettle.add(mesh(lathe([[0, 0], [0.075, 0], [0.08, 0.02], [0.07, 0.17], [0.055, 0.2], [0, 0.2]], 28), mats.steel));
  const kh = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 8, 20, Math.PI), mats.plasticDark);
  kh.position.set(0.085, 0.11, 0);
  kh.rotation.z = -Math.PI / 2;
  kettle.add(kh);
  kettle.add(mesh(cylinder(0.085, 0.085, 0.02, 24), mats.plasticDark, 0, -0.0, 0));
  kettle.traverse((o) => (o.castShadow = true));
  detail.add(kettle);
  // prkénko opřené o obklad a dóza
  const board = boxAt(detail, mats.oak, 2.05, K.counterH + 0.15, zN + 0.045, 0.24, 0.3, 0.018, 0.006, 'y');
  board.rotation.x = -0.12;
  const jar = mesh(lathe([[0, 0], [0.05, 0], [0.052, 0.12], [0.04, 0.13], [0.04, 0.145], [0, 0.145]], 24), mats.ceramic, 0.6, K.counterH, zN + 0.2);
  detail.add(jar);
  // utěrka přes madlo myčky
  const towel = boxAt(detail, mats.linen, fe + 0.036, bodyTop - 0.2, (-1.3 + pz1) / 2 + 0.05, 0.012, 0.3, 0.16, 0.005);
  towel.castShadow = false;
}

function buildFridge(ctx: WorldCtx, g: THREE.Group): void {
  const { mats, physics: ph } = ctx;
  const zN = ROOM.minZ;
  const x0 = K.fridgeX0;
  const x1 = K.fridgeX1;
  const zf = K.fridgeZ1; // čelo dveří
  const feet = 0.06;
  const doorT = 0.06;
  const split = 0.74; // dělení mrazák / lednice
  boxSpan(g, mats.plasticGrey, x0, feet, zN + 0.02, x1, K.fridgeH, zf - doorT, 0.008);
  // dveře (nerez)
  boxSpan(g, mats.steel, x0, feet + 0.005, zf - doorT + 0.004, x1, split - 0.004, zf, 0.014);
  boxSpan(g, mats.steel, x0, split + 0.004, zf - doorT + 0.004, x1, K.fridgeH, zf, 0.014);
  // madla
  const hx = x0 + 0.05;
  for (const [ya, yb] of [[split + 0.1, split + 0.62], [split - 0.36, split - 0.08]] as const) {
    const bar = mesh(cylinder(0.011, 0.011, yb - ya, 12), mats.chrome, hx, (ya + yb) / 2, zf + 0.04);
    g.add(bar);
    for (const y of [ya + 0.03, yb - 0.03]) {
      const p = mesh(cylinder(0.008, 0.008, 0.04, 8), mats.chrome, hx, y, zf + 0.02);
      p.rotation.x = Math.PI / 2;
      g.add(p);
    }
  }
  // nožky
  for (const [fx, fz] of [[x0 + 0.05, zf - 0.08], [x1 - 0.05, zf - 0.08], [x0 + 0.05, zN + 0.08], [x1 - 0.05, zN + 0.08]] as const) {
    g.add(mesh(cylinder(0.02, 0.022, feet, 10), mats.plasticDark, fx, feet / 2, fz));
  }
  ph.addStaticAABB(x0, feet, zN, x1, K.fridgeH + 0.02, zf, { surface: 'metal', tag: 'fridge' });
  // nízká zarážka vzadu pod lednicí, aby lísteček nezapadl příliš hluboko
  ctx.refs.fridge = {
    front: zf,
    x0,
    x1,
    feet,
    /** Místo magnetu s lístečkem (vysoko na dveřích). */
    magnetPos: new THREE.Vector3(x0 + 0.17, 1.6, zf + 0.004),
    /** Kam lísteček zajede. */
    underPos: new THREE.Vector3(x0 + 0.22, 0.004, zf - 0.17),
    hum: new THREE.Vector3((x0 + x1) / 2, 0.4, zN + 0.3),
  };
}

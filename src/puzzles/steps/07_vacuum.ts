import * as THREE from 'three';
import { RAPIER, G, groups } from '../../core/Physics';
import type { StepDef } from '../PuzzleGraph';
import type { PuzzleCtx } from '../PuzzleCtx';
import { BALCONY_DOOR, ROOM } from '../../world/Layout';
import { audio, type LoopHandle } from '../../core/Audio';

/**
 * Krok 7 – Sluch a vysavač. Smysly odhalí pískání průvanu od balkonových dveří. Dveře jsou
 * pootevřené, ale Tiger je sám neotevře: musí zapnout robotický vysavač, který jede rovně a od
 * překážek se odráží. Bota a koš na prádlo mu stojí v cestě – je třeba je odstrkat.
 */
type VState = 'docked' | 'running' | 'arrived' | 'returning';

interface Vac {
  state: VState;
  dir: THREE.Vector3;
  bounces: number;
  time: number;
  motor: LoopHandle | null;
  draft: LoopHandle | null;
  spin: number;
}

const vac: Vac = { state: 'docked', dir: new THREE.Vector3(-1, 0, 0), bounces: 0, time: 0, motor: null, draft: null, spin: 0 };
const SPEED = 0.34;
/** Kde vysavač po otevření dveří zaparkuje (jižní část balkonu). */
const PARK = new THREE.Vector3(ROOM.minX - 0.85, 0, 0.62);
const QUERY = groups(0xffff, G.STATIC | G.DYNAMIC | G.PLATFORM | G.CAT);
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function draftPos(): THREE.Vector3 {
  return _draft;
}
const _draft = new THREE.Vector3(ROOM.minX - 0.12, 0.9, BALCONY_DOOR.z1 - 0.1);

function setRing(pc: PuzzleCtx, on: boolean): void {
  pc.refs.vacuum.ringMat.emissive.setHex(on ? 0x66ff99 : 0x66ccff);
  pc.refs.vacuum.ringMat.emissiveIntensity = on ? 2.5 : 0.4;
}

function start(pc: PuzzleCtx): void {
  const v = pc.refs.vacuum;
  vac.state = 'running';
  vac.dir.set(-1, 0, 0);
  vac.bounces = 0;
  vac.time = 0;
  setRing(pc, true);
  pc.sfx('beep', v.group.position, 1, 1.3);
  vac.motor?.stop();
  vac.motor = audio.loop('vacuum', v.group.position, 1);
}

function stop(pc: PuzzleCtx): void {
  vac.motor?.stop();
  vac.motor = null;
  setRing(pc, false);
}

function openDoor(pc: PuzzleCtx, animate: boolean): void {
  const door = pc.refs.balconyDoor;
  door.target = BALCONY_DOOR.openAngle;
  if (!animate) {
    door.angle = BALCONY_DOOR.openAngle;
    door.speed = 0;
    door.pivot.rotation.y = -door.angle;
    door.pivot.updateMatrixWorld(true);
    const q = door.pivot.getWorldQuaternion(new THREE.Quaternion());
    const p = door.pivot.getWorldPosition(new THREE.Vector3());
    door.body.body.setTranslation(p, true);
    door.body.body.setRotation(q, true);
  }
  pc.flags.doorOpen = true;
}

export const vacuumStep: StepDef = {
  id: 'vacuum',
  title: 'Vysavač a balkonové dveře',
  requires: ['lock'],
  hints: [
    'Najedený kocour chce na vzduch. Zaposlouchej se (Q): od balkonu to táhne a píská.',
    'Dveře jsou jen pootevřené. Robotický vysavač jezdí rovně – kdyby dojel až k nim, dorazil by je. Zapni ho tlapkou (E).',
    'Odstrkej botu a koš na prádlo z pruhu mezi vysavačem a balkonovými dveřmi (F), pak vysavač zapni.',
  ],
  alwaysUpdate: true,

  setup(pc) {
    const { refs, interact, senses } = pc;
    const v = refs.vacuum;
    const btnPos = new THREE.Vector3();
    senses.addSound({ id: 'draft', pos: draftPos, color: 0x9fd4ff, active: () => pc.graph.isActive('vacuum') && !pc.flags.doorOpen, rate: 0.9, size: 0.7 });
    senses.addSound({ id: 'vacuumHum', pos: () => v.group.position, color: 0xbfe8c8, active: () => vac.state === 'running', rate: 1.6, size: 0.45 });
    interact.add({
      id: 'vacuumButton',
      pos: () => btnPos.copy(v.group.position).setY(v.group.position.y + v.height + 0.02),
      radius: 0.5,
      wide: true,
      enabled: () => pc.graph.isActive('vacuum') && (vac.state === 'docked' || vac.state === 'running'),
      paw: {
        label: () => (vac.state === 'docked' ? 'Zapnout vysavač' : 'Vypnout vysavač'),
        action: () => {
          if (vac.state === 'docked') {
            start(pc);
            if (!pc.flags.vacuumStarted) {
              pc.flags.vacuumStarted = true;
              pc.say('Jeď, služebníku.', 2.2);
            }
          } else {
            vac.state = 'returning';
            pc.sfx('beep', v.group.position);
          }
        },
      },
    });
  },

  onActivate(pc) {
    vac.draft = audio.loop('draft', draftPos(), 1);
    pc.later(6, () => {
      if (pc.graph.isActive('vacuum')) pc.say('Plné břicho… a odněkud to táhne. A píská. (Q)', 4.5);
    });
  },

  update(pc, dt) {
    const { refs, game, graph } = pc;
    const v = refs.vacuum;
    const g: THREE.Group = v.group;
    if (vac.draft && !graph.isActive('vacuum')) {
      vac.draft.stop();
      vac.draft = null;
    }
    if (vac.state === 'running') {
      vac.time += dt;
      const step = SPEED * dt;
      // co je před vysavačem?
      const shape = new RAPIER.Cylinder(0.03, v.radius - 0.004);
      _p.set(g.position.x, 0.062, g.position.z);
      const body: RAPIER.RigidBody = v.body.body;
      const hit = game.physics.world.castShape(_p, { x: 0, y: 0, z: 0, w: 1 }, vac.dir, shape, 0, step + 0.012, true, undefined, QUERY, undefined, body);
      if (hit) {
        const info = game.physics.info(hit.collider);
        const atDoor = info?.tag === 'balconyDoor' || (g.position.x < ROOM.minX + 0.22 && g.position.z > BALCONY_DOOR.z0 && g.position.z < BALCONY_DOOR.z1);
        if (atDoor && graph.isActive('vacuum')) {
          // dorazil dveře
          vac.state = 'arrived';
          pc.sfx('bump', g.position, 1);
          pc.sfx('doorCreak', draftPos(), 1);
          openDoor(pc, true);
          pc.later(1.2, () => {
            stop(pc);
            pc.say('Výborně. Dveře dokořán. Dobrý stroj.', 3.4);
            graph.solve('vacuum');
          });
        } else {
          // odraz od překážky
          vac.bounces++;
          pc.sfx('bump', g.position, 0.7);
          const n = new THREE.Vector3(hit.normal1.x, 0, hit.normal1.z);
          if (n.lengthSq() < 1e-4) n.copy(vac.dir).negate();
          n.normalize();
          vac.dir.reflect(n);
          // skutečné vysavače se neodrážejí zrcadlově – trochu se pootočí
          vac.dir.applyAxisAngle(UP, 0.35 + (vac.bounces % 3) * 0.2).setY(0).normalize();
          if (vac.bounces === 1) pc.say('Narazil. Něco mu stojí v cestě.', 3);
          if (vac.bounces >= 5 || vac.time > 45) {
            vac.state = 'returning';
            pc.sfx('beep', g.position, 1, 0.8);
            pc.later(0.5, () => pc.say('Vzdal to a jede domů. Uklidím mu cestu a zkusím to znovu.', 4));
          }
        }
      } else {
        g.position.addScaledVector(vac.dir, step);
      }
    } else if (vac.state === 'arrived') {
      // projede dveřmi na balkon a zaparkuje stranou, aby nepřekážel
      const goal = g.position.x > ROOM.minX - 0.62 ? _p.set(ROOM.minX - 0.7, 0, g.position.z) : _p.set(PARK.x, 0, PARK.z);
      const dx = goal.x - g.position.x;
      const dz = goal.z - g.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.02) {
        vac.dir.set(dx / d, 0, dz / d);
        g.position.addScaledVector(vac.dir, Math.min(d, SPEED * dt));
      }
    } else if (vac.state === 'returning') {
      // návrat do stanice (jede přímo, překážky ignoruje – je to jen úklid stavu)
      const home: THREE.Vector3 = v.start;
      _p.subVectors(home, g.position).setY(0);
      const d = _p.length();
      if (d < 0.02) {
        g.position.copy(home);
        vac.state = 'docked';
        vac.dir.set(-1, 0, 0);
        stop(pc);
      } else {
        vac.dir.copy(_p.normalize());
        g.position.addScaledVector(vac.dir, Math.min(d, 0.7 * dt));
      }
    }
    // natočení těla po směru jízdy, synchronizace kinematického tělesa
    const yaw = Math.atan2(-vac.dir.z, -vac.dir.x);
    _q.setFromAxisAngle(UP, -yaw);
    g.quaternion.slerp(_q, Math.min(1, dt * 8));
    g.position.y = 0;
    game.physics.moveKinematic(v.body, g.position, g.quaternion);
    vac.motor?.setPosition(g.position);
  },

  restore(pc) {
    const v = pc.refs.vacuum;
    vac.state = 'arrived';
    v.group.position.copy(PARK);
    pc.game.physics.moveKinematic(v.body, v.group.position, v.group.quaternion);
    v.body.body.setTranslation(v.group.position, true);
    openDoor(pc, false);
    vac.draft?.stop();
    vac.draft = null;
    stop(pc);
  },
};

export const vacuumDebug = { state: vac, start };

import * as THREE from 'three';
import type { StepDef } from '../PuzzleGraph';
import { bus } from '../../core/Events';
import { BOOKSHELF, ROOM, PENDANT } from '../../world/Layout';

/**
 * Tajemství – zlatý pamlsek. Leží nahoře na kuchyňských skříňkách a čichem jde zachytit jen
 * z nejvyššího bodu knihovny. Cesta vede skokem na houpající se závěsné svítidlo: odrazit se je
 * třeba ve správné fázi houpání (rychlost svítidla se přičte ke skoku).
 */
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export const goldenStep: StepDef = {
  id: 'golden',
  title: 'Zlatý pamlsek',
  requires: [],
  optional: true,
  hints: [
    'Z nejvyššího bodu knihovny je cítit něco… zlatého. (Q)',
    'Zlatá stopa vede vzduchem přes svítidlo nad pultem až nahoru na kuchyňské skříňky.',
    'Z knihovny skoč na svítidlo (míř podržením mezerníku) a odraz se, když se houpe směrem ke skříňkám.',
  ],
  alwaysUpdate: true,

  setup(pc) {
    const { refs, senses, interact } = pc;
    const gt = refs.goldenTreat;
    const pend = refs.pendant;
    const top = new THREE.Vector3((BOOKSHELF.x0 + BOOKSHELF.x1) / 2, BOOKSHELF.h + 0.15, ROOM.minZ + 0.17);
    senses.addTrail({
      id: 'golden',
      color: 0xffd84a,
      waypoints: [top, new THREE.Vector3(-0.3, 2.3, -1.9), new THREE.Vector3(PENDANT.x, PENDANT.topY + 0.2, PENDANT.z), new THREE.Vector3(1.5, 2.45, -1.9), gt.pos.clone()],
      // jen z nejvyššího bodu knihovny (nebo už na cestě za ním)
      active: () => !gt.taken && pc.cat.position.y > 1.85,
    });
    interact.add({
      id: 'goldenTreat',
      pos: gt.pos,
      radius: 0.5,
      wide: true,
      enabled: () => !gt.taken,
      paw: {
        label: 'Sníst zlatý pamlsek',
        action: () => {
          gt.taken = true;
          pc.later(0.3, () => {
            gt.group.visible = false;
            pc.sfx('crunch', gt.pos);
            pc.sfx('chime', gt.pos);
            pc.stats.golden = true;
            pc.flags.golden = true;
            bus.emit('achievement', { id: 'kingOfHeights', title: 'Král výšek' });
            pc.say('Zlatý. Samozřejmě, že ho mám. Král výšek jsem já.', 4.5);
            pc.tiger.anim.tailMood = 'happy';
            pc.later(6, () => (pc.tiger.anim.tailMood = 'neutral'));
            if (pc.graph.isActive('golden')) pc.graph.solve('golden');
          });
        },
      },
    });
    pend.vel = 0;
    pend.angle = 0.06;
  },

  update(pc, dt) {
    const { refs, cat, game } = pc;
    // --- kyvadlo svítidla
    const p = refs.pendant;
    const L = p.drop + p.shadeH / 2;
    const on = cat.mode === 'ground' && cat.groundTag === 'pendant';
    if (on && !p.wasOn) {
      // dopad rozhoupe svítidlo podle směru příletu
      const v = cat.velocity;
      const along = (cat.position.x - cat.prevPosition.x) * p.swingDir.x + (cat.position.z - cat.prevPosition.z) * p.swingDir.z;
      p.vel += THREE.MathUtils.clamp((along / dt) * 0.2 + 0.25 * Math.sign(along || 1), -0.55, 0.55) / L;
      void v;
      pc.sfx('clank', cat.position, 0.6, 0.7);
      if (!pc.flags.pendantSeen) {
        pc.flags.pendantSeen = true;
        pc.say('Houpačka. Teď trefit správnou chvíli.', 3);
      }
    }
    p.wasOn = on;
    // tlumené kyvadlo + slabé buzení, aby se nikdy úplně nezastavilo
    const g = 9.81;
    p.vel += (-(g / L) * Math.sin(p.angle) - p.vel * (on ? 0.1 : 0.35)) * dt;
    // amplituda: v klidu jen lehké pohupování, s kočkou nahoře se houpání udržuje (přenáší váhu)
    const w0 = Math.sqrt(g / L);
    const amp = Math.hypot(p.angle, p.vel / w0);
    const want = on ? 0.3 : 0.05;
    if (amp < want) p.vel += Math.sign(p.vel || 1) * (on ? 1.1 : 0.3) * dt;
    p.angle += p.vel * dt;
    if (Math.abs(p.angle) > 0.38) {
      // doraz: lanko se napne, kyv se zastaví
      p.angle = Math.sign(p.angle) * 0.38;
      p.vel *= -0.2;
    }
    // osa kyvu je kolmá na směr houpání
    _axis.crossVectors(UP, p.swingDir).normalize();
    _q.setFromAxisAngle(_axis, -p.angle);
    p.pivot.quaternion.copy(_q);
    p.pivot.updateMatrixWorld(true);
    game.physics.moveKinematic(p.body, p.pivot.position, p.pivot.quaternion);
    // zlatý pamlsek se pomalu otáčí a třpytí
    const gt = refs.goldenTreat;
    if (!gt.taken) gt.group.rotation.y += dt * 0.8;
  },

  restore(pc) {
    const gt = pc.refs.goldenTreat;
    gt.taken = true;
    gt.group.visible = false;
    pc.stats.golden = true;
    pc.flags.golden = true;
  },
};

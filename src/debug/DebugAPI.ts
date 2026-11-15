import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Action } from '../core/Input';
import { PHASES } from '../world/Lighting';
import { audio } from '../core/Audio';
import { lockDebug, CODE } from '../puzzles/steps/06_lock';
import { vacuumDebug } from '../puzzles/steps/07_vacuum';

/**
 * Debug API: window.__tigerDebug
 * Slouží automatickým testům (Playwright) i ručnímu ladění z konzole.
 */
export function installDebugAPI(game: Game): Record<string, unknown> {
  let collisionLines: THREE.LineSegments | null = null;
  let fpsEl: HTMLDivElement | null = null;
  let moveNow: { x: number; y: number } | null = null;
  let heldNow: Action[] = [];

  const api = {
    game,
    get ready() {
      return game.ready;
    },
    get errors() {
      return game.errors;
    },
    state() {
      const c = game.cat;
      return {
        state: game.state,
        pos: c.position.toArray().map((v) => +v.toFixed(3)),
        yaw: +c.yaw.toFixed(3),
        mode: c.mode,
        grounded: c.grounded,
        crouching: c.crouching,
        speed: +c.speed.toFixed(2),
        surface: c.surface,
        groundTag: c.groundTag,
        phase: game.lighting.phase,
        solved: game.graph ? game.graph.solved() : [],
        active: game.graph ? game.graph.order.filter((id) => game.graph.isActive(id)) : [],
        journal: [...game.journal.found],
        modal: game.ui ? game.ui.modal : 'none',
        prompt: game.interact?.current?.id ?? null,
        stats: { ...game.stats, time: +game.playTime.toFixed(1) },
        inputLocked: c.inputLocked,
        fps: +game.fps.toFixed(1),
        calls: game.gfx.info.calls,
        triangles: game.gfx.info.triangles,
        baking: game.lighting.baking,
      };
    },
    teleport(x: number, y: number, z: number, yaw?: number) {
      game.cat.teleport(new THREE.Vector3(x, y, z), yaw);
      game.tiger.snap();
      game.camera.resetBehind();
    },
    /** Skok na zadaný bod (pokud je dosažitelný). */
    jumpTo(x: number, y: number, z: number) {
      return game.cat.jumpTo(new THREE.Vector3(x, y, z));
    },
    /** Je bod dosažitelný skokem z aktuální polohy? */
    canReach(x: number, y: number, z: number) {
      return game.cat.solveArc(game.cat.position, new THREE.Vector3(x, y, z), true).valid;
    },
    /** Je bod dosažitelný skokem z jiného bodu? */
    canReachFrom(from: [number, number, number], to: [number, number, number]) {
      return game.cat.solveArc(new THREE.Vector3(...from), new THREE.Vector3(...to), true, new THREE.Vector3()).valid;
    },
    /** Virtuální vstup: pohyb (x do strany, y dopředu) + držené akce. */
    input(move: { x: number; y: number } | null, held: Action[] = []) {
      moveNow = move;
      heldNow = held;
      game.input.setVirtual(move, held);
    },
    /** Krátký stisk akce (zpracuje se jedním krokem simulace). */
    tap(action: Action) {
      const held = [...heldNow];
      game.input.setVirtual(moveNow, [...held, action]);
      game.simulate(1 / 60);
      game.input.setVirtual(moveNow, held);
      game.simulate(1 / 60);
    },
    // ---------------------------------------------------------------- hádanky
    /** Spustí hru bez intra (pokud ještě neběží). */
    startGame() {
      game.flow.startDirect();
    },
    /** Vyřeší krok okamžitě (včetně jeho závislostí a stavu světa). */
    solveStep(id: string) {
      game.graph.forceSolve(id);
      return game.graph.solved();
    },
    /** Skočí na krok: vyřeší vše, na čem závisí, a nechá ho aktivní. */
    gotoStep(id: string) {
      const step = game.graph.steps.get(id);
      if (!step) return null;
      for (const r of step.requires) game.graph.forceSolve(r);
      return { active: game.graph.isActive(id), solved: game.graph.solved() };
    },
    steps() {
      return game.graph.order.map((id) => ({ id, state: game.graph.stateOf(id), title: game.graph.steps.get(id)!.title }));
    },
    flags() {
      return { ...game.flags };
    },
    /** Přesune pohyblivý předmět (taburet, boot, laundry, trashBin). */
    moveBody(name: string, x: number, y: number, z: number) {
      const e = name === 'trashBin' ? game.ctx.refs.trashBin?.entry : game.ctx.refs[name];
      if (!e) return false;
      e.body.setTranslation({ x, y, z }, true);
      e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return true;
    },
    bodyPos(name: string) {
      const e = name === 'trashBin' ? game.ctx.refs.trashBin?.entry : game.ctx.refs[name];
      if (!e) return null;
      const t = e.body.translation();
      return [+t.x.toFixed(3), +t.y.toFixed(3), +t.z.toFixed(3)];
    },
    /** Kódový zámek: nastaví číslice a zkusí kód (musí být otevřený detail zámku). */
    lock: {
      state: () => ({ ...lockDebug.state, purr: undefined, digits: [...game.ctx.refs.lock.digits] }),
      set(digits: number[]) {
        game.ctx.refs.lock.digits.splice(0, 4, ...digits);
      },
      code: () => [...CODE],
      confirm() {
        game.modalHandler?.('confirm');
      },
    },
    vacuum: () => ({ state: vacuumDebug.state.state, bounces: vacuumDebug.state.bounces, pos: game.ctx.refs.vacuum.group.position.toArray().map((v: number) => +v.toFixed(3)) }),
    hint() {
      game.flow.hint();
    },
    save() {
      game.flow.save();
    },
    audioCounts() {
      return { ...audio.counts };
    },
    /** Akce animátoru: none | sit | lick | sniff | eat | lie | sleep */
    action(name: string) {
      game.tiger.anim.action = name as never;
    },
    tailMood(name: string) {
      game.tiger.anim.tailMood = name as never;
    },
    look(yaw: number, pitch: number) {
      game.camera.yaw = yaw;
      game.camera.pitch = pitch;
    },
    /** Synchronní simulace bez vykreslování. */
    simulate(seconds: number) {
      game.simulate(seconds);
    },
    /** Vykreslí jeden snímek (dt v sekundách). */
    renderFrame(dt = 1 / 60) {
      game.tick(dt, true);
    },
    setManual(on: boolean) {
      game.manualStepping = on;
    },
    /** Fáze západu slunce 0..8. */
    setSunPhase(phase: number, immediate = true) {
      if (immediate) game.lighting.setPhaseImmediate(phase);
      else game.lighting.goToPhase(phase);
      return PHASES[Math.max(0, Math.min(PHASES.length - 1, phase))];
    },
    /** Dokončí rozpracované zapékání světla (blokuje). */
    async finishBake() {
      let guard = 0;
      while (game.lighting.baking && guard++ < 2000) game.lighting.bakeStep(64);
    },
    /** Kamera: volný záběr (pro screenshoty). */
    shot(px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov = 55) {
      game.camera.cutToShot({ position: new THREE.Vector3(px, py, pz), target: new THREE.Vector3(tx, ty, tz), fov });
    },
    clearShot() {
      game.camera.setShot(null, 50);
    },
    showCollisions(on = true) {
      if (collisionLines) {
        game.scene.remove(collisionLines);
        collisionLines.geometry.dispose();
        collisionLines = null;
      }
      if (!on) return;
      const buf = game.physics.world.debugRender();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(buf.vertices, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(buf.colors, 4));
      collisionLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.6 }));
      collisionLines.renderOrder = 999;
      collisionLines.frustumCulled = false;
      game.scene.add(collisionLines);
    },
    showFps(on = true) {
      if (fpsEl) {
        fpsEl.remove();
        fpsEl = null;
      }
      if (!on) return;
      fpsEl = document.createElement('div');
      fpsEl.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;font:12px monospace;color:#9f9;background:rgba(0,0,0,.55);padding:4px 8px;border-radius:4px;pointer-events:none';
      document.body.appendChild(fpsEl);
      const tick = () => {
        if (!fpsEl) return;
        fpsEl.textContent = `${game.fps.toFixed(0)} FPS · ${game.gfx.info.calls} draw calls · ${(game.gfx.info.triangles / 1000).toFixed(0)}k tris`;
        setTimeout(tick, 500);
      };
      tick();
    },
  };
  (window as unknown as { __tigerDebug: unknown }).__tigerDebug = api;
  return api;
}

import type { StepDef } from '../PuzzleGraph';
import { scentStep } from '../steps/01_scent';
import { noteStep } from '../steps/02_note';
import { falseCluesStep } from '../steps/03_false_clues';
import { cardStep } from '../steps/04_card';
import { photoStep } from '../steps/05_photo';
import { lockStep } from '../steps/06_lock';
import { vacuumStep } from '../steps/07_vacuum';
import { finaleStep } from '../steps/08_finale';
import { goldenStep } from '../steps/09_golden';

/**
 * Graf hádanek místnosti „obývák s kuchyňským koutem“.
 *
 *   čich ─▶ lísteček ─┬▶ falešné stopy (volitelné)
 *                     ├▶ průkaz pod gaučem ┐
 *                     ├▶ fotka na knihovně ┼ (nápovědy ke kódu)
 *                     └▶ kódový zámek ─▶ vysavač a dveře ─▶ finále
 *   zlatý pamlsek (tajemství, kdykoli)
 *
 * Další místnost = další takové pole; `PuzzleGraph` je na místnosti nezávislý.
 */
export const livingRoomSteps: StepDef[] = [scentStep, noteStep, falseCluesStep, cardStep, photoStep, lockStep, vacuumStep, finaleStep, goldenStep];

/** Fáze západu slunce po vyřešení kroku (bere se maximum z vyřešených). */
export const SUNSET_PHASE: Record<string, number> = {
  scent: 1,
  note: 2,
  falseClues: 3,
  card: 4,
  photo: 5,
  lock: 6,
  vacuum: 7,
};

/** Pořadí pro nápovědy: průkaz a fotka přestanou být důležité, jakmile je zámek otevřený. */
export const OBSOLETE_AFTER: Record<string, string> = { card: 'lock', photo: 'lock', falseClues: 'lock' };

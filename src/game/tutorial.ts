/**
 * Source-backed level-1 tutorial state machine. The chapter order, key waits,
 * proximity radii, screen bounds, arrow meshes, and 4 s final delay all come
 * from Gameplay.nmo and Tutorial.nmo.
 */
import * as THREE from 'three';
import { loadNmo } from '../engine/assets.ts';
import { buildScene, groupEntities, type BuiltScene } from '../engine/sceneBuilder.ts';
import type { BallKind } from './constants.ts';
import type { Input } from './input.ts';
import { ScaleableProximity, type ScaleableProximitySpec } from './proximity.ts';
import { gameStore } from './store.ts';

type Stage = 'text' | 'travel' | 'approach' | 'finalDelay' | 'transition';
type ChapterWithTarget = 4 | 5 | 6 | 7 | 8;
type Transition =
  | { kind: 'enter'; chapter: number }
  | { kind: 'approach'; chapter: ChapterWithTarget }
  | { kind: 'finalDelay' }
  | { kind: 'complete' };

const proximity = (
  distance: number,
  exactnessMinDistance: number,
  exactnessMaxDistance: number,
): ScaleableProximitySpec => ({
  distance,
  exactnessMinDistance,
  exactnessMaxDistance,
  minimumFrameDelay: 1,
  maximumFrameDelay: 10,
  initialFrameDelay: 2,
  axes: 5,
  squaredDistance: false,
});

export const TUTORIAL_SOURCE = {
  textFadeMs: 200,
  firstPanelFadeMs: 200,
  laterPanelFadeMs: 300,
  arrowFadeMs: 500,
  movementArrowFadeMs: 600,
  arrowScaleMs: 150,
  arrowPressedScale: 1.8,
  actionTailDelayMs: 510,
  finalHintDelay: 4,
  approach: {
    4: proximity(16, 23, 40),
    5: proximity(14, 25, 35),
    6: proximity(4.5, 5, 10),
    7: proximity(18, 40, 60),
    8: proximity(20, 35, 50),
  },
  action: {
    4: proximity(3, 1, 10),
    5: proximity(5, 1, 10),
    6: proximity(2.5, 1, 10),
    7: proximity(3, 1, 10),
    8: proximity(2.5, 1, 10),
  },
  keyEnd: proximity(4, 0, 4),
  directionArrowByControl: {
    forward: 'Tut_Richt_Pfeil03',
    back: 'Tut_Richt_Pfeil04',
    left: 'Tut_Richt_Pfeil02',
    right: 'Tut_Richt_Pfeil01',
  },
  downArrowPosition: [0, 0, 0] as const,
} as const;

let completedThisSession = false;

export function tutorialEligible(level: number, flags: URLSearchParams): boolean {
  return level === 1 && !completedThisSession && !flags.has('notutorial');
}

export class TutorialSystem {
  active = true;
  frozen = true;
  chapter = 0;
  private stage: Stage = 'text';
  private chapterTime = 0;
  private finalDelay = 0;
  private transitionTime = 0;
  private transition: Transition | null = null;
  private readonly root: THREE.Group;
  private readonly markers = new Map<string, THREE.Vector3>();
  private readonly orientation: THREE.Object3D[];
  private readonly direction: THREE.Object3D[];
  private readonly ballArrows: THREE.Object3D[];
  private readonly localPositions = new Map<THREE.Object3D, THREE.Vector3>();
  private readonly downArrow: THREE.Object3D | null;
  private readonly arrowFades = new Map<
    THREE.Object3D,
    { from: number; to: number; elapsed: number; duration: number; hide: boolean }
  >();
  private readonly arrowOpacity = new Map<THREE.Object3D, number>();
  private readonly directionScale = new Map<THREE.Object3D, number>();
  private readonly approachProximity = new Map<ChapterWithTarget, ScaleableProximity>();
  private readonly actionProximity = new Map<ChapterWithTarget, ScaleableProximity>();
  private readonly keyEndProximity = new ScaleableProximity(TUTORIAL_SOURCE.keyEnd);
  private readonly directionsUsed = new Set<'forward' | 'back' | 'left' | 'right'>();
  private readonly freezeCue: () => void;

  static async create(scene: THREE.Scene, freezeCue: () => void): Promise<TutorialSystem> {
    const built = await buildScene(await loadNmo('3D Entities/Tutorial.nmo'));
    scene.add(built.root);
    return new TutorialSystem(built, freezeCue);
  }

  private constructor(built: BuiltScene, freezeCue: () => void) {
    this.root = built.root;
    this.freezeCue = freezeCue;
    for (const name of [
      'Tut_HolzTrafo',
      'Tut_Checkpoint',
      'Tut_ExtraPoint',
      'Tut_Rampe',
      'Tut_SteinTrafo',
      'Tut_ExtraLife',
      'Tut_KeyEnd',
    ]) {
      const object = built.entities.get(name)?.object;
      if (object) this.markers.set(name, object.position.clone());
    }

    this.orientation = groupEntities(built, 'Pfeile_Orientation').map((entry) => entry.object);
    this.direction = groupEntities(built, 'Pfeile_Richtung').map((entry) => entry.object);
    const up = built.entities.get('Pfeil_Hoch')?.object;
    this.ballArrows = [...this.orientation, ...this.direction, ...(up ? [up] : [])];
    this.downArrow = built.entities.get('Pfeil_Runter')?.object ?? null;
    for (const arrow of [...this.ballArrows, ...(this.downArrow ? [this.downArrow] : [])]) {
      this.localPositions.set(arrow, arrow.position.clone());
      arrow.matrixAutoUpdate = true;
      this.cloneArrowMaterials(arrow);
      this.arrowOpacity.set(arrow, 0);
      this.setArrowOpacity(arrow, 0);
      arrow.visible = false;
    }
    for (const arrow of this.direction) this.directionScale.set(arrow, 1);
    for (const chapter of [4, 5, 6, 7, 8] as const) {
      this.approachProximity.set(chapter, new ScaleableProximity(TUTORIAL_SOURCE.approach[chapter]));
      this.actionProximity.set(chapter, new ScaleableProximity(TUTORIAL_SOURCE.action[chapter]));
    }
    this.enter(0, false);
  }

  update(dt: number, ballPosition: THREE.Vector3, input: Input, ballKind: BallKind): void {
    if (!this.active) return;
    this.chapterTime += dt;
    this.followBall(ballPosition);
    this.updateArrowFades(dt);
    this.updateDirectionScales(dt, input);

    if (this.stage === 'transition') {
      this.transitionTime -= dt;
      if (this.transitionTime <= 0) this.finishTransition();
      return;
    }

    if (this.stage === 'finalDelay') {
      this.finalDelay -= dt;
      if (this.finalDelay <= 0) this.enter(9, true);
      return;
    }

    if (this.stage === 'approach') {
      const target: Record<number, string> = {
        4: 'Tut_ExtraLife',
        5: 'Tut_SteinTrafo',
        6: 'Tut_Rampe',
        7: 'Tut_ExtraPoint',
        8: 'Tut_Checkpoint',
      };
      const chapter = this.chapter as ChapterWithTarget;
      if (this.proximityEntered(this.approachProximity.get(chapter), ballPosition, target[chapter])) {
        // Wait for Rampe skips the stone-ball hint when the player already
        // reached it as wood and advances directly to the Point Extra wait.
        if (chapter === 6 && ballKind === 'wood') this.approach(7);
        else this.enter(chapter, true);
      }
      return;
    }

    // The original Q shortcut is wired only in the opening chapter.
    if (this.chapter === 0 && input.consumePressed('KeyQ')) {
      this.complete();
      return;
    }

    const enter = input.consumePressed('Enter') || input.consumePressed('NumpadEnter');
    if (this.chapter === 0 && this.chapterTime >= 25) {
      // Authored failsafe: resume physics after 25 s, but keep waiting for
      // RETURN to dismiss the opening text.
      this.frozen = false;
    }
    if (enter && this.stage === 'text') {
      const arrowsReady = this.chapter === 0 || this.chapterTime >= TUTORIAL_SOURCE.arrowFadeMs / 1000;
      if (this.chapter <= 2 && arrowsReady) {
        this.beginTransition(
          { kind: 'enter', chapter: this.chapter + 1 },
          this.chapter === 0 ? 0 : TUTORIAL_SOURCE.arrowFadeMs / 1000,
        );
      } else if (this.chapter >= 4 && this.chapter <= 8) {
        this.stage = 'travel';
        this.frozen = false;
        this.setInterface(false, false);
      } else if (this.chapter === 9) {
        this.beginTransition({ kind: 'complete' }, 0);
      }
    }

    if (this.chapter === 3) {
      if (this.chapterTime < TUTORIAL_SOURCE.arrowFadeMs / 1000) return;
      const state = input.state;
      if (state.forward || input.consumeControlPressed('keyForward')) this.directionsUsed.add('forward');
      if (state.back || input.consumeControlPressed('keyBackward')) this.directionsUsed.add('back');
      if (state.left || input.consumeControlPressed('keyLeft')) this.directionsUsed.add('left');
      if (state.right || input.consumeControlPressed('keyRight')) this.directionsUsed.add('right');
      const allReleased = !state.forward && !state.back && !state.left && !state.right;
      const scalesSettled = [...this.directionScale.values()].every((scale) => Math.abs(scale - 1) < 1e-5);
      if (this.proximityEntered(this.keyEndProximity, ballPosition, 'Tut_KeyEnd') ||
        (this.directionsUsed.size === 4 && allReleased && scalesSettled)) {
        this.beginTransition(
          { kind: 'approach', chapter: 4 },
          TUTORIAL_SOURCE.movementArrowFadeMs / 1000,
        );
      }
      return;
    }

    if ((this.stage === 'travel' || this.stage === 'text') && this.chapter >= 4 && this.chapter <= 8) {
      // The inner proximity graph starts after the down-arrow FadeIn, in
      // parallel with the Return waiter that resumes physics.
      if (this.chapterTime >= TUTORIAL_SOURCE.arrowFadeMs / 1000) {
        this.updateActionProximity(ballPosition, this.chapter as ChapterWithTarget);
      }
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    gameStore.getState().set({
      tutorialChapter: null,
      tutorialPanelVisible: false,
      tutorialVisible: false,
    });
  }

  debugState(): Record<string, unknown> {
    return {
      active: this.active,
      frozen: this.frozen,
      chapter: this.chapter,
      stage: this.stage,
      transition: this.transition,
      directionsUsed: [...this.directionsUsed],
    };
  }

  private enter(chapter: number, playCue: boolean): void {
    this.chapter = chapter;
    this.chapterTime = 0;
    this.stage = 'text';
    this.transition = null;
    this.hideArrows(true);
    // Init and the five target/final lessons pause physics. Camera rotation,
    // camera height, and movement lessons run after chapter 0 resumes it.
    this.frozen = chapter === 0 || chapter >= 4;
    gameStore.getState().set({
      tutorialChapter: chapter,
      tutorialPanelVisible: true,
      tutorialVisible: true,
    });
    if (playCue && chapter >= 4) this.freezeCue();

    if (chapter === 1) this.show(this.orientation, TUTORIAL_SOURCE.arrowFadeMs / 1000);
    else if (chapter === 2) {
      const up = this.ballArrows.find((arrow) => arrow.name === 'Pfeil_Hoch');
      if (up) this.show([up], TUTORIAL_SOURCE.arrowFadeMs / 1000);
    } else if (chapter === 3) {
      this.directionsUsed.clear();
      this.keyEndProximity.reset();
      for (const arrow of this.direction) {
        this.directionScale.set(arrow, 1);
        arrow.scale.set(1, 1, 1);
      }
      this.show(this.direction, TUTORIAL_SOURCE.arrowFadeMs / 1000);
    } else {
      const target: Record<number, string> = {
        4: 'Tut_ExtraLife',
        5: 'Tut_SteinTrafo',
        6: 'Tut_HolzTrafo',
        7: 'Tut_ExtraPoint',
        8: 'Tut_Checkpoint',
      };
      const position = this.markers.get(target[chapter]);
      if (this.downArrow && position) {
        this.downArrow.position.copy(position);
        this.actionProximity.get(chapter as ChapterWithTarget)?.reset();
        this.show([this.downArrow], TUTORIAL_SOURCE.arrowFadeMs / 1000);
      }
    }
  }

  private approach(chapter: ChapterWithTarget): void {
    this.chapter = chapter;
    this.stage = 'approach';
    this.frozen = false;
    this.approachProximity.get(chapter)?.reset();
    this.hideArrows(true);
    gameStore.getState().set({
      tutorialChapter: chapter,
      tutorialPanelVisible: false,
      tutorialVisible: false,
    });
  }

  private beginTransition(next: Transition, arrowFadeSeconds: number): void {
    this.stage = 'transition';
    this.transition = next;
    this.transitionTime = arrowFadeSeconds + TUTORIAL_SOURCE.actionTailDelayMs / 1000;
    this.frozen = false;
    if (arrowFadeSeconds > 0) {
      const arrows = this.chapter === 1
        ? this.orientation
        : this.chapter === 2
          ? this.ballArrows.filter((arrow) => arrow.name === 'Pfeil_Hoch')
          : this.chapter === 3
            ? this.direction
            : this.downArrow
              ? [this.downArrow]
              : [];
      this.hide(arrows, arrowFadeSeconds);
    }
    this.setInterface(false, this.chapter <= 2);
  }

  private finishTransition(): void {
    const next = this.transition;
    this.transition = null;
    if (!next) return;
    if (next.kind === 'enter') this.enter(next.chapter, false);
    else if (next.kind === 'approach') this.approach(next.chapter);
    else if (next.kind === 'finalDelay') {
      this.stage = 'finalDelay';
      this.finalDelay = TUTORIAL_SOURCE.finalHintDelay;
      this.frozen = false;
      this.hideArrows(true);
      this.setInterface(false, false);
    } else this.complete();
  }

  private updateActionProximity(ballPosition: THREE.Vector3, chapter: ChapterWithTarget): void {
    const target: Record<ChapterWithTarget, string> = {
      4: 'Tut_ExtraLife',
      5: 'Tut_SteinTrafo',
      6: 'Tut_HolzTrafo',
      7: 'Tut_ExtraPoint',
      8: 'Tut_Checkpoint',
    };
    if (!this.proximityEntered(this.actionProximity.get(chapter), ballPosition, target[chapter])) return;
    this.beginTransition(
      chapter === 8 ? { kind: 'finalDelay' } : { kind: 'approach', chapter: (chapter + 1) as ChapterWithTarget },
      TUTORIAL_SOURCE.arrowFadeMs / 1000,
    );
  }

  private complete(): void {
    completedThisSession = true;
    this.active = false;
    this.frozen = false;
    this.hideArrows(true);
    gameStore.getState().set({
      tutorialChapter: null,
      tutorialPanelVisible: false,
      tutorialVisible: false,
    });
  }

  private proximityEntered(
    proximity: ScaleableProximity | undefined,
    position: THREE.Vector3,
    marker: string,
  ): boolean {
    const target = this.markers.get(marker);
    return !!target && proximity?.updatePositions(position, target) === 'enterRange';
  }

  private followBall(ballPosition: THREE.Vector3): void {
    for (const arrow of this.ballArrows) {
      const local = this.localPositions.get(arrow);
      if (local) arrow.position.copy(ballPosition).add(local);
    }
  }

  private show(arrows: THREE.Object3D[], duration: number): void {
    for (const arrow of arrows) {
      arrow.visible = true;
      this.setArrowOpacity(arrow, 0);
      this.arrowFades.set(arrow, { from: 0, to: 1, elapsed: 0, duration, hide: false });
    }
  }

  private hide(arrows: THREE.Object3D[], duration: number): void {
    for (const arrow of arrows) {
      const from = this.arrowOpacity.get(arrow) ?? 1;
      this.arrowFades.set(arrow, { from, to: 0, elapsed: 0, duration, hide: true });
    }
  }

  private hideArrows(immediate: boolean): void {
    for (const arrow of [...this.ballArrows, ...(this.downArrow ? [this.downArrow] : [])]) {
      if (immediate) {
        this.arrowFades.delete(arrow);
        this.setArrowOpacity(arrow, 0);
        arrow.visible = false;
      }
    }
  }

  private updateArrowFades(dt: number): void {
    for (const [arrow, fade] of this.arrowFades) {
      fade.elapsed += dt;
      const t = Math.min(1, fade.elapsed / fade.duration);
      this.setArrowOpacity(arrow, THREE.MathUtils.lerp(fade.from, fade.to, t));
      if (t < 1) continue;
      if (fade.hide) arrow.visible = false;
      this.arrowFades.delete(arrow);
    }
  }

  private updateDirectionScales(dt: number, input: Input): void {
    if (this.chapter !== 3 || this.stage !== 'text' || this.chapterTime < TUTORIAL_SOURCE.arrowFadeMs / 1000) return;
    const step =
      (dt * 1000 * (TUTORIAL_SOURCE.arrowPressedScale - 1)) / TUTORIAL_SOURCE.arrowScaleMs;
    for (const [control, name] of Object.entries(TUTORIAL_SOURCE.directionArrowByControl)) {
      const arrow = this.direction.find((candidate) => candidate.name === name);
      if (!arrow) continue;
      const current = this.directionScale.get(arrow) ?? 1;
      const target = input.state[control as keyof Input['state']]
        ? TUTORIAL_SOURCE.arrowPressedScale
        : 1;
      const next = current < target ? Math.min(target, current + step) : Math.max(target, current - step);
      this.directionScale.set(arrow, next);
      arrow.scale.set(1, 1, next);
    }
  }

  private cloneArrowMaterials(arrow: THREE.Object3D): void {
    arrow.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Sprite)) return;
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => material.clone())
        : object.material.clone();
    });
  }

  private setArrowOpacity(arrow: THREE.Object3D, opacity: number): void {
    this.arrowOpacity.set(arrow, opacity);
    arrow.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Sprite)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.transparent = true;
        material.opacity = opacity;
        if ('color' in material && material.color instanceof THREE.Color) material.color.setRGB(1, 1, 1);
        material.needsUpdate = true;
      }
    });
  }

  private setInterface(text: boolean, panel: boolean): void {
    gameStore.getState().set({ tutorialPanelVisible: panel, tutorialVisible: text });
  }
}

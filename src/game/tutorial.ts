/**
 * Source-backed level-1 tutorial state machine. The chapter order, key waits,
 * proximity radii, screen bounds, arrow meshes, and 4 s final delay all come
 * from Gameplay.nmo and Tutorial.nmo.
 */
import * as THREE from 'three';
import { loadNmo } from '../engine/assets.ts';
import { buildScene, groupEntities, type BuiltScene } from '../engine/sceneBuilder.ts';
import type { Input } from './input.ts';
import { gameStore } from './store.ts';

type Stage = 'text' | 'travel' | 'ramp' | 'ending';

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
  private endingTime = 0;
  private readonly root: THREE.Group;
  private readonly markers = new Map<string, THREE.Vector3>();
  private readonly orientation: THREE.Object3D[];
  private readonly direction: THREE.Object3D[];
  private readonly ballArrows: THREE.Object3D[];
  private readonly localPositions = new Map<THREE.Object3D, THREE.Vector3>();
  private readonly downArrow: THREE.Object3D | null;
  private readonly downOffset = new THREE.Vector3(-1, 1, 0);
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
      arrow.visible = false;
    }
    this.enter(0, false);
  }

  update(dt: number, ballPosition: THREE.Vector3, input: Input): void {
    if (!this.active) return;
    this.chapterTime += dt;
    this.followBall(ballPosition);

    if (this.stage === 'ending') {
      this.endingTime -= dt;
      if (this.endingTime <= 0) this.complete();
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
      if (this.chapter <= 2) {
        this.enter(this.chapter + 1, false);
      } else if (this.chapter >= 4 && this.chapter <= 8) {
        this.stage = 'travel';
        this.frozen = false;
        gameStore.getState().set({ tutorialVisible: false });
      } else if (this.chapter === 9) {
        this.stage = 'ending';
        this.endingTime = 4;
        this.frozen = false;
        this.hideArrows();
        gameStore.getState().set({ tutorialVisible: false });
      }
    }

    if (this.chapter === 3) {
      const state = input.state;
      if (state.forward || input.consumeControlPressed('keyForward')) this.directionsUsed.add('forward');
      if (state.back || input.consumeControlPressed('keyBackward')) this.directionsUsed.add('back');
      if (state.left || input.consumeControlPressed('keyLeft')) this.directionsUsed.add('left');
      if (state.right || input.consumeControlPressed('keyRight')) this.directionsUsed.add('right');
      const allReleased = !state.forward && !state.back && !state.left && !state.right;
      if (
        this.near(ballPosition, 'Tut_KeyEnd', 4) ||
        (this.directionsUsed.size === 4 && allReleased)
      ) {
        this.enter(4, true);
      }
      return;
    }

    if (this.stage === 'travel') {
      if (this.chapter === 4 && this.near(ballPosition, 'Tut_ExtraLife', 3)) this.enter(5, true);
      else if (this.chapter === 5 && this.near(ballPosition, 'Tut_SteinTrafo', 5)) this.enter(6, true);
      else if (this.chapter === 6 && this.near(ballPosition, 'Tut_HolzTrafo', 2.5)) {
        this.stage = 'ramp';
        this.hideArrows();
      } else if (this.chapter === 7 && this.near(ballPosition, 'Tut_ExtraPoint', 3)) this.enter(8, true);
      else if (this.chapter === 8 && this.near(ballPosition, 'Tut_Checkpoint', 2.5)) this.enter(9, true);
    } else if (this.chapter === 6 && this.stage === 'ramp' && this.near(ballPosition, 'Tut_Rampe', 4.5)) {
      this.enter(7, true);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    gameStore.getState().set({ tutorialChapter: null, tutorialVisible: false });
  }

  debugState(): Record<string, unknown> {
    return {
      active: this.active,
      frozen: this.frozen,
      chapter: this.chapter,
      stage: this.stage,
      directionsUsed: [...this.directionsUsed],
    };
  }

  private enter(chapter: number, playCue: boolean): void {
    this.chapter = chapter;
    this.chapterTime = 0;
    this.stage = 'text';
    this.hideArrows();
    this.frozen = chapter !== 3;
    gameStore.getState().set({ tutorialChapter: chapter, tutorialVisible: true });
    if (playCue && chapter >= 4) this.freezeCue();

    if (chapter === 1) this.show(this.orientation);
    else if (chapter === 2) {
      const up = this.ballArrows.find((arrow) => arrow.name === 'Pfeil_Hoch');
      if (up) up.visible = true;
    } else if (chapter === 3) {
      this.directionsUsed.clear();
      this.show(this.direction);
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
        this.downArrow.position.copy(position).add(this.downOffset);
        this.downArrow.visible = true;
      }
    }
  }

  private complete(): void {
    completedThisSession = true;
    this.active = false;
    this.frozen = false;
    this.hideArrows();
    gameStore.getState().set({ tutorialChapter: null, tutorialVisible: false });
  }

  private near(position: THREE.Vector3, marker: string, radius: number): boolean {
    const target = this.markers.get(marker);
    return !!target && position.distanceTo(target) <= radius;
  }

  private followBall(ballPosition: THREE.Vector3): void {
    for (const arrow of this.ballArrows) {
      const local = this.localPositions.get(arrow);
      if (local) arrow.position.copy(ballPosition).add(local);
    }
  }

  private show(arrows: THREE.Object3D[]): void {
    for (const arrow of arrows) arrow.visible = true;
  }

  private hideArrows(): void {
    for (const arrow of this.ballArrows) arrow.visible = false;
    if (this.downArrow) this.downArrow.visible = false;
  }
}

import Phaser from 'phaser';
import { generateTextures } from '../render/textures';

/** Builds all procedural textures, then hands over to the game scene. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    generateTextures(this);
    this.scene.start('game');
  }
}

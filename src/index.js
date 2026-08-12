import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './constants';
import MenuScene from './scenes/MenuScene';
import LobbyScene from './scenes/LobbyScene';
import GameScene from './scenes/GameScene';

const config = {
  type: Phaser.AUTO,
  parent: 'game-root',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#05040c',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MenuScene, LobbyScene, GameScene],
};

const game = new Phaser.Game(config);
export default game;

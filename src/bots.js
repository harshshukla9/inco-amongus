import { BOT_SPEED } from './constants';
import { moveEntityByDirection } from './movement';

const DIRECTIONS = ['up', 'down', 'left', 'right'];

export class BotController {
  constructor(sprite, options = {}) {
    this.sprite = sprite;
    this.speed = options.speed || BOT_SPEED;
    this.direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    this.nextChangeAt = 0;
    this.pauseUntil = 0;
  }

  update(time) {
    if (time < this.pauseUntil) {
      return false;
    }

    if (time >= this.nextChangeAt) {
      this.direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
      this.nextChangeAt = time + 900 + Math.random() * 1800;
      if (Math.random() < 0.2) {
        this.pauseUntil = time + 400 + Math.random() * 700;
        return false;
      }
    }

    const moved = moveEntityByDirection(this.sprite, this.direction, this.speed);
    if (!moved) {
      this.direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
      this.nextChangeAt = time + 400 + Math.random() * 800;
    }
    return moved;
  }
}

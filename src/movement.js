import {
  PLAYER_SPEED,
  SHIP_HEIGHT,
  SHIP_WIDTH,
} from './constants';
import { mapBounds } from './mapBounds';

export const isWithinMovementBoundaries = (x, y) => {
  const ix = Math.round(x);
  const iy = Math.round(y);
  return !mapBounds[iy] ? true : !mapBounds[iy].includes(ix);
};

export const getFootPosition = (sprite) => ({
  x: sprite.x + SHIP_WIDTH / 2,
  y: sprite.y + SHIP_HEIGHT / 2 + 20,
});

export const canMoveTo = (sprite, dx, dy) => {
  const foot = getFootPosition(sprite);
  return isWithinMovementBoundaries(foot.x + dx, foot.y + dy);
};

export const movePlayer = (keys, player, speed = PLAYER_SPEED) => {
  let playerMoved = false;

  if (keys.includes('ArrowUp') && canMoveTo(player, 0, -speed)) {
    playerMoved = true;
    player.y -= speed;
  }
  if (keys.includes('ArrowDown') && canMoveTo(player, 0, speed)) {
    playerMoved = true;
    player.y += speed;
  }
  if (keys.includes('ArrowLeft') && canMoveTo(player, -speed, 0)) {
    playerMoved = true;
    player.x -= speed;
    player.flipX = true;
  }
  if (keys.includes('ArrowRight') && canMoveTo(player, speed, 0)) {
    playerMoved = true;
    player.x += speed;
    player.flipX = false;
  }

  return playerMoved;
};

export const moveEntityByDirection = (sprite, direction, speed) => {
  const deltas = {
    up: { dx: 0, dy: -speed },
    down: { dx: 0, dy: speed },
    left: { dx: -speed, dy: 0 },
    right: { dx: speed, dy: 0 },
  };
  const delta = deltas[direction];
  if (!delta || !canMoveTo(sprite, delta.dx, delta.dy)) {
    return false;
  }

  sprite.x += delta.dx;
  sprite.y += delta.dy;
  if (direction === 'left') sprite.flipX = true;
  if (direction === 'right') sprite.flipX = false;
  return true;
};

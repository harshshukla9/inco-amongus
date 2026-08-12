export const PLAYER_SPRITE_WIDTH = 84;
export const PLAYER_SPRITE_HEIGHT = 128;
export const PLAYER_HEIGHT = 50;
export const PLAYER_WIDTH = 37;
export const PLAYER_START_X = 330;
export const PLAYER_START_Y = 100;
export const PLAYER_SPEED = 2;
export const BOT_SPEED = 1.6;
export const SHIP_WIDTH = 2160;
export const SHIP_HEIGHT = 1166;
export const CAMERA_ZOOM = 2.35;
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;
export const DEFAULT_BOT_COUNT = 6;
export const MAX_PLAYERS = 1 + DEFAULT_BOT_COUNT;
// Build-time: SOCKET_URL env, else production Render host, else local server
export const SOCKET_URL =
  (typeof process !== 'undefined' && process.env && process.env.SOCKET_URL) ||
  (typeof window !== 'undefined' && window.__SOCKET_URL__) ||
  (typeof window !== 'undefined' &&
  window.location &&
  /localhost|127\.0\.0\.1/.test(window.location.hostname)
    ? 'http://localhost:3000'
    : 'https://inco-amongus.onrender.com');
export const KILL_RANGE = 90;
export const KILL_COOLDOWN_MS = 12000;
export const MEETING_DISCUSS_MS = 15000;
export const VOTE_DURATION_MS = 20000;
export const ROLE_REVEAL_MS = 2500;

export const PLAYER_COLORS = [
  0xd71e22, // red
  0x132ed2, // blue
  0x117f2d, // green
  0xee54bb, // pink
  0xf07d0d, // orange
  0x3f474e, // black
  0xd6e0f0, // white
  0x6b2fbc, // purple
  0x71491e, // brown
  0x38ffdd, // cyan
];

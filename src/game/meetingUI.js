import { PLAYER_COLORS } from '../constants';
import { playSfx, SFX } from '../audio';

const toCss = (color) => `#${Number(color).toString(16).padStart(6, '0')}`;

export const drawRoundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

export const buildPanelTexture = (scene, key, width, height, options = {}) => {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const canvas = scene.textures.createCanvas(key, width, height);
  const ctx = canvas.getContext();
  const fill = options.fill || 'rgba(12, 6, 28, 0.96)';
  const stroke = options.stroke || '#9945FF';
  const radius = options.radius || 18;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = options.lineWidth || 3;
  drawRoundRect(ctx, 1.5, 1.5, width - 3, height - 3, radius);
  ctx.fill();
  ctx.stroke();

  if (options.title) {
    ctx.fillStyle = options.titleColor || '#f5f3ff';
    ctx.font = `bold ${options.titleSize || 22}px Arial Black, Impact, Arial`;
    ctx.textAlign = options.titleAlign || 'left';
    ctx.textBaseline = 'middle';
    const titleX = options.titleAlign === 'center' ? width / 2 : 20;
    const titleY = options.subtitle ? height / 2 - 12 : height / 2;
    ctx.fillText(options.title, titleX, titleY);
  }

  if (options.subtitle) {
    ctx.fillStyle = options.subtitleColor || '#fecaca';
    ctx.font = `${options.subtitleSize || 14}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = options.titleAlign || 'left';
    ctx.textBaseline = 'middle';
    const subX = options.titleAlign === 'center' ? width / 2 : 20;
    ctx.fillText(options.subtitle, subX, height / 2 + 14);
  }

  canvas.refresh();
  return key;
};

export const buildVoteCardTexture = (scene, key, width, height, player, voteCount, selected) => {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const canvas = scene.textures.createCanvas(key, width, height);
  const ctx = canvas.getContext();
  const color = PLAYER_COLORS[(player.colorIndex || 0) % PLAYER_COLORS.length];

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = selected ? 'rgba(16, 48, 40, 0.98)' : 'rgba(18, 14, 36, 0.96)';
  ctx.strokeStyle = selected ? '#14f195' : 'rgba(167, 139, 250, 0.65)';
  ctx.lineWidth = selected ? 2.5 : 1.5;
  drawRoundRect(ctx, 1.5, 1.5, width - 3, height - 3, 14);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = toCss(color);
  ctx.arc(26, height / 2, 11, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.font = '600 17px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(player.name || 'Player', 48, height / 2);

  const votes = voteCount || 0;
  // Vote pill
  const pillW = 72;
  const pillH = 26;
  const pillX = width - pillW - 14;
  const pillY = (height - pillH) / 2;
  ctx.fillStyle = votes > 0 ? 'rgba(20, 241, 149, 0.18)' : 'rgba(148, 163, 184, 0.12)';
  drawRoundRect(ctx, pillX, pillY, pillW, pillH, 13);
  ctx.fill();
  ctx.fillStyle = votes > 0 ? '#14f195' : '#94a3b8';
  ctx.font = 'bold 13px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(votes), pillX + pillW / 2, height / 2 + 1);

  canvas.refresh();
  return key;
};

export const buildPlayerRowTexture = (scene, key, width, height, player) => {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const canvas = scene.textures.createCanvas(key, width, height);
  const ctx = canvas.getContext();
  const dead = player.alive === false;
  const color = PLAYER_COLORS[(player.colorIndex || 0) % PLAYER_COLORS.length];

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = dead ? 'rgba(36, 16, 24, 0.95)' : 'rgba(20, 16, 40, 0.95)';
  ctx.strokeStyle = dead ? 'rgba(248, 113, 113, 0.4)' : 'rgba(167, 139, 250, 0.4)';
  ctx.lineWidth = 1.5;
  drawRoundRect(ctx, 1, 1, width - 2, height - 2, 10);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = dead ? '#6b7280' : toCss(color);
  ctx.arc(22, height / 2, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = dead ? '#fca5a5' : '#f1f5f9';
  ctx.font = '600 15px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(player.name || 'Player', 40, height / 2 + 1);

  if (dead) {
    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 11px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('DEAD', width - 14, height / 2 + 1);
  }

  canvas.refresh();
  return key;
};

const paintChatSurface = (ctx, width, height, messages, draft, focused) => {
  ctx.clearRect(0, 0, width, height);

  // Shell
  ctx.fillStyle = 'rgba(8, 10, 20, 0.97)';
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.55)';
  ctx.lineWidth = 2;
  drawRoundRect(ctx, 1, 1, width - 2, height - 2, 16);
  ctx.fill();
  ctx.stroke();

  // Header strip
  ctx.fillStyle = 'rgba(20, 241, 149, 0.08)';
  drawRoundRect(ctx, 2, 2, width - 4, 40, 14);
  ctx.fill();
  ctx.fillStyle = '#6ee7b7';
  ctx.font = 'bold 13px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('MEETING CHAT', 18, 22);

  // Messages
  const logBottom = height - 70;
  let y = 54;
  const visible = messages.slice(-8);
  visible.forEach((m) => {
    if (y > logBottom - 8) return;
    if (m.system) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.12)';
      drawRoundRect(ctx, 14, y, width - 28, 28, 8);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px Arial, Helvetica, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(m.text, 24, y + 15);
      y += 36;
      return;
    }

    const bubbleH = 44;
    ctx.fillStyle = 'rgba(30, 27, 55, 0.95)';
    drawRoundRect(ctx, 14, y, width - 28, bubbleH, 10);
    ctx.fill();

    ctx.fillStyle = '#a78bfa';
    ctx.font = 'bold 12px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(m.name, 26, y + 14);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '13px Arial, Helvetica, sans-serif';
    const msg = String(m.text || '').slice(0, 52);
    ctx.fillText(msg, 26, y + 32);
    y += bubbleH + 8;
  });

  // Composer
  const inputY = height - 54;
  ctx.fillStyle = 'rgba(15, 18, 32, 0.98)';
  ctx.strokeStyle = focused ? '#34d399' : 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1.5;
  drawRoundRect(ctx, 12, inputY, width - 108, 38, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = draft ? '#f8fafc' : '#64748b';
  ctx.font = '13px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const shown = draft || (focused ? 'Type a message…' : 'Click to type…');
  ctx.fillText(shown.slice(0, 42), 24, inputY + 20);

  // Send
  ctx.fillStyle = '#14f195';
  drawRoundRect(ctx, width - 88, inputY, 76, 38, 10);
  ctx.fill();
  ctx.fillStyle = '#052e1a';
  ctx.font = 'bold 13px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SEND', width - 50, inputY + 20);
};

export class MeetingChat {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.messages = [];
    this.maxMessages = options.maxMessages || 40;
    this.onSend = options.onSend || null;
    this.enabled = true;
    this.draft = '';
    this.nodes = [];
    this.focused = true;
    this.textureKey = `chat_live_${Date.now()}`;

    this.x = options.x || 900;
    this.y = options.y || 420;
    this.width = options.width || 520;
    this.height = options.height || 430;

    const canvas = scene.textures.createCanvas(this.textureKey, this.width, this.height);
    this.canvas = canvas;
    this.ctx = canvas.getContext();
    paintChatSurface(this.ctx, this.width, this.height, this.messages, this.draft, this.focused);
    canvas.refresh();

    this.panel = scene.add.image(this.x, this.y, this.textureKey).setScrollFactor(0).setDepth(210);
    this.nodes.push(this.panel);

    const inputY = this.y + this.height / 2 - 35;
    this.inputZone = scene.add
      .zone(this.x - 40, inputY, this.width - 108, 40)
      .setScrollFactor(0)
      .setDepth(213)
      .setInteractive({ useHandCursor: true });
    this.inputZone.on('pointerdown', () => {
      this.focused = true;
      playSfx(scene, SFX.click);
      this.repaint();
    });
    this.nodes.push(this.inputZone);

    this.sendZone = scene.add
      .zone(this.x + this.width / 2 - 50, inputY, 76, 40)
      .setScrollFactor(0)
      .setDepth(213)
      .setInteractive({ useHandCursor: true });
    this.sendZone.on('pointerdown', () => this.submitDraft());
    this.nodes.push(this.sendZone);

    this.keyHandler = (event) => this.onKey(event);
    scene.input.keyboard.on('keydown', this.keyHandler);

    this.pushSystem('Discussion started. Type and press Enter.');
  }

  repaint() {
    if (!this.ctx || !this.canvas) return;
    paintChatSurface(this.ctx, this.width, this.height, this.messages, this.draft, this.focused);
    this.canvas.refresh();
  }

  onKey(event) {
    if (!this.enabled || !this.focused) return;
    if (this.scene.phase !== 'discuss') return;

    if (event.key === 'Enter') {
      if (event.preventDefault) event.preventDefault();
      this.submitDraft();
      return;
    }
    if (event.key === 'Backspace') {
      if (event.preventDefault) event.preventDefault();
      this.draft = this.draft.slice(0, -1);
      playSfx(this.scene, SFX.typing);
      this.repaint();
      return;
    }
    if (event.key.length === 1 && this.draft.length < 60 && !event.ctrlKey && !event.metaKey) {
      this.draft += event.key;
      playSfx(this.scene, SFX.typing);
      this.repaint();
    }
  }

  submitDraft() {
    const msg = this.draft.trim();
    if (!msg) return;
    this.send(msg);
    this.draft = '';
    this.repaint();
  }

  send(text) {
    const local = this.scene.entities[this.scene.localId];
    if (local && local.alive === false) {
      this.pushSystem('Ghosts cannot talk in meeting chat.');
      return;
    }
    const name = (local && local.name) || this.scene.playerName || 'You';
    const message = {
      id: `${Date.now()}`,
      name,
      text,
      system: false,
      senderId: this.scene.localId,
    };
    this.pushMessage(message);
    if (this.onSend) this.onSend(message);
  }

  pushSystem(text) {
    this.pushMessage({ id: `sys-${Date.now()}`, name: 'SYSTEM', text, system: true });
  }

  pushMessage(message) {
    this.messages.push(message);
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
    this.repaint();
    playSfx(this.scene, message.system ? SFX.message : SFX.pop);
  }

  destroy() {
    this.enabled = false;
    if (this.keyHandler) {
      this.scene.input.keyboard.off('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.nodes.forEach((n) => n && n.destroy && n.destroy());
    this.nodes = [];
    if (this.textureKey && this.scene.textures.exists(this.textureKey)) {
      this.scene.textures.remove(this.textureKey);
    }
    this.canvas = null;
    this.ctx = null;
  }

  getNodes() {
    return this.nodes.slice();
  }
}

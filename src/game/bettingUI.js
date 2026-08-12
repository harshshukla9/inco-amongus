import { GAME_WIDTH, GAME_HEIGHT, PLAYER_COLORS } from '../constants';
import { playSfx, SFX } from '../audio';
import { drawRoundRect } from './meetingUI';
import { createAmongButton } from '../ui';

const toCss = (color) => `#${Number(color).toString(16).padStart(6, '0')}`;
const STAKES = [0.0002, 0.001, 0.005];
/** Mirrors ImpostorMarket.PROVE_WINDOW */
const PROVE_WINDOW_MS = 3 * 60 * 1000;

const shortEth = (value) => {
  const n = Number(value || 0);
  if (!n) return '0';
  if (n < 0.0001) return n.toExponential(1);
  return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
};

/** Compact top-right badge: pot size, your bet state, and the hotkey. */
export const buildBadgeTexture = (scene, key, width, height, state) => {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const canvas = scene.textures.createCanvas(key, width, height);
  const ctx = canvas.getContext();
  const open = state.phase === 'betting' || state.phase === 'pending';

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(10, 8, 26, 0.94)';
  ctx.strokeStyle = open ? '#38bdf8' : 'rgba(148, 163, 184, 0.5)';
  ctx.lineWidth = 2;
  drawRoundRect(ctx, 1, 1, width - 2, height - 2, 12);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = open ? '#7dd3fc' : '#94a3b8';
  ctx.font = 'bold 12px Arial Black, Arial';
  ctx.fillText('IMPOSTOR MARKET', 12, 17);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 15px Arial, Helvetica, sans-serif';
  ctx.fillText(`Pot ${shortEth(state.potEth)} ETH`, 12, 38);

  ctx.fillStyle = '#a78bfa';
  ctx.font = '12px Arial, Helvetica, sans-serif';
  ctx.fillText(`${state.bets || 0} sealed bet${state.bets === 1 ? '' : 's'}`, 12, 56);

  let hint = open ? '[B] place bet' : 'betting closed';
  let hintColor = open ? '#fde68a' : '#94a3b8';
  if (state.phase === 'pending') {
    hint = state.hint || 'waiting for host';
    hintColor = '#94a3b8';
  }
  if (state.myBetPlaced) {
    hint = open ? 'your pick: SEALED' : 'your pick: SEALED';
    hintColor = '#86efac';
  }
  if (state.phase === 'settled') {
    hint = '[B] claim window';
    hintColor = '#fde68a';
  }
  ctx.fillStyle = hintColor;
  ctx.font = 'bold 12px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(hint, width - 12, 38);

  canvas.refresh();
  return key;
};

const buildCandidateRow = (scene, key, width, height, player, selected, disabled) => {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const canvas = scene.textures.createCanvas(key, width, height);
  const ctx = canvas.getContext();
  const color = PLAYER_COLORS[(player.colorIndex || 0) % PLAYER_COLORS.length];

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = selected ? 'rgba(12, 44, 56, 0.98)' : 'rgba(18, 14, 36, 0.96)';
  ctx.strokeStyle = selected ? '#38bdf8' : 'rgba(167, 139, 250, 0.45)';
  ctx.lineWidth = selected ? 2.5 : 1.5;
  drawRoundRect(ctx, 1.5, 1.5, width - 3, height - 3, 12);
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = disabled ? 0.4 : 1;
  ctx.beginPath();
  ctx.fillStyle = toCss(color);
  ctx.arc(24, height / 2, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.font = '600 16px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(player.name || 'Player', 44, height / 2);

  if (disabled) {
    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 11px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText("CAN'T BET ON YOURSELF", width - 14, height / 2);
  } else if (player.alive === false) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('DEAD', width - 14, height / 2);
  }
  ctx.globalAlpha = 1;

  canvas.refresh();
  return key;
};

/**
 * Overlay for placing a confidential bet and, after settlement, claiming a payout.
 * Owns only its own nodes so it can sit on top of any game phase.
 */
export class BettingPanel {
  constructor(scene, options) {
    this.scene = scene;
    this.options = options;
    this.nodes = [];
    this.rows = {};
    this.selectedIndex = null;
    this.stake = STAKES[0];
    this.busy = false;
    this.open = false;
  }

  isOpen() {
    return this.open;
  }

  show(state) {
    if (this.open) return;
    this.open = true;
    this.state = state;
    this.selectedIndex = null;
    this.render();
  }

  hide() {
    this.open = false;
    this.nodes.forEach((n) => n && n.destroy && n.destroy());
    this.nodes = [];
    this.rows = {};
    this.statusText = null;
  }

  setStatus(message, color = '#a5b4fc') {
    if (this.statusText) this.statusText.setText(message).setColor(color);
  }

  render() {
    const scene = this.scene;
    const { candidates, state } = this.options.snapshot();
    this.state = state;

    const panelW = 520;
    const panelH = 460;
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    const shade = scene.add
      .rectangle(cx, cy, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72)
      .setScrollFactor(0)
      .setDepth(300)
      .setInteractive();
    const panel = scene.add
      .image(cx, cy, this.panelTexture(panelW, panelH))
      .setScrollFactor(0)
      .setDepth(301);
    this.nodes = [shade, panel];

    const settled =
      state.phase === 'settled' ||
      state.phase === 'finalized' ||
      state.phase === 'refunding' ||
      state.phase === 'locked';
    // After a round ends with bets still open, show the settle/claim panel instead of the stake picker
    const showClaimPanel = settled || (state.phase === 'betting' && state.forceClaimUi);
    const top = cy - panelH / 2;

    const header = scene.add
      .text(cx, top + 34, 'WHO IS THE IMPOSTOR?', {
        fontFamily: 'Arial Black, Impact, Arial',
        fontSize: '22px',
        color: '#7dd3fc',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(302);
    const sub = scene.add
      .text(
        cx,
        top + 58,
        showClaimPanel
          ? `Pot ${shortEth(state.potEth)} ETH · ${state.phase}`
          : `Your pick is encrypted with Inco · pot ${shortEth(state.potEth)} ETH`,
        {
          fontFamily: 'Arial',
          fontSize: '13px',
          color: '#a78bfa',
        },
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(302);
    this.nodes.push(header, sub);

    if (showClaimPanel) this.renderSettled(cx, top, panelH);
    else this.renderBetting(cx, top, panelW, candidates);

    this.statusText = scene.add
      .text(cx, cy + panelH / 2 - 74, '', {
        fontFamily: 'Arial',
        fontSize: '13px',
        color: '#a5b4fc',
        align: 'center',
        wordWrap: { width: panelW - 60 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(302);

    const close = createAmongButton(
      scene,
      cx,
      cy + panelH / 2 - 34,
      'CLOSE',
      () => this.hide(),
      { width: 150, height: 40, fontSize: '15px', fill: '#334155', stroke: '#64748b' },
    );
    close.setScrollFactor(0).setDepth(303);
    this.nodes.push(this.statusText, close);

    scene.cameras.main.ignore(this.nodes);
  }

  panelTexture(width, height) {
    const key = 'bet_panel_bg';
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const canvas = this.scene.textures.createCanvas(key, width, height);
    const ctx = canvas.getContext();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(10, 8, 26, 0.98)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    drawRoundRect(ctx, 1.5, 1.5, width - 3, height - 3, 20);
    ctx.fill();
    ctx.stroke();
    canvas.refresh();
    return key;
  }

  renderBetting(cx, top, panelW, candidates) {
    const scene = this.scene;
    const rowW = panelW - 60;
    const rowH = 40;
    let y = top + 92;

    if (this.state.myBetPlaced) {
      const placed = scene.add
        .text(
          cx,
          y + 40,
          `Bet locked in — ${shortEth(this.state.myStakeEth)} ETH on a sealed pick.\nNobody can read it until the round settles.`,
          {
            fontFamily: 'Arial',
            fontSize: '15px',
            color: '#86efac',
            align: 'center',
          },
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(302);
      this.nodes.push(placed);
      return;
    }

    if (this.state.phase !== 'betting') {
      const closed = scene.add
        .text(cx, y + 40, 'Betting is closed for this round.', {
          fontFamily: 'Arial',
          fontSize: '15px',
          color: '#fbbf24',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(302);
      this.nodes.push(closed);
      return;
    }

    candidates.forEach((candidate) => {
      const key = `bet_row_${candidate.index}`;
      const disabled = candidate.isSelf;
      const row = scene.add
        .image(cx, y, buildCandidateRow(scene, key, rowW, rowH, candidate, false, disabled))
        .setScrollFactor(0)
        .setDepth(302);
      if (!disabled) {
        row.setInteractive({ useHandCursor: true });
        row.on('pointerdown', () => this.selectCandidate(candidate));
      }
      this.rows[candidate.index] = { image: row, candidate, key, rowW, rowH };
      this.nodes.push(row);
      y += rowH + 8;
    });

    const stakeLabel = scene.add
      .text(cx - rowW / 2, y + 12, 'STAKE', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '12px',
        color: '#94a3b8',
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(302);
    this.nodes.push(stakeLabel);

    this.stakeButtons = STAKES.map((value, i) => {
      const btn = createAmongButton(
        scene,
        cx - rowW / 2 + 70 + i * 110,
        y + 12,
        `${shortEth(value)} ETH`,
        () => this.selectStake(value),
        {
          width: 100,
          height: 32,
          fontSize: '13px',
          fill: value === this.stake ? '#0ea5e9' : '#1e293b',
          stroke: value === this.stake ? '#7dd3fc' : '#475569',
        },
      );
      btn.setScrollFactor(0).setDepth(303);
      this.nodes.push(btn);
      return { btn, value };
    });

    this.confirmBtn = createAmongButton(
      scene,
      cx,
      y + 62,
      'PLACE SEALED BET',
      () => this.confirm(),
      { width: 260, height: 46, fontSize: '17px', fill: '#0ea5e9', stroke: '#7dd3fc' },
    );
    this.confirmBtn.setScrollFactor(0).setDepth(303);
    this.confirmBtn.setAlpha(0.5);
    this.nodes.push(this.confirmBtn);
  }

  renderSettled(cx, top, panelH) {
    const scene = this.scene;
    const state = this.state;
    const lines = [];
    if (state.phase === 'betting' || state.phase === 'locked') {
      lines.push('Game ended but the market is not settled yet.');
      lines.push('Settle scans each player on-chain to find the impostor.');
    } else {
      lines.push(
        state.impostorName
          ? `The impostor was ${state.impostorName}.`
          : 'Impostor revealed on-chain.',
      );
    }
    if (!state.myBetPlaced) lines.push('You did not bet on this round.');
    else if (state.myClaimed) lines.push('Payout already claimed.');
    else if (state.phase === 'refunding') lines.push('No winning bets — your stake is refundable.');
    else if (state.myWinner) lines.push('Winning pick proven. Claim once the window closes.');
    else if (state.phase === 'settled') {
      lines.push('Reveal your pick to prove a win. Losing picks stay secret.');
    }

    const info = scene.add
      .text(cx, top + 120, lines.join('\n'), {
        fontFamily: 'Arial',
        fontSize: '15px',
        color: '#e2e8f0',
        align: 'center',
        wordWrap: { width: 420 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(302);
    this.nodes.push(info);

    let y = top + 200;
    const addAction = (label, handler, tint) => {
      const btn = createAmongButton(scene, cx, y, label, handler, {
        width: 300,
        height: 46,
        fontSize: '16px',
        fill: tint || '#0ea5e9',
        stroke: '#7dd3fc',
      });
      btn.setScrollFactor(0).setDepth(303);
      this.nodes.push(btn);
      y += 58;
    };

    if (state.phase === 'betting' || state.phase === 'locked') {
      addAction('SETTLE MARKET NOW', () => this.run('settle'), '#f59e0b');
    }
    if (state.myBetPlaced && !state.myProven && state.phase === 'settled') {
      addAction('REVEAL PICK & PROVE WIN', () => this.run('prove'));
    }
    if (state.phase === 'settled') {
      const unlockAt = (state.settledAt || 0) * 1000 + PROVE_WINDOW_MS;
      const waitMs = unlockAt - Date.now();
      if (waitMs > 0) {
        const wait = scene.add
          .text(cx, y + 10, `Payouts unlock in ${Math.ceil(waitMs / 1000)}s`, {
            fontFamily: 'Arial',
            fontSize: '14px',
            color: '#fbbf24',
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(302);
        this.nodes.push(wait);
        y += 44;
      } else {
        addAction('FINALIZE PAYOUTS', () => this.run('finalize'), '#7c3aed');
      }
    }
    if (
      (state.phase === 'finalized' || state.phase === 'refunding') &&
      state.myPayout &&
      state.myPayout > 0
    ) {
      addAction(
        `CLAIM ${shortEth(state.myPayoutEth)} ETH`,
        () => this.run('claim'),
        '#16a34a',
      );
    }
  }

  selectCandidate(candidate) {
    if (this.busy) return;
    playSfx(this.scene, SFX.select);
    this.selectedIndex = candidate.index;
    Object.values(this.rows).forEach((row) => {
      const selected = row.candidate.index === candidate.index;
      row.image.setTexture(
        buildCandidateRow(
          this.scene,
          row.key,
          row.rowW,
          row.rowH,
          row.candidate,
          selected,
          row.candidate.isSelf,
        ),
      );
    });
    if (this.confirmBtn) this.confirmBtn.setAlpha(1);
  }

  selectStake(value) {
    if (this.busy) return;
    this.stake = value;
    this.setStatus(`Stake set to ${shortEth(value)} ETH`, '#7dd3fc');
  }

  async confirm() {
    if (this.busy) return;
    if (!this.selectedIndex) {
      this.setStatus('Pick a player first.', '#fbbf24');
      return;
    }
    this.busy = true;
    try {
      await this.options.onBet(this.selectedIndex, this.stake, (msg) => this.setStatus(msg));
      this.setStatus('Bet placed — your pick stays encrypted ✓', '#86efac');
      await this.options.refresh();
      if (this.open) {
        this.hide();
        this.show();
      }
    } catch (err) {
      this.setStatus(String((err && err.message) || err), '#f87171');
    } finally {
      this.busy = false;
    }
  }

  async run(action) {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.options.onAction(action, (msg) => this.setStatus(msg));
      await this.options.refresh();
      if (this.open) {
        this.hide();
        this.show();
      }
    } catch (err) {
      this.setStatus(String((err && err.message) || err), '#f87171');
    } finally {
      this.busy = false;
    }
  }

  destroy() {
    this.hide();
  }
}

import Phaser from 'phaser';
import lobbyArtImg from '../assets/Lobby.png';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  MAX_PLAYERS,
  PLAYER_COLORS,
} from '../constants';
import { playSfx, preloadSounds, SFX, unlockAudio } from '../audio';
import {
  assignIncoRoles,
  connectWallet,
  isMarketConfigured,
  openMarket,
  readMatchSnapshot,
  formatWalletError,
  isIncoConfigured,
  isWalletAvailable,
  joinIncoMatch,
  onChainChanged,
  openIncoMatch,
  switchToIncoNetwork,
  targetNetworkLabel,
  waitForOnChainSeats,
  walletDiagnostics,
} from '../inco';
import { connectSocket, disconnectSocket, getSocket } from '../network';
import {
  createAmongButton,
  createMenuBackground,
  createTextCard,
  makeNearBlackTransparent,
} from '../ui';
import { updateQueryParameter } from '../utils';

const toCss = (color) => {
  if (typeof color === 'string') return color;
  return `#${color.toString(16).padStart(6, '0')}`;
};

const buildSlotTexture = (scene, key, width, height, color, label) => {
  if (scene.textures.exists(key)) {
    scene.textures.remove(key);
  }
  const canvas = scene.textures.createCanvas(key, width, height);
  const ctx = canvas.getContext();
  const r = 12;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(18, 12, 36, 0.92)';
  ctx.strokeStyle = 'rgba(192, 132, 252, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r, 1);
  ctx.lineTo(width - r, 1);
  ctx.quadraticCurveTo(width - 1, 1, width - 1, r);
  ctx.lineTo(width - 1, height - r);
  ctx.quadraticCurveTo(width - 1, height - 1, width - r, height - 1);
  ctx.lineTo(r, height - 1);
  ctx.quadraticCurveTo(1, height - 1, 1, height - r);
  ctx.lineTo(1, r);
  ctx.quadraticCurveTo(1, 1, r, 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // color dot
  const css = toCss(color);
  ctx.beginPath();
  ctx.fillStyle = css;
  ctx.arc(28, height / 2, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();

  ctx.fillStyle = '#f3e8ff';
  ctx.font = 'bold 18px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 50, height / 2 + 1);

  canvas.refresh();
  return key;
};

const buildRoomCardTexture = (scene, key, width, height, roomCode) => {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const canvas = scene.textures.createCanvas(key, width, height);
  const ctx = canvas.getContext();
  const r = 16;

  ctx.fillStyle = 'rgba(15, 8, 30, 0.94)';
  ctx.strokeStyle = '#9945FF';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(r, 1);
  ctx.lineTo(width - r, 1);
  ctx.quadraticCurveTo(width - 1, 1, width - 1, r);
  ctx.lineTo(width - 1, height - r);
  ctx.quadraticCurveTo(width - 1, height - 1, width - r, height - 1);
  ctx.lineTo(r, height - 1);
  ctx.quadraticCurveTo(1, height - 1, 1, height - r);
  ctx.lineTo(1, r);
  ctx.quadraticCurveTo(1, 1, r, 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#c4b5fd';
  ctx.font = 'bold 13px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ROOM CODE  •  CLICK TO COPY', width / 2, 22);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px Arial Black, Impact, Arial, sans-serif';
  ctx.fillText(roomCode.toUpperCase(), width / 2, height / 2 + 8);

  canvas.refresh();
  return key;
};

export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super('LobbyScene');
  }

  init(data) {
    this.mode = data.mode || 'host';
    this.room = data.room;
    this.fillBots = data.fillBots !== false;
    this.maxPlayers = data.maxPlayers || MAX_PLAYERS;
    this.isHost = Boolean(data.isHost);
    this.playerName = data.playerName || 'Crewmate';
    this.players = [];
    this.localId = null;
    this.keepSocket = false;
    this.copyFlashUntil = 0;
    // Confidential roles via Inco (off by default; requires deployed contract + wallet)
    let incoOk = false;
    try {
      incoOk = isIncoConfigured();
    } catch (_) {
      incoOk = false;
    }
    this.incoReady = incoOk;
    // Default Inco ON when configured (unless host explicitly turned it off)
    this.useIncoRoles =
      incoOk && (data.useIncoRoles === undefined ? true : Boolean(data.useIncoRoles));
    this.walletAddress = data.walletAddress || null;
    this.incoBusy = false;
  }

  preload() {
    if (!this.textures.exists('lobbyArt')) {
      this.load.image('lobbyArt', lobbyArtImg);
    }
    preloadSounds(this);
  }

  create() {
    this.stars = createMenuBackground(this, GAME_WIDTH, GAME_HEIGHT);
    unlockAudio(this);
    playSfx(this, SFX.menuIn);

    this.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'lobbyArt')
      .setScale(0.55)
      .setAlpha(0.18)
      .setDepth(1);

    const logoKey = makeNearBlackTransparent(this, 'logo');
    this.add.image(20, 16, logoKey).setOrigin(0, 0).setScale(0.4).setDepth(10);

    createTextCard(this, GAME_WIDTH / 2, 56, 620, 84, {
      key: 'lobby_header_card',
      panel: false,
      depth: 10,
      lines: [
        {
          text: this.isHost ? 'HOST LOBBY' : 'JOINED LOBBY',
          size: 32,
          color: '#f5f3ff',
          font: 'Arial Black, Impact, Arial, sans-serif',
        },
        { text: `Playing as ${this.playerName}`, size: 16, color: '#14f195' },
      ],
    });

    const cardKey = buildRoomCardTexture(this, 'lobby_room_card', 420, 96, this.room);
    this.roomCard = this.add
      .image(GAME_WIDTH / 2, 150, cardKey)
      .setDepth(12)
      .setInteractive({ useHandCursor: true });

    this.roomCard.on('pointerup', () => {
      unlockAudio(this);
      this.copyRoomCode();
    });

    this.statusMessage = 'Connecting...';
    this.copyHintText = 'tap code to copy';
    this.copyHintColor = '#a78bfa';
    this.statusCard = createTextCard(this, GAME_WIDTH / 2, 226, 620, 58, {
      key: 'lobby_status_card',
      panel: false,
      depth: 12,
      lines: this.statusCardLines(),
    });

    this.statusText = { setText: (text) => this.setStatusMessage(text) };

    // Compact player list
    const slotW = 560;
    const slotH = 40;
    const startY = 275;
    this.slots = [];
    for (let i = 0; i < this.maxPlayers; i += 1) {
      const y = startY + i * (slotH + 6);
      const key = buildSlotTexture(
        this,
        `lobby_slot_${i}_empty`,
        slotW,
        slotH,
        0x555555,
        'Empty',
      );
      const image = this.add.image(GAME_WIDTH / 2, y, key).setDepth(12);
      this.slots.push({ image, index: i });
    }

    createAmongButton(
      this,
      90,
      GAME_HEIGHT - 52,
      'BACK',
      () => {
        playSfx(this, SFX.menuOut);
        this.keepSocket = false;
        disconnectSocket();
        this.scene.start('MenuScene');
      },
      { width: 120, height: 48, fontSize: '16px', sound: SFX.leave },
    );

    // Row for Inco wallet / confidential roles (always visible)
    this.incoCard = createTextCard(this, GAME_WIDTH / 2, GAME_HEIGHT - 118, 840, 44, {
      key: 'lobby_inco_card',
      fill: 'rgba(8, 14, 32, 0.94)',
      stroke: this.useIncoRoles ? '#38bdf8' : '#64748b',
      radius: 14,
      depth: 12,
      lines: [
        {
          text: this.incoStatusLabel(),
          size: 14,
          color: this.useIncoRoles ? '#e0f2fe' : '#f8fafc',
        },
      ],
    });


    const walletLabel = this.walletAddress
      ? `${this.walletAddress.slice(0, 6)}…${this.walletAddress.slice(-4)}`
      : 'CONNECT WALLET';

    this.walletBtn = createAmongButton(
      this,
      this.isHost ? GAME_WIDTH / 2 - 90 : GAME_WIDTH / 2,
      GAME_HEIGHT - 70,
      walletLabel,
      () => this.connectIncoWallet(),
      {
        width: 200,
        height: 44,
        fontSize: '15px',
        fill: '#312e81',
        hover: '#4338ca',
        stroke: '#a78bfa',
        hoverStroke: '#c4b5fd',
        sound: SFX.click,
      },
    );

    if (this.isHost && this.incoReady) {
      this.incoToggle = createAmongButton(
        this,
        GAME_WIDTH / 2 + 130,
        GAME_HEIGHT - 70,
        this.useIncoRoles ? 'INCO: ON' : 'INCO: OFF',
        () => {
          this.useIncoRoles = !this.useIncoRoles;
          if (this.useIncoRoles) this.fillBots = false;
          if (this.fillToggle) {
            this.fillToggle.setButtonText(this.fillBots ? 'BOTS: ON' : 'BOTS: OFF');
          }
          playSfx(this, this.useIncoRoles ? SFX.toggleOn : SFX.toggleOff);
          this.incoToggle.setButtonText(this.useIncoRoles ? 'INCO: ON' : 'INCO: OFF');
          this.setIncoStatus(
            this.incoStatusLabel(),
            this.useIncoRoles ? '#7dd3fc' : '#94a3b8',
          );
          this.renderPlayers();
        },
        {
          width: 140,
          height: 44,
          fontSize: '15px',
          fill: '#1e3a5f',
          hover: '#274c77',
          stroke: '#38bdf8',
          hoverStroke: '#7dd3fc',
          sound: SFX.pop,
        },
      );
    }

    if (this.isHost) {
      this.fillToggle = createAmongButton(
        this,
        GAME_WIDTH / 2 + (this.incoReady ? 290 : 130),
        GAME_HEIGHT - 70,
        this.fillBots ? 'BOTS: ON' : 'BOTS: OFF',
        () => {
          this.fillBots = !this.fillBots;
          if (this.fillBots && this.useIncoRoles) {
            this.useIncoRoles = false;
            if (this.incoToggle) this.incoToggle.setButtonText('INCO: OFF');
          }
          playSfx(this, this.fillBots ? SFX.toggleOn : SFX.toggleOff);
          this.fillToggle.setButtonText(this.fillBots ? 'BOTS: ON' : 'BOTS: OFF');
          this.setIncoStatus(this.incoStatusLabel());
          this.renderPlayers();
        },
        {
          width: 140,
          height: 44,
          fontSize: '15px',
          fill: '#2e1065',
          hover: '#4c1d95',
          stroke: '#c084fc',
          hoverStroke: '#14f195',
          sound: SFX.pop,
        },
      );

      createAmongButton(
        this,
        GAME_WIDTH - 120,
        GAME_HEIGHT - 52,
        'START',
        () => this.startGame(),
        {
          width: 160,
          height: 48,
          fontSize: '20px',
          fill: '#065f46',
          hover: '#047857',
          stroke: '#14f195',
          hoverStroke: '#a7f3d0',
          sound: SFX.launch,
        },
      );
    } else {
      this.add
        .text(GAME_WIDTH - 160, GAME_HEIGHT - 52, 'Waiting for host...', {
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '16px',
          color: '#c4b5fd',
        })
        .setOrigin(0.5)
        .setDepth(12);
    }

    window.history.replaceState(
      {},
      document.title,
      updateQueryParameter('room', this.room),
    );

    this.connectToRoom();

    // Auto-switch MetaMask to Base Sepolia / Anvil when Inco lobby opens
    if (this.useIncoRoles && this.incoReady) {
      this.watchChain();
      this.autoSwitchNetwork();
    }
  }

  watchChain() {
    try {
      this.unwatchChain = onChainChanged(async () => {
        const diag = await walletDiagnostics();
        if (diag.onTarget) {
          this.setIncoStatus('On correct network ✓ — ready to START', '#86efac');
        } else {
          this.setIncoStatus(
            `Wallet on chain ${diag.chainId} — needs ${targetNetworkLabel()}`,
            '#fbbf24',
          );
        }
      });
      this.events.once('shutdown', () => {
        if (this.unwatchChain) this.unwatchChain();
      });
    } catch (err) {
      console.warn('chain watch unavailable', err);
    }
  }

  async autoSwitchNetwork() {
    if (!isWalletAvailable()) return;
    try {
      const diag = await walletDiagnostics();
      if (!diag.isMetaMask) {
        this.setIncoStatus(
          `Active wallet is ${diag.walletName}, not MetaMask — disable other wallet extensions if the switch fails`,
          '#fbbf24',
        );
      }
      if (diag.onTarget) {
        this.setIncoStatus('On correct network ✓ — ready to START', '#86efac');
        return;
      }
      this.setIncoStatus('Auto-switching wallet network…', '#fde68a');
      await switchToIncoNetwork((msg) => this.setIncoStatus(msg, '#fde68a'));
      this.walletAddress = this.walletAddress || (await connectWallet({ switchNetwork: false }));
      if (this.walletBtn && this.walletAddress) {
        this.walletBtn.setButtonText(
          `${this.walletAddress.slice(0, 6)}…${this.walletAddress.slice(-4)}`,
        );
      }
      this.setIncoStatus('On correct network ✓ — ready to START', '#86efac');
    } catch (err) {
      console.warn(err);
      this.setIncoStatus(formatWalletError(err), '#f87171');
    }
  }

  copyRoomCode() {
    const code = String(this.room || '').toUpperCase();
    const done = () => {
      playSfx(this, SFX.toast);
      this.setCopyHint('copied ✓', '#14f195');
      this.copyFlashUntil = this.time.now + 1600;
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done).catch(() => {
        this.fallbackCopy(code);
        done();
      });
    } else {
      this.fallbackCopy(code);
      done();
    }
  }

  fallbackCopy(text) {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      // ignore
    }
    document.body.removeChild(input);
  }

  connectToRoom() {
    this.socket = connectSocket(this.room, this.playerName);

    this.socket.on('connect', () => {
      this.localId = this.socket.id;
      this.statusText.setText(this.isHost ? 'Share the room code with friends' : 'Connected to room');
    });

    this.socket.on('lobbyState', (state) => {
      const prevCount = this.players.length;
      this.players = state.players || [];
      this.isHost = state.hostId === this.localId || state.hostId === this.socket.id;
      this.localId = this.socket.id;
      if (this.lobbyReady) {
        if (this.players.length > prevCount) playSfx(this, SFX.join);
        else if (this.players.length < prevCount) playSfx(this, SFX.leave);
      }
      this.lobbyReady = true;
      this.renderPlayers();
    });

    this.socket.on('gameStarted', (payload) => {
      playSfx(this, SFX.launch);
      this.keepSocket = true;
      this.scene.start('GameScene', {
        mode: 'multi',
        room: this.room,
        fillBots: payload.fillBots,
        maxPlayers: this.maxPlayers,
        isHost: this.isHost,
        localId: this.socket.id,
        players: payload.players,
        playerName: this.playerName,
        roleSource: payload.roleSource || 'server',
        useIncoRoles: payload.roleSource === 'inco',
        walletAddress: this.walletAddress,
        marketAddress: payload.marketAddress || null,
      });
    });

    this.socket.on('incoJoinRequired', async () => {
      // Host opens the match; guests must wait for openMatch before join
      if (this.isHost) return;
      try {
        if (!this.walletAddress) await this.connectIncoWallet();
        if (!this.walletAddress) {
          this.setIncoStatus('Connect wallet to claim Inco seat', '#fbbf24');
          return;
        }
        this.setIncoStatus('Waiting for host openMatch, then approve join…', '#fde68a');
        const joined = await joinIncoMatch(
          (msg) => this.setIncoStatus(msg, '#fde68a'),
          { waitForOpenMs: 120000 },
        );
        this.setIncoStatus(
          joined && joined.alreadySeated
            ? 'Already seated ✓ (same wallet as another player?)'
            : 'On-chain seat claimed ✓',
          '#86efac',
        );
        const sock = getSocket();
        if (sock) sock.emit('incoJoined', { address: this.walletAddress });
      } catch (err) {
        console.error(err);
        this.setIncoStatus(formatWalletError(err), '#f87171');
      }
    });

    this.socket.on('incoStartRejected', ({ reason } = {}) => {
      this.setIncoStatus(reason || 'Inco start rejected by server', '#f87171');
      playSfx(this, SFX.cancel);
    });

    this.socket.on('disconnect', () => {
      if (!this.keepSocket) {
        playSfx(this, SFX.cancel);
        this.statusText.setText('Disconnected from server');
      }
    });
  }

  renderPlayers() {
    for (let i = 0; i < this.maxPlayers; i += 1) {
      const slot = this.slots[i];
      const player = this.players[i];
      let label = 'Empty';
      let color = 0x555555;

      if (player) {
        const you = player.id === this.localId ? ' (you)' : '';
        label = `${player.name}${you}`;
        color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      } else if (this.fillBots) {
        label = `Bot ${i + 1}`;
        color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      }

      const key = buildSlotTexture(this, `lobby_slot_${i}_${label}`, 560, 40, color, label);
      slot.image.setTexture(key);
    }

    const humanCount = this.players.length;
    const botCount = this.fillBots ? Math.max(0, this.maxPlayers - humanCount) : 0;
    this.statusText.setText(
      `${humanCount} player${humanCount === 1 ? '' : 's'}` +
        (botCount ? `  •  ${botCount} bot${botCount === 1 ? '' : 's'}` : ''),
    );
  }

  incoStatusLabel() {
    if (!this.incoReady) return 'Inco: not configured (deploy AmongUsRoles + npm run build:inco)';
    if (this.useIncoRoles) {
      return this.walletAddress
        ? `Confidential roles ON · ${this.walletAddress.slice(0, 6)}…${this.walletAddress.slice(-4)} · humans only`
        : 'Confidential roles ON · connect wallet before START';
    }
    return 'Inco OFF · server assigns roles (bots OK)';
  }

  softIncoFlag() {
    return this.useIncoRoles;
  }

  statusCardLines(message) {
    return [
      { text: this.copyHintText, size: 14, weight: 'normal', color: this.copyHintColor },
      { text: message != null ? message : this.statusMessage, size: 16, color: '#ddd6fe' },
    ];
  }

  setStatusMessage(text) {
    this.statusMessage = String(text || '');
    if (this.statusCard) this.statusCard.setLines(this.statusCardLines());
  }

  setCopyHint(text, color) {
    this.copyHintText = text;
    this.copyHintColor = color;
    if (this.statusCard) this.statusCard.setLines(this.statusCardLines());
  }

  setIncoStatus(text, color = '#e0f2fe') {
    if (!this.incoCard) return;
    this.incoCard.setLines([
      { text: String(text || '').slice(0, 180), size: 14, color },
    ]);
  }

  async connectIncoWallet() {
    if (!isWalletAvailable()) {
      this.setIncoStatus('Install MetaMask (or another wallet)', '#f87171');
      playSfx(this, SFX.cancel);
      return;
    }
    try {
      this.walletAddress = await connectWallet();
      // Force Base Sepolia / Anvil immediately so START doesn't fail later
      if (this.useIncoRoles || isIncoConfigured()) {
        this.setIncoStatus('Approve MetaMask network switch…', '#fde68a');
        await switchToIncoNetwork((msg) => this.setIncoStatus(msg, '#fde68a'));
      }
      playSfx(this, SFX.confirm);
      if (this.walletBtn) {
        this.walletBtn.setButtonText(
          `${this.walletAddress.slice(0, 6)}…${this.walletAddress.slice(-4)}`,
        );
      }
      this.setIncoStatus(
        'Wallet ready on correct network ✓',
        '#86efac',
      );
      const socket = getSocket();
      if (socket && this.walletAddress) {
        socket.emit('registerWallet', { address: this.walletAddress });
      }
    } catch (err) {
      console.error(err);
      this.setIncoStatus(formatWalletError(err), '#f87171');
      playSfx(this, SFX.cancel);
    }
  }

  async startGame() {
    const socket = getSocket();
    if (!socket || this.incoBusy) return;

    if (this.useIncoRoles) {
      if (!isIncoConfigured()) {
        this.setIncoStatus('Deploy AmongUsRoles first', '#f87171');
        playSfx(this, SFX.cancel);
        return;
      }
      if (!this.walletAddress) {
        await this.connectIncoWallet();
        if (!this.walletAddress) return;
      }
      const humans = Math.max(2, this.players.length);
      // Friend Bluff rule: one seat per address — catch duplicates before any tx
      const wallets = (this.players || [])
        .map((p) => (p.walletAddress || '').toLowerCase())
        .filter(Boolean);
      const unique = new Set(wallets);
      if (wallets.length >= 2 && unique.size < wallets.length) {
        this.setIncoStatus(
          'Duplicate wallets in lobby — each human needs a different MetaMask account',
          '#f87171',
        );
        playSfx(this, SFX.cancel);
        return;
      }

      this.incoBusy = true;
      this.setIncoStatus('Switching MetaMask to Base Sepolia…', '#fde68a');
      try {
        await switchToIncoNetwork((msg) => this.setIncoStatus(msg, '#fde68a'));
        this.setIncoStatus('Approve openMatch in MetaMask first…', '#fde68a');
        await openIncoMatch(humans, (msg) => this.setIncoStatus(msg, '#fde68a'));
        socket.emit('incoMatchOpened', { expectedPlayers: humans });

        // Only after match is confirmed Joining — ask guests + host seat
        socket.emit('incoAskJoin');
        this.setIncoStatus('Host joining on-chain… approve MetaMask', '#fde68a');
        await joinIncoMatch(
          (msg) => this.setIncoStatus(msg, '#fde68a'),
          { waitForOpenMs: 15000 },
        );
        socket.emit('incoJoined', { address: this.walletAddress });

        await waitForOnChainSeats(humans, {
          timeoutMs: 120000,
          onStatus: (msg) =>
            this.setIncoStatus(`${msg} (each guest: different wallet + Approve join)`, '#fde68a'),
        });

        const assigned = await assignIncoRoles((msg) =>
          this.setIncoStatus(msg, '#fde68a'),
        );
        if (!assigned || !assigned.hash) {
          throw new Error('assignRoles did not return a tx hash — refusing to start');
        }
        this.setIncoStatus(
          `Roles on-chain ✓ ${assigned.hash.slice(0, 10)}… starting…`,
          '#86efac',
        );
        await this.openPredictionMarket(socket);
        socket.emit('startGame', {
          fillBots: this.fillBots,
          maxPlayers: this.maxPlayers,
          roleSource: 'inco',
          assignTxHash: assigned.hash,
        });
      } catch (err) {
        console.error(err);
        this.setIncoStatus(formatWalletError(err), '#f87171');
        playSfx(this, SFX.cancel);
      } finally {
        this.incoBusy = false;
      }
      return;
    }

    // Explicit server-role start (INCO must be OFF)
    this.setIncoStatus('Starting with server roles (Inco OFF)', '#94a3b8');
    socket.emit('startGame', {
      fillBots: this.fillBots,
      maxPlayers: this.maxPlayers,
      roleSource: 'server',
    });
  }

  /// Betting is optional — a market failure must never block the round from starting.
  async openPredictionMarket(socket) {
    if (!isMarketConfigured()) return;
    try {
      this.setIncoStatus('Opening confidential betting market…', '#fde68a');
      const { matchId, players } = await readMatchSnapshot();
      if (!players || players.length < 2) {
        this.setIncoStatus('Betting needs 2+ on-chain seats — skipped', '#94a3b8');
        return;
      }
      const { address } = await openMarket(matchId, players, (msg) =>
        this.setIncoStatus(msg, '#fde68a'),
      );
      socket.emit('marketOpened', { address, matchId: String(matchId) });
      this.setIncoStatus(`Betting market open ✓ ${address.slice(0, 8)}…`, '#86efac');
    } catch (err) {
      console.warn('Prediction market skipped', err);
      this.setIncoStatus(`Betting market skipped: ${formatWalletError(err)}`, '#fbbf24');
    }
  }

  update(time) {
    if (this.stars) {
      this.stars.tilePositionX = time * 0.02;
    }
    if (this.copyFlashUntil && time > this.copyFlashUntil) {
      this.setCopyHint('tap code to copy', '#a78bfa');
      this.copyFlashUntil = 0;
    }
  }
}

import Phaser from 'phaser';
import shipImg from '../assets/ship.png';
import playerSprite from '../assets/player.png';
import starsImg from '../assets/Stars.png';
import skyGradientImg from '../assets/Skygradient.png';
import parallax1Img from '../assets/Paralax1.png';
import parallax2Img from '../assets/paralax2.png';
import parallax3Img from '../assets/paralax3.png';
import logoImg from '../assets/bannerLogo_AmongUs.png';
import { BotController } from '../bots';
import { animateMovement } from '../animation';
import {
  CAMERA_ZOOM,
  GAME_WIDTH,
  GAME_HEIGHT,
  MAX_PLAYERS,
  PLAYER_COLORS,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  PLAYER_SPRITE_HEIGHT,
  PLAYER_SPRITE_WIDTH,
  PLAYER_START_X,
  PLAYER_START_Y,
  SHIP_HEIGHT,
  SHIP_WIDTH,
  KILL_RANGE,
  KILL_COOLDOWN_MS,
  MEETING_DISCUSS_MS,
  VOTE_DURATION_MS,
  ROLE_REVEAL_MS,
} from '../constants';
import {
  playSfx,
  preloadSounds,
  SFX,
  startWalkSound,
  stopWalkSound,
  unlockAudio,
} from '../audio';
import {
  MeetingChat,
  buildPanelTexture,
  buildPlayerRowTexture,
  buildVoteCardTexture,
} from '../game/meetingUI';
import {
  assignRoles,
  checkWinCondition,
  findNearest,
  resolveVotes,
  PHASE,
} from '../game/rules';
import { movePlayer } from '../movement';
import { disconnectSocket, getSocket } from '../network';
import {
  claimWinnings,
  finalizeMarket,
  findMarket,
  isMarketConfigured,
  lockBetting,
  readMatchSnapshot,
  peekMyIncoRole,
  placeBet,
  proveWin,
  readCandidates,
  readMarket,
  revealIncoRole,
  settleMarket,
} from '../inco';
import { BettingPanel, buildBadgeTexture } from '../game/bettingUI';
import { createAmongButton, makeNearBlackTransparent } from '../ui';
import { updateQueryParameter } from '../utils';

const REVEAL_TIMEOUT_MS = 12000;

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init(data) {
    this.mode = data.mode || 'solo';
    this.room = data.room;
    this.fillBots = data.fillBots !== false;
    this.maxPlayers = data.maxPlayers || MAX_PLAYERS;
    this.isHost = Boolean(data.isHost);
    this.localId = data.localId || null;
    this.playerName = data.playerName || 'You';
    this.lobbyPlayers = data.players || [];
    this.pressedKeys = [];
    this.spaceLayers = [];
    this.entities = {};
    this.bots = [];
    this.socket = null;
    this.phase = PHASE.REVEAL;
    this.revealStartedAt = 0;
    this.serverSaysPlaying = false;
    this.yourRole = null;
    this.roleSource = data.roleSource || (data.useIncoRoles ? 'inco' : 'server');
    this.walletAddress = data.walletAddress || null;
    this.incoRoleHandle = null;
    this.killCooldownUntil = 0;
    this.hudExtras = [];
    this.overlayNodes = [];
    this.meetingChat = null;
    this.botChatTimer = null;
    this.discussEndTimer = null;
    this.voteEndTimer = null;
    this.myVote = null;
    this.votes = {};
    this.voteTallies = {};
    this.voteCards = {};
    this.spectateTargetId = null;
    this.spectatorBanner = null;
    this.meetingEndsAt = 0;
    this.voteEndsAt = 0;
    this.marketAddress = data.marketAddress || null;
    this.marketState = null;
    this.marketCandidates = [];
    this.marketBadge = null;
    this.bettingPanel = null;
    this.marketBusy = false;
    this.marketSettleTried = false;
  }

  preload() {
    if (!this.textures.exists('ship')) this.load.image('ship', shipImg);
    if (!this.textures.exists('stars')) this.load.image('stars', starsImg);
    if (!this.textures.exists('skygradient')) this.load.image('skygradient', skyGradientImg);
    if (!this.textures.exists('parallax1')) this.load.image('parallax1', parallax1Img);
    if (!this.textures.exists('parallax2')) this.load.image('parallax2', parallax2Img);
    if (!this.textures.exists('parallax3')) this.load.image('parallax3', parallax3Img);
    if (!this.textures.exists('logo')) this.load.image('logo', logoImg);
    if (!this.textures.exists('player')) {
      this.load.spritesheet('player', playerSprite, {
        frameWidth: PLAYER_SPRITE_WIDTH,
        frameHeight: PLAYER_SPRITE_HEIGHT,
      });
    }
    preloadSounds(this);
  }

  create() {
    window.history.replaceState(
      {},
      document.title,
      updateQueryParameter('room', this.room),
    );

    unlockAudio(this);
    playSfx(this, SFX.transition);
    this.isWalking = false;

    this.cameras.main.setBackgroundColor('#05040c');
    this.cameras.main.setZoom(CAMERA_ZOOM);

    this.uiCamera = this.cameras.add(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.uiCamera.setBackgroundColor('rgba(0,0,0,0)');
    this.uiCamera.transparent = true;

    this.createSpaceBackground();
    const ship = this.add.image(0, 0, 'ship').setDepth(0);
    const terrainLayers = this.createTerrainLayers();

    if (!this.anims.exists('running')) {
      this.anims.create({
        key: 'running',
        frames: this.anims.generateFrameNumbers('player'),
        frameRate: 24,
        repeat: -1,
      });
    }

    this.input.keyboard.on('keydown', (e) => {
      if (!this.pressedKeys.includes(e.code)) this.pressedKeys.push(e.code);
      if (this.isSpectating() && this.phase === PHASE.PLAYING) {
        if (e.code === 'KeyQ') this.cycleSpectateTarget(-1);
        if (e.code === 'KeyE') this.cycleSpectateTarget(1);
      }
      // Spacebar = kill while playing (chat still uses Space during discuss)
      if (e.code === 'Space' && this.phase === PHASE.PLAYING && !this.isSpectating()) {
        if (e.preventDefault) e.preventDefault();
        this.tryKill();
      }
      if (e.code === 'F9') this.toggleDebugHud();
    });
    this.input.keyboard.on('keyup', (e) => {
      this.pressedKeys = this.pressedKeys.filter((key) => key !== e.code);
    });

    // MetaMask popups steal focus, so keyup can be lost and leave the player "stuck"
    this.releaseKeys = () => {
      this.pressedKeys = [];
    };
    this.onWindowError = (e) => {
      this.reportRuntimeError((e && (e.error || e.reason)) || e);
    };
    window.addEventListener('blur', this.releaseKeys);
    window.addEventListener('error', this.onWindowError);
    window.addEventListener('unhandledrejection', this.onWindowError);
    this.events.once('shutdown', () => {
      window.removeEventListener('blur', this.releaseKeys);
      window.removeEventListener('error', this.onWindowError);
      window.removeEventListener('unhandledrejection', this.onWindowError);
    });

    if (this.mode === 'solo') {
      this.setupSolo();
      this.beginLocalMatch();
    } else {
      this.setupMultiplayer();
    }

    const hudLayers = this.createHud();
    this.actionHud = this.createActionHud();
    const worldObjects = [
      ship,
      ...terrainLayers,
      ...this.spaceLayers.map((layer) => layer.sprite),
      ...Object.values(this.entities).map((entity) => entity.sprite),
    ];

    this.cameras.main.ignore(hudLayers.concat(this.actionHud).concat(this.hudExtras));
    this.uiCamera.ignore(worldObjects);
  }

  setupSolo() {
    this.localId = 'local';
    this.spawnEntity({
      id: this.localId,
      name: this.playerName,
      colorIndex: 0,
      x: PLAYER_START_X,
      y: PLAYER_START_Y,
      isLocal: true,
      isBot: false,
    });
    for (let i = 1; i < this.maxPlayers; i += 1) {
      this.spawnBot(`bot-${i}`, i);
    }
  }

  beginLocalMatch() {
    const ids = Object.keys(this.entities);
    const roles = assignRoles(ids, 1);
    Object.keys(this.entities).forEach((id) => {
      this.entities[id].role = roles[id];
      this.entities[id].alive = true;
    });
    this.yourRole = roles[this.localId];
    this.showRoleReveal();
    this.time.delayedCall(ROLE_REVEAL_MS, () => {
      if (this.phase === PHASE.REVEAL) {
        this.phase = PHASE.PLAYING;
        this.clearOverlay();
        this.updateRoleHud();
      }
    });
  }

  setupMultiplayer() {
    this.socket = getSocket();
    if (!this.socket) {
      this.scene.start('MenuScene');
      return;
    }
    this.localId = this.socket.id || this.localId;

    // A throwing handler must not abort the round for this client
    const sock = this.socket;
    sock.errorSink = (err) => this.reportRuntimeError(err);
    if (!sock.handlersGuarded) {
      sock.handlersGuarded = true;
      const rawOn = sock.on.bind(sock);
      sock.on = (event, handler) =>
        rawOn(event, (...args) => {
          try {
            return handler(...args);
          } catch (err) {
            if (sock.errorSink) sock.errorSink(err);
            else console.error('[game] socket handler error', err);
            return undefined;
          }
        });
    }

    this.socket.on('gameState', (state) => {
      this.syncGameState(state);
      if (state.yourRole) {
        this.yourRole = state.yourRole;
        this.updateRoleHud();
      }
    });

    this.socket.on('playerMoved', ({ id, x, y }) => {
      const entity = this.entities[id];
      if (!entity || entity.isLocal || entity.isBot) return;
      if (entity.sprite.x > x) entity.sprite.flipX = true;
      else if (entity.sprite.x < x) entity.sprite.flipX = false;
      entity.sprite.x = x;
      entity.sprite.y = y;
      entity.moving = true;
    });

    this.socket.on('playerMoveEnd', ({ id }) => {
      const entity = this.entities[id];
      if (!entity || entity.isLocal || entity.isBot) return;
      entity.moving = false;
    });

    this.socket.on('playerLeft', ({ id }) => {
      playSfx(this, SFX.leave);
      this.removeEntity(id);
    });

    this.socket.on('rolesAssigned', (payload) => {
      this.applyRolesPayload(payload);
    });

    this.socket.on('gamePhase', ({ phase }) => {
      this.phase = phase;
      if (phase === PHASE.PLAYING) {
        this.serverSaysPlaying = true;
        this.clearOverlay();
        this.updateRoleHud();
      }
    });

    // Socket.io may reconnect with a new id while the player signs in MetaMask
    this.socket.on('connect', () => {
      this.rebindLocalId(this.socket.id);
    });

    this.socket.on('playerKilled', ({ targetId, x, y }) => {
      this.applyKill(targetId, x, y);
    });

    this.socket.on('meetingStart', (payload) => {
      this.openDiscussUI(payload);
    });

    this.socket.on('meetingChat', (message) => {
      if (this.meetingChat && message && message.senderId !== this.localId) {
        this.meetingChat.pushMessage(message);
      }
    });

    this.socket.on('votePhase', (payload) => {
      this.openVoteUI(payload);
    });

    this.socket.on('voteState', (payload) => {
      this.applyVoteState(payload);
    });

    this.socket.on('meetingResult', (payload) => {
      this.showMeetingResult(payload);
    });

    this.socket.on('resumeGame', () => {
      this.phase = PHASE.PLAYING;
      this.clearOverlay();
      this.myVote = null;
      this.votes = {};
      this.voteTallies = {};
      this.enterSpectatorIfDead();
    });

    this.socket.on('gameOver', (payload) => {
      this._lastGameOver = payload;
      this.showGameOver(payload);
    });

    this.socket.on('marketState', ({ marketAddress, bettingOpen }) => {
      this.attachMarket(marketAddress, bettingOpen);
    });

    this.socket.on('bettingClosed', () => {
      // Only the host can close the on-chain window; everyone else just re-reads it
      if (this.isHost && this.marketAddress) {
        lockBetting(this.marketAddress, (msg) => this.setMarketNotice(msg, '#7dd3fc'))
          .then(() => this.refreshMarket())
          .catch((err) => console.warn('[market] lock failed', err));
      } else {
        this.refreshMarket();
      }
    });

    this.socket.emit('requestMarketState');

    if (this.marketAddress) this.attachMarket(this.marketAddress, true);
    else this.startMarketDiscovery();
    if (this.roleSource === 'inco') this.showRevealButton();

    if (this.lobbyPlayers.length) {
      this.syncGameState({ players: this.lobbyPlayers });
    }

    this.socket.emit('requestGameState', {
      fillBots: this.fillBots,
      maxPlayers: this.maxPlayers,
    });

    // Host registers full roster (humans + local bots) for roles
    this.time.delayedCall(400, () => {
      if (this.isHost || this.mode === 'solo') {
        this.registerRosterWithServer();
      }
    });
  }

  // ── Confidential impostor market ────────────────────────────────────────

  /// Don't rely on the host's broadcast reaching us — the factory is the source of truth.
  async discoverMarket() {
    if (this.marketAddress || !isMarketConfigured()) return;
    try {
      const { matchId } = await readMatchSnapshot();
      const address = await findMarket(matchId);
      if (address) this.attachMarket(address, true);
      else this.setMarketBadgePending('waiting for host');
    } catch (err) {
      console.warn('[market] discovery failed', err);
    }
  }

  startMarketDiscovery() {
    if (this.roleSource !== 'inco' || !isMarketConfigured()) return;
    this.ensureBettingHud();
    this.setMarketBadgePending('looking for market…');
    this.discoverMarket();
    if (this.marketDiscoveryTimer) return;
    this.marketDiscoveryTimer = this.time.addEvent({
      delay: 8000,
      repeat: 14,
      callback: () => {
        if (this.marketAddress) {
          this.marketDiscoveryTimer.remove(false);
          this.marketDiscoveryTimer = null;
          return;
        }
        this.discoverMarket();
      },
    });
  }

  setMarketBadgePending(hint) {
    if (!this.marketBadge || this.marketAddress) return;
    buildBadgeTexture(this, 'bet_badge', 250, 72, {
      phase: 'pending',
      potEth: '0',
      bets: 0,
      hint,
    });
    this.marketBadge.setTexture('bet_badge');
  }

  attachMarket(address, bettingOpen) {
    if (!address || !isMarketConfigured()) return;
    if (this.marketAddress === address && this.marketCandidates.length) {
      this.refreshMarket();
      return;
    }
    this.marketAddress = address;
    this.bettingOpen = bettingOpen !== false;
    this.ensureBettingHud();
    readCandidates(address)
      .then((candidates) => {
        this.marketCandidates = candidates;
        return this.refreshMarket();
      })
      .catch((err) => console.warn('[market] candidates failed', err));

    if (!this.marketPoll) {
      this.marketPoll = this.time.addEvent({
        delay: 12000,
        loop: true,
        callback: () => this.refreshMarket(),
      });
    }
  }

  ensureBettingHud() {
    if (this.marketBadge) return;
    const width = 250;
    const height = 72;
    const key = buildBadgeTexture(this, 'bet_badge', width, height, {
      phase: 'betting',
      potEth: '0',
      bets: 0,
    });
    this.marketBadge = this.add
      .image(GAME_WIDTH - width / 2 - 14, 92, key)
      .setScrollFactor(0)
      .setDepth(130)
      .setInteractive({ useHandCursor: true });
    this.marketBadge.on('pointerdown', () => this.toggleBettingPanel());
    this.hudExtras.push(this.marketBadge);
    this.cameras.main.ignore([this.marketBadge]);

    this.input.keyboard.on('keydown-B', () => {
      if (this.meetingChat && this.meetingChat.isTyping && this.meetingChat.isTyping()) return;
      this.toggleBettingPanel();
    });
  }

  async refreshMarket() {
    if (!this.marketAddress) return null;
    try {
      const viewer = this.walletAddress || null;
      const state = await readMarket(this.marketAddress, viewer);
      // Base Sepolia RPCs lag behind a confirmed tx; don't let a stale read undo what we just did
      if (this.marketOptimistic) {
        if (this.marketOptimistic.myBetPlaced && !state.myBetPlaced) {
          state.myBetPlaced = true;
          state.myStakeEth = this.marketOptimistic.myStakeEth || state.myStakeEth;
        } else {
          this.marketOptimistic = null;
        }
      }
      const impostorEntity = Object.values(this.entities).find(
        (e) =>
          state.impostor &&
          e.walletAddress &&
          e.walletAddress.toLowerCase() === state.impostor.toLowerCase(),
      );
      state.impostorName = impostorEntity ? impostorEntity.name : null;
      // Game-over screen: even if settle never ran, show claim/settle UI instead of the bet form
      if (this.phase === PHASE.GAME_OVER && state.phase === 'betting') {
        state.forceClaimUi = true;
      }
      this.marketState = state;
      this.updateMarketBadge();
      return state;
    } catch (err) {
      console.warn('[market] refresh failed', err);
      return null;
    }
  }

  updateMarketBadge() {
    if (!this.marketBadge || !this.marketState) return;
    buildBadgeTexture(this, 'bet_badge', 250, 72, this.marketState);
    this.marketBadge.setTexture('bet_badge');
  }

  /** Market candidates joined with the in-game roster, so bettors see names not wallets. */
  bettingSnapshot() {
    const state = this.marketState || {
      phase: 'betting',
      potEth: '0',
      bets: 0,
      myBetPlaced: false,
    };
    const mine = (this.walletAddress || '').toLowerCase();
    const candidates = this.marketCandidates.map((c) => {
      const entity = Object.values(this.entities).find(
        (e) => e.walletAddress && e.walletAddress.toLowerCase() === c.address,
      );
      return {
        index: c.index,
        address: c.address,
        name: entity ? entity.name : `${c.address.slice(0, 6)}…${c.address.slice(-4)}`,
        colorIndex: entity ? entity.colorIndex || 0 : c.index,
        alive: entity ? entity.alive !== false : true,
        isSelf: Boolean(mine) && c.address === mine,
      };
    });
    return { candidates, state };
  }

  toggleBettingPanel() {
    if (!this.marketAddress) {
      this.setMarketNotice(
        'No prediction market for this round yet — the host opens it after roles are dealt.',
        '#fbbf24',
      );
      this.discoverMarket();
      return;
    }
    if (!this.bettingPanel) {
      this.bettingPanel = new BettingPanel(this, {
        snapshot: () => this.bettingSnapshot(),
        refresh: () => this.refreshMarket(),
        onBet: async (index, stake, onStatus) => {
          const result = await placeBet(this.marketAddress, index, stake, onStatus);
          this.marketOptimistic = { myBetPlaced: true, myStakeEth: String(stake) };
          return result;
        },
        onAction: (action, onStatus) => this.runMarketAction(action, onStatus),
      });
    }
    if (this.bettingPanel.isOpen()) {
      this.bettingPanel.hide();
      return;
    }
    this.refreshMarket().then(() => {
      if (this.bettingPanel) this.bettingPanel.show(this.marketState);
    });
  }

  runMarketAction(action, onStatus) {
    if (action === 'prove') return proveWin(this.marketAddress, onStatus);
    if (action === 'finalize') return finalizeMarket(this.marketAddress, onStatus);
    if (action === 'claim') return claimWinnings(this.marketAddress, onStatus);
    if (action === 'settle') {
      // Wallet tip is optional — settleMarket scans candidates on-chain when missing
      const wallet =
        (this.marketState && this.marketState.impostor) ||
        (this._lastGameOver && this._lastGameOver.impostorWallet) ||
        null;
      return settleMarket(this.marketAddress, wallet, onStatus);
    }
    return Promise.reject(new Error(`Unknown market action ${action}`));
  }

  /// Anyone can settle. If the server forgot impostorWallet, we scan candidates on-chain.
  async settleMarketIfHost(payload) {
    if (!this.marketAddress || this.marketSettleTried) return;
    const wallet =
      (payload && payload.impostorWallet) ||
      (payload &&
        payload.impostorId &&
        this.entities[payload.impostorId] &&
        this.entities[payload.impostorId].walletAddress) ||
      null;
    this.marketSettleTried = true;
    try {
      await settleMarket(this.marketAddress, wallet, (msg) =>
        this.setMarketNotice(msg, '#7dd3fc'),
      );
      await this.refreshMarket();
      this.setMarketNotice('Market settled — press [B] to prove pick / claim', '#86efac');
      if (this.bettingPanel && !this.bettingPanel.isOpen()) {
        this.toggleBettingPanel();
      }
    } catch (err) {
      console.warn('[market] settle failed', err);
      this.marketSettleTried = false;
      this.setMarketNotice(`Market settle failed: ${(err && err.message) || err}`, '#f87171');
    }
  }

  setMarketNotice(message, color = '#a5b4fc') {
    if (!this.marketNotice) {
      this.marketNotice = this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT - 24, '', {
          fontFamily: 'Arial',
          fontSize: '13px',
          color,
          align: 'center',
          wordWrap: { width: GAME_WIDTH - 80 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(320);
      this.cameras.main.ignore([this.marketNotice]);
    }
    this.marketNotice.setText(message).setColor(color);
  }

  rebindLocalId(newId) {
    if (!newId || newId === this.localId) return;
    const oldId = this.localId;
    this.localId = newId;
    const entity = this.entities[oldId];
    if (entity) {
      delete this.entities[oldId];
      entity.id = newId;
      entity.isLocal = true;
      this.entities[newId] = entity;
    }
    Object.values(this.entities).forEach((e) => {
      e.isLocal = e.id === newId;
    });
  }

  registerRosterWithServer() {
    if (!this.socket) return;
    const players = Object.values(this.entities).map((e, index) => ({
      id: e.id,
      name: e.name,
      x: e.sprite.x,
      y: e.sprite.y,
      isBot: e.isBot,
      colorIndex: index,
    }));
    this.socket.emit('registerRoster', { players });
  }

  applyRolesPayload(payload) {
    if (payload.roleSource) this.roleSource = payload.roleSource;

    (payload.players || []).forEach((p) => {
      if (!this.entities[p.id]) {
        this.spawnEntity({
          id: p.id,
          name: p.name,
          colorIndex: p.colorIndex || 0,
          x: p.x != null ? p.x : PLAYER_START_X,
          y: p.y != null ? p.y : PLAYER_START_Y,
          isLocal: p.id === this.localId,
          isBot: Boolean(p.isBot),
        });
      }
      this.entities[p.id].alive = p.alive !== false;
      if (p.role) this.entities[p.id].role = p.role;
      if (p.walletAddress) this.entities[p.id].walletAddress = p.walletAddress;
    });

    if (payload.allRoles) {
      Object.keys(payload.allRoles).forEach((id) => {
        if (this.entities[id]) this.entities[id].role = payload.allRoles[id];
      });
    }

    if (this.roleSource === 'inco') {
      // Decrypting needs a wallet signature, so it must never hold the round hostage:
      // play starts now and the player reveals on their own terms
      this.phase = PHASE.PLAYING;
      this.serverSaysPlaying = true;
      this.showRevealButton();
      this.startMarketDiscovery();
      this.refreshUiIgnore();
      return;
    }

    this.yourRole = payload.yourRole;
    if (this.entities[this.localId]) this.entities[this.localId].role = payload.yourRole;
    if (payload.impostorId && this.yourRole === 'impostor') {
      Object.keys(this.entities).forEach((id) => {
        this.entities[id].role = id === payload.impostorId ? 'impostor' : 'crewmate';
      });
    }
    this.phase = PHASE.REVEAL;
    this.showRoleReveal();
    this.refreshUiIgnore();
  }

  /// Inco roles are opt-in: the player clicks to decrypt, the round runs regardless.
  showRevealButton() {
    if (this.revealBtn || this.yourRole) return;
    this.revealBtn = createAmongButton(
      this,
      120,
      GAME_HEIGHT - 44,
      'REVEAL MY ROLE',
      () => this.peekAndClaimIncoRole(),
      {
        width: 200,
        height: 44,
        fontSize: '15px',
        fill: '#7c3aed',
        stroke: '#c4b5fd',
      },
    );
    this.revealBtn.setScrollFactor(0).setDepth(140);
    this.hudExtras.push(this.revealBtn);
    this.cameras.main.ignore([this.revealBtn]);

    this.revealHint = this.add
      .text(120, GAME_HEIGHT - 74, 'Your role is sealed on-chain', {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: '#c4b5fd',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(140);
    this.hudExtras.push(this.revealHint);
    this.cameras.main.ignore([this.revealHint]);
  }

  setRevealHint(message, color = '#c4b5fd') {
    if (this.revealHint) this.revealHint.setText(message).setColor(color);
  }

  hideRevealButton() {
    if (this.revealBtn) {
      this.revealBtn.destroy();
      this.revealBtn = null;
    }
    if (this.revealHint) {
      this.revealHint.destroy();
      this.revealHint = null;
    }
  }

  async peekAndClaimIncoRole() {
    if (this.peekBusy) return;
    this.peekBusy = true;
    this.setRevealHint('Decrypting via Inco…', '#fde68a');
    try {
      const peeked = await peekMyIncoRole();
      this.hideRevealButton();
      this.yourRole = peeked.role;
      this.incoRoleHandle = peeked.handle;
      if (this.entities[this.localId]) this.entities[this.localId].role = peeked.role;
      if (this.socket) {
        this.socket.emit('claimIncoRole', {
          role: peeked.role,
          handle: peeked.handle,
        });
      }
      this.showRoleReveal();
      this.updateRoleHud();
      this.time.delayedCall(ROLE_REVEAL_MS, () => {
        if (this.phase === PHASE.REVEAL) {
          this.phase = PHASE.PLAYING;
          this.updateRoleHud();
        }
        this.clearOverlay();
      });
    } catch (err) {
      console.error('Inco peek failed', err);
      this.yourRole = null;
      // Play continues either way — the button just goes back to being clickable
      if (this.phase === PHASE.REVEAL) this.phase = PHASE.PLAYING;
      const msg = String((err && err.message) || 'decrypt failed').slice(0, 60);
      this.setRevealHint(`${msg} — tap to retry`, '#fca5a5');
    } finally {
      this.peekBusy = false;
    }
  }

  syncGameState(state) {
    const players = state.players || [];
    const seen = new Set();

    players.forEach((player, index) => {
      seen.add(player.id);
      if (!this.entities[player.id]) {
        this.spawnEntity({
          id: player.id,
          name: player.name,
          colorIndex: player.colorIndex != null ? player.colorIndex : index,
          x: player.x != null ? player.x : PLAYER_START_X + index * 24,
          y: player.y != null ? player.y : PLAYER_START_Y + index * 12,
          isLocal: player.id === this.localId,
          isBot: Boolean(player.isBot),
        });
      } else if (!this.entities[player.id].isLocal) {
        if (player.x != null) this.entities[player.id].sprite.x = player.x;
        if (player.y != null) this.entities[player.id].sprite.y = player.y;
      }
      if (player.alive === false) this.markDead(player.id, false);
      if (player.role) this.entities[player.id].role = player.role;
      if (player.walletAddress) this.entities[player.id].walletAddress = player.walletAddress;
    });

    Object.keys(this.entities).forEach((id) => {
      if (!seen.has(id) && !String(id).startsWith('bot-')) this.removeEntity(id);
    });

    if (this.fillBots) {
      const humans = players.filter((p) => !p.isBot).length;
      const desiredBots = Math.max(0, this.maxPlayers - humans);
      const existingBots = Object.keys(this.entities).filter((id) =>
        String(id).startsWith('bot-'),
      );
      while (existingBots.length < desiredBots) {
        const index = existingBots.length + 1;
        const botId = `bot-${index}`;
        this.spawnBot(botId, humans + existingBots.length);
        existingBots.push(botId);
      }
    }

    this.refreshUiIgnore();
  }

  spawnBot(id, colorIndex) {
    const offsets = [
      { x: 40, y: 30 },
      { x: -50, y: 45 },
      { x: 70, y: -20 },
      { x: -30, y: 60 },
      { x: 55, y: 70 },
      { x: -70, y: 20 },
    ];
    const offset = offsets[(colorIndex - 1) % offsets.length] || { x: 20, y: 20 };
    const entity = this.spawnEntity({
      id,
      name: `Bot ${colorIndex}`,
      colorIndex,
      x: PLAYER_START_X + offset.x,
      y: PLAYER_START_Y + offset.y,
      isLocal: false,
      isBot: true,
    });
    this.bots.push(new BotController(entity.sprite));
    return entity;
  }

  spawnEntity({ id, name, colorIndex, x, y, isLocal, isBot }) {
    if (this.entities[id]) return this.entities[id];
    const sprite = this.add.sprite(x, y, 'player');
    sprite.displayHeight = PLAYER_HEIGHT;
    sprite.displayWidth = PLAYER_WIDTH;
    sprite.setDepth(10);
    sprite.setTint(PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]);
    const entity = {
      id,
      name,
      sprite,
      isLocal,
      isBot,
      moving: false,
      movedLastFrame: false,
      alive: true,
      role: null,
      colorIndex,
    };
    this.entities[id] = entity;
    return entity;
  }

  removeEntity(id) {
    const entity = this.entities[id];
    if (!entity) return;
    entity.sprite.destroy();
    delete this.entities[id];
    this.bots = this.bots.filter((bot) => bot.sprite !== entity.sprite);
  }

  markDead(id, playSound = true) {
    const entity = this.entities[id];
    if (!entity || entity.alive === false) return;
    entity.alive = false;
    entity.sprite.stop();
    if (id === this.localId) {
      // Local ghost/spectator — upright, translucent
      entity.sprite.setAlpha(0.45);
      entity.sprite.setAngle(0);
      this.enterSpectatorIfDead();
    } else {
      entity.sprite.setAlpha(0.35);
      entity.sprite.setAngle(90);
    }
    if (playSound) playSfx(this, SFX.kill);
  }

  isSpectating() {
    const local = this.entities[this.localId];
    return Boolean(local && local.alive === false && this.phase !== PHASE.GAME_OVER);
  }

  enterSpectatorIfDead() {
    const local = this.entities[this.localId];
    if (!local || local.alive !== false || this.phase === PHASE.GAME_OVER) {
      this.clearSpectatorHud();
      return;
    }
    if (this.killBtn) this.killBtn.setVisible(false);
    if (this.cooldownText) this.cooldownText.setVisible(false);
    const living = this.aliveList();
    if (living.length) {
      const stillValid = living.some((e) => e.id === this.spectateTargetId);
      if (!stillValid) this.spectateTargetId = living[0].id;
    } else {
      this.spectateTargetId = null;
    }
    if (this.phase === PHASE.PLAYING) this.showSpectatorHud();
    else this.clearSpectatorHud();
  }

  showSpectatorHud() {
    this.clearSpectatorHud();
    const banner = this.add
      .text(GAME_WIDTH / 2, 28, 'SPECTATING — you were voted out / killed. Watch only.', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '18px',
        color: '#fca5a5',
        backgroundColor: '#1a0510',
        padding: { x: 14, y: 8 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(150);
    const hint = this.add
      .text(GAME_WIDTH / 2, 58, 'Press Q / E to switch camera target', {
        fontFamily: 'Arial',
        fontSize: '13px',
        color: '#c4b5fd',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(150);
    this.spectatorBanner = [banner, hint];
    this.cameras.main.ignore(this.spectatorBanner);
  }

  clearSpectatorHud() {
    if (this.spectatorBanner) {
      this.spectatorBanner.forEach((n) => n && n.destroy && n.destroy());
      this.spectatorBanner = null;
    }
  }

  cycleSpectateTarget(dir) {
    const living = this.aliveList();
    if (!living.length) return;
    let idx = living.findIndex((e) => e.id === this.spectateTargetId);
    if (idx < 0) idx = 0;
    else idx = (idx + dir + living.length) % living.length;
    this.spectateTargetId = living[idx].id;
    playSfx(this, SFX.click);
  }

  applyKill(targetId, x, y) {
    const entity = this.entities[targetId];
    if (!entity) return;
    if (x != null) entity.sprite.x = x;
    if (y != null) entity.sprite.y = y;
    this.markDead(targetId, true);
  }

  refreshUiIgnore() {
    if (!this.uiCamera) return;
    const worldObjects = [
      ...this.spaceLayers.map((layer) => layer.sprite),
      ...Object.values(this.entities).map((entity) => entity.sprite),
    ];
    this.uiCamera.ignore(worldObjects);
  }

  createSpaceBackground() {
    this.spaceLayers = [];
    const sky = this.add
      .image(0, 0, 'skygradient')
      .setDepth(-30)
      .setDisplaySize(SHIP_WIDTH * 2.2, SHIP_HEIGHT * 2.2);
    this.spaceLayers.push({ sprite: sky, factor: 0, drift: 0, tile: false });
    const stars = this.add
      .tileSprite(0, 0, SHIP_WIDTH * 2.2, SHIP_HEIGHT * 2.2, 'stars')
      .setDepth(-20)
      .setAlpha(0.95);
    this.spaceLayers.push({ sprite: stars, factor: 0.25, drift: 0.1, tile: true });
  }

  createTerrainLayers() {
    const terrainY = SHIP_HEIGHT / 2 + 120;
    return [
      { key: 'parallax3', y: terrainY + 40, scroll: 0.15, alpha: 0.45, height: 260 },
      { key: 'parallax2', y: terrainY + 90, scroll: 0.25, alpha: 0.65, height: 220 },
      { key: 'parallax1', y: terrainY + 140, scroll: 0.4, alpha: 0.85, height: 200 },
    ].map((layer) =>
      this.add
        .tileSprite(0, layer.y, SHIP_WIDTH * 1.8, layer.height, layer.key)
        .setDepth(-12)
        .setScrollFactor(layer.scroll, layer.scroll)
        .setAlpha(layer.alpha),
    );
  }

  buildHudBarTexture(roleLabel, roleColor) {
    const key = 'hud_top_bar';
    if (this.textures.exists(key)) this.textures.remove(key);
    const w = 420;
    const h = 36;
    const canvas = this.textures.createCanvas(key, w, h);
    const ctx = canvas.getContext();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(8, 10, 18, 0.82)';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(10, 1);
    ctx.lineTo(w - 10, 1);
    ctx.quadraticCurveTo(w - 1, 1, w - 1, 10);
    ctx.lineTo(w - 1, h - 10);
    ctx.quadraticCurveTo(w - 1, h - 1, w - 10, h - 1);
    ctx.lineTo(10, h - 1);
    ctx.quadraticCurveTo(1, h - 1, 1, h - 10);
    ctx.lineTo(1, 10);
    ctx.quadraticCurveTo(1, 1, 10, 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const modeLabel = this.mode === 'solo' ? 'BULL PLAY' : 'ROOM';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${modeLabel}  ${String(this.room || '').toUpperCase()}`, 14, h / 2);

    ctx.fillStyle = '#14f195';
    ctx.font = '600 12px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.playerName || 'Crewmate', w / 2, h / 2);

    ctx.fillStyle = roleColor || '#cbd5e1';
    ctx.font = 'bold 11px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(roleLabel || 'ROLE ???', w - 14, h / 2);

    canvas.refresh();
    return key;
  }

  createHud() {
    const logoKey = makeNearBlackTransparent(this, 'logo');
    const logo = this.add
      .image(14, 10, logoKey)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(100)
      .setScale(0.32)
      .setAlpha(0.9);

    const hudKey = this.buildHudBarTexture('ROLE ???', '#cbd5e1');
    this.hudBar = this.add
      .image(GAME_WIDTH / 2, 22, hudKey)
      .setScrollFactor(0)
      .setDepth(101);

    // Keep a tiny alias for older role updates
    this.roleText = {
      setText: (t) => {
        const impostor = /impostor/i.test(t);
        const label = impostor ? 'IMPOSTOR' : /crew/i.test(t) ? 'CREWMATE' : 'ROLE ???';
        const color = impostor ? '#f87171' : /crew/i.test(t) ? '#34d399' : '#cbd5e1';
        const key = this.buildHudBarTexture(label, color);
        if (this.hudBar && this.hudBar.active) this.hudBar.setTexture(key);
      },
      setColor: () => {},
    };

    const menuBtn = createAmongButton(this, 70, GAME_HEIGHT - 28, 'MENU', () => this.returnToMenu(), {
      width: 100,
      height: 34,
      fontSize: '13px',
      fill: '#111827',
      hover: '#1f2937',
      stroke: '#64748b',
      hoverStroke: '#94a3b8',
    });
    menuBtn.setScrollFactor(0);
    menuBtn.setDepth(101);
    this.input.keyboard.on('keydown-ESC', () => this.returnToMenu());
    this.input.once('pointerdown', () => unlockAudio(this));

    return [logo, this.hudBar, menuBtn];
  }

  createActionHud() {
    this.killBtn = createAmongButton(
      this,
      GAME_WIDTH - 120,
      GAME_HEIGHT - 96,
      'KILL  [SPACE]',
      () => this.tryKill(),
      {
        width: 180,
        height: 56,
        fontSize: '18px',
        fill: '#7f1d1d',
        hover: '#991b1b',
        stroke: '#f87171',
        hoverStroke: '#fecaca',
        sound: SFX.kill,
      },
    );
    this.killBtn.setScrollFactor(0);
    this.killBtn.setDepth(120);
    this.killBtn.setVisible(false);

    this.cooldownText = this.add
      .text(GAME_WIDTH - 120, GAME_HEIGHT - 52, '', {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: '#fca5a5',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(121)
      .setVisible(false);

    this.killReadyHint = this.add
      .text(GAME_WIDTH - 120, GAME_HEIGHT - 34, 'SPACE', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '13px',
        color: '#fecaca',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(122)
      .setVisible(false)
      .setAlpha(0.3);

    this.killBlinkTween = null;

    return [this.killBtn, this.cooldownText, this.killReadyHint];
  }

  setKillBlink(active) {
    if (!this.killReadyHint) return;
    if (active) {
      this.killReadyHint.setVisible(true);
      if (!this.killBlinkTween) {
        this.killBlinkTween = this.tweens.add({
          targets: [this.killReadyHint, this.killBtn],
          alpha: { from: 0.5, to: 1 },
          duration: 420,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    } else if (this.killBlinkTween) {
      this.killBlinkTween.stop();
      this.killBlinkTween = null;
      this.killReadyHint.setVisible(false);
      this.killReadyHint.setAlpha(0.3);
    }
  }

  updateRoleHud() {
    if (!this.roleText) return;
    if (!this.yourRole) {
      this.roleText.setText('Role: ???');
      return;
    }
    const impostor = this.yourRole === 'impostor';
    const incoTag = this.roleSource === 'inco' ? ' (Inco FHE)' : '';
    this.roleText.setText(
      impostor ? `Role: IMPOSTOR${incoTag}` : `Role: CREWMATE${incoTag}`,
    );
  }

  showRoleReveal() {
    this.clearOverlay();
    // A slow Inco decrypt can finish after the round already started — don't re-freeze the player
    if (!this.serverSaysPlaying) {
      this.phase = PHASE.REVEAL;
      this.revealStartedAt = this.time.now;
    }
    playSfx(this, SFX.achievement);
    const impostor = this.yourRole === 'impostor';
    this.updateRoleHud();

    // Compact top toast — no giant center splash
    const fromInco = this.roleSource === 'inco';
    const toastKey = buildPanelTexture(this, `role_toast_${Date.now()}`, 400, 56, {
      stroke: impostor ? '#f87171' : '#34d399',
      fill: impostor ? 'rgba(40, 10, 16, 0.94)' : 'rgba(8, 28, 22, 0.94)',
      radius: 12,
      title: impostor ? 'You are the Impostor' : 'You are a Crewmate',
      titleColor: impostor ? '#fca5a5' : '#6ee7b7',
      titleSize: 16,
      titleAlign: 'center',
      subtitle: fromInco
        ? 'Decrypted via Inco attested peek'
        : impostor
          ? 'Kill quietly. Blend in.'
          : 'Find the Impostor.',
      subtitleColor: fromInco ? '#7dd3fc' : '#94a3b8',
      subtitleSize: 11,
    });
    const toast = this.add.image(GAME_WIDTH / 2, 58, toastKey).setScrollFactor(0).setDepth(210);
    this.overlayNodes = [toast];
    this.cameras.main.ignore(this.overlayNodes);
  }

  clearOverlay() {
    if (this.meetingChat) {
      this.meetingChat.destroy();
      this.meetingChat = null;
    }
    if (this.botChatTimer) {
      this.botChatTimer.remove(false);
      this.botChatTimer = null;
    }
    this.overlayNodes.forEach((n) => n && n.destroy && n.destroy());
    this.overlayNodes = [];
    this.discussTimerText = null;
    this.voteTimerText = null;
    this.voteStatusText = null;
    this.discussTimerIsImage = false;
    this.voteTimerIsImage = false;
    this.voteStatusIsImage = false;
    this._lastDiscussLeft = null;
    this._lastVoteLeft = null;
    this.voteCards = {};
  }

  clearMeetingTimers() {
    if (this.discussEndTimer) {
      this.discussEndTimer.remove(false);
      this.discussEndTimer = null;
    }
    if (this.voteEndTimer) {
      this.voteEndTimer.remove(false);
      this.voteEndTimer = null;
    }
  }

  scheduleDiscussEnd(discussMs) {
    if (this.discussEndTimer) {
      this.discussEndTimer.remove(false);
      this.discussEndTimer = null;
    }
    const wait = Math.max(1000, discussMs || MEETING_DISCUSS_MS);
    this.discussEndTimer = this.time.delayedCall(wait, () => {
      this.discussEndTimer = null;
      if (this.phase !== PHASE.DISCUSS) return;
      if (this.mode === 'solo') {
        const players = Object.values(this.entities)
          .filter((e) => e.alive !== false)
          .map((e) => ({ id: e.id, name: e.name, colorIndex: e.colorIndex }));
        this.openVoteUI({ durationMs: VOTE_DURATION_MS, players });
        this.castBotVotesLocal();
        this.refreshVoteCards();
      } else if (this.isHost && this.socket) {
        this.socket.emit('startVote');
      }
    });
  }

  scheduleVoteEnd(durationMs) {
    if (this.voteEndTimer) {
      this.voteEndTimer.remove(false);
      this.voteEndTimer = null;
    }
    const wait = Math.max(1000, durationMs || VOTE_DURATION_MS);
    this.voteEndTimer = this.time.delayedCall(wait, () => {
      this.voteEndTimer = null;
      if (this.phase !== PHASE.VOTE) return;
      if (this.mode === 'solo') {
        this.resolveLocalMeeting();
      } else if (this.isHost && this.socket) {
        this.socket.emit('resolveMeeting');
      }
    });
  }

  tryKill() {
    if (this.phase !== PHASE.PLAYING) return;
    const local = this.entities[this.localId];
    if (!local || !local.alive || local.role !== 'impostor') return;
    if (this.time.now < this.killCooldownUntil) return;

    const targets = Object.values(this.entities).filter(
      (e) => e.alive && e.id !== local.id && e.role !== 'impostor',
    );
    const nearest = findNearest(
      { x: local.sprite.x, y: local.sprite.y },
      targets.map((t) => ({ id: t.id, x: t.sprite.x, y: t.sprite.y })),
      KILL_RANGE,
    );
    if (!nearest) return;

    this.killCooldownUntil = this.time.now + KILL_COOLDOWN_MS;
    const victim = this.entities[nearest.id];

    if (this.mode === 'solo') {
      this.applyKill(victim.id, victim.sprite.x, victim.sprite.y);
      this.startLocalMeeting(local.id, 'Dead body reported');
    } else if (this.socket) {
      this.socket.emit('kill', {
        targetId: victim.id,
        x: victim.sprite.x,
        y: victim.sprite.y,
      });
    }
  }

  startLocalMeeting(reporterId, reason) {
    stopWalkSound(this);
    this.isWalking = false;
    playSfx(this, SFX.alarm);
    this.votes = {};
    this.myVote = null;
    this.openDiscussUI({
      reporterId,
      reason,
      discussMs: MEETING_DISCUSS_MS,
      players: Object.values(this.entities).map((e) => ({
        id: e.id,
        name: e.name,
        alive: e.alive,
        colorIndex: e.colorIndex,
      })),
    });
  }

  openDiscussUI(payload) {
    this.clearOverlay();
    this.clearMeetingTimers();
    this.phase = PHASE.DISCUSS;
    this.pressedKeys = [];
    stopWalkSound(this);
    playSfx(this, SFX.alarm);
    const discussMs = payload.discussMs || MEETING_DISCUSS_MS;
    this.meetingEndsAt = this.time.now + discussMs;

    const dim = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05010f, 0.86)
      .setScrollFactor(0)
      .setDepth(200);

    // Fully baked header — avoids overlapping Phaser text under Scale.FIT
    const headerKey = buildPanelTexture(this, `meet_header_${Date.now()}`, 640, 78, {
      stroke: '#f87171',
      fill: 'rgba(40, 8, 20, 0.97)',
      radius: 16,
      title: 'EMERGENCY MEETING',
      titleColor: '#fca5a5',
      titleSize: 28,
      titleAlign: 'center',
      subtitle: payload.reason || 'Dead body reported',
      subtitleColor: '#fecaca',
      subtitleSize: 14,
    });
    const header = this.add.image(GAME_WIDTH / 2, 52, headerKey).setScrollFactor(0).setDepth(201);

    this.discussTimerText = this.add
      .image(
        GAME_WIDTH / 2,
        112,
        buildPanelTexture(this, `meet_timer_${Date.now()}`, 260, 40, {
          stroke: '#34d399',
          fill: 'rgba(8, 28, 22, 0.96)',
          radius: 12,
          title: `Discussion · ${Math.ceil(discussMs / 1000)}s`,
          titleColor: '#6ee7b7',
          titleSize: 15,
          titleAlign: 'center',
        }),
      )
      .setScrollFactor(0)
      .setDepth(220);
    this.discussTimerIsImage = true;

    const rosterKey = buildPanelTexture(this, `meet_roster_${Date.now()}`, 380, 480, {
      title: 'PLAYERS',
      titleColor: '#c4b5fd',
      titleSize: 14,
      stroke: 'rgba(167, 139, 250, 0.55)',
      fill: 'rgba(12, 10, 24, 0.96)',
      lineWidth: 2,
    });
    const roster = this.add.image(240, 400, rosterKey).setScrollFactor(0).setDepth(201);

    this.overlayNodes = [dim, header, this.discussTimerText, roster];

    const players = payload.players || [];
    players.forEach((p, i) => {
      const rowKey = buildPlayerRowTexture(this, `meet_row_${p.id}_${i}`, 340, 36, p);
      const row = this.add
        .image(240, 195 + i * 42, rowKey)
        .setScrollFactor(0)
        .setDepth(202);
      this.overlayNodes.push(row);
    });

    try {
      this.meetingChat = new MeetingChat(this, {
        x: 900,
        y: 400,
        width: 500,
        height: 480,
        onSend: (message) => {
          if (this.mode === 'solo') return;
          if (this.socket) this.socket.emit('meetingChat', { text: message.text });
        },
      });
      this.cameras.main.ignore(this.overlayNodes.concat(this.meetingChat.getNodes()));
      this.startBotChat(players);
    } catch (err) {
      console.error('Meeting chat failed to open', err);
      this.meetingChat = null;
      this.cameras.main.ignore(this.overlayNodes);
    }

    this.scheduleDiscussEnd(discussMs);
  }

  startBotChat(players) {
    const lines = [
      'I saw someone near cafeteria...',
      'Who was near the body?',
      'Not me bro',
      'Sus ngl',
      'Vote carefully',
      'I was doing tasks',
      'Red is acting weird',
      'Could be a bot impostor',
      'Skip if unsure',
      'Watch the kill cooldown next round',
    ];
    const bots = (players || []).filter((p) => {
      const e = this.entities[p.id];
      return e && e.isBot && e.alive !== false;
    });
    if (!bots.length || !this.meetingChat) return;

    let count = 0;
    this.botChatTimer = this.time.addEvent({
      delay: 2200,
      loop: true,
      callback: () => {
        if (this.phase !== PHASE.DISCUSS || !this.meetingChat) return;
        const bot = bots[Math.floor(Math.random() * bots.length)];
        const text = lines[Math.floor(Math.random() * lines.length)];
        const message = {
          id: `botchat-${Date.now()}`,
          name: bot.name,
          text,
          system: false,
          senderId: bot.id,
        };
        if (this.mode === 'solo') {
          this.meetingChat.pushMessage(message);
        } else if (this.isHost && this.socket) {
          this.socket.emit('botMeetingChat', { name: bot.name, text });
        }
        count += 1;
        if (count >= 5 && this.botChatTimer) {
          this.botChatTimer.remove(false);
          this.botChatTimer = null;
        }
      },
    });
  }

  openVoteUI(payload) {
    this.clearOverlay();
    if (this.discussEndTimer) {
      this.discussEndTimer.remove(false);
      this.discussEndTimer = null;
    }
    this.phase = PHASE.VOTE;
    playSfx(this, SFX.modalOpen);
    const durationMs = payload.durationMs || VOTE_DURATION_MS;
    this.voteEndsAt = this.time.now + durationMs;
    this.myVote = null;
    this.votes = {};
    this.voteTallies = { skip: 0 };
    this.voteCards = {};
    this.voteCandidates = payload.players || [];

    const dim = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x070012, 0.92)
      .setScrollFactor(0)
      .setDepth(200);

    const headerKey = buildPanelTexture(this, `vote_header_${Date.now()}`, 560, 64, {
      stroke: 'rgba(167, 139, 250, 0.7)',
      fill: 'rgba(18, 12, 36, 0.97)',
      title: 'VOTE',
      titleColor: '#e9d5ff',
      titleSize: 22,
      titleAlign: 'center',
      subtitle: this.isSpectating() ? 'Spectating — cannot vote' : 'Tap a player · live tallies',
      subtitleColor: '#94a3b8',
      subtitleSize: 12,
    });
    const header = this.add.image(GAME_WIDTH / 2, 44, headerKey).setScrollFactor(0).setDepth(201);

    this.voteTimerText = this.add
      .image(
        GAME_WIDTH / 2,
        100,
        buildPanelTexture(this, `vote_timer_${Date.now()}`, 280, 38, {
          stroke: '#34d399',
          fill: 'rgba(8, 28, 22, 0.96)',
          radius: 12,
          title: `Voting · ${Math.ceil(durationMs / 1000)}s`,
          titleColor: '#6ee7b7',
          titleSize: 14,
          titleAlign: 'center',
        }),
      )
      .setScrollFactor(0)
      .setDepth(220);
    this.voteTimerIsImage = true;

    this.voteStatusText = this.add
      .image(
        GAME_WIDTH / 2,
        138,
        buildPanelTexture(this, `vote_status_0`, 220, 30, {
          stroke: 'rgba(167, 139, 250, 0.35)',
          fill: 'rgba(12, 10, 24, 0.9)',
          radius: 10,
          title: '0 votes cast',
          titleColor: '#a78bfa',
          titleSize: 12,
          titleAlign: 'center',
        }),
      )
      .setScrollFactor(0)
      .setDepth(220);
    this.voteStatusIsImage = true;

    this.overlayNodes = [dim, header, this.voteTimerText, this.voteStatusText];

    const local = this.entities[this.localId];
    const canVote = local && local.alive !== false;
    const candidates = this.voteCandidates;

    candidates.forEach((p, i) => {
      this.voteTallies[p.id] = 0;
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = GAME_WIDTH / 2 - 210 + col * 420;
      const y = 200 + row * 72;
      const cardKey = buildVoteCardTexture(this, `vote_card_${p.id}`, 360, 58, p, 0, false);
      const card = this.add.image(x, y, cardKey).setScrollFactor(0).setDepth(202);
      if (canVote) {
        card.setInteractive({ useHandCursor: true });
        card.on('pointerup', () => this.castVote(p.id));
        card.on('pointerover', () => card.setScale(1.03));
        card.on('pointerout', () => card.setScale(1));
      } else {
        card.setAlpha(0.75);
      }
      this.voteCards[p.id] = { image: card, player: p, x, y };
      this.overlayNodes.push(card);
    });

    const skipKey = buildVoteCardTexture(
      this,
      `vote_card_skip`,
      360,
      58,
      { name: 'SKIP VOTE', colorIndex: 6 },
      0,
      false,
    );
    const skip = this.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT - 70, skipKey)
      .setScrollFactor(0)
      .setDepth(202);
    if (canVote) {
      skip.setInteractive({ useHandCursor: true });
      skip.on('pointerup', () => this.castVote('skip'));
      skip.on('pointerover', () => skip.setScale(1.03));
      skip.on('pointerout', () => skip.setScale(1));
    } else {
      skip.setAlpha(0.75);
    }
    this.voteCards.skip = {
      image: skip,
      player: { name: 'SKIP VOTE', colorIndex: 6 },
      x: GAME_WIDTH / 2,
      y: GAME_HEIGHT - 70,
    };
    this.overlayNodes.push(skip);
    this.cameras.main.ignore(this.overlayNodes);

    this.scheduleVoteEnd(durationMs);
    if (this.mode !== 'solo' && this.isHost) {
      this.time.delayedCall(800, () => this.sendBotVotesToServer(candidates));
    }
    if (this.mode === 'solo') this.refreshVoteCards();
  }

  applyVoteState(payload) {
    if (!payload) return;
    this.votes = payload.votes || this.votes;
    this.voteTallies = payload.tallies || this.voteTallies;
    if (this.votes[this.localId] != null) this.myVote = this.votes[this.localId];
    playSfx(this, SFX.pop);
    this.refreshVoteCards();
    this.updateVoteStatusLabel(
      payload.votedCount != null ? payload.votedCount : Object.keys(this.votes).length,
      payload.aliveCount != null ? payload.aliveCount : this.aliveList().length,
    );
  }

  updateVoteStatusLabel(cast, alive) {
    if (!this.voteStatusText || !this.voteStatusText.active) return;
    const label = `${cast} / ${alive} votes`;
    if (this.voteStatusIsImage) {
      const key = buildPanelTexture(this, `vote_status_${cast}_${alive}`, 220, 30, {
        stroke: 'rgba(167, 139, 250, 0.35)',
        fill: 'rgba(12, 10, 24, 0.9)',
        radius: 10,
        title: label,
        titleColor: '#a78bfa',
        titleSize: 12,
        titleAlign: 'center',
      });
      this.voteStatusText.setTexture(key);
    } else if (this.voteStatusText.setText) {
      this.voteStatusText.setText(label);
    }
  }

  refreshVoteCards() {
    if (this.phase !== PHASE.VOTE) return;
    // Recompute tallies for solo
    if (this.mode === 'solo') {
      const tallies = { skip: 0 };
      (this.voteCandidates || []).forEach((p) => {
        tallies[p.id] = 0;
      });
      Object.keys(this.votes || {}).forEach((voterId) => {
        const choice = this.votes[voterId];
        if (!choice || choice === 'skip') tallies.skip += 1;
        else if (tallies[choice] != null) tallies[choice] += 1;
      });
      this.voteTallies = tallies;
      this.updateVoteStatusLabel(Object.keys(this.votes).length, this.aliveList().length);
    }

    Object.keys(this.voteCards || {}).forEach((id) => {
      const entry = this.voteCards[id];
      if (!entry || !entry.image || !entry.image.active) return;
      const count = (this.voteTallies && this.voteTallies[id]) || 0;
      const selected = this.myVote === id;
      const key = buildVoteCardTexture(
        this,
        `vote_card_live_${id}_${count}_${selected ? 1 : 0}`,
        360,
        58,
        entry.player,
        count,
        selected,
      );
      entry.image.setTexture(key);
    });
  }

  castVote(targetId) {
    if (this.phase !== PHASE.VOTE || this.myVote != null) return;
    const local = this.entities[this.localId];
    if (!local || local.alive === false) return;
    this.myVote = targetId;
    playSfx(this, SFX.confirm);
    this.votes[this.localId] = targetId;
    this.refreshVoteCards();

    if (this.mode === 'solo') {
      if (Object.keys(this.votes).length >= this.aliveList().length) {
        this.resolveLocalMeeting();
      }
    } else if (this.socket) {
      this.socket.emit('castVote', { targetId });
    }
  }

  castBotVotesLocal() {
    const alive = this.aliveList();
    const livingIds = alive.map((e) => e.id);
    alive.forEach((bot) => {
      if (!bot.isBot) return;
      // Impostor bot avoids voting self; crewmates random
      let choice = 'skip';
      if (Math.random() > 0.25) {
        const options = livingIds.filter((id) => id !== bot.id);
        if (bot.role === 'impostor') {
          const crewOptions = options.filter((id) => this.entities[id].role !== 'impostor');
          choice = crewOptions[Math.floor(Math.random() * crewOptions.length)] || 'skip';
        } else {
          choice = options[Math.floor(Math.random() * options.length)] || 'skip';
        }
      }
      this.votes[bot.id] = choice;
    });
    this.refreshVoteCards();
  }

  sendBotVotesToServer(candidates) {
    if (!this.socket || !this.isHost) return;
    const votes = {};
    const ids = (candidates || []).map((c) => c.id);
    Object.values(this.entities).forEach((bot) => {
      if (!bot.isBot || bot.alive === false) return;
      let choice = 'skip';
      if (Math.random() > 0.3 && ids.length) {
        const options = ids.filter((id) => id !== bot.id);
        choice = options[Math.floor(Math.random() * options.length)] || 'skip';
      }
      votes[bot.id] = choice;
    });
    this.socket.emit('botVotes', { votes });
  }

  resolveLocalMeeting() {
    if (this.phase !== PHASE.VOTE && this.phase !== PHASE.DISCUSS) return;
    this.phase = PHASE.RESULTS;
    const aliveIds = this.aliveList().map((e) => e.id);
    // ensure bots voted
    this.aliveList().forEach((e) => {
      if (e.isBot && this.votes[e.id] == null) this.votes[e.id] = 'skip';
    });
    const result = resolveVotes(this.votes, aliveIds);
    let wasImpostor = false;
    if (result.ejectedId && this.entities[result.ejectedId]) {
      this.markDead(result.ejectedId, true);
      wasImpostor = this.entities[result.ejectedId].role === 'impostor';
    }
    const reason = result.ejectedId
      ? wasImpostor
        ? `${this.entities[result.ejectedId].name} was the Impostor`
        : `${this.entities[result.ejectedId].name} was not the Impostor`
      : result.reason;

    this.showMeetingResult({
      ejectedId: result.ejectedId,
      reason,
      wasImpostor,
      tallies: result.tallies,
    });

    this.time.delayedCall(3500, () => {
      const players = Object.values(this.entities).map((e) => ({
        id: e.id,
        role: e.role,
        alive: e.alive,
      }));
      const win = checkWinCondition(players);
      if (win.over) {
        this.showGameOver(win);
      } else {
        this.phase = PHASE.PLAYING;
        this.clearOverlay();
        this.votes = {};
        this.myVote = null;
        this.enterSpectatorIfDead();
      }
    });
  }

  showMeetingResult(payload) {
    this.clearMeetingTimers();
    this.clearOverlay();
    this.phase = PHASE.RESULTS;
    playSfx(this, payload.wasImpostor ? SFX.launch : SFX.message);

    if (payload.ejectedId) this.markDead(payload.ejectedId, false);

    // Inco: host triggers on-chain reveal for the ejected human (trustless was-impostor)
    if (
      this.roleSource === 'inco' &&
      this.isHost &&
      payload.ejectedId &&
      this.entities[payload.ejectedId] &&
      !this.entities[payload.ejectedId].isBot &&
      this.entities[payload.ejectedId].walletAddress
    ) {
      this.revealEjectedInco(payload.ejectedId);
    } else if (
      this.roleSource === 'inco' &&
      this.isHost &&
      payload.ejectedId &&
      this.entities[payload.ejectedId] &&
      !this.entities[payload.ejectedId].isBot
    ) {
      // Wallet may only be on local client — try reveal with host wallet if they know address from server sync
      this.revealEjectedInco(payload.ejectedId);
    }

    const localEjected = payload.ejectedId === this.localId;
    const overlay = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.88)
      .setScrollFactor(0)
      .setDepth(200);
    const title = this.add
      .text(
        GAME_WIDTH / 2,
        GAME_HEIGHT / 2 - 50,
        localEjected ? 'YOU WERE EJECTED' : payload.ejectedId ? 'EJECTED' : 'NO EJECT',
        {
          fontFamily: 'Arial Black, Impact, Arial',
          fontSize: '42px',
          color: '#f5f3ff',
        },
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    const reason = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20, payload.reason || '', {
        fontFamily: 'Arial',
        fontSize: '22px',
        color: payload.wasImpostor ? '#34d399' : '#fca5a5',
        align: 'center',
        wordWrap: { width: 900 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    // Show final tallies
    const tallyLines = Object.keys(payload.tallies || {})
      .filter((id) => (payload.tallies[id] || 0) > 0)
      .map((id) => {
        const name =
          id === 'skip'
            ? 'Skip'
            : (this.entities[id] && this.entities[id].name) || id;
        return `${name}: ${payload.tallies[id]}`;
      })
      .join('   ·   ');
    const talliesText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 70, tallyLines || 'No votes', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: '#c4b5fd',
        align: 'center',
        wordWrap: { width: 1000 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    const ghostHint = localEjected
      ? this.add
          .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 110, 'You will spectate the rest of the match', {
            fontFamily: 'Arial',
            fontSize: '16px',
            color: '#94a3b8',
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(201)
      : null;

    this.overlayNodes = [overlay, title, reason, talliesText];
    if (ghostHint) this.overlayNodes.push(ghostHint);
    this.cameras.main.ignore(this.overlayNodes);
  }

  async revealEjectedInco(playerId) {
    try {
      // Prefer wallet address if we stored it; otherwise roleHandleOf needs address from claim
      const entity = this.entities[playerId];
      const address = entity && entity.walletAddress;
      if (!address) {
        console.warn('No wallet address for ejected player; skip on-chain reveal');
        return;
      }
      const result = await revealIncoRole(address);
      if (this.socket) {
        this.socket.emit('incoRoleRevealed', {
          playerId,
          role: result.role,
          wasImpostor: result.wasImpostor,
        });
      }
      if (entity) entity.role = result.role;
    } catch (err) {
      console.error('Inco reveal failed', err);
    }
  }

  showGameOver(payload) {
    this.clearMeetingTimers();
    this.clearSpectatorHud();
    this.clearOverlay();
    this.phase = PHASE.GAME_OVER;
    stopWalkSound(this);
    playSfx(this, payload.winner === 'crewmate' ? SFX.launch : SFX.alarm);
    const crewWin = payload.winner === 'crewmate';
    const overlay = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.9)
      .setScrollFactor(0)
      .setDepth(220);
    const title = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 50, crewWin ? 'CREWMATES WIN' : 'IMPOSTOR WINS', {
        fontFamily: 'Arial Black, Impact, Arial',
        fontSize: '54px',
        color: crewWin ? '#34d399' : '#ef4444',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(221);
    const reason = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20, payload.reason || '', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#e9d5ff',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(221);
    const btn = createAmongButton(
      this,
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2 + 100,
      'BACK TO MENU',
      () => this.returnToMenu(),
      { width: 280, height: 56, fontSize: '20px' },
    );
    btn.setScrollFactor(0);
    btn.setDepth(222);
    this.overlayNodes = [overlay, title, reason, btn];

    if (this.marketAddress) {
      const marketBtn = createAmongButton(
        this,
        GAME_WIDTH / 2,
        GAME_HEIGHT / 2 + 168,
        'IMPOSTOR MARKET',
        () => this.toggleBettingPanel(),
        {
          width: 280,
          height: 48,
          fontSize: '17px',
          fill: '#0ea5e9',
          stroke: '#7dd3fc',
        },
      );
      marketBtn.setScrollFactor(0);
      marketBtn.setDepth(222);
      this.overlayNodes.push(marketBtn);
      this.settleMarketIfHost(payload);
    }

    this.cameras.main.ignore(this.overlayNodes);
  }

  aliveList() {
    return Object.values(this.entities).filter((e) => e.alive !== false);
  }

  updateKillButton(time) {
    const local = this.entities[this.localId];
    const show =
      this.phase === PHASE.PLAYING &&
      local &&
      local.alive &&
      (local.role === 'impostor' || this.yourRole === 'impostor');
    this.killBtn.setVisible(Boolean(show));
    this.cooldownText.setVisible(Boolean(show));
    if (!show) {
      this.setKillBlink(false);
      if (this.killReadyHint) this.killReadyHint.setVisible(false);
      return;
    }

    const remaining = Math.max(0, this.killCooldownUntil - time);
    if (remaining > 0) {
      this.cooldownText.setText(`Cooldown ${Math.ceil(remaining / 1000)}s`);
      this.killBtn.setAlpha(0.45);
      this.setKillBlink(false);
    } else {
      const targets = Object.values(this.entities).filter(
        (e) => e.alive && e.id !== local.id && e.role !== 'impostor',
      );
      const nearest = findNearest(
        { x: local.sprite.x, y: local.sprite.y },
        targets.map((t) => ({ id: t.id, x: t.sprite.x, y: t.sprite.y })),
        KILL_RANGE,
      );
      this.cooldownText.setText(nearest ? 'SPACE to kill' : 'Get closer · then SPACE');
      if (nearest) {
        this.setKillBlink(true);
      } else {
        this.setKillBlink(false);
        this.killBtn.setAlpha(0.55);
      }
    }
  }

  updateBotImpostor(time) {
    if (this.phase !== PHASE.PLAYING) return;
    if (this.mode !== 'solo' && !this.isHost) return;

    Object.values(this.entities).forEach((bot) => {
      if (!bot.isBot || !bot.alive || bot.role !== 'impostor') return;
      if (!bot.nextKillAt) bot.nextKillAt = time + KILL_COOLDOWN_MS;
      if (time < bot.nextKillAt) return;

      const targets = Object.values(this.entities).filter(
        (e) => e.alive && e.id !== bot.id && e.role !== 'impostor',
      );
      const nearest = findNearest(
        { x: bot.sprite.x, y: bot.sprite.y },
        targets.map((t) => ({ id: t.id, x: t.sprite.x, y: t.sprite.y })),
        KILL_RANGE,
      );
      if (!nearest) return;

      bot.nextKillAt = time + KILL_COOLDOWN_MS;
      const victim = this.entities[nearest.id];
      if (this.mode === 'solo') {
        this.applyKill(victim.id, victim.sprite.x, victim.sprite.y);
        this.startLocalMeeting(bot.id, 'Dead body reported');
      } else if (this.socket) {
        this.socket.emit('botKill', {
          killerId: bot.id,
          targetId: victim.id,
          x: victim.sprite.x,
          y: victim.sprite.y,
        });
      }
    });
  }

  returnToMenu() {
    stopWalkSound(this);
    this.clearSpectatorHud();
    this.clearMeetingTimers();
    playSfx(this, SFX.menuOut);
    disconnectSocket();
    this.socket = null;
    this.scene.start('MenuScene');
  }

  updateSpaceBackground(time) {
    const cam = this.cameras.main;
    this.spaceLayers.forEach((layer) => {
      if (!layer.tile) return;
      layer.sprite.tilePositionX =
        cam.scrollX * layer.factor + time * layer.drift * 0.02;
      layer.sprite.tilePositionY = cam.scrollY * layer.factor * 0.65;
    });
  }

  // Phaser stops scheduling frames if update throws, which looks like a frozen screen
  update(time) {
    try {
      this.updateFrame(time);
    } catch (err) {
      this.reportRuntimeError(err);
    }
  }

  toggleDebugHud() {
    if (this.debugHud) {
      this.debugHud.destroy();
      this.debugHud = null;
      return;
    }
    this.debugHud = this.add
      .text(8, 8, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#a5f3fc',
        backgroundColor: '#04121c',
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(400);
    this.cameras.main.ignore([this.debugHud]);
  }

  updateDebugHud() {
    if (!this.debugHud) return;
    const local = this.entities[this.localId];
    this.debugHud.setText(
      [
        `phase=${this.phase} serverPlaying=${this.serverSaysPlaying}`,
        `localId=${this.localId} localEntity=${local ? 'yes' : 'MISSING'}`,
        `alive=${local ? local.alive : 'n/a'} role=${this.yourRole || 'none'}`,
        `entities=${Object.keys(this.entities).length} keys=${this.pressedKeys.join(',') || '-'}`,
        `socket=${this.socket && this.socket.connected ? 'connected' : 'DISCONNECTED'} src=${this.roleSource}`,
      ].join('\n'),
    );
  }

  reportRuntimeError(err) {
    console.error('[game] update error', err);
    const msg = (err && (err.stack || err.message)) || String(err);
    if (this.errorBanner) {
      this.errorBanner.setText(`Game error: ${String(msg).slice(0, 200)}`);
      return;
    }
    this.errorBanner = this.add
      .text(GAME_WIDTH / 2, 20, `Game error: ${String(msg).slice(0, 200)}`, {
        fontFamily: 'Arial',
        fontSize: '13px',
        color: '#fecaca',
        backgroundColor: '#450a0a',
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 60 },
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(400);
    this.cameras.main.ignore([this.errorBanner]);
  }

  updateFrame(time) {
    // Safety net: a lost gamePhase event or slow decrypt must never strand a player
    // Arm the timer even if rolesAssigned never arrived, or a guest waits here forever
    if (this.mode !== 'solo' && this.phase === PHASE.REVEAL && !this.revealStartedAt) {
      this.revealStartedAt = time;
    }
    if (
      this.mode !== 'solo' &&
      this.phase === PHASE.REVEAL &&
      this.revealStartedAt &&
      time - this.revealStartedAt > REVEAL_TIMEOUT_MS
    ) {
      this.phase = PHASE.PLAYING;
      this.clearOverlay();
      this.updateRoleHud();
    }

    const inMeeting =
      this.phase === PHASE.DISCUSS ||
      this.phase === PHASE.VOTE ||
      this.phase === PHASE.RESULTS ||
      this.phase === PHASE.REVEAL ||
      this.phase === PHASE.GAME_OVER;

    const local = this.entities[this.localId];
    if (local && local.alive !== false && this.phase === PHASE.PLAYING) {
      this.cameras.main.centerOn(local.sprite.x, local.sprite.y);
      const moved = movePlayer(this.pressedKeys, local.sprite);
      animateMovement(this.pressedKeys, local.sprite);

      if (moved) {
        if (!this.isWalking) {
          this.isWalking = true;
          startWalkSound(this);
        }
      } else if (this.isWalking) {
        this.isWalking = false;
        stopWalkSound(this);
      }

      if (this.socket) {
        if (moved) {
          this.socket.emit('move', { x: local.sprite.x, y: local.sprite.y });
          local.movedLastFrame = true;
        } else if (local.movedLastFrame) {
          this.socket.emit('moveEnd');
          local.movedLastFrame = false;
        }
      }
    } else {
      if (this.isWalking) {
        this.isWalking = false;
        stopWalkSound(this);
      }
      // Spectators watch living players; otherwise keep camera on local corpse
      if (this.isSpectating() && this.phase === PHASE.PLAYING) {
        const target =
          this.entities[this.spectateTargetId] || this.aliveList()[0] || local;
        if (target) this.cameras.main.centerOn(target.sprite.x, target.sprite.y);
      } else if (local) {
        this.cameras.main.centerOn(local.sprite.x, local.sprite.y);
      }
    }

    if (!inMeeting) {
      this.bots.forEach((bot) => {
        const owner = Object.values(this.entities).find((e) => e.sprite === bot.sprite);
        if (!owner || owner.alive === false) return;
        const moving = bot.update(time);
        if (moving && !bot.sprite.anims.isPlaying) bot.sprite.play('running');
        if (!moving && bot.sprite.anims.isPlaying) bot.sprite.stop('running');
      });
      this.updateBotImpostor(time);
    }

    Object.values(this.entities).forEach((entity) => {
      if (entity.isLocal || entity.isBot) return;
      if (!entity.alive) return;
      if (entity.moving && !entity.sprite.anims.isPlaying) entity.sprite.play('running');
      else if (!entity.moving && entity.sprite.anims.isPlaying) entity.sprite.stop('running');
    });

    if (this.discussTimerText && this.phase === PHASE.DISCUSS) {
      const left = Math.max(0, Math.ceil((this.meetingEndsAt - this.time.now) / 1000));
      if (this.discussTimerIsImage) {
        if (this._lastDiscussLeft !== left) {
          this._lastDiscussLeft = left;
          const key = buildPanelTexture(this, `meet_timer_tick_${left}`, 260, 40, {
            stroke: '#34d399',
            fill: 'rgba(8, 28, 22, 0.96)',
            radius: 12,
            title: `Discussion · ${left}s`,
            titleColor: '#6ee7b7',
            titleSize: 15,
            titleAlign: 'center',
          });
          this.discussTimerText.setTexture(key);
        }
      } else if (this.discussTimerText.setText) {
        this.discussTimerText.setText(`Discussion · ${left}s`);
      }
    }
    if (this.voteTimerText && this.phase === PHASE.VOTE) {
      const left = Math.max(0, Math.ceil((this.voteEndsAt - this.time.now) / 1000));
      if (this.voteTimerIsImage) {
        if (this._lastVoteLeft !== left) {
          this._lastVoteLeft = left;
          const key = buildPanelTexture(this, `vote_timer_tick_${left}`, 280, 38, {
            stroke: '#34d399',
            fill: 'rgba(8, 28, 22, 0.96)',
            radius: 12,
            title: `Voting · ${left}s`,
            titleColor: '#6ee7b7',
            titleSize: 14,
            titleAlign: 'center',
          });
          this.voteTimerText.setTexture(key);
        }
      } else if (this.voteTimerText.setText) {
        this.voteTimerText.setText(`Voting · ${left}s`);
      }
    }

    this.updateKillButton(time);
    this.updateSpaceBackground(time);
    this.updateDebugHud();
  }
}

import Phaser from 'phaser';
import starsImg from '../assets/Stars.png';
import skyGradientImg from '../assets/Skygradient.png';
import parallax1Img from '../assets/Paralax1.png';
import parallax2Img from '../assets/paralax2.png';
import parallax3Img from '../assets/paralax3.png';
import logoImg from '../assets/bannerLogo_AmongUs.png';
import menuLabImg from '../assets/menuLab.png';
import menuHallArtImg from '../assets/menuHallArt.png';
import menuPlayerImg from '../assets/menuPlayer.png';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  MAX_PLAYERS,
} from '../constants';
import { playSfx, preloadSounds, SFX, unlockAudio } from '../audio';
import {
  connectWallet,
  formatWalletError,
  getCachedAddress,
  INCO_CONFIG,
  isIncoConfigured,
  isWalletAvailable,
  onChainChanged,
  switchToDefaultIncoChain,
  switchToIncoNetwork,
  targetNetworkLabel,
  walletDiagnostics,
} from '../inco';
import {
  createAmongButton,
  createArtFrame,
  createMenuBackground,
  createNamePrompt,
  createTextCard,
  makeNearBlackTransparent,
} from '../ui';
import { getRandomString, updateQueryParameter } from '../utils';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  preload() {
    if (!this.textures.exists('stars')) this.load.image('stars', starsImg);
    if (!this.textures.exists('skygradient')) this.load.image('skygradient', skyGradientImg);
    if (!this.textures.exists('parallax1')) this.load.image('parallax1', parallax1Img);
    if (!this.textures.exists('parallax2')) this.load.image('parallax2', parallax2Img);
    if (!this.textures.exists('parallax3')) this.load.image('parallax3', parallax3Img);
    if (!this.textures.exists('logo')) this.load.image('logo', logoImg);
    if (!this.textures.exists('menuLab')) this.load.image('menuLab', menuLabImg);
    if (!this.textures.exists('menuHallArt')) this.load.image('menuHallArt', menuHallArtImg);
    if (!this.textures.exists('menuPlayer')) this.load.image('menuPlayer', menuPlayerImg);
    preloadSounds(this);
  }

  create() {
    this.stars = createMenuBackground(this, GAME_WIDTH, GAME_HEIGHT);
    this.promptOpen = false;
    this.walletAddress = getCachedAddress();
    // Confidential roles ON by default when contract is configured
    this.useIncoRoles = false;
    playSfx(this, SFX.menuIn);

    this.input.once('pointerdown', () => unlockAudio(this));

    createArtFrame(this, 176, 424, 'menuLab', 230, { depth: 2, alpha: 0.9 });
    createArtFrame(this, GAME_WIDTH - 176, 424, 'menuHallArt', 230, {
      depth: 2,
      alpha: 0.9,
    });

    const logoKey = makeNearBlackTransparent(this, 'logo');
    const logo = this.add.image(GAME_WIDTH / 2, 84, logoKey).setDepth(6);
    logo.setScale(360 / logo.width);

    createTextCard(this, GAME_WIDTH / 2, 168, 640, 68, {
      key: 'menu_header_card',
      panel: false,
      depth: 6,
      lines: [
        {
          text: 'BARELY AMONG JS',
          size: 24,
          color: '#f5f3ff',
          font: 'Arial Black, Impact, Arial, sans-serif',
        },
        { text: 'CONFIDENTIAL ROLES · POWERED BY INCO', size: 14, color: '#5eead4' },
      ],
    });

    // On-chain Inco status + wallet (plan: soft-gate confidential roles)
    this.incoReady = false;
    try {
      this.incoReady = isIncoConfigured();
    } catch (err) {
      console.warn('Inco bundle not ready', err);
    }
    // Default: Inco mode on + auto-switch MetaMask to Base Sepolia / Anvil
    if (this.incoReady) {
      this.useIncoRoles = true;
      this.watchChain();
      this.autoSwitchNetwork();
    }

    // Status + steps share one card so the two lines can never float off the panel
    this.statusCard = createTextCard(this, GAME_WIDTH / 2, 246, 700, 86, {
      key: 'menu_status_card',
      fill: 'rgba(8, 14, 32, 0.94)',
      stroke: '#38bdf8',
      depth: 6,
      lines: this.statusCardLines(),
    });

    this.walletBtn = createAmongButton(
      this,
      GAME_WIDTH / 2 - 145,
      330,
      this.walletAddress ? this.shortAddr(this.walletAddress) : 'CONNECT WALLET',
      () => this.onConnectWallet(),
      {
        width: 270,
        height: 50,
        fontSize: '16px',
        fill: '#312e81',
        hover: '#4338ca',
        stroke: '#a78bfa',
        hoverStroke: '#c4b5fd',
        sound: SFX.click,
      },
    );

    this.incoToggle = createAmongButton(
      this,
      GAME_WIDTH / 2 + 145,
      330,
      this.incoToggleLabel(),
      () => this.onToggleInco(),
      {
        width: 270,
        height: 50,
        fontSize: '15px',
        fill: '#0e3a4a',
        hover: '#155e75',
        stroke: '#38bdf8',
        hoverStroke: '#7dd3fc',
        sound: SFX.pop,
      },
    );

    const crew = this.add
      .image(132, GAME_HEIGHT - 62, 'menuPlayer')
      .setOrigin(0.5, 1)
      .setScale(1.3)
      .setTint(0x9945ff)
      .setDepth(5);
    this.tweens.add({
      targets: crew,
      y: crew.y - 12,
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const crew2 = this.add
      .image(GAME_WIDTH - 132, GAME_HEIGHT - 62, 'menuPlayer')
      .setOrigin(0.5, 1)
      .setScale(1.25)
      .setTint(0x14f195)
      .setFlipX(true)
      .setDepth(5);
    this.tweens.add({
      targets: crew2,
      y: crew2.y - 10,
      duration: 1800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: 200,
    });

    createAmongButton(this, GAME_WIDTH / 2, 412, 'HOST GAME', () => {
      this.askNameThen((playerName) => {
        const confidential = this.useIncoRoles && this.incoReady;
        if (confidential && !this.walletAddress) {
          this.refreshStatus(
            'Turn INCO ROLES ON, then CONNECT WALLET before hosting',
            '#fbbf24',
          );
          playSfx(this, SFX.cancel);
          return;
        }
        this.enterLobby({
          mode: 'host',
          room: getRandomString(5),
          fillBots: confidential ? false : true,
          maxPlayers: MAX_PLAYERS,
          isHost: true,
          playerName,
          useIncoRoles: confidential,
          walletAddress: this.walletAddress,
        });
      });
    });

    createAmongButton(this, GAME_WIDTH / 2, 492, 'JOIN ROOM', () => {
      this.askNameThen((playerName) => {
        this.openJoinPanel(playerName);
      });
    });

    createAmongButton(
      this,
      GAME_WIDTH / 2,
      572,
      'BULL PLAY',
      () => {
        this.askNameThen((playerName) => {
          playSfx(this, SFX.launch);
          this.scene.start('GameScene', {
            mode: 'solo',
            room: `solo-${getRandomString(4)}`,
            fillBots: true,
            maxPlayers: MAX_PLAYERS,
            isHost: true,
            playerName,
            roleSource: 'server',
          });
        });
      },
      {
        fill: '#065f46',
        hover: '#047857',
        stroke: '#14f195',
        hoverStroke: '#99f6e4',
        textColor: '#ecfdf5',
        sound: SFX.pop,
      },
    );

    createTextCard(this, GAME_WIDTH / 2, GAME_HEIGHT - 40, 660, 42, {
      key: 'menu_footer_card',
      fill: 'rgba(8, 14, 32, 0.92)',
      stroke: '#14f195',
      radius: 14,
      depth: 6,
      lines: [
        {
          text: this.incoReady
            ? `FHE roles ready · ${INCO_CONFIG.network} · ${this.shortAddr(INCO_CONFIG.contractAddress)}`
            : 'arrow keys to move  •  share the room code to invite',
          size: 14,
          color: this.incoReady ? '#a7f3d0' : '#e9d5ff',
        },
      ],
    });

    this.refreshStatus();
  }

  shortAddr(addr) {
    if (!addr) return '';
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }

  stepsLabel() {
    const a = this.useIncoRoles ? '✓' : '1';
    const b = this.walletAddress ? '✓' : '2';
    return `${a} INCO ROLES ON   →   ${b} CONNECT WALLET   →   3 HOST + START`;
  }

  walletStatusLabel() {
    if (!this.incoReady) {
      return 'Inco not configured — run deploy:local then npm run build:inco';
    }
    if (this.useIncoRoles && this.walletAddress) {
      return `Ready: ${this.shortAddr(this.walletAddress)} · confidential FHE roles enabled`;
    }
    if (this.useIncoRoles && !this.walletAddress) {
      return `INCO ON — CONNECT WALLET (auto-switches to ${targetNetworkLabel()})`;
    }
    if (this.walletAddress && !this.useIncoRoles) {
      return `Wallet ${this.shortAddr(this.walletAddress)} — next: turn INCO ROLES ON`;
    }
    return `INCO ON by default · CONNECT WALLET → auto ${targetNetworkLabel()}`;
  }

  async autoSwitchNetwork() {
    if (!isWalletAvailable()) return;
    try {
      const diag = await walletDiagnostics();
      if (!diag.hasWallet) return;

      if (!diag.isMetaMask) {
        this.refreshStatus(
          `Active wallet is ${diag.walletName}, not MetaMask — it may block the network switch`,
          '#fbbf24',
        );
      }
      if (diag.onTarget) {
        this.refreshStatus(`On ${targetNetworkLabel()} ✓ (${diag.walletName})`, '#86efac');
        return;
      }
      // Only auto-switch when the site is already authorized; otherwise wait for CONNECT
      if (!getCachedAddress()) return;
      await switchToDefaultIncoChain();
      this.refreshStatus(`On ${targetNetworkLabel()} ✓`, '#86efac');
    } catch (err) {
      console.warn('auto network switch', err);
      this.refreshStatus(formatWalletError(err), '#fde68a');
    }
  }

  /** Keep status honest when the user switches networks in the wallet UI. */
  watchChain() {
    try {
      this.unwatchChain = onChainChanged(async (chainId) => {
        const target = String(chainId || '').toLowerCase();
        const diag = await walletDiagnostics();
        if (diag.onTarget) {
          this.refreshStatus(`On ${targetNetworkLabel()} ✓`, '#86efac');
        } else {
          this.refreshStatus(
            `Wallet on chain ${target} — needs ${targetNetworkLabel()}`,
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

  statusCardLines(overrideText, overrideColor) {
    const text = overrideText || this.walletStatusLabel();
    const color =
      overrideColor ||
      (this.useIncoRoles && this.walletAddress
        ? '#86efac'
        : this.useIncoRoles || this.walletAddress
          ? '#fde68a'
          : '#f8fafc');
    return [
      { text, size: 15, color },
      {
        text: this.stepsLabel(),
        size: 13,
        weight: 'normal',
        color: this.useIncoRoles && this.walletAddress ? '#a7f3d0' : '#cbd5e1',
      },
    ];
  }

  refreshStatus(overrideText, overrideColor) {
    if (!this.statusCard) return;
    this.statusCard.setLines(this.statusCardLines(overrideText, overrideColor));
  }

  incoToggleLabel() {
    if (!this.incoReady) return 'INCO: N/A';
    return this.useIncoRoles ? 'INCO ROLES: ON' : 'INCO ROLES: OFF';
  }

  async onConnectWallet() {
    unlockAudio(this);
    if (!isWalletAvailable()) {
      this.refreshStatus('Install MetaMask (or another injected wallet)', '#f87171');
      playSfx(this, SFX.cancel);
      return;
    }
    try {
      this.refreshStatus(`Connecting + switching to ${targetNetworkLabel()}…`, '#fde68a');
      // Always auto-switch to Base Sepolia / Anvil on connect
      await switchToIncoNetwork((msg) => this.refreshStatus(msg, '#fde68a'));
      this.walletAddress = await connectWallet({ switchNetwork: true });
      this.walletBtn.setButtonText(this.shortAddr(this.walletAddress));
      if (this.incoReady) {
        this.useIncoRoles = true;
        this.incoToggle.setButtonText(this.incoToggleLabel());
      }
      this.refreshStatus(
        `Ready on ${targetNetworkLabel()} · ${this.shortAddr(this.walletAddress)}`,
        '#86efac',
      );
      playSfx(this, SFX.confirm);
    } catch (err) {
      console.error(err);
      this.refreshStatus(err.message || 'Wallet connect failed', '#f87171');
      playSfx(this, SFX.cancel);
    }
  }

  async onToggleInco() {
    if (!this.incoReady) {
      this.refreshStatus(
        'Deploy AmongUsRoles + rebuild inco bundle first',
        '#f87171',
      );
      playSfx(this, SFX.cancel);
      return;
    }
    this.useIncoRoles = !this.useIncoRoles;
    this.incoToggle.setButtonText(this.incoToggleLabel());
    playSfx(this, this.useIncoRoles ? SFX.toggleOn : SFX.toggleOff);
    this.refreshStatus();
    if (this.useIncoRoles) {
      await this.onConnectWallet();
    }
  }

  askNameThen(onDone) {
    if (this.promptOpen) return;
    this.promptOpen = true;
    createNamePrompt(
      this,
      (playerName) => {
        this.promptOpen = false;
        onDone(playerName);
      },
      () => {
        this.promptOpen = false;
      },
    );
  }

  openJoinPanel(playerName) {
    if (this.joinPanel) return;
    unlockAudio(this);
    playSfx(this, SFX.modalOpen);

    // Block clicks on menu buttons underneath
    const overlay = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.65)
      .setDepth(70)
      .setInteractive();

    const width = 540;
    const height = 320;
    const key = 'join_panel_v2';
    if (this.textures.exists(key)) this.textures.remove(key);
    const canvas = this.textures.createCanvas(key, width, height);
    const ctx = canvas.getContext();
    const r = 22;
    ctx.fillStyle = 'rgba(12, 6, 28, 0.98)';
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

    // input field box
    ctx.fillStyle = 'rgba(30, 16, 60, 0.95)';
    ctx.strokeStyle = '#14f195';
    ctx.lineWidth = 2;
    const ix = 70;
    const iy = 120;
    const iw = 400;
    const ih = 70;
    const ir = 14;
    ctx.beginPath();
    ctx.moveTo(ix + ir, iy);
    ctx.lineTo(ix + iw - ir, iy);
    ctx.quadraticCurveTo(ix + iw, iy, ix + iw, iy + ir);
    ctx.lineTo(ix + iw, iy + ih - ir);
    ctx.quadraticCurveTo(ix + iw, iy + ih, ix + iw - ir, iy + ih);
    ctx.lineTo(ix + ir, iy + ih);
    ctx.quadraticCurveTo(ix, iy + ih, ix, iy + ih - ir);
    ctx.lineTo(ix, iy + ir);
    ctx.quadraticCurveTo(ix, iy, ix + ir, iy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    canvas.refresh();

    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const bg = this.add.image(cx, cy, key).setDepth(80);

    const title = this.add
      .text(cx, cy - 110, 'ENTER ROOM CODE', {
        fontFamily: 'Arial Black, Impact, Helvetica, sans-serif',
        fontSize: '28px',
        color: '#f5f3ff',
      })
      .setOrigin(0.5)
      .setDepth(81);

    this.joinCode = '';
    this.joinCodeText = this.add
      .text(cx, cy - 20, '_ _ _ _ _', {
        fontFamily: 'Arial Black, Impact, Helvetica, sans-serif',
        fontSize: '40px',
        color: '#14f195',
      })
      .setOrigin(0.5)
      .setDepth(81);

    const hint = this.add
      .text(cx, cy + 70, 'Type or Ctrl/Cmd+V to paste  •  Enter to join  •  Esc cancel', {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '14px',
        color: '#c4b5fd',
      })
      .setOrigin(0.5)
      .setDepth(81);

    this.joinPanel = [overlay, bg, title, this.joinCodeText, hint];

    const applyCode = (raw) => {
      const cleaned = String(raw || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 5);
      this.joinCode = cleaned;
      const padded = (this.joinCode + '_____').slice(0, 5).split('').join(' ');
      this.joinCodeText.setText(padded.toUpperCase());
    };

    this.joinKeyHandler = (event) => {
      if (event.key === 'Escape') {
        playSfx(this, SFX.modalClose);
        this.closeJoinPanel();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        // paste handled by paste listener
        return;
      }
      if (event.key === 'Enter' && this.joinCode.length >= 4) {
        const room = this.joinCode.toLowerCase();
        playSfx(this, SFX.confirm);
        this.closeJoinPanel();
        this.enterLobby({
          mode: 'join',
          room,
          fillBots: false,
          maxPlayers: MAX_PLAYERS,
          isHost: false,
          playerName,
          useIncoRoles: this.useIncoRoles && this.incoReady,
          walletAddress: this.walletAddress,
        });
        return;
      }
      if (event.key === 'Backspace') {
        applyCode(this.joinCode.slice(0, -1));
        playSfx(this, SFX.typing);
        return;
      }
      if (/^[a-zA-Z0-9]$/.test(event.key)) {
        applyCode(this.joinCode + event.key);
        playSfx(this, SFX.typing);
      }
    };

    this.joinPasteHandler = (event) => {
      const pasted = (event.clipboardData || window.clipboardData).getData('text');
      if (pasted) {
        event.preventDefault();
        applyCode(pasted);
        playSfx(this, SFX.toast);
      }
    };

    this.input.keyboard.on('keydown', this.joinKeyHandler);
    window.addEventListener('paste', this.joinPasteHandler);
  }

  closeJoinPanel() {
    if (this.joinKeyHandler) {
      this.input.keyboard.off('keydown', this.joinKeyHandler);
      this.joinKeyHandler = null;
    }
    if (this.joinPasteHandler) {
      window.removeEventListener('paste', this.joinPasteHandler);
      this.joinPasteHandler = null;
    }
    if (this.joinPanel) {
      this.joinPanel.forEach((obj) => obj.destroy());
      this.joinPanel = null;
    }
  }

  enterLobby(config) {
    playSfx(this, SFX.transition);
    window.history.replaceState(
      {},
      document.title,
      updateQueryParameter('room', config.room),
    );
    this.scene.start('LobbyScene', config);
  }

  update(time) {
    if (this.stars) {
      this.stars.tilePositionX = time * 0.02;
    }
  }
}

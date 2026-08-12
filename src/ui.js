import { playSfx, SFX, unlockAudio } from './audio';

export const makeNearBlackTransparent = (scene, key, threshold = 28) => {
  const clearKey = `${key}Clear`;
  if (scene.textures.exists(clearKey)) {
    return clearKey;
  }

  const texture = scene.textures.get(key);
  const source = texture.getSourceImage();
  const canvasTexture = scene.textures.createCanvas(
    clearKey,
    source.width,
    source.height,
  );
  const ctx = canvasTexture.getContext();
  ctx.drawImage(source, 0, 0);
  const imageData = ctx.getImageData(0, 0, source.width, source.height);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < threshold && data[i + 1] < threshold && data[i + 2] < threshold) {
      data[i + 3] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  canvasTexture.refresh();
  return clearKey;
};

export const createMenuBackground = (scene, width, height) => {
  scene.cameras.main.setBackgroundColor('#070012');

  const wash = scene.add.graphics().setDepth(-35);
  wash.fillStyle(0x9945ff, 0.18);
  wash.fillCircle(width * 0.2, height * 0.15, 260);
  wash.fillStyle(0x14f195, 0.1);
  wash.fillCircle(width * 0.85, height * 0.75, 300);
  wash.fillStyle(0x00ffa3, 0.06);
  wash.fillCircle(width * 0.5, height * 0.4, 200);

  scene.add
    .image(width / 2, height / 2, 'skygradient')
    .setDisplaySize(width * 1.2, height * 1.2)
    .setDepth(-30)
    .setAlpha(0.85);

  const stars = scene.add
    .tileSprite(width / 2, height / 2, width, height, 'stars')
    .setDepth(-20)
    .setAlpha(0.95);

  scene.add
    .tileSprite(width / 2, height - 20, width * 1.3, 240, 'parallax3')
    .setDepth(-15)
    .setAlpha(0.4)
    .setTint(0xb57bff);

  scene.add
    .tileSprite(width / 2, height + 20, width * 1.2, 200, 'parallax2')
    .setDepth(-14)
    .setAlpha(0.55)
    .setTint(0x8a4dff);

  scene.add
    .tileSprite(width / 2, height + 50, width * 1.1, 180, 'parallax1')
    .setDepth(-13)
    .setAlpha(0.7)
    .setTint(0x6d3cff);

  return stars;
};

const traceRoundedRect = (ctx, x, y, width, height, radius) => {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

const fitFont = (ctx, text, maxWidth, weight, size, family) => {
  let current = size;
  ctx.font = `${weight} ${current}px ${family}`;
  while (current > 9 && ctx.measureText(text).width > maxWidth) {
    current -= 1;
    ctx.font = `${weight} ${current}px ${family}`;
  }
  return current;
};

/**
 * Panel with its text baked into the texture.
 * Phaser Text metrics drift from image bounds across fonts/zoom levels, which pushed
 * labels off their panels; canvas text is positioned exactly like the buttons.
 */
export const createTextCard = (scene, x, y, width, height, options = {}) => {
  const key = options.key || `card_${Math.random().toString(36).slice(2, 9)}`;
  const radius = options.radius != null ? options.radius : 18;
  const lineWidth = options.lineWidth || 2;
  const padding = options.padding != null ? options.padding : 22;
  const showPanel = options.panel !== false;
  let lines = options.lines || [];

  const draw = () => {
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const canvas = scene.textures.createCanvas(key, width, height);
    const ctx = canvas.getContext();
    ctx.clearRect(0, 0, width, height);

    if (showPanel) {
      const inset = lineWidth / 2 + 1;
      ctx.fillStyle = options.fill || 'rgba(10, 14, 32, 0.94)';
      ctx.strokeStyle = options.stroke || '#38bdf8';
      ctx.lineWidth = lineWidth;
      traceRoundedRect(ctx, inset, inset, width - inset * 2, height - inset * 2, radius);
      ctx.fill();
      ctx.stroke();
    }

    const visible = lines.filter((line) => line && line.text);
    const heights = visible.map((line) => (line.size || 15) * 1.65);
    const total = heights.reduce((sum, h) => sum + h, 0);
    let cursor = (height - total) / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    visible.forEach((line, i) => {
      const family = line.font || 'Arial, Helvetica, sans-serif';
      const weight = line.weight || 'bold';
      const size = fitFont(
        ctx,
        line.text,
        width - padding * 2,
        weight,
        line.size || 15,
        family,
      );
      ctx.font = `${weight} ${size}px ${family}`;
      ctx.fillStyle = line.color || '#f8fafc';
      ctx.fillText(line.text, width / 2, cursor + heights[i] / 2);
      cursor += heights[i];
    });

    canvas.refresh();
  };

  draw();
  const image = scene.add
    .image(x, y, key)
    .setOrigin(0.5)
    .setDepth(options.depth != null ? options.depth : 6);

  image.setLines = (nextLines) => {
    lines = nextLines;
    draw();
    image.setTexture(key);
  };

  return image;
};

const drawButtonCanvas = (ctx, width, height, fillCss, strokeCss, label, textColor, fontSize) => {
  const radius = 18;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = fillCss;
  ctx.strokeStyle = strokeCss;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(radius, 2);
  ctx.lineTo(width - radius, 2);
  ctx.quadraticCurveTo(width - 2, 2, width - 2, radius);
  ctx.lineTo(width - 2, height - radius);
  ctx.quadraticCurveTo(width - 2, height - 2, width - radius, height - 2);
  ctx.lineTo(radius, height - 2);
  ctx.quadraticCurveTo(2, height - 2, 2, height - radius);
  ctx.lineTo(2, radius);
  ctx.quadraticCurveTo(2, 2, radius, 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(12, 10);
  ctx.lineTo(width - 12, 10);
  ctx.stroke();

  // Label painted into the button so it can never drift
  ctx.fillStyle = textColor;
  ctx.font = `bold ${fontSize}px Arial Black, Impact, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.strokeText(label, width / 2, height / 2 + 1);
  ctx.fillText(label, width / 2, height / 2 + 1);
};

const buildLabeledButtonTexture = (
  scene,
  key,
  width,
  height,
  fillCss,
  strokeCss,
  label,
  textColor,
  fontSize,
) => {
  if (scene.textures.exists(key)) {
    scene.textures.remove(key);
  }
  const canvas = scene.textures.createCanvas(key, width, height);
  drawButtonCanvas(
    canvas.getContext(),
    width,
    height,
    fillCss,
    strokeCss,
    label,
    textColor,
    fontSize,
  );
  canvas.refresh();
  return key;
};

export const createAmongButton = (scene, x, y, label, onClick, options = {}) => {
  const width = options.width || 360;
  const height = options.height || 72;
  const fill = options.fill || '#1a1028';
  const hover = options.hover || '#2a1840';
  const stroke = options.stroke || '#c084fc';
  const hoverStroke = options.hoverStroke || '#14f195';
  const textColor = options.textColor || '#ffffff';
  const fontSize = parseInt(options.fontSize, 10) || 24;

  let currentLabel = label;
  const id = `btn_${Math.random().toString(36).slice(2, 9)}`;

  const makeKeys = (text) => ({
    normal: buildLabeledButtonTexture(
      scene,
      `${id}_n_${text}`,
      width,
      height,
      fill,
      stroke,
      text,
      textColor,
      fontSize,
    ),
    hover: buildLabeledButtonTexture(
      scene,
      `${id}_h_${text}`,
      width,
      height,
      hover,
      hoverStroke,
      text,
      textColor,
      fontSize,
    ),
  });

  let keys = makeKeys(currentLabel);

  // No container / separate text — one image with baked label
  const button = scene.add
    .image(x, y, keys.normal)
    .setOrigin(0.5)
    .setDepth(50)
    .setInteractive({ useHandCursor: true });

  button.on('pointerover', () => {
    unlockAudio(scene);
    playSfx(scene, SFX.hover);
    button.setTexture(keys.hover);
    button.setScale(1.04);
  });
  button.on('pointerout', () => {
    button.setTexture(keys.normal);
    button.setScale(1);
  });
  button.on('pointerdown', () => {
    unlockAudio(scene);
    playSfx(scene, options.sound || SFX.click);
    button.setScale(0.97);
  });
  button.on('pointerup', () => {
    button.setScale(1.04);
    onClick();
  });

  button.setButtonText = (nextLabel) => {
    currentLabel = nextLabel;
    keys = makeKeys(currentLabel);
    button.setTexture(keys.normal);
  };

  button.buttonText = {
    setText: (nextLabel) => button.setButtonText(nextLabel),
  };

  return button;
};

export const createArtFrame = (scene, x, y, textureKey, displayWidth, options = {}) => {
  const image = scene.add.image(x, y, textureKey).setDepth(options.depth || 3);
  const scale = displayWidth / image.width;
  image.setScale(scale);
  image.setAlpha(options.alpha != null ? options.alpha : 1);

  const pad = 10;
  const frame = scene.add
    .rectangle(
      x,
      y,
      image.displayWidth + pad * 2,
      image.displayHeight + pad * 2,
      0x0f081c,
      0.88,
    )
    .setStrokeStyle(3, 0x9945ff, 0.7)
    .setDepth((options.depth || 3) - 1);

  return { image, frame };
};

export const createNamePrompt = (scene, onConfirm, onCancel) => {
  unlockAudio(scene);
  playSfx(scene, SFX.modalOpen);

  const width = 520;
  const height = 300;
  const key = 'name_prompt_panel';
  if (!scene.textures.exists(key)) {
    const canvas = scene.textures.createCanvas(key, width, height);
    const ctx = canvas.getContext();
    ctx.fillStyle = 'rgba(12, 6, 24, 0.96)';
    ctx.strokeStyle = '#9945FF';
    ctx.lineWidth = 3;
    const r = 20;
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
    canvas.refresh();
  }

  const overlay = scene.add
    .rectangle(
      scene.cameras.main.centerX,
      scene.cameras.main.centerY,
      scene.cameras.main.width,
      scene.cameras.main.height,
      0x000000,
      0.55,
    )
    .setDepth(90)
    .setInteractive();

  const panel = scene.add
    .image(scene.cameras.main.centerX, scene.cameras.main.centerY, key)
    .setDepth(91);

  const title = scene.add
    .text(scene.cameras.main.centerX, scene.cameras.main.centerY - 100, 'ENTER YOUR NAME', {
      fontFamily: 'Arial Black, Impact, Helvetica, sans-serif',
      fontSize: '26px',
      color: '#e9d5ff',
    })
    .setOrigin(0.5)
    .setDepth(92);

  let nameValue = '';
  const nameText = scene.add
    .text(scene.cameras.main.centerX, scene.cameras.main.centerY - 10, '_', {
      fontFamily: 'Arial Black, Impact, Helvetica, sans-serif',
      fontSize: '36px',
      color: '#14f195',
    })
    .setOrigin(0.5)
    .setDepth(92);

  const hint = scene.add
    .text(
      scene.cameras.main.centerX,
      scene.cameras.main.centerY + 70,
      'Type name  •  Enter to continue  •  Esc to cancel',
      {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '15px',
        color: '#c4b5fd',
      },
    )
    .setOrigin(0.5)
    .setDepth(92);

  const cleanup = () => {
    scene.input.keyboard.off('keydown', onKey);
    overlay.destroy();
    panel.destroy();
    title.destroy();
    nameText.destroy();
    hint.destroy();
  };

  const onKey = (event) => {
    if (event.key === 'Escape') {
      playSfx(scene, SFX.modalClose);
      cleanup();
      if (onCancel) onCancel();
      return;
    }
    if (event.key === 'Enter') {
      playSfx(scene, SFX.confirm);
      const finalName = (nameValue.trim() || 'Crewmate').slice(0, 12);
      cleanup();
      onConfirm(finalName);
      return;
    }
    if (event.key === 'Backspace') {
      nameValue = nameValue.slice(0, -1);
      playSfx(scene, SFX.typing);
    } else if (event.key.length === 1 && nameValue.length < 12 && /[a-zA-Z0-9 _-]/.test(event.key)) {
      nameValue += event.key;
      playSfx(scene, SFX.typing);
    }
    nameText.setText(nameValue.length ? nameValue : '_');
  };

  scene.input.keyboard.on('keydown', onKey);

  return { cleanup };
};

/* Among Us SFX Pack mappings */
import walkSfx from './Among Us SFX Pack/the-among-us-walking-sound-effect.mp3';
import clickSfx from './Among Us SFX Pack/deck_ui_default_activation.wav';
import hoverSfx from './Among Us SFX Pack/deck_ui_navigation.wav';
import popSfx from './Among Us SFX Pack/pop_sound.wav';
import modalOpenSfx from './Among Us SFX Pack/deck_ui_show_modal.wav';
import modalCloseSfx from './Among Us SFX Pack/deck_ui_hide_modal.wav';
import confirmPosSfx from './Among Us SFX Pack/confirmation_positive.wav';
import confirmNegSfx from './Among Us SFX Pack/confirmation_negative.wav';
import toggleOnSfx from './Among Us SFX Pack/deck_ui_switch_toggle_on.wav';
import toggleOffSfx from './Among Us SFX Pack/deck_ui_switch_toggle_off.wav';
import typingSfx from './Among Us SFX Pack/deck_ui_typing.wav';
import toastSfx from './Among Us SFX Pack/deck_ui_toast.wav';
import launchSfx from './Among Us SFX Pack/deck_ui_launch_game.wav';
import transitionSfx from './Among Us SFX Pack/deck_ui_tab_transition_01.wav';
import menuInSfx from './Among Us SFX Pack/deck_ui_side_menu_fly_in.wav';
import menuOutSfx from './Among Us SFX Pack/deck_ui_side_menu_fly_out.wav';
import joinSfx from './Among Us SFX Pack/deck_ui_into_game_detail.wav';
import leaveSfx from './Among Us SFX Pack/deck_ui_out_of_game_detail.wav';
import messageSfx from './Among Us SFX Pack/deck_ui_message_toast.wav';
import achievementSfx from './Among Us SFX Pack/deck_ui_achievement_toast.wav';
import sliderUpSfx from './Among Us SFX Pack/deck_ui_slider_up.wav';
import bumperSfx from './Among Us SFX Pack/bumper_end.wav';

export const SFX = {
  walk: 'sfx_walk',
  click: 'sfx_click',
  hover: 'sfx_hover',
  pop: 'sfx_pop',
  modalOpen: 'sfx_modal_open',
  modalClose: 'sfx_modal_close',
  confirm: 'sfx_confirm',
  cancel: 'sfx_cancel',
  toggleOn: 'sfx_toggle_on',
  toggleOff: 'sfx_toggle_off',
  typing: 'sfx_typing',
  toast: 'sfx_toast',
  launch: 'sfx_launch',
  transition: 'sfx_transition',
  menuIn: 'sfx_menu_in',
  menuOut: 'sfx_menu_out',
  join: 'sfx_join',
  leave: 'sfx_leave',
  message: 'sfx_message',
  achievement: 'sfx_achievement',
  slider: 'sfx_slider',
  bumper: 'sfx_bumper',
  alarm: 'sfx_achievement', // reused as emergency/meeting alert
  kill: 'sfx_cancel',
};

const FILES = {
  [SFX.walk]: walkSfx,
  [SFX.click]: clickSfx,
  [SFX.hover]: hoverSfx,
  [SFX.pop]: popSfx,
  [SFX.modalOpen]: modalOpenSfx,
  [SFX.modalClose]: modalCloseSfx,
  [SFX.confirm]: confirmPosSfx,
  [SFX.cancel]: confirmNegSfx,
  [SFX.toggleOn]: toggleOnSfx,
  [SFX.toggleOff]: toggleOffSfx,
  [SFX.typing]: typingSfx,
  [SFX.toast]: toastSfx,
  [SFX.launch]: launchSfx,
  [SFX.transition]: transitionSfx,
  [SFX.menuIn]: menuInSfx,
  [SFX.menuOut]: menuOutSfx,
  [SFX.join]: joinSfx,
  [SFX.leave]: leaveSfx,
  [SFX.message]: messageSfx,
  [SFX.achievement]: achievementSfx,
  [SFX.slider]: sliderUpSfx,
  [SFX.bumper]: bumperSfx,
};

const VOLUMES = {
  [SFX.walk]: 0.45,
  [SFX.click]: 0.4,
  [SFX.hover]: 0.15,
  [SFX.pop]: 0.35,
  [SFX.modalOpen]: 0.45,
  [SFX.modalClose]: 0.4,
  [SFX.confirm]: 0.5,
  [SFX.cancel]: 0.4,
  [SFX.toggleOn]: 0.45,
  [SFX.toggleOff]: 0.4,
  [SFX.typing]: 0.25,
  [SFX.toast]: 0.45,
  [SFX.launch]: 0.55,
  [SFX.transition]: 0.4,
  [SFX.menuIn]: 0.4,
  [SFX.menuOut]: 0.35,
  [SFX.join]: 0.5,
  [SFX.leave]: 0.4,
  [SFX.message]: 0.4,
  [SFX.achievement]: 0.5,
  [SFX.slider]: 0.3,
  [SFX.bumper]: 0.35,
};

let unlocked = false;

export const preloadSounds = (scene) => {
  Object.keys(FILES).forEach((key) => {
    if (!scene.cache.audio.exists(key)) {
      scene.load.audio(key, FILES[key]);
    }
  });
};

export const unlockAudio = (scene) => {
  if (unlocked || !scene.sound) return;
  scene.sound.unlock();
  // Play a muted click once to satisfy browser autoplay policies
  if (scene.sound.context && scene.sound.context.state === 'suspended') {
    scene.sound.context.resume();
  }
  unlocked = true;
};

export const playSfx = (scene, key, config = {}) => {
  if (!scene || !scene.sound || !scene.cache.audio.exists(key)) return null;
  try {
    return scene.sound.play(key, {
      volume: VOLUMES[key] != null ? VOLUMES[key] : 0.4,
      ...config,
    });
  } catch (e) {
    return null;
  }
};

export const getOrAddSound = (scene, key, config = {}) => {
  if (!scene || !scene.sound || !scene.cache.audio.exists(key)) return null;
  let sound = scene.sound.get(key);
  if (!sound) {
    sound = scene.sound.add(key, {
      volume: VOLUMES[key] != null ? VOLUMES[key] : 0.4,
      ...config,
    });
  }
  return sound;
};

export const startWalkSound = (scene) => {
  const sound = getOrAddSound(scene, SFX.walk, { loop: true, volume: VOLUMES[SFX.walk] });
  if (!sound) return;
  if (!sound.isPlaying) {
    sound.play({ loop: true, volume: VOLUMES[SFX.walk] });
  }
};

export const stopWalkSound = (scene) => {
  const sound = scene && scene.sound ? scene.sound.get(SFX.walk) : null;
  if (sound && sound.isPlaying) {
    sound.stop();
  }
};

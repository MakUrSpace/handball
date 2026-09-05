/**
 * A-Frame Component: handball-hud
 * Implements 2D stadium status bar, persistent side-wall stadium kiosk,
 * and dynamically tracked 3D Forearm HUD on the left arm.
 */

import { soundEngine } from './spatial-audio';
import type { MatchSnapshot } from '../types';

declare const AFRAME: any;
declare const THREE: any;

AFRAME.registerComponent('vr-button', {
  schema: {
    label: { type: 'string', default: 'BUTTON' },
    action: { type: 'string', default: '' },
    color: { type: 'string', default: '#0284c7' },
    hoverColor: { type: 'string', default: '#38bdf8' },
    width: { type: 'number', default: 0.8 },
    height: { type: 'number', default: 0.22 },
    depth: { type: 'number', default: 0.04 },
    directTouchOnly: { type: 'boolean', default: false },
  },

  init: function () {
    const el = this.el;
    const data = this.data;

    if (data.directTouchOnly) {
      el.classList.add('direct-touch-only');
    } else {
      el.classList.add('clickable');
      el.classList.add('vr-btn');
    }

    // 3D Button Mesh
    const box = document.createElement('a-box');
    box.setAttribute('width', data.width.toString());
    box.setAttribute('height', data.height.toString());
    box.setAttribute('depth', data.depth.toString());
    box.setAttribute('material', `color: ${data.color}; shader: flat; roughness: 0.3`);
    el.appendChild(box);
    this.boxEl = box;

    // Button Label Text
    const text = document.createElement('a-text');
    text.setAttribute('value', data.label);
    text.setAttribute('align', 'center');
    text.setAttribute('position', `0 0 ${data.depth / 2 + 0.01}`);
    text.setAttribute('color', '#ffffff');
    text.setAttribute('width', (data.width * 2.8).toString());
    el.appendChild(text);
    this.textEl = text;

    this.gameManagerEl = document.querySelector('#game-scene');
    this.lastActivationTime = 0;

    // Raycaster & Laser hover styling
    el.addEventListener('mouseenter', () => {
      this.boxEl.setAttribute('material', `color: ${this.data.hoverColor}; shader: flat`);
    });

    el.addEventListener('mouseleave', () => {
      this.boxEl.setAttribute('material', `color: ${this.data.color}; shader: flat`);
    });

    // Interaction trigger via raycaster click or direct touch
    el.addEventListener('click', (evt: any) => {
      evt.stopPropagation?.();

      // Touch controllers serve from the physical wrist control, not by
      // squeezing the trigger while a distant Serve button is under the ray.
      const cursorEl = evt.detail?.cursorEl;
      const tracker = cursorEl?.components?.['hand-tracker'];
      if (data.action === 'serve' && tracker?.inputMode === 'controller') return;

      this.triggerAction();
    });
  },

  triggerAction: function () {
    const now = performance.now();
    if (now - this.lastActivationTime < 180) return;
    this.lastActivationTime = now;

    soundEngine.resume();

    // Tactile haptic push animation
    this.el.object3D.position.z -= 0.02;
    setTimeout(() => {
      this.el.object3D.position.z += 0.02;
    }, 100);

    const gm = this.gameManagerEl ? this.gameManagerEl.components['handball-game-manager'] : null;
    if (!gm) return;

    switch (this.data.action) {
      case 'start':
        gm.startGame();
        break;
      case 'serve':
        gm.serveBall();
        break;
      case 'pause':
        gm.togglePause();
        break;
      case 'reset':
        gm.resetGame();
        break;
      case 'audio':
        soundEngine.enabled = !soundEngine.enabled;
        if (this.textEl) {
          this.textEl.setAttribute('value', soundEngine.enabled ? '🔊 AUDIO ON' : '🔇 AUDIO OFF');
        }
        break;
      case 'freeplay':
        {
          const enabled = gm.toggleFreeplay();
          const label = enabled ? '∞ FREEPLAY: ON' : '∞ FREEPLAY: OFF';
          document.querySelectorAll('[vr-button*="action: freeplay"]').forEach((btn: any) => {
            const txt = btn.querySelector('a-text');
            if (txt) txt.setAttribute('value', label);
          });
          const domButton = document.getElementById('btn-freeplay');
          if (domButton) domButton.textContent = label;
        }
        break;
      case 'difficulty':
        gm.cycleBotDifficulty();
        break;
      case 'kiosk': {
        const courtEl = document.querySelector('[handball-court]') as any;
        courtEl?.components?.['handball-court']?.toggleKiosk();
        break;
      }
      case 'mode': {
        const courtEl = document.querySelector('[handball-court]');
        if (courtEl && (courtEl as any).components['handball-court']) {
          const newMode = (courtEl as any).components['handball-court'].toggleMode();
          const modeLabel = newMode === 'narrow' ? '📏 MODE: NARROW' : '🏛 MODE: REGULATION';
          if (this.textEl) {
            this.textEl.setAttribute('value', modeLabel);
          }
          document.querySelectorAll('[vr-button*="action: mode"]').forEach((btn: any) => {
            const txt = btn.querySelector('a-text');
            if (txt) txt.setAttribute('value', modeLabel);
          });
          const btnDomMode = document.getElementById('btn-mode');
          if (btnDomMode) {
            btnDomMode.textContent = newMode === 'narrow' ? '📏 MODE: NARROW' : '🏛 MODE: REGULATION';
          }
          if (gm.ballEl) {
            const phys = gm.ballEl.components['handball-physics'];
            if (phys) phys.resetBall();
          }
        }
        break;
      }
      case 'passthrough': {
        const courtEl = document.querySelector('[handball-court]');
        if (courtEl && (courtEl as any).components['handball-court']) {
          const court = (courtEl as any).components['handball-court'];
          const isPt = court.togglePassthrough();
          const ptLabel = isPt ? '🥽 PASSTHROUGH (AR): ON' : '🥽 PASSTHROUGH (AR): OFF';
          if (this.textEl) {
            this.textEl.setAttribute('value', ptLabel);
          }
          document.querySelectorAll('[vr-button*="action: passthrough"]').forEach((btn: any) => {
            const txt = btn.querySelector('a-text');
            if (txt) txt.setAttribute('value', ptLabel);
          });
          const btnDomPt = document.getElementById('btn-passthrough');
          if (btnDomPt) {
            btnDomPt.textContent = ptLabel;
          }

          const scene: any = document.querySelector('#game-scene');
          if (scene) {
            if (isPt) {
              if (scene.is('vr-mode') && !scene.is('ar-mode')) {
                scene.exitVR().then(() => {
                  setTimeout(() => scene.enterAR(), 200);
                });
              }
            } else {
              if (scene.is('ar-mode')) {
                scene.exitVR().then(() => {
                  setTimeout(() => scene.enterVR(), 200);
                });
              }
            }
          }
        }
        break;
      }
      case 'neon': {
        const courtEl = document.querySelector('[handball-court]');
        if (courtEl && (courtEl as any).components['handball-court']) {
          const court = (courtEl as any).components['handball-court'];
          const isNeon = court.toggleNeon();
          const neonLabel = isNeon ? '⚡ NEON: ON' : '⚡ NEON: OFF';
          if (this.textEl) {
            this.textEl.setAttribute('value', neonLabel);
          }
          document.querySelectorAll('[vr-button*="action: neon"]').forEach((btn: any) => {
            const txt = btn.querySelector('a-text');
            if (txt) txt.setAttribute('value', neonLabel);
          });
          const btnDomNeon = document.getElementById('btn-neon');
          if (btnDomNeon) {
            btnDomNeon.textContent = neonLabel;
          }
        }
        break;
      }
    }
  },
});

AFRAME.registerComponent('handball-hud', {
  init: function () {
    this.gameManagerEl = document.querySelector('#game-scene');
    this.ballEl = document.querySelector('#handball');
    this.leftHandEl = document.querySelector('#left-hand');
    this.cameraEl = document.querySelector('#player-camera');

    // 1. Setup Dynamically-Tracked 3D Forearm HUD
    this.setupForearmHud();

    // 2. Bind 2D DOM UI elements
    this.bindDomUi();

    // Listen to match changes
    if (this.gameManagerEl) {
      this.gameManagerEl.addEventListener('match-state-change', (e: any) => {
        this.updateUi(e.detail);
      });
    }
  },

  setupForearmHud: function () {
    const wristGroup = document.createElement('a-entity');
    wristGroup.setAttribute('id', 'wrist-hud-group');
    wristGroup.setAttribute('data-mounted-hand', 'left');
    wristGroup.setAttribute('scale', '0.55 0.55 0.55');

    // Base plate
    const watchBg = document.createElement('a-plane');
    watchBg.setAttribute('width', '0.34');
    watchBg.setAttribute('height', '0.27');
    watchBg.setAttribute('material', 'color: #090d16; shader: flat; opacity: 0.96; side: double');
    wristGroup.appendChild(watchBg);

    // Neon Cyan outline
    const border = document.createElement('a-plane');
    border.setAttribute('width', '0.36');
    border.setAttribute('height', '0.29');
    border.setAttribute('position', '0 0 -0.002');
    border.setAttribute('material', 'color: #0284c7; shader: flat; side: double');
    wristGroup.appendChild(border);

    // Title
    const titleText = document.createElement('a-text');
    titleText.setAttribute('value', 'VR HANDBALL');
    titleText.setAttribute('align', 'center');
    titleText.setAttribute('position', '0 0.108 0.01');
    titleText.setAttribute('color', '#38bdf8');
    titleText.setAttribute('width', '0.75');
    wristGroup.appendChild(titleText);

    // Score Text
    this.wristScoreText = document.createElement('a-text');
    this.wristScoreText.setAttribute('value', 'PLAYER: 0 | OPP: 0');
    this.wristScoreText.setAttribute('align', 'center');
    this.wristScoreText.setAttribute('position', '0 0.066 0.01');
    this.wristScoreText.setAttribute('color', '#f8fafc');
    this.wristScoreText.setAttribute('width', '0.9');
    wristGroup.appendChild(this.wristScoreText);

    // Speed Text
    this.wristSpeedText = document.createElement('a-text');
    this.wristSpeedText.setAttribute('value', 'SPEED: 0.0 MPH');
    this.wristSpeedText.setAttribute('align', 'center');
    this.wristSpeedText.setAttribute('position', '0 0.026 0.01');
    this.wristSpeedText.setAttribute('color', '#fbbf24');
    this.wristSpeedText.setAttribute('width', '0.85');
    wristGroup.appendChild(this.wristSpeedText);

    this.wristRallyText = document.createElement('a-text');
    this.wristRallyText.setAttribute('value', 'RALLY: 0 | CENTER: 0');
    this.wristRallyText.setAttribute('align', 'center');
    this.wristRallyText.setAttribute('position', '0 -0.012 0.01');
    this.wristRallyText.setAttribute('color', '#6ee7b7');
    this.wristRallyText.setAttribute('width', '0.92');
    wristGroup.appendChild(this.wristRallyText);

    this.wristModeText = document.createElement('a-text');
    this.wristModeText.setAttribute('value', 'IDLE | BOT ACTIVE');
    this.wristModeText.setAttribute('align', 'center');
    this.wristModeText.setAttribute('position', '0 -0.048 0.01');
    this.wristModeText.setAttribute('color', '#c4b5fd');
    this.wristModeText.setAttribute('width', '0.86');
    wristGroup.appendChild(this.wristModeText);

    // Compact Touchable Serve Button on forearm
    const wristServeBtn = document.createElement('a-entity');
    wristServeBtn.setAttribute('vr-button', 'label: 🏐 SERVE; action: serve; color: #059669; hoverColor: #34d399; width: 0.11; height: 0.045; depth: 0.015; directTouchOnly: true');
    wristServeBtn.setAttribute('position', '-0.065 -0.092 0.012');
    wristServeBtn.setAttribute('data-mounted-hand', 'left');
    wristGroup.appendChild(wristServeBtn);

    // Compact Touchable Reset Button on forearm
    const wristResetBtn = document.createElement('a-entity');
    wristResetBtn.setAttribute('vr-button', 'label: 🔄 RESET; action: reset; color: #dc2626; hoverColor: #f87171; width: 0.11; height: 0.045; depth: 0.015; directTouchOnly: true');
    wristResetBtn.setAttribute('position', '0.065 -0.092 0.012');
    wristResetBtn.setAttribute('data-mounted-hand', 'left');
    wristGroup.appendChild(wristResetBtn);

    const scene = document.querySelector('#game-scene');
    if (scene) {
      scene.appendChild(wristGroup);
    }
    this.wristHudGroup = wristGroup;
  },

  bindDomUi: function () {
    const btnStart = document.getElementById('btn-start');
    const btnServe = document.getElementById('btn-serve');
    const btnPause = document.getElementById('btn-pause');
    const btnReset = document.getElementById('btn-reset');
    const btnAudio = document.getElementById('btn-audio');
    const btnFreeplay = document.getElementById('btn-freeplay');
    const btnBotDifficulty = document.getElementById('btn-bot-difficulty');

    btnStart?.addEventListener('click', () => {
      soundEngine.resume();
      this.getGameManager()?.startGame();
    });

    btnServe?.addEventListener('click', () => {
      soundEngine.resume();
      this.getGameManager()?.serveBall();
    });

    btnPause?.addEventListener('click', () => {
      this.getGameManager()?.togglePause();
    });

    btnReset?.addEventListener('click', () => {
      this.getGameManager()?.resetGame();
    });

    btnAudio?.addEventListener('click', () => {
      soundEngine.enabled = !soundEngine.enabled;
      if (btnAudio) {
        btnAudio.textContent = soundEngine.enabled ? '🔊 AUDIO ON' : '🔇 AUDIO MUTED';
      }
    });

    btnFreeplay?.addEventListener('click', () => {
      const gm = this.getGameManager();
      if (!gm) return;
      gm.toggleFreeplay();
    });

    btnBotDifficulty?.addEventListener('click', () => {
      this.getGameManager()?.cycleBotDifficulty();
    });

    const btnMode = document.getElementById('btn-mode');
    btnMode?.addEventListener('click', () => {
      const courtEl = document.querySelector('[handball-court]');
      if (courtEl && (courtEl as any).components['handball-court']) {
        const newMode = (courtEl as any).components['handball-court'].toggleMode();
        btnMode.textContent = newMode === 'narrow' ? '📏 MODE: NARROW' : '🏛 MODE: REGULATION';
        const modeLabel = newMode === 'narrow' ? '📏 MODE: NARROW' : '🏛 MODE: REGULATION';
        document.querySelectorAll('[vr-button*="action: mode"]').forEach((btn: any) => {
          const txt = btn.querySelector('a-text');
          if (txt) txt.setAttribute('value', modeLabel);
        });
        const gm = this.getGameManager();
        if (gm && gm.ballEl) {
          const phys = gm.ballEl.components['handball-physics'];
          if (phys) phys.resetBall();
        }
      }
    });

    const btnPassthrough = document.getElementById('btn-passthrough');
    btnPassthrough?.addEventListener('click', () => {
      const courtEl = document.querySelector('[handball-court]');
      if (courtEl && (courtEl as any).components['handball-court']) {
        const court = (courtEl as any).components['handball-court'];
        const isPt = court.togglePassthrough();
        const ptLabel = isPt ? '🥽 PASSTHROUGH (AR): ON' : '🥽 PASSTHROUGH (AR): OFF';
        btnPassthrough.textContent = ptLabel;
        document.querySelectorAll('[vr-button*="action: passthrough"]').forEach((btn: any) => {
          const txt = btn.querySelector('a-text');
          if (txt) txt.setAttribute('value', ptLabel);
        });

        const scene: any = document.querySelector('#game-scene');
        if (scene) {
          if (isPt) {
            if (scene.is('vr-mode') && !scene.is('ar-mode')) {
              scene.exitVR().then(() => {
                setTimeout(() => scene.enterAR(), 200);
              });
            } else if (!scene.is('vr-mode') && !scene.is('ar-mode')) {
              scene.enterAR();
            }
          } else {
            if (scene.is('ar-mode')) {
              scene.exitVR().then(() => {
                setTimeout(() => scene.enterVR(), 200);
              });
            }
          }
        }
      }
    });

    const btnKiosk = document.getElementById('btn-kiosk');
    btnKiosk?.addEventListener('click', () => {
      const courtEl = document.querySelector('[handball-court]') as any;
      courtEl?.components?.['handball-court']?.toggleKiosk();
    });

    const btnEnterAr = document.getElementById('btn-enter-ar');
    btnEnterAr?.addEventListener('click', () => {
      const scene: any = document.querySelector('#game-scene');
      const courtEl = document.querySelector('[handball-court]');
      if (courtEl && (courtEl as any).components['handball-court']) {
        (courtEl as any).components['handball-court'].setPassthrough(true);
      }
      if (scene) {
        scene.enterAR();
      }
    });

    const btnEnterVr = document.getElementById('btn-enter-vr');
    btnEnterVr?.addEventListener('click', () => {
      const scene: any = document.querySelector('#game-scene');
      const courtEl = document.querySelector('[handball-court]');
      if (courtEl && (courtEl as any).components['handball-court']) {
        (courtEl as any).components['handball-court'].setPassthrough(false);
      }
      if (scene) {
        scene.enterVR();
      }
    });
    const btnNeon = document.getElementById('btn-neon');
    btnNeon?.addEventListener('click', () => {
      const courtEl = document.querySelector('[handball-court]');
      if (courtEl && (courtEl as any).components['handball-court']) {
        const court = (courtEl as any).components['handball-court'];
        const isNeon = court.toggleNeon();
        const neonLabel = isNeon ? '⚡ NEON: ON' : '⚡ NEON: OFF';
        btnNeon.textContent = neonLabel;
        document.querySelectorAll('[vr-button*="action: neon"]').forEach((btn: any) => {
          const txt = btn.querySelector('a-text');
          if (txt) txt.setAttribute('value', neonLabel);
        });
      }
    });
  },

  getGameManager: function () {
    return this.gameManagerEl ? this.gameManagerEl.components['handball-game-manager'] : null;
  },

  tick: function () {
    const gm = this.getGameManager();

    // Court mode/theme changes rebuild the kiosk. Keep this label sourced from
    // live game state so a rebuilt button cannot fall back to its OFF markup.
    const freeplayLabel = gm?.data.freeplay ? '∞ FREEPLAY: ON' : '∞ FREEPLAY: OFF';
    document.querySelectorAll('[vr-button*="action: freeplay"]').forEach((btn: any) => {
      const txt = btn.components?.['vr-button']?.textEl || btn.querySelector('a-text');
      if (txt?.getAttribute('value') !== freeplayLabel) txt?.setAttribute('value', freeplayLabel);
    });

    const botDifficulty = gm?.getBot?.()?.getDifficultyInfo?.().label || 'MEDIUM';
    const difficultyLabel = `BOT: ${botDifficulty}`;
    document.querySelectorAll('[vr-button*="action: difficulty"]').forEach((btn: any) => {
      const txt = btn.components?.['vr-button']?.textEl || btn.querySelector('a-text');
      if (txt?.getAttribute('value') !== difficultyLabel) txt?.setAttribute('value', difficultyLabel);
    });
    const domDifficultyButton = document.getElementById('btn-bot-difficulty');
    if (domDifficultyButton && domDifficultyButton.textContent?.trim() !== `🤖 ${difficultyLabel}`) {
      domDifficultyButton.textContent = `🤖 ${difficultyLabel}`;
    }

    // 1. Update Ball Speedometer & Kiosk Text
    if (this.ballEl) {
      const physics = this.ballEl.components['handball-physics'];
      if (physics) {
        const speedMph = physics.getSpeedMph();
        const speedEl = document.getElementById('hud-ball-speed');
        if (speedEl) {
          speedEl.textContent = `${speedMph.toFixed(1)} MPH`;
        }
        if (this.wristSpeedText) {
          this.wristSpeedText.setAttribute('value', `SPEED: ${speedMph.toFixed(1)} MPH`);
        }
        const kioskInfo = document.querySelector('#kiosk-info-text');
        if (kioskInfo) {
          kioskInfo.setAttribute('value', `SPEED: ${speedMph.toFixed(1)} MPH`);
        }
        const kioskStats = document.querySelector('#kiosk-stats-text');
        if (kioskStats) {
          const rally = gm?.currentRallyShots ?? 0;
          const centerHits = gm?.stats.center_wall_hits ?? 0;
          const mode = gm?.data.freeplay ? 'FREEPLAY' : `BOT ${botDifficulty}`;
          kioskStats.setAttribute('value', `RALLY: ${rally}  •  CENTER: ${centerHits}  •  ${mode}`);
        }
      }
    }

    // 2. Track the left-hand forearm or mount directly beside the left controller.
    if (this.wristHudGroup && this.leftHandEl) {
      const tracker = this.leftHandEl.components['hand-tracker'];
      const trackerData = tracker?.getVelocityData?.();
      const handControls = this.leftHandEl.components['hand-tracking-controls'];
      const handPos = new THREE.Vector3();
      const controllerRotation = new THREE.Quaternion();
      let hasValidPose = false;
      const isController = trackerData?.isTracked && trackerData.inputMode === 'controller';
      const isTrackedHand = trackerData?.isTracked && trackerData.inputMode === 'hand';

      if (isController && this.leftHandEl.object3D) {
        this.leftHandEl.object3D.getWorldPosition(handPos);
        this.leftHandEl.object3D.getWorldQuaternion(controllerRotation);
        hasValidPose = handPos.lengthSq() > 0.001;
      } else if (isTrackedHand && handControls?.hasPoses && handControls.bones?.length > 0) {
        const wristBone = handControls.bones[0];
        if (wristBone) {
          wristBone.getWorldPosition(handPos);
          hasValidPose = true;
        }
      }

      if (hasValidPose) {
        const camPos = new THREE.Vector3(0, 1.6, 6.8);
        const camRot = new THREE.Quaternion();
        if (this.cameraEl && this.cameraEl.object3D) {
          this.cameraEl.object3D.getWorldPosition(camPos);
          this.cameraEl.object3D.getWorldQuaternion(camRot);
        }

        // Camera local orientation vectors
        const headRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camRot);
        const headUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camRot);

        let targetPos: any;
        if (isController) {
          // A rigid local offset keeps the panel attached to the Touch grip
          // while leaving the contact disk and trigger unobstructed.
          const controllerOffset = new THREE.Vector3(0.10, 0.10, 0.025)
            .applyQuaternion(controllerRotation);
          targetPos = handPos.clone().add(controllerOffset);
        } else {
          // Approximate left shoulder position (offset left and down from head).
          const leftShoulderPos = camPos.clone()
            .addScaledVector(headRight, -0.24)
            .addScaledVector(headUp, -0.24);
          const toShoulder = new THREE.Vector3().subVectors(leftShoulderPos, handPos);
          const armExtension = toShoulder.length();
          toShoulder.normalize();
          const offsetDist = Math.min(0.30, armExtension * 0.65);
          targetPos = handPos.clone().addScaledVector(toShoulder, offsetDist);
          targetPos.addScaledVector(headRight, -0.07);
          targetPos.y += 0.03;
        }

        this.wristHudGroup.object3D.visible = true;
        this.wristHudGroup.object3D.position.copy(targetPos);
        this.wristHudGroup.object3D.lookAt(camPos);
      } else {
        this.wristHudGroup.object3D.visible = false;
      }
    }
  },

  updateUi: function (snapshot: MatchSnapshot) {
    // 2D DOM Score updates
    const scorePlayerEl = document.getElementById('hud-player-score');
    const scoreOpponentEl = document.getElementById('hud-opponent-score');
    const rallyEl = document.getElementById('hud-rally-count');
    const statusBadgeEl = document.getElementById('hud-status-badge');
    const eventMsgEl = document.getElementById('hud-event-msg');
    const maxSpeedEl = document.getElementById('hud-max-speed');
    const centerHitsEl = document.getElementById('hud-center-hits');
    const totalRalliesEl = document.getElementById('hud-total-rallies');
    const botStateEl = document.getElementById('hud-bot-state');
    const freeplayStateEl = document.getElementById('hud-freeplay-state');

    if (scorePlayerEl) scorePlayerEl.textContent = snapshot.player_score.toString();
    if (scoreOpponentEl) scoreOpponentEl.textContent = snapshot.opponent_score.toString();
    if (rallyEl) rallyEl.textContent = snapshot.current_rally.toString();
    if (maxSpeedEl) maxSpeedEl.textContent = `${snapshot.stats.max_ball_speed_mph.toFixed(1)} MPH`;
    if (centerHitsEl) centerHitsEl.textContent = (snapshot.stats.center_wall_hits ?? 0).toString();
    if (totalRalliesEl) totalRalliesEl.textContent = snapshot.stats.total_rallies.toString();
    if (botStateEl) {
      botStateEl.textContent = snapshot.bot_enabled
        ? `ACTIVE • ${snapshot.bot_difficulty || 'MEDIUM'}`
        : 'OFF';
      botStateEl.className = snapshot.bot_enabled ? 'text-violet-300' : 'text-slate-300';
    }
    if (freeplayStateEl) {
      freeplayStateEl.textContent = snapshot.freeplay_enabled ? 'ACTIVE' : 'OFF';
      freeplayStateEl.className = snapshot.freeplay_enabled ? 'text-emerald-300' : 'text-slate-300';
    }

    const freeplayLabel = snapshot.freeplay_enabled ? '∞ FREEPLAY: ON' : '∞ FREEPLAY: OFF';
    const freeplayButton = document.getElementById('btn-freeplay');
    if (freeplayButton) freeplayButton.textContent = freeplayLabel;
    document.querySelectorAll('[vr-button*="action: freeplay"]').forEach((btn: any) => {
      const txt = btn.querySelector('a-text');
      if (txt) txt.setAttribute('value', freeplayLabel);
    });
    const difficultyLabel = `BOT: ${snapshot.bot_difficulty || 'MEDIUM'}`;
    const difficultyButton = document.getElementById('btn-bot-difficulty');
    if (difficultyButton) difficultyButton.textContent = `🤖 ${difficultyLabel}`;
    document.querySelectorAll('[vr-button*="action: difficulty"]').forEach((btn: any) => {
      const txt = btn.components?.['vr-button']?.textEl || btn.querySelector('a-text');
      if (txt) txt.setAttribute('value', difficultyLabel);
    });
    if (eventMsgEl) eventMsgEl.textContent = snapshot.last_event_message;

    if (statusBadgeEl) {
      statusBadgeEl.textContent = snapshot.state.toUpperCase();
      const isLive = snapshot.state === 'InPlay';
      const isPoint = snapshot.state === 'PointScored';
      statusBadgeEl.className = `px-3 py-1 rounded-full text-xs font-mono font-bold border ${
        isLive
          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 glow-emerald'
          : isPoint
            ? 'bg-violet-500/20 text-violet-300 border-violet-500/40 glow-purple'
            : 'bg-sky-500/20 text-sky-400 border-sky-500/40 glow-cyan'
      }`;
    }

    // In-World 3D VR Kiosk updates (mounted on left wall in court geometry)
    const kioskScore = document.querySelector('#kiosk-score-text');
    if (kioskScore) {
      kioskScore.setAttribute(
        'value',
        snapshot.freeplay_enabled
          ? 'FREEPLAY   •   SCORE LOCKED'
          : `PLAYER: ${snapshot.player_score}   |   ${snapshot.bot_enabled ? 'BOT' : 'OPPONENT'}: ${snapshot.opponent_score}`
      );
    }

    // 3D Forearm HUD updates
    if (this.wristScoreText) {
      this.wristScoreText.setAttribute('value', `YOU: ${snapshot.player_score} | ${snapshot.bot_enabled ? 'BOT' : 'OPP'}: ${snapshot.opponent_score}`);
    }
    if (this.wristRallyText) {
      this.wristRallyText.setAttribute('value', `RALLY: ${snapshot.current_rally} | CENTER: ${snapshot.stats.center_wall_hits ?? 0}`);
    }
    if (this.wristModeText) {
      this.wristModeText.setAttribute(
        'value',
        snapshot.freeplay_enabled
          ? 'FREEPLAY | RULES OFF'
          : `${snapshot.state.toUpperCase()} | ${snapshot.bot_enabled ? 'BOT ACTIVE' : 'RULES ON'}`
      );
    }

  },
});

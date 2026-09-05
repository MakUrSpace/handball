/**
 * A-Frame Component: practice-bot
 * A visible, deliberately beatable practice opponent. It reads the live ball
 * trajectory, moves toward the likely intercept, and returns reachable shots.
 */

import { COURT_DIMENSIONS } from './court';
import { soundEngine } from './spatial-audio';

declare const AFRAME: any;
declare const THREE: any;

type BotActor = 'Player' | 'Opponent';

const BOT_DIFFICULTY_PRESETS = [
  { label: 'EASY', errorRate: 0.35 },
  { label: 'MEDIUM', errorRate: 0.18 },
  { label: 'HARD', errorRate: 0.06 },
  { label: 'PERFECT', errorRate: 0.0 },
] as const;

AFRAME.registerComponent('practice-bot', {
  schema: {
    enabled: { type: 'boolean', default: false },
    reactionMs: { type: 'number', default: 290 },
    moveSpeed: { type: 'number', default: 2.65 },
    reach: { type: 'number', default: 0.52 },
    returnSpeed: { type: 'number', default: 12.5 },
    errorRate: { type: 'number', default: 0.18 },
  },

  init: function () {
    this.ballEl = document.querySelector('#handball');
    this.gameManagerEl = document.querySelector('#game-scene');
    this.homeZ = 5.15;
    this.targetX = 0;
    this.incomingSince = 0;
    this.hasSwung = false;
    this.willWhiff = false;
    this.trackingErrorX = 0;
    this.shotReactionMs = this.data.reactionMs;
    this.isGhosted = null;
    this.materialOpacities = new WeakMap();
    this.buildAvatar();
    this.setEnabled(this.data.enabled);
  },

  buildAvatar: function () {
    const makePart = (tag: string, attrs: Record<string, string>) => {
      const part = document.createElement(tag);
      for (const [name, value] of Object.entries(attrs)) part.setAttribute(name, value);
      this.el.appendChild(part);
      return part;
    };

    makePart('a-cylinder', {
      position: '0 1.05 0', radius: '0.23', height: '0.78',
      material: 'color: #6d28d9; roughness: 0.42; metalness: 0.12; opacity: 0.92; transparent: true',
    });
    makePart('a-sphere', {
      position: '0 1.62 0', radius: '0.20',
      material: 'color: #c4b5fd; roughness: 0.65',
    });
    makePart('a-cylinder', {
      position: '-0.12 0.42 0', radius: '0.075', height: '0.72',
      material: 'color: #312e81; roughness: 0.55',
    });
    makePart('a-cylinder', {
      position: '0.12 0.42 0', radius: '0.075', height: '0.72',
      material: 'color: #312e81; roughness: 0.55',
    });

    const armMaterial = 'color: #8b5cf6; roughness: 0.45';
    makePart('a-cylinder', {
      position: '-0.34 1.10 0', rotation: '0 0 -18', radius: '0.065', height: '0.66', material: armMaterial,
    });
    this.swingArm = makePart('a-entity', { position: '0.30 1.34 0' });
    const forearm = document.createElement('a-cylinder');
    forearm.setAttribute('position', '0 -0.22 0');
    forearm.setAttribute('rotation', '0 0 18');
    forearm.setAttribute('radius', '0.07');
    forearm.setAttribute('height', '0.68');
    forearm.setAttribute('material', armMaterial);
    this.swingArm.appendChild(forearm);
    const hand = document.createElement('a-sphere');
    hand.setAttribute('position', '0.10 -0.52 0');
    hand.setAttribute('radius', '0.11');
    hand.setAttribute('material', 'color: #ddd6fe; emissive: #7c3aed; emissiveIntensity: 0.28');
    this.swingArm.appendChild(hand);

    makePart('a-ring', {
      position: '0 0.015 0', rotation: '-90 0 0', 'radius-inner': '0.38', 'radius-outer': '0.43',
      material: 'color: #a855f7; shader: flat; opacity: 0.75; transparent: true; side: double',
    });
    makePart('a-text', {
      value: 'PRACTICE BOT', align: 'center', position: '0 1.98 0.02', color: '#e9d5ff', width: '2.5',
    });
  },

  setEnabled: function (enabled: boolean) {
    this.data.enabled = enabled;
    this.el.setAttribute('visible', enabled.toString());
    this.el.object3D.position.set(0, 0, this.homeZ);
    this.targetX = 0;
    this.incomingSince = 0;
    this.hasSwung = false;
    this.willWhiff = false;
  },

  getDifficultyInfo: function () {
    const errorRate = Math.max(0, Math.min(0.95, this.data.errorRate));
    const exactPreset = BOT_DIFFICULTY_PRESETS.find(
      preset => Math.abs(preset.errorRate - errorRate) < 0.001
    );
    return {
      label: exactPreset?.label || 'CUSTOM',
      errorRate,
      perfect: errorRate <= 0.001,
    };
  },

  setErrorRate: function (errorRate: number) {
    this.data.errorRate = Math.max(0, Math.min(0.95, errorRate));
    return this.getDifficultyInfo();
  },

  cycleDifficulty: function () {
    const currentRate = this.getDifficultyInfo().errorRate;
    let currentIndex = 0;
    let closestDistance = Infinity;
    BOT_DIFFICULTY_PRESETS.forEach((preset, index) => {
      const distance = Math.abs(preset.errorRate - currentRate);
      if (distance < closestDistance) {
        currentIndex = index;
        closestDistance = distance;
      }
    });
    const nextPreset = BOT_DIFFICULTY_PRESETS[(currentIndex + 1) % BOT_DIFFICULTY_PRESETS.length];
    return this.setErrorRate(nextPreset.errorRate);
  },

  notifyIncoming: function () {
    if (!this.data.enabled) return;
    this.incomingSince = performance.now();
    this.hasSwung = false;
    const difficulty = this.getDifficultyInfo();
    this.willWhiff = !difficulty.perfect && Math.random() < difficulty.errorRate;
    const courtScale = COURT_DIMENSIONS.mode === 'narrow' ? 0.42 : 0.78;
    this.trackingErrorX = difficulty.perfect
      ? 0
      : (Math.random() * 2 - 1) * courtScale * difficulty.errorRate;
    this.shotReactionMs = difficulty.perfect
      ? 0
      : this.data.reactionMs + Math.random() * difficulty.errorRate * 520;
  },

  resetForRally: function () {
    this.incomingSince = 0;
    this.hasSwung = false;
    this.willWhiff = false;
    this.trackingErrorX = 0;
    this.shotReactionMs = this.data.reactionMs;
    this.targetX = 0;
    this.el.object3D.position.y = 0;
  },

  moveToward: function (current: number, target: number, maxStep: number) {
    const delta = target - current;
    return current + Math.sign(delta) * Math.min(Math.abs(delta), maxStep);
  },

  settleJump: function (timeDelta: number) {
    const dt = Math.min(timeDelta / 1000, 0.05);
    this.el.object3D.position.y = this.moveToward(
      this.el.object3D.position.y,
      0,
      2.8 * dt
    );
  },

  setGhosted: function (ghosted: boolean) {
    this.isGhosted = ghosted;
    this.el.object3D.traverse((object: any) => {
      if (!object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!this.materialOpacities.has(material)) {
          this.materialOpacities.set(material, material.opacity ?? 1);
        }
        const baseOpacity = this.materialOpacities.get(material) ?? 1;
        material.transparent = ghosted || baseOpacity < 1;
        material.opacity = ghosted ? baseOpacity * 0.05 : baseOpacity;
        material.depthWrite = !ghosted;
        material.needsUpdate = true;
      }
    });
  },

  reflectIntoCourt: function (x: number) {
    const halfWidth = COURT_DIMENSIONS.width / 2 - 0.12;
    if (halfWidth <= 0) return 0;
    while (x > halfWidth || x < -halfWidth) {
      if (x > halfWidth) x = halfWidth - (x - halfWidth);
      if (x < -halfWidth) x = -halfWidth + (-halfWidth - x);
    }
    return x;
  },

  tick: function (_time: number, timeDelta: number) {
    if (!this.data.enabled || !this.ballEl || !this.gameManagerEl) return;
    const gm = this.gameManagerEl.components?.['handball-game-manager'];
    const physics = this.ballEl.components?.['handball-physics'];
    if (!gm || !physics) return;

    // The player needs a clear view after the bot's return and while serving.
    // Keep the avatar present as a positional cue, but at 95% transparency.
    const isPlayersTurn = gm.state === 'Idle'
      || gm.state === 'Serving'
      || (gm.state === 'InPlay' && (
        gm.lastHitter === 'Receiver'
        || (gm.lastHitter === 'Server' && !gm.frontWallHit)
      ));
    this.setGhosted(isPlayersTurn);

    if (gm.state !== 'InPlay') {
      this.settleJump(timeDelta);
      return;
    }
    if (gm.lastHitter !== 'Server' || !gm.frontWallHit) {
      this.settleJump(timeDelta);
      return;
    }

    const ballPos = this.ballEl.object3D.position;
    const velocity = physics.velocity;
    // A future crossing has the same sign in both halves of this quotient:
    // +z as the ball first approaches, or -z after an overhead shot rebounds
    // from the back wall. Supporting both removes the easy lob exploit.
    const timeToBot = Math.abs(velocity.z) > 0.15
      ? (this.homeZ - ballPos.z) / velocity.z
      : -1;
    if (timeToBot < 0 || timeToBot > 2.2) {
      this.settleJump(timeDelta);
      return;
    }

    const difficulty = this.getDifficultyInfo();
    this.targetX = this.reflectIntoCourt(ballPos.x + velocity.x * timeToBot + this.trackingErrorX);

    const dt = Math.min(timeDelta / 1000, 0.05);
    const maxStep = this.data.moveSpeed * dt;
    const deltaX = this.targetX - this.el.object3D.position.x;
    this.el.object3D.position.x += Math.sign(deltaX) * Math.min(Math.abs(deltaX), maxStep);

    // Track high trajectories with a bounded jump. The bot gains meaningful
    // overhead coverage without becoming a wall: very high/fast lobs remain a
    // difficult shot, while a missed first intercept can still be recovered.
    const predictedY = ballPos.y + velocity.y * timeToBot + 0.5 * physics.data.gravity * timeToBot * timeToBot;
    const targetJump = Math.max(0, Math.min(0.90, predictedY - 2.28));
    this.el.object3D.position.y = this.moveToward(
      this.el.object3D.position.y,
      targetJump,
      2.8 * dt
    );

    if (!this.incomingSince || this.hasSwung) return;
    const requiredReactionMs = difficulty.perfect ? 0 : this.shotReactionMs;
    if (performance.now() - this.incomingSince < requiredReactionMs) return;

    const reach = this.data.reach + (COURT_DIMENSIONS.mode === 'regulation' ? 0.12 : 0);
    const inStrikeLane = ballPos.z >= this.homeZ - 0.85 && ballPos.z <= this.homeZ + 0.65;
    const reachableHeight = difficulty.perfect
      || (ballPos.y >= 0.12 && ballPos.y <= 2.55 + this.el.object3D.position.y);
    const reachableWidth = difficulty.perfect
      || Math.abs(ballPos.x - this.el.object3D.position.x) <= reach;
    if (inStrikeLane && reachableHeight && reachableWidth && gm.floorBounces <= 1) {
      if (this.willWhiff && !difficulty.perfect) {
        this.missBall(gm);
      } else {
        this.returnBall(physics, ballPos, gm);
      }
    }
  },

  animateSwing: function (missed: boolean = false) {
    if (!this.swingArm) return;
    this.swingArm.object3D.rotation.x = missed ? -0.72 : -1.15;
    setTimeout(() => {
      if (this.swingArm) this.swingArm.object3D.rotation.x = 0;
    }, 220);
  },

  missBall: function (gm: any) {
    this.hasSwung = true;
    this.animateSwing(true);
    gm.lastMessage = `Bot error (${Math.round(this.data.errorRate * 100)}%) — mistimed return.`;
    gm.updateScoreboardDisplay();
    gm.emitStateChange();
  },

  returnBall: function (physics: any, ballPos: any, gm: any) {
    this.hasSwung = true;
    const difficulty = this.getDifficultyInfo();
    const halfWidth = COURT_DIMENSIONS.width / 2;
    const aimErrorX = difficulty.perfect ? 0 : (Math.random() * 2 - 1) * halfWidth * difficulty.errorRate * 0.45;
    const aimErrorY = difficulty.perfect ? 0 : (Math.random() * 2 - 1) * difficulty.errorRate * 0.55;
    const targetX = (Math.random() * 2 - 1) * Math.min(halfWidth * 0.58, 1.25) + aimErrorX;
    const targetY = Math.max(0.35, Math.min(1.9, 0.82 + Math.random() * 0.72 + aimErrorY));
    const target = new THREE.Vector3(targetX, targetY, 0);
    const direction = target.sub(ballPos).normalize();
    const speed = this.data.returnSpeed + Math.random() * 2.2;
    const velocity = direction.multiplyScalar(speed);
    physics.applyImpulse(velocity, new THREE.Vector3(0, (Math.random() - 0.5) * 5, 0));

    this.animateSwing(false);
    soundEngine.playHandStrike(speed, 'Solid');
    this.ballEl.emit('ball-struck', {
      actor: 'Opponent' as BotActor,
      side: 'bot',
      speedMps: speed,
      speedMph: speed * 2.23694,
      quality: 'Solid',
      position: { x: ballPos.x, y: ballPos.y, z: ballPos.z },
    });
  },
});

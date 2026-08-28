/**
 * A-Frame Component: hand-striker
 * Continuous hand-to-ball strike physics detector and impulse transfer.
 * Implements continuous swept-sphere segment collision across hand joints
 * and balanced power scaling between WebXR Hand Tracking and Desktop mode.
 */

import { soundEngine } from './spatial-audio';

declare const AFRAME: any;
declare const THREE: any;

function distanceToSegment(
  point: THREE.Vector3,
  segA: THREE.Vector3,
  segB: THREE.Vector3
): { dist: number; closestPoint: THREE.Vector3 } {
  const ab = new THREE.Vector3().subVectors(segB, segA);
  const ap = new THREE.Vector3().subVectors(point, segA);
  const abLenSq = ab.lengthSq();
  if (abLenSq < 1e-6) {
    return { dist: point.distanceTo(segA), closestPoint: segA.clone() };
  }
  const t = Math.max(0, Math.min(1, ap.dot(ab) / abLenSq));
  const closestPoint = new THREE.Vector3().copy(segA).addScaledVector(ab, t);
  return { dist: point.distanceTo(closestPoint), closestPoint };
}

AFRAME.registerComponent('hand-striker', {
  schema: {
    minStrikeSpeed: { type: 'number', default: 0.15 }, // Min hand speed (m/s) to register active swing
    powerMultiplier: { type: 'number', default: 3.8 },
    maxBallSpeed: { type: 'number', default: 26.0 }, // Cap at ~58 mph for crisp high-speed play
    debounceMs: { type: 'number', default: 110 }, // Cooldown to prevent double strikes
    strikeRadius: { type: 'number', default: 0.36 }, // 36cm generous strike volume around hand
    strikeThickness: { type: 'number', default: 0.055 },
    spinMultiplier: { type: 'number', default: 1.15 },
    spinFollowThroughMs: { type: 'number', default: 180 },
  },

  init: function () {
    this.leftHandEl = document.querySelector('#left-hand');
    this.rightHandEl = document.querySelector('#right-hand');
    this.cameraEl = document.querySelector('#player-camera');
    this.gameManagerEl = document.querySelector('#game-scene');
    this.lastStrikeTime = 0;
    this.spinFollowThrough = null;

    // Desktop fallback strike trigger (Click or Spacebar)
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Space' && !this.isImmersiveSessionActive()) {
        this.triggerDesktopStrike();
      }
    });

    window.addEventListener('mousedown', (e: MouseEvent) => {
      if (this.isImmersiveSessionActive()) return;
      if ((e.target as HTMLElement)?.closest('.game-ui-btn') || (e.target as HTMLElement)?.closest('#help-modal')) return;
      this.triggerDesktopStrike();
    });
  },

  isImmersiveSessionActive: function () {
    const scene = this.el.sceneEl || document.querySelector('#game-scene');
    return Boolean(
      scene?.is?.('vr-mode')
      || scene?.is?.('ar-mode')
      || scene?.renderer?.xr?.isPresenting
    );
  },

  tick: function () {
    const ballPhysics = this.el.components['handball-physics'];
    if (!ballPhysics || !ballPhysics.data.active || ballPhysics.data.isHeld) return;

    const now = performance.now();
    this.updateSpinFollowThrough(now, ballPhysics);
    if (now - this.lastStrikeTime < this.data.debounceMs) return;

    const ballPos = this.el.object3D.position;
    const ballRadius = ballPhysics.data.radius;

    // 1. Check Right Hand
    if (this.rightHandEl && this.rightHandEl.components['hand-tracker']) {
      const data = this.rightHandEl.components['hand-tracker'].getVelocityData();
      if (this.checkHandHit(data, ballPos, ballRadius, ballPhysics, 'right', this.rightHandEl)) {
        this.lastStrikeTime = now;
        return;
      }
    }

    // 2. Check Left Hand
    if (this.leftHandEl && this.leftHandEl.components['hand-tracker']) {
      const data = this.leftHandEl.components['hand-tracker'].getVelocityData();
      if (this.checkHandHit(data, ballPos, ballRadius, ballPhysics, 'left', this.leftHandEl)) {
        this.lastStrikeTime = now;
        return;
      }
    }
  },

  checkHandHit: function (
    handData: any,
    ballPos: THREE.Vector3,
    ballRadius: number,
    ballPhysics: any,
    side: string,
    handEl: any
  ): boolean {
    if (!handData.isTracked || handData.isRecovering) {
      return false;
    }

    const hitRadius = this.data.strikeRadius + ballRadius;
    const hitThickness = this.data.strikeThickness + ballRadius;
    let hitDetected = false;
    let closestHandPos = handData.position.clone();
    const palmNormal = handData.palmNormal.clone().normalize();

    const intersectsPitchedDisc = (palmCenter: any) => {
      const toBall = new THREE.Vector3().subVectors(ballPos, palmCenter);
      const planeDistance = toBall.dot(palmNormal);
      const radialDistance = toBall.addScaledVector(palmNormal, -planeDistance).length();
      return Math.abs(planeDistance) <= hitThickness && radialDistance <= hitRadius;
    };

    // The visible pitched disk is now the actual collision surface. Test its
    // current pose and a swept palm-center segment to retain high-speed hits.
    if (intersectsPitchedDisc(handData.position)) {
      hitDetected = true;
    } else if (handData.previousPosition && !handData.isRecovering) {
      const sweptPalm = distanceToSegment(ballPos, handData.previousPosition, handData.position);
      closestHandPos.copy(sweptPalm.closestPoint);
      hitDetected = intersectsPitchedDisc(closestHandPos);
    }

    if (!hitDetected) return false;

    const handVel = handData.velocity;
    const handSpeed = Math.min(handVel.length(), 12.0);

    // Use the outward side of the pitched palm plane that faces the ball.
    const normal = palmNormal.clone();
    if (new THREE.Vector3().subVectors(ballPos, closestHandPos).dot(normal) < 0) {
      normal.negate();
    }

    // Compute strike impulse trajectory:
    // Blend hand velocity direction with palm/contact normal
    let strikeDir = new THREE.Vector3();
    if (handSpeed > 0.2) {
      strikeDir.copy(handVel).normalize().multiplyScalar(0.55).addScaledVector(normal, 0.45).normalize();
    } else {
      strikeDir.copy(normal);
    }

    // Ensure trajectory always propels toward front wall (-z)
    if (strikeDir.z > -0.2) {
      strikeDir.z = -Math.max(Math.abs(strikeDir.z), 0.75);
    }
    // Slight upward angle if striking below chest level
    if (strikeDir.y < 0.15 && ballPos.y < 1.35) {
      strikeDir.y = 0.22;
    }
    strikeDir.normalize();

    // High Power Scaling for VR Bare Hands:
    // Any clean forward hand motion produces a crisp, energetic shot.
    const incomingSpeed = Math.min(ballPhysics.velocity.length(), 22.0);
    const baseHandPower = Math.max(handSpeed * this.data.powerMultiplier, 11.0); // Min 11 m/s (~25 mph)
    const reboundElasticity = incomingSpeed * 0.52; // High rubber handball elasticity rebound
    const baseSpeed = baseHandPower + reboundElasticity;
    const finalSpeed = Math.min(Math.max(baseSpeed, 11.5), this.data.maxBallSpeed); // 25.7 mph to 58.2 mph

    const newVelocity = strikeDir.multiplyScalar(finalSpeed);
    const angularHandMotion = (handData.angularVelocity || new THREE.Vector3())
      .clone()
      .multiplyScalar(this.data.spinMultiplier);
    const tangentialSpin = handVel.clone().cross(normal).multiplyScalar(0.7);
    const initialSpin = angularHandMotion.add(tangentialSpin);
    if (initialSpin.length() > 34) initialSpin.setLength(34);
    ballPhysics.applyImpulse(newVelocity, initialSpin);
    this.spinFollowThrough = {
      handEl,
      normal: normal.clone(),
      expiresAt: performance.now() + this.data.spinFollowThroughMs,
    };

    const speedMph = finalSpeed * 2.23694;
    let quality = 'Solid';
    if (speedMph > 40 && Math.abs(newVelocity.y) < 1.4) {
      quality = 'KillShot';
    } else if (speedMph > 28) {
      quality = 'Solid';
    } else if (speedMph > 18) {
      quality = 'Glancing';
    } else {
      quality = 'Soft';
    }

    // Audio & Haptic triggers
    soundEngine.playHandStrike(finalSpeed, quality);

    if (handEl.components['hand-tracker']) {
      const hapticStrength = Math.min(finalSpeed / 20, 1.0);
      handEl.components['hand-tracker'].triggerHaptic(hapticStrength, 90);
    }

    // Emit ball struck event
    this.el.emit('ball-struck', {
      side,
      speedMps: finalSpeed,
      speedMph,
      quality,
      position: { x: ballPos.x, y: ballPos.y, z: ballPos.z },
    });

    // Auto-transition game manager to active play if serving or idle
    const gm = this.gameManagerEl?.components['handball-game-manager'];
    if (gm && (gm.state === 'Idle' || gm.state === 'Serving' || gm.state === 'PointScored' || gm.state === 'Fault')) {
      gm.state = 'InPlay';
      gm.updateScoreboardDisplay();
      gm.emitStateChange();
    }

    return true;
  },

  updateSpinFollowThrough: function (now: number, ballPhysics: any) {
    const followThrough = this.spinFollowThrough;
    if (!followThrough) return;
    if (now >= followThrough.expiresAt) {
      this.spinFollowThrough = null;
      return;
    }

    const tracker = followThrough.handEl?.components?.['hand-tracker'];
    if (!tracker) return;
    const handData = tracker.getVelocityData();
    if (!handData.isTracked || handData.isRecovering) return;

    const desiredSpin = handData.angularVelocity.clone().multiplyScalar(this.data.spinMultiplier);
    desiredSpin.add(handData.velocity.clone().cross(followThrough.normal).multiplyScalar(0.45));
    if (desiredSpin.length() > 34) desiredSpin.setLength(34);

    const remaining = (followThrough.expiresAt - now) / this.data.spinFollowThroughMs;
    ballPhysics.blendSpin(desiredSpin, 0.12 + remaining * 0.18);
  },

  triggerDesktopStrike: function () {
    if (this.isImmersiveSessionActive()) return;

    const ballPhysics = this.el.components['handball-physics'];
    if (!ballPhysics || !ballPhysics.data.active) return;

    const ballPos = this.el.object3D.position;
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();

    if (this.cameraEl) {
      this.cameraEl.object3D.getWorldPosition(camPos);
      this.cameraEl.object3D.getWorldDirection(camDir);
      camDir.negate();
    } else {
      camPos.set(0, 1.6, 6.5);
      camDir.set(0, 0, -1);
    }

    const distToBall = camPos.distanceTo(ballPos);
    if (distToBall < 4.0) {
      // Scaled down to match natural comfortable hand-tracking strike range (11.5 - 13.5 m/s ~ 26-30 mph)
      const speed = 11.5 + Math.random() * 2.0;
      const strikeDir = camDir.clone().normalize();
      if (strikeDir.z > -0.2) strikeDir.z = -0.85;
      strikeDir.y += 0.16;
      strikeDir.normalize();

      const newVelocity = strikeDir.multiplyScalar(speed);
      ballPhysics.applyImpulse(newVelocity);

      const speedMph = speed * 2.23694;
      soundEngine.playHandStrike(speed, speedMph > 32 ? 'Solid' : 'Glancing');

      this.el.emit('ball-struck', {
        side: 'desktop',
        speedMps: speed,
        speedMph,
        quality: speedMph > 32 ? 'Solid' : 'Glancing',
        position: { x: ballPos.x, y: ballPos.y, z: ballPos.z },
      });

      const gm = this.gameManagerEl?.components['handball-game-manager'];
      if (gm && (gm.state === 'Idle' || gm.state === 'Serving' || gm.state === 'PointScored' || gm.state === 'Fault')) {
        gm.state = 'InPlay';
        gm.updateScoreboardDisplay();
        gm.emitStateChange();
      }
    }
  },
});

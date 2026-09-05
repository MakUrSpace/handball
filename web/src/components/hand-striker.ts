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
    minStrikeSpeed: { type: 'number', default: 0.4 }, // Threshold where a contact becomes an active swing
    contactElasticity: { type: 'number', default: 1.12 }, // Slight energy return keeps passive blocks lively
    powerMultiplier: { type: 'number', default: 0.16 }, // Speed multiplier added per m/s of effective swing
    maxBallSpeed: { type: 'number', default: 27.0 }, // Cap at ~60 mph to keep hard swings playable
    debounceMs: { type: 'number', default: 110 }, // Cooldown to prevent double strikes
    strikeRadius: { type: 'number', default: 0.36 }, // 36cm generous strike volume around hand
    strikeThickness: { type: 'number', default: 0.055 },
    spinMultiplier: { type: 'number', default: 0.9 },
    spinFollowThroughMs: { type: 'number', default: 180 },
  },

  init: function () {
    this.leftHandEl = document.querySelector('#left-hand');
    this.rightHandEl = document.querySelector('#right-hand');
    this.cameraEl = document.querySelector('#player-camera');
    this.gameManagerEl = document.querySelector('#game-scene');
    this.lastStrikeTime = 0;
    this.spinFollowThrough = null;
    this.previousBallPosition = null;

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
    if (!ballPhysics || !ballPhysics.data.active || ballPhysics.data.isHeld) {
      this.previousBallPosition = null;
      return;
    }

    const ballPos = this.el.object3D.position;
    const ballRadius = ballPhysics.data.radius;
    const previousBallPos = this.previousBallPosition?.clone?.() || ballPos.clone();
    this.previousBallPosition = ballPos.clone();

    const now = performance.now();
    this.updateSpinFollowThrough(now, ballPhysics);
    if (now - this.lastStrikeTime < this.data.debounceMs) return;

    // 1. Check Right Hand
    if (this.rightHandEl && this.rightHandEl.components['hand-tracker']) {
      const data = this.rightHandEl.components['hand-tracker'].getVelocityData();
      if (this.checkHandHit(data, ballPos, previousBallPos, ballRadius, ballPhysics, 'right', this.rightHandEl)) {
        this.lastStrikeTime = now;
        return;
      }
    }

    // 2. Check Left Hand
    if (this.leftHandEl && this.leftHandEl.components['hand-tracker']) {
      const data = this.leftHandEl.components['hand-tracker'].getVelocityData();
      if (this.checkHandHit(data, ballPos, previousBallPos, ballRadius, ballPhysics, 'left', this.leftHandEl)) {
        this.lastStrikeTime = now;
        return;
      }
    }
  },

  checkHandHit: function (
    handData: any,
    ballPos: THREE.Vector3,
    previousBallPos: THREE.Vector3,
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

    const sweptBallIntersectsDisc = (palmCenter: any) => {
      if (!previousBallPos || previousBallPos.distanceTo(ballPos) > 1.5) return false;
      const previousOffset = new THREE.Vector3().subVectors(previousBallPos, palmCenter);
      const currentOffset = new THREE.Vector3().subVectors(ballPos, palmCenter);
      const previousPlaneDistance = previousOffset.dot(palmNormal);
      const currentPlaneDistance = currentOffset.dot(palmNormal);
      if (previousPlaneDistance * currentPlaneDistance > 0
        && Math.min(Math.abs(previousPlaneDistance), Math.abs(currentPlaneDistance)) > hitThickness) {
        return false;
      }
      const denominator = previousPlaneDistance - currentPlaneDistance;
      const t = Math.max(0, Math.min(1, Math.abs(denominator) > 1e-6
        ? previousPlaneDistance / denominator
        : 0));
      const crossingPoint = new THREE.Vector3().lerpVectors(previousBallPos, ballPos, t);
      const radialOffset = new THREE.Vector3().subVectors(crossingPoint, palmCenter);
      radialOffset.addScaledVector(palmNormal, -radialOffset.dot(palmNormal));
      return radialOffset.length() <= hitRadius;
    };

    // The visible pitched disk is now the actual collision surface. Test its
    // current pose and a swept palm-center segment to retain high-speed hits.
    if (intersectsPitchedDisc(handData.position)) {
      hitDetected = true;
    } else if (sweptBallIntersectsDisc(handData.position)) {
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

    const closingSpeed = Math.max(0, handVel.dot(normal));
    const hasActiveSwing = handSpeed >= this.data.minStrikeSpeed;
    const swingSpeed = hasActiveSwing ? Math.max(closingSpeed, handSpeed * 0.5) : 0;
    const swingMultiplier = 1 + Math.min(swingSpeed * this.data.powerMultiplier, 0.65);
    const incomingSpeed = ballPhysics.velocity.length();

    // Contact with a motionless ball only becomes a strike when the player
    // supplies an actual swing. A held disc remains inert until the ball arrives.
    if (incomingSpeed < 0.25 && !hasActiveSwing) return false;

    // Passive contact follows the disc normal. As the arm accelerates, the
    // actual swing direction rapidly takes over both aim and power.
    let strikeDir = new THREE.Vector3();
    if (hasActiveSwing && handSpeed > 0.01) {
      const swingInfluence = Math.min(0.55, swingSpeed * 0.14);
      strikeDir.copy(normal).multiplyScalar(1 - swingInfluence)
        .addScaledVector(handVel.clone().normalize(), swingInfluence)
        .normalize();
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

    // Passive contact is slightly super-elastic so a block feels springy after
    // court and air losses. An actual swing applies an additional bounded gain.
    // A separate baseline lets a physical swing launch a nearly stationary serve.
    const elasticSpeed = incomingSpeed >= 0.25 ? incomingSpeed : 8.0;
    const finalSpeed = Math.min(
      elasticSpeed * this.data.contactElasticity * swingMultiplier,
      this.data.maxBallSpeed
    );

    const newVelocity = strikeDir.multiplyScalar(finalSpeed);
    const spinInfluence = Math.min(swingSpeed / 3.5, 1);
    let initialSpin = ballPhysics.angularVelocity.clone();
    if (hasActiveSwing) {
      const angularHandMotion = (handData.angularVelocity || new THREE.Vector3())
        .clone()
        .multiplyScalar(this.data.spinMultiplier * spinInfluence);
      const tangentialSpin = handVel.clone().cross(normal).multiplyScalar(0.45 * spinInfluence);
      initialSpin = angularHandMotion.add(tangentialSpin);
      if (initialSpin.length() > 20) initialSpin.setLength(20);
    }
    ballPhysics.applyImpulse(newVelocity, initialSpin);
    this.spinFollowThrough = hasActiveSwing ? {
      handEl,
      normal: normal.clone(),
      spinInfluence,
      expiresAt: performance.now() + this.data.spinFollowThroughMs,
    } : null;

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
      handSpeed,
      swingMultiplier,
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

    const desiredSpin = handData.angularVelocity.clone()
      .multiplyScalar(this.data.spinMultiplier * followThrough.spinInfluence);
    desiredSpin.add(
      handData.velocity.clone().cross(followThrough.normal)
        .multiplyScalar(0.35 * followThrough.spinInfluence)
    );
    if (desiredSpin.length() > 20) desiredSpin.setLength(20);

    const remaining = (followThrough.expiresAt - now) / this.data.spinFollowThroughMs;
    ballPhysics.blendSpin(desiredSpin, 0.08 + remaining * 0.12);
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

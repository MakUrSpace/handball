/**
 * A-Frame Component: handball-physics
 * Real-time ball physics simulation with sub-stepped Euler integration,
 * continuous boundary collision resolution, gentle pre-serve hover mode,
 * and audio triggers.
 */

import { COURT_DIMENSIONS } from './court';
import { soundEngine } from './spatial-audio';

declare const AFRAME: any;
declare const THREE: any;

AFRAME.registerComponent('handball-physics', {
  schema: {
    radius: { type: 'number', default: 0.025 },
    mass: { type: 'number', default: 0.065 },
    gravity: { type: 'number', default: -9.81 },
    airDrag: { type: 'number', default: 0.0012 },
    spinDrag: { type: 'number', default: 0.45 },
    magnusCoefficient: { type: 'number', default: 0.0045 },
    frontWallRestitution: { type: 'number', default: 0.93 },
    sideWallRestitution: { type: 'number', default: 0.88 },
    floorRestitution: { type: 'number', default: 0.92 },
    floorFriction: { type: 'number', default: 0.985 },
    rollingDrag: { type: 'number', default: 0.4 },
    ceilingRestitution: { type: 'number', default: 0.82 },
    backWallRestitution: { type: 'number', default: 0.86 },
    isHeld: { type: 'boolean', default: false },
    active: { type: 'boolean', default: true },
  },

  init: function () {
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.angularVelocity = new THREE.Vector3(0, 0, 0);
    this.spawnPos = new THREE.Vector3(0.2, 1.25, 6.2);
    this.isHovering = true; // Hover mode before first strike
    this.bouncesSinceStrike = 0;
    this.frontWallHit = false;
    this.lastHitTime = 0;

    // Ball visual representation
    this.mesh = this.el.getObject3D('mesh');
    if (!this.mesh) {
      const geometry = new THREE.SphereGeometry(this.data.radius, 32, 32);
      const material = new THREE.MeshStandardMaterial({
        color: 0x0099ff, // Regulation vibrant blue handball
        roughness: 0.45,
        metalness: 0.1,
      });
      this.mesh = new THREE.Mesh(geometry, material);
      this.mesh.castShadow = true;
      this.el.setObject3D('mesh', this.mesh);
    }

    // High-speed speed glow trail light
    this.ballLight = document.createElement('a-light');
    this.ballLight.setAttribute('type', 'point');
    this.ballLight.setAttribute('intensity', '0.25');
    this.ballLight.setAttribute('distance', '2.0');
    this.ballLight.setAttribute('color', '#38bdf8');
    this.el.appendChild(this.ballLight);
  },

  tick: function (time: number, timeDelta: number) {
    if (!this.data.active || this.data.isHeld) return;

    // Hover mode: ball gently floats in place waiting for the player's swing
    if (this.isHovering) {
      const pos = this.el.object3D.position;
      pos.x = this.spawnPos.x;
      pos.y = this.spawnPos.y + Math.sin(time / 300) * 0.02;
      pos.z = this.spawnPos.z;
      this.velocity.set(0, 0, 0);
      return;
    }

    const dt = Math.min(timeDelta / 1000, 0.04);
    if (dt <= 0) return;

    // Sub-stepping for accurate collision response
    const substeps = 4;
    const subDt = dt / substeps;

    for (let s = 0; s < substeps; s++) {
      this.substep(subDt);
    }

    // Rotate the ball visual using the same angular velocity that produces
    // aerodynamic curve, keeping rendering and gameplay spin synchronized.
    const spinSpeed = this.angularVelocity.length();
    if (this.mesh && spinSpeed > 0.01) {
      const spinAxis = this.angularVelocity.clone().normalize();
      this.mesh.rotateOnWorldAxis(spinAxis, spinSpeed * dt);
    }

    // Update ball light intensity according to speed
    const speedMph = this.getSpeedMph();
    if (this.ballLight) {
      const glow = Math.min(speedMph / 60, 1.0);
      this.ballLight.setAttribute('intensity', (0.25 + glow * 0.8).toString());
      if (speedMph > 45 && this.mesh && this.mesh.material) {
        this.mesh.material.emissive = new THREE.Color(0x00ffff);
        this.mesh.material.emissiveIntensity = Math.min((speedMph - 45) / 30, 0.8);
      } else if (this.mesh && this.mesh.material) {
        this.mesh.material.emissiveIntensity = 0;
      }
    }
  },

  substep: function (dt: number) {
    const pos = this.el.object3D.position;
    const vel = this.velocity;
    const radius = this.data.radius;
    const { length, width, height } = COURT_DIMENSIONS;
    const halfW = width / 2;

    // Apply gravity
    vel.y += this.data.gravity * dt;

    // Apply aerodynamic drag
    const speed = vel.length();
    if (speed > 0.001) {
      const dragFactor = Math.max(1.0 - (this.data.airDrag * speed * dt) / this.data.mass, 0.0);
      vel.multiplyScalar(dragFactor);
    }

    // Magnus acceleration curves a spinning ball perpendicular to its flight.
    if (this.angularVelocity.lengthSq() > 0.001 && speed > 0.1) {
      const magnusAcceleration = this.angularVelocity.clone()
        .cross(vel)
        .multiplyScalar(this.data.magnusCoefficient);
      vel.addScaledVector(magnusAcceleration, dt);
    }
    this.angularVelocity.multiplyScalar(Math.exp(-this.data.spinDrag * dt));

    // Integrate position
    pos.addScaledVector(vel, dt);

    // Collision Detection against Court Bounds:

    // 1. Front Wall (z = 0)
    if (pos.z - radius <= 0) {
      const impactSpeed = Math.abs(vel.z);
      pos.z = radius;
      vel.z = -vel.z * this.data.frontWallRestitution;
      vel.x *= 0.98;
      vel.y *= 0.98;
      this.angularVelocity.multiplyScalar(0.94);
      this.frontWallHit = true;
      soundEngine.playFrontWallHit(impactSpeed);
      this.emitCollision('front-wall', impactSpeed, pos);
    }

    // 2. Back Glass Wall (z = length)
    if (pos.z + radius >= length) {
      const impactSpeed = Math.abs(vel.z);
      pos.z = length - radius;
      vel.z = -vel.z * this.data.backWallRestitution;
      soundEngine.playSideWallHit(impactSpeed);
      this.emitCollision('back-wall', impactSpeed, pos);
    }

    // 3. Left Wall (x = -halfW)
    if (pos.x - radius <= -halfW) {
      const impactSpeed = Math.abs(vel.x);
      pos.x = -halfW + radius;
      vel.x = -vel.x * this.data.sideWallRestitution;
      soundEngine.playSideWallHit(impactSpeed);
      this.emitCollision('left-wall', impactSpeed, pos);
    }

    // 4. Right Wall (x = halfW)
    if (pos.x + radius >= halfW) {
      const impactSpeed = Math.abs(vel.x);
      pos.x = halfW - radius;
      vel.x = -vel.x * this.data.sideWallRestitution;
      soundEngine.playSideWallHit(impactSpeed);
      this.emitCollision('right-wall', impactSpeed, pos);
    }

    // 5. Floor (y = 0)
    if (pos.y - radius <= 0) {
      const impactSpeed = Math.abs(vel.y);
      pos.y = radius;
      if (impactSpeed < 0.22) {
        // Once a bounce is genuinely spent, transition to rolling with a
        // time-based drag. This avoids applying a large friction penalty on
        // every floor-constrained physics substep.
        vel.y = 0;
        const rollingFactor = Math.exp(-this.data.rollingDrag * dt);
        vel.x *= rollingFactor;
        vel.z *= rollingFactor;
        this.angularVelocity.multiplyScalar(Math.exp(-0.25 * dt));
        if (Math.hypot(vel.x, vel.z) < 0.015) {
          vel.x = 0;
          vel.z = 0;
        }
      } else {
        vel.y = impactSpeed * this.data.floorRestitution;
        vel.x *= this.data.floorFriction;
        vel.z *= this.data.floorFriction;
        this.angularVelocity.multiplyScalar(0.95);
        soundEngine.playFloorBounce(impactSpeed);
        this.bouncesSinceStrike++;
        this.emitCollision('floor', impactSpeed, pos);
      }
    }

    // 6. Ceiling (y = height)
    if (pos.y + radius >= height) {
      const impactSpeed = Math.abs(vel.y);
      pos.y = height - radius;
      vel.y = -vel.y * this.data.ceilingRestitution;
      soundEngine.playSideWallHit(impactSpeed);
      this.emitCollision('ceiling', impactSpeed, pos);
    }
  },

  emitCollision: function (surface: string, speed: number, position: THREE.Vector3) {
    this.el.emit('ball-collision', {
      surface,
      speed,
      position: { x: position.x, y: position.y, z: position.z },
      bouncesSinceStrike: this.bouncesSinceStrike,
      frontWallHit: this.frontWallHit,
    });
  },

  applyImpulse: function (newVelocity: THREE.Vector3, newSpin?: THREE.Vector3) {
    this.isHovering = false; // Launch physics immediately
    this.velocity.copy(newVelocity);
    if (newSpin) {
      this.angularVelocity.copy(newSpin);
    } else {
      this.angularVelocity.set(0, 0, 0);
    }
    this.bouncesSinceStrike = 0;
    this.frontWallHit = false;
    this.lastHitTime = performance.now();
  },

  blendSpin: function (targetSpin: THREE.Vector3, influence: number) {
    this.angularVelocity.lerp(targetSpin, Math.min(Math.max(influence, 0), 1));
  },

  resetBall: function (x?: number, y: number = 1.25, z: number = 6.2) {
    const isNarrow = COURT_DIMENSIONS.mode === 'narrow';
    const spawnX = x !== undefined ? x : (isNarrow ? 0.0 : 0.2);
    this.spawnPos.set(spawnX, y, z);
    this.el.object3D.position.set(spawnX, y, z);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.isHovering = true; // Keep floating until struck
    this.bouncesSinceStrike = 0;
    this.frontWallHit = false;
  },

  serveToss: function (serveSpeed: number = 13.5) {
    this.isHovering = false;
    this.resetBall(0.0, 1.25, 6.2);
    this.isHovering = false;
    this.velocity.set(0, 2.8, -serveSpeed);
    this.angularVelocity.set(0, 0, 0);
    this.frontWallHit = false;
    this.bouncesSinceStrike = 0;
  },

  getSpeedMph: function (): number {
    return this.velocity.length() * 2.23694;
  },

  getSpeedKmh: function (): number {
    return this.velocity.length() * 3.6;
  },
});

/**
 * A-Frame Component: hand-tracker
 * Handles WebXR Hand Tracking (Meta Quest 3 joints), VR Motion Controllers,
 * continuous joint position extraction, exponential smoothing (jitter-free),
 * palm-plane laser pointer with pinch-clicking, and direct finger touch proximity.
 */

import { soundEngine } from './spatial-audio';

declare const AFRAME: any;
declare const THREE: any;

function palmQuaternionFromAxes(normal: any, upHint: any) {
  const zAxis = normal.clone().normalize();
  const yAxis = upHint.clone().addScaledVector(zAxis, -upHint.dot(zAxis));
  if (yAxis.lengthSq() < 1e-6) {
    // Pick a fallback that cannot be parallel to the palm normal.
    yAxis.copy(Math.abs(zAxis.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, -1));
    yAxis.addScaledVector(zAxis, -yAxis.dot(zAxis));
  }
  yAxis.normalize();
  const xAxis = yAxis.clone().cross(zAxis).normalize();
  yAxis.copy(zAxis).cross(xAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

export interface HandVelocityData {
  position: THREE.Vector3;
  previousPosition: THREE.Vector3;
  velocity: THREE.Vector3;
  palmNormal: THREE.Vector3;
  palmQuaternion: THREE.Quaternion;
  angularVelocity: THREE.Vector3;
  speedMps: number;
  contactPoints: THREE.Vector3[];
  isTracked: boolean;
  isRecovering: boolean;
  inputMode: 'hand' | 'controller' | 'none';
}

AFRAME.registerComponent('hand-tracker', {
  schema: {
    hand: { type: 'string', default: 'right' }, // 'left' or 'right'
    colliderRadius: { type: 'number', default: 0.08 }, // Palm collision radius (8 cm)
    contactRadius: { type: 'number', default: 0.22 }, // Visible ball-contact area (22 cm)
    controllerContactOffset: { type: 'number', default: 0.055 }, // Move disc from grip center toward controller face
    enableLaser: { type: 'boolean', default: true },
    contactColor: { type: 'color', default: '#4ade80' },
    contactOpacity: { type: 'number', default: 0.08 },
    ringOpacity: { type: 'number', default: 0.4 },
    glowIntensity: { type: 'number', default: 0 },
  },

  init: function () {
    this.handSide = this.data.hand;
    this.currentPosition = new THREE.Vector3();
    this.previousPosition = new THREE.Vector3();
    this.currentVelocity = new THREE.Vector3();
    this.palmNormal = new THREE.Vector3(0, 0, -1);
    this.currentPalmQuaternion = new THREE.Quaternion();
    this.previousPalmQuaternion = new THREE.Quaternion();
    this.angularVelocity = new THREE.Vector3();
    this.pointingDir = new THREE.Vector3(0, 0, -1);
    this.contactPoints = [];
    this.inputMode = 'none';

    this.wasTracked = false;
    this.isTracked = false;
    this.recoveryGraceUntil = 0;
    this.lastTouchTriggerTime = 0;
    this.hoveredButton = null;

    // Raycaster for laser pointer
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 10.0;

    // World-space contact-area disk. Its radius matches the configured strike
    // radius in the scene so players can see exactly how close a ball must be.
    const auraRadius = this.data.contactRadius;
    const palmGeo = new THREE.CircleGeometry(auraRadius, 48);
    const palmMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.data.contactColor),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: this.data.contactOpacity,
      depthTest: false,
      depthWrite: false,
    });
    this.auraMesh = new THREE.Mesh(palmGeo, palmMat);
    this.auraMesh.name = `hand_aura_disc_${this.handSide}`;
    this.auraMesh.renderOrder = 20;
    this.auraMesh.visible = false;

    if (this.data.glowIntensity > 0) {
      this.auraGlow = new THREE.PointLight(
        new THREE.Color(this.data.contactColor),
        this.data.glowIntensity,
        1.1,
        2,
      );
      this.auraGlow.position.set(0, 0, 0.025);
      this.auraMesh.add(this.auraGlow);
    }

    // A crisp perimeter keeps the contact radius readable against either a
    // rendered court or a passthrough camera feed.
    const ringGeo = new THREE.RingGeometry(auraRadius, auraRadius + 0.015, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.data.contactColor),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: this.data.ringOpacity,
      depthTest: false,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    this.auraMesh.add(ringMesh);

    this.sceneGroup = this.el.sceneEl?.object3D || (document.querySelector('#game-scene') as any)?.object3D;
    if (this.sceneGroup) {
      this.sceneGroup.add(this.auraMesh);
    }

    // Visual Laser Beam Geometry & Material
    if (this.data.enableLaser) {
      this.setupLaserVisuals();
    }

    // Bind WebXR pinch & controller click events
    this.bindPinchAndClickEvents();
  },

  setupLaserVisuals: function () {
    const laserGroup = new THREE.Group();
    laserGroup.name = `laserGroup_${this.handSide}`;

    // 1. Sleek Laser Beam Cylinder centered at (0,0,0) spanning -0.5 to +0.5 along Z
    const laserGeo = new THREE.CylinderGeometry(0.002, 0.0035, 1.0, 8);
    laserGeo.rotateX(Math.PI / 2); // Spans from z = -0.5 to z = +0.5
    const laserMat = new THREE.MeshBasicMaterial({
      color: this.handSide === 'right' ? 0x38bdf8 : 0xa855f7,
      transparent: true,
      opacity: 0.75,
    });
    this.laserBeamMesh = new THREE.Mesh(laserGeo, laserMat);
    laserGroup.add(this.laserBeamMesh);

    // 2. Glowing Intersection Cursor Ring
    const ringGeo = new THREE.RingGeometry(0.012, 0.022, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: this.handSide === 'right' ? 0x38bdf8 : 0xa855f7,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.laserReticleMesh = new THREE.Mesh(ringGeo, ringMat);
    this.laserReticleMesh.visible = false;
    laserGroup.add(this.laserReticleMesh);

    this.sceneGroup = this.sceneGroup || (document.querySelector('#game-scene') as any)?.object3D;
    if (this.sceneGroup) {
      this.sceneGroup.add(laserGroup);
    }
    this.laserGroup = laserGroup;
  },

  bindPinchAndClickEvents: function () {
    const onSelect = (evt: any) => {
      if (this.hoveredButton) {
        const vrBtnComp = this.hoveredButton.components?.['vr-button'];

        // Controller triggers may operate ordinary 3D controls, but serving
        // remains a physical tap on the left-wrist control.
        if (this.inputMode === 'controller' && vrBtnComp?.data?.action === 'serve') return;

        evt?.stopPropagation?.();
        if (vrBtnComp) {
          vrBtnComp.triggerAction();
        } else {
          this.hoveredButton.emit('click', { hand: this.handSide });
        }
        this.triggerHaptic(0.7, 60);
      }
    };

    this.el.addEventListener('selectstart', onSelect);
    this.el.addEventListener('select', onSelect);
    this.el.addEventListener('pinchstarted', onSelect);
    this.el.addEventListener('triggerdown', onSelect);

    this.el.addEventListener('controllerconnected', (evt: any) => {
      this.controller = evt.detail;
    });

    this.el.addEventListener('controllerdisconnected', () => {
      this.controller = null;
      this.wasTracked = false;
      this.isTracked = false;
      this.inputMode = 'none';
      if (this.laserGroup) this.laserGroup.visible = false;
      if (this.auraMesh) this.auraMesh.visible = false;
    });
  },

  tick: function (_time: number, timeDelta: number) {
    const dt = Math.min(Math.max(timeDelta / 1000, 0.005), 0.05);

    const now = performance.now();

    // 1. Check entity visibility / active state
    const isVisible = this.el.object3D.visible;
    if (!isVisible) {
      this.wasTracked = false;
      this.isTracked = false;
      this.inputMode = 'none';
      this.currentVelocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      if (this.laserGroup) this.laserGroup.visible = false;
      if (this.auraMesh) this.auraMesh.visible = false;
      return;
    }

    // 2. Resolve true world position for WebXR Hand Tracking & Controllers
    const rawPos = new THREE.Vector3();
    const contactPoints: THREE.Vector3[] = [];
    const rawPalmNormal = new THREE.Vector3(0, 0, -1);
    const rawPalmQuaternion = new THREE.Quaternion();
    let hasTrackedPose = false;
    let detectedInputMode: 'hand' | 'controller' | 'none' = 'none';

    const handControls = this.el.components['hand-tracking-controls'];
    const trackedControls = this.el.components['tracked-controls'];
    const inputSource = trackedControls?.controller;
    const hasLiveHandPose = Boolean(
      inputSource?.hand
      && handControls?.hasPoses
      && handControls?.bones?.length > 0
    );
    const hasLiveControllerPose = Boolean(inputSource && !inputSource.hand);

    // The hand mesh and its bones remain loaded when a physical controller is
    // active. Only use those bones when WebXR reports a live XRHand pose;
    // otherwise they contain a stale bind pose and mask the controller grip.
    if (hasLiveHandPose) {
      const bones = handControls.bones;
      const wristBone = handControls.bones[0];
      const indexKnuckle = bones[6] || bones[5];
      const middleKnuckle = bones[11] || bones[10];
      const ringKnuckle = bones[16] || bones[15];
      const pinkyKnuckle = bones[21] || bones[20];

      const readJoint = (bone: any) => {
        if (!bone) return null;
        const point = new THREE.Vector3();
        bone.getWorldPosition(point);
        return point;
      };

      const wrist = readJoint(wristBone);
      const index = readJoint(indexKnuckle);
      const middle = readJoint(middleKnuckle);
      const ring = readJoint(ringKnuckle);
      const pinky = readJoint(pinkyKnuckle);
      const knuckles = [index, middle, ring, pinky].filter(Boolean) as any[];

      if (wrist && knuckles.length >= 2) {
        const knuckleCenter = new THREE.Vector3();
        knuckles.forEach((point: any) => knuckleCenter.add(point));
        knuckleCenter.divideScalar(knuckles.length);
        rawPos.copy(wrist).lerp(knuckleCenter, 0.58);

        const palmUp = knuckleCenter.clone().sub(wrist).normalize();
        const acrossStart = pinky || ring;
        const acrossEnd = index || middle;
        if (acrossStart && acrossEnd) {
          const palmAcross = acrossEnd.clone().sub(acrossStart).normalize();
          rawPalmNormal.crossVectors(palmAcross, palmUp).normalize();
          if (this.handSide === 'left') rawPalmNormal.negate();
          rawPalmQuaternion.copy(palmQuaternionFromAxes(rawPalmNormal, palmUp));
          hasTrackedPose = true;
          detectedInputMode = 'hand';
        }
      }

      // Fingertips remain available for direct button pokes, but no longer
      // drive the selector or ball-contact center.
      [bones[4], bones[9], bones[14], bones[19], bones[24]].forEach((bone: any) => {
        const point = readJoint(bone);
        if (point) contactPoints.push(point);
      });
      if (hasTrackedPose) {
        contactPoints.push(rawPos.clone());
      }
    } else if (hasLiveControllerPose) {
      this.el.object3D.getWorldPosition(rawPos);
      const controllerOrientation = new THREE.Quaternion();
      this.el.object3D.getWorldQuaternion(controllerOrientation);

      // Touch controller grip space is not the same as its model-specific
      // pointing axis (Touch Plus is pitched substantially downward). Use the
      // active selector direction as the contact-plane normal so the disk is
      // perpendicular to the controller and parallel across the knuckles.
      const configuredDirection = this.el.components['raycaster']?.data?.direction;
      const localControllerNormal = configuredDirection
        ? new THREE.Vector3(configuredDirection.x, configuredDirection.y, configuredDirection.z)
        : new THREE.Vector3(0, 0, -1);
      if (localControllerNormal.lengthSq() < 1e-6) localControllerNormal.set(0, 0, -1);
      rawPalmNormal.copy(localControllerNormal)
        .normalize()
        .applyQuaternion(controllerOrientation)
        .normalize();
      const controllerUp = new THREE.Vector3(0, 1, 0).applyQuaternion(controllerOrientation);
      rawPalmQuaternion.copy(palmQuaternionFromAxes(rawPalmNormal, controllerUp));

      // WebXR's grip pose is centered inside the Touch controller handle.
      // Put the visible/physical contact plane just ahead of the controller so
      // it behaves like the palm surface rather than intersecting the handle.
      rawPos.addScaledVector(rawPalmNormal, this.data.controllerContactOffset);
      contactPoints.push(rawPos.clone());
      hasTrackedPose = true;
      detectedInputMode = 'controller';
    }

    if (!hasTrackedPose || (rawPos.x === 0 && rawPos.y === 0 && rawPos.z === 0)) {
      this.wasTracked = false;
      this.isTracked = false;
      this.inputMode = 'none';
      this.currentVelocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      if (this.laserGroup) this.laserGroup.visible = false;
      if (this.auraMesh) this.auraMesh.visible = false;
      return;
    }

    const inputModeChanged = this.inputMode !== detectedInputMode;
    this.inputMode = detectedInputMode;
    this.isTracked = true;

    // 3. Jitter-Free Exponential Moving Average (EMA) Smoothing
    if (!this.wasTracked || inputModeChanged) {
      this.wasTracked = true;
      this.currentPosition.copy(rawPos);
      this.previousPosition.copy(rawPos);
      this.currentVelocity.set(0, 0, 0);
      this.resetPalmPose(rawPalmQuaternion);
      this.recoveryGraceUntil = now + 100;
      this.contactPoints = contactPoints.length > 0 ? contactPoints : [rawPos.clone()];
      this.updateContactAura(this.currentPosition);
      return;
    }

    // Teleport jump filter (> 0.45m in a single frame)
    const jumpDistance = rawPos.distanceTo(this.currentPosition);
    if (jumpDistance > 0.45) {
      this.currentPosition.copy(rawPos);
      this.previousPosition.copy(rawPos);
      this.currentVelocity.set(0, 0, 0);
      this.resetPalmPose(rawPalmQuaternion);
      this.recoveryGraceUntil = now + 100;
      this.contactPoints = contactPoints.length > 0 ? contactPoints : [rawPos.clone()];
      this.updateContactAura(this.currentPosition);
      return;
    }

    // Smooth position (alpha = 0.70) to eliminate camera optical noise
    this.previousPosition.copy(this.currentPosition);
    this.currentPosition.lerp(rawPos, 0.70);
    this.contactPoints = contactPoints.length > 0 ? contactPoints : [this.currentPosition.clone()];

    // Estimate smooth velocity
    const instVel = new THREE.Vector3().subVectors(this.currentPosition, this.previousPosition).divideScalar(dt);
    if (instVel.length() > 14.0) {
      instVel.normalize().multiplyScalar(14.0);
    }
    this.currentVelocity.lerp(instVel, 0.60);
    this.updatePalmPose(rawPalmQuaternion, dt);
    this.updateContactAura(this.currentPosition);

    // 4. The selector emerges from the stable palm center and follows the
    // same pitched normal used by the contact disk and strike physics.
    const rayDir = this.palmNormal.clone();
    const rayOrigin = this.currentPosition.clone().addScaledVector(rayDir, 0.035);
    this.pointingDir.copy(rayDir);
    this.updateLaserAndTouch(rayOrigin, rayDir, now);
  },

  resetPalmPose: function (orientation: any) {
    this.currentPalmQuaternion.copy(orientation);
    this.previousPalmQuaternion.copy(orientation);
    this.palmNormal.set(0, 0, 1).applyQuaternion(orientation).normalize();
    this.pointingDir.copy(this.palmNormal);
    this.angularVelocity.set(0, 0, 0);
  },

  updatePalmPose: function (orientation: any, dt: number) {
    this.previousPalmQuaternion.copy(this.currentPalmQuaternion);
    this.currentPalmQuaternion.slerp(orientation, 0.68).normalize();
    this.palmNormal.set(0, 0, 1).applyQuaternion(this.currentPalmQuaternion).normalize();

    const delta = this.currentPalmQuaternion.clone()
      .multiply(this.previousPalmQuaternion.clone().invert())
      .normalize();
    if (delta.w < 0) {
      delta.x *= -1;
      delta.y *= -1;
      delta.z *= -1;
      delta.w *= -1;
    }
    const angle = 2 * Math.acos(Math.min(Math.max(delta.w, -1), 1));
    const sinHalfAngle = Math.sqrt(Math.max(1 - delta.w * delta.w, 0));
    const instantaneous = new THREE.Vector3();
    if (sinHalfAngle > 1e-4 && angle > 1e-4) {
      instantaneous.set(delta.x, delta.y, delta.z)
        .divideScalar(sinHalfAngle)
        .multiplyScalar(angle / dt);
      if (instantaneous.length() > 24) instantaneous.setLength(24);
    }
    this.angularVelocity.lerp(instantaneous, 0.5);
  },

  updateContactAura: function (position: THREE.Vector3) {
    if (!this.auraMesh) return;

    this.auraMesh.position.copy(position);
    this.auraMesh.quaternion.copy(this.currentPalmQuaternion);
    this.auraMesh.visible = true;
  },

  updateLaserAndTouch: function (origin: THREE.Vector3, dir: THREE.Vector3, now: number) {
    if (!this.laserGroup) return;

    this.laserGroup.visible = true;

    // A. Gather clickable 3D buttons in the scene
    const rayButtonEntities = Array.from(document.querySelectorAll('.clickable, .vr-btn')) as any[];
    const touchButtonEntities = Array.from(document.querySelectorAll('[vr-button]')) as any[];
    const targetMeshes: THREE.Object3D[] = [];
    const meshToEntityMap = new Map<THREE.Object3D, any>();

    for (const btnEl of rayButtonEntities) {
      if (btnEl.object3D && this.isObjectVisible(btnEl.object3D)) {
        btnEl.object3D.traverse((child: any) => {
          if (child.isMesh) {
            targetMeshes.push(child);
            meshToEntityMap.set(child, btnEl);
          }
        });
      }
    }

    // B. Direct Finger Touch / Poke Proximity Check (< 8cm distance)
    if (now - this.lastTouchTriggerTime > 450) {
      for (const pt of this.contactPoints) {
        for (const btnEl of touchButtonEntities) {
          if (!btnEl.object3D || !this.isObjectVisible(btnEl.object3D)) continue;

          // Self-Touch Filter: Left hand NEVER triggers buttons mounted on the left forearm!
          if (this.handSide === 'left' && (btnEl.getAttribute('data-mounted-hand') === 'left' || btnEl.closest('#wrist-hud-group'))) {
            continue;
          }

          const btnPos = new THREE.Vector3();
          btnEl.object3D.getWorldPosition(btnPos);
          if (btnPos.y < -5) continue;

          const dist = pt.distanceTo(btnPos);
          if (dist < 0.08) {
            this.lastTouchTriggerTime = now;
            const vrBtnComp = btnEl.components?.['vr-button'];
            if (vrBtnComp) {
              vrBtnComp.triggerAction();
            } else {
              btnEl.emit('click', { hand: this.handSide });
            }
            this.triggerHaptic(0.8, 80);
            break;
          }
        }
      }
    }

    // C. Raycast Laser Pointer against 3D Buttons
    this.raycaster.set(origin, dir);
    const intersects = this.raycaster.intersectObjects(targetMeshes, false);

    let hitDist = 2.2;
    let hitEntity: any = null;

    if (intersects.length > 0) {
      const hit = intersects[0];
      hitDist = hit.distance;
      hitEntity = meshToEntityMap.get(hit.object);

      if (this.laserReticleMesh) {
        this.laserReticleMesh.visible = true;
        this.laserReticleMesh.position.copy(hit.point);
        if (hit.face) {
          this.laserReticleMesh.lookAt(hit.point.clone().add(hit.face.normal));
        }
      }
    } else {
      if (this.laserReticleMesh) {
        this.laserReticleMesh.visible = false;
      }
    }

    // Position and align laser cylinder centered between origin and endpoint
    if (this.laserBeamMesh) {
      const endpoint = origin.clone().addScaledVector(dir, hitDist);
      const midPoint = new THREE.Vector3().addVectors(origin, endpoint).multiplyScalar(0.5);
      this.laserBeamMesh.position.copy(midPoint);
      this.laserBeamMesh.lookAt(endpoint);
      this.laserBeamMesh.scale.set(1, 1, hitDist);
    }

    // Manage Hover States on buttons
    if (hitEntity !== this.hoveredButton) {
      if (this.hoveredButton) {
        this.hoveredButton.emit('mouseleave', { hand: this.handSide });
      }
      if (hitEntity) {
        hitEntity.emit('mouseenter', { hand: this.handSide });
        this.triggerHaptic(0.2, 20);
      }
      this.hoveredButton = hitEntity;
    }
  },

  isObjectVisible: function (object: any) {
    let current = object;
    while (current) {
      if (!current.visible) return false;
      current = current.parent;
    }
    return true;
  },

  getVelocityData: function (): HandVelocityData {
    const now = performance.now();
    const isRecovering = now < this.recoveryGraceUntil || !this.isTracked;
    return {
      position: this.currentPosition.clone(),
      previousPosition: isRecovering ? this.currentPosition.clone() : this.previousPosition.clone(),
      velocity: isRecovering ? new THREE.Vector3(0, 0, 0) : this.currentVelocity.clone(),
      palmNormal: this.palmNormal.clone(),
      palmQuaternion: this.currentPalmQuaternion.clone(),
      angularVelocity: isRecovering ? new THREE.Vector3(0, 0, 0) : this.angularVelocity.clone(),
      speedMps: isRecovering ? 0 : this.currentVelocity.length(),
      contactPoints: this.contactPoints.map((p: any) => p.clone()),
      isTracked: this.isTracked,
      isRecovering,
      inputMode: this.inputMode,
    };
  },

  triggerHaptic: function (intensity: number = 0.8, durationMs: number = 80) {
    try {
      const trackedControls = this.el.components['tracked-controls'];
      if (trackedControls && trackedControls.controller) {
        const gamepad = trackedControls.controller.gamepad;
        if (gamepad && gamepad.hapticActuators && gamepad.hapticActuators.length > 0) {
          gamepad.hapticActuators[0].pulse(intensity, durationMs);
          return;
        }
        if (gamepad && gamepad.vibrationActuator) {
          gamepad.vibrationActuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration: durationMs,
            weakMagnitude: intensity,
            strongMagnitude: intensity,
          });
        }
      }
    } catch (e) {}
  },

  remove: function () {
    if (this.sceneGroup && this.auraMesh) {
      this.sceneGroup.remove(this.auraMesh);
    }
    if (this.sceneGroup && this.laserGroup) {
      this.sceneGroup.remove(this.laserGroup);
    }
    this.auraMesh?.geometry?.dispose?.();
    this.auraMesh?.material?.dispose?.();
  },
});

import type { HandVelocityData } from '../components/hand-tracker';

declare const AFRAME: any;
declare const THREE: any;

type VectorTuple = [number, number, number];

type PosePreset = {
  name: string;
  cue: string;
  headDrop: number;
  turnDegrees: number;
  left: VectorTuple;
  right: VectorTuple;
};

type PosePlan = {
  name: string;
  cue: string;
  leftTarget: any;
  rightTarget: any;
  targetHead: any;
  rightAxis: any;
  safe: boolean;
};

const MAX_REACH = 0.69;
const MIN_REACH = 0.16;
const MIN_HAND_HEIGHT = 0.45;

// Offsets are expressed from each planned shoulder. Every preset is passed
// through the reach guard after intensity, turn, and height are applied.
const POSES: PosePreset[] = [
  {
    name: 'Open Horizon',
    cue: 'Soften the knees and open both arms wide.',
    headDrop: 0.04,
    turnDegrees: 0,
    left: [-0.43, -0.02, 0.28],
    right: [0.43, -0.02, 0.28],
  },
  {
    name: 'Crouching Comet',
    cue: 'Lower gently. Reach right out and float the left hand up.',
    headDrop: 0.3,
    turnDegrees: 18,
    left: [-0.08, 0.53, 0.18],
    right: [0.49, -0.06, 0.26],
  },
  {
    name: 'Spiral Reach',
    cue: 'Rise through center and rotate the ribs to the left.',
    headDrop: 0.1,
    turnDegrees: -34,
    left: [-0.38, 0.24, 0.26],
    right: [0.28, -0.18, 0.18],
  },
  {
    name: 'Solar Arc',
    cue: 'Lengthen upward, keeping both shoulders easy.',
    headDrop: 0,
    turnDegrees: 12,
    left: [-0.31, 0.45, 0.22],
    right: [0.4, 0.24, 0.25],
  },
  {
    name: 'Low Orbit',
    cue: 'Sink back, turn right, and sweep both hands across the horizon.',
    headDrop: 0.24,
    turnDegrees: 31,
    left: [-0.4, -0.14, 0.24],
    right: [0.42, 0.05, 0.16],
  },
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

class GuideRibbon {
  private root: any;
  private group: any;
  private curve: any = null;
  private tube: any = null;
  private targetRing: any;
  private beadGeometry: any;
  private material: any;
  private beadMaterial: any;
  private beads: any[] = [];

  constructor(root: any, color: string) {
    this.root = root;
    this.group = new THREE.Group();
    this.material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.beadMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.beadGeometry = new THREE.SphereGeometry(0.025, 10, 8);

    for (let i = 0; i < 11; i++) {
      const bead = new THREE.Mesh(this.beadGeometry, this.beadMaterial);
      this.beads.push(bead);
      this.group.add(bead);
    }

    const ringGeometry = new THREE.TorusGeometry(0.105, 0.009, 8, 36);
    this.targetRing = new THREE.Mesh(ringGeometry, this.beadMaterial);
    this.group.add(this.targetRing);
    this.root.add(this.group);
  }

  setPath(points: any[], width: number) {
    this.curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    this.tube?.geometry?.dispose();
    if (this.tube) this.group.remove(this.tube);
    this.tube = new THREE.Mesh(
      new THREE.TubeGeometry(this.curve, 56, width, 8, false),
      this.material,
    );
    this.tube.renderOrder = 4;
    this.group.add(this.tube);
    this.targetRing.position.copy(points[points.length - 1]);
  }

  update(time: number, speed: number, cameraPosition: any) {
    if (!this.curve) return;
    const phase = time * (0.00007 + speed * 0.00016);
    this.beads.forEach((bead, index) => {
      // Positive phase makes every bead visibly travel from the hand toward
      // the target, then reappear at the hand for a continuous stream.
      const progress = (phase + index / this.beads.length) % 1;
      bead.position.copy(this.curve.getPointAt(progress));
      const pulse = 0.72 + Math.sin(time * 0.004 + index) * 0.25;
      bead.scale.setScalar(pulse);
    });
    this.targetRing.lookAt(cameraPosition);
    this.targetRing.rotation.z = time * 0.00035;
  }

  dispose() {
    this.root.remove(this.group);
    this.tube?.geometry?.dispose();
    this.beadGeometry.dispose();
    this.targetRing.geometry.dispose();
    this.material.dispose();
    this.beadMaterial.dispose();
  }
}

AFRAME.registerComponent('yoga-pose-guide', {
  schema: {
    speed: { type: 'number', default: 0.5 },
    intensity: { type: 'number', default: 0.5 },
    complexity: { type: 'number', default: 0.45 },
  },

  init: function () {
    this.active = false;
    this.hasStarted = false;
    this.poseIndex = 0;
    this.poseStartedAt = performance.now();
    this.holdStartedAt = 0;
    this.baselineHeadHeight = 1.65;
    this.plan = null as PosePlan | null;
    this.lastUiUpdate = 0;
    this.cameraEl = document.querySelector('#yoga-camera') as any;
    this.leftEl = document.querySelector('#left-hand') as any;
    this.rightEl = document.querySelector('#right-hand') as any;
    this.leftRibbon = new GuideRibbon(this.el.object3D, '#72f58b');
    this.rightRibbon = new GuideRibbon(this.el.object3D, '#ffe66e');

    this.headMarkerMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#9aa9ff'),
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.headMarker = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.004, 8, 32),
      this.headMarkerMaterial,
    );
    this.el.object3D.add(this.headMarker);

    const ready = () => {
      this.calibrate();
      this.planPose(0);
    };
    if (this.el.sceneEl?.hasLoaded) ready();
    else this.el.sceneEl?.addEventListener('loaded', ready, { once: true });
  },

  update: function (oldData: any) {
    if (!this.plan || !oldData) return;
    if (
      oldData.intensity !== this.data.intensity
      || oldData.complexity !== this.data.complexity
    ) {
      this.planPose(this.poseIndex);
    }
  },

  startSession: function () {
    if (!this.hasStarted) {
      this.hasStarted = true;
      this.calibrate();
      this.planPose(0);
    } else {
      this.poseStartedAt = performance.now();
    }
    this.active = true;
    this.updateUi(0, this.getHands());
  },

  pauseSession: function () {
    this.active = false;
  },

  isSessionActive: function () {
    return this.active;
  },

  calibrate: function () {
    const frame = this.getBodyFrame();
    this.baselineHeadHeight = clamp(frame.head.y, 1.3, 2.05);
  },

  getBodyFrame: function () {
    const head = new THREE.Vector3(0, this.baselineHeadHeight || 1.65, 0);
    const forward = new THREE.Vector3(0, 0, -1);
    // An A-Frame camera entity is a generic Object3D wrapper (+Z forward)
    // around a Three.js Camera (-Z view direction). Pose planning must use the
    // actual camera or every guide is generated behind the user's head.
    const camera = this.cameraEl?.getObject3D?.('camera')
      || this.cameraEl?.components?.camera?.camera
      || this.cameraEl?.object3D;
    camera?.getWorldPosition(head);
    camera?.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    return { head, forward, right };
  },

  getHands: function () {
    const read = (el: any): HandVelocityData | null => {
      const component = el?.components?.['hand-tracker'];
      return component?.getVelocityData?.() || null;
    };
    return { left: read(this.leftEl), right: read(this.rightEl) };
  },

  getFallbackHand: function (side: 'left' | 'right', frame: any) {
    return frame.head.clone()
      .addScaledVector(frame.right, side === 'left' ? -0.16 : 0.16)
      .addScaledVector(frame.forward, 0.55)
      .add(new THREE.Vector3(0, -0.48, 0));
  },

  planPose: function (index: number) {
    const preset = POSES[index % POSES.length];
    const frame = this.getBodyFrame();
    const intensity = clamp(this.data.intensity, 0, 1);
    const complexity = clamp(this.data.complexity, 0, 1);
    const reachScale = 0.72 + intensity * 0.28;
    const turn = THREE.MathUtils.degToRad(preset.turnDegrees * (0.35 + complexity * 0.65));
    const plannedForward = frame.forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
    const plannedRight = frame.right.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
    const targetHead = frame.head.clone();
    targetHead.y = this.baselineHeadHeight
      - preset.headDrop * (0.45 + intensity * 0.55);
    const torso = targetHead.clone().add(new THREE.Vector3(0, -0.42, 0));
    const leftShoulder = torso.clone().addScaledVector(plannedRight, -0.18);
    const rightShoulder = torso.clone().addScaledVector(plannedRight, 0.18);

    const resolveTarget = (offset: VectorTuple, shoulder: any) => {
      const target = shoulder.clone()
        .addScaledVector(plannedRight, offset[0] * reachScale)
        .add(new THREE.Vector3(0, offset[1] * reachScale, 0))
        .addScaledVector(plannedForward, 0.2 + offset[2] * (0.5 + complexity * 0.5));
      return this.constrainTarget(target, shoulder);
    };

    let leftTarget = resolveTarget(preset.left, leftShoulder);
    let rightTarget = resolveTarget(preset.right, rightShoulder);

    // Independent targets must also leave room between the hands. This catches
    // cross-body combinations that are legal per-arm but poor as a paired pose.
    if (leftTarget.distanceTo(rightTarget) < 0.2) {
      leftTarget.addScaledVector(plannedRight, -0.08);
      rightTarget.addScaledVector(plannedRight, 0.08);
      leftTarget = this.constrainTarget(leftTarget, leftShoulder);
      rightTarget = this.constrainTarget(rightTarget, rightShoulder);
    }

    const safe = this.isPlanSafe(leftTarget, rightTarget, leftShoulder, rightShoulder, targetHead);
    if (!safe) {
      // Conservative neutral fallback. This should only be reached if a future
      // preset bypasses one of the per-target clamps.
      leftTarget = leftShoulder.clone().addScaledVector(plannedRight, -0.3);
      rightTarget = rightShoulder.clone().addScaledVector(plannedRight, 0.3);
      leftTarget.y = rightTarget.y = torso.y;
      targetHead.y = this.baselineHeadHeight;
    }

    this.plan = {
      name: preset.name,
      cue: preset.cue,
      leftTarget,
      rightTarget,
      targetHead,
      rightAxis: plannedRight,
      safe: safe || this.isPlanSafe(leftTarget, rightTarget, leftShoulder, rightShoulder, targetHead),
    };
    this.poseIndex = index % POSES.length;
    this.poseStartedAt = performance.now();
    this.holdStartedAt = 0;

    const hands = this.getHands();
    const leftStart = hands.left?.isTracked ? hands.left.position : this.getFallbackHand('left', frame);
    const rightStart = hands.right?.isTracked ? hands.right.position : this.getFallbackHand('right', frame);
    this.leftRibbon.setPath(
      this.makeCurve(leftStart, leftTarget, plannedRight, -1, complexity),
      0.009 + intensity * 0.009,
    );
    this.rightRibbon.setPath(
      this.makeCurve(rightStart, rightTarget, plannedRight, 1, complexity),
      0.009 + intensity * 0.009,
    );
    this.headMarker.position.copy(targetHead).addScaledVector(frame.forward, 0.85);
    this.updateUi(0, hands);
    this.el.emit('yoga-pose-change', { index: this.poseIndex, plan: this.plan });
  },

  constrainTarget: function (target: any, shoulder: any) {
    target.y = clamp(target.y, MIN_HAND_HEIGHT, this.baselineHeadHeight + 0.25);
    const offset = target.clone().sub(shoulder);
    const distance = offset.length();
    if (distance > MAX_REACH) target.copy(shoulder).add(offset.setLength(MAX_REACH));
    else if (distance < MIN_REACH) target.copy(shoulder).add(offset.setLength(MIN_REACH));
    target.y = clamp(target.y, MIN_HAND_HEIGHT, this.baselineHeadHeight + 0.25);
    const correctedOffset = target.clone().sub(shoulder);
    if (correctedOffset.length() > MAX_REACH) {
      target.copy(shoulder).add(correctedOffset.setLength(MAX_REACH));
    }
    return target;
  },

  isPlanSafe: function (left: any, right: any, leftShoulder: any, rightShoulder: any, head: any) {
    const leftReach = left.distanceTo(leftShoulder);
    const rightReach = right.distanceTo(rightShoulder);
    return leftReach >= MIN_REACH - 0.01
      && rightReach >= MIN_REACH - 0.01
      && leftReach <= MAX_REACH + 0.01
      && rightReach <= MAX_REACH + 0.01
      && left.distanceTo(right) >= 0.16
      && left.y >= MIN_HAND_HEIGHT
      && right.y >= MIN_HAND_HEIGHT
      && head.y >= this.baselineHeadHeight - 0.36;
  },

  makeCurve: function (start: any, target: any, rightAxis: any, side: number, complexity: number) {
    const first = start.clone().lerp(target, 0.32)
      .addScaledVector(rightAxis, side * (0.05 + complexity * 0.09));
    const second = start.clone().lerp(target, 0.68)
      .addScaledVector(rightAxis, side * (0.02 + complexity * 0.04));
    second.y += 0.035 + complexity * 0.07;
    return [start.clone(), first, second, target.clone()];
  },

  tick: function (time: number) {
    if (!this.plan) return;
    const now = performance.now();
    const frame = this.getBodyFrame();
    this.leftRibbon.update(time, this.data.speed, frame.head);
    this.rightRibbon.update(time, this.data.speed, frame.head);
    this.headMarker.lookAt(frame.head);
    this.headMarker.rotation.z = time * 0.0002;

    const hands = this.getHands();
    const leftTracked = Boolean(hands.left?.isTracked);
    const rightTracked = Boolean(hands.right?.isTracked);
    let completion = 0;
    let poseReached = false;

    if (leftTracked && rightTracked) {
      const leftDistance = hands.left!.position.distanceTo(this.plan.leftTarget);
      const rightDistance = hands.right!.position.distanceTo(this.plan.rightTarget);
      const handCompletion = 1 - clamp((leftDistance + rightDistance) / 1.45, 0, 1);
      const headDistance = Math.abs(frame.head.y - this.plan.targetHead.y);
      const headCompletion = 1 - clamp(headDistance / 0.42, 0, 1);
      completion = handCompletion * 0.82 + headCompletion * 0.18;
      poseReached = leftDistance < 0.17 && rightDistance < 0.17 && headDistance < 0.14;
    }

    if (this.active) {
      if (poseReached) {
        if (!this.holdStartedAt) this.holdStartedAt = now;
      } else {
        this.holdStartedAt = 0;
      }

      const duration = 15000 - clamp(this.data.speed, 0, 1) * 9500;
      const heldLongEnough = this.holdStartedAt && now - this.holdStartedAt > 850;
      if (heldLongEnough || now - this.poseStartedAt > duration) {
        this.pulseHands();
        this.planPose((this.poseIndex + 1) % POSES.length);
        return;
      }
    }

    if (now - this.lastUiUpdate > 120) {
      this.lastUiUpdate = now;
      this.updateUi(completion, hands);
    }
  },

  pulseHands: function () {
    this.leftEl?.components?.['hand-tracker']?.triggerHaptic?.(0.22, 60);
    this.rightEl?.components?.['hand-tracker']?.triggerHaptic?.(0.22, 60);
  },

  updateUi: function (completion: number, hands: any) {
    if (!this.plan) return;
    const setText = (selector: string, value: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) element.textContent = value;
    };
    setText('#pose-number', String(this.poseIndex + 1).padStart(2, '0'));
    setText('#pose-name', this.plan.name);
    setText('#pose-cue', this.plan.cue);
    setText('#tracking-state', hands.left?.isTracked && hands.right?.isTracked
      ? 'BOTH HANDS TRACKED'
      : 'SHOW BOTH HANDS');
    setText('#safety-state', this.plan.safe ? 'SAFE REACH PLAN' : 'NEUTRAL FALLBACK');
    const fill = document.querySelector<HTMLElement>('#match-fill');
    if (fill) fill.style.width = `${Math.round(completion * 100)}%`;
    document.querySelector('#safety-state')?.setAttribute('data-safe', String(this.plan.safe));
    document.querySelector('#vr-pose-name')?.setAttribute('value', this.plan.name.toUpperCase());
    document.querySelector('#vr-pose-cue')?.setAttribute('value', this.plan.cue);
  },

  remove: function () {
    this.leftRibbon?.dispose();
    this.rightRibbon?.dispose();
    if (this.headMarker) this.el.object3D.remove(this.headMarker);
    this.headMarker?.geometry?.dispose();
    this.headMarkerMaterial?.dispose();
  },
});

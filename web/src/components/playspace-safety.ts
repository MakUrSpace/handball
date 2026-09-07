/**
 * Shared WebXR playspace awareness.
 *
 * A-Frame continues to render in `local-floor`. When an immersive session
 * starts, this component requests a second `bounded-floor` reference space so
 * applications can inspect the headset's configured floor boundary without
 * changing camera or controller tracking.
 */

declare const AFRAME: any;
declare const THREE: any;

export type PlayspacePoint = { x: number; z: number };

export type PlayspaceState =
  | 'inactive'
  | 'requesting'
  | 'safe'
  | 'warning'
  | 'outside'
  | 'unavailable';

const EPSILON = 0.000001;

function distanceToSegment(point: PlayspacePoint, start: PlayspacePoint, end: PlayspacePoint) {
  const edgeX = end.x - start.x;
  const edgeZ = end.z - start.z;
  const lengthSquared = edgeX * edgeX + edgeZ * edgeZ;
  if (lengthSquared < EPSILON) return Math.hypot(point.x - start.x, point.z - start.z);

  const projection = Math.min(1, Math.max(0,
    ((point.x - start.x) * edgeX + (point.z - start.z) * edgeZ) / lengthSquared,
  ));
  return Math.hypot(
    point.x - (start.x + projection * edgeX),
    point.z - (start.z + projection * edgeZ),
  );
}

export function isPointInPolygon(point: PlayspacePoint, polygon: PlayspacePoint[]) {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    const crossesRay = (a.z > point.z) !== (b.z > point.z)
      && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;
    if (crossesRay) inside = !inside;
  }
  return inside;
}

/** Positive inside the polygon, negative outside, zero on its edge. */
export function signedDistanceToPolygon(point: PlayspacePoint, polygon: PlayspacePoint[]) {
  if (polygon.length < 3) return Number.NEGATIVE_INFINITY;

  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index++) {
    distance = Math.min(
      distance,
      distanceToSegment(point, polygon[index], polygon[(index + 1) % polygon.length]),
    );
  }
  return isPointInPolygon(point, polygon) ? distance : -distance;
}

function findSafestPoint(polygon: PlayspacePoint[]) {
  const xs = polygon.map((point) => point.x);
  const zs = polygon.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const average = polygon.reduce(
    (sum, point) => ({ x: sum.x + point.x, z: sum.z + point.z }),
    { x: 0, z: 0 },
  );

  let best = { x: average.x / polygon.length, z: average.z / polygon.length };
  let bestClearance = signedDistanceToPolygon(best, polygon);
  let searchMinX = minX;
  let searchMaxX = maxX;
  let searchMinZ = minZ;
  let searchMaxZ = maxZ;

  // Playspaces can be concave, so the average of their vertices is not
  // guaranteed to be inside. A small progressively refined grid reliably
  // finds a high-clearance interior point for the infrequent clamp operation.
  for (let pass = 0; pass < 4; pass++) {
    const columns = 18;
    const rows = 18;
    const stepX = (searchMaxX - searchMinX) / columns;
    const stepZ = (searchMaxZ - searchMinZ) / rows;

    for (let column = 0; column <= columns; column++) {
      for (let row = 0; row <= rows; row++) {
        const candidate = {
          x: searchMinX + column * stepX,
          z: searchMinZ + row * stepZ,
        };
        const clearance = signedDistanceToPolygon(candidate, polygon);
        if (clearance > bestClearance) {
          best = candidate;
          bestClearance = clearance;
        }
      }
    }

    const radiusX = Math.max(stepX, EPSILON);
    const radiusZ = Math.max(stepZ, EPSILON);
    searchMinX = best.x - radiusX;
    searchMaxX = best.x + radiusX;
    searchMinZ = best.z - radiusZ;
    searchMaxZ = best.z + radiusZ;
  }

  return { point: best, clearance: bestClearance };
}

function clampToPolygon(
  point: PlayspacePoint,
  polygon: PlayspacePoint[],
  safeCenter: PlayspacePoint,
  maximumClearance: number,
  requestedMargin: number,
) {
  const margin = Math.max(0, requestedMargin);
  const clearance = signedDistanceToPolygon(point, polygon);
  if (clearance >= margin) return { point: { ...point }, clearance, constrained: false };

  // If the configured area is narrower than the requested margin, its safest
  // point is still preferable to returning an unsafe or unreachable target.
  if (maximumClearance < margin) {
    return {
      point: { ...safeCenter },
      clearance: maximumClearance,
      constrained: true,
    };
  }

  let safeProgress = 0;
  let unsafeProgress = 1;

  // Stop at the first unsafe portion. This also behaves correctly for concave
  // polygons where a line could otherwise leave and later re-enter the area.
  for (let step = 1; step <= 64; step++) {
    const progress = step / 64;
    const candidate = {
      x: safeCenter.x + (point.x - safeCenter.x) * progress,
      z: safeCenter.z + (point.z - safeCenter.z) * progress,
    };
    if (signedDistanceToPolygon(candidate, polygon) >= margin) {
      safeProgress = progress;
    } else {
      unsafeProgress = progress;
      break;
    }
  }

  for (let iteration = 0; iteration < 18; iteration++) {
    const progress = (safeProgress + unsafeProgress) / 2;
    const candidate = {
      x: safeCenter.x + (point.x - safeCenter.x) * progress,
      z: safeCenter.z + (point.z - safeCenter.z) * progress,
    };
    if (signedDistanceToPolygon(candidate, polygon) >= margin) safeProgress = progress;
    else unsafeProgress = progress;
  }

  const clamped = {
    x: safeCenter.x + (point.x - safeCenter.x) * safeProgress,
    z: safeCenter.z + (point.z - safeCenter.z) * safeProgress,
  };
  return {
    point: clamped,
    clearance: signedDistanceToPolygon(clamped, polygon),
    constrained: true,
  };
}

AFRAME.registerComponent('playspace-safety', {
  schema: {
    camera: { type: 'selector' },
    margin: { type: 'number', default: 0.25 },
    warningDistance: { type: 'number', default: 0.85 },
    warningOffset: { type: 'vec3', default: { x: 0, y: 0.28, z: -1.05 } },
  },

  init: function () {
    this.session = null;
    this.referenceSpace = null;
    this.boundary = [] as PlayspacePoint[];
    this.safeCenter = null as PlayspacePoint | null;
    this.maximumClearance = 0;
    this.viewerPosition = null;
    this.viewerOrientation = null;
    this.frameHandle = null;
    this.requestGeneration = 0;
    this.state = 'inactive' as PlayspaceState;
    this.distance = Number.POSITIVE_INFINITY;
    this.readyEmitted = false;

    this.onEnterVr = () => void this.requestBoundary();
    this.onExitVr = () => this.stopSession();
    this.onReferenceSpaceReset = () => {
      this.refreshBoundary();
      this.readyEmitted = false;
    };
    this.el.addEventListener('enter-vr', this.onEnterVr);
    this.el.addEventListener('exit-vr', this.onExitVr);
    this.createWarning();

    if (this.el.is?.('vr-mode')) void this.requestBoundary();
  },

  createWarning: function () {
    const camera = this.data.camera;
    if (!camera) return;

    const root = document.createElement('a-entity');
    root.setAttribute('data-playspace-warning', '');
    root.setAttribute('position', this.data.warningOffset);
    root.setAttribute('visible', 'false');

    const panel = document.createElement('a-plane');
    panel.setAttribute('width', '0.78');
    panel.setAttribute('height', '0.13');
    panel.setAttribute('material', 'color: #2b1010; shader: flat; opacity: 0.9; transparent: true; side: double');
    root.appendChild(panel);

    const text = document.createElement('a-text');
    text.setAttribute('align', 'center');
    text.setAttribute('position', '0 0 0.006');
    text.setAttribute('width', '1.28');
    text.setAttribute('color', '#fecaca');
    text.setAttribute('value', 'PLAYSPACE BOUNDARY UNKNOWN');
    root.appendChild(text);

    camera.appendChild(root);
    this.warningEl = root;
    this.warningPanelEl = panel;
    this.warningTextEl = text;
  },

  requestBoundary: async function () {
    const renderer = this.el.renderer;
    const session = renderer?.xr?.getSession?.();
    if (!session) return;

    this.stopSession(false);
    const generation = ++this.requestGeneration;
    this.session = session;
    this.updateState('requesting');

    try {
      const referenceSpace = await session.requestReferenceSpace('bounded-floor');
      if (generation !== this.requestGeneration || this.session !== session) return;

      this.referenceSpace = referenceSpace;
      referenceSpace.addEventListener?.('reset', this.onReferenceSpaceReset);
      if (!this.refreshBoundary()) return;
      this.scheduleFrame();
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      console.warn('WebXR bounded-floor playspace is unavailable.', error);
      this.updateState('unavailable');
    }
  },

  refreshBoundary: function () {
    const points = Array.from(this.referenceSpace?.boundsGeometry || []) as any[];
    this.boundary = points.map((point) => ({ x: point.x, z: point.z }));
    if (this.boundary.length < 3) {
      this.safeCenter = null;
      this.maximumClearance = 0;
      this.updateState('unavailable');
      return false;
    }

    const safest = findSafestPoint(this.boundary);
    this.safeCenter = safest.point;
    this.maximumClearance = safest.clearance;
    this.el.emit('playspace-boundary-change', {
      boundary: this.getBoundary(),
      maximumClearance: this.maximumClearance,
      margin: this.data.margin,
    });
    return true;
  },

  scheduleFrame: function () {
    if (!this.session || !this.referenceSpace) return;
    this.frameHandle = this.session.requestAnimationFrame((_time: number, frame: any) => {
      if (!this.session || frame.session !== this.session || !this.referenceSpace) return;

      const pose = frame.getViewerPose(this.referenceSpace);
      if (pose) {
        const position = pose.transform.position;
        const orientation = pose.transform.orientation;
        this.viewerPosition = new THREE.Vector3(position.x, position.y, position.z);
        this.viewerOrientation = new THREE.Quaternion(
          orientation.x,
          orientation.y,
          orientation.z,
          orientation.w,
        );
        this.distance = signedDistanceToPolygon(this.viewerPosition, this.boundary);

        if (!this.readyEmitted) {
          this.readyEmitted = true;
          this.el.emit('playspace-ready', {
            boundary: this.getBoundary(),
            maximumClearance: this.maximumClearance,
            margin: this.data.margin,
          });
        }

        if (this.distance < 0) this.updateState('outside');
        else if (this.distance < this.data.warningDistance) this.updateState('warning');
        else this.updateState('safe');
      }

      this.scheduleFrame();
    });
  },

  updateState: function (state: PlayspaceState) {
    const changed = state !== this.state;
    this.state = state;
    this.updateWarning();
    if (changed) {
      this.el.emit('playspace-state-change', {
        state,
        distance: this.distance,
        margin: this.data.margin,
      });
    }
  },

  updateWarning: function () {
    if (!this.warningEl) return;
    const visible = this.state === 'warning'
      || this.state === 'outside'
      || this.state === 'unavailable';
    this.warningEl.setAttribute('visible', visible);
    if (!visible) return;

    let message = 'PLAYSPACE BOUNDARY UNKNOWN · STAY CENTERED';
    let color = '#fecaca';
    let panelColor = '#2b1010';
    if (this.state === 'outside') {
      message = 'RETURN TO YOUR PLAYSPACE';
    } else if (this.state === 'warning') {
      const centimeters = Math.max(0, Math.round(this.distance * 100));
      message = `PLAYSPACE EDGE · ${centimeters} CM`;
      color = '#fde68a';
      panelColor = '#2b2108';
    }
    this.warningTextEl?.setAttribute('value', message);
    this.warningTextEl?.setAttribute('color', color);
    this.warningPanelEl?.setAttribute(
      'material',
      `color: ${panelColor}; shader: flat; opacity: 0.9; transparent: true; side: double`,
    );
  },

  getBoundary: function () {
    return this.boundary.map((point: PlayspacePoint) => ({ ...point }));
  },

  getState: function (): PlayspaceState {
    return this.state;
  },

  isAvailable: function () {
    return Boolean(
      this.boundary.length >= 3
      && this.safeCenter
      && this.viewerPosition
      && this.viewerOrientation,
    );
  },

  getCoordinateTransform: function () {
    if (!this.isAvailable()) return null;
    const camera = this.data.camera?.getObject3D?.('camera')
      || this.data.camera?.components?.camera?.camera
      || this.data.camera?.object3D;
    if (!camera) return null;

    camera.updateWorldMatrix?.(true, false);
    const worldViewerPosition = new THREE.Vector3();
    const worldViewerOrientation = new THREE.Quaternion();
    camera.getWorldPosition(worldViewerPosition);
    camera.getWorldQuaternion(worldViewerOrientation);

    return {
      worldViewerPosition,
      worldViewerOrientation,
      boundedViewerPosition: this.viewerPosition.clone(),
      boundedViewerOrientation: this.viewerOrientation.clone(),
      worldToBoundedOrientation: this.viewerOrientation.clone()
        .multiply(worldViewerOrientation.clone().invert()),
      boundedToWorldOrientation: worldViewerOrientation.clone()
        .multiply(this.viewerOrientation.clone().invert()),
    };
  },

  worldToBounded: function (worldPoint: any, transform: any) {
    return worldPoint.clone()
      .sub(transform.worldViewerPosition)
      .applyQuaternion(transform.worldToBoundedOrientation)
      .add(transform.boundedViewerPosition);
  },

  boundedToWorld: function (boundedPoint: any, transform: any) {
    return boundedPoint.clone()
      .sub(transform.boundedViewerPosition)
      .applyQuaternion(transform.boundedToWorldOrientation)
      .add(transform.worldViewerPosition);
  },

  getWorldClearance: function (worldPoint: any) {
    const transform = this.getCoordinateTransform();
    if (!transform) return null;
    return signedDistanceToPolygon(this.worldToBounded(worldPoint, transform), this.boundary);
  },

  isWorldPointSafe: function (worldPoint: any, margin?: number) {
    const clearance = this.getWorldClearance(worldPoint);
    const appliedMargin = margin ?? this.data.margin;
    return clearance === null || clearance >= appliedMargin;
  },

  constrainWorldPoint: function (worldPoint: any, margin?: number) {
    const transform = this.getCoordinateTransform();
    if (!transform || !this.safeCenter) {
      return {
        point: worldPoint.clone(),
        constrained: false,
        available: false,
        clearance: null,
      };
    }

    const boundedPoint = this.worldToBounded(worldPoint, transform);
    const result = clampToPolygon(
      boundedPoint,
      this.boundary,
      this.safeCenter,
      this.maximumClearance,
      margin ?? this.data.margin,
    );
    boundedPoint.x = result.point.x;
    boundedPoint.z = result.point.z;
    return {
      point: this.boundedToWorld(boundedPoint, transform),
      constrained: result.constrained,
      available: true,
      clearance: result.clearance,
    };
  },

  stopSession: function (setInactive = true) {
    this.requestGeneration++;
    if (this.session && this.frameHandle !== null) {
      this.session.cancelAnimationFrame?.(this.frameHandle);
    }
    this.referenceSpace?.removeEventListener?.('reset', this.onReferenceSpaceReset);
    this.session = null;
    this.referenceSpace = null;
    this.boundary = [];
    this.safeCenter = null;
    this.maximumClearance = 0;
    this.viewerPosition = null;
    this.viewerOrientation = null;
    this.frameHandle = null;
    this.readyEmitted = false;
    this.distance = Number.POSITIVE_INFINITY;
    if (setInactive) this.updateState('inactive');
  },

  remove: function () {
    this.el.removeEventListener('enter-vr', this.onEnterVr);
    this.el.removeEventListener('exit-vr', this.onExitVr);
    this.stopSession();
    this.warningEl?.remove();
  },
});

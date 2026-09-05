/**
 * A-Frame Component: handball-court
 * Constructs 4-wall handball court geometry, materials, lines, lighting, scoreboards,
 * permanent left-wall stadium kiosk, with support for Regulation (6.1m / 20ft),
 * Narrow / Stationary (2.2m armspan), and Quest 3 Mixed Reality Passthrough mode.
 */

declare const AFRAME: any;
declare const THREE: any;

export const COURT_DIMENSIONS = {
  mode: 'narrow' as 'narrow' | 'regulation',
  passthrough: false,
  neon: false,
  length: 12.192, // 40 ft
  width: 2.20,    // 2.20 m in Narrow mode (~7.2 ft), 6.096 m in Regulation (~20 ft)
  height: 6.096,  // 20 ft
  shortLineZ: 6.096,
  serviceLineZ: 4.572,
  serviceBoxWidth: 0.3,
  regulationWidth: 6.096,
  narrowWidth: 2.20,
};

AFRAME.registerComponent('handball-court', {
  schema: {
    mode: { type: 'string', default: 'narrow' }, // 'narrow' (armspan) or 'regulation'
    passthrough: { type: 'boolean', default: false },
    neon: { type: 'boolean', default: false },
    kioskVisible: { type: 'boolean', default: true },
    theme: { type: 'string', default: 'tournament' },
  },

  init: function () {
    this.courtGroup = null;
    this.setMode(this.data.mode, false);
    if (this.data.passthrough) {
      this.setPassthrough(true);
    }
  },

  setMode: function (newMode: 'narrow' | 'regulation', emitEvent: boolean = true) {
    this.data.mode = newMode;
    COURT_DIMENSIONS.mode = newMode;
    COURT_DIMENSIONS.width = newMode === 'narrow' ? COURT_DIMENSIONS.narrowWidth : COURT_DIMENSIONS.regulationWidth;

    this.rebuildCourtGeometry();

    if (emitEvent) {
      this.el.emit('court-mode-changed', {
        mode: newMode,
        width: COURT_DIMENSIONS.width,
        halfWidth: COURT_DIMENSIONS.width / 2,
      });
    }
  },

  toggleMode: function () {
    const nextMode = this.data.mode === 'narrow' ? 'regulation' : 'narrow';
    this.setMode(nextMode, true);
    return nextMode;
  },

  setNeon: function (enabled: boolean) {
    this.data.neon = enabled;
    COURT_DIMENSIONS.neon = enabled;
    if (enabled && this.data.passthrough) {
      this.setPassthrough(false);
      return;
    }
    this.rebuildCourtGeometry();
    this.el.emit('neon-toggled', { neon: enabled });
  },

  toggleNeon: function () {
    const nextState = !this.data.neon;
    this.setNeon(nextState);
    return nextState;
  },

  setPassthrough: function (enabled: boolean) {
    this.data.passthrough = enabled;
    COURT_DIMENSIONS.passthrough = enabled;
    const scene = this.el.sceneEl || document.querySelector('#game-scene');

    if (scene) {
      if (enabled) {
        scene.removeAttribute('background');
        if (scene.object3D) scene.object3D.background = null;
        if (scene.renderer) {
          scene.renderer.setClearColor(0x000000, 0);
          scene.renderer.setClearAlpha(0);
        }
        document.body.style.backgroundColor = 'transparent';
        document.documentElement.style.backgroundColor = 'transparent';

        // Request WebXR Blend Mode for Meta Quest passthrough
        const xrSession = scene.renderer?.xr?.getSession?.();
        if (xrSession) {
          try {
            if (xrSession.requestBlendMode) {
              xrSession.requestBlendMode('alpha-blend').catch(() => {});
            }
          } catch (e) {}
        }
      } else {
        scene.setAttribute('background', 'color: #030712');
        if (scene.renderer) {
          scene.renderer.setClearColor(0x030712, 1.0);
          scene.renderer.setClearAlpha(1.0);
        }
        document.body.style.backgroundColor = '#030712';
        document.documentElement.style.backgroundColor = '#030712';

        const xrSession = scene.renderer?.xr?.getSession?.();
        if (xrSession) {
          try {
            if (xrSession.requestBlendMode) {
              xrSession.requestBlendMode('opaque').catch(() => {});
            }
          } catch (e) {}
        }
      }
    }

    this.rebuildCourtGeometry();
    this.el.emit('passthrough-toggled', { passthrough: enabled });
  },

  togglePassthrough: function () {
    const nextState = !this.data.passthrough;
    this.setPassthrough(nextState);
    return nextState;
  },

  setKioskVisible: function (visible: boolean) {
    this.data.kioskVisible = visible;
    const kiosk = this.courtGroup?.querySelector?.('#in-world-vr-menu');
    if (kiosk) kiosk.setAttribute('visible', visible.toString());
    const botRules = this.courtGroup?.querySelector?.('#bot-rules-panel');
    if (botRules) botRules.setAttribute('visible', visible.toString());

    const label = visible ? '✕ HIDE KIOSK' : '☰ SHOW KIOSK';
    const kioskToggle = document.getElementById('wall-kiosk-toggle') as any;
    const toggleText = kioskToggle?.components?.['vr-button']?.textEl
      || kioskToggle?.querySelector?.('a-text');
    if (toggleText) toggleText.setAttribute('value', label);
    const domButton = document.getElementById('btn-kiosk');
    if (domButton) domButton.textContent = visible ? '🧱 KIOSK: ON' : '🧱 KIOSK: OFF';
    this.el.emit('kiosk-visibility-changed', { visible });
    return visible;
  },

  toggleKiosk: function () {
    return this.setKioskVisible(!this.data.kioskVisible);
  },

  rebuildCourtGeometry: function () {
    const el = this.el;
    if (this.courtGroup) {
      el.removeChild(this.courtGroup);
      this.courtGroup = null;
    }

    const { length, width, height, shortLineZ, serviceLineZ } = COURT_DIMENSIONS;
    const halfW = width / 2;
    const isNarrow = this.data.mode === 'narrow';
    const isPassthrough = this.data.passthrough;
    const isNeon = this.data.neon && !isPassthrough;

    const courtGroup = document.createElement('a-entity');
    courtGroup.setAttribute('id', 'court-geometry');
    this.courtGroup = courtGroup;

    // 1. Court Floor (Transparent golden-yellow barrier in Passthrough / Neon, hardwood otherwise)
    const floor = document.createElement('a-plane');
    floor.setAttribute('position', `0 0 ${length / 2}`);
    floor.setAttribute('rotation', '-90 0 0');
    floor.setAttribute('width', width.toString());
    floor.setAttribute('height', length.toString());
    if (isPassthrough) {
      floor.setAttribute('material', 'color: #ca8a04; opacity: 0.12; transparent: true; roughness: 0.6; depthWrite: false; side: double');
    } else if (isNeon) {
      floor.setAttribute('material', 'color: #ca8a04; opacity: 0.22; transparent: true; roughness: 0.4; side: double');
    } else {
      floor.setAttribute('material', 'color: #d8a068; roughness: 0.35; metalness: 0.05');
      floor.setAttribute('shadow', 'receive: true');
    }
    courtGroup.appendChild(floor);

    // 2. Floor Lines (Red stripes)
    const createLine = (z: number, lineWidth: number = 0.05, color: string = '#ef4444') => {
      const line = document.createElement('a-plane');
      line.setAttribute('position', `0 0.005 ${z}`);
      line.setAttribute('rotation', '-90 0 0');
      line.setAttribute('width', width.toString());
      line.setAttribute('height', lineWidth.toString());
      line.setAttribute('material', `color: ${color}; shader: flat; opacity: ${isPassthrough ? 0.95 : 1.0}; transparent: true`);
      return line;
    };

    courtGroup.appendChild(createLine(shortLineZ, 0.05, '#ef4444'));
    courtGroup.appendChild(createLine(serviceLineZ, 0.05, '#ef4444'));

    // Service Box Lines
    const serviceBoxOffset = isNarrow ? 0.15 : 0.457;
    const createBoxLine = (xPos: number) => {
      const boxLine = document.createElement('a-plane');
      const boxLength = shortLineZ - serviceLineZ;
      boxLine.setAttribute('position', `${xPos} 0.005 ${(shortLineZ + serviceLineZ) / 2}`);
      boxLine.setAttribute('rotation', '-90 0 0');
      boxLine.setAttribute('width', '0.04');
      boxLine.setAttribute('height', boxLength.toString());
      boxLine.setAttribute('material', `color: #ef4444; shader: flat; opacity: ${isPassthrough ? 0.95 : 1.0}; transparent: true`);
      return boxLine;
    };
    courtGroup.appendChild(createBoxLine(-halfW + serviceBoxOffset));
    courtGroup.appendChild(createBoxLine(halfW - serviceBoxOffset));

    // 3. Front Wall (z = 0) - Transparent Yellow Bouncing Barrier in Passthrough / Neon
    const frontWall = document.createElement('a-plane');
    frontWall.setAttribute('position', `0 ${height / 2} 0`);
    frontWall.setAttribute('rotation', '0 0 0');
    frontWall.setAttribute('width', width.toString());
    frontWall.setAttribute('height', height.toString());
    if (isPassthrough) {
      frontWall.setAttribute('material', 'color: #eab308; opacity: 0.18; transparent: true; roughness: 0.2; metalness: 0.3; depthWrite: false; side: double');
    } else if (isNeon) {
      frontWall.setAttribute('material', 'color: #eab308; opacity: 0.26; transparent: true; roughness: 0.2; metalness: 0.3; side: double');
    } else {
      frontWall.setAttribute('material', 'color: #f0f4f8; roughness: 0.25; metalness: 0.1');
      frontWall.setAttribute('shadow', 'receive: true');
    }
    courtGroup.appendChild(frontWall);

    // Neon mode keeps its front-wall frame. Passthrough receives a complete
    // four-wall boundary frame after all of the wall planes are constructed.
    if (isNeon) {
      const createBorderLine = (w: number, h: number, x: number, y: number, z: number, rot: string = '0 0 0') => {
        const border = document.createElement('a-plane');
        border.setAttribute('position', `${x} ${y} ${z}`);
        border.setAttribute('rotation', rot);
        border.setAttribute('width', w.toString());
        border.setAttribute('height', h.toString());
        border.setAttribute('material', 'color: #facc15; shader: flat; opacity: 0.85; transparent: true; side: double');
        return border;
      };
      // Front Wall Top and Bottom Beams
      courtGroup.appendChild(createBorderLine(width, 0.04, 0, height, 0.01));
      courtGroup.appendChild(createBorderLine(width, 0.04, 0, 0.02, 0.01));
      courtGroup.appendChild(createBorderLine(0.04, height, -halfW, height / 2, 0.01));
      courtGroup.appendChild(createBorderLine(0.04, height, halfW, height / 2, 0.01));
    }

    // Front Wall Target Accent Ring
    const frontWallTarget = document.createElement('a-ring');
    frontWallTarget.setAttribute('id', 'front-wall-target');
    frontWallTarget.setAttribute('position', `0 1.2 0.01`);
    frontWallTarget.setAttribute('radius-inner', (isNarrow ? 0.35 : 0.6).toString());
    frontWallTarget.setAttribute('radius-outer', (isNarrow ? 0.4 : 0.65).toString());
    frontWallTarget.setAttribute('material', `color: #fde047; shader: flat; opacity: ${isPassthrough || isNeon ? 0.95 : 0.8}; transparent: true`);
    courtGroup.appendChild(frontWallTarget);

    const targetLabel = document.createElement('a-text');
    targetLabel.setAttribute('value', 'CENTER');
    targetLabel.setAttribute('align', 'center');
    targetLabel.setAttribute('position', '0 1.19 0.012');
    targetLabel.setAttribute('color', '#d97706');
    targetLabel.setAttribute('width', (isNarrow ? 1.1 : 1.7).toString());
    courtGroup.appendChild(targetLabel);

    // 4. Left Wall (x = -halfW) - Transparent Yellow Bouncing Barrier
    const leftWall = document.createElement('a-plane');
    leftWall.setAttribute('position', `${-halfW} ${height / 2} ${length / 2}`);
    leftWall.setAttribute('rotation', '0 90 0');
    leftWall.setAttribute('width', length.toString());
    leftWall.setAttribute('height', height.toString());
    if (isPassthrough) {
      leftWall.setAttribute('material', 'color: #eab308; opacity: 0.14; transparent: true; roughness: 0.2; metalness: 0.2; depthWrite: false; side: double');
    } else if (isNeon) {
      leftWall.setAttribute('material', 'color: #eab308; opacity: 0.22; transparent: true; roughness: 0.2; metalness: 0.2; side: double');
    } else {
      leftWall.setAttribute('material', 'color: #e2e8f0; roughness: 0.35; metalness: 0.05');
      leftWall.setAttribute('shadow', 'receive: true');
    }
    courtGroup.appendChild(leftWall);

    // 5. Right Wall (x = halfW) - Transparent Yellow Bouncing Barrier
    const rightWall = document.createElement('a-plane');
    rightWall.setAttribute('position', `${halfW} ${height / 2} ${length / 2}`);
    rightWall.setAttribute('rotation', '0 -90 0');
    rightWall.setAttribute('width', length.toString());
    rightWall.setAttribute('height', height.toString());
    if (isPassthrough) {
      rightWall.setAttribute('material', 'color: #eab308; opacity: 0.14; transparent: true; roughness: 0.2; metalness: 0.2; depthWrite: false; side: double');
    } else if (isNeon) {
      rightWall.setAttribute('material', 'color: #eab308; opacity: 0.22; transparent: true; roughness: 0.2; metalness: 0.2; side: double');
    } else {
      rightWall.setAttribute('material', 'color: #e2e8f0; roughness: 0.35; metalness: 0.05');
      rightWall.setAttribute('shadow', 'receive: true');
    }
    courtGroup.appendChild(rightWall);

    // 6. Ceiling (y = height)
    const ceiling = document.createElement('a-plane');
    ceiling.setAttribute('position', `0 ${height} ${length / 2}`);
    ceiling.setAttribute('rotation', '90 0 0');
    ceiling.setAttribute('width', width.toString());
    ceiling.setAttribute('height', length.toString());
    if (isPassthrough) {
      ceiling.setAttribute('material', 'opacity: 0; transparent: true');
    } else if (isNeon) {
      ceiling.setAttribute('material', 'color: #0f172a; opacity: 0.4; transparent: true');
    } else {
      ceiling.setAttribute('material', 'color: #1e293b; roughness: 0.8');
    }
    courtGroup.appendChild(ceiling);

    // 7. Glass Back Wall (z = length)
    const backWall = document.createElement('a-plane');
    backWall.setAttribute('position', `0 ${height / 2} ${length}`);
    backWall.setAttribute('rotation', '0 180 0');
    backWall.setAttribute('width', width.toString());
    backWall.setAttribute('height', height.toString());
    backWall.setAttribute('material', `color: ${isPassthrough || isNeon ? '#eab308' : '#64748b'}; opacity: ${isPassthrough ? 0.08 : (isNeon ? 0.16 : 0.35)}; transparent: true; roughness: 0.1; metalness: 0.2; side: double`);
    courtGroup.appendChild(backWall);

    // Passthrough collision cage: solid rails make every wall junction
    // unambiguous, while separated yellow bars describe the wall surfaces
    // without blocking the player's view of their real room.
    if (isPassthrough) {
      const railThickness = 0.045;
      const stripeThickness = 0.035;
      const surfaceInset = 0.018;
      const solidYellow = 'color: #facc15; shader: flat; side: double';

      const createBoundaryBox = (
        position: string,
        boxWidth: number,
        boxHeight: number,
        boxDepth: number,
        className: string
      ) => {
        const box = document.createElement('a-box');
        box.setAttribute('position', position);
        box.setAttribute('width', boxWidth.toString());
        box.setAttribute('height', boxHeight.toString());
        box.setAttribute('depth', boxDepth.toString());
        box.setAttribute('material', solidYellow);
        box.setAttribute('class', className);
        return box;
      };

      const addEdge = (position: string, boxWidth: number, boxHeight: number, boxDepth: number) => {
        courtGroup.appendChild(createBoundaryBox(
          position,
          boxWidth,
          boxHeight,
          boxDepth,
          'passthrough-boundary-edge'
        ));
      };

      // Floor-to-wall rails.
      addEdge(`0 ${railThickness / 2} 0`, width, railThickness, railThickness);
      addEdge(`0 ${railThickness / 2} ${length}`, width, railThickness, railThickness);
      addEdge(`${-halfW} ${railThickness / 2} ${length / 2}`, railThickness, railThickness, length);
      addEdge(`${halfW} ${railThickness / 2} ${length / 2}`, railThickness, railThickness, length);

      // Wall-to-wall corner rails.
      addEdge(`${-halfW} ${height / 2} 0`, railThickness, height, railThickness);
      addEdge(`${halfW} ${height / 2} 0`, railThickness, height, railThickness);
      addEdge(`${-halfW} ${height / 2} ${length}`, railThickness, height, railThickness);
      addEdge(`${halfW} ${height / 2} ${length}`, railThickness, height, railThickness);

      // Top rails complete the collision volume and make ceiling rebounds legible.
      addEdge(`0 ${height} 0`, width, railThickness, railThickness);
      addEdge(`0 ${height} ${length}`, width, railThickness, railThickness);
      addEdge(`${-halfW} ${height} ${length / 2}`, railThickness, railThickness, length);
      addEdge(`${halfW} ${height} ${length / 2}`, railThickness, railThickness, length);

      // Repeated horizontal bars read as wall surfaces while leaving most of
      // each plane open for mixed-reality passthrough.
      for (let y = 0.65; y < height - 0.2; y += 0.65) {
        courtGroup.appendChild(createBoundaryBox(
          `0 ${y} ${surfaceInset}`,
          width,
          stripeThickness,
          stripeThickness,
          'passthrough-wall-stripe'
        ));
        courtGroup.appendChild(createBoundaryBox(
          `0 ${y} ${length - surfaceInset}`,
          width,
          stripeThickness,
          stripeThickness,
          'passthrough-wall-stripe'
        ));
        courtGroup.appendChild(createBoundaryBox(
          `${-halfW + surfaceInset} ${y} ${length / 2}`,
          stripeThickness,
          stripeThickness,
          length,
          'passthrough-wall-stripe'
        ));
        courtGroup.appendChild(createBoundaryBox(
          `${halfW - surfaceInset} ${y} ${length / 2}`,
          stripeThickness,
          stripeThickness,
          length,
          'passthrough-wall-stripe'
        ));
      }
    }

    // 8. Overhead Arena Floodlights
    if (!isPassthrough) {
      const createLight = (zPos: number) => {
        const lightGroup = document.createElement('a-entity');
        lightGroup.setAttribute('position', `0 ${height - 0.1} ${zPos}`);

        const fixture = document.createElement('a-box');
        fixture.setAttribute('width', (isNarrow ? 1.4 : 2.5).toString());
        fixture.setAttribute('height', '0.1');
        fixture.setAttribute('depth', '0.5');
        fixture.setAttribute('material', 'color: #ffffff; shader: flat; emissive: #ffffff; emissiveIntensity: 1.0');
        lightGroup.appendChild(fixture);

        const pointLight = document.createElement('a-light');
        pointLight.setAttribute('type', 'point');
        pointLight.setAttribute('intensity', '0.75');
        pointLight.setAttribute('distance', '14');
        pointLight.setAttribute('decay', '1.5');
        pointLight.setAttribute('color', '#fff8ee');
        pointLight.setAttribute('castShadow', 'true');
        lightGroup.appendChild(pointLight);

        return lightGroup;
      };

      courtGroup.appendChild(createLight(length * 0.25));
      courtGroup.appendChild(createLight(length * 0.75));
    }

    // Ambient light
    const ambient = document.createElement('a-light');
    ambient.setAttribute('type', 'ambient');
    ambient.setAttribute('color', '#ffffff');
    ambient.setAttribute('intensity', isPassthrough ? '0.9' : '0.65');
    courtGroup.appendChild(ambient);

    // 9. Floating Digital Scoreboard above Front Wall
    const scoreboard = document.createElement('a-entity');
    scoreboard.setAttribute('id', 'arena-scoreboard');
    scoreboard.setAttribute('position', `0 ${height - 0.92} 0.15`);

    const boardBg = document.createElement('a-plane');
    boardBg.setAttribute('width', (isNarrow ? 2.1 : 4.0).toString());
    boardBg.setAttribute('height', '1.42');
    boardBg.setAttribute('material', `color: #0f172a; shader: flat; opacity: ${isPassthrough ? 0.7 : 0.9}; transparent: true`);
    scoreboard.appendChild(boardBg);

    const scoreText = document.createElement('a-text');
    scoreText.setAttribute('id', 'scoreboard-text');
    scoreText.setAttribute('value', isPassthrough ? 'MR PASSTHROUGH // HANDBALL' : (isNarrow ? 'VR HANDBALL // NARROW' : 'VR HANDBALL // REGULATION'));
    scoreText.setAttribute('align', 'center');
    scoreText.setAttribute('position', '0 0.53 0.05');
    scoreText.setAttribute('color', '#38bdf8');
    scoreText.setAttribute('width', (isNarrow ? 1.82 : 3.55).toString());
    scoreText.setAttribute('wrap-count', isNarrow ? '32' : '48');
    scoreboard.appendChild(scoreText);

    const scoreDigits = document.createElement('a-text');
    scoreDigits.setAttribute('id', 'scoreboard-digits');
    scoreDigits.setAttribute('value', 'PLAYER: 0  |  OPPONENT: 0');
    scoreDigits.setAttribute('align', 'center');
    scoreDigits.setAttribute('position', '0 0.20 0.05');
    scoreDigits.setAttribute('color', '#f8fafc');
    scoreDigits.setAttribute('width', (isNarrow ? 1.88 : 3.70).toString());
    scoreDigits.setAttribute('wrap-count', isNarrow ? '30' : '44');
    scoreboard.appendChild(scoreDigits);

    const makeScoreLine = (id: string, value: string, y: number, color: string, textWidth: number) => {
      const line = document.createElement('a-text');
      line.setAttribute('id', id);
      line.setAttribute('value', value);
      line.setAttribute('align', 'center');
      line.setAttribute('position', `0 ${y} 0.05`);
      line.setAttribute('color', color);
      line.setAttribute('width', textWidth.toString());
      line.setAttribute('wrap-count', isNarrow ? '34' : '48');
      scoreboard.appendChild(line);
    };

    makeScoreLine('scoreboard-rally', isNarrow ? 'RALLY 0  •  PLAYED 0' : 'RALLY SHOTS: 0   •   RALLIES PLAYED: 0', -0.05, '#6ee7b7', isNarrow ? 1.82 : 3.55);
    makeScoreLine('scoreboard-accuracy', isNarrow ? 'CENTER 0  •  BEST 0' : 'CENTER HITS: 0   •   BEST RALLY: 0', -0.28, '#fbbf24', isNarrow ? 1.82 : 3.50);
    makeScoreLine('scoreboard-bot', 'BOT MEDIUM • RULES ON', -0.50, '#c4b5fd', isNarrow ? 1.76 : 3.40);

    courtGroup.appendChild(scoreboard);

    // 10. Permanent Stadium Wall Control Kiosk on Left Court Wall (MOUNTED FLUSH ON WALL)
    const kioskGroup = document.createElement('a-entity');
    kioskGroup.setAttribute('id', 'in-world-vr-menu');
    const kioskX = -halfW + 0.02;
    kioskGroup.setAttribute('position', `${kioskX} 1.40 6.0`);
    kioskGroup.setAttribute('rotation', '0 90 0');
    kioskGroup.setAttribute('scale', isNarrow ? '0.68 0.68 0.68' : '0.85 0.85 0.85');
    kioskGroup.setAttribute('visible', this.data.kioskVisible.toString());

    const kioskBg = document.createElement('a-plane');
    kioskBg.setAttribute('width', '2.0');
    kioskBg.setAttribute('height', '2.05');
    kioskBg.setAttribute('material', 'color: #0b1120; shader: flat; opacity: 0.96; side: double');
    kioskGroup.appendChild(kioskBg);

    const kioskBorder = document.createElement('a-plane');
    kioskBorder.setAttribute('width', '2.04');
    kioskBorder.setAttribute('height', '2.09');
    kioskBorder.setAttribute('position', '0 0 -0.005');
    kioskBorder.setAttribute('material', 'color: #0284c7; shader: flat; side: double');
    kioskGroup.appendChild(kioskBorder);

    const kioskTitle = document.createElement('a-text');
    kioskTitle.setAttribute('value', 'STADIUM CONTROLS');
    kioskTitle.setAttribute('align', 'center');
    kioskTitle.setAttribute('position', '0 0.88 0.02');
    kioskTitle.setAttribute('color', '#38bdf8');
    kioskTitle.setAttribute('width', '1.76');
    kioskTitle.setAttribute('wrap-count', '28');
    kioskGroup.appendChild(kioskTitle);

    const kioskScore = document.createElement('a-text');
    kioskScore.setAttribute('id', 'kiosk-score-text');
    kioskScore.setAttribute('value', 'PLAYER: 0   |   OPPONENT: 0');
    kioskScore.setAttribute('align', 'center');
    kioskScore.setAttribute('position', '0 0.69 0.02');
    kioskScore.setAttribute('color', '#f8fafc');
    kioskScore.setAttribute('width', '1.80');
    kioskScore.setAttribute('wrap-count', '34');
    kioskGroup.appendChild(kioskScore);

    const kioskInfo = document.createElement('a-text');
    kioskInfo.setAttribute('id', 'kiosk-info-text');
    kioskInfo.setAttribute('value', 'SPEED: 0.0 MPH');
    kioskInfo.setAttribute('align', 'center');
    kioskInfo.setAttribute('position', '0 0.53 0.02');
    kioskInfo.setAttribute('color', '#fbbf24');
    kioskInfo.setAttribute('width', '1.72');
    kioskInfo.setAttribute('wrap-count', '28');
    kioskGroup.appendChild(kioskInfo);

    const kioskStats = document.createElement('a-text');
    kioskStats.setAttribute('id', 'kiosk-stats-text');
    kioskStats.setAttribute('value', 'RALLY: 0  •  CENTER: 0  •  BOT');
    kioskStats.setAttribute('align', 'center');
    kioskStats.setAttribute('position', '0 0.40 0.02');
    kioskStats.setAttribute('color', '#6ee7b7');
    kioskStats.setAttribute('width', '1.76');
    kioskStats.setAttribute('wrap-count', '36');
    kioskGroup.appendChild(kioskStats);

    const divider = document.createElement('a-plane');
    divider.setAttribute('width', '1.9');
    divider.setAttribute('height', '0.01');
    divider.setAttribute('position', '0 0.31 0.02');
    divider.setAttribute('material', 'color: #334155; shader: flat');
    kioskGroup.appendChild(divider);

    const makeBtn = (label: string, action: string, color: string, hoverColor: string, w: number, h: number, x: number, y: number) => {
      const b = document.createElement('a-entity');
      b.setAttribute('vr-button', `label: ${label}; action: ${action}; color: ${color}; hoverColor: ${hoverColor}; width: ${w}; height: ${h}`);
      b.setAttribute('position', `${x} ${y} 0.03`);
      return b;
    };

    // Row 1: Start & Serve
    kioskGroup.appendChild(makeBtn('▶ START MATCH', 'start', '#059669', '#34d399', 0.88, 0.22, -0.48, 0.20));
    kioskGroup.appendChild(makeBtn('🏐 SERVE BALL', 'serve', '#0284c7', '#38bdf8', 0.88, 0.22, 0.48, 0.20));

    // Row 2: Pause & Reset
    kioskGroup.appendChild(makeBtn('⏸ PAUSE', 'pause', '#d97706', '#fbbf24', 0.88, 0.20, -0.48, -0.06));
    kioskGroup.appendChild(makeBtn('🔄 RESET', 'reset', '#dc2626', '#f87171', 0.88, 0.20, 0.48, -0.06));

    // Row 3: Audio and bot difficulty.
    kioskGroup.appendChild(makeBtn('🔊 AUDIO ON', 'audio', '#0891b2', '#22d3ee', 0.88, 0.18, -0.48, -0.28));
    kioskGroup.appendChild(makeBtn('BOT: MEDIUM', 'difficulty', '#6d28d9', '#a78bfa', 0.88, 0.18, 0.48, -0.28));

    // Row 4: Mode & Passthrough
    kioskGroup.appendChild(makeBtn(isNarrow ? '📏 MODE: NARROW' : '🏛 MODE: REGULATION', 'mode', '#4f46e5', '#818cf8', 0.88, 0.18, -0.48, -0.50));
    kioskGroup.appendChild(makeBtn(isPassthrough ? '🥽 PASSTHROUGH: ON' : '🥽 PASSTHROUGH: OFF', 'passthrough', '#a21caf', '#e879f9', 0.88, 0.18, 0.48, -0.50));

    // Row 5: Freeplay spans the kiosk and is mutually exclusive with the bot.
    kioskGroup.appendChild(makeBtn('∞ FREEPLAY: OFF', 'freeplay', '#047857', '#34d399', 1.84, 0.18, 0, -0.72));

    const tip = document.createElement('a-text');
    tip.setAttribute('value', 'Point laser / pinch or touch buttons');
    tip.setAttribute('align', 'center');
    tip.setAttribute('position', '0 -0.92 0.02');
    tip.setAttribute('color', '#94a3b8');
    tip.setAttribute('width', '3.0');
    kioskGroup.appendChild(tip);

    courtGroup.appendChild(kioskGroup);

    // Matching right-wall panel: visible whenever the left-wall kiosk is open.
    const rulesPanel = document.createElement('a-entity');
    rulesPanel.setAttribute('id', 'bot-rules-panel');
    rulesPanel.setAttribute('position', `${halfW - 0.02} 1.55 6.0`);
    rulesPanel.setAttribute('rotation', '0 -90 0');
    rulesPanel.setAttribute('scale', isNarrow ? '0.68 0.68 0.68' : '0.85 0.85 0.85');
    rulesPanel.setAttribute('visible', this.data.kioskVisible.toString());

    const rulesBg = document.createElement('a-plane');
    rulesBg.setAttribute('width', '2.0');
    rulesBg.setAttribute('height', '2.25');
    rulesBg.setAttribute('material', 'color: #0b1120; shader: flat; opacity: 0.96; side: double');
    rulesPanel.appendChild(rulesBg);

    const rulesBorder = document.createElement('a-plane');
    rulesBorder.setAttribute('width', '2.04');
    rulesBorder.setAttribute('height', '2.29');
    rulesBorder.setAttribute('position', '0 0 -0.005');
    rulesBorder.setAttribute('material', 'color: #7c3aed; shader: flat; side: double');
    rulesPanel.appendChild(rulesBorder);

    const rulesTitle = document.createElement('a-text');
    rulesTitle.setAttribute('value', 'BOT PLAY // RALLY RULES');
    rulesTitle.setAttribute('align', 'center');
    rulesTitle.setAttribute('position', '0 0.92 0.02');
    rulesTitle.setAttribute('color', '#c4b5fd');
    rulesTitle.setAttribute('width', '3.7');
    rulesPanel.appendChild(rulesTitle);

    const rulesBody = document.createElement('a-text');
    rulesBody.setAttribute('value', [
      'EVERY RALLY SCORES 1 POINT',
      '',
      '1  Reach the front wall before the floor.',
      '2  Return the ball before its second bounce.',
      '3  A missed return scores for the last hitter.',
      '4  First to 21 wins by 2.',
      '',
      'CENTER TARGET',
      'Ring hits count accuracy, not bonus points.',
      '',
      'BEAT THE BOT',
      'It reacts and moves with limited reach.',
      'Use low, fast, or wide placement.',
      'Difficulty sets its error rate; Perfect never misses.',
      '',
      'FREEPLAY turns bot and scoring rules off.',
    ].join('\n'));
    rulesBody.setAttribute('align', 'left');
    rulesBody.setAttribute('anchor', 'center');
    rulesBody.setAttribute('position', '0 0.67 0.02');
    rulesBody.setAttribute('baseline', 'top');
    rulesBody.setAttribute('color', '#e2e8f0');
    rulesBody.setAttribute('width', '1.72');
    rulesBody.setAttribute('wrap-count', '38');
    rulesPanel.appendChild(rulesBody);

    courtGroup.appendChild(rulesPanel);

    // This compact control is intentionally outside the kiosk hierarchy so it
    // remains available to restore the kiosk after its interactive subtree is hidden.
    const kioskToggle = document.createElement('a-entity');
    kioskToggle.setAttribute('id', 'wall-kiosk-toggle');
    kioskToggle.setAttribute('vr-button', `label: ${this.data.kioskVisible ? '✕ HIDE KIOSK' : '☰ SHOW KIOSK'}; action: kiosk; color: #334155; hoverColor: #64748b; width: 0.72; height: 0.16; depth: 0.03`);
    kioskToggle.setAttribute('position', `${kioskX} 2.38 5.3`);
    kioskToggle.setAttribute('rotation', '0 90 0');
    kioskToggle.setAttribute('scale', isNarrow ? '0.68 0.68 0.68' : '0.85 0.85 0.85');
    courtGroup.appendChild(kioskToggle);

    el.appendChild(courtGroup);
  },
});

# A-Frame App Hub // Handball + Yoga WebXR Experiences

[![Rust 2021](https://img.shields.io/badge/Rust-2021-orange.svg)](https://www.rust-lang.org/)
[![Nix Flake](https://img.shields.io/badge/Nix-Flake-blue.svg)](https://nixos.org/)
[![A-Frame WebXR](https://img.shields.io/badge/WebXR-A--Frame%201.5-pink.svg)](https://aframe.io/)
[![Meta Quest 3](https://img.shields.io/badge/VR-Meta%20Quest%203-blue.svg)](https://www.meta.com/quest/quest-3/)

This repository is a multi-app **A-Frame / WebXR hub** served by one **Axum / Rust** process. Its default starfield launcher currently exposes two independently routed experiences:

- **Handball** — WebXR hand tracking, real-time ball collision physics, strike dynamics, procedural spatial audio, and USHA-style four-wall match rules.
- **Yoga** — pose-aware continuous stretching in a starfield, red/blue tracked-hand discs, flowing green/yellow guidance paths, configurable movement intensity, and a synthesized 444 Hz tone bed.

The server owns a generic app registry and isolates handball's authoritative state behind app-scoped routes. Yoga is client-realtime because its guidance planner consumes the user's local WebXR pose every frame.

---

## Core Features

### App platform

- Starfield landing page at `/` with launch cards sourced from `GET /api/apps`.
- Independent Vite HTML entries at `/apps/handball/` and `/apps/yoga/`.
- Generic metadata registry with per-app runtime and input capability declarations.
- App-scoped APIs and WebSockets, with legacy handball aliases retained.

### Yoga flow

- Bare-hand tracking and Touch controller fallback share red/blue glowing contact discs.
- Green and yellow spline ribbons emit moving beads away from each hand toward the next pose.
- The planner derives targets from a head/torso estimate, then enforces conservative per-arm reach, hand-height, crouch-depth, and paired-hand separation limits.
- Preset flows encourage lateral reach, torso rotation, rises, and controlled crouches—including a right-hand-out/left-hand-up stance.
- Speed, extension intensity, and path complexity are live configurable.
- Procedural audio uses only 444 Hz sine voices; inaudible low-frequency modulators provide slow breathing dynamics.

### Handball

1. **VR Ball & Ball Physics**:
   - Continuous collision detection with front wall, side walls, back glass wall, ceiling, and hardwood floor.
   - Sub-stepped Euler integration to eliminate tunneling at high velocities (up to 90+ mph).
   - Speed-dependent dynamic visual glow and lighting.
2. **WebXR Hand Tracking (Meta Quest 3)**:
   - Bare hand tracking with joints and palm colliders (`hand-tracking-controls`).
   - Finite difference velocity estimation buffer for natural physical swinging momentum.
   - Touch Plus VR controller fallback with haptic vibration rumble (`pulse`) on strike.
   - Desktop mode: WASD movement, mouse aim, Spacebar / Left-click to strike.
3. **Hand-Striking Ball Physics**:
   - Momentum transfer based on swing velocity vector, palm normal, and sweet spot accuracy.
   - Strike classifications: `KillShot`, `Solid`, `Glancing`, `Soft`.
   - Strike cooldown/debounce to prevent multi-hit artifacts on a single swing.
4. **Procedural Spatial Sound Effects (Web Audio API)**:
   - Front wall impact: Deep hollow rubber thud with low-frequency resonance.
   - Side wall / ceiling: Acoustic wall slap.
   - Floor bounce: Snappy hardwood rebound click.
   - Hand strike: Fleshy punch pop with velocity-scaled volume and pitch.
   - Referee whistle & fault buzzer tones.
   - Score & Victory fanfares.
5. **Start / Pause / End Game & Live HUD**:
   - USHA 4-Wall regulation court geometry and markings (short line, service line, service boxes).
   - 3D spatial wrist watch HUD on left wrist in VR.
   - 2D Stadium Status bar (Score, Speedometer in MPH, Rally Counter, Status Badge, Controls).
   - WebSocket real-time sync with Axum server.
6. **Rally Scoring & Practice Bot**:
   - Every rally resolves from shot ownership: a miss before the front wall loses the rally, while an unreturned legal shot wins on the second bounce.
   - Center-target hits are tracked separately for player and opponent as an accuracy stat.
   - Visible practice bot is the default rules mode: it reads incoming trajectories, moves within human-like reaction and reach limits, and returns shots it can get to.
   - Freeplay mode disables the bot and all rally faults/point resolution while continuing to count rally shots, speed, and center-target accuracy. Turning Freeplay off restores bot play automatically.
   - When the wall kiosk is visible, a companion right-wall panel explains bot scoring, legal returns, center accuracy, and how to beat the bot.
   - Expanded front-wall scoreboard and forearm HUD keep score, rally length, center hits, match state, speed, and bot mode visible in VR.

---

## Quick Start & Development (Nix Flake)

### 1. Enter Development Shell
Provides `cargo`, `rustc`, `nodejs`, `ngrok`, `tmux`, `pkg-config`, `openssl`:
```bash
nix develop
```

### 2. Launch the Local App Hub
```bash
nix run .
# Or inside 'nix develop':
run-app
```
Open **`http://localhost:8080`** for the launcher, or go directly to:

- **`http://localhost:8080/apps/handball/`**
- **`http://localhost:8080/apps/yoga/`**

### 3. Launch with HTTPS Tunnel for Meta Quest 3
WebXR hand tracking requires a secure HTTPS context. Run:
```bash
nix run .#handball-ngrok
# Or inside 'nix develop':
run-ngrok
```
This automatically exposes the game at **`https://harmony.ngrok.app`** (or pass a custom domain: `run-ngrok custom-domain.ngrok.app`). Open this URL in the **Meta Quest Browser** on your Quest 3 headset, click **VR**, and play!

### 4. Build Web Distribution Assets
```bash
nix run .#web-build
# Or inside 'nix develop':
web-build
```

### 5. Run Automated Tests
```bash
nix run .#test
# Or inside 'nix develop':
run-tests
```

---

## Controls

| Mode | Action | Controls |
| :--- | :--- | :--- |
| **Meta Quest 3 (Hands)** | Strike Ball | Physical hand / palm swing forward against ball |
| **Meta Quest 3 (Controllers)** | Strike Ball | Swing controller into ball (feels haptic rumble) |
| **Desktop / Non-VR** | Move Around | `W`, `A`, `S`, `D` |
| **Desktop / Non-VR** | Look Around | Mouse movement |
| **Desktop / Non-VR** | Strike / Serve | `Spacebar` or `Left Mouse Click` |
| **HUD Controls** | Game Actions | Click Start, Serve, Pause, Reset, Audio Toggle |

Yoga begins from its `BEGIN FLOW` or `ENTER VR` button. Show both hands (or use both controllers), then follow the green left-hand and yellow right-hand paths. The target ring near head height supplies the rise/crouch cue. Use the three desktop sliders to tune pacing and range before entering VR.

---

## API & WebSocket Endpoints

- **`GET /api/health`**: Returns hub status and registered app IDs.
- **`GET /api/apps`**: Returns all app descriptors and launch paths.
- **`GET /api/apps/:app_id`**: Returns one app descriptor.
- **`GET /api/apps/handball/state`**: Returns the current handball match snapshot.
- **`POST /api/apps/handball/rpc`**: Handball JSON-RPC (`start`, `pause`, `reset`, `serve`, `strike`, `sync_ball`, `set_settings`).
- **`WS /ws/apps/handball`**: Handball real-time state stream.

`/api/state`, `/api/rpc`, and `/ws` remain compatibility aliases for existing handball clients.

## Adding Another A-Frame App

1. Add an app descriptor in `crates/handball-server/src/apps.rs`.
2. Add an HTML entry under `web/apps/<id>/` and a TypeScript entry under `web/src/apps/`.
3. Register the HTML entry in `web/vite.config.ts`.
4. If the app needs server state, give it an isolated state/service type and mount routes beneath `/api/apps/<id>` and `/ws/apps/<id>`.

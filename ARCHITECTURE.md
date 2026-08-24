# VR Handball Architecture

**VR Handball** is an immersive WebXR A-Frame handball game application powered by a modular Rust engine and real-time WebSocket state streaming. It simulates regulation 4-wall handball (USHA specifications), WebXR hand tracking (Meta Quest 3 joints), physical strike impulse transfer, continuous collision physics, and synthesized spatial audio.

---

## High-Level System Architecture

```text
                                  ┌──────────────────────────────┐
                                  │      Meta Quest 3 Headset    │
                                  │  WebXR Hand Tracking / Touch │
                                  └──────────────┬───────────────┘
                                                 │ WebXR API / HTTPS
                                                 ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 A-Frame VR WebApp (web/)                               │
│  ┌─────────────────────────┐ ┌─────────────────────────┐ ┌───────────────────────────┐ │
│  │     handball-court      │ │    handball-physics     │ │     spatial-audio         │ │
│  │  Regulation 4-Wall Court│ │  Sub-stepped Euler Int. │ │ Web Audio Procedural Synth│ │
│  │  Lines, Floor, Lights   │ │  Restitution, Air Drag  │ │ Thuds, Pops, Buzzers      │ │
│  └─────────────────────────┘ └─────────────────────────┘ └───────────────────────────┘ │
│  ┌─────────────────────────┐ ┌─────────────────────────┐ ┌───────────────────────────┐ │
│  │      hand-tracker       │ │      hand-striker       │ │   handball-game-manager   │ │
│  │  Joint Velocity Buffer  │ │  Impulse Normal Transfer│ │ Match Rules State Machine │ │
│  │  Quest 3 Haptics Pulse  │ │  Sweet Spot & Debounce  │ │ Score, Faults, Aces, HUD  │ │
│  └─────────────────────────┘ └─────────────────────────┘ └───────────────────────────┘ │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │ WebSocket (/ws) & REST (/api/rpc)
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               Rust Axum Server (handball-server)                       │
│     Axum 0.7 Router • WebSocket State Streamer • JSON-RPC Engine • Static SPA Host     │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               Rust Core Engine (handball-core)                         │
│  ┌─────────────────────────┐ ┌─────────────────────────┐ ┌───────────────────────────┐ │
│  │        court.rs         │ │       physics.rs        │ │         rules.rs          │ │
│  │ Regulation Court Math   │ │ 3D Vector Kinematics    │ │ USHA Scoring, Side-Outs   │ │
│  │ Wall Surfaces & Bounds  │ │ Restitution Dynamics    │ │ Rally Tracker, Stats      │ │
│  └─────────────────────────┘ └─────────────────────────┘ └───────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

- **[`flake.nix`](file:///home/musengdir/handball/flake.nix)**: Flake-parts based Nix packaging providing developer shells, server build, web build, automated test closure, and ngrok HTTPS runner for Quest 3.
- **[`crates/handball-core`](file:///home/musengdir/handball/crates/handball-core/src/lib.rs)**:
  - `court.rs`: Regulation 4-wall court specifications ($40\text{ ft} \times 20\text{ ft} \times 20\text{ ft}$ / $12.192\text{ m} \times 6.096\text{ m} \times 6.096\text{ m}$), short line ($6.096\text{ m}$), service line ($4.572\text{ m}$), service boxes.
  - `physics.rs`: Vector kinematics, gravity ($-9.81\text{ m/s}^2$), aerodynamic drag, wall/floor restitution coefficients (front wall $0.84$, side walls $0.80$, floor $0.76$, ceiling $0.70$, back wall $0.75$).
  - `strike.rs`: Palm normal deflection, hand velocity transfer, sweet spot amplification, strike quality classification (`KillShot`, `Solid`, `Glancing`, `Soft`).
  - `rules.rs`: State machine (`Idle`, `Serving`, `InPlay`, `PointScored`, `SideOut`, `Fault`, `Paused`, `GameOver`), service legality checks, double-bounce rally termination, scoring to 21.
- **[`crates/handball-server`](file:///home/musengdir/handball/crates/handball-server/src/main.rs)**:
  - Axum 0.7 asynchronous web server.
  - Real-time WebSocket broadcasting on `/ws`.
  - REST & JSON-RPC execution handler on `/api/rpc` and `/api/state`.
  - Static distribution serving with SPA fallback.
- **[`web/`](file:///home/musengdir/handball/web/src/main.ts)**:
  - `components/court.ts`: Procedural court construction, materials, floor lines, arena floodlights, in-court scoreboard.
  - `components/ball-physics.ts`: Sub-stepped real-time collision integration in A-Frame with speed glow.
  - `components/hand-tracker.ts`: WebXR hand tracking, joint smoothing buffer, Touch controller haptics.
  - `components/hand-striker.ts`: Continuous strike detector, momentum transfer, audio and haptic trigger, strike debounce.
  - `components/spatial-audio.ts`: Procedural Web Audio API sound synthesizer (front wall thuds, floor slap, strike punch, referee whistle, fault buzzer, victory fanfare).
  - `components/game-manager.ts`: Client authoritative match refereeing and scoring.
  - `components/hud.ts`: 3D spatial wrist HUD and 2D stadium status bar.
  - `components/websocket-sync.ts`: Bi-directional state synchronization with Axum backend.

---

## Meta Quest 3 & WebXR Integration

WebXR requires a secure context (HTTPS). To run directly on a Meta Quest 3 headset:
1. Start the server and ngrok tunnel (defaults to `harmony.ngrok.app`):
   ```bash
   nix run .#handball-ngrok
   ```
2. Open **`https://harmony.ngrok.app`** in the Meta Quest Browser.
3. Click the **VR** button in the bottom right corner of the A-Frame scene.
4. Put down controllers to use native bare-hand tracking, or hold Touch Plus controllers for haptic vibration feedback on every ball strike!

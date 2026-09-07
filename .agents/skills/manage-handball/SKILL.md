---
name: manage-handball
description: Develop and maintain the handball experience across its Rust rules and physics, Axum app state and RPC, A-Frame court and interaction components, HUD, bot, audio, and synchronization. Use for handball gameplay or handball-specific server changes, not launcher-only or yoga-only work.
---

# Manage Handball

Preserve the separation between reusable game math, the isolated handball server service, and immediate browser/WebXR interaction.

## Ownership map

- `crates/handball-core/`: court geometry, physics, strikes, rules, snapshots, and tests. Keep this crate independent of Axum and browser concerns.
- `crates/handball-server/src/state.rs`: `HandballAppState` and engine lifecycle.
- `crates/handball-server/src/rpc.rs`: handball RPC execution and broadcasts.
- `crates/handball-server/src/main.rs`: app-scoped HTTP/WebSocket adapters and compatibility aliases.
- `web/apps/handball/index.html`: handball scene composition and DOM controls.
- `web/src/apps/handball.ts`: handball bundle entry.
- `web/src/components/`: A-Frame court, ball, tracking, strike, bot, game-manager, HUD, audio, and synchronization behavior.

## Invariants

- `CourtDimensions::default()` is the 2.2 m narrow training court. Tests or logic that require USHA dimensions must call `CourtDimensions::regulation()` explicitly.
- Canonical backend routes are `/api/apps/handball/state`, `/api/apps/handball/rpc`, and `/ws/apps/handball`.
- `/api/state`, `/api/rpc`, and `/ws` are compatibility aliases; keep their behavior aligned with the canonical routes.
- The WebSocket upgrade callback must own captured state (`move`) because Axum requires a `'static` callback.
- Browser interaction is latency-sensitive: hand contacts, haptics, presentation, and immediate match feedback occur locally, while the Rust engine provides deterministic snapshots, RPC state, and spectator synchronization. When changing shared physics concepts, inspect both implementations for drift.
- `hand-tracker.ts` is shared with yoga. Preserve its configurable contact color, opacity, glow, and laser settings, and verify yoga after changing tracking semantics.
- A-Frame and Three.js are runtime globals. Follow the ambient typing approach already used instead of introducing a second Three.js instance into a bundle.
- Maintain both bare-hand and Touch controller paths. A fix for one input mode must not silently disable the other.

## Change routing

- Put deterministic rules, dimensions, collision math, or strike calculations in `handball-core` first and cover them with Rust tests.
- Put transport and server lifecycle behavior in `handball-server`; do not leak Axum types into the core crate.
- Put scene geometry and device interaction in the named A-Frame component rather than growing the entrypoint.
- Keep score/rally state transitions synchronized between HUD, game manager, RPC snapshots, and bot behavior.
- If changing shared tracking or starfield code, invoke and follow the relevant yoga or launcher skill too.

## Verification

Run formatting and all Rust tests after core or server edits:

```bash
nix develop --builders "" -c cargo fmt
nix develop --builders "" -c cargo test --workspace
```

Build the affected packages and run the packaged suite:

```bash
nix build .#handball-rs .#handball-web --no-link
nix run .#test
```

For WebXR, scene, HUD, or synchronization changes, use the in-app browser to load `/apps/handball/`, check for application console errors, and confirm the HUD reaches `LIVE WS CONNECTED`. Hardware-specific hand tracking and haptics still require a headset smoke test.

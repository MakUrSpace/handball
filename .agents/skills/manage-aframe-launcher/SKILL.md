---
name: manage-aframe-launcher
description: Manage the A-Frame App Hub launcher, app registry, multi-page routing, and shared static delivery. Use when adding, removing, renaming, or presenting apps, changing launcher visuals, or modifying app-scoped platform routes. Do not use for mechanics contained entirely within handball or yoga.
---

# Manage the A-Frame Launcher

Keep the root experience a small, app-neutral gateway. Treat the server registry as the source of truth for availability and routing, while keeping launcher cards useful when the registry request is temporarily offline.

## Ownership map

- `crates/handball-server/src/apps.rs`: app IDs, names, descriptions, launch paths, runtime models, and input capabilities.
- `crates/handball-server/src/main.rs`: generic platform routes, static hosting, redirects, and app-scoped router mounts.
- `web/index.html`: fallback launcher markup and app cards.
- `web/src/apps/launcher.ts`: registry fetch and card activation.
- `web/src/styles/launcher.css`: launcher layout and visual design.
- `web/src/components/starfield.ts`: starfield shared with yoga.
- `web/vite.config.ts`: one HTML build entry per experience.
- `tests/e2e_web_test.py`: registry and static-route contract checks.

## Platform invariants

- App IDs are stable URL identifiers. Prefer adding a new ID over repurposing an existing one.
- Every descriptor launch path must resolve to a Vite HTML entry under `/apps/<id>/`.
- `/api/apps` and `/api/apps/:app_id` expose descriptors. Do not put game session state in these responses.
- Keep game-specific state in a sibling service such as `HandballAppState`; do not add game fields directly to generic registry types.
- Mount server-backed app APIs beneath `/api/apps/<id>` and streams beneath `/ws/apps/<id>`.
- Preserve documented compatibility aliases unless the user explicitly requests a breaking migration.
- The launcher may render known cards before the registry responds, but successful registry data owns their final `href` and online state.
- Shared starfield changes require a yoga visual check because yoga imports the same component.

## Workflow

For an existing launcher change, inspect the registry, launcher HTML/entry, and Vite input map before editing. Keep changes out of game-specific bundles unless the request crosses that boundary.

When adding an app:

1. Add one unique descriptor to `AppRegistry::built_in()`.
2. Add `web/apps/<id>/index.html` and `web/src/apps/<id>.ts`.
3. Register the HTML file in `web/vite.config.ts`.
4. Add a launcher card or make the launcher generate an equivalent accessible link.
5. Add isolated server state/routes only if the app needs them.
6. Extend the packaged route checks for the descriptor and HTML entry.

Do not load every game's components from the launcher entry. Each app should pay only for its own bundle and intentionally shared components.

## Verification

Run checks proportional to the change:

```bash
nix build .#handball-web --no-link --builders ""
nix run .#test
```

For visual or navigation changes, test `/` in the in-app browser, confirm the registry status resolves, follow every active app card, and check console errors. For router or service changes, also build the server/ngrok closure:

```bash
nix build .#handball-ngrok .#handball-rs --no-link
nix run .#handball-ngrok -- --check
```

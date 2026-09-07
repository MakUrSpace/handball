---
name: manage-yoga
description: Develop and maintain the yoga WebXR experience, including conservative pose planning, tracked-hand and controller guides, starfield presentation, flow controls, and the 444 Hz procedural tone bed. Use for yoga behavior or visuals, not handball mechanics or launcher-only work.
---

# Manage Yoga

Keep yoga client-realtime: its plan depends on the user's live local WebXR pose and does not need a server session or broadcast channel.

## Ownership map

- `web/apps/yoga/index.html`: scene, hands/controllers, VR HUD, desktop controls, and accessibility labels.
- `web/src/apps/yoga.ts`: session, VR, audio, and slider bindings.
- `web/src/yoga/pose-guide.ts`: pose presets, reach constraints, paths, completion, and haptics.
- `web/src/yoga/tone-bed.ts`: procedural audio.
- `web/src/styles/yoga.css`: desktop presentation.
- `web/src/components/hand-tracker.ts`: input and hand-disc implementation shared with handball.
- `web/src/components/starfield.ts`: background shared with the launcher.

## Pose-planning invariants

- Generate paired poses from a planned head/torso frame; never choose independent random hand targets.
- Read view direction from the actual Three.js camera returned by `getObject3D('camera')`, not only the A-Frame entity wrapper.
- Apply intensity, turn, and complexity before the final safety pass.
- Constrain each target to the arm-reach and hand-height envelope, then validate paired-hand separation and crouch depth.
- If validation fails, emit the conservative neutral fallback rather than showing the unsafe target.
- Treat `SAFE REACH PLAN` as a kinematic guard, not a medical guarantee. Preserve the visible instruction to stop on pain and clear the play area.
- Keep target paths in front of the actual camera and inside the reachable workspace. The green left-hand and yellow right-hand beads must move away from the current hands toward their targets.
- Preserve the crouch/right-hand-out/left-hand-up sequence and a mix of torso turns and height changes unless the user requests a different flow vocabulary.
- A pose may advance after a comfortable hold or a speed-derived timeout so the experience remains continuous even when optical tracking is imperfect.

## Input, visuals, and audio

- Left and right tracked inputs use the shared tracker with red and blue glowing discs respectively; support bare hands and controllers.
- Slider DOM values are percentages, while the A-Frame component receives normalized values from 0 through 1.
- Extension changes reach scale, complexity changes turn/path shape, and speed changes both guide motion and pose duration.
- All audible musical oscillators must remain sine waves at exactly 444 Hz. Sub-audible modulators may shape gain but must not connect to the output as audible voices.
- Audio initialization must remain behind a user gesture or WebXR entry because browsers block unsolicited playback.
- When changing `hand-tracker.ts`, verify handball defaults as well as yoga's custom colors and disabled selector laser.
- When changing `starfield.ts`, verify the launcher too.

## Verification

Always compile the multi-page web bundle:

```bash
nix build .#handball-web --no-link --builders ""
```

Run the packaged route suite when changing entry paths or shared platform files:

```bash
nix run .#test
```

Use the in-app browser after pose, camera, geometry, CSS, control, or audio changes. Load `/apps/yoga/`, check for application console errors, confirm `SAFE REACH PLAN`, exercise all three sliders and Begin/Pause Flow, and visually confirm the paths and torso-height cue. Browser preview cannot validate joint tracking, controller haptics, play-area ergonomics, or headset-scale comfort; those changes need a headset smoke test.

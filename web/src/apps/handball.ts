/**
 * Handball app entry point.
 * Imports A-Frame components, sound engine, and UI handlers.
 */

import '../styles/main.css';
import { soundEngine } from '../components/spatial-audio';
import '../components/court';
import '../components/ball-physics';
import '../components/playspace-safety';
import '../components/hand-tracker';
import '../components/hand-striker';
import '../components/practice-bot';
import '../components/game-manager';
import '../components/hud';
import '../components/websocket-sync';

// Global audio activation on first user interaction or WebXR session start
window.addEventListener('click', () => {
  soundEngine.resume();
}, { once: true });

window.addEventListener('touchstart', () => {
  soundEngine.resume();
}, { once: true });

document.addEventListener('DOMContentLoaded', () => {
  const scene = document.querySelector('a-scene');
  if (scene) {
    scene.addEventListener('enter-vr', () => {
      soundEngine.resume();
      console.log('🕶️ Entered VR Mode (WebXR)');
    });
  }

  // Help Modal Toggle
  const helpBtn = document.getElementById('btn-help');
  const closeHelpBtn = document.getElementById('btn-close-help');
  const helpModal = document.getElementById('help-modal');

  helpBtn?.addEventListener('click', () => {
    if (helpModal) helpModal.style.display = 'block';
  });

  closeHelpBtn?.addEventListener('click', () => {
    if (helpModal) helpModal.style.display = 'none';
  });
});

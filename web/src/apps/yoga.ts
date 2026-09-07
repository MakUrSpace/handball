import '../styles/yoga.css';
import '../components/starfield';
import '../components/hand-tracker';
import '../components/playspace-safety';
import '../yoga/pose-guide';
import { toneBed } from '../yoga/tone-bed';

declare global {
  interface HTMLElement {
    enterVR?: () => Promise<void>;
  }
}

const scene = document.querySelector<HTMLElement>('#yoga-scene');
const startButton = document.querySelector<HTMLButtonElement>('#start-flow');
const audioButton = document.querySelector<HTMLButtonElement>('#audio-toggle');
const enterVrButton = document.querySelector<HTMLButtonElement>('#enter-vr');

const getGuide = () => (scene as any)?.components?.['yoga-pose-guide'];

async function startFlow() {
  await toneBed.start();
  getGuide()?.startSession?.();
  if (startButton) startButton.textContent = 'PAUSE FLOW';
}

startButton?.addEventListener('click', async () => {
  const guide = getGuide();
  if (guide?.isSessionActive?.()) {
    guide.pauseSession();
    startButton.textContent = 'RESUME FLOW';
  } else {
    await startFlow();
  }
});

enterVrButton?.addEventListener('click', async () => {
  await startFlow();
  await scene?.enterVR?.();
});

scene?.addEventListener('enter-vr', () => {
  void startFlow();
});

audioButton?.addEventListener('click', async () => {
  const nextEnabled = !toneBed.isEnabled();
  toneBed.setEnabled(nextEnabled);
  if (nextEnabled) await toneBed.start();
  audioButton.textContent = nextEnabled ? '444 HZ · ON' : '444 HZ · MUTED';
});

const settings = [
  { id: 'speed', property: 'speed' },
  { id: 'intensity', property: 'intensity' },
  { id: 'complexity', property: 'complexity' },
] as const;

for (const setting of settings) {
  const input = document.querySelector<HTMLInputElement>(`#${setting.id}`);
  const output = document.querySelector<HTMLOutputElement>(`#${setting.id}-output`);
  input?.addEventListener('input', () => {
    const value = Number(input.value) / 100;
    (scene as any)?.setAttribute('yoga-pose-guide', setting.property, value);
    if (!output) return;
    if (setting.id === 'speed') {
      output.textContent = value < 0.34 ? 'CALM' : value > 0.67 ? 'VIVID' : 'BALANCED';
    } else {
      output.textContent = `${Math.round(value * 100)}%`;
    }
  });
}

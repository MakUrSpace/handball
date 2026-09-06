import '../styles/launcher.css';
import '../components/starfield';

type AppDescriptor = {
  id: string;
  launch_path: string;
  description: string;
};

async function connectRegistry() {
  const status = document.querySelector<HTMLElement>('#server-status');

  try {
    const response = await fetch('/api/apps', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`registry returned ${response.status}`);

    const payload = await response.json() as { apps: AppDescriptor[] };
    for (const app of payload.apps) {
      const card = document.querySelector<HTMLAnchorElement>(`[data-app-id="${app.id}"]`);
      if (card) {
        card.href = app.launch_path;
        card.dataset.available = 'true';
      }
    }

    if (status) {
      status.textContent = `${payload.apps.length} EXPERIENCES ONLINE`;
      status.dataset.connected = 'true';
    }
  } catch {
    if (status) status.textContent = 'LOCAL EXPERIENCES READY';
  }
}

connectRegistry();

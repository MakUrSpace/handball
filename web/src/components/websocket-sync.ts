/**
 * A-Frame Component / Service: websocket-sync
 * Handles real-time bi-directional synchronization with the Rust Axum backend.
 */

import type { MatchSnapshot } from '../types';

declare const AFRAME: any;

AFRAME.registerComponent('websocket-sync', {
  schema: {
    autoConnect: { type: 'boolean', default: true },
  },

  init: function () {
    this.socket = null as WebSocket | null;
    this.reconnectTimer = null as any;
    this.gameManagerEl = document.querySelector('#game-scene');

    if (this.data.autoConnect) {
      this.connect();
    }
  },

  connect: function () {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/apps/handball`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log('🔗 WebSocket connected to VR Handball Engine server');
        this.updateConnectionStatus(true);
      };

      this.socket.onmessage = (event: MessageEvent) => {
        try {
          const snapshot: MatchSnapshot = JSON.parse(event.data);
          this.handleServerStatePush(snapshot);
        } catch (e) {
          console.warn('Error parsing WebSocket message:', e);
        }
      };

      this.socket.onclose = () => {
        this.updateConnectionStatus(false);
        this.scheduleReconnect();
      };

      this.socket.onerror = () => {
        this.updateConnectionStatus(false);
      };
    } catch (e) {
      console.warn('WebSocket connection failed:', e);
      this.scheduleReconnect();
    }
  },

  scheduleReconnect: function () {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  },

  sendRpc: function (method: string, params: any = null) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify({ method, params });
      this.socket.send(payload);
    }
  },

  handleServerStatePush: function (snapshot: MatchSnapshot) {
    // Optionally mirror server state if desired
    if (this.gameManagerEl) {
      this.gameManagerEl.emit('server-state-update', snapshot);
    }
  },

  updateConnectionStatus: function (connected: boolean) {
    const connDot = document.getElementById('hud-ws-dot');
    const connText = document.getElementById('hud-ws-text');

    if (connDot) {
      connDot.className = `w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 glow-emerald' : 'bg-rose-500'}`;
    }
    if (connText) {
      connText.textContent = connected ? 'LIVE WS CONNECTED' : 'OFFLINE / LOCAL';
      connText.className = connected ? 'text-emerald-400 font-mono text-xs' : 'text-rose-400 font-mono text-xs';
    }
  },
});

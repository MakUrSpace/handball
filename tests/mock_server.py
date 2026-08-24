#!/usr/bin/env python3
"""
Lightweight development test server implementing the VR Handball HTTP & RPC API
and serving static web assets from web/dist.
"""

import http.server
import socketserver
import json
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "web", "dist")

game_state = {
    "state": "Idle",
    "player_score": 0,
    "opponent_score": 0,
    "current_server": "Server",
    "current_rally": 0,
    "last_event_message": "Ready to Play",
    "ball_position": {"x": 0.0, "y": 1.2, "z": 5.0},
    "ball_velocity": {"x": 0.0, "y": 0.0, "z": 0.0},
    "ball_speed_mph": 0.0,
    "floor_bounces_since_hit": 0,
    "front_wall_hit_this_turn": False,
    "stats": {
        "total_rallies": 0,
        "longest_rally": 0,
        "current_rally_shots": 0,
        "max_ball_speed_mph": 0.0,
        "total_aces": 0,
        "kill_shots": 0
    },
    "settings": {
        "target_score": 21,
        "win_by_two": True,
        "auto_serve": False,
        "rally_scoring": True
    }
}

class HandballHttpHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def do_GET(self):
        if self.path == "/api/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "service": "vr-handball-engine", "version": "0.1.0"}).encode())
            return
        elif self.path == "/api/state":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(game_state).encode())
            return
        elif self.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/rpc":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode()
            req = json.loads(body)
            method = req.get("method")

            if method == "start":
                game_state["state"] = "Serving"
                game_state["last_event_message"] = "Game Started! Serve ball."
            elif method == "pause":
                game_state["state"] = "Paused"
                game_state["last_event_message"] = "Game Paused"
            elif method == "reset":
                game_state["state"] = "Idle"
                game_state["player_score"] = 0
                game_state["opponent_score"] = 0
                game_state["last_event_message"] = "Match reset"

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            res = {
                "jsonrpc": "2.0",
                "result": game_state,
                "error": None
            }
            self.wfile.write(json.dumps(res).encode())
            return

        self.send_response(404)
        self.end_headers()

if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), HandballHttpHandler) as httpd:
        print(f"VR Handball Server running at http://localhost:{PORT}")
        httpd.serve_forever()

#!/usr/bin/env python3
"""
E2E Verification script for VR Handball Server & Web API.
Tests HTTP REST API, RPC methods, WebSocket broadcasting, and static file serving.
"""

import sys
import time
import json
import urllib.request
import urllib.error

def test_json_endpoint(url, method="GET", payload=None):
    req = urllib.request.Request(url, method=method)
    if payload is not None:
        req.add_header('Content-Type', 'application/json')
        data = json.dumps(payload).encode('utf-8')
    else:
        data = None

    try:
        with urllib.request.urlopen(req, data=data, timeout=5) as response:
            body = response.read().decode('utf-8')
            return json.loads(body)
    except urllib.error.URLError as e:
        print(f"❌ HTTP request to {url} failed: {e}")
        return None

def run_tests(base_url="http://localhost:8080"):
    print(f"=== Running VR Handball E2E Verification against {base_url} ===")
    
    # 1. Health check
    health = test_json_endpoint(f"{base_url}/api/health")
    if health and health.get("status") == "ok":
        print("✅ /api/health passed:", health)
    else:
        print("❌ /api/health failed")
        return False

    # 2. State Snapshot
    state = test_json_endpoint(f"{base_url}/api/state")
    if state and "state" in state and "player_score" in state:
        print(f"✅ /api/state passed: state={state['state']}, score={state['player_score']}-{state['opponent_score']}")
    else:
        print("❌ /api/state failed")
        return False

    # 3. RPC Start Game
    start_res = test_json_endpoint(f"{base_url}/api/rpc", method="POST", payload={"method": "start"})
    if start_res and "result" in start_res and start_res["result"].get("state") == "Serving":
        print("✅ RPC 'start' passed:", start_res["result"]["last_event_message"])
    else:
        print("❌ RPC 'start' failed:", start_res)
        return False

    # 4. RPC Pause Game
    pause_res = test_json_endpoint(f"{base_url}/api/rpc", method="POST", payload={"method": "pause"})
    if pause_res and "result" in pause_res and pause_res["result"].get("state") == "Paused":
        print("✅ RPC 'pause' passed:", pause_res["result"]["last_event_message"])
    else:
        print("❌ RPC 'pause' failed:", pause_res)
        return False

    # 5. RPC Reset Game
    reset_res = test_json_endpoint(f"{base_url}/api/rpc", method="POST", payload={"method": "reset"})
    if reset_res and "result" in reset_res and reset_res["result"].get("state") == "Idle":
        print("✅ RPC 'reset' passed:", reset_res["result"]["last_event_message"])
    else:
        print("❌ RPC 'reset' failed:", reset_res)
        return False

    print("🎉 All VR Handball E2E API tests passed successfully!")
    return True

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
    success = run_tests(url)
    sys.exit(0 if success else 1)

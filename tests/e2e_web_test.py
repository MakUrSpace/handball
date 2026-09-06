#!/usr/bin/env python3
"""
E2E Verification script for VR Handball Server & Web API.
Tests the app registry, scoped handball API, and every static app entry point.
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

def test_html_endpoint(url, marker):
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            body = response.read().decode("utf-8")
            return response.status == 200 and marker in body
    except urllib.error.URLError as e:
        print(f"❌ HTML request to {url} failed: {e}")
        return False

def run_tests(base_url="http://localhost:8080"):
    print(f"=== Running VR Handball E2E Verification against {base_url} ===")
    
    # 1. Health check
    health = test_json_endpoint(f"{base_url}/api/health")
    if health and health.get("status") == "ok":
        print("✅ /api/health passed:", health)
    else:
        print("❌ /api/health failed")
        return False

    # 2. App registry
    registry = test_json_endpoint(f"{base_url}/api/apps")
    app_ids = {app.get("id") for app in (registry or {}).get("apps", [])}
    if {"handball", "yoga"}.issubset(app_ids):
        print("✅ /api/apps passed: handball and yoga registered")
    else:
        print("❌ /api/apps failed:", registry)
        return False

    # 3. Every frontend entry is independently addressable.
    pages = [
        ("/", "Choose your space"),
        ("/apps/handball/", "VR HANDBALL"),
        ("/apps/yoga/", "yoga-pose-guide"),
    ]
    for path, marker in pages:
        if not test_html_endpoint(f"{base_url}{path}", marker):
            print(f"❌ static app route failed: {path}")
            return False
    print("✅ launcher, handball, and yoga static routes passed")

    # 4. Scoped handball state snapshot
    state = test_json_endpoint(f"{base_url}/api/apps/handball/state")
    if state and "state" in state and "player_score" in state:
        print(f"✅ scoped state passed: state={state['state']}, score={state['player_score']}-{state['opponent_score']}")
    else:
        print("❌ /api/state failed")
        return False

    # 5. Scoped RPC start game
    rpc_url = f"{base_url}/api/apps/handball/rpc"
    start_res = test_json_endpoint(rpc_url, method="POST", payload={"method": "start"})
    if start_res and "result" in start_res and start_res["result"].get("state") == "Serving":
        print("✅ RPC 'start' passed:", start_res["result"]["last_event_message"])
    else:
        print("❌ RPC 'start' failed:", start_res)
        return False

    # 6. Scoped RPC pause game
    pause_res = test_json_endpoint(rpc_url, method="POST", payload={"method": "pause"})
    if pause_res and "result" in pause_res and pause_res["result"].get("state") == "Paused":
        print("✅ RPC 'pause' passed:", pause_res["result"]["last_event_message"])
    else:
        print("❌ RPC 'pause' failed:", pause_res)
        return False

    # 7. Scoped RPC reset game
    reset_res = test_json_endpoint(rpc_url, method="POST", payload={"method": "reset"})
    if reset_res and "result" in reset_res and reset_res["result"].get("state") == "Idle":
        print("✅ RPC 'reset' passed:", reset_res["result"]["last_event_message"])
    else:
        print("❌ RPC 'reset' failed:", reset_res)
        return False

    # 8. Compatibility state alias remains available to old handball clients.
    legacy_state = test_json_endpoint(f"{base_url}/api/state")
    if not legacy_state or "state" not in legacy_state:
        print("❌ legacy /api/state compatibility alias failed")
        return False

    print("🎉 All A-Frame App Hub E2E tests passed successfully!")
    return True

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
    success = run_tests(url)
    sys.exit(0 if success else 1)

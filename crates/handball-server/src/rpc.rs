use crate::state::AppState;
use handball_core::{
    CourtDimensions, HandState, MatchSettings, MatchSnapshot, PlayerRole, StrikePhysics, Vec3,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tracing::{info, warn};

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub method: String,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub jsonrpc: String,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

pub async fn execute_rpc(state: Arc<AppState>, req: RpcRequest) -> Result<serde_json::Value, String> {
    info!("RPC method invocation: '{}'", req.method);
    let mut engine = state.engine.lock().map_err(|e| e.to_string())?;

    match req.method.as_str() {
        "get_state" => {
            let snap = engine.snapshot();
            Ok(json!(snap))
        }
        "start" => {
            engine.rules.start_game();
            engine.ball.position = Vec3::new(0.0, 1.2, 5.0);
            engine.ball.velocity = Vec3::ZERO;
            let snap = engine.snapshot();
            broadcast_state(&state, &snap);
            Ok(json!(snap))
        }
        "pause" => {
            engine.rules.toggle_pause();
            let snap = engine.snapshot();
            broadcast_state(&state, &snap);
            Ok(json!(snap))
        }
        "reset" => {
            engine.rules.reset();
            engine.ball.position = Vec3::new(0.0, 1.2, 5.0);
            engine.ball.velocity = Vec3::ZERO;
            let snap = engine.snapshot();
            broadcast_state(&state, &snap);
            Ok(json!(snap))
        }
        "serve" => {
            engine.rules.start_game();
            // Ball placed in hand ready for toss
            engine.ball.position = Vec3::new(0.0, 1.2, 5.0);
            engine.ball.velocity = Vec3::new(0.0, 3.0, -12.0); // Initial serve impulse towards front wall
            let snap = engine.snapshot();
            broadcast_state(&state, &snap);
            Ok(json!(snap))
        }
        "strike" => {
            if let Some(params) = req.params {
                let hand: HandState = serde_json::from_value(params)
                    .map_err(|e| format!("Invalid HandState payload: {}", e))?;
                let striker = StrikePhysics::default();
                if let Some(res) = striker.calculate_strike(&hand, &engine.ball) {
                    engine.ball.velocity = res.new_ball_velocity;
                    engine.rules.register_strike(PlayerRole::Server, &res);
                    let snap = engine.snapshot();
                    broadcast_state(&state, &snap);
                    Ok(json!({
                        "hit": true,
                        "strike": res,
                        "snapshot": snap
                    }))
                } else {
                    Ok(json!({ "hit": false }))
                }
            } else {
                Err("Missing hand state parameters for strike".to_string())
            }
        }
        "sync_ball" => {
            if let Some(params) = req.params {
                if let Some(pos) = params.get("position") {
                    if let Ok(p) = serde_json::from_value::<Vec3>(pos.clone()) {
                        engine.ball.position = p;
                    }
                }
                if let Some(vel) = params.get("velocity") {
                    if let Ok(v) = serde_json::from_value::<Vec3>(vel.clone()) {
                        engine.ball.velocity = v;
                    }
                }
                let snap = engine.snapshot();
                Ok(json!(snap))
            } else {
                Err("Missing parameters for sync_ball".to_string())
            }
        }
        "set_settings" => {
            if let Some(params) = req.params {
                let settings: MatchSettings = serde_json::from_value(params)
                    .map_err(|e| format!("Invalid settings payload: {}", e))?;
                engine.rules.settings = settings;
                let snap = engine.snapshot();
                broadcast_state(&state, &snap);
                Ok(json!(snap))
            } else {
                Err("Missing settings payload".to_string())
            }
        }
        "set_court_mode" => {
            let mode = req
                .params
                .as_ref()
                .and_then(|p| p.as_str())
                .unwrap_or("narrow");
            if mode == "regulation" {
                engine.court = CourtDimensions::regulation();
            } else {
                engine.court = CourtDimensions::narrow();
            }
            let snap = engine.snapshot();
            broadcast_state(&state, &snap);
            Ok(json!(snap))
        }
        _ => {
            warn!("Unknown RPC method: {}", req.method);
            Err(format!("Unknown RPC method '{}'", req.method))
        }
    }
}

fn broadcast_state(state: &AppState, snap: &MatchSnapshot) {
    if let Ok(json_str) = serde_json::to_string(snap) {
        let _ = state.tx.send(json_str);
    }
}

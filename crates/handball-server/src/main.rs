use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use handball_core::MatchSnapshot;
use serde_json::json;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tracing::{error, info};

mod rpc;
mod state;

use rpc::{execute_rpc, RpcRequest, RpcResponse};
use state::{AppState, HandballEngineState};

#[derive(Parser, Debug)]
#[command(author, version, about = "VR Handball Web & API Server")]
struct Args {
    #[arg(short, long, default_value_t = 8080)]
    port: u16,

    #[arg(short, long, default_value = "./web/dist")]
    web_dir: PathBuf,

    #[arg(short, long, default_value_t = 60)]
    tick_rate: u32,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,handball_server=info".into()),
        )
        .init();

    let args = Args::parse();

    info!("=======================================================");
    info!("Starting VR Handball Engine Server on port {}", args.port);
    info!("Serving Web UI static assets from {:?}", args.web_dir);
    info!("=======================================================");

    let engine = Arc::new(Mutex::new(HandballEngineState::new()));
    let (tx, _) = broadcast::channel::<String>(200);

    let state = Arc::new(AppState {
        engine: engine.clone(),
        tx: tx.clone(),
    });

    // Background simulation loop for server-side physics verification / spectator broadcast
    let engine_clone = engine.clone();
    let tx_clone = tx.clone();
    let tick_interval_ms = (1000 / args.tick_rate.max(1)).max(5) as u64;
    let dt = tick_interval_ms as f32 / 1000.0;

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(tick_interval_ms));
        let mut last_state = handball_core::MatchState::Idle;

        loop {
            interval.tick().await;
            let mut eng = engine_clone.lock().unwrap();
            
            // Only simulate physics continuously when ball is in play or serving
            if eng.rules.state == handball_core::MatchState::InPlay {
                let snap = eng.tick(dt);
                if let Ok(json_str) = serde_json::to_string(&snap) {
                    let _ = tx_clone.send(json_str);
                }
            } else if eng.rules.state != last_state {
                last_state = eng.rules.state;
                let snap = eng.snapshot();
                if let Ok(json_str) = serde_json::to_string(&snap) {
                    let _ = tx_clone.send(json_str);
                }
            }
        }
    });

    let index_html_path = args.web_dir.join("index.html");
    let app = Router::new()
        .route("/api/health", get(health_check))
        .route("/api/state", get(get_state))
        .route("/api/rpc", post(handle_rpc_endpoint))
        .route("/ws", get(ws_handler))
        .fallback_service(ServeDir::new(&args.web_dir).fallback(ServeFile::new(index_html_path)))
        .layer(axum::middleware::map_response(no_cache_response))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], args.port));
    info!("VR Handball Server listening at http://{}", addr);

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            error!("Failed to bind TCP listener on {}: {}", addr, e);
            std::process::exit(1);
        }
    };

    if let Err(e) = axum::serve(listener, app).await {
        error!("Server execution error: {}", e);
    }
}

async fn no_cache_response(mut response: axum::response::Response) -> axum::response::Response {
    let headers = response.headers_mut();
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-cache, no-store, must-revalidate"),
    );
    headers.insert(
        axum::http::header::PRAGMA,
        axum::http::HeaderValue::from_static("no-cache"),
    );
    headers.insert(
        axum::http::header::EXPIRES,
        axum::http::HeaderValue::from_static("0"),
    );
    response
}

async fn health_check() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "service": "vr-handball-engine",
        "version": "0.1.0"
    }))
}

async fn get_state(State(state): State<Arc<AppState>>) -> Json<MatchSnapshot> {
    let engine = state.engine.lock().unwrap();
    Json(engine.snapshot())
}

async fn handle_rpc_endpoint(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RpcRequest>,
) -> Json<RpcResponse> {
    match execute_rpc(state, req).await {
        Ok(res) => Json(RpcResponse {
            jsonrpc: "2.0".into(),
            result: Some(res),
            error: None,
        }),
        Err(err) => Json(RpcResponse {
            jsonrpc: "2.0".into(),
            result: None,
            error: Some(err),
        }),
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    info!("New WebXR client connected to game stream");
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.tx.subscribe();

    // Send initial snapshot on connect
    let init_json = {
        let engine = state.engine.lock().unwrap();
        serde_json::to_string(&engine.snapshot()).unwrap_or_default()
    };

    if let Err(e) = sender.send(Message::Text(init_json)).await {
        error!("Failed to send initial state over WebSocket: {}", e);
        return;
    }

    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    let state_clone = state.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(text) = msg {
                if let Ok(rpc_req) = serde_json::from_str::<RpcRequest>(&text) {
                    let _ = execute_rpc(state_clone.clone(), rpc_req).await;
                }
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => info!("WebSocket send channel closed for client"),
        _ = (&mut recv_task) => info!("WebSocket receive channel closed for client"),
    };
}

use handball_core::{
    Ball, CourtDimensions, HandballGameRules, MatchSettings, MatchSnapshot, PhysicsConfig,
    PhysicsEngine,
};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

use crate::apps::AppRegistry;

pub struct AppState {
    pub apps: AppRegistry,
    pub handball: Arc<HandballAppState>,
}

/// State owned by the handball app. Other apps can add their own state object
/// without coupling it to the handball simulation.
pub struct HandballAppState {
    pub engine: Arc<Mutex<HandballEngineState>>,
    pub tx: broadcast::Sender<String>,
}

pub struct HandballEngineState {
    #[allow(dead_code)]
    pub court: CourtDimensions,
    pub physics: PhysicsEngine,
    pub rules: HandballGameRules,
    pub ball: Ball,
}

impl HandballEngineState {
    pub fn new() -> Self {
        let court = CourtDimensions::default();
        let config = PhysicsConfig::default();
        let physics = PhysicsEngine::new(court.clone(), config);
        let rules = HandballGameRules::new(court.clone(), MatchSettings::default());
        let ball = Ball::default();

        Self {
            court,
            physics,
            rules,
            ball,
        }
    }

    pub fn tick(&mut self, dt: f32) -> MatchSnapshot {
        let events = self.physics.step(&mut self.ball, dt);
        self.rules.process_collisions(&events, &self.ball);
        self.rules.snapshot(&self.ball)
    }

    pub fn snapshot(&self) -> MatchSnapshot {
        self.rules.snapshot(&self.ball)
    }
}

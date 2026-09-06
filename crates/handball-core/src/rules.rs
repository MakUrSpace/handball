use crate::court::{CourtDimensions, WallSurface};
use crate::physics::{Ball, CollisionEvent, Vec3};
use crate::strike::StrikeResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlayerRole {
    Server,
    Receiver,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MatchState {
    Idle,
    Serving,
    InPlay,
    PointScored,
    SideOut,
    Fault,
    Paused,
    GameOver,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchSettings {
    pub target_score: u32, // e.g. 21 (or 15, 11)
    pub win_by_two: bool,
    pub auto_serve: bool,
    pub rally_scoring: bool, // True = point on every rally; False = traditional USHA side-out scoring
    #[serde(default)]
    pub freeplay: bool, // Track shots/accuracy without faults, points, or rally termination
}

impl Default for MatchSettings {
    fn default() -> Self {
        Self {
            target_score: 21,
            win_by_two: true,
            auto_serve: false,
            rally_scoring: true, // Modern rally scoring default for fun continuous play
            freeplay: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchStats {
    pub total_rallies: u32,
    pub longest_rally: u32,
    pub current_rally_shots: u32,
    pub max_ball_speed_mph: f32,
    pub total_aces: u32,
    pub kill_shots: u32,
    pub center_wall_hits: u32,
    pub opponent_center_wall_hits: u32,
}

impl Default for MatchStats {
    fn default() -> Self {
        Self {
            total_rallies: 0,
            longest_rally: 0,
            current_rally_shots: 0,
            max_ball_speed_mph: 0.0,
            total_aces: 0,
            kill_shots: 0,
            center_wall_hits: 0,
            opponent_center_wall_hits: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchSnapshot {
    pub state: MatchState,
    pub player_score: u32,
    pub opponent_score: u32,
    pub current_server: PlayerRole,
    pub current_rally: u32,
    pub last_event_message: String,
    pub ball_position: Vec3,
    pub ball_velocity: Vec3,
    pub ball_speed_mph: f32,
    pub floor_bounces_since_hit: u32,
    pub front_wall_hit_this_turn: bool,
    pub stats: MatchStats,
    pub settings: MatchSettings,
}

pub struct HandballGameRules {
    pub state: MatchState,
    pub player_score: u32,
    pub opponent_score: u32,
    pub current_server: PlayerRole,
    pub floor_bounces_since_hit: u32,
    pub front_wall_hit_this_turn: bool,
    pub last_hitter: Option<PlayerRole>,
    pub stats: MatchStats,
    pub settings: MatchSettings,
    pub court: CourtDimensions,
    pub message: String,
}

impl HandballGameRules {
    pub fn new(court: CourtDimensions, settings: MatchSettings) -> Self {
        Self {
            state: MatchState::Idle,
            player_score: 0,
            opponent_score: 0,
            current_server: PlayerRole::Server,
            floor_bounces_since_hit: 0,
            front_wall_hit_this_turn: false,
            last_hitter: None,
            stats: MatchStats::default(),
            settings,
            court,
            message: "Welcome to VR Handball! Press Start or Toss ball to serve.".to_string(),
        }
    }

    /// Reset match state and scores
    pub fn reset(&mut self) {
        self.state = MatchState::Idle;
        self.player_score = 0;
        self.opponent_score = 0;
        self.current_server = PlayerRole::Server;
        self.floor_bounces_since_hit = 0;
        self.front_wall_hit_this_turn = false;
        self.last_hitter = None;
        self.stats = MatchStats::default();
        self.message = "Match reset. Ready to serve.".to_string();
    }

    /// Start a new game
    pub fn start_game(&mut self) {
        self.state = MatchState::Serving;
        self.floor_bounces_since_hit = 0;
        self.front_wall_hit_this_turn = false;
        self.message = "Game Started! Serve the ball against the front wall.".to_string();
    }

    /// Toggle Pause / Resume
    pub fn toggle_pause(&mut self) {
        if self.state == MatchState::Paused {
            self.state = MatchState::InPlay;
            self.message = "Game Resumed".to_string();
        } else if self.state == MatchState::InPlay || self.state == MatchState::Serving {
            self.state = MatchState::Paused;
            self.message = "Game Paused".to_string();
        }
    }

    /// Register a strike on the ball by a player
    pub fn register_strike(&mut self, role: PlayerRole, strike: &StrikeResult) {
        if self.state == MatchState::GameOver || self.state == MatchState::Paused {
            return;
        }

        self.last_hitter = Some(role);
        self.floor_bounces_since_hit = 0;
        self.front_wall_hit_this_turn = false;
        self.stats.current_rally_shots += 1;
        if self.settings.freeplay && self.stats.current_rally_shots > self.stats.longest_rally {
            self.stats.longest_rally = self.stats.current_rally_shots;
        }

        if strike.strike_speed_mph > self.stats.max_ball_speed_mph {
            self.stats.max_ball_speed_mph = strike.strike_speed_mph;
        }

        if strike.quality == crate::strike::HitQuality::KillShot {
            self.stats.kill_shots += 1;
            self.message = format!("🔥 KILL SHOT! {:.1} MPH", strike.strike_speed_mph);
        } else {
            self.message = format!("Strike! {:.1} MPH", strike.strike_speed_mph);
        }

        if self.state == MatchState::Serving || self.state == MatchState::Idle {
            self.state = MatchState::InPlay;
        }
    }

    /// Process collision events from the physics engine to update handball game rules
    pub fn process_collisions(&mut self, events: &[CollisionEvent], ball: &Ball) {
        if self.state != MatchState::InPlay && self.state != MatchState::Serving {
            return;
        }

        for event in events {
            match event.surface {
                WallSurface::FrontWall => {
                    if !self.front_wall_hit_this_turn {
                        self.front_wall_hit_this_turn = true;
                        let target_radius = if self.court.width <= 2.5 { 0.42 } else { 0.67 };
                        let dx = event.point.x;
                        let dy = event.point.y - 1.2;
                        if (dx * dx + dy * dy).sqrt() <= target_radius {
                            match self.last_hitter {
                                Some(PlayerRole::Receiver) => {
                                    self.stats.opponent_center_wall_hits += 1;
                                }
                                Some(PlayerRole::Server) => {
                                    self.stats.center_wall_hits += 1;
                                }
                                None => {}
                            }
                        }
                    }
                }
                WallSurface::Floor => {
                    self.floor_bounces_since_hit += 1;

                    if self.settings.freeplay {
                        continue;
                    }

                    // Every shot must reach the front wall before touching the floor.
                    if !self.front_wall_hit_this_turn {
                        if self.last_hitter.is_none() {
                            self.handle_fault("Service Fault: Ball hit floor before front wall!");
                        } else {
                            let player_won = self.last_hitter == Some(PlayerRole::Receiver);
                            self.handle_rally_end(player_won, "Floor before front wall");
                        }
                        return;
                    }

                    // If in rally and ball bounces twice without return strike -> rally ends
                    if self.floor_bounces_since_hit >= 2 {
                        let player_won = self.last_hitter != Some(PlayerRole::Receiver);
                        self.handle_rally_end(player_won, "Double bounce");
                        return;
                    }
                }
                WallSurface::Ceiling | WallSurface::LeftWall | WallSurface::RightWall => {
                    // Legal in 4-wall handball as long as front wall is reached before 2 floor bounces
                }
                WallSurface::BackWall => {
                    // Legal back wall carom
                }
            }
        }

        // Check if ball went out of bounds or died
        let speed = ball.velocity.length();
        if !self.settings.freeplay
            && self.state == MatchState::InPlay
            && self.floor_bounces_since_hit >= 1
            && speed < 0.5
        {
            let player_won = self.last_hitter != Some(PlayerRole::Receiver);
            self.handle_rally_end(player_won, "Dead ball after one bounce");
        }
    }

    fn handle_fault(&mut self, reason: &str) {
        self.state = MatchState::Fault;
        self.message = reason.to_string();
        if self.settings.rally_scoring {
            self.opponent_score += 1;
            self.check_game_over();
        } else {
            // Traditional side-out
            self.current_server = match self.current_server {
                PlayerRole::Server => PlayerRole::Receiver,
                PlayerRole::Receiver => PlayerRole::Server,
            };
        }
    }

    fn handle_rally_end(&mut self, player_won: bool, reason: &str) {
        self.stats.total_rallies += 1;
        if self.stats.current_rally_shots > self.stats.longest_rally {
            self.stats.longest_rally = self.stats.current_rally_shots;
        }

        if player_won {
            self.player_score += 1;
            self.current_server = PlayerRole::Server;
            self.state = MatchState::PointScored;
            self.message = format!("Point to Player! ({})", reason);
        } else {
            self.opponent_score += 1;
            self.current_server = PlayerRole::Receiver;
            self.state = MatchState::PointScored;
            self.message = format!("Point to Opponent! ({})", reason);
        }

        self.stats.current_rally_shots = 0;
        self.check_game_over();
    }

    fn check_game_over(&mut self) {
        let p = self.player_score;
        let o = self.opponent_score;
        let target = self.settings.target_score;

        let won = if self.settings.win_by_two {
            (p >= target && p >= o + 2) || (o >= target && o >= p + 2)
        } else {
            p >= target || o >= target
        };

        if won {
            self.state = MatchState::GameOver;
            if p > o {
                self.message = format!("🏆 MATCH WON! Final Score: {} - {}", p, o);
            } else {
                self.message = format!("MATCH OVER. Final Score: {} - {}", p, o);
            }
        }
    }

    /// Extract a full serializable snapshot of the current match
    pub fn snapshot(&self, ball: &Ball) -> MatchSnapshot {
        let speed_mph = ball.velocity.length() * 2.23694;
        MatchSnapshot {
            state: self.state,
            player_score: self.player_score,
            opponent_score: self.opponent_score,
            current_server: self.current_server,
            current_rally: self.stats.current_rally_shots,
            last_event_message: self.message.clone(),
            ball_position: ball.position,
            ball_velocity: ball.velocity,
            ball_speed_mph: speed_mph,
            floor_bounces_since_hit: self.floor_bounces_since_hit,
            front_wall_hit_this_turn: self.front_wall_hit_this_turn,
            stats: self.stats.clone(),
            settings: self.settings.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rules_lifecycle() {
        let court = CourtDimensions::default();
        let mut rules = HandballGameRules::new(court, MatchSettings::default());

        assert_eq!(rules.state, MatchState::Idle);
        rules.start_game();
        assert_eq!(rules.state, MatchState::Serving);

        let ball = Ball {
            velocity: Vec3::new(0.0, 0.0, 3.0),
            ..Ball::default()
        };
        let strike = StrikeResult {
            hit: true,
            quality: crate::strike::HitQuality::Solid,
            strike_speed_mps: 15.0,
            strike_speed_mph: 33.5,
            new_ball_velocity: Vec3::new(0.0, 2.0, -15.0),
            contact_point: Vec3::new(0.0, 1.2, 5.0),
        };

        rules.register_strike(PlayerRole::Server, &strike);
        assert_eq!(rules.state, MatchState::InPlay);
        assert_eq!(rules.stats.current_rally_shots, 1);

        // Simulate front wall hit and 2 floor bounces -> rally should end with a point
        let front_wall_event = CollisionEvent {
            surface: WallSurface::FrontWall,
            point: Vec3::new(0.0, 1.5, 0.0),
            impact_speed: 15.0,
            normal: Vec3::new(0.0, 0.0, 1.0),
        };
        rules.process_collisions(&[front_wall_event], &ball);
        assert!(rules.front_wall_hit_this_turn);

        let floor_bounce_1 = CollisionEvent {
            surface: WallSurface::Floor,
            point: Vec3::new(0.0, 0.0, 6.0),
            impact_speed: 8.0,
            normal: Vec3::new(0.0, 1.0, 0.0),
        };
        rules.process_collisions(&[floor_bounce_1.clone()], &ball);
        assert_eq!(rules.floor_bounces_since_hit, 1);

        rules.process_collisions(&[floor_bounce_1], &ball);
        assert_eq!(rules.floor_bounces_since_hit, 2);
        assert_eq!(rules.state, MatchState::PointScored);
        assert_eq!(rules.player_score, 1);
    }
}

use handball_core::{
    Ball, CollisionEvent, CourtDimensions, HandballGameRules, HitQuality, MatchSettings,
    MatchState, PlayerRole, StrikeResult, Vec3, WallSurface,
};

#[test]
fn test_match_scoring_and_sideout_transitions() {
    let court = CourtDimensions::default();
    let settings = MatchSettings {
        target_score: 5,
        win_by_two: true,
        auto_serve: false,
        rally_scoring: true,
    };
    let mut rules = HandballGameRules::new(court, settings);

    assert_eq!(rules.state, MatchState::Idle);
    rules.start_game();
    assert_eq!(rules.state, MatchState::Serving);

    let ball = Ball::default();
    let strike = StrikeResult {
        hit: true,
        quality: HitQuality::KillShot,
        strike_speed_mps: 25.0,
        strike_speed_mph: 55.9,
        new_ball_velocity: Vec3::new(0.0, 1.0, -25.0),
        contact_point: Vec3::new(0.0, 1.2, 5.0),
    };

    // Serve strike
    rules.register_strike(PlayerRole::Server, &strike);
    assert_eq!(rules.state, MatchState::InPlay);
    assert_eq!(rules.stats.kill_shots, 1);

    // Ball hits front wall
    let front_hit = CollisionEvent {
        surface: WallSurface::FrontWall,
        point: Vec3::new(0.0, 1.0, 0.0),
        impact_speed: 25.0,
        normal: Vec3::new(0.0, 0.0, 1.0),
    };
    rules.process_collisions(&[front_hit], &ball);

    // Ball bounces twice on floor
    let floor_bounce = CollisionEvent {
        surface: WallSurface::Floor,
        point: Vec3::new(0.0, 0.0, 6.5),
        impact_speed: 12.0,
        normal: Vec3::new(0.0, 1.0, 0.0),
    };
    rules.process_collisions(&[floor_bounce.clone()], &ball);
    assert_eq!(rules.floor_bounces_since_hit, 1);

    rules.process_collisions(&[floor_bounce], &ball);
    assert_eq!(rules.floor_bounces_since_hit, 2);
    assert_eq!(rules.state, MatchState::PointScored);
    assert_eq!(rules.player_score, 1);
}

#[test]
fn test_service_fault_before_front_wall() {
    let court = CourtDimensions::default();
    let mut rules = HandballGameRules::new(court, MatchSettings::default());

    rules.start_game();
    assert_eq!(rules.state, MatchState::Serving);

    let ball = Ball::default();
    // Ball hits floor first while serving (without front wall hit)
    let floor_bounce = CollisionEvent {
        surface: WallSurface::Floor,
        point: Vec3::new(0.0, 0.0, 4.0),
        impact_speed: 5.0,
        normal: Vec3::new(0.0, 1.0, 0.0),
    };
    rules.process_collisions(&[floor_bounce], &ball);

    assert_eq!(rules.state, MatchState::Fault);
    assert_eq!(rules.opponent_score, 1); // Point awarded to opponent on fault under rally scoring
}

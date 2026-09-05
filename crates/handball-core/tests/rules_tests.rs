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
        freeplay: false,
    };
    let mut rules = HandballGameRules::new(court, settings);

    assert_eq!(rules.state, MatchState::Idle);
    rules.start_game();
    assert_eq!(rules.state, MatchState::Serving);

    let ball = Ball {
        velocity: Vec3::new(0.0, 0.0, 3.0),
        ..Ball::default()
    };
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

#[test]
fn receiver_scores_when_player_shot_misses_front_wall() {
    let court = CourtDimensions::default();
    let mut rules = HandballGameRules::new(court, MatchSettings::default());
    rules.start_game();

    let strike = StrikeResult {
        hit: true,
        quality: HitQuality::Solid,
        strike_speed_mps: 12.0,
        strike_speed_mph: 26.8,
        new_ball_velocity: Vec3::new(0.0, -1.0, -2.0),
        contact_point: Vec3::new(0.0, 1.0, 5.0),
    };
    rules.register_strike(PlayerRole::Server, &strike);

    let floor_bounce = CollisionEvent {
        surface: WallSurface::Floor,
        point: Vec3::new(0.0, 0.0, 4.0),
        impact_speed: 5.0,
        normal: Vec3::new(0.0, 1.0, 0.0),
    };
    rules.process_collisions(&[floor_bounce], &Ball::default());

    assert_eq!(rules.opponent_score, 1);
    assert_eq!(rules.current_server, PlayerRole::Receiver);
    assert_eq!(rules.stats.total_rallies, 1);
}

#[test]
fn center_front_wall_hit_is_counted_once_per_shot() {
    let court = CourtDimensions::default();
    let mut rules = HandballGameRules::new(court, MatchSettings::default());
    rules.start_game();

    let strike = StrikeResult {
        hit: true,
        quality: HitQuality::Solid,
        strike_speed_mps: 12.0,
        strike_speed_mph: 26.8,
        new_ball_velocity: Vec3::new(0.0, 1.0, -12.0),
        contact_point: Vec3::new(0.0, 1.2, 5.0),
    };
    rules.register_strike(PlayerRole::Server, &strike);

    let center_hit = CollisionEvent {
        surface: WallSurface::FrontWall,
        point: Vec3::new(0.1, 1.25, 0.0),
        impact_speed: 12.0,
        normal: Vec3::new(0.0, 0.0, 1.0),
    };
    rules.process_collisions(&[center_hit.clone(), center_hit], &Ball::default());

    assert_eq!(rules.stats.center_wall_hits, 1);
    assert_eq!(rules.stats.opponent_center_wall_hits, 0);
}

#[test]
fn freeplay_tracks_rally_and_accuracy_without_scoring() {
    let court = CourtDimensions::default();
    let mut settings = MatchSettings::default();
    settings.freeplay = true;
    let mut rules = HandballGameRules::new(court, settings);
    rules.start_game();

    let strike = StrikeResult {
        hit: true,
        quality: HitQuality::Solid,
        strike_speed_mps: 12.0,
        strike_speed_mph: 26.8,
        new_ball_velocity: Vec3::new(0.0, 1.0, -12.0),
        contact_point: Vec3::new(0.0, 1.2, 5.0),
    };
    rules.register_strike(PlayerRole::Server, &strike);

    let center_hit = CollisionEvent {
        surface: WallSurface::FrontWall,
        point: Vec3::new(0.0, 1.2, 0.0),
        impact_speed: 12.0,
        normal: Vec3::new(0.0, 0.0, 1.0),
    };
    let floor_bounce = CollisionEvent {
        surface: WallSurface::Floor,
        point: Vec3::new(0.0, 0.0, 5.0),
        impact_speed: 5.0,
        normal: Vec3::new(0.0, 1.0, 0.0),
    };
    rules.process_collisions(&[center_hit], &Ball::default());
    rules.process_collisions(&[floor_bounce.clone(), floor_bounce], &Ball::default());

    assert_eq!(rules.state, MatchState::InPlay);
    assert_eq!(rules.player_score, 0);
    assert_eq!(rules.opponent_score, 0);
    assert_eq!(rules.stats.current_rally_shots, 1);
    assert_eq!(rules.stats.longest_rally, 1);
    assert_eq!(rules.stats.center_wall_hits, 1);
}

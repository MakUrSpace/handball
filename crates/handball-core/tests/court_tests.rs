use handball_core::{Ball, CourtDimensions, PhysicsConfig, PhysicsEngine, Vec3, WallSurface};

#[test]
fn test_court_dimensions_and_legal_zones() {
    let court = CourtDimensions::regulation();

    assert_eq!(court.length, 12.192);
    assert_eq!(court.width, 6.096);
    assert_eq!(court.height, 6.096);
    assert_eq!(court.short_line_z, 6.096);

    // Test inside boundary
    assert!(court.is_inside(0.0, 1.5, 5.0, 0.025));
    assert!(!court.is_inside(4.0, 1.5, 5.0, 0.025)); // Outside width

    // Test legal service landing past short line
    assert!(court.is_legal_service_landing(0.0, 7.0));
    assert!(!court.is_legal_service_landing(0.0, 3.0)); // In front of short line -> illegal
}

#[test]
fn test_default_court_uses_narrow_training_mode() {
    let court = CourtDimensions::default();

    assert_eq!(court.width, 2.2);
    assert_eq!(court.service_box_width, 0.25);
    assert!(court.is_inside(0.0, 1.5, 5.0, 0.025));
    assert!(!court.is_inside(2.8, 1.5, 5.0, 0.025));
}

#[test]
fn test_front_wall_restitution_and_trajectory() {
    let court = CourtDimensions::regulation();
    let config = PhysicsConfig::default();
    let engine = PhysicsEngine::new(court, config);

    let mut ball = Ball {
        position: Vec3::new(0.0, 1.5, 0.5),
        velocity: Vec3::new(0.0, 0.0, -15.0), // Fast drive towards front wall
        radius: 0.025,
        mass: 0.065,
        spin: Vec3::ZERO,
    };

    let events = engine.step(&mut ball, 0.1);
    assert!(!events.is_empty());
    assert_eq!(events[0].surface, WallSurface::FrontWall);
    assert!(ball.velocity.z > 0.0); // Bounced back into court
    assert!(ball.position.z >= ball.radius);
}

#[test]
fn test_sidewall_carom_and_floor_reflection() {
    let court = CourtDimensions::regulation();
    let config = PhysicsConfig::default();
    let engine = PhysicsEngine::new(court, config);

    // Angle shot towards right wall
    let mut ball = Ball {
        position: Vec3::new(2.8, 1.5, 3.0),
        velocity: Vec3::new(10.0, 0.0, -5.0),
        radius: 0.025,
        mass: 0.065,
        spin: Vec3::ZERO,
    };

    let events = engine.step(&mut ball, 0.1);
    assert!(!events.is_empty());
    assert_eq!(events[0].surface, WallSurface::RightWall);
    assert!(ball.velocity.x < 0.0); // Rebounded towards left
}

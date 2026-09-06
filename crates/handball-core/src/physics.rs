use crate::court::{CourtDimensions, WallSurface};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub const ZERO: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };
    pub const UP: Self = Self {
        x: 0.0,
        y: 1.0,
        z: 0.0,
    };

    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    pub fn dot(self, other: Self) -> f32 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }

    pub fn cross(self, other: Self) -> Self {
        Self {
            x: self.y * other.z - self.z * other.y,
            y: self.z * other.x - self.x * other.z,
            z: self.x * other.y - self.y * other.x,
        }
    }

    pub fn length_squared(self) -> f32 {
        self.dot(self)
    }

    pub fn length(self) -> f32 {
        self.length_squared().sqrt()
    }

    pub fn normalize(self) -> Self {
        let len = self.length();
        if len > 1e-6 {
            Self {
                x: self.x / len,
                y: self.y / len,
                z: self.z / len,
            }
        } else {
            Self::ZERO
        }
    }

    pub fn reflect(self, normal: Self) -> Self {
        let n = normal.normalize();
        self - n * (2.0 * self.dot(n))
    }
}

impl std::ops::Add for Vec3 {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
            z: self.z + rhs.z,
        }
    }
}

impl std::ops::Sub for Vec3 {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        Self {
            x: self.x - rhs.x,
            y: self.y - rhs.y,
            z: self.z - rhs.z,
        }
    }
}

impl std::ops::Mul<f32> for Vec3 {
    type Output = Self;
    fn mul(self, rhs: f32) -> Self {
        Self {
            x: self.x * rhs,
            y: self.y * rhs,
            z: self.z * rhs,
        }
    }
}

impl std::ops::Div<f32> for Vec3 {
    type Output = Self;
    fn div(self, rhs: f32) -> Self {
        Self {
            x: self.x / rhs,
            y: self.y / rhs,
            z: self.z / rhs,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ball {
    pub position: Vec3,
    pub velocity: Vec3,
    pub radius: f32, // Regulation handball radius: ~0.024 m (1.875 in diameter = ~0.0476 m)
    pub mass: f32,   // Regulation handball mass: ~0.065 kg (65 grams)
    pub spin: Vec3,
}

impl Default for Ball {
    fn default() -> Self {
        Self {
            position: Vec3::new(0.0, 1.2, 5.0),
            velocity: Vec3::ZERO,
            radius: 0.025, // 2.5 cm radius
            mass: 0.065,   // 65 grams
            spin: Vec3::ZERO,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysicsConfig {
    pub gravity: f32,                // -9.81 m/s^2
    pub air_drag: f32,               // Drag coefficient
    pub front_wall_restitution: f32, // 0.93
    pub side_wall_restitution: f32,  // 0.88
    pub floor_restitution: f32,      // 0.92
    pub ceiling_restitution: f32,    // 0.82
    pub back_wall_restitution: f32,  // 0.86
}

impl Default for PhysicsConfig {
    fn default() -> Self {
        Self {
            gravity: -9.81,
            air_drag: 0.0012,
            front_wall_restitution: 0.93,
            side_wall_restitution: 0.88,
            floor_restitution: 0.92,
            ceiling_restitution: 0.82,
            back_wall_restitution: 0.86,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollisionEvent {
    pub surface: WallSurface,
    pub point: Vec3,
    pub impact_speed: f32,
    pub normal: Vec3,
}

pub struct PhysicsEngine {
    pub court: CourtDimensions,
    pub config: PhysicsConfig,
}

impl PhysicsEngine {
    pub fn new(court: CourtDimensions, config: PhysicsConfig) -> Self {
        Self { court, config }
    }

    /// Step simulation forward by dt (in seconds).
    /// Returns any wall or floor collisions that occurred during this step.
    pub fn step(&self, ball: &mut Ball, dt: f32) -> Vec<CollisionEvent> {
        let mut events = Vec::new();
        // Sub-step simulation to prevent high-velocity tunneling through walls
        let max_substep_dt = 0.004; // 250 Hz substep limit
        let substeps = (dt / max_substep_dt).ceil().max(1.0) as usize;
        let sub_dt = dt / substeps as f32;

        for _ in 0..substeps {
            self.substep(ball, sub_dt, &mut events);
        }

        events
    }

    fn substep(&self, ball: &mut Ball, dt: f32, events: &mut Vec<CollisionEvent>) {
        // Apply gravity and air drag
        ball.velocity.y += self.config.gravity * dt;
        let speed = ball.velocity.length();
        if speed > 0.001 {
            let drag_force = self.config.air_drag * speed * speed;
            let drag_accel = drag_force / ball.mass;
            let drag_factor = (1.0 - (drag_accel * dt / speed)).max(0.0);
            ball.velocity = ball.velocity * drag_factor;
        }

        // Integrate position
        ball.position = ball.position + ball.velocity * dt;

        // Check court boundary collisions
        // 1. Front Wall (z = 0, normal = [0, 0, 1])
        if ball.position.z - ball.radius <= self.court.min_z() {
            let impact_speed = ball.velocity.z.abs();
            ball.position.z = self.court.min_z() + ball.radius;
            ball.velocity.z = -ball.velocity.z * self.config.front_wall_restitution;
            ball.velocity.x *= 0.98; // Surface friction
            ball.velocity.y *= 0.98;
            events.push(CollisionEvent {
                surface: WallSurface::FrontWall,
                point: ball.position,
                impact_speed,
                normal: Vec3::new(0.0, 0.0, 1.0),
            });
        }

        // 2. Back Wall (z = court.length, normal = [0, 0, -1])
        if ball.position.z + ball.radius >= self.court.max_z() {
            let impact_speed = ball.velocity.z.abs();
            ball.position.z = self.court.max_z() - ball.radius;
            ball.velocity.z = -ball.velocity.z * self.config.back_wall_restitution;
            events.push(CollisionEvent {
                surface: WallSurface::BackWall,
                point: ball.position,
                impact_speed,
                normal: Vec3::new(0.0, 0.0, -1.0),
            });
        }

        // 3. Left Wall (x = min_x, normal = [1, 0, 0])
        if ball.position.x - ball.radius <= self.court.min_x() {
            let impact_speed = ball.velocity.x.abs();
            ball.position.x = self.court.min_x() + ball.radius;
            ball.velocity.x = -ball.velocity.x * self.config.side_wall_restitution;
            events.push(CollisionEvent {
                surface: WallSurface::LeftWall,
                point: ball.position,
                impact_speed,
                normal: Vec3::new(1.0, 0.0, 0.0),
            });
        }

        // 4. Right Wall (x = max_x, normal = [-1, 0, 0])
        if ball.position.x + ball.radius >= self.court.max_x() {
            let impact_speed = ball.velocity.x.abs();
            ball.position.x = self.court.max_x() - ball.radius;
            ball.velocity.x = -ball.velocity.x * self.config.side_wall_restitution;
            events.push(CollisionEvent {
                surface: WallSurface::RightWall,
                point: ball.position,
                impact_speed,
                normal: Vec3::new(-1.0, 0.0, 0.0),
            });
        }

        // 5. Floor (y = 0, normal = [0, 1, 0])
        if ball.position.y - ball.radius <= self.court.min_y() {
            let impact_speed = ball.velocity.y.abs();
            ball.position.y = self.court.min_y() + ball.radius;
            if impact_speed < 0.22 {
                ball.velocity.y = 0.0;
                let rolling_factor = (-0.4 * dt).exp();
                ball.velocity.x *= rolling_factor;
                ball.velocity.z *= rolling_factor;
                ball.spin = ball.spin * (-0.25 * dt).exp();
                if (ball.velocity.x * ball.velocity.x + ball.velocity.z * ball.velocity.z).sqrt()
                    < 0.015
                {
                    ball.velocity.x = 0.0;
                    ball.velocity.z = 0.0;
                }
            } else {
                ball.velocity.y = impact_speed * self.config.floor_restitution;
                ball.velocity.x *= 0.985;
                ball.velocity.z *= 0.985;
                ball.spin = ball.spin * 0.95;

                events.push(CollisionEvent {
                    surface: WallSurface::Floor,
                    point: ball.position,
                    impact_speed,
                    normal: Vec3::new(0.0, 1.0, 0.0),
                });
            }
        }

        // 6. Ceiling (y = court.height, normal = [0, -1, 0])
        if ball.position.y + ball.radius >= self.court.max_y() {
            let impact_speed = ball.velocity.y.abs();
            ball.position.y = self.court.max_y() - ball.radius;
            ball.velocity.y = -ball.velocity.y * self.config.ceiling_restitution;
            events.push(CollisionEvent {
                surface: WallSurface::Ceiling,
                point: ball.position,
                impact_speed,
                normal: Vec3::new(0.0, -1.0, 0.0),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vec3_math() {
        let a = Vec3::new(1.0, 2.0, 3.0);
        let b = Vec3::new(4.0, 5.0, 6.0);
        let dot = a.dot(b);
        assert_eq!(dot, 32.0);

        let reflected = Vec3::new(0.0, -5.0, 0.0).reflect(Vec3::new(0.0, 1.0, 0.0));
        assert_eq!(reflected.y, 5.0);
    }

    #[test]
    fn test_physics_bounce() {
        let court = CourtDimensions::default();
        let config = PhysicsConfig::default();
        let engine = PhysicsEngine::new(court, config);

        let mut ball = Ball {
            position: Vec3::new(0.0, 1.0, 1.0),
            velocity: Vec3::new(0.0, 0.0, -10.0), // Fired directly at front wall (z=0)
            radius: 0.025,
            mass: 0.065,
            spin: Vec3::ZERO,
        };

        // Step simulation 0.2s -> ball should hit front wall and rebound with +z velocity
        let events = engine.step(&mut ball, 0.2);
        assert!(!events.is_empty());
        assert_eq!(events[0].surface, WallSurface::FrontWall);
        assert!(ball.velocity.z > 0.0);
    }
}

use crate::physics::{Ball, Vec3};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HandSide {
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HitQuality {
    KillShot,   // Maximum power & low trajectory
    Solid,      // Clean centered hit
    Glancing,   // Angled deflection
    Soft,       // Low speed touch
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandState {
    pub side: HandSide,
    pub position: Vec3,
    pub velocity: Vec3,
    pub palm_normal: Vec3,
    pub radius: f32, // Collision radius (~0.08 m for palm)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrikeResult {
    pub hit: bool,
    pub quality: HitQuality,
    pub strike_speed_mps: f32,
    pub strike_speed_mph: f32,
    pub new_ball_velocity: Vec3,
    pub contact_point: Vec3,
}

pub struct StrikePhysics {
    pub min_strike_speed: f32,      // Min hand speed in m/s to register strike (e.g., 1.0 m/s)
    pub power_multiplier: f32,      // Impulse coefficient (e.g., 1.45)
    pub max_ball_speed: f32,        // Cap maximum ball speed (e.g., 40 m/s ~ 90 mph)
}

impl Default for StrikePhysics {
    fn default() -> Self {
        Self {
            min_strike_speed: 0.8,
            power_multiplier: 1.5,
            max_ball_speed: 40.0,
        }
    }
}

impl StrikePhysics {
    pub fn new(min_strike_speed: f32, power_multiplier: f32, max_ball_speed: f32) -> Self {
        Self {
            min_strike_speed,
            power_multiplier,
            max_ball_speed,
        }
    }

    /// Evaluates collision and calculates impulse transfer between hand and ball
    pub fn calculate_strike(&self, hand: &HandState, ball: &Ball) -> Option<StrikeResult> {
        let delta = ball.position - hand.position;
        let distance = delta.length();
        let contact_dist = hand.radius + ball.radius;

        // Check if hand intersects ball sphere
        if distance > contact_dist {
            return None;
        }

        let hand_speed = hand.velocity.length();
        let normal = if distance > 1e-4 {
            delta.normalize()
        } else {
            hand.palm_normal.normalize()
        };

        // Relative velocity
        let rel_velocity = hand.velocity - ball.velocity;
        let impact_speed = rel_velocity.dot(normal);

        // Discard if moving away from ball or below minimum strike speed
        if impact_speed < 0.0 && hand_speed < self.min_strike_speed {
            return None;
        }

        // Forward strike trajectory calculation:
        // Combine palm normal direction with hand velocity vector
        let mut strike_dir = (hand.velocity.normalize() * 0.6 + normal * 0.4).normalize();
        
        // Ensure strike points generally towards the front wall (-z direction in court coords)
        if strike_dir.z > 0.1 && hand.velocity.z < 0.0 {
            strike_dir.z = -strike_dir.z;
        }

        // Calculate transferred velocity
        let base_speed = (hand_speed * self.power_multiplier + ball.velocity.length() * 0.4).min(self.max_ball_speed);
        let final_speed = base_speed.max(3.0); // Minimum pop
        let new_velocity = strike_dir * final_speed;

        let speed_mph = final_speed * 2.23694;
        let quality = if speed_mph > 55.0 && new_velocity.y.abs() < 2.0 {
            HitQuality::KillShot
        } else if speed_mph > 35.0 {
            HitQuality::Solid
        } else if speed_mph > 15.0 {
            HitQuality::Glancing
        } else {
            HitQuality::Soft
        };

        let contact_point = hand.position + normal * hand.radius;

        Some(StrikeResult {
            hit: true,
            quality,
            strike_speed_mps: final_speed,
            strike_speed_mph: speed_mph,
            new_ball_velocity: new_velocity,
            contact_point,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strike_physics() {
        let striker = StrikePhysics::default();
        let hand = HandState {
            side: HandSide::Right,
            position: Vec3::new(0.0, 1.2, 5.0),
            velocity: Vec3::new(0.0, 0.5, -8.0), // Fast swing towards front wall (-z)
            palm_normal: Vec3::new(0.0, 0.0, -1.0),
            radius: 0.08,
        };

        let ball = Ball {
            position: Vec3::new(0.0, 1.2, 4.95), // Near hand
            velocity: Vec3::new(0.0, 0.0, 2.0),
            radius: 0.025,
            mass: 0.065,
            spin: Vec3::ZERO,
        };

        let result = striker.calculate_strike(&hand, &ball);
        assert!(result.is_some());
        let res = result.unwrap();
        assert!(res.hit);
        assert!(res.new_ball_velocity.z < 0.0); // Ball propelled towards front wall
        assert!(res.strike_speed_mph > 20.0);
    }
}

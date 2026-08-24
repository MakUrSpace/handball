use serde::{Deserialize, Serialize};

/// Regulation 4-Wall Handball Court Dimensions (Standard USHA Specifications in Meters)
/// Length: 40 feet = 12.192 m
/// Width: 20 feet = 6.096 m
/// Height: 20 feet = 6.096 m
/// Short Line: 20 feet from front wall = 6.096 m
/// Service Line: 5 feet in front of short line (15 feet from front wall) = 4.572 m
/// Service Box: 18 inches (0.457 m) from sidewalls
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CourtDimensions {
    pub length: f32,
    pub width: f32,
    pub height: f32,
    pub short_line_z: f32,
    pub service_line_z: f32,
    pub service_box_width: f32,
}

impl Default for CourtDimensions {
    fn default() -> Self {
        Self::narrow()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WallSurface {
    FrontWall,
    LeftWall,
    RightWall,
    BackWall,
    Floor,
    Ceiling,
}

impl CourtDimensions {
    pub fn regulation() -> Self {
        Self {
            length: 12.192,
            width: 6.096,
            height: 6.096,
            short_line_z: 6.096,
            service_line_z: 4.572,
            service_box_width: 0.457,
        }
    }

    pub fn narrow() -> Self {
        Self {
            length: 12.192,
            width: 2.20,
            height: 6.096,
            short_line_z: 6.096,
            service_line_z: 4.572,
            service_box_width: 0.25,
        }
    }
    pub fn min_x(&self) -> f32 {
        -self.width / 2.0
    }

    pub fn max_x(&self) -> f32 {
        self.width / 2.0
    }

    pub fn min_y(&self) -> f32 {
        0.0
    }

    pub fn max_y(&self) -> f32 {
        self.height
    }

    pub fn min_z(&self) -> f32 {
        0.0 // Front wall
    }

    pub fn max_z(&self) -> f32 {
        self.length // Back wall
    }

    /// Checks if a position is strictly inside the court boundaries
    pub fn is_inside(&self, x: f32, y: f32, z: f32, radius: f32) -> bool {
        x >= self.min_x() + radius
            && x <= self.max_x() - radius
            && y >= self.min_y() + radius
            && y <= self.max_y() - radius
            && z >= self.min_z() + radius
            && z <= self.max_z() - radius
    }

    /// Validates if a service bounce landed legally past the short line
    pub fn is_legal_service_landing(&self, x: f32, z: f32) -> bool {
        x >= self.min_x() && x <= self.max_x() && z >= self.short_line_z && z <= self.max_z()
    }
}

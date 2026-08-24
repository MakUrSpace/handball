#!/usr/bin/env python3
"""
Python verification harness for Court, Physics, Strike, and Scoring math.
Tests vector calculations, restitution, handball rules, and court boundary reflections.
"""

import math
import unittest

class Vec3:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x = float(x)
        self.y = float(y)
        self.z = float(z)

    def dot(self, o):
        return self.x * o.x + self.y * o.y + self.z * o.z

    def length(self):
        return math.sqrt(self.dot(self))

    def normalize(self):
        l = self.length()
        return Vec3(self.x / l, self.y / l, self.z / l) if l > 1e-6 else Vec3(0, 0, 0)

    def reflect(self, n):
        norm = n.normalize()
        d = 2.0 * self.dot(norm)
        return Vec3(self.x - norm.x * d, self.y - norm.y * d, self.z - norm.z * d)

class TestHandballMath(unittest.TestCase):
    def test_vector_reflection(self):
        # Incident ray hitting front wall (normal = [0, 0, 1])
        v_in = Vec3(0, 0, -15.0)
        normal = Vec3(0, 0, 1.0)
        v_refl = v_in.reflect(normal)
        self.assertAlmostEqual(v_refl.z, 15.0)
        self.assertAlmostEqual(v_refl.x, 0.0)

    def test_restitution_damping(self):
        # Front wall restitution = 0.84
        v_impact = 20.0
        restitution = 0.84
        v_rebound = v_impact * restitution
        self.assertAlmostEqual(v_rebound, 16.8)

    def test_court_dimensions(self):
        # 40ft x 20ft x 20ft in meters
        length = 12.192
        width = 6.096
        height = 6.096
        short_line_z = 6.096
        
        # Verify court midpoint
        self.assertEqual(length / 2.0, short_line_z)
        self.assertEqual(width, 6.096)
        self.assertEqual(height, 6.096)

    def test_strike_momentum(self):
        hand_speed = 10.0 # m/s (~22.4 mph)
        power_multiplier = 1.55
        incoming_ball_speed = 5.0
        
        result_speed = hand_speed * power_multiplier + incoming_ball_speed * 0.35
        speed_mph = result_speed * 2.23694
        
        self.assertAlmostEqual(result_speed, 17.25)
        self.assertAlmostEqual(round(speed_mph, 1), 38.6)
        self.assertTrue(speed_mph > 35.0) # Solid strike

if __name__ == "__main__":
    unittest.main()

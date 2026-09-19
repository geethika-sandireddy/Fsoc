"""
3D Optical Beacon Target Generator — ISRO PS-26169.
Supports 7 configurable 3D trajectories:
- 4 Mandatory: Straight Line, Circular, Figure of 8, Random Walk
- 3 Optional: Spiral/Helix, Sinusoidal, User-defined Waypoints
Configurable beacon shapes (Square, Circle, Rectangle), sizes (5-20 px),
and Gaussian diffraction bloom intensity rendering.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Tuple, Optional
import numpy as np

from backend.environment_3d import VirtualEnvironment3D


class TargetShape(str, Enum):
    SQUARE = "square"
    CIRCLE = "circle"
    RECTANGLE = "rectangle"


class TargetMotionMode3D(str, Enum):
    STRAIGHT_LINE = "straight_line"
    CIRCULAR = "circular"
    FIGURE_OF_EIGHT = "figure_of_8"
    RANDOM = "random"
    SPIRAL = "spiral"
    SINUSOIDAL = "sinusoidal"
    USER_DEFINED = "user_defined"


@dataclass
class TargetState3D:
    x: float
    y: float
    z: float
    vx: float = 0.0
    vy: float = 0.0
    vz: float = 0.0
    size: int = 10
    shape: TargetShape = TargetShape.SQUARE
    wavelength_nm: float = 850.0  # Near-Infrared FSOC Beacon
    peak_irradiance: float = 255.0


class TargetGenerator3D:
    """
    Simulates optical beacon movement in 3D Cartesian world space.
    Strictly enforces PS-26169 invariants:
    - Target size clamped to [5, 20] px (default 10)
    - Default shape: Square (user-selectable circle/rectangle)
    - Boundary containment within 3D simulation volume
    """

    def __init__(
        self,
        environment: VirtualEnvironment3D,
        motion_mode: TargetMotionMode3D = TargetMotionMode3D.CIRCULAR,
        size: int = 10,
        shape: TargetShape = TargetShape.SQUARE,
        speed: float = 40.0,  # units per second
        seed: int | None = 42,
    ) -> None:
        self.env = environment
        self.motion_mode = motion_mode
        self.shape = shape
        self.speed = float(speed)
        self.seed = seed
        self.rng = np.random.RandomState(seed)

        # Enforce PS-26169 size bounds [5, 20] px
        self.size = max(5, min(20, int(size)))

        # 3D Position and Velocity
        self.x = 0.0
        self.y = 800.0   # Nominal range along optical axis
        self.z = 0.0
        self.vx = 0.0
        self.vy = 0.0
        self.vz = 0.0

        # Motion Parameters
        self.base_x = 0.0
        self.base_y = 800.0
        self.base_z = 0.0
        self.radius_x = 400.0
        self.radius_y = 150.0
        self.radius_z = 300.0
        self.omega = 0.25  # rad/s

        # User-defined 3D waypoints
        self.waypoints: List[Tuple[float, float, float]] = []
        self._current_wp_idx = 0

        self.reset()

    def reset(self, initial_pos: Optional[Tuple[float, float, float]] = None) -> None:
        """Resets target position and dynamics."""
        if initial_pos is not None:
            self.x, self.y, self.z = self.env.clamp_bounds(*initial_pos)
        else:
            # Random initial position within bounded central 60% of volume
            rx = float(self.rng.uniform(self.env.x_min * 0.5, self.env.x_max * 0.5))
            # Remote terminal placed at realistic FSOC distance [600, 1000] ahead
            ry = float(self.rng.uniform(600.0, 950.0))
            rz = float(self.rng.uniform(self.env.z_min * 0.4, self.env.z_max * 0.4))
            self.x, self.y, self.z = rx, ry, rz

        self.base_x = self.x
        self.base_y = self.y
        self.base_z = self.z

        # Random velocity direction for straight line / random walk
        angle_xy = float(self.rng.uniform(0, 2 * math.pi))
        angle_z = float(self.rng.uniform(-math.pi / 6, math.pi / 6))
        self.vx = self.speed * math.cos(angle_z) * math.cos(angle_xy)
        self.vy = self.speed * math.cos(angle_z) * math.sin(angle_xy) * 0.2  # subtle range drift
        self.vz = self.speed * math.sin(angle_z)

    def set_motion_mode(self, mode: TargetMotionMode3D) -> None:
        self.motion_mode = mode

    def update(self, dt: float, sim_time: float) -> TargetState3D:
        """Propagates 3D beacon position for time step dt at time sim_time."""
        margin = 50.0

        if self.motion_mode == TargetMotionMode3D.STRAIGHT_LINE:
            # 3D Constant Velocity with smooth elastic boundary reflection
            self.x += self.vx * dt
            self.y += self.vy * dt
            self.z += self.vz * dt

            if self.x <= self.env.x_min + margin or self.x >= self.env.x_max - margin:
                self.vx = -self.vx
                self.x = max(self.env.x_min + margin, min(self.env.x_max - margin, self.x))
            if self.y <= 400.0 or self.y >= self.env.y_max - margin:
                self.vy = -self.vy
                self.y = max(400.0, min(self.env.y_max - margin, self.y))
            if self.z <= self.env.z_min + margin or self.z >= self.env.z_max - margin:
                self.vz = -self.vz
                self.z = max(self.env.z_min + margin, min(self.env.z_max - margin, self.z))

        elif self.motion_mode == TargetMotionMode3D.CIRCULAR:
            # 3D Orbital Trajectory (inclined circular orbit)
            theta = self.omega * sim_time
            self.x = self.base_x + self.radius_x * math.cos(theta)
            self.y = self.base_y + self.radius_y * math.sin(theta) * 0.3
            self.z = self.base_z + self.radius_z * math.sin(theta)

        elif self.motion_mode == TargetMotionMode3D.FIGURE_OF_EIGHT:
            # 3D Lemniscate / Lissajous Orbit
            theta = self.omega * sim_time
            self.x = self.base_x + self.radius_x * math.sin(theta)
            self.y = self.base_y + self.radius_y * math.sin(theta * 2.0) * 0.2
            self.z = self.base_z + self.radius_z * math.sin(2.0 * theta) * 0.5

        elif self.motion_mode == TargetMotionMode3D.RANDOM:
            # 3D Smooth Velocity Random Walk
            accel_x = float(self.rng.normal(0, 30.0))
            accel_y = float(self.rng.normal(0, 10.0))
            accel_z = float(self.rng.normal(0, 30.0))

            self.vx = max(-self.speed, min(self.speed, self.vx + accel_x * dt))
            self.vy = max(-self.speed * 0.3, min(self.speed * 0.3, self.vy + accel_y * dt))
            self.vz = max(-self.speed, min(self.speed, self.vz + accel_z * dt))

            self.x += self.vx * dt
            self.y += self.vy * dt
            self.z += self.vz * dt

            # Bounded containment with centering spring force near edges
            if self.x < self.env.x_min + margin:
                self.vx = abs(self.vx)
            elif self.x > self.env.x_max - margin:
                self.vx = -abs(self.vx)

            if self.y < 450.0:
                self.vy = abs(self.vy)
            elif self.y > self.env.y_max - margin:
                self.vy = -abs(self.vy)

            if self.z < self.env.z_min + margin:
                self.vz = abs(self.vz)
            elif self.z > self.env.z_max - margin:
                self.vz = -abs(self.vz)

        elif self.motion_mode == TargetMotionMode3D.SPIRAL:
            # 3D Helical trajectory with oscillating radius
            theta = self.omega * sim_time
            r_scale = 0.5 + 0.5 * math.sin(self.omega * 0.25 * sim_time)
            cur_rx = self.radius_x * r_scale
            cur_rz = self.radius_z * r_scale
            self.x = self.base_x + cur_rx * math.cos(theta)
            self.y = self.base_y + (self.radius_y * 0.4) * math.sin(theta * 0.5)
            self.z = self.base_z + cur_rz * math.sin(theta)

        elif self.motion_mode == TargetMotionMode3D.SINUSOIDAL:
            # 3D Spatial Undulation (sweeping along X with Z sinusoidal wave)
            theta = self.omega * sim_time
            self.x = self.base_x + self.radius_x * math.sin(theta * 0.8)
            self.y = self.base_y + (self.radius_y * 0.3) * math.cos(theta * 0.4)
            self.z = self.base_z + (self.radius_z * 0.7) * math.sin(theta * 2.5)

        elif self.motion_mode == TargetMotionMode3D.USER_DEFINED:
            if not self.waypoints:
                self.waypoints = [
                    (-400.0, 700.0, -200.0),
                    (400.0, 800.0, 250.0),
                    (200.0, 900.0, -300.0),
                    (-300.0, 750.0, 100.0),
                ]
            target_wp = self.waypoints[self._current_wp_idx]
            dx = target_wp[0] - self.x
            dy = target_wp[1] - self.y
            dz = target_wp[2] - self.z
            dist = math.sqrt(dx * dx + dy * dy + dz * dz)
            if dist < 15.0:
                self._current_wp_idx = (self._current_wp_idx + 1) % len(self.waypoints)
            else:
                self.x += (dx / dist) * self.speed * dt
                self.y += (dy / dist) * self.speed * dt
                self.z += (dz / dist) * self.speed * dt

        # Final safety clamp
        self.x, self.y, self.z = self.env.clamp_bounds(self.x, self.y, self.z, margin=margin)

        return TargetState3D(
            x=self.x,
            y=self.y,
            z=self.z,
            vx=self.vx,
            vy=self.vy,
            vz=self.vz,
            size=self.size,
            shape=self.shape,
        )

    def render_spot_patch(self) -> np.ndarray:
        """
        Renders a 2D optical beacon intensity spot with diffraction bloom
        based on target size and shape. Returns a uint8 square patch.
        """
        patch_dim = self.size * 3
        if patch_dim % 2 == 0:
            patch_dim += 1
        half = patch_dim // 2

        y, x = np.ogrid[-half : half + 1, -half : half + 1]
        sigma = max(1.2, self.size / 3.0)

        if self.shape == TargetShape.SQUARE:
            # Square profile with blurred diffraction edges
            d_sq = np.maximum(np.abs(x), np.abs(y))
            intensity = 255.0 * np.exp(-0.5 * (d_sq / sigma) ** 2)
            mask = d_sq <= (self.size / 2.0)
            intensity[mask] = 255.0
        elif self.shape == TargetShape.CIRCLE:
            # Circular Airy disk approximation
            r_sq = x * x + y * y
            intensity = 255.0 * np.exp(-0.5 * (r_sq / (sigma * sigma)))
        elif self.shape == TargetShape.RECTANGLE:
            # 1.6:1 rectangular beacon profile
            d_rect = np.maximum(np.abs(x) / 1.6, np.abs(y))
            intensity = 255.0 * np.exp(-0.5 * (d_rect / sigma) ** 2)

        patch = np.clip(intensity, 0, 255).astype(np.uint8)
        return patch

"""
Target Generator & Trajectory Engine — ISRO PS-26169 Backend.
Implements the 4 mandatory + 3 optional motion models, spot intensity rendering
(5-20 px, Square default, Circle, Rectangle), and ground-truth telemetry generation.
"""

from __future__ import annotations

import dataclasses
import math
from typing import Dict, List, Literal, Tuple
import numpy as np

from backend.environment import VirtualEnvironment

MotionType = Literal["straight", "circular", "figure8", "random", "spiral", "sinusoidal", "user_defined"]
ShapeType = Literal["Square", "Circle", "Rectangle"]


@dataclasses.dataclass
class TargetState:
    x: float
    y: float
    vx: float
    vy: float
    shape: ShapeType
    size: int  # 5 to 20 px


class TargetGenerator:
    """Simulates moving optical beacon target inside the virtual environment."""

    def __init__(
        self,
        env: VirtualEnvironment,
        target_id: str = "T1",
        shape: ShapeType = "Square",
        size: int = 10,
        initial_location: str = "random",
        custom_pos: Tuple[float, float] | None = None,
        motion_type: MotionType = "figure8",
        speed: float = 120.0,
        radius: float = 450.0,
        frequency: float = 0.12,
        seed: int = 26169,
    ) -> None:
        self.env = env
        self.target_id = target_id
        self.shape: ShapeType = shape
        self.size = max(5, min(20, size))  # Bound strictly to [5, 20] px
        self.initial_location = initial_location
        self.custom_pos = custom_pos or (1000.0, 1000.0)
        self.motion_type: MotionType = motion_type
        self.speed = speed
        self.radius = radius
        self.frequency = frequency
        self.seed = seed

        self.rng = np.random.default_rng(self.seed)

        # Runtime dynamic state
        self.x = 1000.0
        self.y = 1000.0
        self.vx = 80.0
        self.vy = 60.0
        self.random_vx = 60.0
        self.random_vy = 40.0
        self.history: List[Tuple[float, float]] = []

        self.reset()

    def reset(self) -> None:
        """Resets target position and dynamics to initial state."""
        self.rng = np.random.default_rng(self.seed)

        if self.initial_location == "center":
            self.x = self.env.width / 2.0
            self.y = self.env.height / 2.0
        elif self.initial_location == "custom":
            self.x, self.y = self.env.clamp_bounds(self.custom_pos[0], self.custom_pos[1], margin=50.0)
        else:  # "random"
            self.x = float(self.rng.uniform(200, self.env.width - 200))
            self.y = float(self.rng.uniform(200, self.env.height - 200))

        self.vx = 80.0
        self.vy = 60.0
        self.random_vx = float(self.rng.uniform(-80, 80))
        self.random_vy = float(self.rng.uniform(-80, 80))
        self.history = [(self.x, self.y)]

    def update(self, dt: float, elapsed_time: float) -> TargetState:
        """Advances target position along the selected trajectory model."""
        center_x = self.env.width / 2.0
        center_y = self.env.height / 2.0 + 150.0  # Centered in upper workspace
        omega = 2.0 * math.pi * self.frequency

        new_x = self.x
        new_y = self.y

        # 1. Mandatory: Straight Line
        if self.motion_type == "straight":
            new_x += self.vx * dt
            new_y += self.vy * dt
            margin = 100.0
            if new_x <= margin:
                new_x = margin
                self.vx = abs(self.vx)
            elif new_x >= self.env.width - margin:
                new_x = self.env.width - margin
                self.vx = -abs(self.vx)
            if new_y <= margin:
                new_y = margin
                self.vy = abs(self.vy)
            elif new_y >= self.env.height - margin:
                new_y = self.env.height - margin
                self.vy = -abs(self.vy)

        # 2. Mandatory: Circular
        elif self.motion_type == "circular":
            r = min(self.radius, self.env.width / 2.0 - 120.0)
            new_x = center_x + r * math.cos(omega * elapsed_time)
            new_y = center_y + r * math.sin(omega * elapsed_time)

        # 3. Mandatory: Figure of 8 (Lemniscate)
        elif self.motion_type == "figure8":
            r = min(self.radius, self.env.width / 2.0 - 150.0)
            new_x = center_x + r * math.sin(omega * elapsed_time)
            new_y = center_y + (r * 0.5) * math.sin(2.0 * omega * elapsed_time)

        # 4. Mandatory: Random Walk with Inertia
        elif self.motion_type == "random":
            self.random_vx += float(self.rng.uniform(-30, 30)) * dt
            self.random_vy += float(self.rng.uniform(-30, 30)) * dt
            max_v = self.speed
            self.random_vx = max(-max_v, min(max_v, self.random_vx))
            self.random_vy = max(-max_v, min(max_v, self.random_vy))

            new_x += self.random_vx * dt
            new_y += self.random_vy * dt

            margin = 100.0
            if new_x <= margin:
                new_x = margin
                self.random_vx = abs(self.random_vx)
            elif new_x >= self.env.width - margin:
                new_x = self.env.width - margin
                self.random_vx = -abs(self.random_vx)
            if new_y <= margin:
                new_y = margin
                self.random_vy = abs(self.random_vy)
            elif new_y >= self.env.height - margin:
                new_y = self.env.height - margin
                self.random_vy = -abs(self.random_vy)

        # 5. Optional: Spiral
        elif self.motion_type == "spiral":
            max_r = min(self.radius, self.env.width / 2.0 - 120.0)
            min_r = 80.0
            mod_omega = omega * 0.25
            current_r = min_r + (max_r - min_r) * (0.5 + 0.5 * math.sin(mod_omega * elapsed_time))
            new_x = center_x + current_r * math.cos(omega * elapsed_time)
            new_y = center_y + current_r * math.sin(omega * elapsed_time)

        # 6. Optional: Sinusoidal
        elif self.motion_type == "sinusoidal":
            span = self.env.width - 300.0
            period = span / max(20.0, self.speed)
            progress = (elapsed_time % (2.0 * period)) / period
            x_offset = progress * span if progress <= 1.0 else (2.0 - progress) * span
            new_x = 150.0 + x_offset
            new_y = center_y + (self.radius * 0.4) * math.sin(omega * elapsed_time * 2.0)

        # 7. Optional: User-defined
        elif self.motion_type == "user_defined":
            t = elapsed_time
            # Default safe formula
            new_x = center_x + 400.0 * math.sin(t * 0.4)
            new_y = center_y + 300.0 * math.sin(t * 0.8)

        # Enforce boundary clamping
        self.x, self.y = self.env.clamp_bounds(new_x, new_y, margin=30.0)
        self.history.append((self.x, self.y))
        if len(self.history) > 500:
            self.history.pop(0)

        return TargetState(
            x=self.x,
            y=self.y,
            vx=self.vx if self.motion_type == "straight" else (self.random_vx if self.motion_type == "random" else 0.0),
            vy=self.vy if self.motion_type == "straight" else (self.random_vy if self.motion_type == "random" else 0.0),
            shape=self.shape,
            size=self.size,
        )

    def render_spot_matrix(self) -> np.ndarray:
        """
        Renders a 2D optical intensity matrix of the beacon spot.
        Returns a float32 array with shape (size * 3, size * 3) centered at the peak.
        """
        sz = self.size
        dim = sz * 3
        center = dim / 2.0 - 0.5
        grid_y, grid_x = np.ogrid[:dim, :dim]

        dist_sq = (grid_x - center) ** 2 + (grid_y - center) ** 2

        # 1. Optical Bloom (Gaussian optical diffraction falloff)
        sigma = sz * 0.6
        intensity = 255.0 * np.exp(-dist_sq / (2.0 * sigma**2))

        # 2. Shape Footprint Core
        if self.shape == "Circle":
            core_mask = dist_sq <= (sz / 2.0) ** 2
            intensity[core_mask] = 255.0
        elif self.shape == "Rectangle":
            core_mask = (abs(grid_x - center) <= sz / 2.0) & (abs(grid_y - center) <= sz / 3.0)
            intensity[core_mask] = 255.0
        else:  # Square (Default)
            core_mask = (abs(grid_x - center) <= sz / 2.0) & (abs(grid_y - center) <= sz / 2.0)
            intensity[core_mask] = 255.0

        return np.clip(intensity, 0.0, 255.0).astype(np.float32)

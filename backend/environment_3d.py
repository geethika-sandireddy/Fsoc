"""
3D Virtual Simulation Volume & Celestial Environment — ISRO PS-26169.
Defines the 3D world space coordinate system, boundary validation,
and celestial background starfield.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Tuple
import numpy as np


@dataclass
class Star3D:
    x: float
    y: float
    z: float
    magnitude: float  # 0.1 to 1.0 intensity
    size: float       # 1 to 2 pixels


class VirtualEnvironment3D:
    """
    3D Virtual Simulation Space for FSOC Coarse Alignment.
    Default volume: 2000 x 2000 x 2000 units centered at origin [-1000, 1000]^3.
    Satisfies ISRO PS-26169 minimum screen/transverse dimension of 2000 x 2000 units.
    """

    def __init__(
        self,
        size_x: float = 2000.0,
        size_y: float = 2000.0,
        size_z: float = 2000.0,
        star_density: int = 200,
        seed: int | None = 42,
    ) -> None:
        if size_x < 2000.0 or size_y < 2000.0:
            raise ValueError(
                f"PS-26169 requires minimum 2000x2000 transverse span. Got {size_x}x{size_y}"
            )

        self.size_x = float(size_x)
        self.size_y = float(size_y)
        self.size_z = float(size_z)

        # Coordinate bounds centered at origin
        self.x_min = -self.size_x / 2.0
        self.x_max = self.size_x / 2.0
        self.y_min = -self.size_y / 2.0
        self.y_max = self.size_y / 2.0
        self.z_min = -self.size_z / 2.0
        self.z_max = self.size_z / 2.0

        self.star_density = star_density
        self.seed = seed
        self.stars: List[Star3D] = []
        self._generate_stars()

    def _generate_stars(self) -> None:
        rng = np.random.RandomState(self.seed)
        self.stars.clear()

        # Distribute celestial background stars across the distant bounding sphere/cube
        for _ in range(self.star_density):
            # Far-field background stars
            x = float(rng.uniform(self.x_min * 1.5, self.x_max * 1.5))
            y = float(rng.uniform(self.y_min * 1.5, self.y_max * 1.5))
            z = float(rng.uniform(self.z_min * 1.5, self.z_max * 1.5))
            magnitude = float(rng.uniform(0.15, 0.85))
            size = 1.0 if rng.uniform() > 0.3 else 2.0
            self.stars.append(Star3D(x=x, y=y, z=z, magnitude=magnitude, size=size))

    def is_within_bounds(self, x: float, y: float, z: float) -> bool:
        """Check if 3D position is within simulation boundary."""
        return (
            self.x_min <= x <= self.x_max
            and self.y_min <= y <= self.y_max
            and self.z_min <= z <= self.z_max
        )

    def clamp_bounds(
        self, x: float, y: float, z: float, margin: float = 30.0
    ) -> Tuple[float, float, float]:
        """Clamps 3D position within simulation boundary with safe margin."""
        cx = max(self.x_min + margin, min(self.x_max - margin, x))
        cy = max(self.y_min + margin, min(self.y_max - margin, y))
        cz = max(self.z_min + margin, min(self.z_max - margin, z))
        return cx, cy, cz

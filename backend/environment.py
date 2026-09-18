"""
Virtual Environment Engine — ISRO PS-26169 Backend.
Models the 2000x2000 px configurable virtual scene, background starfield,
coordinate axes, and strict boundary validation.
"""

from __future__ import annotations

import dataclasses
from typing import List, Tuple
import numpy as np


@dataclasses.dataclass
class BackgroundStar:
    x: float
    y: float
    radius: float
    brightness: float  # Grayscale intensity [0, 255]


class VirtualEnvironment:
    """Configurable 2D Virtual Environment for FSOC Coarse Alignment."""

    def __init__(
        self,
        width: int = 2000,
        height: int = 2000,
        grid_spacing: int = 250,
        star_density: int = 200,
        seed: int = 26169,
    ) -> None:
        # Enforce PS-26169 minimum size requirement
        if width < 2000 or height < 2000:
            raise ValueError(f"Virtual environment dimensions must be at least 2000x2000 px (got {width}x{height})")

        self.width = width
        self.height = height
        self.grid_spacing = grid_spacing
        self.star_density = star_density
        self.seed = seed
        self.stars: List[BackgroundStar] = []

        self.generate_starfield(self.seed)

    def generate_starfield(self, seed: int | None = None) -> List[BackgroundStar]:
        """Generates a deterministic starfield using a pseudo-random number generator."""
        if seed is not None:
            self.seed = seed

        rng = np.random.default_rng(self.seed)
        self.stars = []

        xs = rng.uniform(0, self.width, size=self.star_density)
        ys = rng.uniform(0, self.height, size=self.star_density)
        radii = rng.uniform(0.6, 2.0, size=self.star_density)
        brightnesses = rng.uniform(40, 220, size=self.star_density)

        for i in range(self.star_density):
            self.stars.append(
                BackgroundStar(
                    x=float(xs[i]),
                    y=float(ys[i]),
                    radius=float(radii[i]),
                    brightness=float(brightnesses[i]),
                )
            )

        return self.stars

    def is_within_bounds(self, x: float, y: float, margin: float = 0.0) -> bool:
        """Checks whether a coordinate lies within valid environment bounds."""
        return (margin <= x <= self.width - margin) and (margin <= y <= self.height - margin)

    def clamp_bounds(self, x: float, y: float, margin: float = 30.0) -> Tuple[float, float]:
        """Clamps a coordinate to strictly remain within environment boundaries with safety margin."""
        clamped_x = max(margin, min(self.width - margin, x))
        clamped_y = max(margin, min(self.height - margin, y))
        return clamped_x, clamped_y

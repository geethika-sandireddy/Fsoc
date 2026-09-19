"""
Virtual Camera & Sensor Projection Engine — ISRO PS-26169 Backend.
Models the 640x480 Monochrome Focal Plane Array (FPA) sensor, 4°x3° FOV,
camera station mounting, 2D sensor plane projection, and pixel-to-angle linear mapping.
"""

from __future__ import annotations

import dataclasses
import math
from typing import Dict, List, Tuple
import numpy as np


@dataclasses.dataclass
class SensorProjection:
    in_fov: bool
    sensor_x: float | None
    sensor_y: float | None
    azimuth_offset_deg: float
    elevation_offset_deg: float


@dataclasses.dataclass
class FOVConePolygon:
    apex: Tuple[float, float]
    left: Tuple[float, float]
    right: Tuple[float, float]
    center: Tuple[float, float]


class VirtualCamera:
    """Simulates 640x480 Monochrome FPA camera with 4°x3° FOV and Pan/Tilt gimbal."""

    def __init__(
        self,
        resolution_width: int = 640,
        resolution_height: int = 480,
        fov_h_deg: float = 4.0,
        fov_v_deg: float = 3.0,
        update_rate_hz: float = 30.0,
        station_x: float = 1000.0,
        station_y: float = 480.0,
        max_pan_speed_dps: float = 5.0,
        max_tilt_speed_dps: float = 5.0,
        control_interval_ms: float = 50.0,
    ) -> None:
        self.width = resolution_width
        self.height = resolution_height
        self.fov_h = fov_h_deg
        self.fov_v = fov_v_deg
        self.update_rate = max(30.0, update_rate_hz)  # PS-26169: >= 30 Hz
        self.station_x = station_x
        self.station_y = station_y

        # Pan and Tilt gimbal limits
        self.max_pan_speed = max(5.0, min(10.0, max_pan_speed_dps))  # 5-10 °/s
        self.max_tilt_speed = max(5.0, min(10.0, max_tilt_speed_dps))  # 5-10 °/s
        self.control_interval_sec = control_interval_ms / 1000.0  # >= 20 Hz (<= 50 ms)

        # Current gimbal orientation (degrees)
        self.pan: float = 0.0
        self.tilt: float = 0.0

        # Background sensor stars for parallax display
        self.rng = np.random.default_rng(26169)
        self.sensor_stars = []
        for _ in range(80):
            self.sensor_stars.append({
                "x": float(self.rng.uniform(0, self.width)),
                "y": float(self.rng.uniform(0, self.height)),
                "r": float(self.rng.uniform(0.6, 1.5)),
                "brightness": float(self.rng.uniform(30, 90)),
            })

    def reset(self) -> None:
        """Resets camera gimbal angles to zero boresight."""
        self.pan = 0.0
        self.tilt = 0.0

    def project_world_to_sensor(self, world_x: float, world_y: float) -> SensorProjection:
        """
        Projects world space coordinates (Xw, Yw) onto the 640x480 camera sensor plane.
        Optical boresight center is (320, 240).
        """
        dx = world_x - self.station_x
        dy = world_y - self.station_y

        # Azimuth angle in degrees from vertical optical boresight (90 deg = straight up)
        target_azimuth_deg = math.atan2(dx, dy) * (180.0 / math.pi)
        target_distance = math.sqrt(dx * dx + dy * dy)

        # Azimuth offset relative to current camera Pan angle
        azimuth_offset_deg = target_azimuth_deg - self.pan

        # Elevation/distance tilt mapping:
        nominal_distance = 1000.0
        delta_distance = target_distance - nominal_distance
        elevation_offset_deg = (delta_distance / nominal_distance) * (self.fov_v * 1.5) - self.tilt

        # Sensor plane mapping (boresight is at center)
        sensor_x = (self.width / 2.0) + (azimuth_offset_deg / self.fov_h) * self.width
        sensor_y = (self.height / 2.0) - (elevation_offset_deg / self.fov_v) * self.height

        in_fov = (0.0 <= sensor_x <= self.width) and (0.0 <= sensor_y <= self.height)

        return SensorProjection(
            in_fov=in_fov,
            sensor_x=float(sensor_x) if in_fov else None,
            sensor_y=float(sensor_y) if in_fov else None,
            azimuth_offset_deg=float(azimuth_offset_deg),
            elevation_offset_deg=float(elevation_offset_deg),
        )

    def pixel_to_angle(self, dx_px: float, dy_px: float) -> Tuple[float, float]:
        """
        Independent Pan and Tilt pixel-to-angle linear approximation.
        dx_px = x_det - 320, dy_px = y_det - 240
        Returns (pan_error_deg, tilt_error_deg).
        """
        pan_error_deg = dx_px * (self.fov_h / self.width)
        tilt_error_deg = dy_px * (self.fov_v / self.height)
        return pan_error_deg, tilt_error_deg

    def get_fov_cone_vertices(self, depth: float = 1400.0) -> FOVConePolygon:
        """
        Calculates the polygon vertices of the camera FOV cone in 2000x2000 world coordinates.
        Central optical axis extends upwards (+Y) plus pan angle.
        """
        sx = self.station_x
        sy = self.station_y

        pan_rad = math.radians(self.pan)
        half_fov_rad = math.radians(self.fov_h / 2.0)

        # In standard Cartesian where +Y is up, 90 deg is straight up
        center_angle = math.pi / 2.0 - pan_rad
        left_angle = center_angle + half_fov_rad
        right_angle = center_angle - half_fov_rad

        apex = (sx, sy)
        left = (sx + depth * math.cos(left_angle), sy + depth * math.sin(left_angle))
        right = (sx + depth * math.cos(right_angle), sy + depth * math.sin(right_angle))
        center = (sx + depth * math.cos(center_angle), sy + depth * math.sin(center_angle))

        return FOVConePolygon(apex=apex, left=left, right=right, center=center)

    def render_clean_fpa_frame(
        self,
        beacon_x: float | None,
        beacon_y: float | None,
        spot_matrix: np.ndarray | None = None,
    ) -> np.ndarray:
        """
        Renders a clean 2D monochrome FPA sensor image buffer (uint8, shape (480, 640)).
        Includes dark sensor noise floor, stars with parallax shift, and beacon spot.
        """
        # 1. Dark sensor floor (intensity ~10)
        frame = np.full((self.height, self.width), 10, dtype=np.float32)

        # 2. Stars with Pan/Tilt parallax shift
        pan_shift = (self.pan * 25.0) % self.width
        tilt_shift = (self.tilt * 25.0) % self.height

        for star in self.sensor_stars:
            sx = int((star["x"] - pan_shift) % self.width)
            sy = int((star["y"] + tilt_shift) % self.height)
            r = int(max(1, round(star["r"])))
            val = star["brightness"]

            y_min, y_max = max(0, sy - r), min(self.height, sy + r + 1)
            x_min, x_max = max(0, sx - r), min(self.width, sx + r + 1)
            frame[y_min:y_max, x_min:x_max] = np.maximum(frame[y_min:y_max, x_min:x_max], val)

        # 3. Beacon spot rendering
        if beacon_x is not None and beacon_y is not None:
            bx = int(round(beacon_x))
            by = int(round(beacon_y))

            if spot_matrix is None:
                # Default 10x10 spot with bloom
                dim = 30
                radius = 5
                yy, xx = np.meshgrid(np.arange(dim), np.arange(dim), indexing='ij')
                dist_sq = (xx - 15) ** 2 + (yy - 15) ** 2
                spot_matrix = 255.0 * np.exp(-dist_sq / (2.0 * (radius * 0.8) ** 2))
                core_mask = (np.abs(xx - 15) <= radius // 2) & (np.abs(yy - 15) <= radius // 2)
                spot_matrix[core_mask] = 255.0

            s_h, s_w = spot_matrix.shape
            half_w = s_w // 2
            half_h = s_h // 2

            # Compute overlapping bounding boxes
            frame_ymin = max(0, by - half_h)
            frame_ymax = min(self.height, by + half_h + (s_h % 2))
            frame_xmin = max(0, bx - half_w)
            frame_xmax = min(self.width, bx + half_w + (s_w % 2))

            spot_ymin = frame_ymin - (by - half_h)
            spot_ymax = spot_ymin + (frame_ymax - frame_ymin)
            spot_xmin = frame_xmin - (bx - half_w)
            spot_xmax = spot_xmin + (frame_xmax - frame_xmin)

            if frame_ymax > frame_ymin and frame_xmax > frame_xmin:
                frame[frame_ymin:frame_ymax, frame_xmin:frame_xmax] = np.maximum(
                    frame[frame_ymin:frame_ymax, frame_xmin:frame_xmax],
                    spot_matrix[spot_ymin:spot_ymax, spot_xmin:spot_xmax],
                )

        return np.clip(frame, 0.0, 255.0).astype(np.uint8)

"""
3D Virtual Camera & Sensor Projection Engine — ISRO PS-26169.
Implements a true 3D perspective pinhole camera model with Pan/Tilt gimbal kinematics:
- Resolution: 640 x 480 pixels (monochrome FPA default, configurable)
- FOV: 4.0° x 3.0° (user-configurable)
- Update rate: >= 30 Hz
- Pan/Tilt slew limits: 5-10 °/s (default 5.0 °/s)
- Mathematically consistent 3D-to-2D perspective projection and line-of-sight calculation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Tuple
import numpy as np

from backend.environment_3d import VirtualEnvironment3D


@dataclass
class ProjectionResult3D:
    sensor_u: float
    sensor_v: float
    in_fov: bool
    distance: float
    azimuth_offset_deg: float
    elevation_offset_deg: float
    cam_x: float
    cam_y: float
    cam_z: float


class VirtualCamera3D:
    """
    Simulates a 640x480 Focal Plane Array (FPA) camera mounted on a 2-DOF Pan/Tilt gimbal
    observing targets in 3D Cartesian space.
    """

    def __init__(
        self,
        resolution_width: int = 640,
        resolution_height: int = 480,
        fov_h_deg: float = 4.0,
        fov_v_deg: float = 3.0,
        update_rate_hz: float = 30.0,
        max_pan_speed_dps: float = 5.0,
        max_tilt_speed_dps: float = 5.0,
        station_x: float = 0.0,
        station_y: float = 0.0,
        station_z: float = 0.0,
    ) -> None:
        self.width = int(resolution_width)
        self.height = int(resolution_height)
        self.fov_h = float(fov_h_deg)
        self.fov_v = float(fov_v_deg)

        # Enforce PS-26169 minimum camera update rate: >= 30 Hz
        self.update_rate = max(30.0, float(update_rate_hz))

        # Enforce PS-26169 Pan/Tilt slew rate limits: [5, 10] °/s
        self.max_pan_speed = max(5.0, min(10.0, float(max_pan_speed_dps)))
        self.max_tilt_speed = max(5.0, min(10.0, float(max_tilt_speed_dps)))

        # Station 3D position in World Frame
        self.station_x = float(station_x)
        self.station_y = float(station_y)
        self.station_z = float(station_z)

        # Principal point (boresight center)
        self.cx = self.width / 2.0   # 320.0
        self.cy = self.height / 2.0  # 240.0

        # Focal lengths in pixels derived from horizontal and vertical FOV
        # f_x = (W / 2) / tan(FOV_h / 2)
        # f_y = (H / 2) / tan(FOV_v / 2)
        self.fx = (self.width / 2.0) / math.tan(math.radians(self.fov_h / 2.0))
        self.fy = (self.height / 2.0) / math.tan(math.radians(self.fov_v / 2.0))

        # Current gimbal orientation: Pan (psi, azimuth) and Tilt (theta, elevation) in degrees
        self.pan_deg = 0.0
        self.tilt_deg = 0.0

        # Commanded targets for slew-rate limiting
        self.target_pan_deg = 0.0
        self.target_tilt_deg = 0.0

    def reset(
        self,
        pan_deg: float = 0.0,
        tilt_deg: float = 0.0,
        station_pos: Optional[Tuple[float, float, float]] = None,
    ) -> None:
        """Resets camera orientation and station position."""
        self.pan_deg = float(pan_deg)
        self.tilt_deg = float(tilt_deg)
        self.target_pan_deg = float(pan_deg)
        self.target_tilt_deg = float(tilt_deg)
        if station_pos is not None:
            self.station_x, self.station_y, self.station_z = station_pos

    def command_slew(self, delta_pan_deg: float, delta_tilt_deg: float) -> None:
        """Commands an incremental slew adjustment to pan and tilt angles."""
        self.target_pan_deg += float(delta_pan_deg)
        self.target_tilt_deg += float(delta_tilt_deg)

    def set_absolute_orientation(self, pan_deg: float, tilt_deg: float) -> None:
        """Commands absolute gimbal orientation."""
        self.target_pan_deg = float(pan_deg)
        self.target_tilt_deg = float(tilt_deg)

    def update_gimbal(self, dt: float) -> None:
        """
        Applies strict slew rate limits to gimbal pan/tilt motion.
        Max change = max_speed * dt.
        """
        max_pan_step = self.max_pan_speed * dt
        max_tilt_step = self.max_tilt_speed * dt

        # Pan rate limiting
        d_pan = self.target_pan_deg - self.pan_deg
        if abs(d_pan) <= max_pan_step:
            self.pan_deg = self.target_pan_deg
        else:
            self.pan_deg += math.copysign(max_pan_step, d_pan)

        # Tilt rate limiting
        d_tilt = self.target_tilt_deg - self.tilt_deg
        if abs(d_tilt) <= max_tilt_step:
            self.tilt_deg = self.target_tilt_deg
        else:
            self.tilt_deg += math.copysign(max_tilt_step, d_tilt)

    def project_world_to_sensor(
        self, world_x: float, world_y: float, world_z: float
    ) -> ProjectionResult3D:
        """
        Rigorous 3D pinhole perspective projection:
        1. Translates world coordinates relative to camera station:
           delta_p = p_tgt - p_station
        2. Applies Gimbal rotation matrix R_wc(psi, theta) = R_z(psi) * R_x(theta):
           p_tgt^cam = R_wc^T * delta_p
           where +Y_cam is forward optical boresight, +X_cam is right, +Z_cam is up.
        3. Pinhole perspective projection:
           u = fx * (X_cam / Y_cam) + cx
           v = -fy * (Z_cam / Y_cam) + cy  (image v points down)
        """
        dx = float(world_x - self.station_x)
        dy = float(world_y - self.station_y)
        dz = float(world_z - self.station_z)

        distance = math.sqrt(dx * dx + dy * dy + dz * dz)
        if distance < 1e-6:
            return ProjectionResult3D(
                sensor_u=self.cx,
                sensor_v=self.cy,
                in_fov=True,
                distance=0.0,
                azimuth_offset_deg=0.0,
                elevation_offset_deg=0.0,
                cam_x=0.0,
                cam_y=0.0,
                cam_z=0.0,
            )

        # Convert pan (psi) and tilt (theta) to radians
        psi = math.radians(self.pan_deg)
        theta = math.radians(self.tilt_deg)

        cos_psi = math.cos(psi)
        sin_psi = math.sin(psi)
        cos_theta = math.cos(theta)
        sin_theta = math.sin(theta)

        # R_z(psi)^T rotates about Z_w axis:
        # x1 = dx * cos(psi) + dy * sin(psi)
        # y1 = -dx * sin(psi) + dy * cos(psi)
        # z1 = dz
        x1 = dx * cos_psi - dy * sin_psi
        y1 = dx * sin_psi + dy * cos_psi
        z1 = dz

        # R_x(theta)^T rotates about X axis (tilt):
        # x_cam = x1
        # y_cam = y1 * cos(theta) + z1 * sin(theta)  (forward along boresight)
        # z_cam = -y1 * sin(theta) + z1 * cos(theta) (up)
        x_cam = x1
        y_cam = y1 * cos_theta + z1 * sin_theta
        z_cam = -y1 * sin_theta + z1 * cos_theta

        # Point is behind camera if y_cam <= 0
        if y_cam <= 1e-3:
            return ProjectionResult3D(
                sensor_u=-999.0,
                sensor_v=-999.0,
                in_fov=False,
                distance=distance,
                azimuth_offset_deg=math.degrees(math.atan2(x_cam, max(1e-3, y_cam))),
                elevation_offset_deg=math.degrees(math.atan2(z_cam, max(1e-3, y_cam))),
                cam_x=x_cam,
                cam_y=y_cam,
                cam_z=z_cam,
            )

        # Perspective Pinhole Projection
        u = self.fx * (x_cam / y_cam) + self.cx
        v = -self.fy * (z_cam / y_cam) + self.cy

        # Angular offsets relative to optical boresight
        azimuth_offset = math.degrees(math.atan2(x_cam, y_cam))
        elevation_offset = math.degrees(math.atan2(z_cam, y_cam))

        # Check if projected coordinates fall strictly inside sensor boundaries [0, W] and [0, H]
        in_fov = (0.0 <= u <= float(self.width)) and (0.0 <= v <= float(self.height))

        return ProjectionResult3D(
            sensor_u=u,
            sensor_v=v,
            in_fov=in_fov,
            distance=distance,
            azimuth_offset_deg=azimuth_offset,
            elevation_offset_deg=elevation_offset,
            cam_x=x_cam,
            cam_y=y_cam,
            cam_z=z_cam,
        )

    def sensor_to_world_ray(self, u: float, v: float) -> Tuple[float, float, float]:
        """
        Inverse projection: Computes 3D normalized line-of-sight unit vector in World Frame
        corresponding to a detected sensor pixel (u, v).
        """
        # Direction in camera frame (+Y_cam forward)
        x_c = (u - self.cx) / self.fx
        y_c = 1.0
        z_c = -(v - self.cy) / self.fy

        norm = math.sqrt(x_c * x_c + y_c * y_c + z_c * z_c)
        x_c /= norm
        y_c /= norm
        z_c /= norm

        # Rotate by R_wc(psi, theta) = R_z(psi) * R_x(theta)
        psi = math.radians(self.pan_deg)
        theta = math.radians(self.tilt_deg)

        cos_psi = math.cos(psi)
        sin_psi = math.sin(psi)
        cos_theta = math.cos(theta)
        sin_theta = math.sin(theta)

        # Unrotate theta (R_x):
        # x1 = x_c
        # y1 = y_c * cos(theta) - z_c * sin(theta)
        # z1 = y_c * sin(theta) + z_c * cos(theta)
        x1 = x_c
        y1 = y_c * cos_theta - z_c * sin_theta
        z1 = y_c * sin_theta + z_c * cos_theta

        # Unrotate psi (R_z):
        # x_w = x1 * cos(psi) - y1 * sin(psi)
        # y_w = x1 * sin(psi) + y1 * cos(psi)
        # z_w = z1
        x_w = x1 * cos_psi + y1 * sin_psi
        y_w = -x1 * sin_psi + y1 * cos_psi
        z_w = z1

        return x_w, y_w, z_w

    def render_clean_fpa_frame(
        self,
        proj_u: float,
        proj_v: float,
        spot_patch: np.ndarray,
        env: Optional[VirtualEnvironment3D] = None,
    ) -> np.ndarray:
        """
        Renders an uncorrupted 8-bit monochrome sensor frame (640x480).
        Blits celestial background stars and the optical beacon intensity spot.
        """
        frame = np.full((self.height, self.width), 12, dtype=np.uint8)  # Deep-space background

        # Render background stars in FOV if environment provided
        if env is not None:
            for star in env.stars:
                star_proj = self.project_world_to_sensor(star.x, star.y, star.z)
                if star_proj.in_fov:
                    su = int(round(star_proj.sensor_u))
                    sv = int(round(star_proj.sensor_v))
                    if 0 <= su < self.width and 0 <= sv < self.height:
                        star_val = int(round(star.magnitude * 180.0))
                        frame[sv, su] = max(frame[sv, su], star_val)
                        if star.size > 1.0:
                            if su + 1 < self.width:
                                frame[sv, su + 1] = max(frame[sv, su + 1], star_val // 2)
                            if sv + 1 < self.height:
                                frame[sv + 1, su] = max(frame[sv + 1, su], star_val // 2)

        # Blit optical beacon spot if within sensor frame
        su = int(round(proj_u))
        sv = int(round(proj_v))

        p_h, p_w = spot_patch.shape
        p_half_h = p_h // 2
        p_half_w = p_w // 2

        # Sub-window bounds
        f_min_x = max(0, su - p_half_w)
        f_max_x = min(self.width, su + p_half_w + 1)
        f_min_y = max(0, sv - p_half_h)
        f_max_y = min(self.height, sv + p_half_h + 1)

        p_min_x = f_min_x - (su - p_half_w)
        p_max_x = p_min_x + (f_max_x - f_min_x)
        p_min_y = f_min_y - (sv - p_half_h)
        p_max_y = p_min_y + (f_max_y - f_min_y)

        if f_max_x > f_min_x and f_max_y > f_min_y:
            sub_frame = frame[f_min_y:f_max_y, f_min_x:f_max_x]
            sub_patch = spot_patch[p_min_y:p_max_y, p_min_x:p_max_x]
            # Maximum intensity blending
            frame[f_min_y:f_max_y, f_min_x:f_max_x] = np.maximum(sub_frame, sub_patch)

        return frame

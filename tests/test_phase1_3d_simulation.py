"""
Automated Unit & Integration Test Suite for Phase 1:
3D Virtual Environment, 3D Pinhole Virtual Camera & Disturbance Fixes.
ISRO PS-26169.
"""

import math
import sys
from pathlib import Path
import numpy as np
import pytest

# Add project root to sys.path
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.environment_3d import VirtualEnvironment3D
from backend.target_3d import TargetGenerator3D, TargetMotionMode3D, TargetShape
from backend.camera_3d import VirtualCamera3D
from backend.disturbance import (
    DisturbanceEngine,
    NoiseConfig,
    PlatformMotionTrajectory,
    AtmosphereCondition,
    validate_control_interval,
)


# =========================================================================
# 1. 3D Virtual Environment Tests
# =========================================================================

def test_environment_3d_dimensions_and_invariants():
    """Verify 3D environment enforces minimum 2000x2000 transverse span and bounds."""
    with pytest.raises(ValueError):
        VirtualEnvironment3D(size_x=1920, size_y=1080)

    env = VirtualEnvironment3D(size_x=2000, size_y=2000, size_z=2000, star_density=100, seed=42)
    assert env.size_x == 2000.0
    assert env.size_y == 2000.0
    assert env.size_z == 2000.0
    assert len(env.stars) == 100

    # Bounds checking
    assert env.is_within_bounds(0, 0, 0) is True
    assert env.is_within_bounds(950, -950, 500) is True
    assert env.is_within_bounds(1050, 0, 0) is False
    assert env.is_within_bounds(0, -1100, 0) is False
    assert env.is_within_bounds(0, 0, 1050) is False

    # Clamping
    cx, cy, cz = env.clamp_bounds(1500, -2000, 3000, margin=50.0)
    assert cx == 950.0
    assert cy == -950.0
    assert cz == 950.0


# =========================================================================
# 2. 3D Target Generator Tests (All 7 Motion Modes)
# =========================================================================

def test_target_3d_bounds_and_all_motions():
    """Verify that all 7 3D motion modes stay bounded within 3D simulation volume."""
    env = VirtualEnvironment3D(size_x=2000, size_y=2000, size_z=2000)

    for mode in TargetMotionMode3D:
        tgt = TargetGenerator3D(env, motion_mode=mode, size=10, speed=50.0, seed=123)
        tgt.reset()

        for step in range(200):
            t = step * 0.05
            state = tgt.update(0.05, t)
            assert env.is_within_bounds(state.x, state.y, state.z), (
                f"Mode {mode} violated boundary at t={t}: ({state.x}, {state.y}, {state.z})"
            )


def test_target_size_and_spot_rendering():
    """Verify target size clamping [5, 20] px and spot patch generation."""
    env = VirtualEnvironment3D()
    tgt_small = TargetGenerator3D(env, size=2)
    assert tgt_small.size == 5

    tgt_large = TargetGenerator3D(env, size=50)
    assert tgt_large.size == 20

    # Spot patch properties
    for shape in [TargetShape.SQUARE, TargetShape.CIRCLE, TargetShape.RECTANGLE]:
        tgt = TargetGenerator3D(env, size=10, shape=shape)
        patch = tgt.render_spot_patch()
        assert patch.dtype == np.uint8
        assert patch.ndim == 2
        assert patch.shape[0] == patch.shape[1]
        assert np.max(patch) == 255


# =========================================================================
# 3. 3D Pinhole Virtual Camera Tests
# =========================================================================

def test_camera_3d_boresight_projection():
    """Verify target placed along optical axis (+Y_cam) projects exactly to sensor center (320, 240)."""
    cam = VirtualCamera3D(
        resolution_width=640,
        resolution_height=480,
        fov_h_deg=4.0,
        fov_v_deg=3.0,
        station_x=0.0,
        station_y=0.0,
        station_z=0.0,
    )
    cam.reset(pan_deg=0.0, tilt_deg=0.0)

    # Target placed at (0, 800, 0) directly on optical boresight
    proj = cam.project_world_to_sensor(world_x=0.0, world_y=800.0, world_z=0.0)
    assert proj.in_fov is True
    assert math.isclose(proj.sensor_u, 320.0, abs_tol=1e-4)
    assert math.isclose(proj.sensor_v, 240.0, abs_tol=1e-4)
    assert math.isclose(proj.azimuth_offset_deg, 0.0, abs_tol=1e-4)
    assert math.isclose(proj.elevation_offset_deg, 0.0, abs_tol=1e-4)


def test_camera_3d_gimbal_slew_rate_limiting():
    """Verify gimbal pan/tilt rate limiting strictly enforces [5, 10] deg/s."""
    cam = VirtualCamera3D(max_pan_speed_dps=5.0, max_tilt_speed_dps=5.0)
    cam.reset(pan_deg=0.0, tilt_deg=0.0)

    # Command large pan of 10 degrees
    cam.set_absolute_orientation(pan_deg=10.0, tilt_deg=-10.0)

    # Update for dt = 0.05 s (20 Hz)
    cam.update_gimbal(dt=0.05)
    # Maximum step = 5.0 * 0.05 = 0.25 deg
    assert math.isclose(cam.pan_deg, 0.25, abs_tol=1e-5)
    assert math.isclose(cam.tilt_deg, -0.25, abs_tol=1e-5)


def test_camera_3d_inverse_line_of_sight():
    """Verify inverse ray calculation matches target direction."""
    cam = VirtualCamera3D()
    cam.reset(pan_deg=0.0, tilt_deg=0.0)

    # Center pixel ray should point along +Y axis (0, 1, 0)
    rx, ry, rz = cam.sensor_to_world_ray(320.0, 240.0)
    assert math.isclose(rx, 0.0, abs_tol=1e-4)
    assert math.isclose(ry, 1.0, abs_tol=1e-4)
    assert math.isclose(rz, 0.0, abs_tol=1e-4)


def test_camera_frame_rendering():
    """Verify rendering clean 640x480 FPA frame."""
    cam = VirtualCamera3D()
    patch = np.full((15, 15), 255, dtype=np.uint8)
    frame = cam.render_clean_fpa_frame(320.0, 240.0, patch)
    assert frame.shape == (480, 640)
    assert frame.dtype == np.uint8
    assert frame[240, 320] == 255


# =========================================================================
# 4. Disturbance Engine PS-26169 Alignment Tests
# =========================================================================

def test_coherent_linear_platform_motion():
    """Verify platform motion is temporally coherent (linear) and bounded <= 20 px/frame."""
    engine = DisturbanceEngine(seed=42)
    engine.configure(
        platform_motion_enabled=True,
        platform_motion_amplitude_px=15.0,
        platform_motion_trajectory=PlatformMotionTrajectory.LINEAR,
    )

    positions = []
    for _ in range(50):
        dx, dy = engine.compute_platform_motion_offset(dt=0.033)
        assert abs(dx) <= 15.0
        assert abs(dy) <= 15.0
        positions.append((dx, dy))

    # Check temporal coherence: displacement between consecutive frames must be small (constant velocity step)
    diffs = [
        math.sqrt((positions[i][0] - positions[i - 1][0]) ** 2 + (positions[i][1] - positions[i - 1][1]) ** 2)
        for i in range(1, len(positions))
    ]
    # In linear motion, step per frame is ~3-4 pixels, NOT independent random jumps of 30 pixels!
    assert np.mean(diffs) < 8.0, "Platform motion lacks temporal coherence"


def test_jitter_pre_render_coordinate_pipeline():
    """Verify camera jitter is integrated into pre-render coordinate offsets."""
    engine = DisturbanceEngine(seed=42)
    engine.configure(jitter_enabled=True, jitter_amplitude_px=12.0)

    u_proj, v_proj = 320.0, 240.0
    u_eff, v_eff = engine.apply_coordinate_disturbances(u_proj, v_proj)

    assert abs(u_eff - u_proj) <= 12.0
    assert abs(v_eff - v_proj) <= 12.0


def test_control_interval_validation():
    """Verify update interval is validated for >= 20 Hz (<= 50 ms)."""
    assert validate_control_interval(0.05) == 0.05
    assert validate_control_interval(0.033) == 0.033

    with pytest.raises(ValueError):
        validate_control_interval(0.06)  # 60 ms = 16.7 Hz < 20 Hz

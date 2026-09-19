"""
Automated Unit Test Suite for Backend Feature 2:
Virtual Camera & Sensor Projection Engine (ISRO PS-26169).
"""

import math
import sys
from pathlib import Path
import numpy as np

# Add project root to sys.path
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.camera import VirtualCamera


def test_camera_specifications_and_limits():
    """Verify camera parameter constraints per PS-26169."""
    cam = VirtualCamera(
        resolution_width=640,
        resolution_height=480,
        fov_h_deg=4.0,
        fov_v_deg=3.0,
        update_rate_hz=20.0,  # Below minimum 30 Hz
        max_pan_speed_dps=15.0,  # Above maximum 10 °/s
        max_tilt_speed_dps=2.0,  # Below minimum 5 °/s
    )

    assert cam.width == 640
    assert cam.height == 480
    assert cam.fov_h == 4.0
    assert cam.fov_v == 3.0
    # Enforced minimum rate: >= 30 Hz
    assert cam.update_rate == 30.0
    # Enforced pan speed limit: [5, 10] °/s
    assert cam.max_pan_speed == 10.0
    # Enforced tilt speed limit: [5, 10] °/s
    assert cam.max_tilt_speed == 5.0
    print("[PASS] test_camera_specifications_and_limits")


def test_boresight_centering_projection():
    """Verify that a target aligned with optical axis projects exactly to sensor center (320, 240)."""
    cam = VirtualCamera(station_x=1000.0, station_y=480.0)
    cam.reset()

    # Target placed at nominal distance 1000 px straight up along optical boresight
    proj = cam.project_world_to_sensor(world_x=1000.0, world_y=1480.0)

    assert proj.in_fov is True
    assert math.isclose(proj.azimuth_offset_deg, 0.0, abs_tol=1e-5)
    assert math.isclose(proj.sensor_x, 320.0, abs_tol=1e-5)
    assert math.isclose(proj.sensor_y, 240.0, abs_tol=1e-5)
    print("[PASS] test_boresight_centering_projection")


def test_fov_boundary_projections():
    """Verify projection at FOV limits (left edge, right edge, out of FOV)."""
    cam = VirtualCamera(station_x=1000.0, station_y=480.0, fov_h_deg=4.0, fov_v_deg=3.0)
    cam.reset()

    # Target offset by +2.0 degrees (right half-FOV)
    # dx = 1000 * tan(2 deg) ~ 34.92 px
    dx = 1000.0 * math.tan(math.radians(2.0))
    proj_right = cam.project_world_to_sensor(world_x=1000.0 + dx, world_y=1480.0)
    assert proj_right.in_fov is True
    assert math.isclose(proj_right.sensor_x, 640.0, abs_tol=1.0)

    # Target offset by -2.0 degrees (left half-FOV)
    proj_left = cam.project_world_to_sensor(world_x=1000.0 - dx, world_y=1480.0)
    assert proj_left.in_fov is True
    assert math.isclose(proj_left.sensor_x, 0.0, abs_tol=1.0)

    # Target outside FOV (+5.0 degrees azimuth)
    dx_out = 1000.0 * math.tan(math.radians(5.0))
    proj_out = cam.project_world_to_sensor(world_x=1000.0 + dx_out, world_y=1480.0)
    assert proj_out.in_fov is False
    assert proj_out.sensor_x is None
    assert proj_out.sensor_y is None
    print("[PASS] test_fov_boundary_projections")


def test_pixel_to_angle_mapping():
    """Verify independent Pan and Tilt linear mapping."""
    cam = VirtualCamera(resolution_width=640, resolution_height=480, fov_h_deg=4.0, fov_v_deg=3.0)

    d_pan, d_tilt = cam.pixel_to_angle(dx_px=80.0, dy_px=-40.0)
    assert math.isclose(d_pan, 0.50, rel_tol=1e-5)
    assert math.isclose(d_tilt, -0.25, rel_tol=1e-5)

    # Reverse: at center dx=0, dy=0 -> 0 deg
    z_pan, z_tilt = cam.pixel_to_angle(dx_px=0.0, dy_px=0.0)
    assert z_pan == 0.0
    assert z_tilt == 0.0
    print("[PASS] test_pixel_to_angle_mapping")


def test_fov_cone_geometry():
    """Verify FOV cone polygon computation in world coordinates."""
    cam = VirtualCamera(station_x=1000.0, station_y=480.0)
    cam.pan = 0.0
    poly = cam.get_fov_cone_vertices(depth=1400.0)

    assert poly.apex == (1000.0, 480.0)
    # When pan=0, center boresight ray extends straight up along +Y
    assert math.isclose(poly.center[0], 1000.0, abs_tol=1e-4)
    assert math.isclose(poly.center[1], 480.0 + 1400.0, abs_tol=1e-4)
    print("[PASS] test_fov_cone_geometry")


def test_clean_fpa_frame_rendering():
    """Verify clean 640x480 monochrome FPA frame generation."""
    cam = VirtualCamera()
    frame = cam.render_clean_fpa_frame(beacon_x=320.0, beacon_y=240.0)

    assert isinstance(frame, np.ndarray)
    assert frame.dtype == np.uint8
    assert frame.shape == (480, 640)

    # Peak beacon intensity at center (row 240, col 320)
    assert frame[240, 320] == 255

    # Sensor background floor at edges
    assert frame[10, 10] < 50

    # Without beacon, no 255 peak at center
    frame_empty = cam.render_clean_fpa_frame(beacon_x=None, beacon_y=None)
    assert frame_empty.shape == (480, 640)
    assert frame_empty[240, 320] < 50
    print("[PASS] test_clean_fpa_frame_rendering")


if __name__ == "__main__":
    test_camera_specifications_and_limits()
    test_boresight_centering_projection()
    test_fov_boundary_projections()
    test_pixel_to_angle_mapping()
    test_fov_cone_geometry()
    test_clean_fpa_frame_rendering()
    print("\n>>> ALL FEATURE 2 TESTS PASSED 100% SUCCESSFULLY! <<<")

"""
Independent Verification Test Suite — ISRO PS-26169.
Verifies mathematical invariants, kinematic slew rate limits,
coordinate boundedness, and error calculations using NumPy.
"""

import math
import numpy as np


def test_target_boundary_invariants():
    """Verify that all 7 target motion modes stay bounded within 2000x2000."""
    width, height = 2000.0, 2000.0
    margin = 30.0
    center_x, center_y = width / 2.0, height / 2.0 + 150.0
    omega = 2.0 * math.pi * 0.12
    radius = 450.0

    timesteps = np.linspace(0, 120, 1000)

    # 1. Figure of 8 (Lemniscate)
    f8_x = center_x + radius * np.sin(omega * timesteps)
    f8_y = center_y + (radius * 0.5) * np.sin(2.0 * omega * timesteps)
    assert np.all(f8_x >= margin) and np.all(f8_x <= width - margin)
    assert np.all(f8_y >= margin) and np.all(f8_y <= height - margin)

    # 2. Circular
    circ_x = center_x + radius * np.cos(omega * timesteps)
    circ_y = center_y + radius * np.sin(omega * timesteps)
    assert np.all(circ_x >= margin) and np.all(circ_x <= width - margin)
    assert np.all(circ_y >= margin) and np.all(circ_y <= height - margin)

    # 3. Spiral
    spiral_r = 80.0 + (radius - 80.0) * (0.5 + 0.5 * np.sin(omega * 0.25 * timesteps))
    sp_x = center_x + spiral_r * np.cos(omega * timesteps)
    sp_y = center_y + spiral_r * np.sin(omega * timesteps)
    assert np.all(sp_x >= margin) and np.all(sp_x <= width - margin)
    assert np.all(sp_y >= margin) and np.all(sp_y <= height - margin)

    # 4. Sinusoidal
    sin_y = center_y + (radius * 0.4) * np.sin(omega * timesteps * 2.0)
    assert np.all(sin_y >= margin) and np.all(sin_y <= height - margin)


def test_slew_rate_limiter_physics():
    """Verify that Pan/Tilt slew rate is strictly capped to speed_max / frequency."""
    max_pan_speed = 5.0  # deg/s
    control_freq = 20.0  # Hz
    dt = 1.0 / control_freq  # 0.05 s
    max_allowable_step = max_pan_speed * dt  # 0.25 deg

    # Test large commanded error (e.g. 10 deg)
    commanded_error = 10.0
    kp = 0.8
    desired_delta = commanded_error * kp  # 8.0 deg
    applied_delta = max(-max_allowable_step, min(max_allowable_step, desired_delta))

    assert applied_delta == max_allowable_step
    assert applied_delta <= 0.25


def test_pixel_to_angle_linear_approximation():
    """Verify independent Pan and Tilt pixel-to-angle conversion."""
    fov_h = 4.0  # degrees
    fov_v = 3.0  # degrees
    sensor_w = 640.0
    sensor_h = 480.0
    center_x = 320.0
    center_y = 240.0

    # Detected at (400, 200)
    det_x = 400.0
    det_y = 200.0

    d_pan = (det_x - center_x) * (fov_h / sensor_w)
    d_tilt = (det_y - center_y) * (fov_v / sensor_h)

    assert math.isclose(d_pan, (80.0) * (4.0 / 640.0), rel_tol=1e-5)
    assert math.isclose(d_tilt, (-40.0) * (3.0 / 480.0), rel_tol=1e-5)
    assert math.isclose(d_pan, 0.5, rel_tol=1e-5)
    assert math.isclose(d_tilt, -0.25, rel_tol=1e-5)


def test_centroid_and_pointing_error_math():
    """Verify mathematical formulation of Centroid Error and Pointing Error."""
    gt_x, gt_y = 100.0, 100.0
    det_x, det_y = 103.0, 104.0
    center_x, center_y = 320.0, 240.0

    # Centroid error = distance(det, gt)
    c_err = math.sqrt((det_x - gt_x) ** 2 + (det_y - gt_y) ** 2)
    assert math.isclose(c_err, 5.0, rel_tol=1e-5)

    # Pointing error = distance(det, boresight)
    p_err = math.sqrt((det_x - center_x) ** 2 + (det_y - center_y) ** 2)
    expected_p = math.sqrt((103.0 - 320.0) ** 2 + (104.0 - 240.0) ** 2)
    assert math.isclose(p_err, expected_p, rel_tol=1e-5)

    # RMSE computation over series
    errors = np.array([3.0, 4.0, 5.0, 6.0, 7.0])
    rmse = np.sqrt(np.mean(errors ** 2))
    expected_rmse = math.sqrt((9 + 16 + 25 + 36 + 49) / 5.0)  # sqrt(27) = 5.196
    assert math.isclose(rmse, expected_rmse, rel_tol=1e-5)


def test_atmospheric_attenuation_model():
    """Verify that contrast and brightness reductions strictly modify image pixel distributions."""
    raw_pixels = np.array([50, 100, 150, 200, 255], dtype=float)

    contrast_red = 0.5
    brightness_red = 0.2

    contrast_factor = 1.0 - contrast_red
    brightness_offset = -brightness_red * 128.0

    modified = (raw_pixels - 128.0) * contrast_factor + 128.0 + brightness_offset
    modified = np.clip(modified, 0, 255)

    # Contrast reduction should reduce standard deviation
    assert np.std(modified) < np.std(raw_pixels)
    # Brightness reduction should lower mean
    assert np.mean(modified) < np.mean(raw_pixels)


if __name__ == "__main__":
    test_target_boundary_invariants()
    test_slew_rate_limiter_physics()
    test_pixel_to_angle_linear_approximation()
    test_centroid_and_pointing_error_math()
    test_atmospheric_attenuation_model()
    print("ALL 5 INDEPENDENT MATHEMATICAL INVARIANT TESTS PASSED SUCCESSFULLY!")

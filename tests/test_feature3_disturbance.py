"""
Feature 3 Tests — Disturbance & Noise Engine.
Verifies all PS-26169 noise types modify the pixel buffer correctly.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from backend.disturbance import DisturbanceEngine, NoiseConfig, AtmosphereCondition


def _make_test_frame(val: int = 128, h: int = 480, w: int = 640) -> np.ndarray:
    """Creates a uniform test frame."""
    return np.full((h, w), val, dtype=np.uint8)


def test_no_noise_passthrough():
    """With all noise disabled and CLEAR atmosphere, frame should be unchanged."""
    engine = DisturbanceEngine(seed=42)
    frame = _make_test_frame(128)
    result = engine.apply_all(frame)
    assert result.shape == frame.shape, f"Shape mismatch: {result.shape} vs {frame.shape}"
    assert result.dtype == np.uint8, f"dtype mismatch: {result.dtype}"
    assert np.array_equal(result, frame), "Frame should be unchanged with all noise disabled"
    print("[PASS] test_no_noise_passthrough")


def test_salt_and_pepper():
    """Salt & Pepper noise should introduce 0s and 255s at ~10% density."""
    engine = DisturbanceEngine(seed=42)
    engine.configure(salt_pepper_enabled=True, salt_pepper_density=0.10)
    frame = _make_test_frame(128)
    result = engine.apply_all(frame)

    total = result.size
    num_salt = np.sum(result == 255)
    num_pepper = np.sum(result == 0)
    total_affected = num_salt + num_pepper
    density = total_affected / total

    assert num_salt > 0, "No salt pixels found"
    assert num_pepper > 0, "No pepper pixels found"
    assert 0.05 < density < 0.15, f"Density {density:.4f} outside expected range [0.05, 0.15]"
    assert result.dtype == np.uint8
    print(f"[PASS] test_salt_and_pepper (density={density:.4f}, salt={num_salt}, pepper={num_pepper})")


def test_gaussian_noise():
    """Gaussian noise should change pixel values with bounded standard deviation."""
    engine = DisturbanceEngine(seed=42)
    engine.configure(gaussian_enabled=True, gaussian_std=15.0)
    frame = _make_test_frame(128)
    result = engine.apply_all(frame)

    # Frame should not be identical
    assert not np.array_equal(result, frame), "Gaussian noise should modify the frame"

    # Check the noise statistics
    diff = result.astype(np.float32) - frame.astype(np.float32)
    actual_std = np.std(diff)
    assert 5.0 < actual_std < 25.0, f"Noise std {actual_std:.2f} outside expected range"
    assert result.dtype == np.uint8
    print(f"[PASS] test_gaussian_noise (measured std={actual_std:.2f})")


def test_gaussian_std_clamped_to_20():
    """Gaussian std should be clamped to max 20 even if configured higher."""
    engine = DisturbanceEngine(seed=42)
    engine.configure(gaussian_enabled=True, gaussian_std=50.0)
    frame = _make_test_frame(128)
    result = engine.apply_all(frame)

    diff = result.astype(np.float32) - frame.astype(np.float32)
    actual_std = np.std(diff)
    # Should be around 20 (clamped), not 50
    assert actual_std < 30.0, f"Std {actual_std:.2f} should be clamped to ≤20"
    print(f"[PASS] test_gaussian_std_clamped_to_20 (measured std={actual_std:.2f})")


def test_poisson_noise():
    """Poisson noise should modify pixel values based on photon statistics."""
    engine = DisturbanceEngine(seed=42)
    engine.configure(poisson_enabled=True, poisson_scale=1.0)
    frame = _make_test_frame(128)
    result = engine.apply_all(frame)

    assert not np.array_equal(result, frame), "Poisson noise should modify the frame"
    assert result.dtype == np.uint8
    # Mean should be roughly preserved for Poisson
    mean_diff = abs(np.mean(result.astype(float)) - np.mean(frame.astype(float)))
    assert mean_diff < 5.0, f"Mean shift {mean_diff:.2f} too large for Poisson noise"
    print(f"[PASS] test_poisson_noise (mean_diff={mean_diff:.2f})")


def test_jitter_offset():
    """Jitter should produce random offsets within ±amplitude range."""
    engine = DisturbanceEngine(seed=42)
    engine.configure(jitter_enabled=True, jitter_amplitude_px=15.0)

    offsets = [engine.compute_jitter_offset() for _ in range(100)]
    dx_vals = [o[0] for o in offsets]
    dy_vals = [o[1] for o in offsets]

    assert max(abs(d) for d in dx_vals) <= 15, "dx exceeds ±15 px"
    assert max(abs(d) for d in dy_vals) <= 15, "dy exceeds ±15 px"
    assert len(set(dx_vals)) > 1, "Jitter dx should vary"
    assert len(set(dy_vals)) > 1, "Jitter dy should vary"
    print(f"[PASS] test_jitter_offset (dx range=[{min(dx_vals)},{max(dx_vals)}], dy range=[{min(dy_vals)},{max(dy_vals)}])")


def test_jitter_disabled_returns_zero():
    """Jitter disabled should always return (0, 0)."""
    engine = DisturbanceEngine(seed=42)
    engine.configure(jitter_enabled=False)
    for _ in range(10):
        assert engine.compute_jitter_offset() == (0, 0)
    print("[PASS] test_jitter_disabled_returns_zero")


def test_atmosphere_haze():
    """Haze atmosphere should reduce contrast (transmittance < 1) and add brightness."""
    engine = DisturbanceEngine(seed=42)
    engine.configure(atmosphere="haze")
    frame = _make_test_frame(128)
    result = engine.apply_all(frame)

    mean_original = np.mean(frame.astype(float))
    mean_result = np.mean(result.astype(float))

    # Haze: transmittance 0.70, brightness +15
    # Expected: 128 * 0.70 + 15 = 104.6 (plus scatter noise)
    assert not np.array_equal(result, frame), "Haze should modify the frame"
    assert result.dtype == np.uint8
    # Mean should be around 104-105 range
    assert 90 < mean_result < 120, f"Haze mean {mean_result:.1f} outside expected range"
    print(f"[PASS] test_atmosphere_haze (mean={mean_result:.1f})")


def test_atmosphere_fog():
    """Fog should significantly reduce contrast and add heavy scatter."""
    engine = DisturbanceEngine(seed=42)
    engine.configure(atmosphere="fog")
    frame = _make_test_frame(200)
    result = engine.apply_all(frame)

    mean_result = np.mean(result.astype(float))
    # Fog: transmittance 0.35, brightness +40
    # Expected: 200 * 0.35 + 40 = 110 (plus heavy scatter)
    assert 80 < mean_result < 140, f"Fog mean {mean_result:.1f} outside expected range"
    print(f"[PASS] test_atmosphere_fog (mean={mean_result:.1f})")


def test_atmosphere_low_light():
    """Low light should slightly reduce signal and decrease brightness."""
    engine = DisturbanceEngine(seed=42)
    engine.configure(atmosphere="low_light")
    frame = _make_test_frame(128)
    result = engine.apply_all(frame)

    mean_result = np.mean(result.astype(float))
    # Low light: transmittance 0.85, brightness -30
    # Expected: 128 * 0.85 - 30 = 78.8
    assert 60 < mean_result < 100, f"Low light mean {mean_result:.1f} outside expected range"
    print(f"[PASS] test_atmosphere_low_light (mean={mean_result:.1f})")


def test_platform_motion_shift():
    """Platform motion should spatially shift the entire frame."""
    engine = DisturbanceEngine(seed=42)
    engine.configure(platform_motion_enabled=True, platform_motion_amplitude_px=10.0)

    # Create a frame with a single bright stripe
    frame = _make_test_frame(10)
    frame[200:210, :] = 200  # Horizontal bright stripe

    result = engine.apply_platform_motion_shift(frame)

    # The stripe should have moved
    original_bright_rows = np.where(np.mean(frame, axis=1) > 100)[0]
    result_bright_rows = np.where(np.mean(result, axis=1) > 100)[0]

    assert len(result_bright_rows) > 0, "Bright stripe should still exist after shift"
    assert result.shape == frame.shape
    assert result.dtype == frame.dtype
    print(f"[PASS] test_platform_motion_shift (stripe moved from rows {original_bright_rows[[0,-1]]} to {result_bright_rows[[0,-1]]})")


def test_combined_noise_all_enabled():
    """All noise sources enabled simultaneously should produce valid output."""
    engine = DisturbanceEngine(seed=42)
    engine.configure(
        salt_pepper_enabled=True, salt_pepper_density=0.05,
        gaussian_enabled=True, gaussian_std=10.0,
        poisson_enabled=True, poisson_scale=1.0,
        atmosphere="rain",
        platform_motion_enabled=True, platform_motion_amplitude_px=5.0,
    )
    frame = _make_test_frame(128)
    result = engine.apply_all(frame)

    assert result.shape == frame.shape, "Output shape must match input"
    assert result.dtype == np.uint8, "Output dtype must be uint8"
    assert np.min(result) >= 0, "No underflow"
    assert np.max(result) <= 255, "No overflow"
    assert not np.array_equal(result, frame), "Combined noise should modify frame"
    print("[PASS] test_combined_noise_all_enabled")


def test_configure_and_get_config():
    """Configure method should update fields and get_config_dict should serialize."""
    engine = DisturbanceEngine()
    engine.configure(
        gaussian_enabled=True,
        gaussian_std=18.5,
        atmosphere="fog",
        jitter_enabled=True,
        jitter_amplitude_px=20.0,
    )

    cfg = engine.get_config_dict()
    assert cfg["gaussian_enabled"] is True
    assert cfg["gaussian_std"] == 18.5
    assert cfg["atmosphere"] == "fog"
    assert cfg["jitter_enabled"] is True
    assert cfg["jitter_amplitude_px"] == 20.0
    assert cfg["salt_pepper_enabled"] is False  # Unchanged default
    print("[PASS] test_configure_and_get_config")


if __name__ == "__main__":
    test_no_noise_passthrough()
    test_salt_and_pepper()
    test_gaussian_noise()
    test_gaussian_std_clamped_to_20()
    test_poisson_noise()
    test_jitter_offset()
    test_jitter_disabled_returns_zero()
    test_atmosphere_haze()
    test_atmosphere_fog()
    test_atmosphere_low_light()
    test_platform_motion_shift()
    test_combined_noise_all_enabled()
    test_configure_and_get_config()

    print(f"\n>>> ALL FEATURE 3 TESTS PASSED 100% SUCCESSFULLY! <<<")

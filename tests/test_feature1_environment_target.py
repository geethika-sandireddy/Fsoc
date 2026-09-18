"""
Automated Unit Test Suite for Backend Feature 1:
Virtual Environment & Target Generator Engine (ISRO PS-26169).
"""

import math
import sys
from pathlib import Path
import numpy as np

# Add project root to sys.path
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.environment import VirtualEnvironment
from backend.target import TargetGenerator


def test_environment_specifications():
    """Verify that environment enforces minimum 2000x2000 px size and generates stars."""
    # 1. Minimum dimensions enforcement
    try:
        VirtualEnvironment(width=1920, height=1080)
        assert False, "Should have raised ValueError for dimensions < 2000x2000"
    except ValueError:
        pass  # Expected

    env = VirtualEnvironment(width=2000, height=2000, star_density=150, seed=42)
    assert env.width == 2000
    assert env.height == 2000
    assert len(env.stars) == 150

    # 2. Starfield reproducibility
    env2 = VirtualEnvironment(width=2000, height=2000, star_density=150, seed=42)
    for s1, s2 in zip(env.stars, env2.stars):
        assert math.isclose(s1.x, s2.x, rel_tol=1e-5)
        assert math.isclose(s1.y, s2.y, rel_tol=1e-5)

    # 3. Boundary validation
    assert env.is_within_bounds(1000, 1000) is True
    assert env.is_within_bounds(-5, 500) is False
    assert env.is_within_bounds(2050, 1000) is False

    cx, cy = env.clamp_bounds(-100, 2500, margin=50)
    assert cx == 50.0
    assert cy == 1950.0
    print("[PASS] test_environment_specifications")


def test_target_size_and_shapes():
    """Verify target size bounds [5, 20] px and spot rendering."""
    env = VirtualEnvironment()

    # Size clamping
    tgt_under = TargetGenerator(env, size=2)
    assert tgt_under.size == 5

    tgt_over = TargetGenerator(env, size=50)
    assert tgt_over.size == 20

    tgt_nominal = TargetGenerator(env, size=10, shape="Square")
    assert tgt_nominal.size == 10

    # Optical spot matrix rendering
    matrix = tgt_nominal.render_spot_matrix()
    assert isinstance(matrix, np.ndarray)
    assert matrix.dtype == np.float32
    assert matrix.shape == (30, 30)
    assert np.max(matrix) == 255.0

    # Circle shape
    tgt_circle = TargetGenerator(env, size=12, shape="Circle")
    matrix_c = tgt_circle.render_spot_matrix()
    assert matrix_c.shape == (36, 36)
    assert np.max(matrix_c) == 255.0

    print("[PASS] test_target_size_and_shapes")


def test_all_seven_motion_trajectories():
    """Verify all 4 mandatory + 3 optional motion models stay strictly bounded."""
    env = VirtualEnvironment()
    motions = ["straight", "circular", "figure8", "random", "spiral", "sinusoidal", "user_defined"]

    for m in motions:
        tgt = TargetGenerator(env, motion_type=m, speed=140.0, radius=450.0, seed=12345)
        tgt.reset()

        # Simulate 10 seconds at 30 Hz (300 frames)
        dt = 0.033
        for frame in range(300):
            elapsed = frame * dt
            state = tgt.update(dt, elapsed)

            assert env.is_within_bounds(state.x, state.y, margin=20.0), (
                f"Motion '{m}' exceeded bounds at frame {frame} (t={elapsed:.2f}): ({state.x}, {state.y})"
            )

        print(f"[PASS] Trajectory '{m}' verified over 300 frames")


def test_deterministic_reproducibility():
    """Verify that runs with the same seed produce identical trajectories."""
    env1 = VirtualEnvironment(seed=26169)
    env2 = VirtualEnvironment(seed=26169)

    tgt1 = TargetGenerator(env1, motion_type="random", seed=999)
    tgt2 = TargetGenerator(env2, motion_type="random", seed=999)

    for i in range(100):
        s1 = tgt1.update(0.033, i * 0.033)
        s2 = tgt2.update(0.033, i * 0.033)
        assert math.isclose(s1.x, s2.x, abs_tol=1e-4)
        assert math.isclose(s1.y, s2.y, abs_tol=1e-4)

    print("[PASS] test_deterministic_reproducibility")


if __name__ == "__main__":
    test_environment_specifications()
    test_target_size_and_shapes()
    test_all_seven_motion_trajectories()
    test_deterministic_reproducibility()
    print("\n>>> ALL FEATURE 1 TESTS PASSED 100% SUCCESSFULLY! <<<")

"""
Automated Unit & Accuracy Benchmark Test Suite for Phase 2:
Synthetic AI Dataset Generation, Neural Beacon Validator & Sub-Pixel IW-CoG.
ISRO PS-26169.
"""

import math
import sys
from pathlib import Path
import cv2
import numpy as np
import pytest

# Add project root to sys.path
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.dataset_generator import SyntheticBeaconDatasetGenerator
from backend.ai_model import BeaconValidatorEngine
from backend.detection import (
    ClassicalCandidateGenerator,
    SubpixelCentroidEstimator,
    DetectionPipeline,
)
from backend.camera_3d import VirtualCamera3D
from backend.target_3d import TargetGenerator3D, VirtualEnvironment3D, TargetShape
from backend.disturbance import DisturbanceEngine, AtmosphereCondition


# =========================================================================
# 1. Synthetic Dataset Generator Tests
# =========================================================================

def test_synthetic_dataset_generation():
    """Verify synthetic dataset generator produces balanced, normalized 32x32 patches."""
    gen = SyntheticBeaconDatasetGenerator(patch_size=32, seed=42)
    X_train, y_train, X_test, y_test = gen.generate_dataset(num_samples=100, test_split=0.2)

    assert X_train.shape == (80, 1, 32, 32)
    assert y_train.shape == (80,)
    assert X_test.shape == (20, 1, 32, 32)
    assert y_test.shape == (20,)

    # Values normalized in [0, 1]
    assert np.min(X_train) >= 0.0
    assert np.max(X_train) <= 1.0

    # Labels balanced
    assert set(np.unique(y_train)).issubset({0, 1})
    assert np.sum(y_train == 1) > 0 and np.sum(y_train == 0) > 0


# =========================================================================
# 2. Neural Beacon Validator Engine Tests
# =========================================================================

def test_neural_beacon_validator_training_and_inference():
    """Verify CNN training on synthetic dataset, weights saving, and fast inference."""
    gen = SyntheticBeaconDatasetGenerator(patch_size=32, seed=123)
    X_train, y_train, X_test, y_test = gen.generate_dataset(num_samples=200, test_split=0.20)

    engine = BeaconValidatorEngine()
    metrics = engine.train(X_train, y_train, X_test, y_test, epochs=8)

    assert "val_accuracy" in metrics
    assert metrics["val_accuracy"] >= 0.70  # Convergence verification

    # Test positive vs negative discrimination
    pos_patch = gen.generate_positive_patch()
    neg_patch = gen.generate_negative_patch()

    score_pos = engine.validate_roi(pos_patch)
    score_neg = engine.validate_roi(neg_patch)

    assert score_pos > score_neg, f"Expected pos ({score_pos}) > neg ({score_neg})"


# =========================================================================
# 3. Sub-Pixel Centroiding IW-CoG Precision Tests
# =========================================================================

def test_subpixel_iw_cog_precision():
    """Verify sub-pixel IW-CoG achieves sub-pixel accuracy (< 0.2 px) on clean spot."""
    # Synthesize spot with exact known sub-pixel center (u=320.4, v=240.6)
    frame = np.full((480, 640), 12, dtype=np.uint8)
    true_u, true_v = 320.4, 240.6
    sigma = 3.5

    v_grid, u_grid = np.ogrid[225:256, 305:336]
    du = u_grid - true_u
    dv = v_grid - true_v
    spot = 240.0 * np.exp(-0.5 * (du * du + dv * dv) / (sigma * sigma))
    frame[225:256, 305:336] = np.clip(spot, 12, 255).astype(np.uint8)

    cu, cv, active_px = SubpixelCentroidEstimator.compute_iw_cog(frame, center_u=320, center_v=240, radius=15)

    assert cu is not None and cv is not None
    err = math.sqrt((cu - true_u) ** 2 + (cv - true_v) ** 2)
    assert err < 0.20, f"Sub-pixel IW-CoG error {err:.3f} px exceeds 0.20 px"


# =========================================================================
# 4. End-to-End Detection Pipeline Under Noise Regimes
# =========================================================================

def test_detection_pipeline_clean_frame():
    """Verify pipeline detects beacon on clean 640x480 frame with sub-pixel accuracy."""
    cam = VirtualCamera3D()
    env = VirtualEnvironment3D()
    tgt = TargetGenerator3D(env, size=12, shape=TargetShape.SQUARE)
    patch = tgt.render_spot_patch()

    true_u, true_v = 320.0, 240.0
    frame = cam.render_clean_fpa_frame(true_u, true_v, patch)

    pipeline = DetectionPipeline(ai_confidence_threshold=0.35)
    res = pipeline.detect(frame, ground_truth_u=true_u, ground_truth_v=true_v)

    assert res.detected is True
    assert res.confidence >= 0.40
    assert res.centroid_error_px is not None
    assert res.centroid_error_px <= 0.50, f"Clean centroid error {res.centroid_error_px} > 0.5 px"
    assert res.processing_time_ms < 35.0  # >= 28 FPS


def test_detection_pipeline_salt_and_pepper_noise():
    """Verify pipeline detects beacon under 10% Salt & Pepper noise (rejects noise spikes)."""
    cam = VirtualCamera3D()
    env = VirtualEnvironment3D()
    tgt = TargetGenerator3D(env, size=14, shape=TargetShape.CIRCLE)
    patch = tgt.render_spot_patch()

    true_u, true_v = 380.0, 210.0
    clean_frame = cam.render_clean_fpa_frame(true_u, true_v, patch)

    dist = DisturbanceEngine(seed=42)
    dist.configure(salt_pepper_enabled=True, salt_pepper_density=0.10)
    noisy_frame = dist.apply_salt_and_pepper(clean_frame)

    pipeline = DetectionPipeline(ai_confidence_threshold=0.35)
    res = pipeline.detect(noisy_frame, ground_truth_u=true_u, ground_truth_v=true_v)

    assert res.detected is True
    assert res.centroid_error_px is not None
    assert res.centroid_error_px <= 2.0, f"S&P centroid error {res.centroid_error_px} > 2.0 px"


def test_detection_pipeline_gaussian_noise():
    """Verify pipeline detects beacon under Gaussian noise (SD = 15 px)."""
    cam = VirtualCamera3D()
    env = VirtualEnvironment3D()
    tgt = TargetGenerator3D(env, size=12, shape=TargetShape.SQUARE)
    patch = tgt.render_spot_patch()

    true_u, true_v = 260.0, 290.0
    clean_frame = cam.render_clean_fpa_frame(true_u, true_v, patch)

    dist = DisturbanceEngine(seed=42)
    dist.configure(gaussian_enabled=True, gaussian_std=15.0)
    noisy_frame = dist.apply_gaussian_noise(clean_frame)

    pipeline = DetectionPipeline(ai_confidence_threshold=0.35)
    res = pipeline.detect(noisy_frame, ground_truth_u=true_u, ground_truth_v=true_v)

    assert res.detected is True
    assert res.centroid_error_px is not None
    assert res.centroid_error_px <= 1.5, f"Gaussian centroid error {res.centroid_error_px} > 1.5 px"


def test_detection_pipeline_fog_and_low_contrast():
    """Verify pipeline detects beacon under atmospheric Fog condition."""
    cam = VirtualCamera3D()
    env = VirtualEnvironment3D()
    tgt = TargetGenerator3D(env, size=14, shape=TargetShape.CIRCLE)
    patch = tgt.render_spot_patch()

    true_u, true_v = 320.0, 240.0
    clean_frame = cam.render_clean_fpa_frame(true_u, true_v, patch)

    dist = DisturbanceEngine(seed=42)
    dist.configure(atmosphere=AtmosphereCondition.FOG)
    fog_frame = dist.apply_atmospheric_effects(clean_frame)

    pipeline = DetectionPipeline(ai_confidence_threshold=0.30)
    res = pipeline.detect(fog_frame, ground_truth_u=true_u, ground_truth_v=true_v)

    assert res.detected is True
    assert res.centroid_error_px is not None
    assert res.centroid_error_px <= 2.5

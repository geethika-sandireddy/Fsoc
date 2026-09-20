"""
AI-Assisted Detection & Sub-Pixel Centroiding Engine — ISRO PS-26169.
Architecture:
1. Classical Candidate Generator (Adaptive local threshold + morphology)
2. Lightweight Neural Beacon Validator (CNN scoring ROI candidates under noise)
3. Sub-Pixel Intensity-Weighted Center of Gravity (IW-CoG) Centroiding
4. Centroiding Error & Confidence Evaluation
"""

from __future__ import annotations

import dataclasses
import math
import time
from typing import List, Optional, Tuple
import cv2
import numpy as np

from backend.ai_model import BeaconValidatorEngine


@dataclasses.dataclass
class CandidateROI:
    u_min: int
    v_min: int
    width: int
    height: int
    peak_val: int
    peak_u: int
    peak_v: int
    patch: np.ndarray  # 32x32 uint8 patch

class AdaptivePreprocessor:
    """
    Selects lightweight preprocessing based on observed frame statistics.

    Modes:
    - NORMAL: preserve the existing pipeline behaviour
    - LOW_LIGHT: local contrast enhancement
    - NOISY: stronger denoising
    - LOW_CONTRAST: local contrast enhancement + denoising
    """

    def analyze(self, frame: np.ndarray) -> str:
        if frame.ndim != 2:
            raise ValueError("AdaptivePreprocessor expects a monochrome 2D frame")

        median_intensity = float(np.median(frame))

        # Robust background-noise estimate. Unlike global standard deviation,
        # MAD is much less affected by the bright beacon itself.
        mad_intensity = float(
            np.median(np.abs(frame.astype(np.float32) - median_intensity))
        )

        # Fraction of extreme pixels. Clean frames contain essentially none,
        # while the configured S&P disturbance produces a large fraction.
        extreme_fraction = float(
            np.mean((frame <= 2) | (frame >= 253))
        )

        # Very dark sensor/background regime.
        if median_intensity <= 5.0:
            return "LOW_LIGHT"

        # Impulse noise such as salt-and-pepper.
        if extreme_fraction > 0.05:
            return "NOISY"

        # Strong broadband intensity variation, e.g. Gaussian readout noise.
        if mad_intensity >= 7.0:
            return "NOISY"

        # Reduced-contrast atmospheric conditions such as fog.
                # Atmospheric haze/fog in the simulator raises the background level
        # while remaining below the robust sensor-noise threshold.
        if median_intensity >= 14.0 and mad_intensity < 7.0:
            return "LOW_CONTRAST"
        

        return "NORMAL"

    def apply(self, frame: np.ndarray) -> Tuple[np.ndarray, str]:
        """
        Returns (processed_frame, selected_mode).
        NORMAL intentionally preserves the original frame.
        """
        mode = self.analyze(frame)

        if mode == "NORMAL":
            return frame, mode

        if mode == "NOISY":
            processed = cv2.medianBlur(frame, 3)
            return processed, mode

        if mode == "LOW_LIGHT":
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            processed = clahe.apply(frame)
            return processed, mode

        # LOW_CONTRAST
        denoised = cv2.medianBlur(frame, 3)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        processed = clahe.apply(denoised)
        return processed, mode

@dataclasses.dataclass
class DetectionResult:
    detected: bool
    centroid_u: Optional[float] = None
    centroid_v: Optional[float] = None
    confidence: float = 0.0
    roi_box: Optional[Tuple[int, int, int, int]] = None  # (u, v, w, h)
    peak_val: int = 0
    active_pixels: int = 0
    method: str = "Classical CV + AI Neural Validation"
    processing_time_ms: float = 0.0
    centroid_error_px: Optional[float] = None


class ClassicalCandidateGenerator:
    """
    Rapidly scans the 640x480 FPA frame to isolate up to top-K candidate
    regions of interest (ROIs) of size 32x32 pixels.
    """

    def __init__(
        self,
        threshold_offset: int = 25,
        min_blob_area: int = 3,
        max_candidates: int = 5,
    ) -> None:
        self.threshold_offset = threshold_offset
        self.min_blob_area = min_blob_area
        self.max_candidates = max_candidates

    def extract_candidates(self, frame: np.ndarray) -> List[CandidateROI]:
        """
        Extracts candidate ROIs from 8-bit monochrome frame (640x480).
        """
        h, w = frame.shape[:2]

        # 1. Background baseline estimation via fast downsampled median
        small = frame[::16, ::16]
        bg_mean = float(np.mean(small))
        threshold = int(min(240.0, bg_mean + self.threshold_offset))
        filtered_frame = cv2.medianBlur(frame, 3)

        # 2. Binary thresholding + morphological opening to eliminate isolated noise spikes
        binary = np.empty_like(filtered_frame)
        cv2.threshold(
               filtered_frame,
               threshold,
               255,
              cv2.THRESH_BINARY,
              dst=binary,
)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        # Morphological opening removes 1-pixel S&P noise spikes
        clean_binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

        # 3. Find connected components
        contours, _ = cv2.findContours(clean_binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        candidates: List[CandidateROI] = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < self.min_blob_area:
                continue

            bx, by, bw, bh = cv2.boundingRect(cnt)
            # Find peak inside bounding box
            roi_mask = frame[by : by + bh, bx : bx + bw]
            if roi_mask.size == 0:
                continue
            peak_search = cv2.medianBlur(roi_mask, 3)

            loc_max = np.argmax(peak_search)
            loc_y, loc_x = np.unravel_index(loc_max, peak_search.shape)
            peak_u = bx + loc_x
            peak_v = by + loc_y
            peak_val = int(frame[peak_v, peak_u])

            # Extract 32x32 patch centered at peak
            half = 16
            p_min_u = max(0, peak_u - half)
            p_max_u = min(w, peak_u + half)
            p_min_v = max(0, peak_v - half)
            p_max_v = min(h, peak_v + half)

            patch = np.zeros((32, 32), dtype=np.uint8)
            src = frame[p_min_v:p_max_v, p_min_u:p_max_u]
            dst_u = p_min_u - (peak_u - half)
            dst_v = p_min_v - (peak_v - half)
            patch[dst_v : dst_v + src.shape[0], dst_u : dst_u + src.shape[1]] = src

            candidates.append(
                CandidateROI(
                    u_min=bx,
                    v_min=by,
                    width=bw,
                    height=bh,
                    peak_val=peak_val,
                    peak_u=peak_u,
                    peak_v=peak_v,
                    patch=patch,
                )
            )

        # Sort candidates by peak brightness descending and keep top-K
        candidates.sort(key=lambda c: c.peak_val, reverse=True)
        return candidates[: self.max_candidates]


class SubpixelCentroidEstimator:
    """
    Computes sub-pixel centroid coordinates on candidate blob using
    Intensity-Weighted Center of Gravity (IW-CoG) formulation.
    """

    @staticmethod
    def compute_iw_cog(
        frame: np.ndarray,
        center_u: int,
        center_v: int,
        radius: int = 14,
        threshold: Optional[float] = None,
    ) -> Tuple[Optional[float], Optional[float], int]:
        """
        Evaluates IW-CoG within window [center_u - radius, center_u + radius].
        Returns (centroid_u, centroid_v, active_pixels).
        """
        h, w = frame.shape[:2]
        u_min = max(0, center_u - radius)
        u_max = min(w - 1, center_u + radius)
        v_min = max(0, center_v - radius)
        v_max = min(h - 1, center_v + radius)

        sub = frame[v_min : v_max + 1, u_min : u_max + 1].astype(np.float64)
        if sub.size == 0:
            return None, None, 0

        # Remove isolated salt/pepper noise spikes using a 3x3 median filter before centroiding
        sub_uint8 = np.clip(sub, 0, 255).astype(np.uint8)
        sub_clean = cv2.medianBlur(sub_uint8, 3).astype(np.float64)

        if threshold is None:
            # Automatic background estimate from boundary pixels of the subwindow
            border = np.concatenate([sub_clean[0, :], sub_clean[-1, :], sub_clean[:, 0], sub_clean[:, -1]])
            threshold = float(np.mean(border) + 10.0)

        weights = np.maximum(0.0, sub_clean - threshold)
        weight_sum = float(np.sum(weights))
        active_pixels = int(np.count_nonzero(weights > 0))

        if weight_sum <= 1e-6 or active_pixels < 3:
            return None, None, active_pixels

        v_indices, u_indices = np.mgrid[v_min : v_max + 1, u_min : u_max + 1]
        c_u = float(np.sum(u_indices * weights) / weight_sum)
        c_v = float(np.sum(v_indices * weights) / weight_sum)

        return c_u, c_v, active_pixels

class CandidateScorer:
    """
    Secondary candidate scoring using measurable optical/profile features.

    The CNN remains the primary beacon verifier. This scorer only provides
    additional evidence for ranking candidates that have similar CNN scores.
    """

    @staticmethod
    def optical_score(candidate: CandidateROI) -> float:
        patch = candidate.patch.astype(np.float32)

        background = float(np.median(patch))
        signal = np.maximum(patch - background, 0.0)
        total_signal = float(np.sum(signal))

        if total_signal <= 1e-6:
            return 0.0

        yy, xx = np.indices(patch.shape, dtype=np.float32)
        center_u = 16.0
        center_v = 16.0

        radius = np.sqrt(
            (xx - center_u) ** 2 +
            (yy - center_v) ** 2
        )

        weighted_radius = float(
            np.sum(radius * signal) / total_signal
        )

        active_fraction = float(
            np.mean(patch > background + 10.0)
        )

        # Compact optical spots receive higher score than diffuse regions.
        compactness_score = float(
            np.clip(1.0 - weighted_radius / 12.0, 0.0, 1.0)
        )

        # Keep the feature broad enough to cover the valid 5–20 px beacon size.
        activity_score = float(
            np.clip(active_fraction / 0.30, 0.0, 1.0)
        )

        return float(
            np.clip(
                0.60 * compactness_score +
                0.40 * activity_score,
                0.0,
                1.0,
            )
        )
class DetectionPipeline:
    """
    Complete AI & Computer Vision Detection Pipeline for ISRO PS-26169:
    1. Classical Candidate Generator
    2. Neural Beacon Validator
    3. Sub-pixel IW-CoG Centroid Estimator
    4. Centroiding Error Evaluator
    """

    def __init__(self, ai_confidence_threshold: float = 0.40) -> None:
        self.candidate_generator = ClassicalCandidateGenerator()
        self.ai_validator = BeaconValidatorEngine()
        self.centroid_estimator = SubpixelCentroidEstimator()
        self.preprocessor = AdaptivePreprocessor()
        self.ai_confidence_threshold = ai_confidence_threshold
        self.last_preprocess_mode = "NORMAL"

    def detect(
        self,
        frame: np.ndarray,
        ground_truth_u: Optional[float] = None,
        ground_truth_v: Optional[float] = None,
    ) -> DetectionResult:
        """
        Runs complete detection pipeline on FPA frame.
        """
        t0 = time.perf_counter()

        processed_frame, preprocess_mode = self.preprocessor.apply(frame)
        self.last_preprocess_mode = preprocess_mode
        candidates = self.candidate_generator.extract_candidates(processed_frame)
        if not candidates:
            dt_ms = (time.perf_counter() - t0) * 1000.0
            return DetectionResult(
                detected=False,
                confidence=0.0,
                processing_time_ms=dt_ms,
            )

        best_cand: Optional[CandidateROI] = None
        best_score = -1.0

        for cand in candidates:
            # CNN remains the primary verifier.
            ai_score = self.ai_validator.validate_roi(cand.patch)

            # Optical profile provides a small auxiliary ranking signal.
            optical_score = CandidateScorer.optical_score(cand)

            # Keep the final confidence in [0, 1] while preserving CNN dominance.
            combined_score = (
                0.98 * ai_score +
                0.02 * optical_score
            )

            if combined_score > best_score:
                best_score = combined_score
                best_cand = cand

        if best_cand is None or best_score < self.ai_confidence_threshold:
            dt_ms = (time.perf_counter() - t0) * 1000.0
            return DetectionResult(
                detected=False,
                confidence=float(best_score if best_score >= 0 else 0.0),
                processing_time_ms=dt_ms,
            )

        # Compute sub-pixel IW-CoG centroid on best candidate
        cu, cv, active_px = self.centroid_estimator.compute_iw_cog(
            frame, best_cand.peak_u, best_cand.peak_v, radius=14
        )

        if cu is None or cv is None:
            # Fallback to peak coordinate if IW-CoG fails
            cu, cv = float(best_cand.peak_u), float(best_cand.peak_v)

        # Centroid error against ground truth if supplied
        centroid_err: Optional[float] = None
        if ground_truth_u is not None and ground_truth_v is not None:
            centroid_err = math.sqrt((cu - ground_truth_u) ** 2 + (cv - ground_truth_v) ** 2)

        dt_ms = (time.perf_counter() - t0) * 1000.0

        return DetectionResult(
            detected=True,
            centroid_u=round(cu, 3),
            centroid_v=round(cv, 3),
            confidence=round(best_score, 3),
            roi_box=(best_cand.u_min, best_cand.v_min, best_cand.width, best_cand.height),
            peak_val=best_cand.peak_val,
            active_pixels=active_px,
            processing_time_ms=round(dt_ms, 2),
            centroid_error_px=round(centroid_err, 3) if centroid_err is not None else None,
        )

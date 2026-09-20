"""
Phase 12 - Backend Closed-Loop FSOC Simulation
ISRO PS-26169

Target -> 3D Camera -> Disturbance -> Sensor Frame
-> Detection -> Tracking -> Predictive Controller -> Gimbal
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from turtle import mode

import numpy as np

from backend import disturbance, target
from backend.camera_3d import VirtualCamera3D
from backend.detection import DetectionPipeline
from backend.disturbance import (
    AtmosphereCondition,
    DisturbanceEngine,
    NoiseConfig,
)
from backend.environment_3d import VirtualEnvironment3D
from backend.target_3d import TargetGenerator3D, TargetMotionMode3D
from backend.tracking import CoarseTrackingAutomaton
from backend.controller import PredictiveLockRiskController


@dataclass
class SimulationMetrics:
    frames: int = 0
    detected_frames: int = 0
    locked_frames: int = 0
    pointing_error_sum: float = 0.0
    pointing_error_count: int = 0
    centroid_error_sum: float = 0.0
    centroid_error_count: int = 0
    detector_time_sum_ms: float = 0.0
    controller_slew_limited_frames: int = 0
    controller_risk_active_frames: int = 0
    controller_active_frames: int = 0
    preprocess_normal_frames: int = 0
    preprocess_noisy_frames: int = 0
    preprocess_low_contrast_frames: int = 0
    preprocess_low_light_frames: int = 0
    start_wall_time: float = 0.0
    end_wall_time: float = 0.0
    def record_controller(self, control) -> None:
       if control is None:
        return

       self.controller_active_frames += 1

       if control.is_slew_limited:
        self.controller_slew_limited_frames += 1
       if control.risk_score > 0.35:
        self.controller_risk_active_frames += 1

    def record_preprocess_mode(self, mode: str) -> None:
        if mode == "NORMAL":
            self.preprocess_normal_frames += 1
        elif mode == "NOISY":
            self.preprocess_noisy_frames += 1
        elif mode == "LOW_CONTRAST":
            self.preprocess_low_contrast_frames += 1
        elif mode == "LOW_LIGHT":
            self.preprocess_low_light_frames += 1



    def record(self, detection, tracking) -> None:
        self.frames += 1

        if detection.detected:
            self.detected_frames += 1

        if tracking.is_locked:
            self.locked_frames += 1

        if tracking.instantaneous_pointing_error_px is not None:
            self.pointing_error_sum += tracking.instantaneous_pointing_error_px
            self.pointing_error_count += 1

        if detection.centroid_error_px is not None:
            self.centroid_error_sum += detection.centroid_error_px
            self.centroid_error_count += 1

        self.detector_time_sum_ms += detection.processing_time_ms

    @property
    def detection_rate_pct(self) -> float:
        if self.frames == 0:
            return 0.0
        return 100.0 * self.detected_frames / self.frames

    @property
    def lock_rate_pct(self) -> float:
        if self.frames == 0:
            return 0.0
        return 100.0 * self.locked_frames / self.frames

    @property
    def mean_pointing_error_px(self) -> float:
        if self.pointing_error_count == 0:
            return 0.0
        return self.pointing_error_sum / self.pointing_error_count

    @property
    def mean_centroid_error_px(self) -> float:
        if self.centroid_error_count == 0:
            return 0.0
        return self.centroid_error_sum / self.centroid_error_count

    @property
    def mean_detector_time_ms(self) -> float:
        if self.frames == 0:
            return 0.0
        return self.detector_time_sum_ms / self.frames

    @property
    def wall_fps(self) -> float:
        elapsed = self.end_wall_time - self.start_wall_time
        if elapsed <= 0.0:
            return 0.0
        return self.frames / elapsed


def build_simulation():
    environment = VirtualEnvironment3D(
        size_x=2000.0,
        size_y=2000.0,
        size_z=2000.0,
    )

    camera = VirtualCamera3D(
        resolution_width=640,
        resolution_height=480,
        fov_h_deg=4.0,
        fov_v_deg=3.0,
        update_rate_hz=30.0,
        max_pan_speed_dps=5.0,
        max_tilt_speed_dps=5.0,
    )

    target = TargetGenerator3D(
    environment=environment,
    motion_mode=TargetMotionMode3D.FIGURE_OF_EIGHT,
    size=10,
    speed=35.0,
    seed=26169,
)

    target.reset(initial_pos=(20.0, 800.0, 10.0))

    disturbance = DisturbanceEngine(seed=26169)

    disturbance.configure(
    salt_pepper_enabled=True,
    salt_pepper_density=0.02,
    gaussian_enabled=True,
    gaussian_std=3.0,
    poisson_enabled=True,
    jitter_enabled=True,
    jitter_amplitude_px=2.0,
    atmosphere=AtmosphereCondition.CLEAR,
    platform_motion_enabled=True,
    platform_motion_amplitude_px=2.0,
)
    detector = DetectionPipeline(
        ai_confidence_threshold=0.40,
    )

    tracker = CoarseTrackingAutomaton(
        hits_for_lock=5,
        misses_for_loss=10,
        center_u=320.0,
        center_v=240.0,
    )

    controller = PredictiveLockRiskController(
        max_pan_speed_dps=5.0,
        max_tilt_speed_dps=5.0,
        fov_h_deg=4.0,
        fov_v_deg=3.0,
        width=640,
        height=480,
       lead_gain=0.0,
    )

    return (
        environment,
        camera,
        target,
        disturbance,
        detector,
        tracker,
        controller,
    )


def run_simulation(
    duration_sec: float = 10.0,
    dt: float = 1.0 / 30.0,
):
    (
        environment,
        camera,
        target,
        disturbance,
        detector,
        tracker,
        controller,
    ) = build_simulation()

    metrics = SimulationMetrics()
    metrics.start_wall_time = time.perf_counter()

    sim_time = 0.0

    while sim_time < duration_sec:
        # ---------------------------------------------------------
        # 1. Update beacon trajectory
        # ---------------------------------------------------------
        target_state = target.update(
            dt=dt,
            sim_time=sim_time,
        )

        # ---------------------------------------------------------
        # 2. Project target through the current camera orientation
        # ---------------------------------------------------------
        projection = camera.project_world_to_sensor(
            target_state.x,
            target_state.y,
            target_state.z,
        )

        # ---------------------------------------------------------
        # 3. Apply coordinate-level disturbances once.
        #    We intentionally do not call apply_platform_motion_shift()
        #    here because coordinate disturbances already include
        #    platform motion.
        # ---------------------------------------------------------
        disturbed_u, disturbed_v = disturbance.apply_coordinate_disturbances(
            projection.sensor_u,
            projection.sensor_v,
            dt,
        )

        # ---------------------------------------------------------
        # 4. Render actual monochrome sensor frame
        # ---------------------------------------------------------
        frame = camera.render_clean_fpa_frame(
            proj_u=disturbed_u,
            proj_v=disturbed_v,
            spot_patch=target.render_spot_patch(),
            env=environment,
        )

        # ---------------------------------------------------------
        # 5. Apply sensor/image disturbances
        # ---------------------------------------------------------
        frame = disturbance.apply_all(frame)

        frame = np.clip(frame, 0, 255).astype(np.uint8)

        # ---------------------------------------------------------
        # 6. Run actual CV + CNN + centroid detector
        #
        # Ground truth is supplied only for post-detection
        # centroid-error measurement.
        # ---------------------------------------------------------
        detection = detector.detect(
            frame,
            ground_truth_u=disturbed_u,
            ground_truth_v=disturbed_v,
        )

        metrics.record_preprocess_mode(
            detector.last_preprocess_mode
        )

        # ---------------------------------------------------------
        # 7. Update tracking state machine
        # ---------------------------------------------------------
        tracking = tracker.update(
            detection=detection,
            dt=dt,
            sim_time=sim_time,
        )

        # ---------------------------------------------------------
        # 8. Closed-loop controller
        # ---------------------------------------------------------
        if detection.detected:
            control = controller.compute_slew(
                centroid_u=detection.centroid_u,
                centroid_v=detection.centroid_v,
                dt=dt,
            )
            metrics.record_controller(control)

            camera.command_slew(
                delta_pan_deg=control.delta_pan_deg,
                delta_tilt_deg=control.delta_tilt_deg,
            )

        # ---------------------------------------------------------
        # 9. Apply gimbal dynamics
        # ---------------------------------------------------------
        camera.update_gimbal(dt)

        # ---------------------------------------------------------
        # 10. Metrics
        # ---------------------------------------------------------
        metrics.record(
            detection=detection,
            tracking=tracking,
        )

        sim_time += dt

    metrics.end_wall_time = time.perf_counter()

    return metrics, tracker


def main():
    metrics, tracker = run_simulation(
        duration_sec=10.0,
        dt=1.0 / 30.0,
    )

    print("\n=== PHASE 12 CLOSED-LOOP BENCHMARK ===")
    print(f"Frames:                 {metrics.frames}")
    print(f"Detection rate:         {metrics.detection_rate_pct:.2f}%")
    print(f"Lock-frame rate:        {metrics.lock_rate_pct:.2f}%")
    print(f"Mean pointing error:    {metrics.mean_pointing_error_px:.2f} px")
    print(f"Mean centroid error:    {metrics.mean_centroid_error_px:.2f} px")
    print(f"Mean detector time:     {metrics.mean_detector_time_ms:.2f} ms")
    print(
        f"Preprocess modes:        "
        f"NORMAL={metrics.preprocess_normal_frames}, "
        f"NOISY={metrics.preprocess_noisy_frames}, "
        f"LOW_CONTRAST={metrics.preprocess_low_contrast_frames}, "
        f"LOW_LIGHT={metrics.preprocess_low_light_frames}"
    )
  

    print("\n=== TRACKING STATE ===")
    print(f"Final state:            {tracker.state.value}")
    print(f"Acquisition time:       {tracker.acquisition_time}")
    print(f"Re-acquisition time:    {tracker.reacquisition_time}")
    print(f"Lock retention:         {tracker.update.__name__ and 'see final status'}")


if __name__ == "__main__":
    main()
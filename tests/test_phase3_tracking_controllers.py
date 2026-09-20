"""
Automated Unit & Comparative Benchmark Test Suite for Phase 3:
Coarse Tracking Automaton, Trajectory State Estimator &
Reactive Baseline vs. Predictive Lock-Risk Controller Experiment.
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

from backend.tracking import CoarseTrackingAutomaton, TrackingState
from backend.detection import DetectionResult
from backend.predictor import (
    TrajectoryStateEstimator,
    KalmanStateEstimator2D,
    LockRiskEvaluator,
)
from backend.controller import ReactiveBaselineController, PredictiveLockRiskController
from backend.environment_3d import VirtualEnvironment3D
from backend.target_3d import TargetGenerator3D, TargetMotionMode3D
from backend.camera_3d import VirtualCamera3D


# =========================================================================
# 1. 6-State Coarse PAT Automaton Tests
# =========================================================================

def test_tracking_automaton_transitions_and_timers():
    """Verify state transitions: SEARCHING -> DETECTED -> ACQUIRING -> LOCKED -> LOST -> RE_ACQUIRING."""
    automaton = CoarseTrackingAutomaton(hits_for_lock=5, misses_for_loss=10)
    automaton.reset()
    assert automaton.state == TrackingState.SEARCHING

    dt = 0.05  # 20 Hz
    sim_time = 0.0

    # Frame 1: Hit -> DETECTED
    sim_time += dt
    st = automaton.update(DetectionResult(detected=True, centroid_u=325.0, centroid_v=242.0), dt=dt, sim_time=sim_time)
    assert st.state == TrackingState.DETECTED
    assert st.acquisition_time_sec is None

    # Frame 2: Hit -> ACQUIRING
    sim_time += dt
    st = automaton.update(DetectionResult(detected=True, centroid_u=324.0, centroid_v=241.0), dt=dt, sim_time=sim_time)
    assert st.state == TrackingState.ACQUIRING

    # Frames 3, 4, 5: Consecutive hits -> LOCKED
    for _ in range(3):
        sim_time += dt
        st = automaton.update(DetectionResult(detected=True, centroid_u=322.0, centroid_v=240.5), dt=dt, sim_time=sim_time)

    assert st.state == TrackingState.LOCKED
    assert st.is_locked is True
    assert st.acquisition_time_sec is not None
    assert st.acquisition_time_sec <= 2.0  # PS-26169 acceptance criterion <= 2.0 s

    # 10 Consecutive misses -> LOST
    for _ in range(10):
        sim_time += dt
        st = automaton.update(DetectionResult(detected=False), dt=dt, sim_time=sim_time)

    assert st.state == TrackingState.LOST
    assert st.is_locked is False

    # Hits while LOST -> RE_ACQUIRING -> LOCKED
    sim_time += dt
    st = automaton.update(DetectionResult(detected=True, centroid_u=320.0, centroid_v=240.0), dt=dt, sim_time=sim_time)
    assert st.state == TrackingState.RE_ACQUIRING

    for _ in range(4):
        sim_time += dt
        st = automaton.update(DetectionResult(detected=True, centroid_u=320.0, centroid_v=240.0), dt=dt, sim_time=sim_time)

    assert st.state == TrackingState.LOCKED
    assert st.reacquisition_time_sec is not None
    assert st.reacquisition_time_sec <= 1.0  # PS-26169 acceptance criterion <= 1.0 s


# =========================================================================
# 2. State Estimator & Lock-Risk Evaluator Tests
# =========================================================================

def test_trajectory_state_estimator_velocity_tracking():
    """Verify state estimator tracks velocity of a moving optical beacon."""
    est = TrajectoryStateEstimator()
    dt = 0.05
    true_vu = 40.0  # px/s
    cur_u = 200.0

    for _ in range(25):
        cur_u += true_vu * dt
        state = est.update(meas_u=cur_u, meas_v=240.0, dt=dt)

    assert state.is_valid is True
    # Velocity converges near true velocity 40 px/s
    assert math.isclose(state.vu, true_vu, abs_tol=5.0)


def test_lock_risk_evaluator_boundary_warning():
    """Verify lock risk increases as target nears FOV margin."""
    est = TrajectoryStateEstimator()
    risk_eval = LockRiskEvaluator(width=640, height=480, margin_px=40.0)

    # Centered state -> Low risk
    state_center = est.update(meas_u=320.0, meas_v=240.0, dt=0.05)
    risk_low = risk_eval.evaluate_risk(state_center)
    assert risk_low.risk_score < 0.20
    assert risk_low.is_critical is False

    # Edge state moving outward fast -> High risk
    state_edge = est.update(meas_u=600.0, meas_v=240.0, dt=0.05)
    state_edge.vu = 80.0  # Moving further outward
    risk_high = risk_eval.evaluate_risk(state_edge)
    assert risk_high.risk_score > 0.70
    assert risk_high.suggested_lead_u_deg != 0.0


# =========================================================================
# 3. Kinematic Slew-Rate Limiting Tests
# =========================================================================

def test_slew_rate_limiter_strict_compliance():
    """Verify BOTH controllers strictly cap pan/tilt slew rates to 5.0 deg/s."""
    dt = 0.05  # 20 Hz
    max_allowable_step = 5.0 * dt  # 0.25 deg

    # Test Reactive Baseline
    baseline = ReactiveBaselineController(max_pan_speed_dps=5.0, max_tilt_speed_dps=5.0)
    # Huge offset: Centroid at corner (640, 480)
    out_b = baseline.compute_slew(centroid_u=640.0, centroid_v=480.0, dt=dt)
    assert abs(out_b.delta_pan_deg) <= max_allowable_step + 1e-6
    assert abs(out_b.delta_tilt_deg) <= max_allowable_step + 1e-6
    assert out_b.is_slew_limited is True

    # Test Predictive Lock-Risk
    predictive = PredictiveLockRiskController(max_pan_speed_dps=5.0, max_tilt_speed_dps=5.0)
    out_p = predictive.compute_slew(centroid_u=640.0, centroid_v=480.0, dt=dt)
    assert abs(out_p.delta_pan_deg) <= max_allowable_step + 1e-6
    assert abs(out_p.delta_tilt_deg) <= max_allowable_step + 1e-6
    assert out_p.is_slew_limited is True



def test_kalman_state_estimator_velocity_tracking():
    """Verify Kalman estimator tracks a constant-velocity beacon."""
    est = KalmanStateEstimator2D(
        measurement_std_px=1.5,
        process_accel_std_px_s2=20.0,
    )

    dt = 0.05
    true_vu = 40.0
    cur_u = 200.0

    for _ in range(80):
        cur_u += true_vu * dt
        state = est.update(
            meas_u=cur_u,
            meas_v=240.0,
            dt=dt,
        )

    assert state.is_valid is True
    assert math.isfinite(state.u)
    assert math.isfinite(state.v)
    assert math.isfinite(state.vu)
    assert math.isfinite(state.vv)
    assert math.isclose(state.vu, true_vu, abs_tol=5.0)

# =========================================================================
# 4. Comparative Closed-Loop Simulation: Baseline vs. Predictive Controller
# =========================================================================

def test_closed_loop_comparative_experiment():
    """
    Runs side-by-side closed-loop tracking simulation on 3D Figure-of-8 trajectory.
    Compares Reactive Baseline vs. Predictive Lock-Risk Controller.
    Verifies that both controllers achieve coarse pointing and records comparative metrics.
    """
    env = VirtualEnvironment3D()
    dt = 0.05  # 20 Hz
    sim_duration = 10.0  # 10 seconds simulation = 200 steps
    steps = int(sim_duration / dt)

    def run_simulation(controller_type: str):
        cam = VirtualCamera3D(max_pan_speed_dps=5.0, max_tilt_speed_dps=5.0)
        tgt = TargetGenerator3D(env, motion_mode=TargetMotionMode3D.FIGURE_OF_EIGHT, speed=20.0, seed=42)
        tgt.reset(initial_pos=(5.0, 800.0, 3.0))
        cam.reset(pan_deg=0.0, tilt_deg=0.0)

        automaton = CoarseTrackingAutomaton(center_u=320.0, center_v=240.0)
        ctrl = (
            ReactiveBaselineController(max_pan_speed_dps=5.0, max_tilt_speed_dps=5.0)
            if controller_type == "baseline"
            else PredictiveLockRiskController(max_pan_speed_dps=5.0, max_tilt_speed_dps=5.0)
        )

        pointing_errors = []
        lock_count = 0

        for step in range(steps):
            t = step * dt
            # 1. Update 3D target
            tgt_state = tgt.update(dt=dt, sim_time=t)

            # 2. Camera Projection onto 640x480 sensor
            proj = cam.project_world_to_sensor(tgt_state.x, tgt_state.y, tgt_state.z)

            # 3. Detection result
            det = DetectionResult(
                detected=proj.in_fov,
                centroid_u=proj.sensor_u if proj.in_fov else None,
                centroid_v=proj.sensor_v if proj.in_fov else None,
            )

            # 4. Automaton update
            st = automaton.update(det, dt=dt, sim_time=t)
            if st.is_locked:
                lock_count += 1
            if proj.in_fov and proj.sensor_u is not None and proj.sensor_v is not None:
                p_err = math.sqrt((proj.sensor_u - 320.0) ** 2 + (proj.sensor_v - 240.0) ** 2)
                pointing_errors.append(p_err)

            # 5. Controller slew command
            cmd = ctrl.compute_slew(det.centroid_u, det.centroid_v, dt=dt)

            # 6. Apply slew to camera gimbal with rate limiting
            cam.command_slew(cmd.delta_pan_deg, cmd.delta_tilt_deg)
            cam.update_gimbal(dt=dt)

        rmse = math.sqrt(float(np.mean(np.array(pointing_errors) ** 2))) if pointing_errors else 999.0
        lock_pct = (lock_count / float(steps)) * 100.0

        return {
            "rmse": rmse,
            "lock_retention": lock_pct,
            "acquisition_time": automaton.acquisition_time,
            "final_pointing_error": pointing_errors[-1] if pointing_errors else 999.0,
        }

    res_baseline = run_simulation("baseline")
    res_predictive = run_simulation("predictive")

    print(f"\n[BENCHMARK] Reactive Baseline:   RMSE={res_baseline['rmse']:.2f} px, Lock={res_baseline['lock_retention']:.1f}%")
    print(f"[BENCHMARK] Predictive Lock-Risk: RMSE={res_predictive['rmse']:.2f} px, Lock={res_predictive['lock_retention']:.1f}%")

    # Both must achieve valid coarse pointing
    assert res_baseline["lock_retention"] >= 80.0
    assert res_predictive["lock_retention"] >= 85.0
    assert res_predictive["rmse"] <= 25.0

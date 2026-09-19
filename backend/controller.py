"""
Closed-Loop Pan/Tilt Controllers — ISRO PS-26169.
Implements:
1. ReactiveBaselineController: Standard proportional tracking servo
2. PredictiveLockRiskController: State-estimated lead-compensated risk-avoidance servo
Both controllers strictly enforce PS-26169 Pan/Tilt slew limits (5-10 °/s, default 5.0 °/s)
at control update intervals >= 20 Hz (<= 50 ms).
"""

from __future__ import annotations

import dataclasses
import math
from typing import Optional, Tuple
from backend.predictor import TrajectoryStateEstimator, LockRiskEvaluator, LockRiskAssessment


@dataclasses.dataclass
class ControllerOutput:
    delta_pan_deg: float
    delta_tilt_deg: float
    pan_rate_dps: float
    tilt_rate_dps: float
    is_slew_limited: bool
    risk_score: float = 0.0


class ReactiveBaselineController:
    """
    Standard proportional feedback controller.
    Directly converts detected pixel offset from boresight (320, 240) to Pan/Tilt rates.
    Strictly clamps output to maximum slew speed (default 5.0 °/s).
    """

    def __init__(
        self,
        max_pan_speed_dps: float = 5.0,
        max_tilt_speed_dps: float = 5.0,
        fov_h_deg: float = 4.0,
        fov_v_deg: float = 3.0,
        width: int = 640,
        height: int = 480,
        kp: float = 0.85,
    ) -> None:
        self.max_pan_speed = max(5.0, min(10.0, float(max_pan_speed_dps)))
        self.max_tilt_speed = max(5.0, min(10.0, float(max_tilt_speed_dps)))
        self.fov_h = fov_h_deg
        self.fov_v = fov_v_deg
        self.cx = width / 2.0
        self.cy = height / 2.0
        self.kp = kp

        self.deg_per_px_u = self.fov_h / float(width)
        self.deg_per_px_v = self.fov_v / float(height)

    def reset(self) -> None:
        pass

    def compute_slew(
        self,
        centroid_u: Optional[float],
        centroid_v: Optional[float],
        dt: float,
    ) -> ControllerOutput:
        """Computes pan and tilt slew increments for time step dt."""
        if centroid_u is None or centroid_v is None:
            return ControllerOutput(0.0, 0.0, 0.0, 0.0, False, 0.0)

        dt = max(0.001, float(dt))
        max_pan_step = self.max_pan_speed * dt
        max_tilt_step = self.max_tilt_speed * dt

        # Pixel error relative to boresight
        err_u = centroid_u - self.cx
        err_v = centroid_v - self.cy

        # Desired angular correction
        desired_pan = self.kp * (err_u * self.deg_per_px_u)
        desired_tilt = -self.kp * (err_v * self.deg_per_px_v)  # Inverted image vertical

        # Slew rate clamping
        pan_step = max(-max_pan_step, min(max_pan_step, desired_pan))
        tilt_step = max(-max_tilt_step, min(max_tilt_step, desired_tilt))

        is_limited = (abs(pan_step) >= max_pan_step - 1e-6) or (abs(tilt_step) >= max_tilt_step - 1e-6)

        return ControllerOutput(
            delta_pan_deg=pan_step,
            delta_tilt_deg=tilt_step,
            pan_rate_dps=abs(pan_step) / dt,
            tilt_rate_dps=abs(tilt_step) / dt,
            is_slew_limited=is_limited,
            risk_score=0.0,
        )


class PredictiveLockRiskController:
    """
    Predictive Lock-Risk Controller (Algorithmic Innovation).
    Fuses state estimation, horizon prediction, and dynamic Lock-Risk evaluation.
    Pre-emptively slews the gimbal in the direction of velocity escape to avoid boundary loss.
    Strictly clamps output to maximum slew speed (default 5.0 °/s).
    """

    def __init__(
        self,
        max_pan_speed_dps: float = 5.0,
        max_tilt_speed_dps: float = 5.0,
        fov_h_deg: float = 4.0,
        fov_v_deg: float = 3.0,
        width: int = 640,
        height: int = 480,
        kp: float = 0.85,
        lead_gain: float = 0.75,
    ) -> None:
        self.max_pan_speed = max(5.0, min(10.0, float(max_pan_speed_dps)))
        self.max_tilt_speed = max(5.0, min(10.0, float(max_tilt_speed_dps)))
        self.fov_h = fov_h_deg
        self.fov_v = fov_v_deg
        self.cx = width / 2.0
        self.cy = height / 2.0
        self.kp = kp
        self.lead_gain = lead_gain

        self.deg_per_px_u = self.fov_h / float(width)
        self.deg_per_px_v = self.fov_v / float(height)

        self.estimator = TrajectoryStateEstimator()
        self.risk_evaluator = LockRiskEvaluator(
            width=width, height=height, fov_h_deg=fov_h_deg, fov_v_deg=fov_v_deg
        )

    def reset(self) -> None:
        self.estimator.reset()

    def compute_slew(
        self,
        centroid_u: Optional[float],
        centroid_v: Optional[float],
        dt: float,
    ) -> ControllerOutput:
        """Computes lead-compensated pan and tilt slew increments."""
        dt = max(0.001, float(dt))
        max_pan_step = self.max_pan_speed * dt
        max_tilt_step = self.max_tilt_speed * dt

        # Update kinematic state estimator
        state = self.estimator.update(centroid_u, centroid_v, dt=dt)
        risk_assess = self.risk_evaluator.evaluate_risk(state)

        if not state.is_valid:
            return ControllerOutput(0.0, 0.0, 0.0, 0.0, False, 0.0)

        # Baseline proportional term on estimated state
        err_u = state.u - self.cx
        err_v = state.v - self.cy
        base_pan = self.kp * (err_u * self.deg_per_px_u)
        base_tilt = -self.kp * (err_v * self.deg_per_px_v)

        # Predictive lead compensation term
        lead_pan = self.lead_gain * risk_assess.suggested_lead_u_deg
        lead_tilt = self.lead_gain * risk_assess.suggested_lead_v_deg

        # Total commanded slew
        total_pan = base_pan + lead_pan
        total_tilt = base_tilt + lead_tilt

        # Strict slew rate clamping to 5.0 °/s
        pan_step = max(-max_pan_step, min(max_pan_step, total_pan))
        tilt_step = max(-max_tilt_step, min(max_tilt_step, total_tilt))

        is_limited = (abs(pan_step) >= max_pan_step - 1e-6) or (abs(tilt_step) >= max_tilt_step - 1e-6)

        return ControllerOutput(
            delta_pan_deg=pan_step,
            delta_tilt_deg=tilt_step,
            pan_rate_dps=abs(pan_step) / dt,
            tilt_rate_dps=abs(tilt_step) / dt,
            is_slew_limited=is_limited,
            risk_score=risk_assess.risk_score,
        )

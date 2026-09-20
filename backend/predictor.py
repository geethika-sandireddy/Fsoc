"""
Trajectory State Estimator & Predictive Lock-Risk Engine — ISRO PS-26169.
Implements:
1. Alpha-Beta-Gamma State Estimator (Position, Velocity, Acceleration on FPA)
2. N-Step Lookahead Horizon Prediction
3. Dynamic Lock-Risk Metric R in [0, 1] evaluating FOV boundary escape hazard
"""

from __future__ import annotations

import dataclasses
import math
from typing import Optional, Tuple


@dataclasses.dataclass
class StateEstimate2D:
    u: float
    v: float
    vu: float = 0.0
    vv: float = 0.0
    au: float = 0.0
    av: float = 0.0
    is_valid: bool = False


@dataclasses.dataclass
class LockRiskAssessment:
    risk_score: float  # [0.0, 1.0]
    predicted_u: float
    predicted_v: float
    lookahead_sec: float
    is_critical: bool  # True if risk > 0.65
    suggested_lead_u_deg: float
    suggested_lead_v_deg: float


class TrajectoryStateEstimator:
    """
    Alpha-Beta-Gamma filter tracking optical beacon kinematic state on the 640x480 FPA.
    Equations:
        x_pred = x + v * dt + 0.5 * a * dt^2
        v_pred = v + a * dt
        a_pred = a

        residual = z - x_pred
        x = x_pred + alpha * residual
        v = v_pred + (beta / dt) * residual
        a = a_pred + (2 * gamma / dt^2) * residual
    """

    def __init__(
        self,
        alpha: float = 0.70,
        beta: float = 0.40,
        gamma: float = 0.15,
    ) -> None:
        self.alpha = alpha
        self.beta = beta
        self.gamma = gamma

        self.u = 320.0
        self.v = 240.0
        self.vu = 0.0
        self.vv = 0.0
        self.au = 0.0
        self.av = 0.0
        self.initialized = False

    def reset(self) -> None:
        self.u = 320.0
        self.v = 240.0
        self.vu = 0.0
        self.vv = 0.0
        self.au = 0.0
        self.av = 0.0
        self.initialized = False

    def update(
        self,
        meas_u: Optional[float],
        meas_v: Optional[float],
        dt: float,
    ) -> StateEstimate2D:
        """Updates kinematic state given measurement (meas_u, meas_v)."""
        dt = max(0.001, float(dt))

        # Prediction step
        u_pred = self.u + self.vu * dt + 0.5 * self.au * (dt ** 2)
        v_pred = self.v + self.vv * dt + 0.5 * self.av * (dt ** 2)
        vu_pred = self.vu + self.au * dt
        vv_pred = self.vv + self.av * dt
        au_pred = self.au
        av_pred = self.av

        if meas_u is not None and meas_v is not None:
            if not self.initialized:
                # First observation
                self.u = meas_u
                self.v = meas_v
                self.vu = 0.0
                self.vv = 0.0
                self.au = 0.0
                self.av = 0.0
                self.initialized = True
            else:
                # Correction step
                res_u = meas_u - u_pred
                res_v = meas_v - v_pred

                self.u = u_pred + self.alpha * res_u
                self.v = v_pred + self.alpha * res_v
                self.vu = vu_pred + (self.beta / dt) * res_u
                self.vv = vv_pred + (self.beta / dt) * res_v
                self.au = au_pred + (2.0 * self.gamma / (dt ** 2)) * res_u
                self.av = av_pred + (2.0 * self.gamma / (dt ** 2)) * res_v
        else:
            # Coast along prediction if no measurement
            self.u = u_pred
            self.v = v_pred
            self.vu = vu_pred * 0.95  # gentle damping
            self.vv = vv_pred * 0.95
            self.au = au_pred * 0.90
            self.av = av_pred * 0.90

        return StateEstimate2D(
            u=self.u,
            v=self.v,
            vu=self.vu,
            vv=self.vv,
            au=self.au,
            av=self.av,
            is_valid=self.initialized,
        )

class KalmanStateEstimator2D:
    """
    Constant-acceleration Kalman filter for 2D FPA beacon tracking.

    State:
        [u, v, vu, vv, au, av]

    Measurement:
        [u, v]

    This is maintained separately from the Alpha-Beta-Gamma estimator
    so both estimators can be benchmarked without changing the existing
    prediction/risk pipeline.
    """

    def __init__(
        self,
        measurement_std_px: float = 2.0,
        process_accel_std_px_s2: float = 40.0,
    ) -> None:
        self.measurement_std = float(measurement_std_px)
        self.process_accel_std = float(process_accel_std_px_s2)

        self.x = None
        self.P = None
        self.initialized = False

    def reset(self) -> None:
        self.x = None
        self.P = None
        self.initialized = False

    def _transition_matrix(self, dt: float):
        dt2 = dt * dt

        return [
            [1.0, 0.0, dt, 0.0, 0.5 * dt2, 0.0],
            [0.0, 1.0, 0.0, dt, 0.0, 0.5 * dt2],
            [0.0, 0.0, 1.0, 0.0, dt, 0.0],
            [0.0, 0.0, 0.0, 1.0, 0.0, dt],
            [0.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 0.0, 0.0, 1.0],
        ]

    def update(
        self,
        meas_u: Optional[float],
        meas_v: Optional[float],
        dt: float,
    ) -> StateEstimate2D:
        import numpy as np

        dt = max(0.001, float(dt))
        F = np.asarray(self._transition_matrix(dt), dtype=float)

        # Process noise: white acceleration model.
        q = self.process_accel_std ** 2
        dt2 = dt * dt
        dt3 = dt2 * dt
        dt4 = dt3 * dt

        Q = np.zeros((6, 6), dtype=float)

        # Position/velocity/acceleration coupling for each axis.
        q_block = q * np.array(
            [
                [dt4 / 4.0, dt3 / 2.0, dt2 / 2.0],
                [dt3 / 2.0, dt2, dt],
                [dt2 / 2.0, dt, 1.0],
            ],
            dtype=float,
        )

        Q[np.ix_([0, 2, 4], [0, 2, 4])] = q_block
        Q[np.ix_([1, 3, 5], [1, 3, 5])] = q_block

        R = np.diag(
            [
                self.measurement_std ** 2,
                self.measurement_std ** 2,
            ]
        )

        H = np.asarray(
            [
                [1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0, 0.0, 0.0],
            ],
            dtype=float,
        )

        # First valid measurement initializes position.
        if not self.initialized:
            if meas_u is None or meas_v is None:
                return StateEstimate2D(
                    u=320.0,
                    v=240.0,
                    is_valid=False,
                )

            self.x = np.asarray(
                [float(meas_u), float(meas_v), 0.0, 0.0, 0.0, 0.0],
                dtype=float,
            )

            self.P = np.diag(
                [
                    4.0,
                    4.0,
                    400.0,
                    400.0,
                    1600.0,
                    1600.0,
                ]
            )

            self.initialized = True

        else:
            # Prediction.
            self.x = F @ self.x
            self.P = F @ self.P @ F.T + Q

            # Measurement update when detection is available.
            if meas_u is not None and meas_v is not None:
                z = np.asarray(
                    [float(meas_u), float(meas_v)],
                    dtype=float,
                )

                innovation = z - H @ self.x
                S = H @ self.P @ H.T + R
                K = self.P @ H.T @ np.linalg.inv(S)

                self.x = self.x + K @ innovation

                identity = np.eye(6)
                self.P = (identity - K @ H) @ self.P

        return StateEstimate2D(
            u=float(self.x[0]),
            v=float(self.x[1]),
            vu=float(self.x[2]),
            vv=float(self.x[3]),
            au=float(self.x[4]),
            av=float(self.x[5]),
            is_valid=self.initialized,
        )

class LockRiskEvaluator:
    """
    Evaluates dynamic risk of target escaping the 4°x3° FOV boundary.
    Computes lookahead trajectory horizon and pre-emptive lead compensation.
    """

    def __init__(
        self,
        width: int = 640,
        height: int = 480,
        fov_h_deg: float = 4.0,
        fov_v_deg: float = 3.0,
        margin_px: float = 40.0,
        lookahead_sec: float = 0.20,  # 4 frames ahead @ 20 Hz
    ) -> None:
        self.width = width
        self.height = height
        self.cx = width / 2.0
        self.cy = height / 2.0
        self.fov_h = fov_h_deg
        self.fov_v = fov_v_deg
        self.margin = margin_px
        self.lookahead_sec = lookahead_sec

        # Pixel to angle scale factors
        self.deg_per_px_u = self.fov_h / float(self.width)
        self.deg_per_px_v = self.fov_v / float(self.height)

    def evaluate_risk(self, state: StateEstimate2D) -> LockRiskAssessment:
        """
        Assesses lock loss risk given current state estimate.
        Returns LockRiskAssessment containing score in [0.0, 1.0] and lead corrections.
        """
        if not state.is_valid:
            return LockRiskAssessment(
                risk_score=0.0,
                predicted_u=self.cx,
                predicted_v=self.cy,
                lookahead_sec=self.lookahead_sec,
                is_critical=False,
                suggested_lead_u_deg=0.0,
                suggested_lead_v_deg=0.0,
            )

        t_h = self.lookahead_sec
        # Forward lookahead prediction
        pred_u = state.u + state.vu * t_h + 0.5 * state.au * (t_h ** 2)
        pred_v = state.v + state.vv * t_h + 0.5 * state.av * (t_h ** 2)

        # Distance from center normalized to boundary margin
        half_w_eff = (self.width / 2.0) - self.margin
        half_h_eff = (self.height / 2.0) - self.margin

        norm_u = abs(pred_u - self.cx) / half_w_eff
        norm_v = abs(pred_v - self.cy) / half_h_eff

        # Acceleration penalty
        accel_mag = math.sqrt(state.au ** 2 + state.av ** 2)
        accel_penalty = min(0.3, accel_mag / 200.0)

        risk = min(1.0, max(0.0, max(norm_u, norm_v) + accel_penalty))
        is_critical = risk >= 0.65

        # Suggested pre-emptive lead angle in degrees
        lead_u_deg = 0.0
        lead_v_deg = 0.0

        if risk > 0.35:
            # Proactively compensate predicted velocity offset
            lead_u_deg = (state.vu * t_h) * self.deg_per_px_u
            lead_v_deg = -(state.vv * t_h) * self.deg_per_px_v

        return LockRiskAssessment(
            risk_score=round(risk, 3),
            predicted_u=round(pred_u, 2),
            predicted_v=round(pred_v, 2),
            lookahead_sec=self.lookahead_sec,
            is_critical=is_critical,
            suggested_lead_u_deg=round(lead_u_deg, 4),
            suggested_lead_v_deg=round(lead_v_deg, 4),
        )

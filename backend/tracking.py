"""
Coarse PAT Tracking State Machine — ISRO PS-26169.
Implements the 6-state discrete tracking automaton:
SEARCHING -> DETECTED -> ACQUIRING -> LOCKED -> LOST -> RE_ACQUIRING
Tracks Acquisition Time (<= 2.0 s), Re-acquisition Time (<= 1.0 s),
Lock Retention Rate (>= 95%), and Pointing Error (<= 10 px).
"""

from __future__ import annotations

import dataclasses
import enum
import math
from typing import Optional, Tuple
from backend.detection import DetectionResult


class TrackingState(enum.Enum):
    SEARCHING = "SEARCHING"
    DETECTED = "DETECTED"
    ACQUIRING = "ACQUIRING"
    LOCKED = "LOCKED"
    LOST = "LOST"
    RE_ACQUIRING = "RE_ACQUIRING"


@dataclasses.dataclass
class TrackingStatus:
    state: TrackingState
    consecutive_hits: int
    consecutive_misses: int
    acquisition_time_sec: Optional[float]
    reacquisition_time_sec: Optional[float]
    lock_retention_rate_pct: float
    instantaneous_pointing_error_px: Optional[float]
    is_locked: bool
    total_simulation_time_sec: float
    total_locked_time_sec: float


class CoarseTrackingAutomaton:
    """
    6-State discrete tracking state machine for coarse PAT alignment.
    Transitions:
    - SEARCHING: initial search for optical beacon
    - DETECTED: 1 hit received (starts acquisition timer)
    - ACQUIRING: 2-4 consecutive hits
    - LOCKED: >= 5 consecutive hits (optical lock established)
    - LOST: >= 10 consecutive misses (lock lost, starts reacquisition timer)
    - RE_ACQUIRING: hit received while in LOST state
    """

    def __init__(
        self,
        hits_for_lock: int = 5,
        misses_for_loss: int = 10,
        center_u: float = 320.0,
        center_v: float = 240.0,
    ) -> None:
        self.hits_for_lock = hits_for_lock
        self.misses_for_loss = misses_for_loss
        self.center_u = float(center_u)
        self.center_v = float(center_v)

        self.state = TrackingState.SEARCHING
        self.consecutive_hits = 0
        self.consecutive_misses = 0

        # Timing
        self.sim_time = 0.0
        self.detection_start_time: Optional[float] = None
        self.loss_start_time: Optional[float] = None
        self.reacquisition_start_time: Optional[float] = None

        self.acquisition_time: Optional[float] = None
        self.reacquisition_time: Optional[float] = None

        self.total_locked_time = 0.0
        self.instantaneous_pointing_error: Optional[float] = None

    def reset(self) -> None:
        self.state = TrackingState.SEARCHING
        self.consecutive_hits = 0
        self.consecutive_misses = 0
        self.sim_time = 0.0
        self.detection_start_time = None
        self.loss_start_time = None
        self.reacquisition_start_time = None
        self.acquisition_time = None
        self.reacquisition_time = None
        self.total_locked_time = 0.0
        self.instantaneous_pointing_error = None

    def update(
        self,
        detection: DetectionResult,
        dt: float,
        sim_time: Optional[float] = None,
    ) -> TrackingStatus:
        """
        Updates tracking automaton given current frame's detection result and time step dt.
        """
        if sim_time is not None:
            self.sim_time = float(sim_time)
        else:
            self.sim_time += float(dt)

        if detection.detected and detection.centroid_u is not None and detection.centroid_v is not None:
            self.consecutive_hits += 1
            self.consecutive_misses = 0

            # Compute boresight pointing error: distance to (320, 240)
            self.instantaneous_pointing_error = math.sqrt(
                (detection.centroid_u - self.center_u) ** 2
                + (detection.centroid_v - self.center_v) ** 2
            )

            # State Transitions on Hit
            if self.state == TrackingState.SEARCHING:
                self.state = TrackingState.DETECTED
                self.detection_start_time = self.sim_time

            elif self.state == TrackingState.DETECTED:
                self.state = TrackingState.ACQUIRING

            elif self.state == TrackingState.ACQUIRING:
                if self.consecutive_hits >= self.hits_for_lock:
                    self.state = TrackingState.LOCKED
                    if self.detection_start_time is not None and self.acquisition_time is None:
                        self.acquisition_time = round(self.sim_time - self.detection_start_time, 3)

            elif self.state == TrackingState.LOST:
                self.state = TrackingState.RE_ACQUIRING
                self.reacquisition_start_time = self.sim_time

            elif self.state == TrackingState.RE_ACQUIRING:
                if self.consecutive_hits >= self.hits_for_lock:
                    self.state = TrackingState.LOCKED
                    if self.loss_start_time is not None:
                        self.reacquisition_time = round(self.sim_time - self.loss_start_time, 3)

            elif self.state == TrackingState.LOCKED:
                self.total_locked_time += dt

        else:
            # Detection miss
            self.consecutive_hits = 0
            self.consecutive_misses += 1
            self.instantaneous_pointing_error = None

            # State Transitions on Miss
            if self.state == TrackingState.DETECTED or self.state == TrackingState.ACQUIRING:
                if self.consecutive_misses >= 3:
                    self.state = TrackingState.SEARCHING
                    self.detection_start_time = None

            elif self.state == TrackingState.LOCKED:
                if self.consecutive_misses >= self.misses_for_loss:
                    self.state = TrackingState.LOST
                    self.loss_start_time = self.sim_time

            elif self.state == TrackingState.RE_ACQUIRING:
                if self.consecutive_misses >= 3:
                    self.state = TrackingState.LOST

        # Lock retention rate
        retention = 0.0
        if self.sim_time > 0.0:
            retention = min(100.0, max(0.0, (self.total_locked_time / self.sim_time) * 100.0))

        return TrackingStatus(
            state=self.state,
            consecutive_hits=self.consecutive_hits,
            consecutive_misses=self.consecutive_misses,
            acquisition_time_sec=self.acquisition_time,
            reacquisition_time_sec=self.reacquisition_time,
            lock_retention_rate_pct=round(retention, 2),
            instantaneous_pointing_error_px=round(self.instantaneous_pointing_error, 2)
            if self.instantaneous_pointing_error is not None
            else None,
            is_locked=(self.state == TrackingState.LOCKED),
            total_simulation_time_sec=round(self.sim_time, 3),
            total_locked_time_sec=round(self.total_locked_time, 3),
        )

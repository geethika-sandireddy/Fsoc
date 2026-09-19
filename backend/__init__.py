"""
FSOC Coarse PAT Tracking System — Backend Package.
ISRO Problem Statement 26169.
"""

from backend.environment import VirtualEnvironment
from backend.target import TargetGenerator, TargetState, MotionType, ShapeType
from backend.camera import VirtualCamera, SensorProjection, FOVConePolygon
from backend.disturbance import (
    DisturbanceEngine,
    NoiseConfig,
    AtmosphereCondition,
    PlatformMotionTrajectory,
    validate_control_interval,
)

# 3D Simulation Modules
from backend.environment_3d import VirtualEnvironment3D, Star3D
from backend.target_3d import TargetGenerator3D, TargetMotionMode3D, TargetState3D, TargetShape
from backend.camera_3d import VirtualCamera3D, ProjectionResult3D

# AI & Detection Modules
from backend.dataset_generator import SyntheticBeaconDatasetGenerator
from backend.ai_model import BeaconValidatorEngine
from backend.detection import (
    ClassicalCandidateGenerator,
    SubpixelCentroidEstimator,
    DetectionPipeline,
    CandidateROI,
    DetectionResult,
)

# Tracking & Controller Modules
from backend.tracking import TrackingState, TrackingStatus, CoarseTrackingAutomaton
from backend.predictor import (
    StateEstimate2D,
    LockRiskAssessment,
    TrajectoryStateEstimator,
    LockRiskEvaluator,
)
from backend.controller import (
    ControllerOutput,
    ReactiveBaselineController,
    PredictiveLockRiskController,
)

__version__ = "2.2.0"

__all__ = [
    "VirtualEnvironment",
    "TargetGenerator",
    "TargetState",
    "MotionType",
    "ShapeType",
    "VirtualCamera",
    "SensorProjection",
    "FOVConePolygon",
    "DisturbanceEngine",
    "NoiseConfig",
    "AtmosphereCondition",
    "PlatformMotionTrajectory",
    "validate_control_interval",
    "VirtualEnvironment3D",
    "Star3D",
    "TargetGenerator3D",
    "TargetMotionMode3D",
    "TargetState3D",
    "TargetShape",
    "VirtualCamera3D",
    "ProjectionResult3D",
    "SyntheticBeaconDatasetGenerator",
    "BeaconValidatorEngine",
    "ClassicalCandidateGenerator",
    "SubpixelCentroidEstimator",
    "DetectionPipeline",
    "CandidateROI",
    "DetectionResult",
    "TrackingState",
    "TrackingStatus",
    "CoarseTrackingAutomaton",
    "StateEstimate2D",
    "LockRiskAssessment",
    "TrajectoryStateEstimator",
    "LockRiskEvaluator",
    "ControllerOutput",
    "ReactiveBaselineController",
    "PredictiveLockRiskController",
]

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

__version__ = "2.0.0"

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
]

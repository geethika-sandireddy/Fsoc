/**
 * Pan/Tilt Slew-Rate Limited Servo Controller — ISRO PS-26169.
 * Independent Pan & Tilt closed-loop recentering controller with
 * pixel-to-angle linear approximation and dynamic slew rate limiting (5-10 °/s, >=20 Hz).
 */

import { SimulationState } from './state.js';

export class PanTiltController {
  constructor() {
    this.accumulatorTime = 0;
  }

  reset() {
    this.accumulatorTime = 0;
    const ctrl = SimulationState.controller;
    ctrl.panErrorAngle = 0.0;
    ctrl.tiltErrorAngle = 0.0;
    ctrl.panDeltaApplied = 0.0;
    ctrl.tiltDeltaApplied = 0.0;
  }

  /**
   * Evaluates coarse alignment pointing error and repositions camera gimbal.
   * Runs at control update interval (>=20 Hz, default 50 ms).
   */
  update(detectedX, detectedY, dt) {
    const cam = SimulationState.camera;
    const ctrl = SimulationState.controller;
    const W = cam.resolutionWidth;  // 640
    const H = cam.resolutionHeight; // 480
    const centerX = W / 2;          // 320
    const centerY = H / 2;          // 240

    // Accumulate time for control rate gating (>= 20 Hz / 50ms)
    this.accumulatorTime += dt;
    const intervalSec = (cam.controlUpdateInterval || 50) / 1000.0;

    if (this.accumulatorTime < intervalSec) {
      // Not yet time for next discrete control update
      return {
        updated: false,
        pan: cam.pan,
        tilt: cam.tilt,
        panDelta: 0,
        tiltDelta: 0
      };
    }

    const controlDt = this.accumulatorTime;
    this.accumulatorTime = 0; // Reset accumulator

    if (detectedX === null || detectedY === null) {
      // In SEARCHING or LOST state: no valid beacon feedback, hold position
      ctrl.panErrorAngle = 0.0;
      ctrl.tiltErrorAngle = 0.0;
      ctrl.panDeltaApplied = 0.0;
      ctrl.tiltDeltaApplied = 0.0;
      return {
        updated: false,
        pan: cam.pan,
        tilt: cam.tilt,
        panDelta: 0,
        tiltDelta: 0
      };
    }

    // 1. Pixel-to-Angle Linear Approximation
    // dx > 0 means target is to the right of boresight -> camera must pan right (+Pan)
    // dy > 0 means target is below boresight -> camera must tilt down
    const dxPx = detectedX - centerX;
    const dyPx = detectedY - centerY;

    const panErrorDeg = dxPx * (cam.fovH / W);
    const tiltErrorDeg = dyPx * (cam.fovV / H);

    ctrl.panErrorAngle = parseFloat(panErrorDeg.toFixed(3));
    ctrl.tiltErrorAngle = parseFloat(tiltErrorDeg.toFixed(3));

    // 2. Slew-Rate Limiter Physics (Speed limit: 5-10 °/s)
    const maxPanSpeed = Math.max(1.0, Math.min(10.0, cam.maxPanSpeed || 5.0));
    const maxTiltSpeed = Math.max(1.0, Math.min(10.0, cam.maxTiltSpeed || 5.0));

    const maxPanDelta = maxPanSpeed * controlDt;
    const maxTiltDelta = maxTiltSpeed * controlDt;

    // Proportional gain (Kp = 0.75 for smooth coarse convergence without overshoot)
    const Kp = 0.8;
    const desiredPanDelta = panErrorDeg * Kp;
    const desiredTiltDelta = -tiltErrorDeg * Kp; // Negative to drive dy to zero

    // Clamp by max slew speed per update step
    const appliedPanDelta = Math.max(-maxPanDelta, Math.min(maxPanDelta, desiredPanDelta));
    const appliedTiltDelta = Math.max(-maxTiltDelta, Math.min(maxTiltDelta, desiredTiltDelta));

    // 3. Update Camera Pan/Tilt Gimbal Orientation
    cam.pan += appliedPanDelta;
    cam.tilt += appliedTiltDelta;

    // Hard mechanical travel limits
    cam.pan = Math.max(-45.0, Math.min(45.0, cam.pan));
    cam.tilt = Math.max(-30.0, Math.min(30.0, cam.tilt));

    ctrl.panDeltaApplied = parseFloat(appliedPanDelta.toFixed(4));
    ctrl.tiltDeltaApplied = parseFloat(appliedTiltDelta.toFixed(4));

    return {
      updated: true,
      pan: parseFloat(cam.pan.toFixed(2)),
      tilt: parseFloat(cam.tilt.toFixed(2)),
      panDelta: appliedPanDelta,
      tiltDelta: appliedTiltDelta
    };
  }
}

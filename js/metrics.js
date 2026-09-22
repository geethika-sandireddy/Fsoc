/**
 * Performance Metrics & Evaluation Engine — ISRO PS-26169.
 * Computes Centroiding Error (Instantaneous, Average, Max, RMSE), Pointing Error,
 * Lock Retention, Target Loss Rate, FPS, and PS Reference comparisons.
 */

import { SimulationState } from './state.js';

export const PS_REFERENCES = {
  acquisitionTime: { max: 2.0, unit: 's', label: 'Acquisition Time', condition: '≤ 2.00 s' },
  trackingError: { max: 10.0, unit: 'px', label: 'Tracking Error', condition: '≤ 10.0 px' },
  targetLossRate: { max: 5.0, unit: '%', label: 'Target Loss', condition: '< 5.0 %' },
  reacquisitionTime: { max: 1.0, unit: 's', label: 'Re-acquisition Time', condition: '≤ 1.00 s' },
  processingFPS: { min: 20.0, unit: 'FPS', label: 'Processing Speed', condition: '≥ 20.0 FPS' },
  cameraUpdateRate: { min: 30.0, unit: 'Hz', label: 'Camera Rate', condition: '≥ 30.0 Hz' }
};

export class MetricsEngine {
  constructor() {
    this.accumulatedErrors = [];
    this.accumulatedSquaredErrors = 0;
  }

  reset() {
    this.accumulatedErrors = [];
    this.accumulatedSquaredErrors = 0;
    SimulationState.resetMetrics();
  }

  /**
   * Updates all metrics for the current frame.
   */
  update(detectedX, detectedY, groundTruthCamX, groundTruthCamY, procTimeMs, frameDt, elapsedTime) {
    const met = SimulationState.metrics;
    const trk = SimulationState.tracking;
    const cam = SimulationState.camera;

    // 1. Frame rate measurements
    if (frameDt > 0) {
      const instantSimFPS = 1.0 / frameDt;
      met.simulationFPS = met.simulationFPS === null
        ? parseFloat(instantSimFPS.toFixed(1))
        : parseFloat((met.simulationFPS * 0.9 + instantSimFPS * 0.1).toFixed(1));
    }

    if (procTimeMs > 0) {
      const instantProcFPS = 1000.0 / procTimeMs;
      met.processingFPS = met.processingFPS === null
        ? parseFloat(instantProcFPS.toFixed(1))
        : parseFloat((met.processingFPS * 0.9 + instantProcFPS * 0.1).toFixed(1));
    }

    // 2. Centroiding Error & Pointing Error computation
    if (detectedX !== null && detectedY !== null) {
      // Pointing Error relative to camera boresight (320, 240) in pixels
      const cx = cam.resolutionWidth / 2;
      const cy = cam.resolutionHeight / 2;
      const dxPx = detectedX - cx;
      const dyPx = detectedY - cy;
      const pErr = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
      met.instantaneousPointingError = parseFloat(pErr.toFixed(2));

      // Angular Pointing Error in degrees and millidegrees (mdeg)
      const dxDeg = (dxPx / cam.resolutionWidth) * cam.fovH;
      const dyDeg = (dyPx / cam.resolutionHeight) * cam.fovV;
      const angErrDeg = Math.sqrt(dxDeg * dxDeg + dyDeg * dyDeg);
      met.instantaneousAngularPointingError = parseFloat(angErrDeg.toFixed(4));
      met.instantaneousAngularPointingErrorMdeg = parseFloat((angErrDeg * 1000).toFixed(2));

      // Centroiding Error relative to ground truth beacon
      if (groundTruthCamX !== null && groundTruthCamY !== null) {
        const cErr = Math.sqrt(Math.pow(detectedX - groundTruthCamX, 2) + Math.pow(detectedY - groundTruthCamY, 2));
        met.instantaneousCentroidError = parseFloat(cErr.toFixed(2));

        // Accumulate statistics
        this.accumulatedErrors.push(cErr);
        this.accumulatedSquaredErrors += cErr * cErr;

        // Running average
        const sum = this.accumulatedErrors.reduce((a, b) => a + b, 0);
        met.averageCentroidError = parseFloat((sum / this.accumulatedErrors.length).toFixed(2));

        // Running maximum
        if (met.maximumCentroidError === null || cErr > met.maximumCentroidError) {
          met.maximumCentroidError = parseFloat(cErr.toFixed(2));
        }

        // Root Mean Square Error (RMSE)
        const meanSq = this.accumulatedSquaredErrors / this.accumulatedErrors.length;
        met.rmseCentroidError = parseFloat(Math.sqrt(meanSq).toFixed(2));
      }
    } else {
      met.instantaneousPointingError = null;
      met.instantaneousAngularPointingError = null;
      met.instantaneousAngularPointingErrorMdeg = null;
      met.instantaneousCentroidError = null;
    }

    // 3. Pan and Tilt telemetry
    met.panAngle = parseFloat(cam.pan.toFixed(2));
    met.tiltAngle = parseFloat(cam.tilt.toFixed(2));

    // 4. Lock and Loss Tracking Frame Statistics
    if (groundTruthCamX !== null && groundTruthCamY !== null) {
      met.totalObservableFrames++;
    }

    if (met.acquisitionTime !== null) {
      met.framesSinceAcquisition++;
      if (trk.state === 'LOCKED') {
        met.lockedFrames++;
      } else if (trk.state === 'LOST') {
        met.lostFrames++;
      }

      // Lock Retention Rate %
      if (met.framesSinceAcquisition > 0) {
        met.lockRetentionRate = parseFloat(
          ((met.lockedFrames / met.framesSinceAcquisition) * 100).toFixed(1)
        );
      }

      // Target Loss Rate %
      if (met.totalObservableFrames > 0) {
        met.targetLossRate = parseFloat(
          ((met.lostFrames / met.totalObservableFrames) * 100).toFixed(1)
        );
      }
    }

    // 5. Append to Rolling Telemetry History (max 120 samples)
    if (SimulationState.simulation.currentFrame % 2 === 0) {
      met.history.timestamps.push(parseFloat(elapsedTime.toFixed(1)));
      met.history.centroidErrors.push(met.instantaneousCentroidError !== null ? met.instantaneousCentroidError : 0);
      met.history.pointingErrors.push(met.instantaneousPointingError !== null ? met.instantaneousPointingError : 0);
      met.history.angularPointingErrors.push(met.instantaneousAngularPointingErrorMdeg !== null ? met.instantaneousAngularPointingErrorMdeg : 0);
      met.history.panAngles.push(met.panAngle);
      met.history.tiltAngles.push(met.tiltAngle);
      met.history.processingFPS.push(met.processingFPS !== null ? met.processingFPS : 0);

      if (met.history.timestamps.length > 120) {
        met.history.timestamps.shift();
        met.history.centroidErrors.shift();
        met.history.pointingErrors.shift();
        met.history.angularPointingErrors.shift();
        met.history.panAngles.shift();
        met.history.tiltAngles.shift();
        met.history.processingFPS.shift();
      }
    }

    // 6. Record Streaming Frame Log (Centroid Error Log)
    if (SimulationState.simulation.currentFrame % 3 === 0) {
      const dx = (detectedX !== null && groundTruthCamX !== null)
        ? parseFloat((detectedX - groundTruthCamX).toFixed(2)) : null;
      const dy = (detectedY !== null && groundTruthCamY !== null)
        ? parseFloat((detectedY - groundTruthCamY).toFixed(2)) : null;

      SimulationState.logs.push({
        frame: SimulationState.simulation.currentFrame,
        time: parseFloat(elapsedTime.toFixed(2)),
        gtX: groundTruthCamX !== null ? parseFloat(groundTruthCamX.toFixed(1)) : '—',
        gtY: groundTruthCamY !== null ? parseFloat(groundTruthCamY.toFixed(1)) : '—',
        detX: detectedX !== null ? parseFloat(detectedX.toFixed(1)) : '—',
        detY: detectedY !== null ? parseFloat(detectedY.toFixed(1)) : '—',
        dx: dx !== null ? (dx >= 0 ? `+${dx}` : `${dx}`) : '—',
        dy: dy !== null ? (dy >= 0 ? `+${dy}` : `${dy}`) : '—',
        centroidError: met.instantaneousCentroidError !== null ? met.instantaneousCentroidError : '—',
        pointingError: met.instantaneousPointingError !== null ? met.instantaneousPointingError : '—',
        pan: met.panAngle !== null ? (met.panAngle >= 0 ? `+${met.panAngle}°` : `${met.panAngle}°`) : '—',
        tilt: met.tiltAngle !== null ? (met.tiltAngle >= 0 ? `+${met.tiltAngle}°` : `${met.tiltAngle}°`) : '—',
        state: trk.state
      });

      // Keep recent 1000 log records in memory
      if (SimulationState.logs.length > 1000) {
        SimulationState.logs.shift();
      }
    }
  }

  /**
   * Helper evaluating a measured value against PS reference criteria.
   * Returns { status: 'WITHIN REFERENCE' | 'EXCEEDS REFERENCE' | '—', isCompliant: boolean }
   */
  static checkReference(metricKey, value) {
    if (value === null || value === undefined || isNaN(value)) {
      return { status: '—', isCompliant: null, text: 'No Data' };
    }
    const spec = PS_REFERENCES[metricKey];
    if (!spec) return { status: '—', isCompliant: null, text: 'N/A' };

    let isCompliant = true;
    if (spec.max !== undefined && value > spec.max) isCompliant = false;
    if (spec.min !== undefined && value < spec.min) isCompliant = false;

    return {
      status: isCompliant ? 'WITHIN REFERENCE' : 'EXCEEDS REFERENCE',
      isCompliant,
      condition: spec.condition,
      text: `${value} ${spec.unit} (${spec.condition})`
    };
  }
}

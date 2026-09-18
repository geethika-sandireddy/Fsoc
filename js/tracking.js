/**
 * Continuous Tracking Engine & State Machine — ISRO PS-26169.
 * Implements deterministic tracking states: SEARCHING, DETECTED, ACQUIRING, LOCKED, LOST, RE-ACQUIRING.
 * Enforces explicit implementation-defined transition parameters.
 */

import { SimulationState } from './state.js';

export const STATE_METADATA = {
  SEARCHING: {
    label: 'SEARCHING',
    color: '#ff9900', // Amber
    description: 'No valid beacon currently detected in camera FOV.'
  },
  DETECTED: {
    label: 'DETECTED',
    color: '#00d2ff', // Cyan
    description: 'Beacon candidate found by detector above threshold.'
  },
  ACQUIRING: {
    label: 'ACQUIRING',
    color: '#00d2ff', // Cyan
    description: 'Detector confirming target; camera servo converging.'
  },
  LOCKED: {
    label: 'TRACKING (LOCKED)',
    color: '#00e676', // Emerald Green
    description: 'Target continuously tracked with valid estimates.'
  },
  LOST: {
    label: 'TARGET LOST',
    color: '#ff3d00', // Red
    description: 'Target lost; missing detection for consecutive frames.'
  },
  'RE-ACQUIRING': {
    label: 'RE-ACQUIRING',
    color: '#ff9900', // Amber
    description: 'System actively attempting target recovery.'
  }
};

export class TrackingEngine {
  constructor() {
    this.lostTimestamp = null;
    this.initialAcquisitionDone = false;
    // Alpha-beta smoothing filter states
    this.estX = null;
    this.estY = null;
    this.estVx = 0;
    this.estVy = 0;
  }

  reset() {
    this.lostTimestamp = null;
    this.initialAcquisitionDone = false;
    this.estX = null;
    this.estY = null;
    this.estVx = 0;
    this.estVy = 0;
    const trk = SimulationState.tracking;
    trk.state = 'SEARCHING';
    trk.detectedX = null;
    trk.detectedY = null;
    trk.confidence = null;
    trk.consecutiveDetections = 0;
    trk.consecutiveMisses = 0;
  }

  /**
   * Updates tracking state machine given current detector output and time delta.
   */
  update(detectionResult, dt, elapsedTime) {
    const trk = SimulationState.tracking;
    const met = SimulationState.metrics;
    const acqReq = trk.acquisitionFramesRequired || 5;
    const lossThresh = trk.lossFramesThreshold || 10;

    if (detectionResult && detectionResult.detected) {
      trk.consecutiveDetections++;
      trk.consecutiveMisses = 0;
      trk.confidence = detectionResult.confidence;

      // Alpha-beta filter update (alpha = 0.85, beta = 0.15) for smooth sub-pixel centroid
      if (this.estX === null) {
        this.estX = detectionResult.x;
        this.estY = detectionResult.y;
        this.estVx = 0;
        this.estVy = 0;
      } else {
        const predX = this.estX + this.estVx * dt;
        const predY = this.estY + this.estVy * dt;
        const resX = detectionResult.x - predX;
        const resY = detectionResult.y - predY;
        this.estX = predX + 0.85 * resX;
        this.estY = predY + 0.85 * resY;
        this.estVx += (0.15 * resX) / Math.max(0.001, dt);
        this.estVy += (0.15 * resY) / Math.max(0.001, dt);
      }

      trk.detectedX = this.estX;
      trk.detectedY = this.estY;

      // State transition handling
      switch (trk.state) {
        case 'SEARCHING':
          trk.state = 'DETECTED';
          break;

        case 'DETECTED':
          trk.state = 'ACQUIRING';
          break;

        case 'ACQUIRING':
          if (trk.consecutiveDetections >= acqReq) {
            trk.state = 'LOCKED';
            if (met.acquisitionTime === null) {
              met.acquisitionTime = parseFloat(elapsedTime.toFixed(2));
            }
            this.initialAcquisitionDone = true;
          }
          break;

        case 'RE-ACQUIRING':
          if (trk.consecutiveDetections >= acqReq) {
            trk.state = 'LOCKED';
            if (this.lostTimestamp !== null) {
              met.reacquisitionTime = parseFloat((elapsedTime - this.lostTimestamp).toFixed(2));
              this.lostTimestamp = null;
            }
          }
          break;

        case 'LOST':
          trk.state = 'RE-ACQUIRING';
          break;

        case 'LOCKED':
        default:
          // Remain in locked state
          break;
      }
    } else {
      // Detection missed in this frame
      trk.consecutiveMisses++;
      trk.consecutiveDetections = 0;
      trk.confidence = 0.0;
      trk.detectedX = null;
      trk.detectedY = null;

      // State transitions on missing detection
      if (trk.state === 'LOCKED' || trk.state === 'ACQUIRING') {
        if (trk.consecutiveMisses >= lossThresh) {
          trk.state = 'LOST';
          this.lostTimestamp = elapsedTime;
        }
      } else if (trk.state === 'RE-ACQUIRING' || trk.state === 'DETECTED') {
        if (trk.consecutiveMisses >= lossThresh) {
          trk.state = 'LOST';
        }
      } else if (trk.state === 'LOST') {
        if (trk.consecutiveMisses > lossThresh * 3) {
          trk.state = 'SEARCHING';
        }
      }
    }

    return {
      state: trk.state,
      metadata: STATE_METADATA[trk.state],
      detectedX: trk.detectedX,
      detectedY: trk.detectedY,
      confidence: trk.confidence
    };
  }
}

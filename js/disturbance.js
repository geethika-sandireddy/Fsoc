/**
 * Disturbance & Noise Engine — ISRO PS-26169.
 * Real pixel-level disturbance injection: Image Noise (S&P, Gaussian, Poisson),
 * Camera Jitter (±20 px), Atmospheric Attenuation (5 conditions + contrast/brightness),
 * and Platform Motion (Linear, Circular, Random, Spiral, Figure of 8).
 */

import { SimulationState, prng } from './state.js';

export class DisturbanceEngine {
  constructor() {
    this.jitterX = 0;
    this.jitterY = 0;
    this.platformOffsetX = 0;
    this.platformOffsetY = 0;
  }

  reset() {
    this.jitterX = 0;
    this.jitterY = 0;
    this.platformOffsetX = 0;
    this.platformOffsetY = 0;
  }

  /**
   * Computes frame-level spatial offsets (Jitter & Platform Motion).
   * Returns { totalDx, totalDy, jitterX, jitterY, platformOffsetX, platformOffsetY }
   */
  computeSpatialOffsets(dt, elapsedTime) {
    const dist = SimulationState.disturbances;

    // 1. Camera Jitter (±0 to ±20 px/frame)
    if (dist.cameraJitterEnabled && dist.cameraJitterMagnitude > 0) {
      const mag = Math.min(20, dist.cameraJitterMagnitude);
      this.jitterX = prng.range(-mag, mag);
      this.jitterY = prng.range(-mag, mag);
    } else {
      this.jitterX = 0;
      this.jitterY = 0;
    }

    // 2. Platform Motion (±0 to ±20 px/frame max)
    const pMag = Math.min(20, dist.platformMotionMagnitude || 0);
    const rad = (dist.platformMotionAngle || 45) * (Math.PI / 180);

    switch (dist.platformMotionType) {
      case 'linear': {
        // Continuous linear displacement oscillating across ±pMag
        const osc = Math.sin(elapsedTime * 1.5);
        this.platformOffsetX = pMag * Math.cos(rad) * osc;
        this.platformOffsetY = pMag * Math.sin(rad) * osc;
        break;
      }
      case 'circular': {
        this.platformOffsetX = pMag * Math.cos(elapsedTime * 2.0);
        this.platformOffsetY = pMag * Math.sin(elapsedTime * 2.0);
        break;
      }
      case 'figure8': {
        this.platformOffsetX = pMag * Math.sin(elapsedTime * 2.0);
        this.platformOffsetY = (pMag * 0.5) * Math.sin(elapsedTime * 4.0);
        break;
      }
      case 'spiral': {
        const r = (pMag * 0.5) * (1 + Math.sin(elapsedTime * 0.8));
        this.platformOffsetX = r * Math.cos(elapsedTime * 3.0);
        this.platformOffsetY = r * Math.sin(elapsedTime * 3.0);
        break;
      }
      case 'random': {
        this.platformOffsetX += prng.range(-1.5, 1.5);
        this.platformOffsetY += prng.range(-1.5, 1.5);
        this.platformOffsetX = Math.max(-pMag, Math.min(pMag, this.platformOffsetX));
        this.platformOffsetY = Math.max(-pMag, Math.min(pMag, this.platformOffsetY));
        break;
      }
      default:
        this.platformOffsetX = 0;
        this.platformOffsetY = 0;
        break;
    }

    return {
      jitterX: this.jitterX,
      jitterY: this.jitterY,
      platformOffsetX: this.platformOffsetX,
      platformOffsetY: this.platformOffsetY,
      totalDx: this.jitterX + this.platformOffsetX,
      totalDy: this.jitterY + this.platformOffsetY
    };
  }

  /**
   * Applies pixel-level disturbances directly to the 640x480 RGBA image buffer:
   * Atmospheric contrast/brightness attenuation, Salt & Pepper, Gaussian, and Poisson noise.
   */
  applyPixelDisturbances(imageData, width, height) {
    const dist = SimulationState.disturbances;
    const data = imageData.data;
    const totalPixels = width * height;

    // Atmospheric condition presets
    let contrastFactor = 1.0 - Math.min(0.9, dist.contrastReduction);
    let brightnessOffset = -Math.min(150, dist.brightnessReduction * 150);

    // Contextual atmospheric degradation
    if (dist.atmosphericCondition === 'Haze') {
      contrastFactor *= 0.75;
      brightnessOffset += 20; // Milky haze lift
    } else if (dist.atmosphericCondition === 'Fog') {
      contrastFactor *= 0.50;
      brightnessOffset += 35; // Dense fog scattering
    } else if (dist.atmosphericCondition === 'Rain') {
      contrastFactor *= 0.70;
      brightnessOffset -= 15;
    } else if (dist.atmosphericCondition === 'Low Light') {
      contrastFactor *= 0.60;
      brightnessOffset -= 60; // Severe photon starvation
    }

    const spProb = (dist.saltPepperEnabled && dist.saltPepperDensity > 0)
      ? (dist.saltPepperDensity / 100)
      : 0;
    const gStdDev = (dist.gaussianEnabled && dist.gaussianStdDev > 0)
      ? Math.min(20, dist.gaussianStdDev)
      : 0;
    const poissonActive = dist.poissonEnabled;

    // Direct pixel buffer manipulation (Fast in-place loop)
    for (let i = 0; i < data.length; i += 4) {
      let gray = data[i]; // Monochrome FPA (R=G=B)

      // 1. Atmospheric Contrast & Brightness Transformation
      gray = (gray - 128) * contrastFactor + 128 + brightnessOffset;

      // 2. Salt & Pepper Noise
      if (spProb > 0 && prng.random() < spProb) {
        gray = prng.random() < 0.5 ? 0 : 255;
      } else {
        // 3. Gaussian Noise (Additive)
        if (gStdDev > 0) {
          gray += prng.gaussian(0, gStdDev);
        }

        // 4. Poisson Photon Shot Noise (variance ~ sqrt(intensity))
        if (poissonActive && gray > 0) {
          const lambda = Math.max(1, gray);
          const shotNoise = prng.gaussian(0, Math.sqrt(lambda) * 0.45);
          gray += shotNoise;
        }
      }

      // Clamp to [0, 255]
      const clamped = gray < 0 ? 0 : (gray > 255 ? 255 : gray);
      data[i] = clamped;     // R
      data[i + 1] = clamped; // G
      data[i + 2] = clamped; // B
      data[i + 3] = 255;     // A
    }
  }
}

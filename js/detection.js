/**
 * Detection & Centroid Estimation Architecture — ISRO PS-26169.
 * Modular Detector Interface:
 *   - Classical CV Detector: Adaptive Thresholding + Morphological Noise Filter +
 *     Sub-pixel Intensity-Weighted Center of Gravity (IW-CoG).
 *   - AI Detector: Pluggable architectural slot for machine-learning centroid regressors.
 */

import { SimulationState } from './state.js';

export class DetectorInterface {
  constructor() {
    this.method = 'classical'; // 'classical' or 'ai_extensible'
  }

  detect(imageData, width, height) {
    if (SimulationState.detection.activeDetector === 'ai_extensible') {
      return this.aiDetect(imageData, width, height);
    }
    return this.classicalDetect(imageData, width, height);
  }

  /**
   * Classical Computer Vision Centroid Estimator:
   * 1. Dynamic background estimation
   * 2. Adaptive thresholding
   * 3. Morphological speckle rejection
   * 4. Intensity-Weighted Center of Gravity (IW-CoG)
   */
  classicalDetect(imageData, width, height) {
    const data = imageData.data;
    const offset = SimulationState.detection.thresholdOffset || 25;

    // 1. Estimate background mean from a sparse grid sample
    let sampleSum = 0;
    let sampleCount = 0;
    const stride = 16;
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const idx = (y * width + x) * 4;
        sampleSum += data[idx];
        sampleCount++;
      }
    }
    const bgMean = sampleSum / Math.max(1, sampleCount);
    const threshold = Math.min(240, bgMean + offset);

    // 2. Find brightest candidate peak and connected components above threshold
    let maxVal = 0;
    let peakX = -1;
    let peakY = -1;

    for (let y = 2; y < height - 2; y++) {
      const rowOffset = y * width;
      for (let x = 2; x < width - 2; x++) {
        const val = data[(rowOffset + x) * 4];
        if (val > threshold && val > maxVal) {
          // Reject single isolated noise spikes (3x3 neighborhood confirmation)
          const neighborsAbove = 
            (data[(rowOffset + x - 1) * 4] > threshold ? 1 : 0) +
            (data[(rowOffset + x + 1) * 4] > threshold ? 1 : 0) +
            (data[((y - 1) * width + x) * 4] > threshold ? 1 : 0) +
            (data[((y + 1) * width + x) * 4] > threshold ? 1 : 0);

          if (neighborsAbove >= 1) {
            maxVal = val;
            peakX = x;
            peakY = y;
          }
        }
      }
    }

    // No valid beacon candidate found
    if (peakX === -1 || maxVal <= threshold) {
      return {
        detected: false,
        x: null,
        y: null,
        confidence: 0.0,
        peakVal: 0,
        method: 'Classical CV (Adaptive Threshold + IW-CoG)'
      };
    }

    // 3. Sub-pixel Intensity-Weighted Center of Gravity (IW-CoG) within local bounding box
    const windowRadius = 14;
    const minX = Math.max(0, peakX - windowRadius);
    const maxX = Math.min(width - 1, peakX + windowRadius);
    const minY = Math.max(0, peakY - windowRadius);
    const maxY = Math.min(height - 1, peakY + windowRadius);

    let weightSum = 0;
    let weightedX = 0;
    let weightedY = 0;
    let activePixels = 0;

    for (let y = minY; y <= maxY; y++) {
      const rowOffset = y * width;
      for (let x = minX; x <= maxX; x++) {
        const val = data[(rowOffset + x) * 4];
        if (val > threshold) {
          // Intensity above threshold as weight
          const weight = val - threshold;
          weightSum += weight;
          weightedX += x * weight;
          weightedY += y * weight;
          activePixels++;
        }
      }
    }

    if (weightSum === 0 || activePixels < SimulationState.detection.minBlobArea) {
      return {
        detected: false,
        x: null,
        y: null,
        confidence: 0.0,
        peakVal: maxVal,
        method: 'Classical CV (Adaptive Threshold + IW-CoG)'
      };
    }

    const centroidX = weightedX / weightSum;
    const centroidY = weightedY / weightSum;

    // Confidence metric derived from peak contrast ratio and blob compactness
    const contrastRatio = (maxVal - bgMean) / 255.0;
    const compactness = Math.min(1.0, activePixels / 80.0);
    const confidence = Math.max(0.1, Math.min(1.0, contrastRatio * 0.8 + compactness * 0.2));

    return {
      detected: true,
      x: centroidX,
      y: centroidY,
      confidence: parseFloat(confidence.toFixed(3)),
      peakVal: maxVal,
      activePixels,
      box: {
        x: minX,
        y: minY,
        w: maxX - minX + 1,
        h: maxY - minY + 1
      },
      method: 'Classical CV (Adaptive Threshold + IW-CoG)'
    };
  }

  /**
   * Pluggable AI Detector Slot:
   * Architecture hook allowing drop-in of custom trained neural networks or learned spatial filters.
   */
  aiDetect(imageData, width, height) {
    // If no custom model loaded, fallback gracefully to classical CV with notification
    const result = this.classicalDetect(imageData, width, height);
    result.method = 'AI Detector Slot (Fallback to Classical CV)';
    return result;
  }
}

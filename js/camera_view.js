/**
 * Live Camera Viewport & HUD Renderer — ISRO PS-26169.
 * Renders 640x480 Monochrome FPA sensor feed, background stars, beacon optical bloom,
 * real disturbance buffer, tracking bounding box, boresight reticle, and error vector.
 */

import { SimulationState, prng } from './state.js';

export class CameraViewRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Offscreen buffer at native 640x480 resolution
    this.offscreen = document.createElement('canvas');
    this.offscreen.width = 640;
    this.offscreen.height = 480;
    this.offCtx = this.offscreen.getContext('2d', { willReadFrequently: true });

    // Pre-generate sensor stars relative to camera FOV
    this.sensorStars = [];
    for (let i = 0; i < 90; i++) {
      this.sensorStars.push({
        baseX: prng.range(0, 640),
        baseY: prng.range(0, 480),
        r: prng.range(0.6, 1.4),
        brightness: prng.range(30, 95)
      });
    }
  }

  /**
   * Generates the raw optical frame, applies disturbances, and returns ImageData.
   */
  generateRawSensorFrame(groundTruthCamX, groundTruthCamY, disturbanceEngine) {
    const ctx = this.offCtx;
    const W = 640;
    const H = 480;
    const tgt = SimulationState.target;
    const cam = SimulationState.camera;

    // 1. Dark sensor noise floor
    ctx.fillStyle = '#060a10';
    ctx.fillRect(0, 0, W, H);

    // 2. Stars passing through FOV with camera pan/tilt parallax
    ctx.save();
    const panShift = (cam.pan * 25) % W;
    const tiltShift = (cam.tilt * 25) % H;

    for (const s of this.sensorStars) {
      let sx = (s.baseX - panShift) % W;
      let sy = (s.baseY + tiltShift) % H;
      if (sx < 0) sx += W;
      if (sy < 0) sy += H;

      ctx.fillStyle = `rgb(${s.brightness}, ${s.brightness}, ${s.brightness})`;
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 3. Optical Beacon Spot (Target)
    if (groundTruthCamX !== null && groundTruthCamY !== null) {
      const bx = groundTruthCamX;
      const by = groundTruthCamY;
      const sz = Math.max(5, Math.min(20, tgt.size || 10));

      ctx.save();
      // Outer optical bloom
      const bloomGrad = ctx.createRadialGradient(bx, by, sz * 0.2, bx, by, sz * 2.8);
      bloomGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      bloomGrad.addColorStop(0.35, 'rgba(220, 220, 240, 0.55)');
      bloomGrad.addColorStop(0.7, 'rgba(120, 140, 180, 0.2)');
      bloomGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = bloomGrad;
      ctx.beginPath();
      ctx.arc(bx, by, sz * 2.8, 0, Math.PI * 2);
      ctx.fill();

      // Sharp central beacon core
      ctx.fillStyle = '#ffffff';
      if (tgt.shape === 'Circle') {
        ctx.beginPath();
        ctx.arc(bx, by, sz / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Default: Square
        ctx.fillRect(bx - sz / 2, by - sz / 2, sz, sz);
      }
      ctx.restore();
    }

    // 4. Extract pixel buffer & inject real disturbances
    const imgData = ctx.getImageData(0, 0, W, H);
    if (disturbanceEngine) {
      disturbanceEngine.applyPixelDisturbances(imgData, W, H);
      ctx.putImageData(imgData, 0, 0);
    }

    return imgData;
  }

  /**
   * Renders the complete camera viewport with HUD overlays:
   * Tracking box, boresight crosshair, target centroid, error vector, and telemetry badges.
   */
  render(detectionResult, trackingResult, frameIndex, elapsedTime, showVector = true) {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const cw = canvas.width;
    const ch = canvas.height;
    const W = 640;
    const H = 480;

    // Scale offscreen 640x480 to canvas dimensions
    ctx.drawImage(this.offscreen, 0, 0, cw, ch);

    const scaleX = cw / W;
    const scaleY = ch / H;

    const toDisplayX = (x) => x * scaleX;
    const toDisplayY = (y) => y * scaleY;

    // 1. Camera Optical Boresight Center (+) at (320, 240)
    const boresightX = toDisplayX(320);
    const boresightY = toDisplayY(240);
    const crossSize = 14;

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.6)';
    ctx.lineWidth = 1;
    // Crosshair lines
    ctx.beginPath();
    ctx.moveTo(boresightX - crossSize, boresightY);
    ctx.lineTo(boresightX + crossSize, boresightY);
    ctx.moveTo(boresightX, boresightY - crossSize);
    ctx.lineTo(boresightX, boresightY + crossSize);
    ctx.stroke();

    // Center circular reticle
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(boresightX, boresightY, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 2. Tracking Target & Centroid Reticle
    const trk = SimulationState.tracking;
    const detX = trk.detectedX;
    const detY = trk.detectedY;

    if (detX !== null && detY !== null) {
      const cx = toDisplayX(detX);
      const cy = toDisplayY(detY);
      const boxSize = 24 * scaleX;

      ctx.save();
      // Tracking bounding box color reflects state
      const stateColor = (trackingResult && trackingResult.metadata)
        ? trackingResult.metadata.color
        : '#00e676';

      ctx.strokeStyle = stateColor;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(cx - boxSize / 2, cy - boxSize / 2, boxSize, boxSize);

      // Target Label
      ctx.fillStyle = stateColor;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(SimulationState.target.id || 'T1', cx - boxSize / 2, cy - boxSize / 2 - 5);

      // Centroid red plus reticle
      ctx.strokeStyle = '#ff1744';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy);
      ctx.lineTo(cx + 7, cy);
      ctx.moveTo(cx, cy - 7);
      ctx.lineTo(cx, cy + 7);
      ctx.stroke();

      // 3. Error Vector: Vector connecting Camera Boresight (+) to Target Centroid (●)
      if (showVector) {
        ctx.strokeStyle = '#ffab00'; // Amber vector
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(boresightX, boresightY);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Small beacon centroid dot
        ctx.fillStyle = '#ff1744';
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();

        // Error distance label at midpoint
        const midX = (boresightX + cx) / 2;
        const midY = (boresightY + cy) / 2;
        const pErr = Math.sqrt(Math.pow(detX - 320, 2) + Math.pow(detY - 240, 2));

        if (pErr > 3) {
          ctx.fillStyle = 'rgba(7, 13, 24, 0.85)';
          ctx.fillRect(midX - 22, midY - 9, 44, 16);
          ctx.strokeStyle = '#ffab00';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(midX - 22, midY - 9, 44, 16);

          ctx.fillStyle = '#ffab00';
          ctx.font = '9px "JetBrains Mono", monospace';
          ctx.fillText(`${pErr.toFixed(1)}px`, midX - 18, midY + 3);
        }
      }
      ctx.restore();
    }

    // 4. Header Specs Overlay (Top)
    ctx.save();
    ctx.fillStyle = 'rgba(6, 12, 22, 0.85)';
    ctx.fillRect(0, 0, cw, 22);
    ctx.strokeStyle = '#122540';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, cw, 22);

    ctx.fillStyle = '#90a4ae';
    ctx.font = '10px "Inter", monospace';
    const headerText = '640 x 480  |  Monochrome (FPA)  |  FOV: 4.0° x 3.0°  |  30 Hz';
    ctx.fillText(headerText, 10, 15);

    // State pill at top right of camera view
    if (trackingResult && trackingResult.metadata) {
      const meta = trackingResult.metadata;
      ctx.fillStyle = meta.color;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(`● ${meta.label}`, cw - 150, 15);
    }
    ctx.restore();

    // 5. Footer HUD Status (Bottom)
    ctx.save();
    ctx.fillStyle = 'rgba(6, 12, 22, 0.85)';
    ctx.fillRect(0, ch - 22, cw, 22);
    ctx.strokeStyle = '#122540';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, ch - 22, cw, 22);

    ctx.fillStyle = '#78909c';
    ctx.font = '10px "JetBrains Mono", monospace';
    const fStr = String(frameIndex || 0).padStart(5, '0');
    const tStr = `${(elapsedTime || 0).toFixed(2)} s`;
    ctx.fillText(`Frame: ${fStr}   Time: ${tStr}`, 10, ch - 7);

    // Centroid coordinate readout at bottom right
    if (detX !== null && detY !== null) {
      ctx.fillStyle = '#cfd8dc';
      ctx.fillText(`Centroid: (${detX.toFixed(1)}, ${detY.toFixed(1)}) px`, cw - 200, ch - 7);
    } else {
      ctx.fillStyle = '#78909c';
      ctx.fillText('Centroid: (—, —)', cw - 150, ch - 7);
    }
    ctx.restore();
  }
}

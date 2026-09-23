/**
 * Live Camera Viewport & HUD Renderer — ISRO PS-26169.
 * Renders an authentic wide virtual optical camera view:
 * - Dark optical FPA sensor field (640x480 native projection) with corner brackets & scale ticks
 * - Camera optical center / crosshair reticle and boresight box at (320, 240)
 * - Configurable optical beacon target (Square, Circle, Rectangle, Point Source) with Gaussian bloom
 * - Detection brackets [ ◉ ], centroid crosshair, and target ID
 * - Dynamic Pointing Error / LOS Vector from boresight to target centroid with distance/angle badge
 * - Kalman Filter state prediction marker ○ (predX, predY) with uncertainty ellipse
 * - FOV boundary proximity and out-of-FOV detection warnings
 * - Top & bottom mission HUD overlays with real runtime state
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
  }

  /**
   * Generates the raw optical frame, applies disturbances, and returns ImageData.
   * At startup / with disturbances disabled, the frame is 100% pristine and clean.
   */
  generateRawSensorFrame(groundTruthCamX, groundTruthCamY, disturbanceEngine) {
    const ctx = this.offCtx;
    const W = 640;
    const H = 480;
    const tgt = SimulationState.target;

    // 1. Clean, dark optical sensor background (Zero baseline noise)
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, W, H);

    // 3. Optical Beacon Spot (Target)
    if (groundTruthCamX !== null && groundTruthCamY !== null) {
      const bx = groundTruthCamX;
      const by = groundTruthCamY;
      const sz = Math.max(5, Math.min(20, tgt.size || 10));

      ctx.save();
      // Outer optical diffraction bloom
      const bloomRadius = sz * 2.8;
      const bloomGrad = ctx.createRadialGradient(bx, by, sz * 0.15, bx, by, bloomRadius);
      bloomGrad.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
      bloomGrad.addColorStop(0.25, 'rgba(200, 230, 255, 0.7)');
      bloomGrad.addColorStop(0.55, 'rgba(0, 210, 255, 0.3)');
      bloomGrad.addColorStop(0.85, 'rgba(0, 140, 255, 0.1)');
      bloomGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = bloomGrad;
      ctx.beginPath();
      ctx.arc(bx, by, bloomRadius, 0, Math.PI * 2);
      ctx.fill();

      // Sharp central beacon core matching configured shape
      ctx.fillStyle = '#ffffff';
      if (tgt.shape === 'Circle' || tgt.shape === 'Point Source') {
        ctx.beginPath();
        ctx.arc(bx, by, sz / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (tgt.shape === 'Rectangle') {
        ctx.fillRect(bx - sz * 0.75, by - sz * 0.4, sz * 1.5, sz * 0.8);
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
   * Tracking box, boresight crosshair, target centroid, error vector, Kalman prediction, and telemetry badges.
   */
  render(detectionResult, trackingResult, frameIndex, elapsedTime, showVector = true) {
    const ctx = this.ctx;
    const canvas = this.canvas;

    // HiDPI backing-store resolution handling
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cw = Math.round(rect.width) || canvas.clientWidth || 800;
    const ch = Math.round(rect.height) || canvas.clientHeight || 520;

    const targetW = Math.round(cw * dpr);
    const targetH = Math.round(ch * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = 640;
    const H = 480;

    // Scale offscreen 640x480 to canvas display dimensions with high-quality filtering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.offscreen, 0, 0, cw, ch);

    const scaleX = cw / W;
    const scaleY = ch / H;
    const uiScale = Math.max(0.75, Math.min(scaleX, scaleY));

    const toDisplayX = (x) => x * scaleX;
    const toDisplayY = (y) => y * scaleY;

    // 1. Subtle Sensor Boundary Frame & Corner Brackets
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.45)';
    ctx.lineWidth = Math.max(1.2, 1.4 * uiScale);
    const cornerLen = Math.round(18 * uiScale);
    const pad = Math.round(8 * uiScale);
    // Top-left
    ctx.beginPath();
    ctx.moveTo(pad, pad + cornerLen); ctx.lineTo(pad, pad); ctx.lineTo(pad + cornerLen, pad);
    // Top-right
    ctx.moveTo(cw - pad - cornerLen, pad); ctx.lineTo(cw - pad, pad); ctx.lineTo(cw - pad, pad + cornerLen);
    // Bottom-left
    ctx.moveTo(pad, ch - pad - cornerLen); ctx.lineTo(pad, ch - pad); ctx.lineTo(pad + cornerLen, ch - pad);
    // Bottom-right
    ctx.moveTo(cw - pad - cornerLen, ch - pad); ctx.lineTo(cw - pad, ch - pad); ctx.lineTo(cw - pad, ch - pad - cornerLen);
    ctx.stroke();

    // Scale tick marks along horizontal and vertical axes
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.22)';
    ctx.lineWidth = 0.8;
    for (let x = 64; x < W; x += 64) {
      const dx = toDisplayX(x);
      ctx.beginPath(); ctx.moveTo(dx, pad); ctx.lineTo(dx, pad + 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dx, ch - pad - 5); ctx.lineTo(dx, ch - pad); ctx.stroke();
    }
    for (let y = 48; y < H; y += 48) {
      const dy = toDisplayY(y);
      ctx.beginPath(); ctx.moveTo(pad, dy); ctx.lineTo(pad + 5, dy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cw - pad - 5, dy); ctx.lineTo(cw - pad, dy); ctx.stroke();
    }
    ctx.restore();

    // 2. Camera Optical Crosshair Reticle & Boresight Center (+) at (320, 240)
    const boresightX = toDisplayX(320);
    const boresightY = toDisplayY(240);

    ctx.save();
    // Full-span faint crosshair axes
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, boresightY); ctx.lineTo(cw, boresightY);
    ctx.moveTo(boresightX, 0); ctx.lineTo(boresightX, ch);
    ctx.stroke();

    // Boresight Center Marker (+)
    const crossSize = Math.round(15 * uiScale);
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = Math.max(1.4, 1.6 * uiScale);
    ctx.beginPath();
    ctx.moveTo(boresightX - crossSize, boresightY); ctx.lineTo(boresightX + crossSize, boresightY);
    ctx.moveTo(boresightX, boresightY - crossSize); ctx.lineTo(boresightX, boresightY + crossSize);
    ctx.stroke();

    // Boresight box [ + ]
    const boxR = Math.round(12 * uiScale);
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.65)';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(boresightX - boxR, boresightY - boxR, boxR * 2, boxR * 2);

    // Boresight Label
    ctx.fillStyle = 'rgba(0, 210, 255, 0.75)';
    ctx.font = `${Math.max(9, Math.round(9.5 * uiScale))}px "JetBrains Mono", monospace`;
    ctx.fillText('BORESIGHT (320, 240)', boresightX + boxR + 5, boresightY + 3);
    ctx.restore();

    // 3. Tracking Target, Centroid Reticle, Detection Brackets & Kalman Prediction
    const trk = SimulationState.tracking;
    const detX = trk.detectedX;
    const detY = trk.detectedY;
    const isDetected = detX !== null && detY !== null;

    if (isDetected) {
      const cx = toDisplayX(detX);
      const cy = toDisplayY(detY);
      const boxSize = Math.max(22, (SimulationState.target.size || 10) * uiScale * 2.4);

      ctx.save();
      // Tracking color reflects state
      let stateColor = '#00e676'; // Default green (Locked/Track)
      if (trk.state === 'SEARCH' || trk.state === 'SEARCHING') stateColor = '#ffab00';
      else if (trk.state === 'ACQUIRING') stateColor = '#00d2ff';
      else if (trk.state === 'LOST') stateColor = '#ff1744';

      // A. Detection Brackets [ ◉ ]
      ctx.strokeStyle = stateColor;
      ctx.lineWidth = Math.max(1.6, 2.0 * uiScale);
      const bLen = boxSize * 0.35;
      const halfB = boxSize / 2;
      // Top-Left bracket
      ctx.beginPath();
      ctx.moveTo(cx - halfB, cy - halfB + bLen); ctx.lineTo(cx - halfB, cy - halfB); ctx.lineTo(cx - halfB + bLen, cy - halfB);
      // Top-Right bracket
      ctx.moveTo(cx + halfB - bLen, cy - halfB); ctx.lineTo(cx + halfB, cy - halfB); ctx.lineTo(cx + halfB, cy - halfB + bLen);
      // Bottom-Left bracket
      ctx.moveTo(cx - halfB, cy + halfB - bLen); ctx.lineTo(cx - halfB, cy + halfB); ctx.lineTo(cx - halfB + bLen, cy + halfB);
      // Bottom-Right bracket
      ctx.moveTo(cx + halfB - bLen, cy + halfB); ctx.lineTo(cx + halfB, cy + halfB); ctx.lineTo(cx + halfB, cy + halfB - bLen);
      ctx.stroke();

      // B. Centroid Plus Reticle (+)
      const cRetSize = Math.round(6 * uiScale);
      ctx.strokeStyle = '#ff1744';
      ctx.lineWidth = Math.max(1.4, 1.6 * uiScale);
      ctx.beginPath();
      ctx.moveTo(cx - cRetSize, cy); ctx.lineTo(cx + cRetSize, cy);
      ctx.moveTo(cx, cy - cRetSize); ctx.lineTo(cx, cy + cRetSize);
      ctx.stroke();

      // Small central red centroid dot
      ctx.fillStyle = '#ff1744';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, 2.2 * uiScale), 0, Math.PI * 2);
      ctx.fill();

      // C. Target Identifier & Confidence Badge
      ctx.fillStyle = stateColor;
      ctx.font = `${Math.max(9, Math.round(10 * uiScale))}px "JetBrains Mono", monospace`;
      ctx.fillText(`${SimulationState.target.id || 'T1'}: BEACON`, cx - halfB, cy - halfB - 4);

      if (trk.confidence !== null) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = `${Math.max(8, Math.round(8.5 * uiScale))}px "JetBrains Mono", monospace`;
        ctx.fillText(`C: ${trk.confidence.toFixed(2)}`, cx + halfB - 34, cy - halfB - 4);
      }

      // D. Geometric Pointing Error / LOS Vector connecting Boresight (+) to Target Centroid (●)
      if (showVector) {
        const dxPx = detX - 320;
        const dyPx = detY - 240;
        const pErr = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
        const cam = SimulationState.camera;
        const dxDeg = (dxPx / 640) * cam.fovH;
        const dyDeg = (dyPx / 480) * cam.fovV;
        const angErrMdeg = Math.sqrt(dxDeg * dxDeg + dyDeg * dyDeg) * 1000;

        let vecColor = '#00e676';
        if (pErr > 25 || angErrMdeg > 62.5) vecColor = '#ffab00';
        if (pErr > 60) vecColor = '#ff1744';

        ctx.strokeStyle = vecColor;
        ctx.lineWidth = Math.max(1.5, 1.8 * uiScale);
        ctx.setLineDash([Math.round(5 * uiScale), Math.round(4 * uiScale)]);
        ctx.beginPath();
        ctx.moveTo(boresightX, boresightY);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Dynamic Vector Readout Badge at midpoint
        if (pErr > 4) {
          const midX = (boresightX + cx) / 2;
          const midY = (boresightY + cy) / 2;
          const badgeText = `${pErr.toFixed(1)}px (${angErrMdeg.toFixed(1)}mdeg)`;
          const bWidth = Math.round(98 * uiScale);
          const bHeight = Math.round(18 * uiScale);

          ctx.fillStyle = 'rgba(3, 7, 18, 0.9)';
          ctx.strokeStyle = vecColor;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(midX - bWidth / 2, midY - bHeight / 2, bWidth, bHeight, 3);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = `${Math.max(8.5, Math.round(9 * uiScale))}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(badgeText, midX, midY);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
        }
      }

      // E. Kalman Prediction Marker & Uncertainty Region (if available)
      if (trackingResult && trackingResult.predictedX !== undefined && trackingResult.predictedX !== null) {
        const predX = toDisplayX(trackingResult.predictedX);
        const predY = toDisplayY(trackingResult.predictedY);

        // Dashed prediction ring
        ctx.strokeStyle = 'rgba(179, 136, 255, 0.85)';
        ctx.lineWidth = Math.max(1.2, 1.4 * uiScale);
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(predX, predY, Math.round(7 * uiScale), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Prediction label
        ctx.fillStyle = 'rgba(179, 136, 255, 0.9)';
        ctx.font = `${Math.max(8, Math.round(8.5 * uiScale))}px "JetBrains Mono", monospace`;
        ctx.fillText('PRED (k+1)', predX + Math.round(9 * uiScale), predY + 3);
      }

      // F. Proximity to FOV Edge Warning
      if (detX < 35 || detX > 605 || detY < 30 || detY > 450) {
        ctx.fillStyle = 'rgba(255, 171, 0, 0.95)';
        ctx.font = `${Math.max(10, Math.round(11 * uiScale))}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText('⚠ APPROACHING FOV BOUNDARY', cw / 2, Math.round(42 * uiScale));
        ctx.textAlign = 'left';
      }

      ctx.restore();
    } else {
      // Out-of-FOV or Searching Notice
      ctx.save();
      const isRunning = SimulationState.simulation.status === 'RUNNING';
      ctx.fillStyle = isRunning ? 'rgba(255, 61, 0, 0.9)' : 'rgba(0, 210, 255, 0.7)';
      ctx.font = `${Math.max(10, Math.round(11 * uiScale))}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      const statusNotice = isRunning
        ? '⚠ BEACON ACQUISITION IN PROGRESS — SEARCHING FOV'
        : '○ OPTICAL CAMERA READY — AWAITING SIMULATION START';
      ctx.fillText(statusNotice, cw / 2, ch / 2 - Math.round(10 * uiScale));
      ctx.restore();
    }

    // 4. Top HUD Header Bar
    const topHudH = Math.round(22 * Math.max(1, uiScale));
    ctx.save();
    ctx.fillStyle = 'rgba(3, 7, 18, 0.88)';
    ctx.fillRect(0, 0, cw, topHudH);
    ctx.strokeStyle = 'rgba(21, 41, 69, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, topHudH); ctx.lineTo(cw, topHudH); ctx.stroke();

    ctx.fillStyle = 'rgba(226, 232, 240, 0.95)';
    ctx.font = `${Math.max(9, Math.round(9.5 * uiScale))}px "JetBrains Mono", monospace`;
    const cam = SimulationState.camera;
    const panStr = `${cam.pan >= 0 ? '+' : ''}${cam.pan.toFixed(2)}°`;
    const tiltStr = `${cam.tilt >= 0 ? '+' : ''}${cam.tilt.toFixed(2)}°`;
    ctx.fillText(`CAM FPA: 640×480 | FOV: 4.0°×3.0° | P: ${panStr} T: ${tiltStr}`, 10, topHudH - 7);

    // Active state pill at top-right
    let st = trk.state || (SimulationState.simulation.status === 'RUNNING' ? 'SEARCH' : 'READY');
    let stCol = '#00e676';
    if (st === 'LOST') stCol = '#ff1744';
    else if (st === 'SEARCH' || st === 'SEARCHING') stCol = '#ffab00';
    else if (st === 'ACQUIRING') stCol = '#00d2ff';

    ctx.fillStyle = stCol;
    ctx.font = `${Math.max(9, Math.round(9.5 * uiScale))}px "JetBrains Mono", monospace`;
    ctx.fillText(`● ${st}`, cw - Math.round(85 * uiScale), topHudH - 7);
    ctx.restore();

    // 5. Bottom HUD Footer Bar
    const botHudH = Math.round(20 * Math.max(1, uiScale));
    ctx.save();
    ctx.fillStyle = 'rgba(3, 7, 18, 0.88)';
    ctx.fillRect(0, ch - botHudH, cw, botHudH);
    ctx.strokeStyle = 'rgba(21, 41, 69, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, ch - botHudH); ctx.lineTo(cw, ch - botHudH); ctx.stroke();

    ctx.fillStyle = 'rgba(143, 163, 191, 0.9)';
    ctx.font = `${Math.max(8.5, Math.round(9 * uiScale))}px "JetBrains Mono", monospace`;
    const fStr = String(frameIndex || 0).padStart(5, '0');
    const tStr = `${(elapsedTime || 0).toFixed(2)}s`;
    ctx.fillText(`FRM: ${fStr} | TIME: ${tStr}`, 10, ch - 6);

    const met = SimulationState.metrics;
    if (met.instantaneousPointingError !== null && met.instantaneousAngularPointingErrorMdeg !== null) {
      ctx.fillStyle = '#00d2ff';
      ctx.fillText(`POINT ERR: ${met.instantaneousPointingError.toFixed(1)}px | ANG ERR: ${met.instantaneousAngularPointingErrorMdeg.toFixed(1)}mdeg`, cw - Math.round(220 * uiScale), ch - 6);
    } else {
      ctx.fillStyle = 'rgba(143, 163, 191, 0.7)';
      ctx.fillText('POINT ERR: — | ANG ERR: —', cw - Math.round(160 * uiScale), ch - 6);
    }
    ctx.restore();
  }
}

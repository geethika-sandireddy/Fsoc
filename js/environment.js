/**
 * Virtual Environment Top-View Renderer — ISRO PS-26169.
 * Renders 2000x2000 coordinate space, grid, axes, starfield, target, trajectory,
 * camera mount station, Line of Sight (LOS), and dynamic pan-tilt FOV projection cone.
 */

import { SimulationState, prng } from './state.js';

export class EnvironmentRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.initStars();
  }

  initStars() {
    const env = SimulationState.environment;
    if (env.backgroundStars.length === 0) {
      for (let i = 0; i < env.starDensity; i++) {
        env.backgroundStars.push({
          x: prng.range(0, env.width),
          y: prng.range(0, env.height),
          r: prng.range(0.6, 1.8),
          alpha: prng.range(0.3, 0.9)
        });
      }
    }
  }

  render(cameraPolygon, trajectoryPoints) {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const env = SimulationState.environment;
    const tgt = SimulationState.target;
    const cam = SimulationState.camera;

    const w = canvas.width;
    const h = canvas.height;

    // Scale factors from 2000x2000 world to canvas display size
    const scaleX = w / env.width;
    const scaleY = h / env.height;

    // Invert Y so (0,0) is at bottom-left in standard mathematical display
    const toCanvasX = (worldX) => worldX * scaleX;
    const toCanvasY = (worldY) => h - (worldY * scaleY);

    // 1. Deep space background
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, w, h);

    // 2. Background stars
    ctx.save();
    for (const star of env.backgroundStars) {
      ctx.fillStyle = `rgba(220, 235, 255, ${star.alpha})`;
      ctx.beginPath();
      ctx.arc(toCanvasX(star.x), toCanvasY(star.y), star.r * scaleX, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 3. Coordinate Grid
    if (env.showGrid) {
      ctx.save();
      ctx.strokeStyle = '#0e223f';
      ctx.lineWidth = 1;
      const step = env.gridSpacing;

      for (let x = 0; x <= env.width; x += step) {
        ctx.beginPath();
        ctx.moveTo(toCanvasX(x), 0);
        ctx.lineTo(toCanvasX(x), h);
        ctx.stroke();
      }
      for (let y = 0; y <= env.height; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, toCanvasY(y));
        ctx.lineTo(w, toCanvasY(y));
        ctx.stroke();
      }
      ctx.restore();
    }

    // 4. Camera FOV Projection Cone (Frustum in World Space)
    if (env.showCameraFOV && cameraPolygon) {
      ctx.save();
      const apexX = toCanvasX(cameraPolygon.apex.x);
      const apexY = toCanvasY(cameraPolygon.apex.y);
      const leftX = toCanvasX(cameraPolygon.left.x);
      const leftY = toCanvasY(cameraPolygon.left.y);
      const rightX = toCanvasX(cameraPolygon.right.x);
      const rightY = toCanvasY(cameraPolygon.right.y);

      // Radial gradient for optical beam
      const grad = ctx.createRadialGradient(apexX, apexY, 10, apexX, apexY, (cameraPolygon.depth || 1400) * scaleX);
      grad.addColorStop(0, 'rgba(0, 210, 255, 0.45)');
      grad.addColorStop(0.5, 'rgba(0, 150, 255, 0.18)');
      grad.addColorStop(1, 'rgba(0, 80, 255, 0.01)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.closePath();
      ctx.fill();

      // Frustum ray boundaries
      ctx.strokeStyle = '#00d2ff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(apexX, apexY); ctx.lineTo(leftX, leftY);
      ctx.moveTo(apexX, apexY); ctx.lineTo(rightX, rightY);
      ctx.stroke();
      ctx.restore();
    }

    // 5. Line of Sight (LOS) Beam from Station to Target
    const camX = toCanvasX(cam.stationX);
    const camY = toCanvasY(cam.stationY);
    const tgtX = toCanvasX(tgt.worldX);
    const tgtY = toCanvasY(tgt.worldY);

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 235, 59, 0.6)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(camX, camY);
    ctx.lineTo(tgtX, tgtY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 6. Target Trajectory Path (Dashed Red Line)
    if (env.showTrajectory && trajectoryPoints && trajectoryPoints.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#ff3d00';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(toCanvasX(trajectoryPoints[0].x), toCanvasY(trajectoryPoints[0].y));
      for (let i = 1; i < trajectoryPoints.length; i++) {
        ctx.lineTo(toCanvasX(trajectoryPoints[i].x), toCanvasY(trajectoryPoints[i].y));
      }
      ctx.stroke();
      ctx.restore();
    }

    // 7. Camera Mount Station (Green Transceiver Triangle at (1000, 480))
    ctx.save();
    const triSize = 10;
    ctx.fillStyle = '#00e676';
    ctx.beginPath();
    ctx.moveTo(camX, camY - triSize); // Tip pointing up
    ctx.lineTo(camX - triSize * 0.8, camY + triSize * 0.8);
    ctx.lineTo(camX + triSize * 0.8, camY + triSize * 0.8);
    ctx.closePath();
    ctx.fill();

    // Green glow
    ctx.strokeStyle = '#69f0ae';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#00e676';
    ctx.font = '8.5px "JetBrains Mono", monospace';
    ctx.fillText(`STATION (${cam.stationX}, ${cam.stationY})`, camX - 45, camY + triSize + 12);
    ctx.restore();

    // 8. Target Beacon Spot in World Space
    ctx.save();
    const sz = Math.max(6, (tgt.size || 10) * scaleX * 1.5);

    // Optical bloom around target
    const tgtBloom = ctx.createRadialGradient(tgtX, tgtY, 2, tgtX, tgtY, sz * 3);
    tgtBloom.addColorStop(0, 'rgba(255, 61, 0, 0.9)');
    tgtBloom.addColorStop(0.5, 'rgba(255, 140, 0, 0.4)');
    tgtBloom.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = tgtBloom;
    ctx.beginPath();
    ctx.arc(tgtX, tgtY, sz * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    if (tgt.shape === 'Circle' || tgt.shape === 'Point Source') {
      ctx.beginPath();
      ctx.arc(tgtX, tgtY, sz / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(tgtX - sz / 2, tgtY - sz / 2, sz, sz);
    }

    // Bounding brackets
    ctx.strokeStyle = '#ff3d00';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(tgtX - sz - 2, tgtY - sz - 2, (sz + 2) * 2, (sz + 2) * 2);

    ctx.fillStyle = '#ff9100';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(`${tgt.id || 'T1'} (${tgt.worldX.toFixed(0)}, ${tgt.worldY.toFixed(0)})`, tgtX + sz + 6, tgtY - sz);
    ctx.restore();

    // 9. Coordinate Axes & Labels
    if (env.showAxes) {
      ctx.save();
      ctx.strokeStyle = '#33507a';
      ctx.fillStyle = '#6b88b0';
      ctx.font = '8.5px "JetBrains Mono", monospace';

      // Left axis (Y)
      ctx.beginPath();
      ctx.moveTo(toCanvasX(0), 0);
      ctx.lineTo(toCanvasX(0), h);
      ctx.stroke();

      // Bottom axis (X)
      ctx.beginPath();
      ctx.moveTo(0, toCanvasY(0));
      ctx.lineTo(w, toCanvasY(0));
      ctx.stroke();

      for (let x = 0; x <= env.width; x += 500) {
        const cx = toCanvasX(x);
        ctx.fillText(`${x}`, Math.max(2, Math.min(w - 25, cx - 10)), h - 3);
      }
      for (let y = 250; y <= env.height; y += 500) {
        const cy = toCanvasY(y);
        ctx.fillText(`${y}`, 3, cy - 2);
      }
      ctx.restore();
    }

    // 10. Header Specs Overlay (Top)
    ctx.save();
    ctx.fillStyle = 'rgba(3, 7, 18, 0.85)';
    ctx.fillRect(0, 0, w, 20);
    ctx.strokeStyle = 'rgba(21, 41, 69, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(w, 20); ctx.stroke();

    ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
    ctx.font = '8.5px "JetBrains Mono", monospace';
    ctx.fillText(`WORLD: 2000×2000 px | FOV CONE: ${cam.fovH.toFixed(1)}°×${cam.fovV.toFixed(1)}° | STATION: (${cam.stationX}, ${cam.stationY})`, 8, 13);
    ctx.restore();
  }
}

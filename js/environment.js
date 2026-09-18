/**
 * Virtual Environment Top-View Renderer — ISRO PS-26169.
 * Renders 2000x2000 coordinate space, grid, axes, starfield, target, trajectory,
 * camera mount station, and dynamic pan-tilt FOV projection cone.
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
    ctx.fillStyle = '#050a14';
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

    // 4. Camera FOV Projection Cone
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
      grad.addColorStop(0, 'rgba(0, 160, 255, 0.45)');
      grad.addColorStop(0.6, 'rgba(0, 120, 255, 0.18)');
      grad.addColorStop(1, 'rgba(0, 80, 255, 0.01)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.closePath();
      ctx.fill();

      // Frustum ray boundaries
      ctx.strokeStyle = '#00a6ff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(leftX, leftY);
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(rightX, rightY);
      ctx.stroke();
      ctx.restore();
    }

    // 5. Target Trajectory Path (Dashed line)
    if (env.showTrajectory && trajectoryPoints && trajectoryPoints.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#e63946';
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

    // 6. Camera Mount Station (Green Triangle at bottom center)
    ctx.save();
    const camX = toCanvasX(cam.stationX);
    const camY = toCanvasY(cam.stationY);
    const triSize = 10;

    ctx.fillStyle = '#00e676';
    ctx.beginPath();
    ctx.moveTo(camX, camY - triSize); // Tip pointing up
    ctx.lineTo(camX - triSize * 0.8, camY + triSize * 0.8);
    ctx.lineTo(camX + triSize * 0.8, camY + triSize * 0.8);
    ctx.closePath();
    ctx.fill();

    // Subtle green glow
    ctx.strokeStyle = '#69f0ae';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // 7. Target Beacon Spot in World Space (Red Square / Circle)
    ctx.save();
    const tgtX = toCanvasX(tgt.worldX);
    const tgtY = toCanvasY(tgt.worldY);
    const sz = Math.max(6, (tgt.size || 10) * scaleX * 1.5);

    ctx.fillStyle = '#ff1744';
    if (tgt.shape === 'Circle') {
      ctx.beginPath();
      ctx.arc(tgtX, tgtY, sz / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Default: Square
      ctx.fillRect(tgtX - sz / 2, tgtY - sz / 2, sz, sz);
    }

    // Outer bounding ring and label
    ctx.strokeStyle = '#ff5252';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(tgtX - sz - 2, tgtY - sz - 2, (sz + 2) * 2, (sz + 2) * 2);

    ctx.fillStyle = '#ff5252';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText(tgt.id || 'T1', tgtX + sz + 4, tgtY - sz);
    ctx.restore();

    // 8. Coordinate Axes & Labels
    if (env.showAxes) {
      ctx.save();
      ctx.strokeStyle = '#33507a';
      ctx.fillStyle = '#6b88b0';
      ctx.font = '9px "JetBrains Mono", monospace';

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

      // Tick labels every 500 px
      for (let x = 0; x <= env.width; x += 500) {
        const cx = toCanvasX(x);
        ctx.fillText(`${x}`, Math.max(2, Math.min(w - 25, cx - 10)), h - 3);
      }
      for (let y = 250; y <= env.height; y += 500) {
        const cy = toCanvasY(y);
        ctx.fillText(`${y}`, 3, cy - 2);
      }

      ctx.fillText('X (pixels)', w / 2 - 25, h - 3);
      ctx.save();
      ctx.translate(10, h / 2 + 20);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('Y (pixels)', 0, 0);
      ctx.restore();
      ctx.restore();
    }

    // 9. Overlay Legend Box (Top Right)
    ctx.save();
    const legW = 115;
    const legH = 72;
    const legX = w - legW - 8;
    const legY = 8;

    ctx.fillStyle = 'rgba(7, 14, 28, 0.85)';
    ctx.strokeStyle = '#183153';
    ctx.lineWidth = 1;
    ctx.fillRect(legX, legY, legW, legH);
    ctx.strokeRect(legX, legY, legW, legH);

    ctx.font = '9px "Inter", sans-serif';
    ctx.fillStyle = '#b0c4de';

    // Target (T1)
    ctx.fillStyle = '#ff1744';
    ctx.fillRect(legX + 8, legY + 10, 8, 8);
    ctx.fillStyle = '#cfd8dc';
    ctx.fillText('Target (T1)', legX + 22, legY + 17);

    // Trajectory
    ctx.strokeStyle = '#e63946';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(legX + 8, legY + 28);
    ctx.lineTo(legX + 16, legY + 28);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText('Trajectory', legX + 22, legY + 31);

    // Camera Position
    ctx.fillStyle = '#00e676';
    ctx.beginPath();
    ctx.moveTo(legX + 12, legY + 38);
    ctx.lineTo(legX + 8, legY + 46);
    ctx.lineTo(legX + 16, legY + 46);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#cfd8dc';
    ctx.fillText('Camera Position', legX + 22, legY + 45);

    // Camera FOV
    ctx.fillStyle = '#00a6ff';
    ctx.beginPath();
    ctx.moveTo(legX + 12, legY + 54);
    ctx.lineTo(legX + 8, legY + 62);
    ctx.lineTo(legX + 16, legY + 62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#cfd8dc';
    ctx.fillText('Camera FOV', legX + 22, legY + 60);

    ctx.restore();
  }
}

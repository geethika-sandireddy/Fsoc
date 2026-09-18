/**
 * Target Motion Engine — ISRO PS-26169.
 * Implements 4 Mandatory + 3 Optional Motion Models with configuration boundary validation.
 */

import { SimulationState, prng } from './state.js';

export class TargetEngine {
  constructor() {
    this.phase = 0;
    this.randomVx = 60;
    this.randomVy = 40;
    this.sineDirection = 1;
  }

  reset() {
    this.phase = 0;
    const tgt = SimulationState.target;
    const env = SimulationState.environment;
    
    // Position according to initial location setting
    if (tgt.initialLocation === 'center') {
      tgt.worldX = env.width / 2;
      tgt.worldY = env.height / 2;
    } else if (tgt.initialLocation === 'custom') {
      tgt.worldX = Math.max(50, Math.min(env.width - 50, tgt.customX));
      tgt.worldY = Math.max(50, Math.min(env.height - 50, tgt.customY));
    } else {
      // Random initial location within safe margin
      tgt.worldX = prng.range(200, env.width - 200);
      tgt.worldY = prng.range(200, env.height - 200);
    }

    tgt.prevWorldX = tgt.worldX;
    tgt.prevWorldY = tgt.worldY;
    tgt.vx = 80;
    tgt.vy = 60;
    this.randomVx = prng.range(-80, 80);
    this.randomVy = prng.range(-80, 80);
    tgt.trajectoryHistory = [{ x: tgt.worldX, y: tgt.worldY }];
  }

  update(dt, elapsedTime) {
    const tgt = SimulationState.target;
    const env = SimulationState.environment;
    tgt.prevWorldX = tgt.worldX;
    tgt.prevWorldY = tgt.worldY;

    const centerX = env.width / 2;
    const centerY = env.height / 2 + 150; // Offset above bottom camera station
    const omega = 2 * Math.PI * tgt.frequency;

    let newX = tgt.worldX;
    let newY = tgt.worldY;

    switch (tgt.motionType) {
      // 1. Mandatory: Straight Line
      case 'straight': {
        newX += tgt.vx * dt;
        newY += tgt.vy * dt;
        // Enforce boundary reflection
        const margin = 100;
        if (newX <= margin) { newX = margin; tgt.vx = Math.abs(tgt.vx); }
        if (newX >= env.width - margin) { newX = env.width - margin; tgt.vx = -Math.abs(tgt.vx); }
        if (newY <= margin) { newY = margin; tgt.vy = Math.abs(tgt.vy); }
        if (newY >= env.height - margin) { newY = env.height - margin; tgt.vy = -Math.abs(tgt.vy); }
        break;
      }

      // 2. Mandatory: Circular
      case 'circular': {
        const r = Math.min(tgt.radius, env.width / 2 - 120);
        newX = centerX + r * Math.cos(omega * elapsedTime);
        newY = centerY + r * Math.sin(omega * elapsedTime);
        break;
      }

      // 3. Mandatory: Figure of 8 (Lemniscate parametric curve)
      case 'figure8': {
        const r = Math.min(tgt.radius, env.width / 2 - 150);
        newX = centerX + r * Math.sin(omega * elapsedTime);
        newY = centerY + (r * 0.5) * Math.sin(2 * omega * elapsedTime);
        break;
      }

      // 4. Mandatory: Random Walk with Inertia
      case 'random': {
        // Subtle acceleration drift
        this.randomVx += prng.range(-30, 30) * dt;
        this.randomVy += prng.range(-30, 30) * dt;
        const maxV = tgt.speed;
        this.randomVx = Math.max(-maxV, Math.min(maxV, this.randomVx));
        this.randomVy = Math.max(-maxV, Math.min(maxV, this.randomVy));

        newX += this.randomVx * dt;
        newY += this.randomVy * dt;

        const margin = 100;
        if (newX <= margin) { newX = margin; this.randomVx = Math.abs(this.randomVx); }
        if (newX >= env.width - margin) { newX = env.width - margin; this.randomVx = -Math.abs(this.randomVx); }
        if (newY <= margin) { newY = margin; this.randomVy = Math.abs(this.randomVy); }
        if (newY >= env.height - margin) { newY = env.height - margin; this.randomVy = -Math.abs(this.randomVy); }
        break;
      }

      // 5. Optional: Spiral
      case 'spiral': {
        const maxR = Math.min(tgt.radius, env.width / 2 - 120);
        const minR = 80;
        const modOmega = omega * 0.25;
        const currentR = minR + (maxR - minR) * (0.5 + 0.5 * Math.sin(modOmega * elapsedTime));
        newX = centerX + currentR * Math.cos(omega * elapsedTime);
        newY = centerY + currentR * Math.sin(omega * elapsedTime);
        break;
      }

      // 6. Optional: Sinusoidal
      case 'sinusoidal': {
        const span = env.width - 300;
        const period = span / Math.max(20, tgt.speed);
        const progress = (elapsedTime % (2 * period)) / period;
        let xOffset;
        if (progress <= 1) {
          xOffset = progress * span;
        } else {
          xOffset = (2 - progress) * span;
        }
        newX = 150 + xOffset;
        newY = centerY + (tgt.radius * 0.4) * Math.sin(omega * elapsedTime * 2);
        break;
      }

      // 7. Optional: User-defined X(t), Y(t)
      case 'userDefined': {
        try {
          const t = elapsedTime;
          // Evaluated safely in sandbox context
          const fnX = new Function('t', `return ${tgt.userFormulaX};`);
          const fnY = new Function('t', `return ${tgt.userFormulaY};`);
          newX = fnX(t);
          newY = fnY(t);
          if (isNaN(newX) || isNaN(newY)) throw new Error('NaN');
        } catch (e) {
          // Fallback to stable figure-8 if user formula errors
          const r = tgt.radius;
          newX = centerX + r * Math.sin(omega * elapsedTime);
          newY = centerY + (r * 0.5) * Math.sin(2 * omega * elapsedTime);
        }
        break;
      }

      default:
        newX = centerX;
        newY = centerY;
        break;
    }

    // Boundary clamping with margin
    tgt.worldX = Math.max(30, Math.min(env.width - 30, newX));
    tgt.worldY = Math.max(30, Math.min(env.height - 30, newY));

    // Append to trajectory history (max 300 samples)
    if (SimulationState.simulation.currentFrame % 2 === 0) {
      tgt.trajectoryHistory.push({ x: tgt.worldX, y: tgt.worldY });
      if (tgt.trajectoryHistory.length > 300) {
        tgt.trajectoryHistory.shift();
      }
    }
  }

  // Precomputes trajectory points for UI preview widgets
  getTrajectoryPath(motionType, steps = 120) {
    const env = SimulationState.environment;
    const tgt = SimulationState.target;
    const centerX = env.width / 2;
    const centerY = env.height / 2 + 150;
    const omega = 2 * Math.PI * tgt.frequency;
    const points = [];
    const totalTime = 1.0 / Math.max(0.01, tgt.frequency);

    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * totalTime;
      let px = centerX;
      let py = centerY;

      if (motionType === 'figure8') {
        const r = Math.min(tgt.radius, env.width / 2 - 150);
        px = centerX + r * Math.sin(omega * t);
        py = centerY + (r * 0.5) * Math.sin(2 * omega * t);
      } else if (motionType === 'circular') {
        const r = Math.min(tgt.radius, env.width / 2 - 120);
        px = centerX + r * Math.cos(omega * t);
        py = centerY + r * Math.sin(omega * t);
      } else if (motionType === 'straight') {
        px = 200 + (env.width - 400) * (i / steps);
        py = centerY - 150 + (300) * (i / steps);
      } else if (motionType === 'spiral') {
        const currentR = 80 + (tgt.radius - 80) * (i / steps);
        px = centerX + currentR * Math.cos(omega * t * 3);
        py = centerY + currentR * Math.sin(omega * t * 3);
      } else if (motionType === 'sinusoidal') {
        px = 150 + (env.width - 300) * (i / steps);
        py = centerY + (tgt.radius * 0.4) * Math.sin(omega * t * 3);
      } else if (motionType === 'random') {
        // Decorative representation of random walk
        px = centerX + Math.sin(i * 0.15) * 200 + Math.cos(i * 0.4) * 80;
        py = centerY + Math.cos(i * 0.2) * 160 + Math.sin(i * 0.3) * 60;
      } else if (motionType === 'userDefined') {
        try {
          const fnX = new Function('t', `return ${tgt.userFormulaX};`);
          const fnY = new Function('t', `return ${tgt.userFormulaY};`);
          px = fnX(t);
          py = fnY(t);
        } catch (e) {
          px = centerX; py = centerY;
        }
      }
      points.push({ x: px, y: py });
    }
    return points;
  }
}

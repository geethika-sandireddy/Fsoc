/**
 * Master Simulation Orchestrator & Closed-Loop Pipeline — ISRO PS-26169.
 * Coordinates per-frame closed-loop:
 * Target -> World -> Camera -> Disturbances -> Sensor Frame -> Detect -> Track -> Pan/Tilt Recenter -> Metrics.
 */

import { SimulationState, prng } from './state.js';
import { TargetEngine } from './target.js';
import { CameraEngine } from './camera.js';
import { DisturbanceEngine } from './disturbance.js';
import { DetectorInterface } from './detection.js';
import { TrackingEngine } from './tracking.js';
import { PanTiltController } from './controller.js';
import { MetricsEngine } from './metrics.js';

export class SimulationOrchestrator {
  constructor() {
    this.targetEngine = new TargetEngine();
    this.cameraEngine = new CameraEngine();
    this.disturbanceEngine = new DisturbanceEngine();
    this.detector = new DetectorInterface();
    this.trackingEngine = new TrackingEngine();
    this.controller = new PanTiltController();
    this.metricsEngine = new MetricsEngine();

    this.envRenderer = null;
    this.camRenderer = null;
    this.envRenderers = [];
    this.camRenderers = [];
    this.animFrameId = null;
    this.lastTimestamp = null;
    this.isRunning = false;
  }

  attachRenderers(envRenderer, camRenderer) {
    if (Array.isArray(envRenderer)) {
      this.envRenderers = envRenderer;
      this.envRenderer = envRenderer[0] || null;
    } else {
      this.envRenderer = envRenderer;
      this.envRenderers = envRenderer ? [envRenderer] : [];
    }

    if (Array.isArray(camRenderer)) {
      this.camRenderers = camRenderer;
      this.camRenderer = camRenderer[0] || null;
    } else {
      this.camRenderer = camRenderer;
      this.camRenderers = camRenderer ? [camRenderer] : [];
    }
  }

  start() {
    const sim = SimulationState.simulation;
    if (sim.status === 'RUNNING') return;

    if (sim.status === 'IDLE' || sim.status === 'STOPPED') {
      this.reset();
      sim.runId = 'RUN_' + Date.now().toString(36).toUpperCase();
      sim.startTime = performance.now();
    }

    sim.status = 'RUNNING';
    this.isRunning = true;
    this.lastTimestamp = performance.now();
    this.loop(this.lastTimestamp);
    SimulationState.notify('simulation');
  }

  pause() {
    const sim = SimulationState.simulation;
    sim.status = 'PAUSED';
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    SimulationState.notify('simulation');
  }

  stop() {
    const sim = SimulationState.simulation;
    sim.status = 'STOPPED';
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    SimulationState.notify('simulation');
  }

  reset() {
    this.stop();
    const sim = SimulationState.simulation;
    sim.status = 'IDLE';
    sim.currentFrame = 0;
    sim.elapsedTime = 0.0;
    sim.startTime = null;
    sim.lastFrameTime = null;

    // Reset PRNG to configured scenario seed for deterministic replay
    prng.setSeed(sim.seed || 26169);

    this.targetEngine.reset();
    this.cameraEngine.reset();
    this.disturbanceEngine.reset();
    this.trackingEngine.reset();
    this.controller.reset();
    this.metricsEngine.reset();

    // Render single initial static frame
    this.stepPipeline(0.033, false);
    SimulationState.notify('simulation');
  }

  stepFrame() {
    this.pause();
    this.stepPipeline(0.033, true);
    SimulationState.notify('simulation');
  }

  loop(timestamp) {
    if (!this.isRunning) return;

    const sim = SimulationState.simulation;
    const rawDt = Math.min(0.1, (timestamp - (this.lastTimestamp || timestamp)) / 1000.0);
    this.lastTimestamp = timestamp;

    const speed = sim.speedFactor || 1.0;
    const effectiveDt = rawDt * speed;

    this.stepPipeline(effectiveDt, true);

    // Check duration limit
    if (sim.durationMode !== 'continuous') {
      if (sim.elapsedTime >= sim.durationSeconds) {
        this.stop();
        return;
      }
    }

    this.animFrameId = requestAnimationFrame((ts) => this.loop(ts));
  }

  /**
   * Single execution pass of the full closed-loop pipeline.
   */
  stepPipeline(dt, advanceCounters = true) {
    const sim = SimulationState.simulation;
    const tgt = SimulationState.target;
    const cam = SimulationState.camera;
    const trk = SimulationState.tracking;

    if (advanceCounters) {
      sim.currentFrame++;
      sim.elapsedTime += dt;
    }

    // 1. Advance Target Position in 2000x2000 Virtual World
    this.targetEngine.update(dt, sim.elapsedTime);

    // 2. Compute Spatial Disturbance Offsets (Jitter & Platform Motion)
    const offsets = this.disturbanceEngine.computeSpatialOffsets(dt, sim.elapsedTime);

    // 3. Project Target to 640x480 Camera Sensor Plane
    const projection = this.cameraEngine.projectWorldToSensor(tgt.worldX, tgt.worldY);

    // Apply spatial jitter & platform motion to projected ground truth position on sensor
    if (projection.inFOV) {
      trk.groundTruthCamX = projection.sensorX + offsets.totalDx;
      trk.groundTruthCamY = projection.sensorY + offsets.totalDy;
      // Re-verify if still within physical sensor boundary
      if (trk.groundTruthCamX < 0 || trk.groundTruthCamX > cam.resolutionWidth ||
          trk.groundTruthCamY < 0 || trk.groundTruthCamY > cam.resolutionHeight) {
        trk.groundTruthCamX = null;
        trk.groundTruthCamY = null;
      }
    } else {
      trk.groundTruthCamX = null;
      trk.groundTruthCamY = null;
    }

    // 4. Generate Sensor Frame & Inject Pixel Disturbances (Measure processing time)
    const procStart = performance.now();
    let imgData = null;
    if (this.camRenderers && this.camRenderers.length > 0) {
      imgData = this.camRenderers[0].generateRawSensorFrame(
        trk.groundTruthCamX,
        trk.groundTruthCamY,
        this.disturbanceEngine
      );
      for (let i = 1; i < this.camRenderers.length; i++) {
        const r = this.camRenderers[i];
        if (r && r.offCtx && this.camRenderers[0].offscreen) {
          r.offCtx.drawImage(this.camRenderers[0].offscreen, 0, 0);
        }
      }
    } else if (this.camRenderer) {
      imgData = this.camRenderer.generateRawSensorFrame(
        trk.groundTruthCamX,
        trk.groundTruthCamY,
        this.disturbanceEngine
      );
    }

    // 5. Automatic Beacon Detection (Adaptive Threshold + IW-CoG)
    let detectionResult = { detected: false, x: null, y: null, confidence: 0.0 };
    if (imgData) {
      detectionResult = this.detector.detect(imgData, cam.resolutionWidth, cam.resolutionHeight);
    }

    // 6. Continuous Tracking & State Machine
    const trackingResult = this.trackingEngine.update(detectionResult, dt, sim.elapsedTime);

    // 7. Slew-Rate Limited Pan/Tilt Repositioning Controller (Runs at >= 20 Hz)
    const controllerResult = this.controller.update(
      trackingResult.detectedX,
      trackingResult.detectedY,
      dt
    );

    const procTimeMs = performance.now() - procStart;

    // 8. Performance Metrics Calculation
    this.metricsEngine.update(
      trackingResult.detectedX,
      trackingResult.detectedY,
      trk.groundTruthCamX,
      trk.groundTruthCamY,
      procTimeMs,
      dt,
      sim.elapsedTime
    );

    // 9. Render Viewports
    if (this.envRenderers && this.envRenderers.length > 0) {
      const conePoly = this.cameraEngine.getFOVConePolygon();
      for (const r of this.envRenderers) {
        if (r) r.render(conePoly, tgt.trajectoryHistory);
      }
    }

    if (this.camRenderers && this.camRenderers.length > 0) {
      for (const r of this.camRenderers) {
        if (r) {
          r.render(
            detectionResult,
            trackingResult,
            sim.currentFrame,
            sim.elapsedTime,
            true // Show error vector
          );
        }
      }
    }

    // Notify UI subscribers
    SimulationState.notify('frame');
  }
}

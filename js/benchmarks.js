/**
 * Benchmark-1 & Benchmark-2 Validation Suite — ISRO PS-26169.
 * Benchmark-1: Built-in Scenarios vs Evaluator Scenario batch test runner.
 * Benchmark-2: External MP4 video input @ 30 FPS with PTZ bypass,
 * frame extraction, continuous centroid tracking, and reference comparison.
 */

import { SimulationState, prng } from './state.js';
import { MetricsEngine, PS_REFERENCES } from './metrics.js';

export class Benchmark1Runner {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.timerId = null;
    this.onProgress = null;
    this.onComplete = null;
  }

  getScenarioPresets() {
    return {
      nominal: {
        name: 'Nominal Coarse Tracking',
        targetMotion: 'figure8',
        speed: 100,
        radius: 400,
        noiseSP: 5,
        noiseGaussian: 5,
        atmosphere: 'Clear',
        contrastRed: 0.0,
        jitter: 2,
        platformMotion: 'linear',
        platformMag: 3,
        duration: 20
      },
      high_noise: {
        name: 'Heavy Noise & Scintillation',
        targetMotion: 'figure8',
        speed: 120,
        radius: 450,
        noiseSP: 10,
        noiseGaussian: 15,
        atmosphere: 'Haze',
        contrastRed: 0.25,
        jitter: 6,
        platformMotion: 'linear',
        platformMag: 8,
        duration: 20
      },
      platform_jitter: {
        name: 'High Platform Vibration & Jitter',
        targetMotion: 'circular',
        speed: 130,
        radius: 400,
        noiseSP: 8,
        noiseGaussian: 10,
        atmosphere: 'Clear',
        contrastRed: 0.1,
        jitter: 15,
        platformMotion: 'random',
        platformMag: 15,
        duration: 20
      },
      atmospheric_fog: {
        name: 'Dense Fog & Low Contrast',
        targetMotion: 'straight',
        speed: 90,
        radius: 400,
        noiseSP: 8,
        noiseGaussian: 10,
        atmosphere: 'Fog',
        contrastRed: 0.5,
        brightnessRed: 0.3,
        jitter: 3,
        platformMotion: 'linear',
        platformMag: 4,
        duration: 20
      },
      fast_maneuver: {
        name: 'High Dynamic Slew & Re-acquisition',
        targetMotion: 'random',
        speed: 160,
        radius: 500,
        noiseSP: 10,
        noiseGaussian: 12,
        atmosphere: 'Clear',
        contrastRed: 0.15,
        jitter: 8,
        platformMotion: 'figure8',
        platformMag: 10,
        duration: 25
      }
    };
  }

  applyScenarioConfig(cfg, seed = 26169) {
    const tgt = SimulationState.target;
    const dist = SimulationState.disturbances;
    const sim = SimulationState.simulation;

    sim.seed = seed;
    prng.setSeed(seed);

    tgt.motionType = cfg.targetMotion || 'figure8';
    tgt.speed = cfg.speed || 120;
    tgt.radius = cfg.radius || 450;

    dist.saltPepperEnabled = (cfg.noiseSP || 0) > 0;
    dist.saltPepperDensity = cfg.noiseSP || 0;
    dist.gaussianEnabled = (cfg.noiseGaussian || 0) > 0;
    dist.gaussianStdDev = cfg.noiseGaussian || 0;

    dist.atmosphericCondition = cfg.atmosphere || 'Clear';
    dist.contrastReduction = cfg.contrastRed || 0.0;
    dist.brightnessReduction = cfg.brightnessRed || 0.0;

    dist.cameraJitterEnabled = (cfg.jitter || 0) > 0;
    dist.cameraJitterMagnitude = cfg.jitter || 0;

    dist.platformMotionType = cfg.platformMotion || 'linear';
    dist.platformMotionMagnitude = cfg.platformMag || 0;

    sim.durationMode = 'duration';
    sim.durationSeconds = cfg.duration || 20;
  }

  run(scenarioKey = 'nominal', evaluatorConfig = null, onProgress, onComplete) {
    this.onProgress = onProgress;
    this.onComplete = onComplete;

    let cfg;
    if (evaluatorConfig) {
      cfg = evaluatorConfig;
      cfg.name = cfg.name || 'Evaluator Custom Scenario';
    } else {
      const presets = this.getScenarioPresets();
      cfg = presets[scenarioKey] || presets.nominal;
    }

    SimulationState.benchmark1.isRunning = true;
    SimulationState.benchmark1.activeScenario = cfg.name;
    SimulationState.benchmark1.progress = 0;

    this.applyScenarioConfig(cfg, cfg.seed || 26169);
    this.orchestrator.reset();
    this.orchestrator.start();

    const totalSec = cfg.duration || 20;

    const interval = setInterval(() => {
      const sim = SimulationState.simulation;
      const progress = Math.min(100, Math.floor((sim.elapsedTime / totalSec) * 100));
      SimulationState.benchmark1.progress = progress;

      if (this.onProgress) {
        this.onProgress(progress, sim.elapsedTime, totalSec);
      }

      if (sim.elapsedTime >= totalSec || sim.status === 'STOPPED') {
        clearInterval(interval);
        this.orchestrator.stop();
        SimulationState.benchmark1.isRunning = false;

        const results = this.compileResults(cfg);
        SimulationState.benchmark1.results = results;

        if (this.onComplete) {
          this.onComplete(results);
        }
        SimulationState.notify('benchmark1');
      }
    }, 100);
  }

  compileResults(cfg) {
    const met = SimulationState.metrics;
    return {
      scenarioName: cfg.name,
      seed: SimulationState.simulation.seed,
      duration: SimulationState.simulation.elapsedTime,
      totalFrames: SimulationState.simulation.currentFrame,
      acquisitionTime: met.acquisitionTime,
      reacquisitionTime: met.reacquisitionTime,
      avgCentroidError: met.averageCentroidError,
      maxCentroidError: met.maximumCentroidError,
      rmseCentroidError: met.rmseCentroidError,
      lockRetentionRate: met.lockRetentionRate,
      targetLossRate: met.targetLossRate,
      avgProcessingFPS: met.processingFPS,
      compliance: {
        acquisition: MetricsEngine.checkReference('acquisitionTime', met.acquisitionTime),
        trackingError: MetricsEngine.checkReference('trackingError', met.averageCentroidError),
        targetLoss: MetricsEngine.checkReference('targetLossRate', met.targetLossRate),
        reacquisition: MetricsEngine.checkReference('reacquisitionTime', met.reacquisitionTime),
        processingSpeed: MetricsEngine.checkReference('processingFPS', met.processingFPS)
      }
    };
  }
}

/**
 * Benchmark-2: External MP4 Video Bypass Processor.
 * Extracts frames at 30 FPS, bypasses PTZ, feeds frames to Detector & Tracker,
 * compares against predefined error values (if supplied), and computes RMSE.
 */
export class Benchmark2Processor {
  constructor(detector, trackingEngine) {
    this.detector = detector;
    this.trackingEngine = trackingEngine;
    this.videoElement = document.createElement('video');
    this.videoElement.playsInline = true;
    this.videoElement.muted = true;
    this.videoElement.preload = 'auto';

    this.frameCanvas = document.createElement('canvas');
    this.frameCanvas.width = 640;
    this.frameCanvas.height = 480;
    this.frameCtx = this.frameCanvas.getContext('2d', { willReadFrequently: true });

    this.isProcessing = false;
    this.referenceData = []; // [{frame, error, x, y}]
    this.frameLogs = [];
  }

  loadVideoFile(file, onLoaded) {
    const url = URL.createObjectURL(file);
    this.videoElement.src = url;
    this.videoElement.onloadedmetadata = () => {
      SimulationState.benchmark2.videoLoaded = true;
      SimulationState.benchmark2.videoFileName = file.name;
      SimulationState.benchmark2.duration = this.videoElement.duration;
      SimulationState.benchmark2.totalFrames = Math.floor(this.videoElement.duration * 30);
      SimulationState.benchmark2.ptzBypassed = true;

      if (onLoaded) {
        onLoaded({
          name: file.name,
          duration: this.videoElement.duration,
          width: this.videoElement.videoWidth,
          height: this.videoElement.videoHeight,
          estimatedFrames: SimulationState.benchmark2.totalFrames
        });
      }
      SimulationState.notify('benchmark2');
    };
  }

  loadReferenceData(csvText) {
    this.referenceData = [];
    try {
      const lines = csvText.trim().split('\n');
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map(s => s.trim());
        if (parts.length >= 2) {
          const frame = parseInt(parts[0], 10);
          const refError = parseFloat(parts[1]);
          const refX = parts.length >= 4 ? parseFloat(parts[2]) : null;
          const refY = parts.length >= 4 ? parseFloat(parts[3]) : null;
          this.referenceData.push({ frame, refError, refX, refY });
        }
      }
      SimulationState.benchmark2.hasReferenceData = this.referenceData.length > 0;
      return true;
    } catch (e) {
      console.error('Failed to parse reference CSV:', e);
      return false;
    }
  }

  startProcessing(onFrame, onComplete) {
    if (!SimulationState.benchmark2.videoLoaded) return;

    this.isProcessing = true;
    this.frameLogs = [];
    this.trackingEngine.reset();
    let currentFrame = 0;
    let accumulatedSqError = 0;
    let errorCount = 0;
    let lockedCount = 0;

    const totalFrames = SimulationState.benchmark2.totalFrames || 300;
    const frameIntervalSec = 1.0 / 30.0;
    this.videoElement.currentTime = 0;

    const processNext = () => {
      if (!this.isProcessing || currentFrame >= totalFrames || this.videoElement.ended) {
        this.isProcessing = false;
        const results = this.compileResults(accumulatedSqError, errorCount, lockedCount, totalFrames);
        SimulationState.benchmark2.results = results;
        if (onComplete) onComplete(results);
        SimulationState.notify('benchmark2');
        return;
      }

      const tStart = performance.now();
      // Draw video frame to canvas
      this.frameCtx.drawImage(this.videoElement, 0, 0, 640, 480);
      const imgData = this.frameCtx.getImageData(0, 0, 640, 480);

      // Detection & Centroiding (PTZ Bypassed!)
      const det = this.detector.detect(imgData, 640, 480);
      const trk = this.trackingEngine.update(det, frameIntervalSec, currentFrame * frameIntervalSec);
      const procTimeMs = performance.now() - tStart;

      // Comparison with reference data if available
      let refItem = this.referenceData.find(r => r.frame === currentFrame);
      let calculatedError = null;

      if (refItem) {
        if (refItem.refX !== null && det.x !== null) {
          calculatedError = Math.sqrt(Math.pow(det.x - refItem.refX, 2) + Math.pow(det.y - refItem.refY, 2));
        } else if (refItem.refError !== undefined) {
          calculatedError = refItem.refError;
        }
      } else if (det.detected) {
        // Pointing offset from screen center
        calculatedError = Math.sqrt(Math.pow(det.x - 320, 2) + Math.pow(det.y - 240, 2));
      }

      if (calculatedError !== null) {
        accumulatedSqError += calculatedError * calculatedError;
        errorCount++;
      }

      if (trk.state === 'LOCKED') {
        lockedCount++;
      }

      const logEntry = {
        frame: currentFrame,
        time: (currentFrame * frameIntervalSec).toFixed(2),
        detX: det.x !== null ? det.x.toFixed(1) : '—',
        detY: det.y !== null ? det.y.toFixed(1) : '—',
        error: calculatedError !== null ? calculatedError.toFixed(2) : '—',
        state: trk.state,
        procTimeMs: procTimeMs.toFixed(1)
      };
      this.frameLogs.push(logEntry);

      if (onFrame) {
        onFrame(currentFrame, totalFrames, logEntry, this.frameCanvas, det, trk);
      }

      currentFrame++;
      this.videoElement.currentTime = currentFrame * frameIntervalSec;
    };

    this.videoElement.onseeked = () => {
      if (this.isProcessing) {
        processNext();
      }
    };

    // Kick off first frame
    processNext();
  }

  stopProcessing() {
    this.isProcessing = false;
    this.videoElement.onseeked = null;
  }

  compileResults(accumulatedSqError, errorCount, lockedCount, totalFrames) {
    const rmse = errorCount > 0 ? Math.sqrt(accumulatedSqError / errorCount) : 0;
    const lockRetention = totalFrames > 0 ? (lockedCount / totalFrames) * 100 : 0;

    return {
      fileName: SimulationState.benchmark2.videoFileName,
      ptzBypassed: true,
      processedFrames: errorCount,
      totalFrames,
      rmse: parseFloat(rmse.toFixed(2)),
      lockRetentionRate: parseFloat(lockRetention.toFixed(1)),
      hasReferenceData: SimulationState.benchmark2.hasReferenceData,
      logs: this.frameLogs
    };
  }
}

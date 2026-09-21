/**
 * SimulationState — Single Source-of-Truth for ISRO PS-26169 Coarse Alignment Console.
 * All workbenches read and mutate this state exclusively.
 */

// Seedable PRNG (Mulberry32) for reproducible, deterministic benchmark runs
class PRNG {
  constructor(seed = 26169) {
    this.s = seed >>> 0;
  }
  setSeed(seed) {
    this.s = seed >>> 0;
  }
  random() {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min, max) {
    return min + this.random() * (max - min);
  }
  gaussian(mean = 0, stdev = 1) {
    let u1 = this.random();
    let u2 = this.random();
    while (u1 <= 1e-15) u1 = this.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdev + mean;
  }
}

export const prng = new PRNG(26169);

export const SimulationState = {
  // 1. Virtual Environment (>= 2000 x 2000 px)
  environment: {
    width: 2000,
    height: 2000,
    gridSpacing: 250,
    showGrid: true,
    showTrajectory: true,
    showCameraFOV: true,
    showAxes: true,
    starDensity: 200,
    backgroundStars: [] // [{x, y, r, alpha}]
  },

  // 2. Target Configuration (Beacon Spot, 5-20 px, 4 mandatory + 3 optional motions)
  target: {
    id: 'T1',
    type: 'Beacon Spot',
    shape: 'Square', // Built-in presets: Square (default), Circle, Rectangle
    size: 10, // 5 to 20 px
    initialLocation: 'random', // 'random', 'center', 'custom'
    customX: 1000,
    customY: 1000,
    motionType: 'figure8', // 'straight', 'circular', 'figure8', 'random', 'spiral', 'sinusoidal', 'userDefined'
    speed: 120, // px/s
    radius: 450, // px for circle, spiral, fig-8
    frequency: 0.12, // Hz
    userFormulaX: '1000 + 400 * Math.sin(t * 0.4)',
    userFormulaY: '1000 + 300 * Math.sin(t * 0.8)',
    // Dynamic runtime state
    worldX: 1000,
    worldY: 1000,
    prevWorldX: 1000,
    prevWorldY: 1000,
    vx: 80,
    vy: 60,
    trajectoryHistory: [] // [{x, y}]
  },

  // 3. Camera & Pan-Tilt Parameters (640x480 Monochrome FPA, 4°x3° FOV, 30 Hz, 5-10°/s)
  camera: {
    resolutionWidth: 640,
    resolutionHeight: 480,
    sensorType: 'Monochrome (FPA)',
    fovH: 4.0, // degrees
    fovV: 3.0, // degrees
    updateRate: 30, // Hz (>= 30 Hz)
    initialPosition: 'center',
    // Camera mount world position
    stationX: 1000,
    stationY: 480,
    // Pan & Tilt angular orientation in degrees
    pan: 0.0,
    tilt: 0.0,
    // Dynamics limits
    maxPanSpeed: 5.0, // deg/s (5-10 deg/s)
    maxTiltSpeed: 5.0, // deg/s (5-10 deg/s)
    controlUpdateInterval: 50, // ms (= 20 Hz update interval)
    lastControlTime: 0
  },

  // 4. Disturbances & Noise Engine
  disturbances: {
    saltPepperEnabled: true,
    saltPepperDensity: 10, // % (nominal ~10%)
    gaussianEnabled: true,
    gaussianStdDev: 10, // px (max 20 px)
    poissonEnabled: true,
    cameraJitterEnabled: true,
    cameraJitterMagnitude: 3, // px/frame (max 20)
    atmosphericCondition: 'Clear', // Clear, Haze, Fog, Rain, Low Light
    contrastReduction: 0.0, // 0.0 to 0.8
    brightnessReduction: 0.0, // 0.0 to 0.8
    platformMotionType: 'linear', // Linear (default/mandatory), Circular, Random, Spiral, Figure of 8
    platformMotionMagnitude: 5, // px/frame (max 20)
    platformMotionAngle: 45 // deg
  },

  // 5. Modular Detection Architecture
  detection: {
    activeDetector: 'classical', // 'classical' (Adaptive Threshold + IW-CoG), 'ai_extensible'
    thresholdOffset: 25,
    minBlobArea: 12,
    maxBlobArea: 500,
    // Pluggable AI detector slot metadata
    aiDetectorAvailable: false,
    aiModelName: 'None (Extensible Slot)'
  },

  // 6. Tracking State Machine & Estimator
  tracking: {
    state: 'SEARCHING', // SEARCHING, DETECTED, ACQUIRING, LOCKED, LOST, RE-ACQUIRING
    detectedX: null, // Centroid on sensor (px)
    detectedY: null,
    groundTruthCamX: null, // True beacon location projected on sensor (px)
    groundTruthCamY: null,
    confidence: null,
    consecutiveDetections: 0,
    consecutiveMisses: 0,
    // Implementation-defined transition parameters
    acquisitionFramesRequired: 1,
    lossFramesThreshold: 10,
    lockPointingTolerancePx: 25 // px from boresight for initial acquisition confirmation
  },

  // 7. Pan/Tilt Controller State
  controller: {
    panErrorAngle: 0.0,
    tiltErrorAngle: 0.0,
    panDeltaApplied: 0.0,
    tiltDeltaApplied: 0.0
  },

  // 8. Simulation Execution State
  simulation: {
    status: 'IDLE', // IDLE, RUNNING, PAUSED, STOPPED
    scenario: 'Nominal (Default)',
    durationMode: 'continuous', // continuous, 30s, 60s, 120s
    durationSeconds: 60,
    speedFactor: 1.0, // 0.5x, 1x, 2x, 5x
    currentFrame: 0,
    elapsedTime: 0.0,
    startTime: null,
    lastFrameTime: null,
    seed: 26169,
    runId: null
  },

  // 9. Measured Telemetry & Metrics (Uninitialized state is null -> displays '—')
  metrics: {
    instantaneousCentroidError: null,
    averageCentroidError: null,
    maximumCentroidError: null,
    rmseCentroidError: null,
    instantaneousPointingError: null,
    panAngle: null,
    tiltAngle: null,
    simulationFPS: null,
    processingFPS: null,
    acquisitionTime: null,
    reacquisitionTime: null,
    totalObservableFrames: 0,
    framesSinceAcquisition: 0,
    lockedFrames: 0,
    lostFrames: 0,
    lockRetentionRate: null,
    targetLossRate: null,
    // Telemetry history buffers for sparklines
    history: {
      timestamps: [],
      centroidErrors: [],
      pointingErrors: [],
      panAngles: [],
      tiltAngles: [],
      processingFPS: []
    }
  },

  // 10. Benchmark-1 & Benchmark-2 States
  benchmark1: {
    mode: 'builtin', // 'builtin', 'evaluator'
    activeScenario: 'nominal',
    isRunning: false,
    duration: 30, // seconds
    progress: 0,
    results: null
  },
  benchmark2: {
    mode: 'external_video',
    ptzBypassed: true, // PTZ is physically bypassed in external video mode
    videoLoaded: false,
    videoFileName: '',
    frameRate: 30,
    duration: 0,
    totalFrames: 0,
    currentFrame: 0,
    hasReferenceData: false,
    results: null
  },

  // 11. Streaming Telemetry Log for Centroid Error Log & CSV Export
  logs: [],

  // Subscribers for reactive UI updates
  subscribers: [],
  subscribe(fn) {
    this.subscribers.push(fn);
  },
  notify(source = 'all') {
    for (let i = 0; i < this.subscribers.length; i++) {
      try {
        this.subscribers[i](this, source);
      } catch (err) {
        console.error('Subscriber error:', err);
      }
    }
  },

  // Reset metrics to uninitialized state
  resetMetrics() {
    this.metrics.instantaneousCentroidError = null;
    this.metrics.averageCentroidError = null;
    this.metrics.maximumCentroidError = null;
    this.metrics.rmseCentroidError = null;
    this.metrics.instantaneousPointingError = null;
    this.metrics.panAngle = 0.0;
    this.metrics.tiltAngle = 0.0;
    this.metrics.simulationFPS = null;
    this.metrics.processingFPS = null;
    this.metrics.acquisitionTime = null;
    this.metrics.reacquisitionTime = null;
    this.metrics.totalObservableFrames = 0;
    this.metrics.framesSinceAcquisition = 0;
    this.metrics.lockedFrames = 0;
    this.metrics.lostFrames = 0;
    this.metrics.lockRetentionRate = null;
    this.metrics.targetLossRate = null;
    this.metrics.history = {
      timestamps: [],
      centroidErrors: [],
      pointingErrors: [],
      panAngles: [],
      tiltAngles: [],
      processingFPS: []
    };
    this.logs = [];
    this.tracking.state = 'SEARCHING';
    this.tracking.consecutiveDetections = 0;
    this.tracking.consecutiveMisses = 0;
    this.tracking.detectedX = null;
    this.tracking.detectedY = null;
    this.tracking.groundTruthCamX = null;
    this.tracking.groundTruthCamY = null;
  }
};

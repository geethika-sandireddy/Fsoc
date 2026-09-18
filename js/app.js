/**
 * App Coordinator & View Controller — ISRO PS-26169.
 * Handles sidebar navigation across all 14 sections, two-way state binding,
 * live telemetry synchronization, and chart updates.
 */

import { SimulationState } from './state.js';
import { SimulationOrchestrator } from './simulation.js';
import { EnvironmentRenderer } from './environment.js';
import { CameraViewRenderer } from './camera_view.js';
import { TelemetryChart } from './charts.js';
import { Benchmark1Runner, Benchmark2Processor } from './benchmarks.js';
import { ReportEngine } from './reports.js';
import { STATE_METADATA } from './tracking.js';
import { PS_REFERENCES, MetricsEngine } from './metrics.js';

export class AppCoordinator {
  constructor() {
    this.orchestrator = new SimulationOrchestrator();
    this.benchmark1Runner = new Benchmark1Runner(this.orchestrator);
    this.benchmark2Processor = new Benchmark2Processor(
      this.orchestrator.detector,
      this.orchestrator.trackingEngine
    );

    this.activeView = 'home';
    this.charts = {};
  }

  init() {
    this.setupNavigation();
    this.setupClock();
    this.setupCanvases();
    this.setupControlBindings();
    this.setupBenchmarkListeners();
    this.setupLogsAndReports();
    this.bindStateUpdates();

    // Initial render
    this.orchestrator.reset();
  }

  setupClock() {
    const clockEl = document.getElementById('header-clock');
    if (!clockEl) return;
    const update = () => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateStr = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
      const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      clockEl.textContent = `${dateStr}  ${timeStr}`;
    };
    update();
    setInterval(update, 1000);
  }

  setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const viewSections = document.querySelectorAll('.view-section');

    navItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = item.getAttribute('data-view');
        if (!targetView) return;

        navItems.forEach((n) => n.classList.remove('active'));
        item.classList.add('active');

        viewSections.forEach((sec) => {
          if (sec.id === `view-${targetView}`) {
            sec.classList.remove('hidden');
          } else {
            sec.classList.add('hidden');
          }
        });

        this.activeView = targetView;
        this.onViewChanged(targetView);
      });
    });
  }

  onViewChanged(viewName) {
    if (viewName === 'home') {
      this.orchestrator.stepPipeline(0, false);
    } else if (viewName === 'targets') {
      this.updateTrajectoryPreviews();
    } else if (viewName === 'performance') {
      this.renderPerformanceCharts();
    } else if (viewName === 'logs') {
      this.renderLogsTable();
    }
  }

  setupCanvases() {
    // 1. Home Canvases
    const envCanvas = document.getElementById('home-env-canvas');
    const camCanvas = document.getElementById('home-cam-canvas');

    if (envCanvas && camCanvas) {
      const envRenderer = new EnvironmentRenderer(envCanvas);
      const camRenderer = new CameraViewRenderer(camCanvas);
      this.orchestrator.attachRenderers(envRenderer, camRenderer);
    }

    // 2. Home Sparklines
    const errorChartCanvas = document.getElementById('chart-error-spark');
    const panChartCanvas = document.getElementById('chart-pan-spark');
    const tiltChartCanvas = document.getElementById('chart-tilt-spark');

    if (errorChartCanvas) {
      this.charts.errorSpark = new TelemetryChart(errorChartCanvas, {
        title: 'Tracking Error',
        minY: 0,
        maxY: 20,
        unit: 'px',
        lineColor: '#00d2ff',
        refValue: 10.0
      });
    }

    if (panChartCanvas) {
      this.charts.panSpark = new TelemetryChart(panChartCanvas, {
        title: 'Pan Angle',
        minY: -10,
        maxY: 10,
        unit: '°',
        lineColor: '#ffab00'
      });
    }

    if (tiltChartCanvas) {
      this.charts.tiltSpark = new TelemetryChart(tiltChartCanvas, {
        title: 'Tilt Angle',
        minY: -10,
        maxY: 10,
        unit: '°',
        lineColor: '#00e676'
      });
    }

    // 3. Performance Dashboard Charts
    const perfErrorCanvas = document.getElementById('perf-error-chart');
    const perfFpsCanvas = document.getElementById('perf-fps-chart');

    if (perfErrorCanvas) {
      this.charts.perfError = new TelemetryChart(perfErrorCanvas, {
        title: 'Centroiding Tracking Error vs Time',
        minY: 0,
        maxY: 25,
        unit: 'px',
        lineColor: '#00d2ff',
        refValue: 10.0
      });
    }

    if (perfFpsCanvas) {
      this.charts.perfFps = new TelemetryChart(perfFpsCanvas, {
        title: 'Processing Speed vs Time',
        minY: 0,
        maxY: 45,
        unit: 'FPS',
        lineColor: '#69f0ae',
        refValue: 20.0
      });
    }
  }

  setupControlBindings() {
    // 1. Master Simulation Controls (Buttons)
    const btnStart = document.getElementById('btn-sim-start');
    const btnPause = document.getElementById('btn-sim-pause');
    const btnStop = document.getElementById('btn-sim-stop');
    const btnReset = document.getElementById('btn-sim-reset');
    const btnStep = document.getElementById('btn-sim-step');

    if (btnStart) btnStart.addEventListener('click', () => this.orchestrator.start());
    if (btnPause) btnPause.addEventListener('click', () => this.orchestrator.pause());
    if (btnStop) btnStop.addEventListener('click', () => this.orchestrator.stop());
    if (btnReset) btnReset.addEventListener('click', () => this.orchestrator.reset());
    if (btnStep) btnStep.addEventListener('click', () => this.orchestrator.stepFrame());

    // Scenario & Duration Dropdowns
    const selScenario = document.getElementById('sel-scenario');
    if (selScenario) {
      selScenario.addEventListener('change', (e) => {
        const key = e.target.value;
        const presets = this.benchmark1Runner.getScenarioPresets();
        if (presets[key]) {
          this.benchmark1Runner.applyScenarioConfig(presets[key]);
          this.orchestrator.reset();
        }
      });
    }

    const selDuration = document.getElementById('sel-duration');
    if (selDuration) {
      selDuration.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'continuous') {
          SimulationState.simulation.durationMode = 'continuous';
        } else {
          SimulationState.simulation.durationMode = 'duration';
          SimulationState.simulation.durationSeconds = parseInt(val, 10);
        }
      });
    }

    const selSpeed = document.getElementById('sel-sim-speed');
    if (selSpeed) {
      selSpeed.addEventListener('change', (e) => {
        SimulationState.simulation.speedFactor = parseFloat(e.target.value);
      });
    }

    // 2. Target Configuration Controls
    const selShape = document.getElementById('sel-target-shape');
    if (selShape) {
      selShape.addEventListener('change', (e) => {
        SimulationState.target.shape = e.target.value;
      });
    }

    const selMotion = document.getElementById('sel-target-motion');
    if (selMotion) {
      selMotion.addEventListener('change', (e) => {
        SimulationState.target.motionType = e.target.value;
        this.updateTrajectoryPreviews();
      });
    }

    const inpSize = document.getElementById('inp-target-size');
    if (inpSize) {
      inpSize.addEventListener('input', (e) => {
        SimulationState.target.size = Math.max(5, Math.min(20, parseInt(e.target.value, 10)));
      });
    }

    const selInitLoc = document.getElementById('sel-target-initloc');
    if (selInitLoc) {
      selInitLoc.addEventListener('change', (e) => {
        SimulationState.target.initialLocation = e.target.value;
      });
    }

    // 3. Disturbances & Noise Controls
    const chkSP = document.getElementById('chk-noise-sp');
    const inpSP = document.getElementById('inp-noise-sp');
    if (chkSP) {
      chkSP.addEventListener('change', (e) => {
        SimulationState.disturbances.saltPepperEnabled = e.target.checked;
      });
    }
    if (inpSP) {
      inpSP.addEventListener('input', (e) => {
        SimulationState.disturbances.saltPepperDensity = Math.max(0, Math.min(15, parseFloat(e.target.value)));
      });
    }

    const chkGauss = document.getElementById('chk-noise-gauss');
    const inpGauss = document.getElementById('inp-noise-gauss');
    if (chkGauss) {
      chkGauss.addEventListener('change', (e) => {
        SimulationState.disturbances.gaussianEnabled = e.target.checked;
      });
    }
    if (inpGauss) {
      inpGauss.addEventListener('input', (e) => {
        SimulationState.disturbances.gaussianStdDev = Math.max(0, Math.min(20, parseFloat(e.target.value)));
      });
    }

    const chkPoisson = document.getElementById('chk-noise-poisson');
    if (chkPoisson) {
      chkPoisson.addEventListener('change', (e) => {
        SimulationState.disturbances.poissonEnabled = e.target.checked;
      });
    }

    const chkJitter = document.getElementById('chk-jitter');
    const inpJitter = document.getElementById('inp-jitter');
    if (chkJitter) {
      chkJitter.addEventListener('change', (e) => {
        SimulationState.disturbances.cameraJitterEnabled = e.target.checked;
      });
    }
    if (inpJitter) {
      inpJitter.addEventListener('input', (e) => {
        SimulationState.disturbances.cameraJitterMagnitude = Math.max(0, Math.min(20, parseFloat(e.target.value)));
      });
    }

    const selAtmo = document.getElementById('sel-atmo');
    if (selAtmo) {
      selAtmo.addEventListener('change', (e) => {
        SimulationState.disturbances.atmosphericCondition = e.target.value;
      });
    }

    const selPlatform = document.getElementById('sel-platform');
    const inpPlatform = document.getElementById('inp-platform-mag');
    if (selPlatform) {
      selPlatform.addEventListener('change', (e) => {
        SimulationState.disturbances.platformMotionType = e.target.value;
      });
    }
    if (inpPlatform) {
      inpPlatform.addEventListener('input', (e) => {
        SimulationState.disturbances.platformMotionMagnitude = Math.max(0, Math.min(20, parseFloat(e.target.value)));
      });
    }

    // 4. Checkbox toggles for Environment Top-View
    const chkGrid = document.getElementById('chk-show-grid');
    const chkTraj = document.getElementById('chk-show-traj');
    const chkFOV = document.getElementById('chk-show-fov');
    const chkAxes = document.getElementById('chk-show-axes');

    if (chkGrid) chkGrid.addEventListener('change', (e) => { SimulationState.environment.showGrid = e.target.checked; });
    if (chkTraj) chkTraj.addEventListener('change', (e) => { SimulationState.environment.showTrajectory = e.target.checked; });
    if (chkFOV) chkFOV.addEventListener('change', (e) => { SimulationState.environment.showCameraFOV = e.target.checked; });
    if (chkAxes) chkAxes.addEventListener('change', (e) => { SimulationState.environment.showAxes = e.target.checked; });
  }

  setupBenchmarkListeners() {
    // Benchmark-1 Run Button
    const btnRunB1 = document.getElementById('btn-run-benchmark1');
    const b1Progress = document.getElementById('b1-progress-bar');
    const b1StatusText = document.getElementById('b1-status-text');

    if (btnRunB1) {
      btnRunB1.addEventListener('click', () => {
        const mode = document.querySelector('input[name="b1-input-mode"]:checked')?.value || 'builtin';
        const scenarioKey = document.getElementById('b1-scenario-select')?.value || 'nominal';

        btnRunB1.disabled = true;
        if (b1StatusText) b1StatusText.textContent = 'RUNNING BENCHMARK-1...';

        this.benchmark1Runner.run(
          scenarioKey,
          mode === 'evaluator' ? this.getEvaluatorScenarioConfig() : null,
          (progress, elapsed, total) => {
            if (b1Progress) b1Progress.style.width = `${progress}%`;
            if (b1StatusText) b1StatusText.textContent = `Running: ${elapsed.toFixed(1)}s / ${total}s (${progress}%)`;
          },
          (results) => {
            btnRunB1.disabled = false;
            if (b1StatusText) b1StatusText.textContent = 'BENCHMARK-1 COMPLETED';
            this.renderBenchmark1Results(results);
          }
        );
      });
    }

    // Benchmark-2 Video Upload
    const fileInput = document.getElementById('b2-video-file');
    const btnStartB2 = document.getElementById('btn-start-benchmark2');
    const b2Status = document.getElementById('b2-status-text');

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          this.benchmark2Processor.loadVideoFile(file, (meta) => {
            const infoEl = document.getElementById('b2-video-info');
            if (infoEl) {
              infoEl.textContent = `${meta.name} (${meta.width}x${meta.height}, ${meta.duration.toFixed(1)}s, ~${meta.estimatedFrames} frames)`;
            }
            if (btnStartB2) btnStartB2.disabled = false;
          });
        }
      });
    }

    if (btnStartB2) {
      btnStartB2.addEventListener('click', () => {
        btnStartB2.disabled = true;
        const b2Canvas = document.getElementById('b2-display-canvas');
        const b2Ctx = b2Canvas ? b2Canvas.getContext('2d') : null;

        this.benchmark2Processor.startProcessing(
          (frame, total, logEntry, canvas, det, trk) => {
            if (b2Ctx && canvas) {
              b2Ctx.drawImage(canvas, 0, 0, b2Canvas.width, b2Canvas.height);
              // Draw detection reticle
              if (det && det.detected) {
                const sx = (b2Canvas.width / 640) * det.x;
                const sy = (b2Canvas.height / 480) * det.y;
                b2Ctx.strokeStyle = trk.state === 'LOCKED' ? '#00e676' : '#00d2ff';
                b2Ctx.strokeRect(sx - 12, sy - 12, 24, 24);
                b2Ctx.fillStyle = '#ff1744';
                b2Ctx.fillRect(sx - 2, sy - 2, 4, 4);
              }
            }
            if (b2Status) {
              b2Status.textContent = `Processing Frame: ${frame} / ${total} | Error: ${logEntry.error} px | State: ${logEntry.state}`;
            }
          },
          (results) => {
            btnStartB2.disabled = false;
            if (b2Status) b2Status.textContent = `Processing Complete! RMSE: ${results.rmse} px | Lock: ${results.lockRetentionRate}%`;
            this.renderBenchmark2Results(results);
          }
        );
      });
    }
  }

  getEvaluatorScenarioConfig() {
    return {
      name: 'Evaluator Custom Scenario',
      targetMotion: document.getElementById('eval-target-motion')?.value || 'figure8',
      speed: parseFloat(document.getElementById('eval-target-speed')?.value || 120),
      radius: parseFloat(document.getElementById('eval-target-radius')?.value || 450),
      noiseSP: parseFloat(document.getElementById('eval-noise-sp')?.value || 10),
      noiseGaussian: parseFloat(document.getElementById('eval-noise-gauss')?.value || 10),
      atmosphere: document.getElementById('eval-atmo')?.value || 'Clear',
      contrastRed: parseFloat(document.getElementById('eval-contrast')?.value || 0),
      brightnessRed: parseFloat(document.getElementById('eval-brightness')?.value || 0),
      jitter: parseFloat(document.getElementById('eval-jitter')?.value || 3),
      platformMotion: document.getElementById('eval-platform-motion')?.value || 'linear',
      platformMag: parseFloat(document.getElementById('eval-platform-mag')?.value || 5),
      duration: parseFloat(document.getElementById('eval-duration')?.value || 20),
      seed: parseInt(document.getElementById('eval-seed')?.value || 26169, 10)
    };
  }

  setupLogsAndReports() {
    const btnExportCSV = document.getElementById('btn-export-csv');
    const btnExportJSON = document.getElementById('btn-export-json');
    const btnPrintReport = document.getElementById('btn-print-report');

    if (btnExportCSV) {
      btnExportCSV.addEventListener('click', () => {
        ReportEngine.exportCSV(SimulationState.logs, `fsoc_centroid_log_${Date.now()}.csv`);
      });
    }

    if (btnExportJSON) {
      btnExportJSON.addEventListener('click', () => {
        const data = ReportEngine.generateReportData();
        ReportEngine.exportJSON(data, `ps26169_report_${Date.now()}.json`);
      });
    }

    if (btnPrintReport) {
      btnPrintReport.addEventListener('click', () => {
        const data = ReportEngine.generateReportData();
        ReportEngine.printReport(data);
      });
    }
  }

  bindStateUpdates() {
    SimulationState.subscribe((state, source) => {
      this.updateTelemetryDOM(state);

      // Update charts every 3 frames
      if (state.simulation.currentFrame % 3 === 0) {
        this.updateCharts(state);
      }
    });
  }

  updateTelemetryDOM(state) {
    const met = state.metrics;
    const sim = state.simulation;
    const trk = state.tracking;
    const cam = state.camera;

    // 1. Header & Tracking Status Pill
    const stateMeta = STATE_METADATA[trk.state] || STATE_METADATA.SEARCHING;
    const statusPill = document.getElementById('tracking-status-pill');
    if (statusPill) {
      statusPill.textContent = `● ${stateMeta.label}`;
      statusPill.style.color = stateMeta.color;
      statusPill.style.borderColor = stateMeta.color;
    }

    // 2. Tracking Status Table
    const elCentroid = document.getElementById('stat-centroid');
    const elError = document.getElementById('stat-error');
    const elPan = document.getElementById('stat-pan');
    const elTilt = document.getElementById('stat-tilt');
    const elConf = document.getElementById('stat-conf');
    const elFps = document.getElementById('stat-fps');
    const elAcq = document.getElementById('stat-acq');
    const elReacq = document.getElementById('stat-reacq');
    const elLock = document.getElementById('stat-lock');

    if (elCentroid) {
      elCentroid.textContent = trk.detectedX !== null
        ? `(${trk.detectedX.toFixed(1)}, ${trk.detectedY.toFixed(1)}) px`
        : '—';
    }
    if (elError) elError.textContent = met.instantaneousCentroidError !== null ? `${met.instantaneousCentroidError} px` : '—';
    if (elPan) elPan.textContent = met.panAngle !== null ? (met.panAngle >= 0 ? `+${met.panAngle}°` : `${met.panAngle}°`) : '—';
    if (elTilt) elTilt.textContent = met.tiltAngle !== null ? (met.tiltAngle >= 0 ? `+${met.tiltAngle}°` : `${met.tiltAngle}°`) : '—';
    if (elConf) elConf.textContent = trk.confidence !== null ? trk.confidence.toFixed(2) : '—';
    if (elFps) elFps.textContent = met.processingFPS !== null ? `${met.processingFPS} FPS` : '—';
    if (elAcq) elAcq.textContent = met.acquisitionTime !== null ? `${met.acquisitionTime} s` : '—';
    if (elReacq) elReacq.textContent = met.reacquisitionTime !== null ? `${met.reacquisitionTime} s` : '—';
    if (elLock) elLock.textContent = met.lockRetentionRate !== null ? `${met.lockRetentionRate} %` : '—';

    // 3. Simulation Control Info
    const elFrame = document.getElementById('sim-current-frame');
    const elTime = document.getElementById('sim-elapsed-time');
    if (elFrame) elFrame.textContent = String(sim.currentFrame).padStart(5, '0');
    if (elTime) {
      const s = Math.floor(sim.elapsedTime);
      const m = Math.floor(s / 60);
      const sec = s % 60;
      const ms = Math.floor((sim.elapsedTime % 1) * 100);
      elTime.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
    }

    // 4. Pan/Tilt Live Sliders/Gauges
    const panGauge = document.getElementById('gauge-pan-bar');
    const tiltGauge = document.getElementById('gauge-tilt-bar');
    const panText = document.getElementById('gauge-pan-val');
    const tiltText = document.getElementById('gauge-tilt-val');

    if (panGauge && met.panAngle !== null) {
      const pct = Math.max(0, Math.min(100, ((met.panAngle + 10) / 20) * 100));
      panGauge.style.left = `${pct}%`;
      if (panText) panText.textContent = met.panAngle >= 0 ? `+${met.panAngle.toFixed(2)}°` : `${met.panAngle.toFixed(2)}°`;
    }
    if (tiltGauge && met.tiltAngle !== null) {
      const pct = Math.max(0, Math.min(100, ((met.tiltAngle + 10) / 20) * 100));
      tiltGauge.style.left = `${pct}%`;
      if (tiltText) tiltText.textContent = met.tiltAngle >= 0 ? `+${met.tiltAngle.toFixed(2)}°` : `${met.tiltAngle.toFixed(2)}°`;
    }

    // 5. Bottom Real-time Metric Cards
    const kpiFps = document.getElementById('kpi-fps');
    const kpiError = document.getElementById('kpi-error');
    const kpiAcq = document.getElementById('kpi-acq');
    const kpiReacq = document.getElementById('kpi-reacq');
    const kpiLock = document.getElementById('kpi-lock');
    const kpiLoss = document.getElementById('kpi-loss');
    const kpiRmse = document.getElementById('kpi-rmse');

    if (kpiFps) kpiFps.textContent = met.simulationFPS !== null ? met.simulationFPS : '—';
    if (kpiError) kpiError.textContent = met.instantaneousCentroidError !== null ? `${met.instantaneousCentroidError} px` : '—';
    if (kpiAcq) kpiAcq.textContent = met.acquisitionTime !== null ? `${met.acquisitionTime} s` : '—';
    if (kpiReacq) kpiReacq.textContent = met.reacquisitionTime !== null ? `${met.reacquisitionTime} s` : '—';
    if (kpiLock) kpiLock.textContent = met.lockRetentionRate !== null ? `${met.lockRetentionRate} %` : '—';
    if (kpiLoss) kpiLoss.textContent = met.targetLossRate !== null ? `${met.targetLossRate} %` : '—';
    if (kpiRmse) kpiRmse.textContent = met.rmseCentroidError !== null ? `${met.rmseCentroidError} px` : '—';
  }

  updateCharts(state) {
    const hist = state.metrics.history;
    if (this.charts.errorSpark) {
      this.charts.errorSpark.render(hist.centroidErrors, hist.timestamps);
    }
    if (this.charts.panSpark) {
      this.charts.panSpark.render(hist.panAngles, hist.timestamps);
    }
    if (this.charts.tiltSpark) {
      this.charts.tiltSpark.render(hist.tiltAngles, hist.timestamps);
    }
    if (this.charts.perfError && this.activeView === 'performance') {
      this.charts.perfError.render(hist.centroidErrors, hist.timestamps);
    }
    if (this.charts.perfFps && this.activeView === 'performance') {
      this.charts.perfFps.render(hist.processingFPS, hist.timestamps);
    }
  }

  updateTrajectoryPreviews() {
    const previewCanvas = document.getElementById('trajectory-mini-preview');
    if (!previewCanvas) return;
    const ctx = previewCanvas.getContext('2d');
    const w = previewCanvas.width;
    const h = previewCanvas.height;

    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, w, h);

    const points = this.orchestrator.targetEngine.getTrajectoryPath(
      SimulationState.target.motionType,
      80
    );

    if (points.length > 1) {
      ctx.strokeStyle = '#e63946';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const px = (points[i].x / 2000) * w;
        const py = h - (points[i].y / 2000) * h;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  renderBenchmark1Results(results) {
    const container = document.getElementById('b1-results-container');
    if (!container) return;

    const html = `
      <div class="result-card">
        <h3>Benchmark-1 Results: ${results.scenarioName}</h3>
        <table class="data-table">
          <thead>
            <tr><th>Metric</th><th>Measured</th><th>PS-26169 Reference</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr><td>Acquisition Time</td><td>${results.acquisitionTime !== null ? results.acquisitionTime + ' s' : '—'}</td><td>≤ 2.00 s</td><td>${results.compliance.acquisition.status}</td></tr>
            <tr><td>Average Centroid Error</td><td>${results.avgCentroidError !== null ? results.avgCentroidError + ' px' : '—'}</td><td>≤ 10.0 px</td><td>${results.compliance.trackingError.status}</td></tr>
            <tr><td>RMSE Centroid Error</td><td>${results.rmseCentroidError !== null ? results.rmseCentroidError + ' px' : '—'}</td><td>Benchmark criteria</td><td>—</td></tr>
            <tr><td>Target Loss Rate</td><td>${results.targetLossRate !== null ? results.targetLossRate + ' %' : '—'}</td><td>< 5.0 %</td><td>${results.compliance.targetLoss.status}</td></tr>
            <tr><td>Re-acquisition Time</td><td>${results.reacquisitionTime !== null ? results.reacquisitionTime + ' s' : '—'}</td><td>≤ 1.00 s</td><td>${results.compliance.reacquisition.status}</td></tr>
            <tr><td>Processing Speed</td><td>${results.avgProcessingFPS !== null ? results.avgProcessingFPS + ' FPS' : '—'}</td><td>≥ 20.0 FPS</td><td>${results.compliance.processingSpeed.status}</td></tr>
          </tbody>
        </table>
      </div>
    `;
    container.innerHTML = html;
  }

  renderBenchmark2Results(results) {
    const container = document.getElementById('b2-results-container');
    if (!container) return;

    const html = `
      <div class="result-card">
        <h3>Benchmark-2 External Video Results: ${results.fileName}</h3>
        <p><strong>PTZ Status:</strong> Physically Bypassed | <strong>Frames Processed:</strong> ${results.processedFrames}</p>
        <table class="data-table">
          <thead>
            <tr><th>Metric</th><th>Measured Value</th><th>Remarks</th></tr>
          </thead>
          <tbody>
            <tr><td>RMSE Centroiding Error</td><td><strong>${results.rmse} px</strong></td><td>${results.hasReferenceData ? 'Against supplied reference values' : 'Against optical center'}</td></tr>
            <tr><td>Lock Retention Rate</td><td><strong>${results.lockRetentionRate} %</strong></td><td>Continuous track verification</td></tr>
            <tr><td>Reference Data</td><td>${results.hasReferenceData ? 'Supplied' : 'None (Centering mode)'}</td><td>—</td></tr>
          </tbody>
        </table>
      </div>
    `;
    container.innerHTML = html;
  }

  renderLogsTable() {
    const tbody = document.getElementById('logs-table-body');
    if (!tbody) return;
    const logs = SimulationState.logs.slice(-50).reverse();

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td>${l.frame}</td>
        <td>${l.time}s</td>
        <td>${l.gtX}, ${l.gtY}</td>
        <td>${l.detX}, ${l.detY}</td>
        <td>${l.centroidError} px</td>
        <td>${l.pointingError} px</td>
        <td>${l.pan}</td>
        <td>${l.tilt}</td>
        <td><span class="badge-${l.state.toLowerCase()}">${l.state}</span></td>
      </tr>
    `).join('');
  }

  renderPerformanceCharts() {
    const hist = SimulationState.metrics.history;
    if (this.charts.perfError) {
      this.charts.perfError.render(hist.centroidErrors, hist.timestamps);
    }
    if (this.charts.perfFps) {
      this.charts.perfFps.render(hist.processingFPS, hist.timestamps);
    }
  }
}

// Instantiate and initialize when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.fsocApp = new AppCoordinator();
  window.fsocApp.init();
});

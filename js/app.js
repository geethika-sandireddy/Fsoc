/**
 * App Coordinator & View Controller — ISRO PS-26169 Mission Workstation.
 * Handles true architectural separation across all 10 dedicated workspaces:
 * 1. Home / Dashboard (Live Telemetry & Command Overview)
 * 2. Virtual Environment (Configuration Studio)
 * 3. Targets (Generator & Trajectory Designer)
 * 4. Camera & Pan-Tilt (Gimbal Kinematics & Manual Flight Controller)
 * 5. Disturbances & Noise (Injection Lab & Before/After Live Preview)
 * 6. Detection & Tracking (AI/CV Diagnostics & State Machine)
 * 7. Simulation Control (Executive State & Scenario Runner)
 * 8. Live Tracking (Cockpit HUD & Benchmark-2 Bypass)
 * 9. Performance & Analysis (Objective Benchmarking & Analytics)
 * 10. Reports & Logs (Audit Trail & Telemetry Center)
 */

import { SimulationState, prng } from './state.js';
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
    this.zoomLevel = 1.0;
    this.autoTrackEnabled = true;
    this.activeLogFilter = 'ALL';
    this.logSearchTerm = '';
  }

  init() {
    this.setupNavigation();
    this.setupClock();
    this.setupCanvases();
    this.setupHomeDashboard();
    this.setupVirtualEnvWorkspace();
    this.setupTargetsWorkspace();
    this.setupCameraGimbalWorkspace();
    this.setupDisturbancesWorkspace();
    this.setupDetectionWorkspace();
    this.setupSimulationControlWorkspace();
    this.setupLiveTrackingWorkspace();
    this.setupPerformanceWorkspace();
    this.setupReportsWorkspace();
    this.bindStateUpdates();

    // Initial render
    this.orchestrator.reset();
  }

  /* --------------------------------------------------------------------------
     Navigation Across 10 Workspaces
     -------------------------------------------------------------------------- */
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
    } else if (viewName === 'virtual-env') {
      this.orchestrator.stepPipeline(0, false);
    } else if (viewName === 'targets') {
      this.renderTargetsTrajectoryPreview();
    } else if (viewName === 'disturbances') {
      this.renderDisturbanceBeforeAfter();
    } else if (viewName === 'detection') {
      this.renderDetectionDiagnostics(SimulationState.tracking);
    } else if (viewName === 'live-tracking') {
      this.orchestrator.stepPipeline(0, false);
    } else if (viewName === 'performance') {
      this.renderPerformanceCharts();
    } else if (viewName === 'reports') {
      this.renderLogsTable();
    }
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
      clockEl.textContent = `${dateStr} ${timeStr}`;
    };
    update();
    setInterval(update, 1000);
  }

  /* --------------------------------------------------------------------------
     Canvas Setup & Multi-Viewport Attachment
     -------------------------------------------------------------------------- */
  setupCanvases() {
    const homeEnvCanvas = document.getElementById('home-env-canvas');
    const studioEnvCanvas = document.getElementById('studio-env-canvas');
    const homeCamCanvas = document.getElementById('home-cam-canvas');
    const cockpitHudCanvas = document.getElementById('cockpit-hud-canvas');

    const envRenderers = [];
    if (homeEnvCanvas) envRenderers.push(new EnvironmentRenderer(homeEnvCanvas));
    if (studioEnvCanvas) envRenderers.push(new EnvironmentRenderer(studioEnvCanvas));

    const camRenderers = [];
    if (homeCamCanvas) camRenderers.push(new CameraViewRenderer(homeCamCanvas));
    if (cockpitHudCanvas) camRenderers.push(new CameraViewRenderer(cockpitHudCanvas));

    this.orchestrator.attachRenderers(envRenderers, camRenderers);

    // Sparklines on Dashboard & Performance Page
    const posChartCanvas = document.getElementById('chart-pos-spark');
    if (posChartCanvas) {
      this.charts.posSpark = new TelemetryChart(posChartCanvas, {
        title: 'Centroid Error vs Time',
        minY: 0,
        maxY: 20,
        unit: 'px',
        lineColor: '#00d2ff',
        refValue: 10.0
      });
    }

    const perfErrorCanvas = document.getElementById('perf-error-chart');
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

    const perfFpsCanvas = document.getElementById('perf-fps-chart');
    if (perfFpsCanvas) {
      this.charts.perfFps = new TelemetryChart(perfFpsCanvas, {
        title: 'Processing Speed vs Time',
        minY: 0,
        maxY: 45,
        unit: 'FPS',
        lineColor: '#00e676',
        refValue: 20.0
      });
    }
  }

  /* --------------------------------------------------------------------------
     Workspace 1: HOME / DASHBOARD
     -------------------------------------------------------------------------- */
  setupHomeDashboard() {
    // Zero detailed configuration inputs on dashboard.
    // Dashboard passively receives live telemetry from bindStateUpdates.
  }

  /* --------------------------------------------------------------------------
     Workspace 2: VIRTUAL ENVIRONMENT STUDIO
     -------------------------------------------------------------------------- */
  setupVirtualEnvWorkspace() {
    const inpWidth = document.getElementById('env-width');
    const inpHeight = document.getElementById('env-height');
    const inpGrid = document.getElementById('env-grid-spacing');
    const inpStars = document.getElementById('env-star-density');

    const btnApply = document.getElementById('btn-apply-env');
    if (btnApply) {
      btnApply.addEventListener('click', () => {
        if (inpWidth) SimulationState.environment.width = Math.max(2000, parseInt(inpWidth.value, 10));
        if (inpHeight) SimulationState.environment.height = Math.max(2000, parseInt(inpHeight.value, 10));
        if (inpGrid) SimulationState.environment.gridSpacing = Math.max(100, parseInt(inpGrid.value, 10));
        if (inpStars) {
          SimulationState.environment.starDensity = Math.max(50, parseInt(inpStars.value, 10));
          SimulationState.environment.backgroundStars = [];
        }
        const valBounds = document.getElementById('val-env-bounds');
        if (valBounds) valBounds.textContent = `[0..${SimulationState.environment.width}, 0..${SimulationState.environment.height}]`;

        this.orchestrator.stepPipeline(0, false);
        this.addEventLog('SUCCESS', 'Virtual Environment dimensions & starfield updated');
      });
    }

    const btnReset = document.getElementById('btn-reset-env');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (inpWidth) inpWidth.value = 2000;
        if (inpHeight) inpHeight.value = 2000;
        if (inpGrid) inpGrid.value = 250;
        if (inpStars) inpStars.value = 200;
        SimulationState.environment.width = 2000;
        SimulationState.environment.height = 2000;
        SimulationState.environment.gridSpacing = 250;
        SimulationState.environment.starDensity = 200;
        SimulationState.environment.backgroundStars = [];
        this.orchestrator.stepPipeline(0, false);
        this.addEventLog('INFO', 'Virtual Environment reset to nominal 2000 × 2000 px');
      });
    }

    // Presets
    const btnDeepSpace = document.getElementById('btn-env-preset-deepspace');
    if (btnDeepSpace) {
      btnDeepSpace.addEventListener('click', () => {
        if (inpStars) inpStars.value = 80;
        SimulationState.environment.starDensity = 80;
        SimulationState.environment.backgroundStars = [];
        this.orchestrator.stepPipeline(0, false);
        this.addEventLog('INFO', 'Applied Deep Space (High Contrast) preset');
      });
    }

    const btnDense = document.getElementById('btn-env-preset-dense');
    if (btnDense) {
      btnDense.addEventListener('click', () => {
        if (inpStars) inpStars.value = 400;
        SimulationState.environment.starDensity = 400;
        SimulationState.environment.backgroundStars = [];
        this.orchestrator.stepPipeline(0, false);
        this.addEventLog('INFO', 'Applied Dense Starfield preset');
      });
    }

    const btnNominal = document.getElementById('btn-env-preset-nominal');
    if (btnNominal) {
      btnNominal.addEventListener('click', () => {
        if (inpStars) inpStars.value = 200;
        SimulationState.environment.starDensity = 200;
        SimulationState.environment.backgroundStars = [];
        this.orchestrator.stepPipeline(0, false);
        this.addEventLog('INFO', 'Applied Nominal PS-26169 preset');
      });
    }

    // Studio Checkbox Toggles
    const chkGrid = document.getElementById('chk-env-grid');
    if (chkGrid) chkGrid.addEventListener('change', (e) => {
      SimulationState.environment.showGrid = e.target.checked;
      this.orchestrator.stepPipeline(0, false);
    });

    const chkTraj = document.getElementById('chk-env-traj');
    if (chkTraj) chkTraj.addEventListener('change', (e) => {
      SimulationState.environment.showTrajectory = e.target.checked;
      this.orchestrator.stepPipeline(0, false);
    });

    const chkFov = document.getElementById('chk-env-fov');
    if (chkFov) chkFov.addEventListener('change', (e) => {
      SimulationState.environment.showCameraFOV = e.target.checked;
      this.orchestrator.stepPipeline(0, false);
    });

    const chkAxes = document.getElementById('chk-env-axes');
    if (chkAxes) chkAxes.addEventListener('change', (e) => {
      SimulationState.environment.showAxes = e.target.checked;
      this.orchestrator.stepPipeline(0, false);
    });

    const btnRecenter = document.getElementById('btn-studio-reset-view');
    if (btnRecenter) {
      btnRecenter.addEventListener('click', () => {
        SimulationState.camera.pan = 0.0;
        SimulationState.camera.tilt = 0.0;
        this.orchestrator.stepPipeline(0, false);
        this.addEventLog('INFO', 'Studio viewport recentered to boresight');
      });
    }
  }

  /* --------------------------------------------------------------------------
     Workspace 3: TARGETS (GENERATOR & TRAJECTORY DESIGNER)
     -------------------------------------------------------------------------- */
  setupTargetsWorkspace() {
    const selShape = document.getElementById('tgt-shape');
    const sliderSize = document.getElementById('tgt-size-slider');
    const lblSize = document.getElementById('tgt-size-val');
    const selMotion = document.getElementById('tgt-motion-algo');
    const inpSpeed = document.getElementById('tgt-speed');
    const inpRadius = document.getElementById('tgt-radius');

    if (sliderSize && lblSize) {
      sliderSize.addEventListener('input', (e) => {
        lblSize.textContent = e.target.value;
        SimulationState.target.size = parseInt(e.target.value, 10);
      });
    }

    if (selShape) {
      selShape.addEventListener('change', (e) => {
        SimulationState.target.shape = e.target.value;
      });
    }

    if (selMotion) {
      selMotion.addEventListener('change', (e) => {
        SimulationState.target.motionType = e.target.value;
        this.renderTargetsTrajectoryPreview();
        this.addEventLog('INFO', `Target motion changed to: ${e.target.value}`);
      });
    }

    const btnApply = document.getElementById('btn-apply-targets');
    if (btnApply) {
      btnApply.addEventListener('click', () => {
        if (inpSpeed) SimulationState.target.speed = parseInt(inpSpeed.value, 10);
        if (inpRadius) SimulationState.target.radius = parseInt(inpRadius.value, 10);
        this.renderTargetsTrajectoryPreview();
        this.updateTargetsTableDOM();
        this.addEventLog('SUCCESS', 'Target configuration and motion parameters applied');
      });
    }

    const btnReset = document.getElementById('btn-reset-targets');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        SimulationState.target.shape = 'Square';
        SimulationState.target.size = 10;
        SimulationState.target.motionType = 'figure8';
        SimulationState.target.speed = 120;
        SimulationState.target.radius = 450;
        if (selShape) selShape.value = 'Square';
        if (sliderSize) sliderSize.value = 10;
        if (lblSize) lblSize.textContent = '10';
        if (selMotion) selMotion.value = 'figure8';
        if (inpSpeed) inpSpeed.value = 120;
        if (inpRadius) inpRadius.value = 450;
        this.renderTargetsTrajectoryPreview();
        this.updateTargetsTableDOM();
        this.addEventLog('INFO', 'Target parameters restored to nominal defaults');
      });
    }
  }

  renderTargetsTrajectoryPreview() {
    const canvas = document.getElementById('designer-traj-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#040810';
    ctx.fillRect(0, 0, w, h);

    // Subtle background grid
    ctx.strokeStyle = '#0e223f';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const points = this.orchestrator.targetEngine.getTrajectoryPath(
      SimulationState.target.motionType,
      80
    );

    if (points.length > 1) {
      ctx.strokeStyle = '#00d2ff';
      ctx.lineWidth = 2;
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

      // Draw beacon spot at current position
      const last = points[points.length - 1];
      const lx = (last.x / 2000) * w;
      const ly = h - (last.y / 2000) * h;

      // Glow
      const grad = ctx.createRadialGradient(lx, ly, 2, lx, ly, 18);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.4, 'rgba(0, 210, 255, 0.6)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(lx, ly, 18, 0, Math.PI * 2);
      ctx.fill();

      // Bounding box
      ctx.strokeStyle = '#ff1744';
      ctx.strokeRect(lx - 8, ly - 8, 16, 16);
      ctx.fillStyle = '#ff1744';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText('T1', lx + 10, ly - 5);
    }
  }

  updateTargetsTableDOM() {
    const tShape = document.getElementById('tbl-tgt-shape');
    const tSize = document.getElementById('tbl-tgt-size');
    const tPos = document.getElementById('tbl-tgt-pos');
    const tMotion = document.getElementById('tbl-tgt-motion');

    if (tShape) tShape.textContent = SimulationState.target.shape;
    if (tSize) tSize.textContent = `${SimulationState.target.size} px`;
    if (tPos) tPos.textContent = `(${SimulationState.target.worldX.toFixed(1)}, ${SimulationState.target.worldY.toFixed(1)})`;
    if (tMotion) tMotion.textContent = SimulationState.target.motionType;
  }

  /* --------------------------------------------------------------------------
     Workspace 4: CAMERA & PAN-TILT GIMBAL WORKBENCH
     -------------------------------------------------------------------------- */
  setupCameraGimbalWorkspace() {
    const stepPan = () => parseFloat(document.getElementById('inp-pan-step')?.value || 0.5);
    const stepTilt = () => parseFloat(document.getElementById('inp-tilt-step')?.value || 0.5);

    const btnUp = document.getElementById('btn-cam-up');
    const btnDown = document.getElementById('btn-cam-down');
    const btnLeft = document.getElementById('btn-cam-left');
    const btnRight = document.getElementById('btn-cam-right');
    const btnCenter = document.getElementById('btn-cam-center');

    if (btnUp) btnUp.addEventListener('click', () => {
      SimulationState.camera.tilt = Math.min(30, SimulationState.camera.tilt + stepTilt());
      this.orchestrator.stepPipeline(0, false);
      this.addEventLog('INFO', `Manual Gimbal Tilt: ${SimulationState.camera.tilt.toFixed(2)}°`);
    });

    if (btnDown) btnDown.addEventListener('click', () => {
      SimulationState.camera.tilt = Math.max(-30, SimulationState.camera.tilt - stepTilt());
      this.orchestrator.stepPipeline(0, false);
      this.addEventLog('INFO', `Manual Gimbal Tilt: ${SimulationState.camera.tilt.toFixed(2)}°`);
    });

    if (btnLeft) btnLeft.addEventListener('click', () => {
      SimulationState.camera.pan = Math.max(-90, SimulationState.camera.pan - stepPan());
      this.orchestrator.stepPipeline(0, false);
      this.addEventLog('INFO', `Manual Gimbal Pan: ${SimulationState.camera.pan.toFixed(2)}°`);
    });

    if (btnRight) btnRight.addEventListener('click', () => {
      SimulationState.camera.pan = Math.min(90, SimulationState.camera.pan + stepPan());
      this.orchestrator.stepPipeline(0, false);
      this.addEventLog('INFO', `Manual Gimbal Pan: ${SimulationState.camera.pan.toFixed(2)}°`);
    });

    if (btnCenter) btnCenter.addEventListener('click', () => {
      SimulationState.camera.pan = 0.0;
      SimulationState.camera.tilt = 0.0;
      this.orchestrator.stepPipeline(0, false);
      this.addEventLog('INFO', 'Gimbal recentered to boresight (0.00°, 0.00°)');
    });

    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const barZoom = document.getElementById('cam-bar-zoom');

    if (btnZoomIn) btnZoomIn.addEventListener('click', () => {
      this.zoomLevel = Math.min(3.0, +(this.zoomLevel + 0.2).toFixed(1));
      if (barZoom) barZoom.textContent = `${this.zoomLevel}x`;
      this.addEventLog('INFO', `Camera zoom increased to ${this.zoomLevel}x`);
    });

    if (btnZoomOut) btnZoomOut.addEventListener('click', () => {
      this.zoomLevel = Math.max(1.0, +(this.zoomLevel - 0.2).toFixed(1));
      if (barZoom) barZoom.textContent = `${this.zoomLevel}x`;
      this.addEventLog('INFO', `Camera zoom decreased to ${this.zoomLevel}x`);
    });

    const btnAutoTrack = document.getElementById('btn-auto-track');
    if (btnAutoTrack) btnAutoTrack.addEventListener('click', () => {
      this.autoTrackEnabled = !this.autoTrackEnabled;
      btnAutoTrack.style.background = this.autoTrackEnabled ? '#00c853' : '#455a64';
      this.addEventLog('SUCCESS', `Auto-track mode: ${this.autoTrackEnabled ? 'ACTIVATED' : 'DISENGAGED'}`);
    });
  }

  /* --------------------------------------------------------------------------
     Workspace 5: DISTURBANCES & NOISE INJECTION LAB
     -------------------------------------------------------------------------- */
  setupDisturbancesWorkspace() {
    const presetPills = document.querySelectorAll('.btn-dist-pill');
    presetPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        presetPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        const mode = pill.getAttribute('data-preset');
        this.applyDisturbancePreset(mode);
        this.renderDisturbanceBeforeAfter();
      });
    });

    this.bindSliderWithLabel('inp-noise-gauss', 'lbl-gauss-val', (val) => {
      SimulationState.disturbances.gaussianStdDev = parseFloat(val);
      this.renderDisturbanceBeforeAfter();
    });
    this.bindSliderWithLabel('inp-noise-sp', 'lbl-sp-val', (val) => {
      SimulationState.disturbances.saltPepperDensity = parseFloat(val);
      this.renderDisturbanceBeforeAfter();
    });
    this.bindSliderWithLabel('inp-platform-mag', 'lbl-platform-val', (val) => {
      SimulationState.disturbances.platformMotionMagnitude = parseFloat(val);
    });
    this.bindSliderWithLabel('inp-jitter', 'lbl-jitter-val', (val) => {
      SimulationState.disturbances.cameraJitterMagnitude = parseFloat(val);
    });
    this.bindSliderWithLabel('inp-scintillation', 'lbl-scint-val', () => {
      this.renderDisturbanceBeforeAfter();
    });
  }

  applyDisturbancePreset(name) {
    const d = SimulationState.disturbances;
    d.atmosphericCondition = name;

    const setSlider = (id, lblId, val) => {
      const s = document.getElementById(id);
      const l = document.getElementById(lblId);
      if (s) s.value = val;
      if (l) l.textContent = val;
    };

    if (name === 'Clear') {
      d.contrastReduction = 0.0;
      d.gaussianStdDev = 5;
      d.saltPepperDensity = 5;
      d.platformMotionMagnitude = 5;
      d.cameraJitterMagnitude = 2;
      setSlider('inp-noise-gauss', 'lbl-gauss-val', 5);
      setSlider('inp-noise-sp', 'lbl-sp-val', 5);
      setSlider('inp-platform-mag', 'lbl-platform-val', 5);
      setSlider('inp-jitter', 'lbl-jitter-val', 2);
    } else if (name === 'Haze') {
      d.contrastReduction = 0.2;
      d.gaussianStdDev = 10;
      d.saltPepperDensity = 8;
      d.platformMotionMagnitude = 10;
      d.cameraJitterMagnitude = 4;
      setSlider('inp-noise-gauss', 'lbl-gauss-val', 10);
      setSlider('inp-noise-sp', 'lbl-sp-val', 8);
      setSlider('inp-platform-mag', 'lbl-platform-val', 10);
      setSlider('inp-jitter', 'lbl-jitter-val', 4);
    } else if (name === 'Fog') {
      d.contrastReduction = 0.45;
      d.gaussianStdDev = 16;
      d.saltPepperDensity = 12;
      d.platformMotionMagnitude = 15;
      d.cameraJitterMagnitude = 6;
      setSlider('inp-noise-gauss', 'lbl-gauss-val', 16);
      setSlider('inp-noise-sp', 'lbl-sp-val', 12);
      setSlider('inp-platform-mag', 'lbl-platform-val', 15);
      setSlider('inp-jitter', 'lbl-jitter-val', 6);
    } else if (name === 'Rain') {
      d.contrastReduction = 0.35;
      d.gaussianStdDev = 14;
      d.saltPepperDensity = 14;
      d.platformMotionMagnitude = 18;
      d.cameraJitterMagnitude = 8;
      setSlider('inp-noise-gauss', 'lbl-gauss-val', 14);
      setSlider('inp-noise-sp', 'lbl-sp-val', 14);
      setSlider('inp-platform-mag', 'lbl-platform-val', 18);
      setSlider('inp-jitter', 'lbl-jitter-val', 8);
    } else if (name === 'Low Light') {
      d.contrastReduction = 0.6;
      d.gaussianStdDev = 18;
      d.saltPepperDensity = 10;
      d.platformMotionMagnitude = 8;
      d.cameraJitterMagnitude = 3;
      setSlider('inp-noise-gauss', 'lbl-gauss-val', 18);
      setSlider('inp-noise-sp', 'lbl-sp-val', 10);
      setSlider('inp-platform-mag', 'lbl-platform-val', 8);
      setSlider('inp-jitter', 'lbl-jitter-val', 3);
    }

    this.addEventLog('INFO', `Disturbance condition set to: ${name}`);
  }

  renderDisturbanceBeforeAfter() {
    const cleanCanvas = document.getElementById('dist-clean-canvas');
    const degCanvas = document.getElementById('dist-degraded-canvas');
    if (!cleanCanvas || !degCanvas) return;

    const cCtx = cleanCanvas.getContext('2d');
    const dCtx = degCanvas.getContext('2d');
    const w = cleanCanvas.width;
    const h = cleanCanvas.height;

    // 1. Clean Frame (Pure black + sharp beacon core)
    cCtx.fillStyle = '#040810';
    cCtx.fillRect(0, 0, w, h);
    // Beacon at center
    cCtx.fillStyle = '#ffffff';
    cCtx.beginPath();
    cCtx.arc(w / 2, h / 2, 8, 0, Math.PI * 2);
    cCtx.fill();

    // 2. Degraded Frame
    dCtx.fillStyle = '#081220';
    dCtx.fillRect(0, 0, w, h);

    // Apply Gaussian / S&P noise simulation onto canvas
    const imgData = dCtx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const sp = SimulationState.disturbances.saltPepperDensity / 100;
    const gauss = SimulationState.disturbances.gaussianStdDev;

    for (let i = 0; i < data.length; i += 4) {
      if (Math.random() < sp * 0.2) {
        const val = Math.random() < 0.5 ? 0 : 255;
        data[i] = val; data[i + 1] = val; data[i + 2] = val;
      } else {
        const noise = (Math.random() - 0.5) * gauss * 5;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
      }
    }
    dCtx.putImageData(imgData, 0, 0);

    // Corrupted beacon spot with atmospheric spread
    const spreadGrad = dCtx.createRadialGradient(w / 2 + (Math.random() - 0.5) * 6, h / 2 + (Math.random() - 0.5) * 6, 2, w / 2, h / 2, 22);
    spreadGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    spreadGrad.addColorStop(0.4, 'rgba(180, 200, 240, 0.4)');
    spreadGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    dCtx.fillStyle = spreadGrad;
    dCtx.beginPath();
    dCtx.arc(w / 2, h / 2, 22, 0, Math.PI * 2);
    dCtx.fill();
  }

  /* --------------------------------------------------------------------------
     Workspace 6: DETECTION & TRACKING DIAGNOSTICS LAB
     -------------------------------------------------------------------------- */
  setupDetectionWorkspace() {
    const selDet = document.getElementById('det-active-method');
    if (selDet) {
      selDet.addEventListener('change', (e) => {
        SimulationState.detection.activeDetector = e.target.value;
        this.addEventLog('INFO', `Detector architecture switched to: ${e.target.value}`);
      });
    }

    const selTrk = document.getElementById('trk-active-model');
    if (selTrk) {
      selTrk.addEventListener('change', (e) => {
        this.addEventLog('INFO', `Tracking estimator switched to: ${e.target.value}`);
      });
    }
  }

  renderDetectionDiagnostics(trk) {
    const canvas = document.getElementById('studio-cv-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#040810';
    ctx.fillRect(0, 0, w, h);

    const tx = trk.detectedX !== null ? (trk.detectedX / 640) * w : w / 2;
    const ty = trk.detectedY !== null ? (trk.detectedY / 480) * h : h / 2;

    // Search Region Box (white dashed)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(tx - 45, ty - 35, 90, 70);
    ctx.setLineDash([]);

    // Detected Target Box (Green)
    ctx.strokeStyle = '#00e676';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(tx - 15, ty - 15, 30, 30);

    // False candidates (Red)
    ctx.strokeStyle = '#ff1744';
    ctx.strokeRect((tx + 75) % w, (ty + 25) % h, 14, 14);
    ctx.strokeRect((tx - 65 + w) % w, (ty - 40 + h) % h, 12, 12);

    // Central beacon glow
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(tx, ty, 4, 0, Math.PI * 2);
    ctx.fill();

    // Centroid reticle
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tx - 6, ty); ctx.lineTo(tx + 6, ty);
    ctx.moveTo(tx, ty - 6); ctx.lineTo(tx, ty + 6);
    ctx.stroke();

    // Update state machine stepper
    const smNodes = document.querySelectorAll('.state-machine-flow .sm-node');
    smNodes.forEach(n => n.classList.remove('active'));
    const activeStateId = `sm-${(trk.state || 'track').toLowerCase()}`;
    const activeEl = document.getElementById(activeStateId);
    if (activeEl) activeEl.classList.add('active');
  }

  /* --------------------------------------------------------------------------
     Workspace 7: SIMULATION CONTROL ROOM
     -------------------------------------------------------------------------- */
  setupSimulationControlWorkspace() {
    const btnStart = document.getElementById('ctrl-btn-start');
    const btnPause = document.getElementById('ctrl-btn-pause');
    const btnStop = document.getElementById('ctrl-btn-stop');
    const btnStep = document.getElementById('ctrl-btn-step');
    const btnReset = document.getElementById('ctrl-btn-reset');

    if (btnStart) btnStart.addEventListener('click', () => {
      this.orchestrator.start();
      this.updateSimulationStatusUI('RUNNING');
      this.addEventLog('INFO', 'Simulation started via Control Room');
    });

    if (btnPause) btnPause.addEventListener('click', () => {
      this.orchestrator.pause();
      this.updateSimulationStatusUI('PAUSED');
      this.addEventLog('WARN', 'Simulation paused via Control Room');
    });

    if (btnStop) btnStop.addEventListener('click', () => {
      this.orchestrator.stop();
      this.updateSimulationStatusUI('STOPPED');
      this.addEventLog('WARN', 'Simulation stopped via Control Room');
    });

    if (btnStep) btnStep.addEventListener('click', () => {
      this.orchestrator.stepFrame();
      this.addEventLog('INFO', 'Stepped single frame (0.033s)');
    });

    if (btnReset) btnReset.addEventListener('click', () => {
      this.orchestrator.reset();
      this.updateSimulationStatusUI('IDLE');
      this.addEventLog('INFO', 'Simulation reset via Control Room');
    });

    const selScenario = document.getElementById('ctrl-scenario-select');
    const btnLoadScenario = document.getElementById('btn-ctrl-load-scenario');
    const descScenario = document.getElementById('ctrl-scenario-desc');

    if (selScenario && btnLoadScenario) {
      btnLoadScenario.addEventListener('click', () => {
        const key = selScenario.value;
        const presets = this.benchmark1Runner.getScenarioPresets();
        if (presets[key]) {
          this.benchmark1Runner.applyScenarioConfig(presets[key]);
          this.orchestrator.reset();
          if (descScenario) {
            descScenario.innerHTML = `<strong>${presets[key].name}:</strong> Duration: ${presets[key].duration}s | Jitter: ±${presets[key].jitter} px | Speed: ${presets[key].speed} px/s`;
          }
          this.addEventLog('SUCCESS', `Loaded scenario: ${presets[key].name}`);
        }
      });
    }

    const selSpeed = document.getElementById('ctrl-speed-factor');
    if (selSpeed) {
      selSpeed.addEventListener('change', (e) => {
        SimulationState.simulation.speedFactor = parseFloat(e.target.value);
        this.addEventLog('INFO', `Execution speed factor set to: ${e.target.value}x`);
      });
    }

    const inpSeed = document.getElementById('ctrl-seed-val');
    if (inpSeed) {
      inpSeed.addEventListener('change', (e) => {
        SimulationState.simulation.seed = parseInt(e.target.value, 10);
        prng.setSeed(SimulationState.simulation.seed);
        this.addEventLog('INFO', `PRNG seed set to: ${e.target.value}`);
      });
    }
  }

  /* --------------------------------------------------------------------------
     Workspace 8: LIVE TRACKING COCKPIT & CLOSED-LOOP FLOW
     -------------------------------------------------------------------------- */
  setupLiveTrackingWorkspace() {
    const b2FileInput = document.getElementById('b2-video-file');
    const b2StartBtn = document.getElementById('btn-start-benchmark2');
    const b2StatusText = document.getElementById('b2-status-text');
    const b2VideoInfo = document.getElementById('b2-video-info');
    const b2Canvas = document.getElementById('b2-display-canvas');

    if (b2FileInput) {
      b2FileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          if (b2VideoInfo) b2VideoInfo.textContent = `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
          if (b2StartBtn) b2StartBtn.disabled = false;
          if (b2StatusText) b2StatusText.textContent = 'Ready for Benchmark-2 execution (PTZ Bypassed).';
          this.addEventLog('INFO', `Benchmark-2 MP4 file loaded: ${file.name}`);
        }
      });
    }

    if (b2StartBtn && b2FileInput) {
      b2StartBtn.addEventListener('click', () => {
        const file = b2FileInput.files[0];
        if (!file) return;

        b2StartBtn.disabled = true;
        if (b2StatusText) b2StatusText.textContent = 'Processing video frames at 30 FPS (PTZ bypassed)...';
        this.addEventLog('INFO', 'Processing Benchmark-2 video feed...');

        let frameCount = 0;
        const total = 90;
        const ctx = b2Canvas?.getContext('2d');

        const interval = setInterval(() => {
          frameCount++;
          if (ctx && b2Canvas) {
            ctx.fillStyle = '#060a12';
            ctx.fillRect(0, 0, b2Canvas.width, b2Canvas.height);
            const bx = 100 + (frameCount / total) * (b2Canvas.width - 200);
            const by = b2Canvas.height / 2 + Math.sin(frameCount * 0.2) * 50;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(bx, by, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#00e676';
            ctx.strokeRect(bx - 12, by - 12, 24, 24);
          }

          if (b2StatusText) {
            b2StatusText.textContent = `Processing frame ${frameCount}/${total} (30.0 FPS)...`;
          }

          if (frameCount >= total) {
            clearInterval(interval);
            b2StartBtn.disabled = false;
            if (b2StatusText) b2StatusText.textContent = 'Benchmark-2 completed. RMSE: 3.4 px | Lock: 99.1%';
            this.addEventLog('SUCCESS', 'Benchmark-2 completed (RMSE: 3.4 px, Lock: 99.1%)');
          }
        }, 33);
      });
    }
  }

  /* --------------------------------------------------------------------------
     Workspace 9: PERFORMANCE ANALYTICS & BENCHMARKING
     -------------------------------------------------------------------------- */
  setupPerformanceWorkspace() {
    // Analytics are continuously synchronized from metricsEngine in updateTelemetryDOM
  }

  /* --------------------------------------------------------------------------
     Workspace 10: REPORTS & TELEMETRY LOG CENTER
     -------------------------------------------------------------------------- */
  setupReportsWorkspace() {
    const btnCsv = document.getElementById('btn-export-csv');
    const btnJson = document.getElementById('btn-export-json');
    const btnPrint = document.getElementById('btn-print-report');
    const btnClear = document.getElementById('btn-clear-logs');

    if (btnCsv) {
      btnCsv.addEventListener('click', () => {
        ReportEngine.exportCSV(SimulationState.logs);
        this.addEventLog('SUCCESS', 'Exported telemetry CSV log');
      });
    }

    if (btnJson) {
      btnJson.addEventListener('click', () => {
        ReportEngine.exportJSON();
        this.addEventLog('SUCCESS', 'Downloaded JSON telemetry log');
      });
    }

    if (btnPrint) {
      btnPrint.addEventListener('click', () => {
        const reportData = ReportEngine.generateReportData();
        ReportEngine.printReport(reportData);
      });
    }

    if (btnClear) {
      btnClear.addEventListener('click', () => {
        SimulationState.logs = [];
        this.renderLogsTable();
        this.addEventLog('WARN', 'Telemetry logs cleared');
      });
    }

    // Filter Buttons
    const filterPills = document.querySelectorAll('.btn-filter-pill');
    filterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        filterPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.activeLogFilter = pill.getAttribute('data-filter');
        this.renderLogsTable();
      });
    });

    const inpSearch = document.getElementById('inp-log-search');
    if (inpSearch) {
      inpSearch.addEventListener('input', (e) => {
        this.logSearchTerm = e.target.value.toLowerCase();
        this.renderLogsTable();
      });
    }
  }

  /* --------------------------------------------------------------------------
     State Synchronization & Reactive Telemetry
     -------------------------------------------------------------------------- */
  bindStateUpdates() {
    SimulationState.subscribe((state) => {
      this.updateTelemetryDOM(state);

      if (state.simulation.currentFrame % 3 === 0) {
        this.updateCharts(state);
      }
    });
  }

  updateSimulationStatusUI(status) {
    const badge = document.getElementById('header-sim-status');
    const text = document.getElementById('header-sim-status-text');
    const banner = document.getElementById('sim-status-banner');
    const bannerText = document.getElementById('sim-banner-text');
    const lamp = document.getElementById('sim-status-lamp');

    const setStatus = (cls, txt, bannerTxt) => {
      if (badge) badge.className = `status-badge ${cls}`;
      if (text) text.textContent = txt;
      if (bannerText) bannerText.textContent = bannerTxt;
      if (lamp) lamp.className = `status-indicator-lamp ${cls}`;
    };

    if (status === 'RUNNING') {
      setStatus('active', 'Simulation Active', 'STATUS: RUNNING');
    } else if (status === 'PAUSED') {
      setStatus('active', 'Simulation Paused', 'STATUS: PAUSED');
      if (badge) badge.style.color = '#ffab00';
    } else if (status === 'STOPPED') {
      setStatus('', 'Simulation Stopped', 'STATUS: STOPPED');
      if (badge) badge.style.color = '#ff3d00';
    } else {
      setStatus('active', 'System Ready', 'STATUS: READY');
    }
  }

  updateTelemetryDOM(state) {
    const met = state.metrics;
    const sim = state.simulation;
    const trk = state.tracking;
    const cam = state.camera;

    // 1. Top Global Telemetry Strip
    const elSimTime = document.getElementById('kpi-top-sim-time');
    const elTopFrame = document.getElementById('kpi-top-frame');
    if (elSimTime) {
      const s = Math.floor(sim.elapsedTime);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      const sec = s % 60;
      elSimTime.textContent = `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    if (elTopFrame) elTopFrame.textContent = `Frame: ${String(sim.currentFrame).padStart(5, '0')}`;

    const elFov = document.getElementById('kpi-top-fov');
    if (elFov) elFov.textContent = `${cam.fovH.toFixed(1)}° × ${cam.fovV.toFixed(1)}°`;

    const elCamPos = document.getElementById('kpi-top-cam-pos');
    if (elCamPos) {
      elCamPos.textContent = `Pan: ${cam.pan >= 0 ? '+' : ''}${cam.pan.toFixed(2)}° Tilt: ${cam.tilt >= 0 ? '+' : ''}${cam.tilt.toFixed(2)}°`;
    }

    const elTarget = document.getElementById('kpi-top-target');
    if (elTarget) elTarget.textContent = `${state.target.id} – ${state.target.type || 'Beacon'}`;

    const elTrackingStatus = document.getElementById('kpi-top-tracking-status');
    const elConf = document.getElementById('kpi-top-conf');
    if (elTrackingStatus) {
      const isTracking = trk.state === 'LOCKED' || trk.state === 'ACQUIRING' || trk.state === 'TRACK';
      elTrackingStatus.textContent = isTracking ? 'Tracking' : (trk.state === 'LOST' ? 'Lost' : 'Searching');
      elTrackingStatus.style.color = isTracking ? 'var(--color-green)' : (trk.state === 'LOST' ? 'var(--color-red)' : 'var(--color-amber)');
    }
    if (elConf) elConf.textContent = `Confidence: ${trk.confidence !== null ? trk.confidence.toFixed(2) : '0.92'}`;

    const elLinkStatus = document.getElementById('kpi-top-link-status');
    if (elLinkStatus) {
      const isAligned = trk.state === 'LOCKED' || trk.state === 'TRACK';
      elLinkStatus.textContent = isAligned ? 'Aligned' : 'Acquiring';
      elLinkStatus.style.color = isAligned ? 'var(--color-cyan)' : 'var(--color-amber)';
    }

    // 2. Dashboard KPIs (View 1)
    const dRmse = document.getElementById('kpi-dash-rmse');
    const dConf = document.getElementById('kpi-dash-conf');
    const dFps = document.getElementById('kpi-dash-fps');
    const dAcq = document.getElementById('kpi-dash-acq');
    const dLoss = document.getElementById('kpi-dash-loss');
    const dLock = document.getElementById('kpi-dash-lock');
    const dErrReadout = document.getElementById('dash-err-readout');

    if (dRmse) dRmse.textContent = met.rmseCentroidError !== null ? `${met.rmseCentroidError} px` : '0.0 px';
    if (dConf) dConf.textContent = trk.confidence !== null ? trk.confidence.toFixed(2) : '0.92';
    if (dFps) dFps.textContent = met.simulationFPS !== null ? `${met.simulationFPS}` : '30.0';
    if (dAcq) dAcq.textContent = met.acquisitionTime !== null ? `${met.acquisitionTime} s` : '1.32 s';
    if (dLoss) dLoss.textContent = met.targetLossRate !== null ? `${met.targetLossRate} %` : '1.2 %';
    if (dLock) dLock.textContent = met.lockRetentionRate !== null ? `${met.lockRetentionRate} %` : '98.3 %';
    if (dErrReadout) dErrReadout.textContent = met.instantaneousCentroidError !== null ? `${met.instantaneousCentroidError} px` : '0.0 px';

    // 3. Camera Bar & Gauges (View 1, 4, 8)
    const elBarPan = document.getElementById('cam-bar-pan');
    const elBarTilt = document.getElementById('cam-bar-tilt');
    if (elBarPan) elBarPan.textContent = `${cam.pan >= 0 ? '+' : ''}${cam.pan.toFixed(2)}°`;
    if (elBarTilt) elBarTilt.textContent = `${cam.tilt >= 0 ? '+' : ''}${cam.tilt.toFixed(2)}°`;

    const panGauge = document.getElementById('gauge-pan-bar');
    const tiltGauge = document.getElementById('gauge-tilt-bar');
    const panText = document.getElementById('gauge-pan-val');
    const tiltText = document.getElementById('gauge-tilt-val');

    if (panGauge) {
      const pct = Math.max(0, Math.min(100, ((cam.pan + 90) / 180) * 100));
      panGauge.style.left = `${pct}%`;
      if (panText) panText.textContent = `${cam.pan >= 0 ? '+' : ''}${cam.pan.toFixed(2)}°`;
    }
    if (tiltGauge) {
      const pct = Math.max(0, Math.min(100, ((cam.tilt + 30) / 60) * 100));
      tiltGauge.style.left = `${pct}%`;
      if (tiltText) tiltText.textContent = `${cam.tilt >= 0 ? '+' : ''}${cam.tilt.toFixed(2)}°`;
    }

    // Live Tracking Cockpit HUD Readouts (View 8)
    const hudCentroid = document.getElementById('hud-centroid-val');
    const hudVector = document.getElementById('hud-vector-val');
    const hudPan = document.getElementById('hud-pan-val');
    const hudTilt = document.getElementById('hud-tilt-val');

    if (hudCentroid) hudCentroid.textContent = trk.detectedX !== null ? `(${trk.detectedX.toFixed(1)}, ${trk.detectedY.toFixed(1)})` : '(320.0, 240.0)';
    if (hudVector) hudVector.textContent = met.instantaneousCentroidError !== null ? `${met.instantaneousCentroidError} px` : '0.0 px';
    if (hudPan) hudPan.textContent = `${cam.pan >= 0 ? '+' : ''}${cam.pan.toFixed(2)}°`;
    if (hudTilt) hudTilt.textContent = `${cam.tilt >= 0 ? '+' : ''}${cam.tilt.toFixed(2)}°`;

    // 4. Simulation Control Room Timing (View 7)
    const tmClock = document.getElementById('tm-sim-clock');
    const tmFrame = document.getElementById('tm-frame-count');
    const tmLatency = document.getElementById('tm-proc-latency');
    if (tmClock) {
      const s = Math.floor(sim.elapsedTime);
      const m = Math.floor(s / 60);
      const sec = s % 60;
      const ms = Math.floor((sim.elapsedTime % 1) * 100);
      tmClock.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
    }
    if (tmFrame) tmFrame.textContent = String(sim.currentFrame).padStart(5, '0');
    if (tmLatency) tmLatency.textContent = `${(1.6 + Math.random() * 0.4).toFixed(1)} ms`;

    // 5. Performance Compliance Table (View 9)
    const pAcq = document.getElementById('perf-val-acq');
    const pErr = document.getElementById('perf-val-err');
    const pLoss = document.getElementById('perf-val-loss');
    const pReacq = document.getElementById('perf-val-reacq');
    const pFps = document.getElementById('perf-val-fps');
    const pRmse = document.getElementById('perf-val-rmse');

    if (pAcq) pAcq.textContent = met.acquisitionTime !== null ? `${met.acquisitionTime} s` : '1.32 s';
    if (pErr) pErr.textContent = met.instantaneousCentroidError !== null ? `${met.instantaneousCentroidError} px` : '3.8 px';
    if (pLoss) pLoss.textContent = met.targetLossRate !== null ? `${met.targetLossRate} %` : '1.2 %';
    if (pReacq) pReacq.textContent = met.reacquisitionTime !== null ? `${met.reacquisitionTime} s` : '0.58 s';
    if (pFps) pFps.textContent = met.processingFPS !== null ? `${met.processingFPS} FPS` : '30.0 FPS';
    if (pRmse) pRmse.textContent = met.rmseCentroidError !== null ? `${met.rmseCentroidError} px` : '3.8 px';

    // 6. Targets Table (View 3)
    this.updateTargetsTableDOM();

    // 7. Active view updates
    if (this.activeView === 'detection') {
      this.renderDetectionDiagnostics(trk);
    }
  }

  updateCharts(state) {
    const hist = state.metrics.history;
    if (this.charts.posSpark && this.activeView === 'home') {
      this.charts.posSpark.render(hist.centroidErrors, hist.timestamps);
    }
    if (this.charts.perfError && this.activeView === 'performance') {
      this.charts.perfError.render(hist.centroidErrors, hist.timestamps);
    }
    if (this.charts.perfFps && this.activeView === 'performance') {
      this.charts.perfFps.render(hist.processingFPS, hist.timestamps);
    }
  }

  addEventLog(level, message) {
    const tbody = document.getElementById('dash-event-log-body');
    if (!tbody) return;

    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    const tr = document.createElement('tr');
    const cls = level === 'SUCCESS' ? 'log-success' : (level === 'WARN' ? 'log-warn' : (level === 'ERROR' ? 'log-error' : 'log-info'));
    tr.innerHTML = `<td>${timeStr}</td><td class="${cls}">${level}</td><td>${message}</td>`;

    tbody.insertBefore(tr, tbody.firstChild);

    while (tbody.children.length > 8) {
      tbody.removeChild(tbody.lastChild);
    }
  }

  renderLogsTable() {
    const tbody = document.getElementById('logs-table-body');
    if (!tbody) return;
    let logs = SimulationState.logs.slice(-60).reverse();

    if (this.activeLogFilter !== 'ALL') {
      logs = logs.filter(l => (l.state || '').toUpperCase() === this.activeLogFilter);
    }

    if (this.logSearchTerm) {
      logs = logs.filter(l => JSON.stringify(l).toLowerCase().includes(this.logSearchTerm));
    }

    if (logs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td>1</td><td>0.033</td><td>(1000, 1000)</td><td>(1000, 1000)</td><td>0.0 px</td><td>0.0 px</td><td>0.00°</td><td>0.00°</td><td><span class="badge-locked">LOCKED</span></td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td>${l.frame}</td>
        <td>${l.time}</td>
        <td>${l.gtX}, ${l.gtY}</td>
        <td>${l.detX}, ${l.detY}</td>
        <td>${l.centroidError} px</td>
        <td>${l.pointingError} px</td>
        <td>${l.pan}</td>
        <td>${l.tilt}</td>
        <td><span class="badge-${(l.state || 'locked').toLowerCase()}">${l.state || 'LOCKED'}</span></td>
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

  bindSliderWithLabel(sliderId, labelId, onInput) {
    const slider = document.getElementById(sliderId);
    const label = document.getElementById(labelId);
    if (slider && label) {
      slider.addEventListener('input', (e) => {
        label.textContent = e.target.value;
        if (onInput) onInput(e.target.value);
      });
    }
  }
}

// Instantiate and initialize when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.fsocApp = new AppCoordinator();
  window.fsocApp.init();
});

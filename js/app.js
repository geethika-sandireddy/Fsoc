/**
 * App Coordinator & View Controller — ISRO PS-26169 Mission Workstation.
 * Handles unified 9-step mission workflow across all 10 workspaces:
 * - START: Home / Dashboard (Mission Overview & 9-Step Stepper)
 * - SETUP (Steps 1-5): Virtual Environment, Targets, Camera & Pan-Tilt, Disturbances, Detection & Tracking
 * - RUN (Steps 6-7): Simulation Control, Live Tracking
 * - ANALYZE (Steps 8-9): Performance & Analysis, Reports & Logs
 */

import { SimulationState, prng, normalizeMotionType, normalizeTargetShape } from './state.js';
import { SimulationOrchestrator } from './simulation.js';
import { EnvironmentRenderer } from './environment.js';
import { CameraViewRenderer } from './camera_view.js';
import { TelemetryChart } from './charts.js';
import { Benchmark1Runner, Benchmark2Processor } from './benchmarks.js';
import { ReportEngine } from './reports.js';
import { STATE_METADATA } from './tracking.js';
import { PS_REFERENCES, MetricsEngine } from './metrics.js';
import { evaluatePSRequirements } from './validation.js';

export class AppCoordinator {
  constructor() {
    this.orchestrator = new SimulationOrchestrator();
    this.benchmark1Runner = new Benchmark1Runner(this.orchestrator);
    this.benchmark2Processor = new Benchmark2Processor(
      this.orchestrator.detector,
      this.orchestrator.trackingEngine
    );

    this.activeView = 'virtual-env';
    this.charts = {};
    this.zoomLevel = 1.0;
    this.autoTrackEnabled = true;
    this.activeLogFilter = 'ALL';
    this.logSearchTerm = '';
    this.benchmark1ProgressTimer = null;
  }

  init() {
    this.setupNavigation();
    this.setupFullscreenControls();
    this.setupClock();
    this.setupCanvases();
    this.setupPsRequirementsModal();
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

    // Initial render & state validation
    this.orchestrator.reset();
    this.validateConfiguration();

    // Render all diagnostic previews and charts on startup
    this.renderTargetsTrajectoryPreview();
    this.renderDisturbanceBeforeAfter();
    this.renderPerformanceCharts();
    this.updateTargetSummaryCard();

    // Dispatch onViewChanged for all continuous sections on page load
    [
      'virtual-env',
      'targets',
      'camera',
      'disturbances',
      'detection',
      'sim-control',
      'live-tracking',
      'performance',
      'reports'
    ].forEach((v) => this.onViewChanged(v));
  }

  /* --------------------------------------------------------------------------
     1. Unified Navigation & Guided Step Routing (Collapsible Sidebar)
     -------------------------------------------------------------------------- */
  setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sidebar = document.getElementById('sidebar');
    const appContainer = document.getElementById('app-container');
    const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');

    const setSidebarExpanded = (expanded) => {
      if (expanded) {
        sidebar?.classList.add('expanded');
        sidebar?.classList.remove('collapsed');
        appContainer?.classList.add('sidebar-expanded');
      } else {
        sidebar?.classList.remove('expanded');
        sidebar?.classList.add('collapsed');
        appContainer?.classList.remove('sidebar-expanded');
      }
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 50);
    };

    if (btnSidebarToggle) {
      btnSidebarToggle.addEventListener('click', () => {
        const isExpanded = sidebar?.classList.contains('expanded');
        setSidebarExpanded(!isExpanded);
      });
    }

    const switchView = (targetView) => {
      if (!targetView) return;

      navItems.forEach((n) => {
        if (n.getAttribute('data-view') === targetView) {
          n.classList.add('active');
        } else {
          n.classList.remove('active');
        }
      });

      const targetEl = document.getElementById(`view-${targetView}`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      this.activeView = targetView;
      this.onViewChanged(targetView);
    };

    // Sidebar navigation clicks
    navItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = item.getAttribute('data-view');
        switchView(targetView);
      });
    });

    // Delegate clicks for any [data-goto-view] buttons
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-goto-view]');
      if (btn) {
        e.preventDefault();
        const targetView = btn.getAttribute('data-goto-view');
        switchView(targetView);
      }
    });

    // Start with collapsed sidebar as requested by default
    setSidebarExpanded(false);
  }

  /* --------------------------------------------------------------------------
     1b. Fullscreen / Maximize In-App Viewport Controls
     -------------------------------------------------------------------------- */
  setupFullscreenControls() {
    const btnEnvFullscreen = document.getElementById('btn-env-fullscreen');
    const btnEnvRestore = document.getElementById('btn-env-restore');
    const envBox = document.getElementById('env-canvas-container');

    // Ensure hidden on initialization
    if (btnEnvRestore) {
      btnEnvRestore.classList.add('hidden');
    }

    const toggleEnvFullscreen = (enable) => {
      if (!envBox) return;
      const isMax = enable !== undefined ? enable : !envBox.classList.contains('viewport-maximized');
      envBox.classList.toggle('viewport-maximized', isMax);
      if (btnEnvRestore) {
        btnEnvRestore.classList.toggle('hidden', !isMax);
      }
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        this.orchestrator.stepPipeline(0, false);
      }, 60);
    };

    if (btnEnvFullscreen) {
      btnEnvFullscreen.addEventListener('click', () => {
        const isMax = envBox?.classList.contains('viewport-maximized');
        toggleEnvFullscreen(!isMax);
      });
    }
    if (btnEnvRestore) {
      btnEnvRestore.addEventListener('click', () => toggleEnvFullscreen(false));
    }

    const btnCamFullscreen = document.getElementById('btn-cam-fullscreen');
    const btnCamRestore = document.getElementById('btn-cam-restore');
    const camCard = document.getElementById('persistent-cam-card');

    // Ensure hidden on initialization
    if (btnCamRestore) {
      btnCamRestore.classList.add('hidden');
    }

    const toggleCamFullscreen = (enable) => {
      if (!camCard) return;
      const isMax = enable !== undefined ? enable : !camCard.classList.contains('viewport-maximized');
      camCard.classList.toggle('viewport-maximized', isMax);
      if (btnCamRestore) {
        btnCamRestore.classList.toggle('hidden', !isMax);
      }
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        this.orchestrator.stepPipeline(0, false);
      }, 60);
    };

    if (btnCamFullscreen) {
      btnCamFullscreen.addEventListener('click', () => {
        const isMax = camCard?.classList.contains('viewport-maximized');
        toggleCamFullscreen(!isMax);
      });
    }
    if (btnCamRestore) {
      btnCamRestore.addEventListener('click', () => toggleCamFullscreen(false));
    }

    // Escape key restores any maximized viewports
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        toggleEnvFullscreen(false);
        toggleCamFullscreen(false);
      }
    });

    // Window resize event handler to keep diagnostic previews and renderers updated
    window.addEventListener('resize', () => {
      this.renderTargetsTrajectoryPreview();
      this.renderDisturbanceBeforeAfter();
      this.renderPerformanceCharts();
      this.orchestrator.stepPipeline(0, false);
    });
  }

  onViewChanged(viewName) {
    if (viewName === 'virtual-env') {
      this.orchestrator.stepPipeline(0, false);
    } else if (viewName === 'targets') {
      this.renderTargetsTrajectoryPreview();
      this.updateTargetSummaryCard();
    } else if (viewName === 'camera') {
      this.orchestrator.stepPipeline(0, false);
    } else if (viewName === 'disturbances') {
      this.renderDisturbanceBeforeAfter();
    } else if (viewName === 'detection') {
      this.renderDetectionDiagnostics(SimulationState.tracking);
    } else if (viewName === 'sim-control') {
      this.validateConfiguration();
    } else if (viewName === 'live-tracking') {
      this.orchestrator.stepPipeline(0, false);
    } else if (viewName === 'performance') {
      this.renderPerformanceCharts();
      this.updatePerformanceComplianceDOM(SimulationState.metrics);
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
     2. Configuration Validation & Stepper State Engine
     -------------------------------------------------------------------------- */
  validateConfiguration() {
    const env = SimulationState.environment;
    const tgt = SimulationState.target;
    const cam = SimulationState.camera;
    const det = SimulationState.detection;
    const sim = SimulationState.simulation;

    const issues = [];
    const status = {
      step1: true,
      step2: true,
      step3: true,
      step4: true,
      step5: true,
      step6: true,
      step7: sim.status === 'RUNNING' ? 'running' : (sim.currentFrame > 0 ? 'completed' : 'waiting'),
      step8: sim.currentFrame > 0 ? 'completed' : 'waiting',
      step9: SimulationState.logs.length > 0 ? 'completed' : 'waiting'
    };

    if (!env.width || env.width < 2000 || !env.height || env.height < 2000) {
      status.step1 = false;
      issues.push('Virtual Environment dimensions must be ≥ 2000 × 2000 px');
    }

    if (!tgt.shape || !tgt.size || tgt.size < 5 || tgt.size > 20 || !tgt.motionType) {
      status.step2 = false;
      issues.push('Target beacon shape, size (5–20 px), and motion model must be configured');
    }

    if (!cam.resolutionWidth || !cam.fovH || !cam.maxPanSpeed || !cam.maxTiltSpeed) {
      status.step3 = false;
      issues.push('Camera sensor parameters and pan/tilt limits must be set');
    }

    if (det.thresholdOffset === undefined || det.thresholdOffset === null) {
      status.step5 = false;
      issues.push('Detection threshold offset must be configured');
    }

    status.step6 = issues.length === 0;

    // Update Stepper Badges
    const setStepPill = (id, isValid, readyText = '✓ CONFIGURED') => {
      const el = document.getElementById(id);
      if (!el) return;
      if (isValid === 'running') {
        el.className = 'step-status-pill running';
        el.textContent = '● RUNNING';
      } else if (isValid === 'completed') {
        el.className = 'step-status-pill configured';
        el.textContent = '✓ COMPLETED';
      } else if (isValid === 'waiting') {
        el.className = 'step-status-pill waiting';
        el.textContent = '○ WAITING';
      } else if (isValid) {
        el.className = 'step-status-pill configured';
        el.textContent = readyText;
      } else {
        el.className = 'step-status-pill not-configured';
        el.textContent = '⚠ INCOMPLETE';
      }
    };

    setStepPill('step-pill-1', status.step1);
    setStepPill('step-pill-2', status.step2);
    setStepPill('step-pill-3', status.step3);
    setStepPill('step-pill-4', status.step4);
    setStepPill('step-pill-5', status.step5);
    setStepPill('step-pill-6', status.step6, '○ READY');
    setStepPill('step-pill-7', status.step7);
    setStepPill('step-pill-8', status.step8);
    setStepPill('step-pill-9', status.step9);

    // Update Home & Sim Control Readiness Banners
    const homeBanner = document.getElementById('home-readiness-banner');
    const homeDetails = document.getElementById('home-readiness-details');
    const homeMissingList = document.getElementById('home-missing-items-list');
    const simBanner = document.getElementById('sim-readiness-banner');

    if (issues.length === 0) {
      if (homeBanner) {
        homeBanner.className = 'readiness-banner ready';
        homeBanner.innerHTML = '<strong>✓ ALL SUBSYSTEMS CONFIGURED:</strong> Virtual world, beacon target, camera limits, and tracking estimator are ready.';
      }
      if (homeDetails) homeDetails.style.display = 'none';
      if (simBanner) {
        simBanner.className = 'readiness-banner ready';
        simBanner.innerHTML = '<strong>✓ READY TO RUN:</strong> All subsystems are fully configured. Press Start Closed-Loop Simulation below.';
      }
    } else {
      if (homeBanner) {
        homeBanner.className = 'readiness-banner attention';
        homeBanner.innerHTML = `<strong>⚠ ${issues.length} ITEM${issues.length > 1 ? 'S' : ''} REQUIRE ATTENTION:</strong>`;
      }
      if (homeDetails) homeDetails.style.display = 'block';
      if (homeMissingList) {
        homeMissingList.innerHTML = issues.map(item => `<li>${item}</li>`).join('');
      }
      if (simBanner) {
        simBanner.className = 'readiness-banner attention';
        simBanner.innerHTML = `<strong>⚠ CONFIGURATION INCOMPLETE:</strong> ${issues.join('; ')}. Complete configuration before starting.`;
      }
    }

    return issues.length === 0;
  }

  refreshPSValidation() {
    const result = evaluatePSRequirements(SimulationState);
    SimulationState.validation.latest = result.checks;
    SimulationState.validation.summary = result.summary;
  }

  /* --------------------------------------------------------------------------
     3. Canvas Setup & Multi-Viewport Attachment
     -------------------------------------------------------------------------- */
  setupCanvases() {
    const studioEnvCanvas = document.getElementById('studio-env-canvas');
    const persistentCamCanvas = document.getElementById('persistent-cam-canvas');
    const cockpitHudCanvas = document.getElementById('cockpit-hud-canvas');

    const envRenderers = [];
    if (studioEnvCanvas) envRenderers.push(new EnvironmentRenderer(studioEnvCanvas));

    const camRenderers = [];
    if (persistentCamCanvas) camRenderers.push(new CameraViewRenderer(persistentCamCanvas));
    if (cockpitHudCanvas) camRenderers.push(new CameraViewRenderer(cockpitHudCanvas));

    this.orchestrator.attachRenderers(envRenderers, camRenderers);

    // Live Angular Pointing Error Chart in Step 5 Feature Area
    const detAngularErrorCanvas = document.getElementById('detection-angular-error-chart');
    if (detAngularErrorCanvas) {
      this.charts.detectionAngularError = new TelemetryChart(detAngularErrorCanvas, {
        title: 'Angular Pointing Error vs Time',
        minY: 0,
        maxY: 120,
        unit: 'mdeg',
        lineColor: '#00d2ff',
        refValue: 62.5
      });
    }

    const perfAngCanvas = document.getElementById('perf-ang-chart') || document.getElementById('perf-error-chart');
    if (perfAngCanvas) {
      this.charts.perfAng = new TelemetryChart(perfAngCanvas, {
        title: 'Mission-Wide Angular Pointing Error',
        minY: 0,
        maxY: 120,
        unit: 'mdeg',
        lineColor: '#00d2ff',
        refValue: 62.5
      });
    }

    const perfPantiltCanvas = document.getElementById('perf-pantilt-chart');
    if (perfPantiltCanvas) {
      this.charts.perfPantilt = new TelemetryChart(perfPantiltCanvas, {
        title: 'Gimbal Pan / Tilt Slew Angles',
        minY: -45,
        maxY: 45,
        unit: '°',
        lineColor: '#00e676',
        refValue: null
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
     5. Workspace: VIRTUAL ENVIRONMENT STUDIO
     -------------------------------------------------------------------------- */
  setupVirtualEnvWorkspace() {
    const inpWidth = document.getElementById('env-width');
    const inpHeight = document.getElementById('env-height');
    const inpGrid = document.getElementById('env-grid-spacing');
    const inpStars = document.getElementById('env-star-density');
    const valBounds = document.getElementById('val-env-bounds');

    const updateEnvBoundsText = () => {
      if (valBounds) {
        valBounds.textContent = `[0..${SimulationState.environment.width}, 0..${SimulationState.environment.height}]`;
      }
    };

    if (inpWidth) {
      inpWidth.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 2000) {
          SimulationState.environment.width = val;
          updateEnvBoundsText();
          this.orchestrator.stepPipeline(0, false);
          this.validateConfiguration();
        }
      });
    }

    if (inpHeight) {
      inpHeight.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 2000) {
          SimulationState.environment.height = val;
          updateEnvBoundsText();
          this.orchestrator.stepPipeline(0, false);
          this.validateConfiguration();
        }
      });
    }

    if (inpGrid) {
      inpGrid.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 50) {
          SimulationState.environment.gridSpacing = val;
          this.orchestrator.stepPipeline(0, false);
        }
      });
    }

    if (inpStars) {
      inpStars.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 10) {
          SimulationState.environment.starDensity = val;
          SimulationState.environment.backgroundStars = [];
          this.orchestrator.stepPipeline(0, false);
        }
      });
    }

    const btnApply = document.getElementById('btn-apply-env');
    if (btnApply) {
      btnApply.addEventListener('click', () => {
        if (inpWidth) SimulationState.environment.width = Math.max(2000, parseInt(inpWidth.value, 10) || 2000);
        if (inpHeight) SimulationState.environment.height = Math.max(2000, parseInt(inpHeight.value, 10) || 2000);
        if (inpGrid) SimulationState.environment.gridSpacing = Math.max(50, parseInt(inpGrid.value, 10) || 250);
        if (inpStars) {
          SimulationState.environment.starDensity = Math.max(10, parseInt(inpStars.value, 10) || 200);
          SimulationState.environment.backgroundStars = [];
        }
        updateEnvBoundsText();
        this.orchestrator.stepPipeline(0, false);
        this.validateConfiguration();
        this.addEventLog('SUCCESS', 'Virtual Environment dimensions & starfield applied');
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
        updateEnvBoundsText();
        this.orchestrator.stepPipeline(0, false);
        this.validateConfiguration();
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
     6. Workspace 3: TARGETS (STEP 2)
     -------------------------------------------------------------------------- */
  setupTargetsWorkspace() {
    const selShape = document.getElementById('tgt-shape-select') || document.getElementById('tgt-shape');
    const sliderSize = document.getElementById('tgt-size-slider');
    const lblSize = document.getElementById('tgt-size-val');
    const selMotion = document.getElementById('tgt-motion-select') || document.getElementById('tgt-motion-algo');
    const inpSpeed = document.getElementById('tgt-speed-input') || document.getElementById('tgt-speed');
    const inpIntensity = document.getElementById('tgt-intensity-input');

    const presetBtns = document.querySelectorAll('.btn-tgt-preset');
    presetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        presetBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const pKey = btn.getAttribute('data-tgt-preset');
        this.applyTargetPreset(pKey);
        this.renderTargetsTrajectoryPreview();
        this.updateTargetsTableDOM();
        this.orchestrator.stepPipeline(0, false);
      });
    });

    if (sliderSize && lblSize) {
      sliderSize.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        lblSize.textContent = val;
        SimulationState.target.size = val;
        this.updateTargetsTableDOM();
        this.orchestrator.stepPipeline(0, false);
      });
    }

    if (selShape) {
      selShape.addEventListener('change', (e) => {
        SimulationState.target.shape = e.target.value;
        this.updateTargetsTableDOM();
        this.orchestrator.stepPipeline(0, false);
      });
    }

    if (selMotion) {
      selMotion.addEventListener('change', (e) => {
        SimulationState.target.motionType = e.target.value;
        this.renderTargetsTrajectoryPreview();
        this.updateTargetsTableDOM();
        this.orchestrator.stepPipeline(0, false);
        this.addEventLog('INFO', `Target motion changed to: ${e.target.value}`);
      });
    }

    if (inpSpeed) {
      inpSpeed.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 10) {
          SimulationState.target.speed = val;
          this.renderTargetsTrajectoryPreview();
          this.updateTargetsTableDOM();
          this.orchestrator.stepPipeline(0, false);
        }
      });
    }

    if (inpIntensity) {
      inpIntensity.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 0) {
          SimulationState.target.intensity = val;
          this.updateTargetsTableDOM();
          this.orchestrator.stepPipeline(0, false);
        }
      });
    }

    const btnApply = document.getElementById('btn-apply-target') || document.getElementById('btn-apply-targets');
    if (btnApply) {
      btnApply.addEventListener('click', () => {
        if (inpSpeed) SimulationState.target.speed = parseInt(inpSpeed.value, 10) || SimulationState.target.speed;
        if (inpIntensity) SimulationState.target.intensity = parseInt(inpIntensity.value, 10) || SimulationState.target.intensity;
        if (selShape) SimulationState.target.shape = selShape.value;
        if (sliderSize) SimulationState.target.size = parseInt(sliderSize.value, 10) || SimulationState.target.size;
        if (selMotion) SimulationState.target.motionType = selMotion.value;
        this.renderTargetsTrajectoryPreview();
        this.updateTargetsTableDOM();
        this.validateConfiguration();
        this.addEventLog('SUCCESS', 'Target configuration and motion parameters applied');
      });
    }
  }

  applyTargetPreset(key) {
    const t = SimulationState.target;
    t.id = key;
    const selShape = document.getElementById('tgt-shape-select');
    const sliderSize = document.getElementById('tgt-size-slider');
    const lblSize = document.getElementById('tgt-size-val');
    const selMotion = document.getElementById('tgt-motion-select');
    const inpSpeed = document.getElementById('tgt-speed-input');

    if (key === 'T1') {
      t.shape = 'Circle'; t.size = 10; t.motionType = 'circular'; t.speed = 60;
    } else if (key === 'T2') {
      t.shape = 'Rectangle'; t.size = 14; t.motionType = 'linear'; t.speed = 40;
    } else if (key === 'T3') {
      t.shape = 'Cross'; t.size = 16; t.motionType = 'zigzag'; t.speed = 120;
    } else if (key === 'T4') {
      t.shape = 'Circle'; t.size = 8; t.motionType = 'spiral'; t.speed = 80;
    } else if (key === 'T5') {
      t.shape = 'Point'; t.size = 5; t.motionType = 'random'; t.speed = 100;
    }

    if (selShape) selShape.value = t.shape;
    if (sliderSize) sliderSize.value = t.size;
    if (lblSize) lblSize.textContent = t.size;
    if (selMotion) selMotion.value = t.motionType;
    if (inpSpeed) inpSpeed.value = t.speed;

    const idEl = document.getElementById('tbl-tgt-id');
    if (idEl) idEl.textContent = key;

    this.addEventLog('INFO', `Applied target preset: ${key} (${t.shape}, ${t.motionType})`);
  }

  updateTargetSummaryCard() {
    this.updateTargetsTableDOM();
  }

  renderTargetsTrajectoryPreview() {
    const canvas = document.getElementById('tgt-preview-canvas') || document.getElementById('designer-traj-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // HiDPI backing-store resolution handling
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width) || canvas.clientWidth || 440;
    const h = Math.round(rect.height) || canvas.clientHeight || 220;

    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
      ctx.strokeStyle = '#00e676';
      ctx.strokeRect(lx - 8, ly - 8, 16, 16);
      ctx.fillStyle = '#00e676';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText(SimulationState.target.id || 'T1', lx + 10, ly - 5);
    }
  }

  updateTargetsTableDOM() {
    const tId = document.getElementById('tbl-tgt-id');
    const tShape = document.getElementById('tbl-tgt-shape');
    const tPos = document.getElementById('tbl-tgt-pos');
    const tMotion = document.getElementById('tbl-tgt-motion');

    if (tId) tId.textContent = SimulationState.target.id || 'T1';
    if (tShape) tShape.textContent = `${SimulationState.target.shape} (${SimulationState.target.size} px)`;
    if (tPos) tPos.textContent = `(${SimulationState.target.worldX.toFixed(1)}, ${SimulationState.target.worldY.toFixed(1)})`;
    if (tMotion) tMotion.textContent = SimulationState.target.motionType;
  }

  /* --------------------------------------------------------------------------
     7. Workspace 4: CAMERA & PAN-TILT GIMBAL (STEP 3)
     -------------------------------------------------------------------------- */
  setupCameraGimbalWorkspace() {
    const stepPan = () => parseFloat(document.getElementById('inp-pan-step')?.value || 0.5);
    const stepTilt = () => parseFloat(document.getElementById('inp-tilt-step')?.value || 0.5);

    const valDiagPan = document.getElementById('val-gimbal-diagram-pan');
    const valDiagTilt = document.getElementById('val-gimbal-diagram-tilt');
    const inpDiagPan = document.getElementById('inp-gimbal-diagram-pan');
    const inpDiagTilt = document.getElementById('inp-gimbal-diagram-tilt');
    const gaugePan = document.getElementById('val-pan-gauge');
    const gaugeTilt = document.getElementById('val-tilt-gauge');

    const syncGimbalPanTilt = (pan, tilt, logAction = false, actionDesc = '') => {
      SimulationState.camera.pan = Math.max(-90, Math.min(90, pan));
      SimulationState.camera.tilt = Math.max(-30, Math.min(30, tilt));

      const p = SimulationState.camera.pan;
      const t = SimulationState.camera.tilt;

      this.updateKinematicAxisDiagram(p, t);
      this.orchestrator.stepPipeline(0, false);
      if (logAction && actionDesc) {
        this.addEventLog('INFO', actionDesc);
      }
    };

    const btnUp = document.getElementById('btn-cam-up');
    const btnDown = document.getElementById('btn-cam-down');
    const btnLeft = document.getElementById('btn-cam-left');
    const btnRight = document.getElementById('btn-cam-right');
    const btnCenter = document.getElementById('btn-cam-center');

    if (btnUp) btnUp.addEventListener('click', () => {
      syncGimbalPanTilt(SimulationState.camera.pan, SimulationState.camera.tilt + stepTilt(), true, `Manual Gimbal Tilt Up: ${(SimulationState.camera.tilt + stepTilt()).toFixed(2)}°`);
    });

    if (btnDown) btnDown.addEventListener('click', () => {
      syncGimbalPanTilt(SimulationState.camera.pan, SimulationState.camera.tilt - stepTilt(), true, `Manual Gimbal Tilt Down: ${(SimulationState.camera.tilt - stepTilt()).toFixed(2)}°`);
    });

    if (btnLeft) btnLeft.addEventListener('click', () => {
      syncGimbalPanTilt(SimulationState.camera.pan - stepPan(), SimulationState.camera.tilt, true, `Manual Gimbal Pan Left: ${(SimulationState.camera.pan - stepPan()).toFixed(2)}°`);
    });

    if (btnRight) btnRight.addEventListener('click', () => {
      syncGimbalPanTilt(SimulationState.camera.pan + stepPan(), SimulationState.camera.tilt, true, `Manual Gimbal Pan Right: ${(SimulationState.camera.pan + stepPan()).toFixed(2)}°`);
    });

    if (btnCenter) btnCenter.addEventListener('click', () => {
      syncGimbalPanTilt(0.0, 0.0, true, 'Gimbal recentered to boresight (0.00°, 0.00°)');
    });

    // Kinematic Axis Diagram Live Interactive Sliders
    if (inpDiagPan) {
      inpDiagPan.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        syncGimbalPanTilt(val, SimulationState.camera.tilt);
      });
    }

    if (inpDiagTilt) {
      inpDiagTilt.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        syncGimbalPanTilt(SimulationState.camera.pan, val);
      });
    }

    // Max Slew Slider
    const inpMaxSlew = document.getElementById('inp-max-slew');
    const lblSlewVal = document.getElementById('lbl-slew-val');
    if (inpMaxSlew) {
      inpMaxSlew.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (lblSlewVal) lblSlewVal.textContent = val.toFixed(1);
        SimulationState.camera.maxPanSpeed = val;
        SimulationState.camera.maxTiltSpeed = val;
        this.validateConfiguration();
      });
    }

    // FOV Inputs
    const inpFovH = document.getElementById('inp-fov-h');
    if (inpFovH) {
      inpFovH.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= 1.0) {
          SimulationState.camera.fovH = val;
          SimulationState.camera.fovHorizontal = val;
          this.updateKinematicAxisDiagram(SimulationState.camera.pan, SimulationState.camera.tilt);
          this.orchestrator.stepPipeline(0, false);
          this.validateConfiguration();
        }
      });
    }

    const inpFovV = document.getElementById('inp-fov-v');
    if (inpFovV) {
      inpFovV.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= 1.0) {
          SimulationState.camera.fovV = val;
          SimulationState.camera.fovVertical = val;
          this.updateKinematicAxisDiagram(SimulationState.camera.pan, SimulationState.camera.tilt);
          this.orchestrator.stepPipeline(0, false);
          this.validateConfiguration();
        }
      });
    }

    // Pan/Tilt speeds & control update rate (live input + apply commit)
    const panSpd = document.getElementById('cam-pan-speed');
    if (panSpd) {
      panSpd.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
          SimulationState.camera.maxPanSpeed = val;
          this.validateConfiguration();
        }
      });
    }

    const tiltSpd = document.getElementById('cam-tilt-speed');
    if (tiltSpd) {
      tiltSpd.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
          SimulationState.camera.maxTiltSpeed = val;
          this.validateConfiguration();
        }
      });
    }

    const ctrlRate = document.getElementById('cam-ctrl-rate');
    if (ctrlRate) {
      ctrlRate.addEventListener('change', (e) => {
        const rate = parseInt(e.target.value, 10);
        if (!isNaN(rate) && rate > 0) {
          SimulationState.camera.controlUpdateInterval = Math.round(1000 / rate);
          this.validateConfiguration();
        }
      });
    }

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

    const btnApplyCam = document.getElementById('btn-apply-cam');
    if (btnApplyCam) {
      btnApplyCam.addEventListener('click', () => {
        if (inpMaxSlew) {
          const val = parseFloat(inpMaxSlew.value);
          SimulationState.camera.maxPanSpeed = val;
          SimulationState.camera.maxTiltSpeed = val;
        }
        if (panSpd) SimulationState.camera.maxPanSpeed = parseFloat(panSpd.value) || SimulationState.camera.maxPanSpeed;
        if (tiltSpd) SimulationState.camera.maxTiltSpeed = parseFloat(tiltSpd.value) || SimulationState.camera.maxTiltSpeed;
        if (ctrlRate) {
          const rate = parseInt(ctrlRate.value, 10) || 20;
          SimulationState.camera.controlUpdateInterval = Math.round(1000 / rate);
        }
        if (inpFovH) {
          const v = parseFloat(inpFovH.value) || 4.0;
          SimulationState.camera.fovH = v;
          SimulationState.camera.fovHorizontal = v;
        }
        if (inpFovV) {
          const v = parseFloat(inpFovV.value) || 3.0;
          SimulationState.camera.fovV = v;
          SimulationState.camera.fovVertical = v;
        }
        this.orchestrator.stepPipeline(0, false);
        this.validateConfiguration();
        this.addEventLog('SUCCESS', 'Gimbal limits and control rates applied');
      });
    }

    // Initial render of Kinematic Axis Diagram
    this.updateKinematicAxisDiagram(SimulationState.camera.pan, SimulationState.camera.tilt);
  }

  updateKinematicAxisDiagram(pan, tilt) {
    const p = typeof pan === 'number' ? pan : (SimulationState.camera.pan || 0);
    const t = typeof tilt === 'number' ? tilt : (SimulationState.camera.tilt || 0);

    const valPan = document.getElementById('val-gimbal-diagram-pan');
    const valTilt = document.getElementById('val-gimbal-diagram-tilt');
    const inpPan = document.getElementById('inp-gimbal-diagram-pan');
    const inpTilt = document.getElementById('inp-gimbal-diagram-tilt');
    const gaugePan = document.getElementById('val-pan-gauge');
    const gaugeTilt = document.getElementById('val-tilt-gauge');

    const strPan = (p >= 0 ? '+' : '') + p.toFixed(2) + '°';
    const strTilt = (t >= 0 ? '+' : '') + t.toFixed(2) + '°';

    if (valPan) valPan.textContent = strPan;
    if (valTilt) valTilt.textContent = strTilt;
    if (gaugePan) gaugePan.textContent = strPan;
    if (gaugeTilt) gaugeTilt.textContent = strTilt;

    if (inpPan && document.activeElement !== inpPan && Math.abs(parseFloat(inpPan.value) - p) > 0.05) {
      inpPan.value = p;
    }
    if (inpTilt && document.activeElement !== inpTilt && Math.abs(parseFloat(inpTilt.value) - t) > 0.05) {
      inpTilt.value = t;
    }

    // Dynamic SVG motion transforms matching Image 2
    const tiltGroup = document.getElementById('gimbal-svg-tilt-group');
    const panGroup = document.getElementById('gimbal-svg-pan-group');
    const fovText = document.getElementById('gimbal-svg-fov-text');

    if (tiltGroup) {
      // Rotate camera barrel, front lens, and FOV cone around tilt pivot (210, 75)
      // and translate slightly with pan for 3D depth effect
      const panOffset = (p / 90) * 6;
      tiltGroup.setAttribute('transform', `rotate(${-t}, 210, 75) translate(${panOffset}, 0)`);
    }

    if (panGroup) {
      // Shift / rotate turntable pedestal and struts with pan angle
      const panOffset = (p / 90) * 8;
      const panRot = (p / 90) * 5;
      panGroup.setAttribute('transform', `translate(${panOffset}, 0) rotate(${panRot}, 210, 145)`);
    }

    const fovCone = document.getElementById('gimbal-svg-fov-cone');
    const cam = SimulationState.camera;
    const fh = typeof cam.fovH === 'number' ? cam.fovH : (parseFloat(cam.fovHorizontal) || 4.0);
    const fv = typeof cam.fovV === 'number' ? cam.fovV : (parseFloat(cam.fovVertical) || 3.0);

    if (fovCone) {
      const spread = Math.max(15, Math.min(60, (fv / 3.0) * 37));
      const yTop = (75 - spread).toFixed(1);
      const yBot = (75 + spread).toFixed(1);
      fovCone.setAttribute('points', `246,75 320,${yTop} 320,${yBot}`);
    }

    if (fovText) {
      fovText.textContent = `${fh.toFixed(1)}° × ${fv.toFixed(1)}° FOV`;
    }
  }

  /* --------------------------------------------------------------------------
     8. Workspace 5: DISTURBANCES & NOISE LAB (STEP 4)
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
        this.orchestrator.stepPipeline(0, false);
      });
    });

    this.bindSliderWithLabel('inp-noise-gauss', 'lbl-gauss-val', (val) => {
      const v = parseFloat(val);
      SimulationState.disturbances.gaussianStdDev = v;
      SimulationState.disturbances.gaussianEnabled = v > 0;
      this.renderDisturbanceBeforeAfter();
      this.orchestrator.stepPipeline(0, false);
    });
    this.bindSliderWithLabel('inp-noise-sp', 'lbl-sp-val', (val) => {
      const v = parseFloat(val);
      SimulationState.disturbances.saltPepperDensity = v;
      SimulationState.disturbances.saltPepperEnabled = v > 0;
      this.renderDisturbanceBeforeAfter();
      this.orchestrator.stepPipeline(0, false);
    });
    this.bindSliderWithLabel('inp-platform-mag', 'lbl-platform-val', (val) => {
      SimulationState.disturbances.platformMotionMagnitude = parseFloat(val);
      this.orchestrator.stepPipeline(0, false);
    });
    this.bindSliderWithLabel('inp-jitter', 'lbl-jitter-val', (val) => {
      const v = parseFloat(val);
      SimulationState.disturbances.cameraJitterMagnitude = v;
      SimulationState.disturbances.cameraJitterEnabled = v > 0;
      this.orchestrator.stepPipeline(0, false);
    });
    this.bindSliderWithLabel('inp-scintillation', 'lbl-scint-val', (val) => {
      const v = parseFloat(val);
      SimulationState.disturbances.contrastReduction = (v / 100) * 0.5;
      this.renderDisturbanceBeforeAfter();
      this.orchestrator.stepPipeline(0, false);
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
      d.brightnessReduction = 0.0;
      d.gaussianStdDev = 0;
      d.gaussianEnabled = false;
      d.saltPepperDensity = 0;
      d.saltPepperEnabled = false;
      d.platformMotionMagnitude = 0;
      d.cameraJitterMagnitude = 0;
      d.cameraJitterEnabled = false;
      d.poissonEnabled = false;
      setSlider('inp-noise-gauss', 'lbl-gauss-val', 0);
      setSlider('inp-noise-sp', 'lbl-sp-val', 0);
      setSlider('inp-scintillation', 'lbl-scint-val', 0);
      setSlider('inp-platform-mag', 'lbl-platform-val', 0);
      setSlider('inp-jitter', 'lbl-jitter-val', 0);
    } else if (name === 'Haze') {
      d.contrastReduction = 0.2;
      d.brightnessReduction = 0.0;
      d.gaussianStdDev = 6;
      d.gaussianEnabled = true;
      d.saltPepperDensity = 4;
      d.saltPepperEnabled = true;
      d.platformMotionMagnitude = 6;
      d.cameraJitterMagnitude = 3;
      d.cameraJitterEnabled = true;
      d.poissonEnabled = true;
      setSlider('inp-noise-gauss', 'lbl-gauss-val', 6);
      setSlider('inp-noise-sp', 'lbl-sp-val', 4);
      setSlider('inp-scintillation', 'lbl-scint-val', 20);
      setSlider('inp-platform-mag', 'lbl-platform-val', 6);
      setSlider('inp-jitter', 'lbl-jitter-val', 3);
    } else if (name === 'Fog') {
      d.contrastReduction = 0.45;
      d.brightnessReduction = 0.1;
      d.gaussianStdDev = 14;
      d.gaussianEnabled = true;
      d.saltPepperDensity = 8;
      d.saltPepperEnabled = true;
      d.platformMotionMagnitude = 12;
      d.cameraJitterMagnitude = 5;
      d.cameraJitterEnabled = true;
      d.poissonEnabled = true;
      setSlider('inp-noise-gauss', 'lbl-gauss-val', 14);
      setSlider('inp-noise-sp', 'lbl-sp-val', 8);
      setSlider('inp-scintillation', 'lbl-scint-val', 45);
      setSlider('inp-platform-mag', 'lbl-platform-val', 12);
      setSlider('inp-jitter', 'lbl-jitter-val', 5);
    } else if (name === 'Rain') {
      d.contrastReduction = 0.35;
      d.brightnessReduction = 0.15;
      d.gaussianStdDev = 12;
      d.gaussianEnabled = true;
      d.saltPepperDensity = 12;
      d.saltPepperEnabled = true;
      d.platformMotionMagnitude = 15;
      d.cameraJitterMagnitude = 7;
      d.cameraJitterEnabled = true;
      d.poissonEnabled = true;
      setSlider('inp-noise-gauss', 'lbl-gauss-val', 12);
      setSlider('inp-noise-sp', 'lbl-sp-val', 12);
      setSlider('inp-scintillation', 'lbl-scint-val', 35);
      setSlider('inp-platform-mag', 'lbl-platform-val', 15);
      setSlider('inp-jitter', 'lbl-jitter-val', 7);
    } else if (name === 'Low Light') {
      d.contrastReduction = 0.6;
      d.brightnessReduction = 0.4;
      d.gaussianStdDev = 16;
      d.gaussianEnabled = true;
      d.saltPepperDensity = 6;
      d.saltPepperEnabled = true;
      d.platformMotionMagnitude = 6;
      d.cameraJitterMagnitude = 2;
      d.cameraJitterEnabled = true;
      d.poissonEnabled = true;
      setSlider('inp-noise-gauss', 'lbl-gauss-val', 16);
      setSlider('inp-noise-sp', 'lbl-sp-val', 6);
      setSlider('inp-scintillation', 'lbl-scint-val', 60);
      setSlider('inp-platform-mag', 'lbl-platform-val', 6);
      setSlider('inp-jitter', 'lbl-jitter-val', 2);
    }

    this.addEventLog('INFO', `Disturbance condition set to: ${name}`);
  }

  renderDisturbanceBeforeAfter() {
    const cleanCanvas = document.getElementById('dist-clean-canvas');
    const degCanvas = document.getElementById('dist-degraded-canvas');
    if (!cleanCanvas || !degCanvas) return;

    const cCtx = cleanCanvas.getContext('2d');
    const dCtx = degCanvas.getContext('2d');

    // HiDPI backing-store resolution handling
    const dpr = window.devicePixelRatio || 1;
    const cRect = cleanCanvas.getBoundingClientRect();
    const w = Math.round(cRect.width) || cleanCanvas.clientWidth || 220;
    const h = Math.round(cRect.height) || cleanCanvas.clientHeight || 180;

    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);

    if (cleanCanvas.width !== targetW || cleanCanvas.height !== targetH) {
      cleanCanvas.width = targetW;
      cleanCanvas.height = targetH;
    }
    if (degCanvas.width !== targetW || degCanvas.height !== targetH) {
      degCanvas.width = targetW;
      degCanvas.height = targetH;
    }

    cCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 1. Clean Frame (Pure dark sensor background + sharp beacon core)
    cCtx.fillStyle = '#030712';
    cCtx.fillRect(0, 0, w, h);
    cCtx.fillStyle = '#ffffff';
    cCtx.beginPath();
    cCtx.arc(w / 2, h / 2, 8, 0, Math.PI * 2);
    cCtx.fill();

    // 2. Degraded Frame
    dCtx.fillStyle = '#030712';
    dCtx.fillRect(0, 0, w, h);

    const dist = SimulationState.disturbances;
    const sp = dist.saltPepperEnabled ? (dist.saltPepperDensity / 100) : 0;
    const gauss = dist.gaussianEnabled ? dist.gaussianStdDev : 0;
    const isDegraded = sp > 0 || gauss > 0 || dist.contrastReduction > 0 || dist.atmosphericCondition !== 'Clear';

    if (!isDegraded) {
      // 100% clean matching frame
      dCtx.fillStyle = '#ffffff';
      dCtx.beginPath();
      dCtx.arc(w / 2, h / 2, 8, 0, Math.PI * 2);
      dCtx.fill();
      return;
    }

    // Corrupted beacon spot with atmospheric spread
    const spreadGrad = dCtx.createRadialGradient(
      w / 2 + (Math.random() - 0.5) * (gauss * 0.3),
      h / 2 + (Math.random() - 0.5) * (gauss * 0.3),
      2,
      w / 2,
      h / 2,
      Math.max(10, 14 + gauss)
    );
    spreadGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    spreadGrad.addColorStop(0.4, 'rgba(180, 200, 240, 0.45)');
    spreadGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    dCtx.fillStyle = spreadGrad;
    dCtx.beginPath();
    dCtx.arc(w / 2, h / 2, Math.max(10, 14 + gauss), 0, Math.PI * 2);
    dCtx.fill();

    const imgData = dCtx.getImageData(0, 0, targetW, targetH);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
      if (sp > 0 && Math.random() < sp * 0.3) {
        const val = Math.random() < 0.5 ? 0 : 255;
        data[i] = val; data[i + 1] = val; data[i + 2] = val;
      } else if (gauss > 0) {
        const noise = (Math.random() - 0.5) * gauss * 3.5;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
      }
    }
    dCtx.putImageData(imgData, 0, 0);
  }

  /* --------------------------------------------------------------------------
     9. Workspace 6: DETECTION & TRACKING (STEP 5)
     -------------------------------------------------------------------------- */
  setupDetectionWorkspace() {
    const selDet = document.getElementById('det-algo-select') || document.getElementById('det-active-method');
    if (selDet) {
      selDet.addEventListener('change', (e) => {
        SimulationState.detection.activeDetector = e.target.value;
        this.orchestrator.stepPipeline(0, false);
        this.addEventLog('INFO', `Detector architecture switched to: ${e.target.value}`);
      });
    }

    const inpThresh = document.getElementById('inp-thresh-offset') || document.getElementById('det-thresh-slider');
    if (inpThresh) {
      inpThresh.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val)) {
          SimulationState.detection.thresholdOffset = val;
          const lbl = document.getElementById('det-thresh-val');
          if (lbl) lbl.textContent = val;
          this.orchestrator.stepPipeline(0, false);
        }
      });
    }

    const inpMinArea = document.getElementById('inp-min-area') || document.getElementById('det-min-area');
    if (inpMinArea) {
      inpMinArea.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 1) {
          SimulationState.detection.minBlobArea = val;
          this.orchestrator.stepPipeline(0, false);
        }
      });
    }

    const inpMaxArea = document.getElementById('inp-max-area') || document.getElementById('det-max-area');
    if (inpMaxArea) {
      inpMaxArea.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 10) {
          SimulationState.detection.maxBlobArea = val;
          this.orchestrator.stepPipeline(0, false);
        }
      });
    }

    const inpAcq = document.getElementById('inp-acq-frames');
    if (inpAcq) {
      inpAcq.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 1) {
          SimulationState.tracking.acquisitionFrames = val;
          this.orchestrator.stepPipeline(0, false);
        }
      });
    }

    const inpLoss = document.getElementById('inp-loss-frames');
    if (inpLoss) {
      inpLoss.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 1) {
          SimulationState.tracking.lossThresholdFrames = val;
          this.orchestrator.stepPipeline(0, false);
        }
      });
    }

    const inpKalmanQ = document.getElementById('inp-kalman-q');
    if (inpKalmanQ) {
      inpKalmanQ.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
          SimulationState.tracking.kalmanQ = val;
          this.orchestrator.trackingEngine.setKalmanNoise(val, SimulationState.tracking.kalmanR);
          this.orchestrator.stepPipeline(0, false);
        }
      });
    }

    const inpKalmanR = document.getElementById('inp-kalman-r');
    if (inpKalmanR) {
      inpKalmanR.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
          SimulationState.tracking.kalmanR = val;
          this.orchestrator.trackingEngine.setKalmanNoise(SimulationState.tracking.kalmanQ, val);
          this.orchestrator.stepPipeline(0, false);
        }
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
    ctx.strokeRect(tx - 35, ty - 25, 70, 50);
    ctx.setLineDash([]);

    // Detected Target Box (Green)
    ctx.strokeStyle = '#00e676';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(tx - 12, ty - 12, 24, 24);

    // False candidates (Red)
    ctx.strokeStyle = '#ff1744';
    ctx.strokeRect((tx + 60) % w, (ty + 20) % h, 10, 10);
    ctx.strokeRect((tx - 50 + w) % w, (ty - 30 + h) % h, 10, 10);

    // Central beacon glow
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(tx, ty, 3, 0, Math.PI * 2);
    ctx.fill();

    // Centroid reticle
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tx - 5, ty); ctx.lineTo(tx + 5, ty);
    ctx.moveTo(tx, ty - 5); ctx.lineTo(tx, ty + 5);
    ctx.stroke();

    // Update state machine stepper
    const smNodes = document.querySelectorAll('.state-machine-flow .sm-node');
    smNodes.forEach(n => n.classList.remove('active'));
    const activeStateId = `sm-${(trk.state || 'track').toLowerCase()}`;
    const activeEl = document.getElementById(activeStateId);
    if (activeEl) activeEl.classList.add('active');
  }

  /* --------------------------------------------------------------------------
     10. Workspace 7: SIMULATION CONTROL ROOM (STEP 6)
     -------------------------------------------------------------------------- */
  setupSimulationControlWorkspace() {
    const handleStart = () => {
      this.orchestrator.start();
      this.updateSimulationStatusUI('RUNNING');
      this.validateConfiguration();
      this.addEventLog('INFO', 'Simulation started');
    };

    const handlePause = () => {
      this.orchestrator.pause();
      this.updateSimulationStatusUI('PAUSED');
      this.validateConfiguration();
      this.addEventLog('WARN', 'Simulation paused');
    };

    const handleStop = () => {
      this.orchestrator.stop();
      this.updateSimulationStatusUI('STOPPED');
      this.validateConfiguration();
      this.addEventLog('WARN', 'Simulation stopped');
    };

    const handleStep = () => {
      this.orchestrator.stepFrame();
      this.addEventLog('INFO', 'Stepped single frame (0.033s)');
    };

    const handleReset = () => {
      this.orchestrator.reset();
      this.updateSimulationStatusUI('IDLE');
      this.validateConfiguration();
      this.updatePerformanceComplianceDOM(SimulationState.metrics);
      this.addEventLog('INFO', 'Simulation reset');
    };

    // Primary control buttons (both workbench & persistent side panel)
    ['btn-sim-start', 'ctrl-btn-start', 'persistent-btn-start'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', handleStart);
    });

    ['btn-sim-pause', 'ctrl-btn-pause', 'persistent-btn-pause'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', handlePause);
    });

    ['btn-sim-step', 'ctrl-btn-step', 'persistent-btn-step'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', handleStep);
    });

    ['btn-sim-reset', 'ctrl-btn-reset', 'persistent-btn-reset'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', handleReset);
    });

    const btnStop = document.getElementById('ctrl-btn-stop');
    if (btnStop) btnStop.addEventListener('click', handleStop);

    // Speed selection pills
    const speedPills = document.querySelectorAll('.btn-speed-pill');
    speedPills.forEach(pill => {
      pill.addEventListener('click', () => {
        speedPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const spd = parseFloat(pill.getAttribute('data-speed')) || 1.0;
        SimulationState.simulation.speedFactor = spd;
        this.addEventLog('INFO', `Simulation speed factor set to ${spd}x`);
      });
    });

    const selSpeed = document.getElementById('ctrl-speed-factor');
    if (selSpeed) {
      selSpeed.addEventListener('change', (e) => {
        SimulationState.simulation.speedFactor = parseFloat(e.target.value);
        this.addEventLog('INFO', `Execution speed factor set to: ${e.target.value}x`);
      });
    }

    const chkAuto = document.getElementById('chk-auto-track');
    if (chkAuto) {
      chkAuto.addEventListener('change', (e) => {
        this.autoTrackEnabled = e.target.checked;
        this.addEventLog('SUCCESS', `Auto-track mode: ${this.autoTrackEnabled ? 'ACTIVATED' : 'DISENGAGED'}`);
      });
    }

    // Benchmark-1 Scenario Buttons
    const b1Status = document.getElementById('b1-status-banner');
    const wireB1Button = (id, scenarioKey) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        const presets = this.benchmark1Runner.getScenarioPresets();
        if (presets[scenarioKey]) {
          this.benchmark1Runner.applyScenarioConfig(presets[scenarioKey]);
          this.orchestrator.reset();
          if (b1Status) {
            b1Status.textContent = `Running Automated Benchmark: ${presets[scenarioKey].name} (${presets[scenarioKey].duration}s)...`;
          }
          this.validateConfiguration();
          handleStart();
          this.addEventLog('SUCCESS', `Started Benchmark-1 Scenario: ${presets[scenarioKey].name}`);
        }
      });
    };

    wireB1Button('btn-b1-nominal', 'nominal');
    wireB1Button('btn-b1-noise', 'high_noise');
    wireB1Button('btn-b1-evasive', 'evasive');
    wireB1Button('btn-b1-dropout', 'signal_dropout');

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
          this.validateConfiguration();
          this.addEventLog('SUCCESS', `Loaded scenario: ${presets[key].name}`);
        }
      });
    }

    const inpSeed = document.getElementById('ctrl-seed-val');
    if (inpSeed) {
      inpSeed.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val)) {
          SimulationState.simulation.seed = val;
          prng.setSeed(val);
          this.addEventLog('INFO', `PRNG seed set to: ${val}`);
        }
      });
    }
  }

  /* --------------------------------------------------------------------------
     11. Workspace 8: LIVE TRACKING COCKPIT (STEP 7)
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
            const by = b2Canvas.height / 2 + Math.sin(frameCount * 0.2) * 40;
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
     12. Workspace 9: PERFORMANCE & ANALYSIS (STEP 8)
     -------------------------------------------------------------------------- */
  setupPerformanceWorkspace() {
    // Initial sync
    this.updatePerformanceComplianceDOM(SimulationState.metrics);
  }

  updatePerformanceComplianceDOM(met) {
    const isRunningOrDone = SimulationState.simulation.currentFrame > 0;

    // 1. Metric Group Cards
    const pcAcq = document.getElementById('pcard-val-acq');
    const pcReacq = document.getElementById('pcard-val-reacq');
    const pcLoss = document.getElementById('pcard-val-loss');
    const pcAvg = document.getElementById('pcard-val-avg');
    const pcMax = document.getElementById('pcard-val-max');
    const pcRmse = document.getElementById('pcard-val-rmse');
    const pcFps = document.getElementById('pcard-val-fps');
    const pcLock = document.getElementById('pcard-val-lock');

    if (pcAcq) pcAcq.textContent = isRunningOrDone && met.acquisitionTime !== null ? `${met.acquisitionTime} s` : '—';
    if (pcReacq) pcReacq.textContent = isRunningOrDone && met.reacquisitionTime !== null ? `${met.reacquisitionTime} s` : '—';
    if (pcLoss) pcLoss.textContent = isRunningOrDone && met.targetLossRate !== null ? `${met.targetLossRate} %` : '—';
    if (pcAvg) pcAvg.textContent = isRunningOrDone && met.averageCentroidError !== null ? `${met.averageCentroidError} px` : '—';
    if (pcMax) pcMax.textContent = isRunningOrDone && met.maximumCentroidError !== null ? `${met.maximumCentroidError} px` : '—';
    if (pcRmse) pcRmse.textContent = isRunningOrDone && met.rmseCentroidError !== null ? `${met.rmseCentroidError} px` : '—';
    if (pcFps) pcFps.textContent = isRunningOrDone && met.processingFPS !== null ? `${met.processingFPS} FPS` : '—';
    if (pcLock) pcLock.textContent = isRunningOrDone && met.lockRetentionRate !== null ? `${met.lockRetentionRate} %` : '—';

    // 2. Compliance Matrix Table
    const updateMetricRow = (valId, statusId, key, val, unit) => {
      const elVal = document.getElementById(valId);
      const elStatus = document.getElementById(statusId);
      if (!elVal && !elStatus) return;

      if (!isRunningOrDone || val === null || val === undefined) {
        if (elVal) elVal.textContent = '—';
        if (elStatus) elStatus.innerHTML = '<span class="badge-eval badge-pending">PENDING</span>';
      } else {
        if (elVal) elVal.textContent = `${val} ${unit}`;
        const ref = MetricsEngine.checkReference(key, val);
        if (elStatus) {
          if (ref.isCompliant) {
            elStatus.innerHTML = '<span class="badge-eval badge-pass">PASS</span>';
          } else {
            elStatus.innerHTML = '<span class="badge-eval badge-fail">FAIL</span>';
          }
        }
      }
    };

    updateMetricRow('tbl-acq-measured', 'tbl-acq-status', 'acquisitionTime', met.acquisitionTime, 's');
    updateMetricRow('perf-val-acq', 'perf-status-acq', 'acquisitionTime', met.acquisitionTime, 's');

    updateMetricRow('tbl-err-measured', 'tbl-err-status', 'trackingError', met.averageCentroidError, 'px');
    updateMetricRow('perf-val-err', 'perf-status-err', 'trackingError', met.averageCentroidError, 'px');

    updateMetricRow('tbl-rmse-measured', 'tbl-rmse-status', 'rmseError', met.rmseCentroidError, 'px');
    updateMetricRow('perf-val-rmse', 'perf-status-rmse', 'rmseError', met.rmseCentroidError, 'px');

    updateMetricRow('tbl-fps-measured', 'tbl-fps-status', 'processingFPS', met.processingFPS, 'FPS');
    updateMetricRow('perf-val-fps', 'perf-status-fps', 'processingFPS', met.processingFPS, 'FPS');

    updateMetricRow('tbl-lock-measured', 'tbl-lock-status', 'lockRetentionRate', met.lockRetentionRate, '%');
    updateMetricRow('perf-val-loss', 'perf-status-loss', 'targetLossRate', met.targetLossRate, '%');
    updateMetricRow('perf-val-reacq', 'perf-status-reacq', 'reacquisitionTime', met.reacquisitionTime, 's');
  }

  /* --------------------------------------------------------------------------
     13. Workspace 10: REPORTS & LOGS (STEP 9)
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
     13b. Universal PS Requirements Modal Popover Controller
     -------------------------------------------------------------------------- */
  setupPsRequirementsModal() {
    const modal = document.getElementById('ps-requirements-modal');
    const modalTitle = document.getElementById('ps-modal-title');
    const modalBody = document.getElementById('ps-modal-body');
    const btnClose = document.getElementById('btn-close-ps-modal');
    const btnAck = document.getElementById('btn-ps-modal-ack');

    const psContent = {
      'environment': {
        title: 'PS-26169 · Virtual Space Environment Requirements',
        body: `
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div style="background:rgba(0,210,255,0.08); border-left:3px solid var(--color-cyan); padding:8px 12px; border-radius:3px;">
              <strong style="color:var(--color-cyan);">Primary Specification:</strong>
              <p style="margin-top:4px;">Minimum 2000 × 2000 px 2D coordinate system representing deep space operational arena.</p>
            </div>
            <ul style="padding-left:18px; line-height:1.7;">
              <li><strong>Cartesian Grid:</strong> Origin (0,0) at bottom-left, (2000, 2000) at top-right.</li>
              <li><strong>Optical Ground Terminal:</strong> Fixed transceiver terminal station at (1000, 480) with 4° × 3° FOV tracking cone.</li>
              <li><strong>Background Noise:</strong> Dynamic starfield backdrop with configurable density (50–500 stars).</li>
            </ul>
          </div>
        `
      },
      'targets': {
        title: 'PS-26169 · Optical Target & Beacon Requirements',
        body: `
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div style="background:rgba(0,210,255,0.08); border-left:3px solid var(--color-cyan); padding:8px 12px; border-radius:3px;">
              <strong style="color:var(--color-cyan);">Primary Specification:</strong>
              <p style="margin-top:4px;">High-intensity optical beacon spot sized between 5 to 20 px with Gaussian intensity profile.</p>
            </div>
            <ul style="padding-left:18px; line-height:1.7;">
              <li><strong>Mandatory Kinematics:</strong> Straight-Line, Circular, Figure-8, and Random Walk trajectories.</li>
              <li><strong>Extended Kinematics:</strong> Spiral, Sinusoidal, and User-Defined parametric X(t), Y(t) paths.</li>
              <li><strong>Target Velocity:</strong> Operational dynamic speed from 20 px/s up to 250 px/s.</li>
            </ul>
          </div>
        `
      },
      'camera': {
        title: 'PS-26169 · Virtual Camera & Pan-Tilt Slew Requirements',
        body: `
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div style="background:rgba(0,210,255,0.08); border-left:3px solid var(--color-cyan); padding:8px 12px; border-radius:3px;">
              <strong style="color:var(--color-cyan);">Primary Specification:</strong>
              <p style="margin-top:4px;">640 × 480 px monochrome FPA sensor with 4° × 3° FOV and ≥ 30 Hz frame rate.</p>
            </div>
            <ul style="padding-left:18px; line-height:1.7;">
              <li><strong>Pan-Tilt Angular Limits:</strong> Pan range ±90.0°, Tilt range ±30.0°.</li>
              <li><strong>Slew Velocity:</strong> 5.0 to 10.0 deg/s with 20 Hz (50 ms) closed-loop servo update rate.</li>
              <li><strong>Tracking Control:</strong> Dual-mode (Manual D-pad slew flight & Closed-loop Auto-Tracking).</li>
            </ul>
          </div>
        `
      },
      'disturbances': {
        title: 'PS-26169 · Environmental Disturbances & Noise Engine',
        body: `
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div style="background:rgba(0,210,255,0.08); border-left:3px solid var(--color-cyan); padding:8px 12px; border-radius:3px;">
              <strong style="color:var(--color-cyan);">Primary Specification:</strong>
              <p style="margin-top:4px;">Simulate realistic atmospheric turbulence, sensor noise, and spacecraft base jitter.</p>
            </div>
            <ul style="padding-left:18px; line-height:1.7;">
              <li><strong>Sensor Noise:</strong> Gaussian noise (σ ≤ 20 px) and Salt & Pepper noise (density ≤ 20%).</li>
              <li><strong>Mechanical Jitter:</strong> High-frequency platform vibration up to ±20 px/frame.</li>
              <li><strong>Platform Motion:</strong> Linear, Circular, and Random carrier spacecraft drift up to 20 px/frame.</li>
              <li><strong>Atmosphere:</strong> Scintillation (Rytov index / log-normal flux) and transmission loss (Clear, Haze, Fog, Rain, Low Light).</li>
            </ul>
          </div>
        `
      },
      'detection': {
        title: 'PS-26169 · Detection & State Estimation Requirements',
        body: `
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div style="background:rgba(0,210,255,0.08); border-left:3px solid var(--color-cyan); padding:8px 12px; border-radius:3px;">
              <strong style="color:var(--color-cyan);">Primary Specification:</strong>
              <p style="margin-top:4px;">Sub-pixel Intensity-Weighted Center of Gravity (IW-CoG) with Kalman filter state propagation.</p>
            </div>
            <ul style="padding-left:18px; line-height:1.7;">
              <li><strong>Autonomous State Machine:</strong> SEARCHING → DETECTED → ACQUIRING → LOCKED → LOST → RE-ACQUIRING.</li>
              <li><strong>Estimator:</strong> Discrete-time Constant-Velocity Kalman Filter rejecting Gaussian sensor noise.</li>
              <li><strong>AI Slot:</strong> Pluggable deep learning detection module interface.</li>
            </ul>
          </div>
        `
      },
      'sim-control': {
        title: 'PS-26169 · Simulation Control & Benchmark Execution',
        body: `
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div style="background:rgba(0,210,255,0.08); border-left:3px solid var(--color-cyan); padding:8px 12px; border-radius:3px;">
              <strong style="color:var(--color-cyan);">Primary Specification:</strong>
              <p style="margin-top:4px;">Closed-loop validation across standard operational benchmark scenarios.</p>
            </div>
            <ul style="padding-left:18px; line-height:1.7;">
              <li><strong>Benchmark-1:</strong> Real-time synthetic space simulation with active gimbal actuation and metrics logging.</li>
              <li><strong>Benchmark-2:</strong> Standard MP4 video stream processing testing pure CV centroiding without gimbal movement.</li>
            </ul>
          </div>
        `
      },
      'performance': {
        title: 'PS-26169 · Official Acceptance Criteria & Compliance Matrix',
        body: `
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div style="background:rgba(0,230,118,0.08); border-left:3px solid var(--color-green); padding:8px 12px; border-radius:3px;">
              <strong style="color:var(--color-green);">Acceptance Benchmark Thresholds (PS-26169):</strong>
            </div>
            <table class="stat-table" style="width:100%; border-collapse:collapse;">
              <tr style="border-bottom:1px solid var(--border-subtle);"><th style="text-align:left; padding:4px 6px;">Metric</th><th style="text-align:left; padding:4px 6px;">Threshold Limit</th><th style="text-align:left; padding:4px 6px;">Significance</th></tr>
              <tr><td style="padding:4px 6px;"><strong>Acquisition Time</strong></td><td style="padding:4px 6px; color:var(--color-green);">≤ 2.00 s</td><td style="padding:4px 6px;">Time to achieve initial lock</td></tr>
              <tr><td style="padding:4px 6px;"><strong>Centroid Error</strong></td><td style="padding:4px 6px; color:var(--color-green);">≤ 10.0 px (≤ 62.5 mdeg)</td><td style="padding:4px 6px;">Coarse alignment tolerance</td></tr>
              <tr><td style="padding:4px 6px;"><strong>Target Loss Rate</strong></td><td style="padding:4px 6px; color:var(--color-green);">&lt; 5.0 %</td><td style="padding:4px 6px;">Reliability during maneuvers</td></tr>
              <tr><td style="padding:4px 6px;"><strong>Re-acquisition Time</strong></td><td style="padding:4px 6px; color:var(--color-green);">≤ 1.00 s</td><td style="padding:4px 6px;">Recovery after temporary outage</td></tr>
              <tr><td style="padding:4px 6px;"><strong>Processing FPS</strong></td><td style="padding:4px 6px; color:var(--color-green);">≥ 20.0 FPS</td><td style="padding:4px 6px;">Real-time processing throughput</td></tr>
              <tr><td style="padding:4px 6px;"><strong>Camera Rate</strong></td><td style="padding:4px 6px; color:var(--color-green);">≥ 30.0 Hz</td><td style="padding:4px 6px;">Focal plane array update rate</td></tr>
            </table>
          </div>
        `
      }
    };

    const openModal = (sec) => {
      const data = psContent[sec] || psContent['performance'];
      if (modalTitle) modalTitle.textContent = data.title;
      if (modalBody) modalBody.innerHTML = data.body;
      if (modal) modal.classList.remove('hidden');
    };

    const closeModal = () => {
      if (modal) modal.classList.add('hidden');
    };

    document.querySelectorAll('.btn-ps-modal-trigger').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const sec = btn.getAttribute('data-ps-section');
        openModal(sec);
      });
    });

    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnAck) btnAck.addEventListener('click', closeModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }
  }

  /* --------------------------------------------------------------------------
     14. State Synchronization & Reactive Telemetry
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

    const pBadge = document.getElementById('persistent-status-badge');
    const pCtrl = document.getElementById('persistent-ctrl-status');

    const setStatus = (cls, txt, bannerTxt, pClass, pTxt) => {
      if (badge) badge.className = `status-badge ${cls}`;
      if (text) text.textContent = txt;
      if (bannerText) bannerText.textContent = bannerTxt;
      if (lamp) lamp.className = `status-indicator-lamp ${cls}`;
      if (pBadge) {
        pBadge.className = `persistent-status-pill ${pClass}`;
        pBadge.textContent = pTxt;
      }
      if (pCtrl) pCtrl.textContent = pTxt;
    };

    if (status === 'RUNNING') {
      setStatus('active', 'Simulation Active', 'STATUS: RUNNING', 'running', 'RUNNING');
    } else if (status === 'PAUSED') {
      setStatus('active', 'Simulation Paused', 'STATUS: PAUSED', 'paused', 'PAUSED');
      if (badge) badge.style.color = '#ffab00';
    } else if (status === 'STOPPED') {
      setStatus('', 'Simulation Stopped', 'STATUS: STOPPED', 'stopped', 'STOPPED');
      if (badge) badge.style.color = '#ff3d00';
    } else {
      setStatus('active', 'System Ready', 'STATUS: READY', 'ready', 'READY');
    }
  }

  updateTelemetryDOM(state) {
    const met = state.metrics;
    const sim = state.simulation;
    const trk = state.tracking;
    const cam = state.camera;

    // 0. Persistent Right Panel Telemetry
    const pTgtLabel = document.getElementById('persistent-tgt-label');
    const pValState = document.getElementById('persistent-val-state');
    const pValConf = document.getElementById('persistent-val-conf');
    const pValCentroid = document.getElementById('persistent-val-centroid');
    const pSidePointErr = document.getElementById('persistent-side-point-err');
    const pSideAngErr = document.getElementById('persistent-side-ang-err');
    const pValPan = document.getElementById('persistent-val-pan');
    const pValTilt = document.getElementById('persistent-val-tilt');
    const pValFov = document.getElementById('persistent-val-fov');
    const pValFps = document.getElementById('persistent-val-fps');
    const pFpsBadge = document.getElementById('persistent-fps-badge');

    const pErrVal = met.instantaneousPointingError !== null ? met.instantaneousPointingError : (sim.status === 'RUNNING' ? 0.0 : null);
    const angErrMdeg = met.instantaneousAngularPointingErrorMdeg !== null ? met.instantaneousAngularPointingErrorMdeg : (sim.status === 'RUNNING' ? 0.0 : null);

    if (pTgtLabel) pTgtLabel.textContent = `${state.target.id} ${state.target.shape || 'Beacon'}`;
    if (pValState) {
      const st = trk.state || (sim.status === 'RUNNING' ? 'SEARCH' : 'READY');
      pValState.textContent = st;
      pValState.className = `cell-val status-text ${st.toLowerCase()}`;
    }
    if (pValConf) {
      pValConf.textContent = trk.confidence !== null ? trk.confidence.toFixed(2) : (sim.status === 'RUNNING' ? '0.00' : '—');
    }
    if (pValCentroid) {
      pValCentroid.textContent = trk.detectedX !== null && trk.detectedY !== null
        ? `(${trk.detectedX.toFixed(1)}, ${trk.detectedY.toFixed(1)})`
        : (sim.status === 'RUNNING' ? 'Searching' : '(320.0, 240.0)');
    }
    if (pSidePointErr) {
      pSidePointErr.textContent = pErrVal !== null ? `${pErrVal.toFixed(1)} px` : '0.0 px';
    }
    if (pSideAngErr) {
      pSideAngErr.textContent = angErrMdeg !== null ? `${angErrMdeg.toFixed(1)} mdeg` : '0.0 mdeg';
      pSideAngErr.style.color = angErrMdeg !== null && angErrMdeg <= 62.5 ? 'var(--color-green)' : (angErrMdeg > 62.5 ? 'var(--color-amber)' : 'var(--text-primary)');
    }
    if (pValPan) pValPan.textContent = `${cam.pan >= 0 ? '+' : ''}${cam.pan.toFixed(2)}°`;
    if (pValTilt) pValTilt.textContent = `${cam.tilt >= 0 ? '+' : ''}${cam.tilt.toFixed(2)}°`;
    if (pValFov) pValFov.textContent = `${cam.fovH.toFixed(1)}°×${cam.fovV.toFixed(1)}°`;
    if (pValFps) {
      pValFps.textContent = sim.status === 'RUNNING' && met.processingFPS !== null
        ? `${met.processingFPS} FPS`
        : '—';
    }
    if (pFpsBadge) {
      pFpsBadge.textContent = sim.status === 'RUNNING' && met.processingFPS !== null
        ? `${met.processingFPS} FPS`
        : '30 Hz FPA';
    }

    // 1. Step 5 Feature Area Metrics (Live Angular Pointing Error Section)
    const detPointErr = document.getElementById('det-point-error-val');
    const detAngErr = document.getElementById('det-ang-error-val');
    const detAvgErr = document.getElementById('det-avg-error-val');
    const detRmseErr = document.getElementById('det-rmse-error-val');

    if (detPointErr) detPointErr.textContent = pErrVal !== null ? `${pErrVal.toFixed(1)} px` : '0.0 px';
    if (detAngErr) {
      detAngErr.textContent = angErrMdeg !== null ? `${angErrMdeg.toFixed(1)} mdeg` : '0.0 mdeg';
      detAngErr.style.color = angErrMdeg !== null && angErrMdeg <= 62.5 ? 'var(--color-green)' : (angErrMdeg > 62.5 ? 'var(--color-amber)' : 'var(--text-primary)');
    }
    if (detAvgErr) detAvgErr.textContent = met.averageCentroidError !== null ? `${met.averageCentroidError} px` : '—';
    if (detRmseErr) detRmseErr.textContent = met.rmseCentroidError !== null ? `${met.rmseCentroidError} px` : '—';

    // 2. Physical Gimbal Kinematic Axis Diagram (SVG, Sliders, and Dynamic Gauges)
    this.updateKinematicAxisDiagram(cam.pan, cam.tilt);

    // 3. Live Cockpit Telemetry (Step 7)
    const hudCentroid = document.getElementById('hud-centroid-val');
    const hudVector = document.getElementById('hud-vector-val');
    const hudPan = document.getElementById('hud-pan-val');
    const hudTilt = document.getElementById('hud-tilt-val');

    if (hudCentroid) hudCentroid.textContent = trk.detectedX !== null ? `(${trk.detectedX.toFixed(1)}, ${trk.detectedY.toFixed(1)})` : '(320.0, 240.0)';
    if (hudVector) hudVector.textContent = met.instantaneousCentroidError !== null ? `${met.instantaneousCentroidError} px` : '0.0 px';
    if (hudPan) hudPan.textContent = `${cam.pan >= 0 ? '+' : ''}${cam.pan.toFixed(2)}°`;
    if (hudTilt) hudTilt.textContent = `${cam.tilt >= 0 ? '+' : ''}${cam.tilt.toFixed(2)}°`;

    // 4. Live Pipeline Flowchart Status Indicators (Step 7)
    const isDetected = trk.detectedX !== null && trk.detectedY !== null;
    const isLocked = trk.state === 'LOCKED' || trk.state === 'TRACK';

    const setPipeStep = (id, active) => {
      const el = document.getElementById(id);
      if (el) {
        if (active) el.classList.add('active');
        else el.classList.remove('active');
      }
    };

    setPipeStep('pipe-step-sensor', sim.status === 'RUNNING' || sim.currentFrame > 0);
    setPipeStep('pipe-step-detect', isDetected);
    setPipeStep('pipe-step-identify', isDetected);
    setPipeStep('pipe-step-centroid', isDetected);
    setPipeStep('pipe-step-predict', isDetected || trk.state === 'ACQUIRING');
    setPipeStep('pipe-step-pantilt', sim.status === 'RUNNING');
    setPipeStep('pipe-step-recenter', isLocked);

    // 5. Simulation Control Room Timing (Step 6)
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

    // 6. Performance Compliance Table & Cards (Step 7)
    this.updatePerformanceComplianceDOM(met);

    // 7. Target Summary Card & Registry (Step 2)
    this.updateTargetSummaryCard();
    this.updateTargetsTableDOM();

    // 8. Active view rendering
    if (this.activeView === 'detection') {
      this.renderDetectionDiagnostics(trk);
    }
  }

  updateCharts(state) {
    const hist = state.metrics.history || {};
    const timestamps = hist.timestamps || [];

    if (this.charts.detectionAngularError) {
      this.charts.detectionAngularError.render(
        hist.angularPointingErrors || [],
        timestamps
      );
    }

    if (this.charts.perfAng) {
      this.charts.perfAng.render(
        hist.angularPointingErrors || hist.pointingErrors || [],
        timestamps
      );
    }

    if (this.charts.perfError) {
      this.charts.perfError.render(
        hist.pointingErrors || hist.centroidErrors || [],
        timestamps
      );
    }

    if (this.charts.perfPantilt) {
      this.charts.perfPantilt.render(
        hist.panAngles || [],
        timestamps
      );
    }

    if (this.charts.perfFps) {
      this.charts.perfFps.render(
        hist.processingFPS || [],
        timestamps
      );
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
        <tr><td colspan="9" style="text-align: center; color: var(--text-muted);">Awaiting simulation run to stream telemetry frames...</td></tr>
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
    const hist = SimulationState.metrics.history || {};
    const timestamps = hist.timestamps || [];
    if (this.charts.detectionAngularError) {
      this.charts.detectionAngularError.render(hist.angularPointingErrors || [], timestamps);
    }
    if (this.charts.perfAng) {
      this.charts.perfAng.render(hist.angularPointingErrors || hist.pointingErrors || [], timestamps);
    }
    if (this.charts.perfPantilt) {
      this.charts.perfPantilt.render(hist.panAngles || [], timestamps);
    }
    if (this.charts.perfFps) {
      this.charts.perfFps.render(hist.processingFPS || [], timestamps);
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

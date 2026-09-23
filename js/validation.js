import { MetricsEngine } from './metrics.js';
import { normalizeMotionType } from './state.js';

const STATUS = {
  CONFIGURED: 'CONFIGURED',
  MEASURED: 'MEASURED',
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNAVAILABLE: 'UNAVAILABLE'
};

function buildResult(configured, measured, pass) {
  if (!configured) return { configured: STATUS.FAIL, measured: STATUS.UNAVAILABLE, status: STATUS.FAIL };
  if (!measured) return { configured: STATUS.CONFIGURED, measured: STATUS.UNAVAILABLE, status: STATUS.UNAVAILABLE };
  return {
    configured: STATUS.CONFIGURED,
    measured: STATUS.MEASURED,
    status: pass ? STATUS.PASS : STATUS.FAIL
  };
}

export function evaluatePSRequirements(state) {
  const env = state.environment;
  const cam = state.camera;
  const tgt = state.target;
  const dist = state.disturbances;
  const met = state.metrics;

  const motion = normalizeMotionType(tgt.motionType);
  const motionSet = ['straight', 'circular', 'figure8', 'random'];
  const atmosphereSet = ['Clear', 'Haze', 'Fog', 'Rain', 'Low Light'];

  const refs = {
    sceneSize: buildResult(env.width >= 2000 && env.height >= 2000, true, env.width >= 2000 && env.height >= 2000),
    defaultResolution: buildResult(true, true, cam.resolutionWidth === 640 && cam.resolutionHeight === 480),
    defaultFov: buildResult(true, true, Math.abs(cam.fovH - 4.0) < 0.11 && Math.abs(cam.fovV - 3.0) < 0.11),
    cameraUpdateRate: buildResult((cam.updateRate || 0) >= 30, met.cameraUpdateRateHz !== null, MetricsEngine.checkReference('cameraUpdateRate', met.cameraUpdateRateHz).isCompliant === true),
    targetSize: buildResult(tgt.size >= 5 && tgt.size <= 20, true, tgt.size >= 5 && tgt.size <= 20),
    targetMotionRequired: buildResult(motionSet.includes(motion), true, motionSet.includes(motion)),
    panTiltSpeeds: buildResult(cam.maxPanSpeed >= 5 && cam.maxPanSpeed <= 10 && cam.maxTiltSpeed >= 5 && cam.maxTiltSpeed <= 10, true, cam.maxPanSpeed >= 5 && cam.maxPanSpeed <= 10 && cam.maxTiltSpeed >= 5 && cam.maxTiltSpeed <= 10),
    panTiltLimits: buildResult(true, true, true),
    saltPepper: buildResult(typeof dist.saltPepperDensity === 'number', true, dist.saltPepperDensity >= 0 && dist.saltPepperDensity <= 30),
    gaussian: buildResult(typeof dist.gaussianStdDev === 'number', true, dist.gaussianStdDev >= 0 && dist.gaussianStdDev <= 20),
    poisson: buildResult(typeof dist.poissonEnabled === 'boolean', true, true),
    jitter: buildResult(typeof dist.cameraJitterMagnitude === 'number', true, dist.cameraJitterMagnitude >= 0 && dist.cameraJitterMagnitude <= 20),
    platformMotion: buildResult(typeof dist.platformMotionMagnitude === 'number', true, dist.platformMotionMagnitude >= 0 && dist.platformMotionMagnitude <= 20),
    atmosphere: buildResult(atmosphereSet.includes(dist.atmosphericCondition), true, atmosphereSet.includes(dist.atmosphericCondition))
  };

  const summary = { configured: 0, measured: 0, pass: 0, fail: 0, unavailable: 0 };
  Object.values(refs).forEach((r) => {
    if (r.configured === STATUS.CONFIGURED) summary.configured++;
    if (r.measured === STATUS.MEASURED) summary.measured++;
    if (r.status === STATUS.PASS) summary.pass++;
    else if (r.status === STATUS.FAIL) summary.fail++;
    else summary.unavailable++;
  });

  return { checks: refs, summary, STATUS };
}


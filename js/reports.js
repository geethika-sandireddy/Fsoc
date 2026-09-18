/**
 * Performance Report Generator & Telemetry Exporter — ISRO PS-26169.
 * Generates official PS-26169 Performance Reports with complete configuration snapshots,
 * random seeds, measured metrics, CSV/JSON downloads, and printable views.
 */

import { SimulationState } from './state.js';
import { MetricsEngine, PS_REFERENCES } from './metrics.js';

export class ReportEngine {
  /**
   * Compiles the complete performance report object.
   */
  static generateReportData() {
    const sim = SimulationState.simulation;
    const met = SimulationState.metrics;
    const tgt = SimulationState.target;
    const cam = SimulationState.camera;
    const dist = SimulationState.disturbances;
    const env = SimulationState.environment;

    return {
      reportTitle: 'PS-26169 Performance Report',
      subtitle: 'AI-Based Virtual Camera Tracking System for Coarse Alignment of Mobile FSOC Terminals',
      organization: 'Department of Space / Indian Space Research Organisation',
      generatedAt: new Date().toISOString(),
      runId: sim.runId || ('RUN_' + Date.now().toString(36).toUpperCase()),
      seed: sim.seed || 26169,
      durationSeconds: parseFloat(sim.elapsedTime.toFixed(2)),
      totalFrames: sim.currentFrame,

      configurationSnapshot: {
        environment: {
          dimensions: `${env.width} x ${env.height} pixels`,
          gridSpacing: `${env.gridSpacing} pixels`
        },
        target: {
          id: tgt.id,
          type: tgt.type,
          shape: tgt.shape,
          size: `${tgt.size} x ${tgt.size} pixels`,
          motionType: tgt.motionType,
          speed: `${tgt.speed} px/s`,
          initialLocation: tgt.initialLocation
        },
        camera: {
          resolution: `${cam.resolutionWidth} x ${cam.resolutionHeight} pixels`,
          sensorType: cam.sensorType,
          fov: `${cam.fovH}° x ${cam.fovV}°`,
          updateRate: `${cam.updateRate} Hz`,
          maxPanSpeed: `${cam.maxPanSpeed} °/s`,
          maxTiltSpeed: `${cam.maxTiltSpeed} °/s`,
          controlInterval: `${cam.controlUpdateInterval} ms`
        },
        disturbances: {
          saltPepper: dist.saltPepperEnabled ? `${dist.saltPepperDensity}%` : 'Disabled',
          gaussian: dist.gaussianEnabled ? `SD = ${dist.gaussianStdDev} px` : 'Disabled',
          poisson: dist.poissonEnabled ? 'Enabled' : 'Disabled',
          cameraJitter: dist.cameraJitterEnabled ? `±${dist.cameraJitterMagnitude} px/frame` : 'Disabled',
          atmosphere: `${dist.atmosphericCondition} (Contrast: -${Math.round(dist.contrastReduction * 100)}%, Brightness: -${Math.round(dist.brightnessReduction * 100)}%)`,
          platformMotion: `${dist.platformMotionType} (±${dist.platformMotionMagnitude} px/frame)`
        }
      },

      measuredPerformance: {
        acquisitionTime: {
          measured: met.acquisitionTime !== null ? `${met.acquisitionTime} s` : '—',
          reference: PS_REFERENCES.acquisitionTime.condition,
          status: MetricsEngine.checkReference('acquisitionTime', met.acquisitionTime).status
        },
        reacquisitionTime: {
          measured: met.reacquisitionTime !== null ? `${met.reacquisitionTime} s` : '—',
          reference: PS_REFERENCES.reacquisitionTime.condition,
          status: MetricsEngine.checkReference('reacquisitionTime', met.reacquisitionTime).status
        },
        averageCentroidError: {
          measured: met.averageCentroidError !== null ? `${met.averageCentroidError} px` : '—',
          reference: PS_REFERENCES.trackingError.condition,
          status: MetricsEngine.checkReference('trackingError', met.averageCentroidError).status
        },
        maximumCentroidError: {
          measured: met.maximumCentroidError !== null ? `${met.maximumCentroidError} px` : '—',
          reference: 'Informational'
        },
        rmseCentroidError: {
          measured: met.rmseCentroidError !== null ? `${met.rmseCentroidError} px` : '—',
          reference: 'RMSE benchmark'
        },
        targetLossRate: {
          measured: met.targetLossRate !== null ? `${met.targetLossRate} %` : '—',
          reference: PS_REFERENCES.targetLossRate.condition,
          status: MetricsEngine.checkReference('targetLossRate', met.targetLossRate).status
        },
        lockRetentionRate: {
          measured: met.lockRetentionRate !== null ? `${met.lockRetentionRate} %` : '—',
          reference: 'Benchmark metric'
        },
        processingFPS: {
          measured: met.processingFPS !== null ? `${met.processingFPS} FPS` : '—',
          reference: PS_REFERENCES.processingFPS.condition,
          status: MetricsEngine.checkReference('processingFPS', met.processingFPS).status
        },
        simulationFPS: {
          measured: met.simulationFPS !== null ? `${met.simulationFPS} Hz` : '—',
          reference: PS_REFERENCES.cameraUpdateRate.condition,
          status: MetricsEngine.checkReference('cameraUpdateRate', met.simulationFPS).status
        }
      }
    };
  }

  /**
   * Downloads data as CSV file.
   */
  static exportCSV(logs, filename = 'fsoc_centroid_error_log.csv') {
    if (!logs || logs.length === 0) {
      alert('No telemetry log records available to export.');
      return;
    }

    const headers = [
      'Frame', 'Time_s', 'GroundTruth_X', 'GroundTruth_Y',
      'Detected_X', 'Detected_Y', 'Delta_X', 'Delta_Y',
      'Centroid_Error_px', 'Pointing_Error_px', 'Pan_deg', 'Tilt_deg', 'State'
    ];

    const rows = logs.map(l => [
      l.frame, l.time, l.gtX, l.gtY,
      l.detX, l.detY, l.dx, l.dy,
      l.centroidError, l.pointingError, l.pan, l.tilt, l.state
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Downloads structured JSON report.
   */
  static exportJSON(reportData, filename = 'ps26169_test_report.json') {
    const jsonStr = JSON.stringify(reportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Opens a clean printable report window.
   */
  static printReport(reportData) {
    const w = window.open('', '_blank');
    if (!w) {
      alert('Popup blocked. Please allow popups to print report.');
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${reportData.reportTitle} — ${reportData.runId}</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; margin: 40px; color: #1a202c; background: #fff; }
          h1 { color: #0b1f44; font-size: 20px; margin-bottom: 4px; }
          h2 { color: #2d3748; font-size: 14px; margin-top: 0; font-weight: normal; }
          .meta { font-size: 11px; color: #718096; margin-bottom: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 11px; }
          th, td { border: 1px solid #cbd5e0; padding: 6px 10px; text-align: left; }
          th { background: #f7fafc; color: #2d3748; font-weight: 600; }
          .badge-ok { color: #276749; font-weight: bold; }
          .badge-warn { color: #c05621; font-weight: bold; }
          .section-title { font-size: 13px; font-weight: bold; color: #1a365d; margin: 20px 0 8px 0; }
          @media print { body { margin: 15mm; } button { display: none; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()" style="float: right; padding: 8px 16px; background: #2b6cb0; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Print / Save PDF</button>
        <h1>${reportData.reportTitle}</h1>
        <h2>${reportData.subtitle}</h2>
        <div class="meta">
          <strong>Organization:</strong> ${reportData.organization} | 
          <strong>Run ID:</strong> ${reportData.runId} | 
          <strong>PRNG Seed:</strong> ${reportData.seed} | 
          <strong>Generated:</strong> ${reportData.generatedAt} | 
          <strong>Duration:</strong> ${reportData.durationSeconds} s (${reportData.totalFrames} frames)
        </div>

        <div class="section-title">1. Measured Performance vs PS-26169 Reference Specifications</div>
        <table>
          <thead>
            <tr>
              <th>Performance Metric</th>
              <th>Measured Value</th>
              <th>PS-26169 Reference</th>
              <th>Compliance Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Acquisition Time</td>
              <td><strong>${reportData.measuredPerformance.acquisitionTime.measured}</strong></td>
              <td>${reportData.measuredPerformance.acquisitionTime.reference}</td>
              <td class="${reportData.measuredPerformance.acquisitionTime.status === 'WITHIN REFERENCE' ? 'badge-ok' : 'badge-warn'}">${reportData.measuredPerformance.acquisitionTime.status}</td>
            </tr>
            <tr>
              <td>Average Centroiding Error</td>
              <td><strong>${reportData.measuredPerformance.averageCentroidError.measured}</strong></td>
              <td>${reportData.measuredPerformance.averageCentroidError.reference}</td>
              <td class="${reportData.measuredPerformance.averageCentroidError.status === 'WITHIN REFERENCE' ? 'badge-ok' : 'badge-warn'}">${reportData.measuredPerformance.averageCentroidError.status}</td>
            </tr>
            <tr>
              <td>Target Loss Rate</td>
              <td><strong>${reportData.measuredPerformance.targetLossRate.measured}</strong></td>
              <td>${reportData.measuredPerformance.targetLossRate.reference}</td>
              <td class="${reportData.measuredPerformance.targetLossRate.status === 'WITHIN REFERENCE' ? 'badge-ok' : 'badge-warn'}">${reportData.measuredPerformance.targetLossRate.status}</td>
            </tr>
            <tr>
              <td>Re-acquisition Time</td>
              <td><strong>${reportData.measuredPerformance.reacquisitionTime.measured}</strong></td>
              <td>${reportData.measuredPerformance.reacquisitionTime.reference}</td>
              <td class="${reportData.measuredPerformance.reacquisitionTime.status === 'WITHIN REFERENCE' ? 'badge-ok' : 'badge-warn'}">${reportData.measuredPerformance.reacquisitionTime.status}</td>
            </tr>
            <tr>
              <td>Processing Speed</td>
              <td><strong>${reportData.measuredPerformance.processingFPS.measured}</strong></td>
              <td>${reportData.measuredPerformance.processingFPS.reference}</td>
              <td class="${reportData.measuredPerformance.processingFPS.status === 'WITHIN REFERENCE' ? 'badge-ok' : 'badge-warn'}">${reportData.measuredPerformance.processingFPS.status}</td>
            </tr>
            <tr>
              <td>RMSE Centroiding Error</td>
              <td><strong>${reportData.measuredPerformance.rmseCentroidError.measured}</strong></td>
              <td>${reportData.measuredPerformance.rmseCentroidError.reference}</td>
              <td>—</td>
            </tr>
            <tr>
              <td>Lock Retention Rate</td>
              <td><strong>${reportData.measuredPerformance.lockRetentionRate.measured}</strong></td>
              <td>${reportData.measuredPerformance.lockRetentionRate.reference}</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>

        <div class="section-title">2. Configuration Snapshot</div>
        <table>
          <thead>
            <tr><th>Parameter Group</th><th>Configuration Details</th></tr>
          </thead>
          <tbody>
            <tr><td>Environment</td><td>Dimensions: ${reportData.configurationSnapshot.environment.dimensions}, Grid: ${reportData.configurationSnapshot.environment.gridSpacing}</td></tr>
            <tr><td>Target Beacon</td><td>ID: ${reportData.configurationSnapshot.target.id}, Shape: ${reportData.configurationSnapshot.target.shape}, Size: ${reportData.configurationSnapshot.target.size}, Motion: ${reportData.configurationSnapshot.target.motionType}, Speed: ${reportData.configurationSnapshot.target.speed}</td></tr>
            <tr><td>Virtual Camera</td><td>Resolution: ${reportData.configurationSnapshot.camera.resolution}, FOV: ${reportData.configurationSnapshot.camera.fov}, Update Rate: ${reportData.configurationSnapshot.camera.updateRate}, Max Pan/Tilt: ${reportData.configurationSnapshot.camera.maxPanSpeed}</td></tr>
            <tr><td>Disturbances</td><td>S&P: ${reportData.configurationSnapshot.disturbances.saltPepper}, Gaussian: ${reportData.configurationSnapshot.disturbances.gaussian}, Atmosphere: ${reportData.configurationSnapshot.disturbances.atmosphere}, Platform: ${reportData.configurationSnapshot.disturbances.platformMotion}, Jitter: ${reportData.configurationSnapshot.disturbances.cameraJitter}</td></tr>
          </tbody>
        </table>

        <div style="font-size: 10px; color: #a0aec0; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 8px;">
          Student Prototype / SIH Submission — PS-26169 Free Space Optical Communication Coarse Tracking System
        </div>
      </body>
      </html>
    `;

    w.document.open();
    w.document.write(html);
    w.document.close();
  }
}

/**
 * Telemetry Sparklines & Real-time Charts — ISRO PS-26169.
 * High-performance canvas chart renderers for Centroid Error, Pan, Tilt, and FPS
 * with PS-26169 reference threshold lines.
 */

export class TelemetryChart {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.title = options.title || '';
    this.minY = options.minY !== undefined ? options.minY : 0;
    this.maxY = options.maxY !== undefined ? options.maxY : 20;
    this.lineColor = options.lineColor || '#00d2ff';
    this.refValue = options.refValue !== undefined ? options.refValue : null;
    this.refColor = options.refColor || 'rgba(255, 60, 60, 0.7)';
    this.unit = options.unit || '';
  }

  render(dataSeries, timeSeries) {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const w = canvas.width;
    const h = canvas.height;

    // Background
    ctx.fillStyle = '#060c18';
    ctx.fillRect(0, 0, w, h);

    const padLeft = 32;
    const padRight = 10;
    const padTop = 18;
    const padBottom = 16;

    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    // Grid lines (3 horizontal lines)
    ctx.strokeStyle = '#0e223f';
    ctx.lineWidth = 1;
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillStyle = '#5c769d';

    for (let i = 0; i <= 2; i++) {
      const yVal = this.minY + (this.maxY - this.minY) * (i / 2);
      const py = padTop + plotH - (i / 2) * plotH;

      ctx.beginPath();
      ctx.moveTo(padLeft, py);
      ctx.lineTo(w - padRight, py);
      ctx.stroke();

      ctx.fillText(`${yVal.toFixed(0)}`, 4, py + 3);
    }

    // Chart title in top left
    ctx.fillStyle = '#90a4ae';
    ctx.font = '9px "Inter", sans-serif';
    ctx.fillText(`${this.title} ${this.unit ? '(' + this.unit + ')' : ''}`, padLeft, 12);

    // Reference line (e.g. <=10 px error or >=20 FPS)
    if (this.refValue !== null && this.refValue >= this.minY && this.refValue <= this.maxY) {
      const refY = padTop + plotH - ((this.refValue - this.minY) / (this.maxY - this.minY)) * plotH;
      ctx.strokeStyle = this.refColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padLeft, refY);
      ctx.lineTo(w - padRight, refY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (!dataSeries || dataSeries.length < 2) {
      // Uninitialized / idle indicator
      ctx.fillStyle = '#37474f';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText('WAITING FOR TELEMETRY...', w / 2 - 60, h / 2 + 3);
      return;
    }

    // Plot data line
    ctx.strokeStyle = this.lineColor;
    ctx.lineWidth = 1.6;
    ctx.beginPath();

    const n = dataSeries.length;
    for (let i = 0; i < n; i++) {
      const val = dataSeries[i];
      const clampedVal = Math.max(this.minY, Math.min(this.maxY, val));
      const px = padLeft + (i / (n - 1)) * plotW;
      const py = padTop + plotH - ((clampedVal - this.minY) / (this.maxY - this.minY)) * plotH;

      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Latest value badge
    const latestVal = dataSeries[n - 1];
    ctx.fillStyle = this.lineColor;
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    const valStr = `${latestVal.toFixed(1)}${this.unit}`;
    ctx.fillText(valStr, w - padRight - 38, 12);
  }
}

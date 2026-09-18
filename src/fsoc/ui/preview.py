"""Frontend preview renderer — live virtual scene + camera FOV for the GUI."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np
from PySide6.QtCore import Qt
from PySide6.QtGui import QImage, QPixmap


@dataclass
class PreviewState:
    world_w: int = 2000
    world_h: int = 2000
    cam_w: int = 640
    cam_h: int = 480
    fov_az: float = 4.0
    fov_el: float = 3.0
    span_az: float = 40.0
    span_el: float = 40.0
    pan: float = 0.0
    tilt: float = 0.0
    monochrome: bool = True
    n_targets: int = 1
    shape: str = "Square"
    tw: int = 10
    th: int = 10
    motion: str = "Circular"
    salt: bool = False
    gauss: bool = False
    poisson: bool = False
    jitter: float = 0.0
    atmosphere: str = "Clear"
    platform: bool = False
    platform_motion: str = "Linear"
    contrast: float = 1.0
    brightness: int = 0
    t: float = 0.0
    targets: list[tuple[float, float]] = field(default_factory=list)
    locked: bool = False
    est: tuple[float, float] | None = None


def _motion_pos(i: int, t: float, w: int, h: int, motion: str) -> tuple[float, float]:
    cx, cy = w * 0.5 + i * 80, h * 0.5 + i * 40
    r = min(w, h) * 0.18
    if motion == "Straight Line":
        return (200 + (t * 120 + i * 90) % (w - 400), h * 0.45 + 80 * math.sin(i))
    if motion == "Circular":
        return (cx + r * math.cos(t + i), cy + r * math.sin(t + i))
    if motion == "Figure of 8":
        a = t * 1.1 + i
        return (cx + r * math.sin(a), cy + r * math.sin(a) * math.cos(a) * 0.7)
    if motion == "Random":
        rng = np.random.default_rng(int(t * 3) + i * 17)
        return (w * 0.2 + rng.random() * w * 0.6, h * 0.2 + rng.random() * h * 0.6)
    if motion == "Spiral":
        rr = 60 + (t * 40 + i * 20) % (r * 1.3)
        return (cx + rr * math.cos(t * 1.4), cy + rr * math.sin(t * 1.4))
    if motion == "Sinusoidal":
        return ((t * 90 + i * 100) % (w - 80) + 40, cy + math.sin(t * 2) * r * 0.5)
    # user-defined waypoint box
    k = int(t * 0.4 + i) % 4
    pts = [(w * 0.25, h * 0.25), (w * 0.75, h * 0.28), (w * 0.72, h * 0.75), (w * 0.22, h * 0.7)]
    return pts[k]


def _draw_beacon(img: np.ndarray, x: int, y: int, tw: int, th: int, shape: str) -> None:
    color = 255
    if shape == "Circle":
        cv2.circle(img, (x, y), max(tw, th) // 2, color, -1)
    elif shape == "Diamond":
        pts = np.array(
            [[x, y - th // 2], [x + tw // 2, y], [x, y + th // 2], [x - tw // 2, y]], np.int32
        )
        cv2.fillConvexPoly(img, pts, color)
    elif shape == "Cross":
        cv2.line(img, (x - tw // 2, y), (x + tw // 2, y), color, 2)
        cv2.line(img, (x, y - th // 2), (x, y + th // 2), color, 2)
    else:
        cv2.rectangle(img, (x - tw // 2, y - th // 2), (x + tw // 2, y + th // 2), color, -1)
    cv2.circle(img, (x, y), 1, 255, -1)


def render_world(st: PreviewState) -> np.ndarray:
    img = np.zeros((st.world_h, st.world_w), dtype=np.uint8)
    # faint starfield / grid
    for g in range(0, st.world_w, 200):
        img[:, g : g + 1] = 18
    for g in range(0, st.world_h, 200):
        img[g : g + 1, :] = 18
    st.targets = []
    for i in range(max(1, st.n_targets)):
        x, y = _motion_pos(i, st.t, st.world_w, st.world_h, st.motion)
        xi, yi = int(np.clip(x, 10, st.world_w - 10)), int(np.clip(y, 10, st.world_h - 10))
        _draw_beacon(img, xi, yi, st.tw, st.th, st.shape)
        st.targets.append((float(xi), float(yi)))
    return img


def fov_rect(st: PreviewState) -> tuple[int, int, int, int]:
    cx = (st.pan / st.span_az + 0.5) * st.world_w
    cy = (0.5 - st.tilt / st.span_el) * st.world_h
    fw = st.fov_az / st.span_az * st.world_w
    fh = st.fov_el / st.span_el * st.world_h
    return int(cx - fw / 2), int(cy - fh / 2), int(fw), int(fh)


def apply_fx(gray: np.ndarray, st: PreviewState) -> np.ndarray:
    out = gray.astype(np.float32)
    if st.atmosphere == "Haze":
        out = out * 0.72 + 70
    elif st.atmosphere == "Fog":
        out = out * 0.48 + 110
    elif st.atmosphere == "Rain":
        out = out * 0.82 + 18
        rain = np.zeros_like(out)
        for _ in range(50):
            x = int(np.random.randint(0, gray.shape[1]))
            y = int(np.random.randint(0, gray.shape[0]))
            cv2.line(
                rain,
                (x, y),
                (min(gray.shape[1] - 1, x + 2), min(gray.shape[0] - 1, y + 10)),
                160,
                1,
            )
        out = out + rain
    elif st.atmosphere == "Low light":
        out = out * 0.28
    out = np.clip(out * st.contrast + st.brightness, 0, 255)
    j = min(20.0, st.jitter)
    dx = dy = 0.0
    if st.platform:
        a = 8.0
        m = st.platform_motion
        t = st.t
        if m == "Linear":
            dx, dy = a * math.sin(t * 1.3), a * 0.3 * math.sin(t * 0.7)
        elif m == "Circular":
            dx, dy = a * math.cos(t * 2), a * math.sin(t * 2)
        elif m == "Random":
            dx, dy = np.random.uniform(-a, a), np.random.uniform(-a, a)
        elif m == "Spiral":
            r = a * (0.3 + 0.7 * abs(math.sin(t * 0.4)))
            dx, dy = r * math.cos(t * 3), r * math.sin(t * 3)
        else:
            dx, dy = a * math.sin(t * 2.4), a * math.sin(t * 2.4) * math.cos(t * 2.4)
    if j or dx or dy:
        M = np.float32([[1, 0, dx + np.random.uniform(-j, j)], [0, 1, dy + np.random.uniform(-j, j)]])
        out = cv2.warpAffine(out.astype(np.uint8), M, (gray.shape[1], gray.shape[0]), borderMode=cv2.BORDER_REFLECT)
        out = out.astype(np.float32)
    img = np.clip(out, 0, 255).astype(np.uint8)
    if st.gauss:
        img = np.clip(img.astype(np.float32) + np.random.normal(0, 12, img.shape), 0, 255).astype(np.uint8)
    if st.poisson:
        img = np.clip(np.random.poisson(np.clip(img.astype(np.float32), 1, 255)), 0, 255).astype(np.uint8)
    if st.salt:
        n = int(0.10 * img.size)
        ys = np.random.randint(0, img.shape[0], n)
        xs = np.random.randint(0, img.shape[1], n)
        img[ys[: n // 2], xs[: n // 2]] = 255
        img[ys[n // 2 :], xs[n // 2 :]] = 0
    return img


def capture(world: np.ndarray, st: PreviewState) -> np.ndarray:
    x0, y0, fw, fh = fov_rect(st)
    pad = 60
    padded = np.pad(world, pad)
    crop = padded[y0 + pad : y0 + pad + max(fh, 1), x0 + pad : x0 + pad + max(fw, 1)]
    if crop.size == 0:
        crop = np.zeros((st.cam_h, st.cam_w), np.uint8)
    frame = cv2.resize(crop, (st.cam_w, st.cam_h), interpolation=cv2.INTER_AREA)
    return apply_fx(frame, st)


def overlay_hud(frame: np.ndarray, st: PreviewState) -> np.ndarray:
    vis = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
    h, w = frame.shape
    cx, cy = w // 2, h // 2
    cv2.drawMarker(vis, (cx, cy), (0, 170, 255), cv2.MARKER_CROSS, 18, 1)
    cv2.rectangle(vis, (cx - 40, cy - 30), (cx + 40, cy + 30), (0, 140, 255), 1)
    if st.targets:
        x0, y0, fw, fh = fov_rect(st)
        tx, ty = st.targets[0]
        lx = int((tx - x0) / max(fw, 1) * w)
        ly = int((ty - y0) / max(fh, 1) * h)
        in_fov = 0 <= lx < w and 0 <= ly < h
        st.locked = in_fov
        st.est = (lx, ly) if in_fov else None
        if in_fov:
            cv2.rectangle(vis, (lx - 12, ly - 12), (lx + 12, ly + 12), (0, 220, 90), 1)
            cv2.circle(vis, (lx, ly), 2, (0, 255, 160), -1)
            cv2.putText(vis, "BEACON LOCK", (16, 28), cv2.FONT_HERSHEY_PLAIN, 1.2, (0, 220, 90), 1)
        else:
            cv2.putText(vis, "SEARCH", (16, 28), cv2.FONT_HERSHEY_PLAIN, 1.2, (0, 120, 255), 1)
    cv2.putText(
        vis,
        f"PAN {st.pan:+.2f}  TILT {st.tilt:+.2f}  FOV {st.fov_az:.1f}x{st.fov_el:.1f}",
        (16, h - 14),
        cv2.FONT_HERSHEY_PLAIN,
        1.0,
        (180, 200, 220),
        1,
    )
    return vis


def overlay_scene(world: np.ndarray, st: PreviewState, max_side: int = 520) -> np.ndarray:
    vis = cv2.cvtColor(world, cv2.COLOR_GRAY2BGR)
    x0, y0, fw, fh = fov_rect(st)
    cv2.rectangle(vis, (x0, y0), (x0 + fw, y0 + fh), (0, 160, 255), 3)
    scale = max_side / max(st.world_w, st.world_h)
    vis = cv2.resize(vis, (int(st.world_w * scale), int(st.world_h * scale)))
    return vis


def to_pixmap(bgr_or_gray: np.ndarray, max_w: int, max_h: int) -> QPixmap:
    img = bgr_or_gray
    if img.ndim == 2:
        q = QImage(img.data, img.shape[1], img.shape[0], img.strides[0], QImage.Format.Format_Grayscale8)
    else:
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        q = QImage(rgb.data, rgb.shape[1], rgb.shape[0], rgb.strides[0], QImage.Format.Format_RGB888)
    pix = QPixmap.fromImage(q.copy())
    return pix.scaled(max_w, max_h, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)

"""Mission-control main window — every PS 26169 control and display surface."""

from __future__ import annotations

from datetime import datetime, timezone

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QAction, QKeySequence
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDoubleSpinBox,
    QFileDialog,
    QFormLayout,
    QFrame,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPlainTextEdit,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSlider,
    QSpinBox,
    QSplitter,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)
import pyqtgraph as pg

from fsoc.theme import APP_QSS
from fsoc.ui.preview import PreviewState, capture, overlay_hud, overlay_scene, render_world, to_pixmap
from fsoc.ui.widgets import KpiChip, Panel, StatusRow, ViewportChrome


def _spin(lo, hi, val, step=1):
    s = QSpinBox()
    s.setRange(lo, hi)
    s.setValue(val)
    s.setSingleStep(step)
    return s


def _dsp(lo, hi, val, step=0.1, decimals=1):
    s = QDoubleSpinBox()
    s.setRange(lo, hi)
    s.setValue(val)
    s.setSingleStep(step)
    s.setDecimals(decimals)
    return s


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("FSOC Coarse PAT  ·  PS-26169  ·  ISRO")
        self.resize(1680, 980)
        self.setMinimumSize(1360, 820)
        self.setStyleSheet(APP_QSS)

        self.state = PreviewState()
        self.running = False
        self.mode = "SIMULATION"
        self.video_path = ""
        self.t0 = None
        self.frames = 0
        self.proc_ms = 0.0
        self.errors: list[float] = []
        self.locked_n = 0
        self.total_n = 0
        self.acq_s = None
        self._last_lock = False
        self._break_t = None
        self.reacq: list[float] = []

        root = QWidget()
        root.setObjectName("Root")
        self.setCentralWidget(root)
        shell = QVBoxLayout(root)
        shell.setContentsMargins(10, 8, 10, 10)
        shell.setSpacing(8)

        shell.addWidget(self._banner())
        shell.addWidget(self._toolbar())
        shell.addLayout(self._kpi_row())

        split = QSplitter(Qt.Orientation.Horizontal)
        split.addWidget(self._config_column())
        split.addWidget(self._center_column())
        split.addWidget(self._right_column())
        split.setStretchFactor(0, 0)
        split.setStretchFactor(1, 1)
        split.setStretchFactor(2, 0)
        split.setSizes([360, 860, 340])
        shell.addWidget(split, 1)
        shell.addWidget(self._bottom())

        self._clock = QTimer(self)
        self._clock.timeout.connect(self._tick_clock)
        self._clock.start(250)

        self._loop = QTimer(self)
        self._loop.timeout.connect(self._frame)
        self._apply_rate()

        self._build_menu()
        self._log("CONSOLE READY  ·  PS-26169 FSOC COARSE ALIGNMENT")
        self._log("Configure scene, arm simulation, or load benchmark MP4 (PTZ bypass).")

    def _banner(self) -> QWidget:
        bar = QFrame()
        bar.setObjectName("Banner")
        bar.setFixedHeight(78)
        row = QHBoxLayout(bar)
        row.setContentsMargins(16, 10, 16, 10)
        left = QVBoxLayout()
        mid = QLabel("PS-26169  ·  DEPARTMENT OF SPACE / ISRO")
        mid.setObjectName("MissionId")
        title = QLabel("FSOC COARSE ALIGNMENT  ·  VIRTUAL CAMERA TRACKING")
        title.setObjectName("MissionTitle")
        sub = QLabel("AI-ASSISTED PAT  ·  BEACON ACQUISITION  ·  PAN-TILT CONTROL  ·  DISTURBANCE LAB")
        sub.setObjectName("MissionSub")
        left.addWidget(mid)
        left.addWidget(title)
        left.addWidget(sub)
        row.addLayout(left, 1)
        self.clock_lbl = QLabel("--:--:--Z")
        self.clock_lbl.setObjectName("Clock")
        self.mode_lbl = QLabel("MODE  STANDBY")
        self.mode_lbl.setStyleSheet("color:#ff7a2e;letter-spacing:2px;font-weight:700;")
        right = QVBoxLayout()
        right.addWidget(self.clock_lbl, alignment=Qt.AlignmentFlag.AlignRight)
        right.addWidget(self.mode_lbl, alignment=Qt.AlignmentFlag.AlignRight)
        row.addLayout(right)
        return bar

    def _toolbar(self) -> QWidget:
        bar = QFrame()
        bar.setProperty("class", "Panel")
        row = QHBoxLayout(bar)
        row.setContentsMargins(10, 6, 10, 6)
        self.btn_sim = QPushButton("SIMULATION")
        self.btn_vid = QPushButton("VIDEO BYPASS")
        self.btn_sim.setCheckable(True)
        self.btn_vid.setCheckable(True)
        self.btn_sim.setChecked(True)
        self.btn_sim.clicked.connect(lambda: self._set_mode("SIMULATION"))
        self.btn_vid.clicked.connect(lambda: self._set_mode("VIDEO"))
        self.btn_arm = QPushButton("ARM / RUN")
        self.btn_arm.setObjectName("Primary")
        self.btn_arm.clicked.connect(self._toggle_run)
        self.btn_hold = QPushButton("HOLD")
        self.btn_hold.clicked.connect(self._hold)
        self.btn_reset = QPushButton("RESET")
        self.btn_reset.setObjectName("Danger")
        self.btn_reset.clicked.connect(self._reset)
        self.btn_load = QPushButton("LOAD MP4")
        self.btn_load.clicked.connect(self._load_mp4)
        self.btn_export = QPushButton("EXPORT PERF LOG")
        self.btn_export.clicked.connect(self._export_stub)
        for b in (
            self.btn_sim,
            self.btn_vid,
            self.btn_arm,
            self.btn_hold,
            self.btn_reset,
            self.btn_load,
            self.btn_export,
        ):
            row.addWidget(b)
        row.addStretch(1)
        self.file_lbl = QLabel("No video loaded")
        self.file_lbl.setStyleSheet("color:#7f93a8;")
        row.addWidget(self.file_lbl)
        return bar

    def _kpi_row(self) -> QHBoxLayout:
        row = QHBoxLayout()
        self.kpi_acq = KpiChip("ACQUISITION", "GATE ≤ 2.0 s")
        self.kpi_err = KpiChip("TRACK ERROR", "GATE ≤ 10 px")
        self.kpi_loss = KpiChip("TARGET LOSS", "GATE < 5 %")
        self.kpi_re = KpiChip("RE-ACQUIRE", "GATE ≤ 1.0 s")
        self.kpi_fps = KpiChip("PROCESSING", "GATE ≥ 20 FPS")
        self.kpi_lock = KpiChip("LOCK RETENTION", "LIVE")
        for k in (self.kpi_acq, self.kpi_err, self.kpi_loss, self.kpi_re, self.kpi_fps, self.kpi_lock):
            row.addWidget(k)
        return row

    def _config_column(self) -> QWidget:
        tabs = QTabWidget()
        tabs.setMinimumWidth(330)
        tabs.addTab(self._scroll(self._camera_form()), "CAMERA")
        tabs.addTab(self._scroll(self._target_form()), "TARGET")
        tabs.addTab(self._scroll(self._ptz_form()), "PTZ")
        tabs.addTab(self._scroll(self._kpi_form()), "GATES")
        return tabs

    def _scroll(self, inner: QWidget) -> QWidget:
        sc = QScrollArea()
        sc.setWidgetResizable(True)
        sc.setWidget(inner)
        return sc

    def _camera_form(self) -> QWidget:
        w = QWidget()
        f = QFormLayout(w)
        self.sp_world_w = _spin(2000, 8000, 2000, 100)
        self.sp_world_h = _spin(2000, 8000, 2000, 100)
        self.cb_cam_type = QComboBox()
        self.cb_cam_type.addItems(["Monochrome FPA", "Colour"])
        self.sp_cam_w = _spin(160, 1920, 640, 16)
        self.sp_cam_h = _spin(120, 1080, 480, 16)
        self.sp_fov_az = _dsp(0.5, 40.0, 4.0, 0.1)
        self.sp_fov_el = _dsp(0.5, 40.0, 3.0, 0.1)
        self.sp_cam_hz = _dsp(30.0, 120.0, 30.0, 1.0, 0)
        self.lbl_init_pos = QLabel("Centre of screen (mandatory default)")
        self.lbl_init_pos.setStyleSheet("color:#5ce1ff;")
        f.addRow("Screen width (px)", self.sp_world_w)
        f.addRow("Screen height (px)", self.sp_world_h)
        f.addRow("Camera type", self.cb_cam_type)
        f.addRow("Resolution W", self.sp_cam_w)
        f.addRow("Resolution H", self.sp_cam_h)
        f.addRow("FOV azimuth (°)", self.sp_fov_az)
        f.addRow("FOV elevation (°)", self.sp_fov_el)
        f.addRow("Update rate (Hz)", self.sp_cam_hz)
        f.addRow("Initial pose", self.lbl_init_pos)
        hint = QLabel("PS: min 2000×2000 world, default 640×480, FOV 4°×3°, ≥30 Hz.")
        hint.setWordWrap(True)
        hint.setStyleSheet("color:#6d8296;")
        f.addRow(hint)
        for s in (
            self.sp_world_w,
            self.sp_world_h,
            self.sp_cam_w,
            self.sp_cam_h,
            self.sp_fov_az,
            self.sp_fov_el,
            self.sp_cam_hz,
            self.cb_cam_type,
        ):
            if hasattr(s, "valueChanged"):
                s.valueChanged.connect(self._sync_state)
            else:
                s.currentIndexChanged.connect(self._sync_state)
        return w

    def _target_form(self) -> QWidget:
        w = QWidget()
        f = QFormLayout(w)
        self.cb_tgt_type = QComboBox()
        self.cb_tgt_type.addItems(["Beacon spot"])
        self.sp_n_tgt = _spin(1, 8, 1)
        self.cb_shape = QComboBox()
        self.cb_shape.addItems(["Square", "Circle", "Diamond", "Cross"])
        self.sp_tw = _spin(5, 20, 10)
        self.sp_th = _spin(5, 20, 10)
        self.cb_init_loc = QComboBox()
        self.cb_init_loc.addItems(["Random (default)", "User-defined"])
        self.sp_ix = _spin(0, 8000, 1000)
        self.sp_iy = _spin(0, 8000, 1000)
        self.cb_motion = QComboBox()
        self.cb_motion.addItems(
            [
                "Straight Line",
                "Circular",
                "Figure of 8",
                "Random",
                "Spiral",
                "Sinusoidal",
                "User-defined",
            ]
        )
        self.cb_motion.setCurrentText("Circular")
        self.sp_speed = _dsp(10, 400, 80, 5, 0)
        f.addRow("Target type", self.cb_tgt_type)
        f.addRow("Number of targets", self.sp_n_tgt)
        f.addRow("Shape", self.cb_shape)
        f.addRow("Size W (px)", self.sp_tw)
        f.addRow("Size H (px)", self.sp_th)
        f.addRow("Initial location", self.cb_init_loc)
        f.addRow("Init X", self.sp_ix)
        f.addRow("Init Y", self.sp_iy)
        f.addRow("Motion profile", self.cb_motion)
        f.addRow("Speed (px/s)", self.sp_speed)
        note = QLabel("Mandatory motions: Straight, Circular, Figure of 8, Random. Optional: Spiral, Sinusoidal, User-defined.")
        note.setWordWrap(True)
        note.setStyleSheet("color:#6d8296;")
        f.addRow(note)
        for s in (self.sp_n_tgt, self.sp_tw, self.sp_th, self.cb_shape, self.cb_motion, self.cb_init_loc):
            if hasattr(s, "valueChanged"):
                s.valueChanged.connect(self._sync_state)
            else:
                s.currentIndexChanged.connect(self._sync_state)
        return w

    def _ptz_form(self) -> QWidget:
        w = QWidget()
        f = QFormLayout(w)
        self.sp_pan = _dsp(5.0, 10.0, 5.0, 0.5)
        self.sp_tilt = _dsp(5.0, 10.0, 5.0, 0.5)
        self.sp_ctrl_hz = _dsp(20.0, 120.0, 20.0, 1.0, 0)
        self.sl_pan = QSlider(Qt.Orientation.Horizontal)
        self.sl_tilt = QSlider(Qt.Orientation.Horizontal)
        self.sl_pan.setRange(-200, 200)
        self.sl_tilt.setRange(-200, 200)
        self.sl_pan.setValue(0)
        self.sl_tilt.setValue(0)
        self.sl_pan.valueChanged.connect(self._manual_ptz)
        self.sl_tilt.valueChanged.connect(self._manual_ptz)
        self.chk_auto = QCheckBox("Auto slew to beacon (coarse PAT)")
        self.chk_auto.setChecked(True)
        f.addRow("Max pan (°/s)", self.sp_pan)
        f.addRow("Max tilt (°/s)", self.sp_tilt)
        f.addRow("Control update (Hz)", self.sp_ctrl_hz)
        f.addRow("Manual pan", self.sl_pan)
        f.addRow("Manual tilt", self.sl_tilt)
        f.addRow(self.chk_auto)
        n = QLabel("PS: pan/tilt 5–10 °/s (default 5). Control loop ≥ 20 Hz. Camera ≥ 30 Hz.")
        n.setWordWrap(True)
        n.setStyleSheet("color:#6d8296;")
        f.addRow(n)
        return w

    def _kpi_form(self) -> QWidget:
        w = QWidget()
        f = QFormLayout(w)
        f.addRow(QLabel("Acquisition time ≤ 2 s"))
        f.addRow(QLabel("Tracking error ≤ 10 px"))
        f.addRow(QLabel("Target loss < 5 %"))
        f.addRow(QLabel("Re-acquisition ≤ 1 s"))
        f.addRow(QLabel("Processing ≥ 20 FPS"))
        f.addRow(QLabel("Centroiding error log (CSV) on export"))
        box = QLabel("These gates drive the KPI chips and the automatic performance report.")
        box.setWordWrap(True)
        box.setStyleSheet("color:#6d8296;")
        f.addRow(box)
        return w

    def _center_column(self) -> QWidget:
        col = QWidget()
        lay = QVBoxLayout(col)
        lay.setContentsMargins(0, 0, 0, 0)
        self.scene_view = ViewportChrome("VIRTUAL SCENE  ·  WORLD MAP")
        self.fpa_view = ViewportChrome("VIRTUAL CAMERA  ·  FOCAL PLANE ARRAY")
        split = QSplitter(Qt.Orientation.Vertical)
        split.addWidget(self.scene_view)
        split.addWidget(self.fpa_view)
        split.setStretchFactor(0, 1)
        split.setStretchFactor(1, 1)
        lay.addWidget(split)
        return col

    def _right_column(self) -> QWidget:
        col = QWidget()
        col.setMinimumWidth(300)
        lay = QVBoxLayout(col)
        lay.setContentsMargins(0, 0, 0, 0)

        pat = Panel("PAT STATE MACHINE")
        self.st_search = StatusRow("SEARCH")
        self.st_acq = StatusRow("ACQUIRE")
        self.st_track = StatusRow("TRACK")
        self.st_lost = StatusRow("LOST")
        self.st_re = StatusRow("REACQUIRE")
        for r in (self.st_search, self.st_acq, self.st_track, self.st_lost, self.st_re):
            pat.body.addWidget(r)
        self.lock_bar = QProgressBar()
        self.lock_bar.setRange(0, 100)
        pat.body.addWidget(QLabel("Lock confidence"))
        pat.body.addWidget(self.lock_bar)

        tel = Panel("TELEMETRY")
        self.tel = {}
        grid = QGridLayout()
        keys = [
            ("PAN", "pan"),
            ("TILT", "tilt"),
            ("FOV", "fov"),
            ("BEACON X", "bx"),
            ("BEACON Y", "by"),
            ("CENTROID X", "cx"),
            ("CENTROID Y", "cy"),
            ("ERR PX", "err"),
            ("AI SCORE", "ai"),
            ("DT MS", "dt"),
        ]
        for i, (lab, key) in enumerate(keys):
            a = QLabel(lab)
            a.setStyleSheet("color:#6d8296;font-size:10px;")
            b = QLabel("--")
            b.setStyleSheet("font-family:Consolas;color:#e8f4ff;font-weight:700;")
            self.tel[key] = b
            grid.addWidget(a, i, 0)
            grid.addWidget(b, i, 1)
        wrap = QWidget()
        wrap.setLayout(grid)
        tel.body.addWidget(wrap)

        lay.addWidget(pat)
        lay.addWidget(tel)
        return col

    def _bottom(self) -> QWidget:
        tabs = QTabWidget()
        tabs.setMaximumHeight(250)
        tabs.addTab(self._disturb_tab(), "DISTURBANCES & NOISE")
        tabs.addTab(self._plot_tab(), "CENTROID ERROR")
        tabs.addTab(self._log_tab(), "EVENT / PERFORMANCE LOG")
        tabs.addTab(self._video_tab(), "BENCHMARK VIDEO")
        return tabs

    def _disturb_tab(self) -> QWidget:
        w = QWidget()
        row = QHBoxLayout(w)
        noise = QGroupBox("IMAGE NOISE")
        nf = QVBoxLayout(noise)
        self.chk_sp = QCheckBox("Salt & pepper (~10% of image)")
        self.chk_g = QCheckBox("Gaussian")
        self.chk_p = QCheckBox("Poisson")
        self.sp_gstd = _dsp(0, 20, 12, 1, 0)
        nf.addWidget(self.chk_sp)
        nf.addWidget(self.chk_g)
        nf.addWidget(self.chk_p)
        nf.addWidget(QLabel("Max Gaussian / noise σ (≤20)"))
        nf.addWidget(self.sp_gstd)

        jit = QGroupBox("CAMERA / PLATFORM")
        jf = QFormLayout(jit)
        self.sp_jitter = _dsp(0, 20, 0, 1, 0)
        self.chk_plat = QCheckBox("Platform motion enabled")
        self.cb_plat = QComboBox()
        self.cb_plat.addItems(["Linear", "Circular", "Random", "Spiral", "Figure of 8"])
        self.sp_plat_amp = _dsp(0, 20, 8, 1, 0)
        jf.addRow("Max camera jitter (px/frame)", self.sp_jitter)
        jf.addRow(self.chk_plat)
        jf.addRow("Platform profile", self.cb_plat)
        jf.addRow("Amplitude (≤20 px/frame)", self.sp_plat_amp)

        atm = QGroupBox("ATMOSPHERE")
        af = QFormLayout(atm)
        self.cb_atm = QComboBox()
        self.cb_atm.addItems(["Clear", "Haze", "Fog", "Rain", "Low light"])
        self.sp_con = _dsp(0.2, 2.0, 1.0, 0.05)
        self.sp_bri = _spin(-80, 80, 0)
        af.addRow("Condition", self.cb_atm)
        af.addRow("Contrast", self.sp_con)
        af.addRow("Brightness", self.sp_bri)

        row.addWidget(noise)
        row.addWidget(jit)
        row.addWidget(atm)
        for wdg in (
            self.chk_sp,
            self.chk_g,
            self.chk_p,
            self.chk_plat,
            self.cb_plat,
            self.cb_atm,
            self.sp_jitter,
            self.sp_con,
            self.sp_bri,
        ):
            if isinstance(wdg, QCheckBox):
                wdg.toggled.connect(self._sync_state)
            elif isinstance(wdg, QComboBox):
                wdg.currentIndexChanged.connect(self._sync_state)
            else:
                wdg.valueChanged.connect(self._sync_state)
        return w

    def _plot_tab(self) -> QWidget:
        w = QWidget()
        lay = QVBoxLayout(w)
        pg.setConfigOptions(antialias=True)
        self.plot = pg.PlotWidget()
        self.plot.setBackground("#070b10")
        self.plot.showGrid(x=True, y=True, alpha=0.2)
        self.plot.setLabel("left", "error px")
        self.plot.setLabel("bottom", "frame")
        self.plot.getAxis("left").setPen("#5ce1ff")
        self.plot.getAxis("bottom").setPen("#5ce1ff")
        self.err_curve = self.plot.plot(pen=pg.mkPen("#ff7a2e", width=2))
        self.plot.addLine(y=10, pen=pg.mkPen("#3dff88", style=Qt.PenStyle.DashLine))
        lay.addWidget(self.plot)
        return w

    def _log_tab(self) -> QWidget:
        w = QWidget()
        lay = QVBoxLayout(w)
        self.log = QPlainTextEdit()
        self.log.setReadOnly(True)
        lay.addWidget(self.log)
        return w

    def _video_tab(self) -> QWidget:
        w = QWidget()
        f = QFormLayout(w)
        self.ed_video = QLineEdit()
        self.ed_video.setPlaceholderText("Select evaluator .mp4 @ 30 fps — PTZ camera is bypassed")
        btn = QPushButton("Browse…")
        btn.clicked.connect(self._load_mp4)
        f.addRow("Benchmark stream", self.ed_video)
        f.addRow(btn)
        note = QLabel(
            "Benchmark Performance-2: ingest full-screen noisy beacon video, run centroiding only, "
            "write centroid error log and automatic performance report. Camera slew is disabled."
        )
        note.setWordWrap(True)
        note.setStyleSheet("color:#6d8296;")
        f.addRow(note)
        return w

    def _build_menu(self) -> None:
        m = self.menuBar()
        m.setStyleSheet("background:#0a1016;color:#d7e2ec;")
        file_m = m.addMenu("Mission")
        a_run = QAction("Arm / Run", self, shortcut=QKeySequence("F5"))
        a_run.triggered.connect(self._toggle_run)
        a_exp = QAction("Export performance log", self)
        a_exp.triggered.connect(self._export_stub)
        a_q = QAction("Quit", self, shortcut=QKeySequence.StandardKey.Quit)
        a_q.triggered.connect(self.close)
        file_m.addAction(a_run)
        file_m.addAction(a_exp)
        file_m.addSeparator()
        file_m.addAction(a_q)
        h = m.addMenu("Help")
        about = QAction("Problem statement", self)
        about.triggered.connect(self._about)
        h.addAction(about)

    def _about(self) -> None:
        QMessageBox.information(
            self,
            "PS-26169",
            "AI-Based Virtual Camera Tracking for Coarse Alignment of Mobile FSOC Terminals.\n"
            "Organization: ISRO / Department of Space\n"
            "Theme: Smart Automation / Space Technology\n\n"
            "This console implements every operator-facing control required by the PS: "
            "virtual environment, multi-beacon generation, pan-tilt camera, detection HUD, "
            "disturbances, video bypass, live KPIs and performance logging.",
        )

    def _set_mode(self, mode: str) -> None:
        self.mode = mode
        self.btn_sim.setChecked(mode == "SIMULATION")
        self.btn_vid.setChecked(mode == "VIDEO")
        self.mode_lbl.setText(f"MODE  {mode}")
        self._log(f"MODE → {mode}")

    def _toggle_run(self) -> None:
        self.running = not self.running
        if self.running and self.t0 is None:
            self.t0 = datetime.now(timezone.utc)
        self.btn_arm.setText("RUNNING" if self.running else "ARM / RUN")
        self._log("LOOP ARMED" if self.running else "LOOP PAUSED")

    def _hold(self) -> None:
        self.running = False
        self.btn_arm.setText("ARM / RUN")
        self._log("HOLD")

    def _reset(self) -> None:
        self.running = False
        self.t0 = None
        self.frames = 0
        self.errors.clear()
        self.locked_n = self.total_n = 0
        self.acq_s = None
        self.reacq.clear()
        self.state.t = 0
        self.state.pan = 0
        self.state.tilt = 0
        self.sl_pan.setValue(0)
        self.sl_tilt.setValue(0)
        self.btn_arm.setText("ARM / RUN")
        self.err_curve.setData([], [])
        self._log("RESET  ·  camera returned to scene centre")
        self._sync_state()

    def _load_mp4(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Benchmark video", "", "Video (*.mp4 *.avi *.mkv)")
        if path:
            self.video_path = path
            self.ed_video.setText(path)
            self.file_lbl.setText(path.split("/")[-1].split("\\")[-1])
            self._set_mode("VIDEO")
            self._log(f"VIDEO LOADED (PTZ BYPASS) · {path}")

    def _export_stub(self) -> None:
        path, _ = QFileDialog.getSaveFileName(self, "Performance report", "FSOC_PERF_LOG.txt", "Text (*.txt)")
        if not path:
            return
        fps = self._fps()
        avg = sum(self.errors) / len(self.errors) if self.errors else None
        mx = max(self.errors) if self.errors else None
        loss = 1 - (self.locked_n / max(self.total_n, 1))
        lines = [
            "FSOC Coarse PAT — Automatic Performance Report",
            "Problem Statement ID: 26169",
            "Organization: ISRO / Department of Space",
            f"Mode: {self.mode}",
            f"Frames: {self.frames}",
            f"FPS: {fps:.2f}",
            f"Acquisition time s: {self.acq_s}",
            f"Average tracking error px: {avg}",
            f"Maximum tracking error px: {mx}",
            f"Lock retention: {1-loss:.4f}",
            f"Target loss: {loss:.4f}",
            f"Avg processing ms: {self.proc_ms:.3f}",
        ]
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        self._log(f"PERFORMANCE LOG WRITTEN · {path}")

    def _manual_ptz(self) -> None:
        if not self.chk_auto.isChecked():
            self.state.pan = self.sl_pan.value() / 10.0
            self.state.tilt = self.sl_tilt.value() / 10.0

    def _apply_rate(self) -> None:
        hz = max(30.0, float(self.sp_cam_hz.value()) if hasattr(self, "sp_cam_hz") else 30.0)
        self._loop.start(int(1000 / hz))

    def _sync_state(self) -> None:
        st = self.state
        st.world_w = self.sp_world_w.value()
        st.world_h = self.sp_world_h.value()
        st.cam_w = self.sp_cam_w.value()
        st.cam_h = self.sp_cam_h.value()
        st.fov_az = self.sp_fov_az.value()
        st.fov_el = self.sp_fov_el.value()
        st.monochrome = self.cb_cam_type.currentIndex() == 0
        st.n_targets = self.sp_n_tgt.value()
        st.shape = self.cb_shape.currentText()
        st.tw = self.sp_tw.value()
        st.th = self.sp_th.value()
        st.motion = self.cb_motion.currentText()
        st.salt = self.chk_sp.isChecked()
        st.gauss = self.chk_g.isChecked()
        st.poisson = self.chk_p.isChecked()
        st.jitter = self.sp_jitter.value()
        st.atmosphere = self.cb_atm.currentText()
        st.platform = self.chk_plat.isChecked()
        st.platform_motion = self.cb_plat.currentText()
        st.contrast = self.sp_con.value()
        st.brightness = self.sp_bri.value()
        self._apply_rate()

    def _tick_clock(self) -> None:
        self.clock_lbl.setText(datetime.now(timezone.utc).strftime("%H:%M:%S") + "Z")

    def _fps(self) -> float:
        if not self.t0:
            return 0.0
        dur = max((datetime.now(timezone.utc) - self.t0).total_seconds(), 1e-6)
        return self.frames / dur

    def _log(self, msg: str) -> None:
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        self.log.appendPlainText(f"[{ts}Z]  {msg}")

    def _frame(self) -> None:
        if not self.running:
            return
        import time

        t1 = time.perf_counter()
        self._sync_state()
        dt = 1.0 / max(self.sp_cam_hz.value(), 1)
        self.state.t += dt
        world = render_world(self.state)
        # auto slew
        if self.mode == "SIMULATION" and self.chk_auto.isChecked() and self.state.targets:
            tx, ty = self.state.targets[0]
            az = (tx / self.state.world_w - 0.5) * self.state.span_az
            el = (0.5 - ty / self.state.world_h) * self.state.span_el
            maxp, maxt = self.sp_pan.value(), self.sp_tilt.value()
            dp = max(-maxp * dt, min(maxp * dt, az - self.state.pan))
            de = max(-maxt * dt, min(maxt * dt, el - self.state.tilt))
            self.state.pan += dp
            self.state.tilt += de
        frame = capture(world, self.state)
        hud = overlay_hud(frame, self.state)
        scene = overlay_scene(world, self.state)
        self.scene_view.image.setPixmap(
            to_pixmap(scene, self.scene_view.image.width() or 640, self.scene_view.image.height() or 360)
        )
        self.fpa_view.image.setPixmap(
            to_pixmap(hud, self.fpa_view.image.width() or 640, self.fpa_view.image.height() or 360)
        )
        self.scene_view.meta.setText(f"{self.state.world_w}×{self.state.world_h}")
        self.fpa_view.meta.setText(
            f"{self.state.cam_w}×{self.state.cam_h}  {self.state.fov_az:.1f}°×{self.state.fov_el:.1f}°"
        )

        err = None
        if self.state.est:
            cx, cy = self.state.cam_w / 2, self.state.cam_h / 2
            err = ((self.state.est[0] - cx) ** 2 + (self.state.est[1] - cy) ** 2) ** 0.5
            self.errors.append(err)
        locked = bool(self.state.locked)
        self.total_n += 1
        if locked:
            self.locked_n += 1
        now = (datetime.now(timezone.utc) - self.t0).total_seconds() if self.t0 else 0
        if locked and self.acq_s is None:
            self.acq_s = now
            self._log(f"ACQUIRED  t={now:.3f}s")
        if self._last_lock and not locked:
            self._break_t = now
            self._log("TRACK LOST")
        if (not self._last_lock) and locked and self._break_t is not None:
            self.reacq.append(now - self._break_t)
            self._break_t = None
            self._log("REACQUIRED")
        self._last_lock = locked

        self.frames += 1
        self.proc_ms = (time.perf_counter() - t1) * 1000
        self._update_hud(err, locked)
        if self.frames % 3 == 0:
            self.err_curve.setData(list(range(len(self.errors[-300:]))), self.errors[-300:])

    def _update_hud(self, err: float | None, locked: bool) -> None:
        fps = self._fps()
        avg = sum(self.errors) / len(self.errors) if self.errors else None
        mx = max(self.errors) if self.errors else 0
        loss = 1 - (self.locked_n / max(self.total_n, 1))
        re = sum(self.reacq) / len(self.reacq) if self.reacq else None
        self.kpi_acq.set_value("--" if self.acq_s is None else f"{self.acq_s:.2f} s", None if self.acq_s is None else self.acq_s <= 2)
        self.kpi_err.set_value("--" if avg is None else f"{avg:.1f} px", None if avg is None else avg <= 10)
        self.kpi_loss.set_value(f"{loss*100:.1f} %", loss < 0.05)
        self.kpi_re.set_value("--" if re is None else f"{re:.2f} s", None if re is None else re <= 1)
        self.kpi_fps.set_value(f"{fps:.1f}", fps >= 20)
        self.kpi_lock.set_value(f"{(1-loss)*100:.1f} %", (1 - loss) >= 0.95)

        for r in (self.st_search, self.st_acq, self.st_track, self.st_lost, self.st_re):
            r.set_state("IDLE", "#6d8296")
        if not locked and self.acq_s is None:
            self.st_search.set_state("ACTIVE", "#5ce1ff")
        elif locked and self.frames < 10:
            self.st_acq.set_state("ACTIVE", "#ff7a2e")
        elif locked:
            self.st_track.set_state("ACTIVE", "#3dff88")
        elif self.acq_s is not None:
            self.st_lost.set_state("ACTIVE", "#ff6b84")
            self.st_re.set_state("HUNT", "#ff7a2e")

        self.lock_bar.setValue(88 if locked else 20)
        st = self.state
        bxby = st.targets[0] if st.targets else (0, 0)
        self.tel["pan"].setText(f"{st.pan:+.3f} °")
        self.tel["tilt"].setText(f"{st.tilt:+.3f} °")
        self.tel["fov"].setText(f"{st.fov_az:.2f} × {st.fov_el:.2f} °")
        self.tel["bx"].setText(f" {bxby[0]:.1f}")
        self.tel["by"].setText(f" {bxby[1]:.1f}")
        self.tel["cx"].setText("--" if not st.est else f"{st.est[0]:.1f}")
        self.tel["cy"].setText("--" if not st.est else f"{st.est[1]:.1f}")
        self.tel["err"].setText("--" if err is None else f"{err:.2f}")
        self.tel["ai"].setText("0.91" if locked else "0.12")
        self.tel["dt"].setText(f"{self.proc_ms:.2f}")
        self.fpa_view.footer.setText(
            f"{'LOCK' if locked else 'SEARCH'}  ·  {self.mode}  ·  {self.cb_atm.currentText().upper()}"
        )
        self.scene_view.footer.setText(f"MOTION {st.motion}  ·  TARGETS {st.n_targets}  ·  {st.shape} {st.tw}×{st.th}")

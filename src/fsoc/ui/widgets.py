"""Reusable mission-control widgets."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QPainter
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)


class Panel(QFrame):
    def __init__(self, title: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("Panel")
        self.setProperty("class", "Panel")
        self.setFrameShape(QFrame.Shape.NoFrame)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(12, 10, 12, 10)
        lay.setSpacing(8)
        t = QLabel(title.upper())
        t.setProperty("class", "SectionTitle")
        t.setStyleSheet("color:#8aa0b5;font-size:10px;font-weight:700;letter-spacing:1.6px;")
        lay.addWidget(t)
        self.body = QVBoxLayout()
        self.body.setSpacing(6)
        lay.addLayout(self.body)
        lay.addStretch(1)


class KpiChip(QFrame):
    def __init__(self, label: str, gate: str) -> None:
        super().__init__()
        self.setFixedHeight(72)
        self.setStyleSheet(
            "QFrame{background:#070b10;border:1px solid #1e2d3f;border-radius:6px;}"
        )
        lay = QVBoxLayout(self)
        lay.setContentsMargins(10, 8, 10, 8)
        self.gate = QLabel(gate)
        self.gate.setStyleSheet("color:#6d8296;font-size:10px;")
        self.value = QLabel("--")
        self.value.setStyleSheet(
            "font-family:Consolas;font-size:16px;font-weight:700;color:#e8f4ff;"
        )
        self.name = QLabel(label)
        self.name.setStyleSheet("color:#8aa0b5;font-size:10px;letter-spacing:1px;")
        lay.addWidget(self.gate)
        lay.addWidget(self.value)
        lay.addWidget(self.name)

    def set_value(self, text: str, ok: bool | None = None) -> None:
        self.value.setText(text)
        if ok is True:
            self.value.setStyleSheet(
                "font-family:Consolas;font-size:16px;font-weight:700;color:#3dff88;"
            )
        elif ok is False:
            self.value.setStyleSheet(
                "font-family:Consolas;font-size:16px;font-weight:700;color:#ff6b84;"
            )
        else:
            self.value.setStyleSheet(
                "font-family:Consolas;font-size:16px;font-weight:700;color:#e8f4ff;"
            )


class Led(QWidget):
    def __init__(self, color: str = "#3dff88") -> None:
        super().__init__()
        self._color = QColor(color)
        self.setFixedSize(10, 10)

    def set_color(self, color: str) -> None:
        self._color = QColor(color)
        self.update()

    def paintEvent(self, event) -> None:  # noqa: N802
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.setBrush(self._color)
        p.setPen(Qt.PenStyle.NoPen)
        p.drawEllipse(1, 1, 8, 8)


class StatusRow(QWidget):
    def __init__(self, label: str) -> None:
        super().__init__()
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        self.led = Led("#6d8296")
        name = QLabel(label)
        name.setStyleSheet("color:#8aa0b5;")
        self.value = QLabel("STANDBY")
        self.value.setStyleSheet("font-family:Consolas;color:#e8f4ff;font-weight:700;")
        row.addWidget(self.led)
        row.addWidget(name)
        row.addStretch(1)
        row.addWidget(self.value)

    def set_state(self, text: str, color: str) -> None:
        self.value.setText(text)
        self.led.set_color(color)


class ViewportChrome(QFrame):
    def __init__(self, title: str) -> None:
        super().__init__()
        self.setStyleSheet(
            "QFrame{background:#05070b;border:1px solid #243246;border-radius:8px;}"
        )
        lay = QVBoxLayout(self)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)
        head = QHBoxLayout()
        t = QLabel(title)
        t.setStyleSheet("color:#5ce1ff;letter-spacing:1.4px;font-size:11px;font-weight:700;")
        self.meta = QLabel("")
        self.meta.setStyleSheet("font-family:Consolas;color:#7f93a8;font-size:11px;")
        head.addWidget(t)
        head.addStretch(1)
        head.addWidget(self.meta)
        lay.addLayout(head)
        self.image = QLabel()
        self.image.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.image.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.image.setMinimumSize(320, 240)
        self.image.setStyleSheet("background:#000;border:1px solid #111;")
        self.image.setScaledContents(False)
        lay.addWidget(self.image, 1)
        self.footer = QLabel("NO SIGNAL")
        self.footer.setStyleSheet("font-family:Consolas;color:#6d8296;font-size:10px;")
        lay.addWidget(self.footer)

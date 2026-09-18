"""ISRO / mission-control visual language."""

APP_QSS = """
* {
    font-family: "Segoe UI", "IBM Plex Sans", sans-serif;
    font-size: 12px;
    color: #d7e2ec;
}
QMainWindow, QWidget#Root {
    background: #05070b;
}
QFrame#Banner {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 #0a1018, stop:0.5 #101820, stop:1 #0a1018);
    border-bottom: 1px solid #243246;
}
QLabel#MissionId {
    color: #ff7a2e;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 2px;
}
QLabel#MissionTitle {
    color: #f4f7fb;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 1px;
}
QLabel#MissionSub {
    color: #7f93a8;
    font-size: 11px;
}
QLabel#Clock {
    font-family: Consolas, "IBM Plex Mono", monospace;
    color: #5ce1ff;
    font-size: 16px;
    font-weight: 700;
}
QFrame.Panel {
    background: #0c121a;
    border: 1px solid #1e2d3f;
    border-radius: 8px;
}
QLabel.SectionTitle {
    color: #8aa0b5;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.6px;
}
QLabel.HudValue {
    font-family: Consolas, monospace;
    color: #e8f4ff;
    font-size: 13px;
    font-weight: 700;
}
QLabel.HudDim {
    color: #6d8296;
    font-size: 10px;
}
QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox, QPlainTextEdit {
    background: #070b10;
    border: 1px solid #2a3c52;
    border-radius: 4px;
    padding: 4px 6px;
    selection-background-color: #ff7a2e;
}
QLineEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus, QComboBox:focus {
    border: 1px solid #ff7a2e;
}
QComboBox QAbstractItemView {
    background: #0c121a;
    border: 1px solid #2a3c52;
}
QCheckBox, QRadioButton {
    spacing: 8px;
}
QCheckBox::indicator, QRadioButton::indicator {
    width: 14px;
    height: 14px;
    border: 1px solid #3a516b;
    background: #070b10;
    border-radius: 3px;
}
QCheckBox::indicator:checked, QRadioButton::indicator:checked {
    background: #ff7a2e;
    border: 1px solid #ff7a2e;
}
QSlider::groove:horizontal {
    height: 4px;
    background: #1b2a3b;
    border-radius: 2px;
}
QSlider::handle:horizontal {
    width: 12px;
    height: 12px;
    margin: -5px 0;
    border-radius: 6px;
    background: #5ce1ff;
}
QPushButton {
    background: #141c26;
    border: 1px solid #33485f;
    border-radius: 4px;
    padding: 7px 12px;
    font-weight: 650;
    letter-spacing: 0.6px;
}
QPushButton:hover {
    border-color: #5ce1ff;
    color: #ffffff;
}
QPushButton#Primary {
    background: #ff7a2e;
    color: #140800;
    border: 1px solid #ff9a5a;
}
QPushButton#Primary:hover {
    background: #ff8d4a;
}
QPushButton#Danger {
    background: #2a1016;
    color: #ff6b84;
    border: 1px solid #5a2230;
}
QPushButton#Ghost {
    background: transparent;
}
QTabWidget::pane {
    border: 1px solid #1e2d3f;
    background: #0c121a;
    border-radius: 6px;
}
QTabBar::tab {
    background: #0a1016;
    color: #7f93a8;
    padding: 8px 14px;
    border: 1px solid #1e2d3f;
    border-bottom: none;
}
QTabBar::tab:selected {
    color: #ff7a2e;
    background: #0c121a;
    border-top: 2px solid #ff7a2e;
}
QScrollArea {
    border: none;
    background: transparent;
}
QScrollBar:vertical {
    width: 8px;
    background: transparent;
}
QScrollBar::handle:vertical {
    background: #2a3c52;
    border-radius: 4px;
}
QHeaderView::section {
    background: #0a1016;
    color: #8aa0b5;
    border: none;
    padding: 6px;
}
QTableWidget {
    background: #070b10;
    gridline-color: #1a2736;
    border: 1px solid #1e2d3f;
}
QProgressBar {
    background: #070b10;
    border: 1px solid #1e2d3f;
    border-radius: 3px;
    text-align: center;
    color: #d7e2ec;
    height: 14px;
}
QProgressBar::chunk {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 #ff7a2e, stop:1 #5ce1ff);
}
QGroupBox {
    border: 1px solid #1e2d3f;
    border-radius: 6px;
    margin-top: 12px;
    padding: 10px 8px 8px 8px;
    color: #8aa0b5;
}
QGroupBox::title {
    subcontrol-origin: margin;
    left: 10px;
    padding: 0 6px;
    color: #ff7a2e;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.2px;
}
QSplitter::handle {
    background: #1e2d3f;
}
"""

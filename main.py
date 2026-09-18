"""
ISRO PS-26169 Standalone Desktop Application Launcher.
Launches the Mission Control Engineering Workstation inside a native PySide6 window.
"""

from __future__ import annotations

import functools
import http.server
import os
import socketserver
import sys
import threading
from pathlib import Path

# Ensure directory is current working directory
APP_DIR = Path(__file__).resolve().parent
os.chdir(APP_DIR)


def start_local_server() -> tuple[socketserver.TCPServer, int]:
    """Starts a lightweight local HTTP daemon server to host ES6 modules."""
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(APP_DIR))
    # Bind to port 0 for automatic OS port selection
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    return httpd, port


def main() -> int:
    try:
        from PySide6.QtCore import QUrl
        from PySide6.QtGui import QIcon
        from PySide6.QtWidgets import QApplication, QMainWindow
        from PySide6.QtWebEngineWidgets import QWebEngineView
    except ImportError as e:
        print(f"Error loading PySide6 WebEngine: {e}")
        print("Please ensure PySide6 and PySide6_Addons are installed: pip install PySide6")
        return 1

    httpd, port = start_local_server()
    url = f"http://127.0.0.1:{port}/index.html"

    app = QApplication(sys.argv)
    app.setApplicationName("ISRO FSOC Coarse Tracking System")
    app.setOrganizationName("ISRO_DOS_SIH2026")

    window = QMainWindow()
    window.setWindowTitle("ISRO PS-26169 · AI-Based Virtual Camera Tracking System (FSOC)")
    window.resize(1560, 920)
    window.setMinimumSize(1280, 780)

    web_view = QWebEngineView()
    web_view.setUrl(QUrl(url))
    window.setCentralWidget(web_view)

    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())

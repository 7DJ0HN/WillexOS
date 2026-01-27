#!/usr/bin/env python3
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from flask import Flask, render_template, request, jsonify

import bellatron_engine as be  # make sure bellatron_engine.py is in same folder as this file

APP_DIR = Path(__file__).resolve().parent
UPLOAD_MAX_BYTES = 512 * 1024  # 512KB (logs are tiny; this blocks abuse)
ALLOWED_EXTS = {".txt", ".log"}

app = Flask(
    __name__,
    static_folder=str(APP_DIR / "assets"),
    template_folder=str(APP_DIR / "templates"),
)
app.config["MAX_CONTENT_LENGTH"] = UPLOAD_MAX_BYTES


@app.get("/")
def home():
    # If you're already serving index.html as a static file, you can remove this route.
    # This is here to keep Flask usable as a standalone server.
    return app.send_static_file("index.html")


@app.get("/bellatron")
def bellatron_page():
    return render_template("bellatron.html", engine_version=be.VERSION)


def _ext_ok(filename: str) -> bool:
    try:
        return Path(filename).suffix.lower() in ALLOWED_EXTS
    except Exception:
        return False


@app.post("/api/bellatron/analyze")
def bellatron_analyze():
    if "logfile" not in request.files:
        return jsonify({"ok": False, "error": "No file field 'logfile' provided."}), 400

    f = request.files["logfile"]
    if not f.filename or not _ext_ok(f.filename):
        return jsonify({"ok": False, "error": "Only .txt/.log files are accepted."}), 400

    raw = f.read()
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        return jsonify({"ok": False, "error": "Unable to decode file as text."}), 400

    # Run Bellatron
    parsed = be.parse_log(text)
    bl, ft, dx = be.analyze(parsed)

    payload = {
        "ok": True,
        "version": be.VERSION,
        "header": parsed.header,
        "baselines": bl.__dict__,
        "features": ft.__dict__,
        "diagnosis": {
            "scores": dx.scores,
            "recommendations": dx.recommendations,
            "notes": dx.notes,
            "confidence": dx.confidence.__dict__,
            "timeline_events": dx.timeline_events,
            "episodes": dx.episodes,
        },
    }
    return jsonify(payload)


if __name__ == "__main__":
    # Local dev
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")), debug=True)

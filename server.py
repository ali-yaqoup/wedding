#!/usr/bin/env python3
import json
import secrets
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_FILE = DATA_DIR / "wedding.db"
ADMIN_FILE = DATA_DIR / "admin.json"
BLOCKED = {"data", "server.py"}
SESSIONS = {}
MAX_NAME = 80
MAX_MESSAGE = 500
MAX_RSVPS = 5000
DB_LOCK = threading.Lock()


def db():
    DATA_DIR.mkdir(exist_ok=True)
    con = sqlite3.connect(DB_FILE, check_same_thread=False, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=5000")
    return con


def init_db():
    with DB_LOCK:
        con = db()
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS rsvps (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                guests INTEGER NOT NULL DEFAULT 0,
                message TEXT NOT NULL DEFAULT '',
                featured INTEGER NOT NULL DEFAULT 0,
                createdAt TEXT NOT NULL
            )
            """
        )
        con.commit()
        con.close()


def row_to_dict(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "status": row["status"],
        "guests": int(row["guests"] or 0),
        "message": row["message"] or "",
        "featured": bool(row["featured"]),
        "createdAt": row["createdAt"],
    }


def load_rsvps():
    with DB_LOCK:
        con = db()
        rows = con.execute(
            "SELECT * FROM rsvps ORDER BY createdAt DESC"
        ).fetchall()
        con.close()
    return [row_to_dict(row) for row in rows]


def insert_rsvp(row):
    with DB_LOCK:
        con = db()
        count = con.execute("SELECT COUNT(*) FROM rsvps").fetchone()[0]
        if count >= MAX_RSVPS:
            con.close()
            return False
        con.execute(
            """
            INSERT INTO rsvps (id, name, status, guests, message, featured, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["id"],
                row["name"],
                row["status"],
                row["guests"],
                row["message"],
                1 if row["featured"] else 0,
                row["createdAt"],
            ),
        )
        con.commit()
        con.close()
    return True


def set_featured(rsvp_id, featured):
    with DB_LOCK:
        con = db()
        row = con.execute("SELECT * FROM rsvps WHERE id = ?", (rsvp_id,)).fetchone()
        if not row:
            con.close()
            return None
        data = row_to_dict(row)
        has_message = bool(data["message"].strip())
        data["featured"] = bool(featured) and has_message
        con.execute(
            "UPDATE rsvps SET featured = ? WHERE id = ?",
            (1 if data["featured"] else 0, rsvp_id),
        )
        con.commit()
        con.close()
    return data


def stats(rows):
    attending = [row for row in rows if row.get("status") == "attending"]
    declining = [row for row in rows if row.get("status") != "attending"]
    return {
        "total": len(rows),
        "attending": len(attending),
        "declining": len(declining),
        "guests": sum(int(row.get("guests") or 0) for row in attending),
        "messages": sum(1 for row in rows if str(row.get("message") or "").strip()),
        "featured": sum(1 for row in rows if row.get("featured")),
    }


def read_json(path, fallback):
    if not path.exists():
        return fallback
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, payload):
    DATA_DIR.mkdir(exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    tmp.replace(path)


def admin_password():
    data = read_json(ADMIN_FILE, {"password": "1234"})
    return str(data.get("password") or "1234")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        print("[%s] %s" % (self.log_date_time_string(), format % args))

    def end_headers(self):
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(min(length, 20000)).decode("utf-8")
        if not raw:
            return {}
        return json.loads(raw)

    def token_ok(self):
        token = self.headers.get("X-Admin-Token", "")
        return bool(token) and token in SESSIONS

    def translate_path(self, path):
        parsed = urlparse(path)
        relative = Path(parsed.path.lstrip("/"))
        if relative.parts and relative.parts[0] in BLOCKED:
            return str(ROOT / "__blocked__")
        return super().translate_path(path)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/admin", "/admin/"):
            self.path = "/admin.html"
            return super().do_GET()
        if parsed.path == "/api/wishes":
            rows = [
                {"id": row["id"], "name": row["name"], "message": row["message"]}
                for row in load_rsvps()
                if row.get("featured") and str(row.get("message") or "").strip()
            ]
            return self.send_json({"wishes": rows})
        if parsed.path == "/api/admin/rsvps":
            if not self.token_ok():
                return self.send_json({"error": "unauthorized"}, 401)
            rows = load_rsvps()
            return self.send_json({"rsvps": rows, "stats": stats(rows)})
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            payload = self.read_body()
        except json.JSONDecodeError:
            return self.send_json({"error": "invalid_json"}, 400)

        if parsed.path == "/api/admin/login":
            password = str(payload.get("password") or "")
            if secrets.compare_digest(password, admin_password()):
                token = secrets.token_urlsafe(24)
                SESSIONS[token] = True
                return self.send_json({"token": token})
            return self.send_json({"error": "unauthorized"}, 401)

        if parsed.path == "/api/rsvp":
            name = str(payload.get("name") or "").strip()
            status = "attending" if payload.get("status") == "attending" else "declining"
            message = str(payload.get("message") or "").strip()
            try:
                guests = int(payload.get("guests") or 1)
            except (TypeError, ValueError):
                guests = 1
            guests = max(1, min(20, guests))
            if not name:
                return self.send_json({"error": "name_required"}, 400)
            row = {
                "id": str(uuid.uuid4()),
                "name": name[:MAX_NAME],
                "status": status,
                "guests": guests if status == "attending" else 0,
                "message": message[:MAX_MESSAGE],
                "featured": False,
                "createdAt": datetime.now(timezone.utc).isoformat(),
            }
            if not insert_rsvp(row):
                return self.send_json({"error": "full"}, 429)
            return self.send_json({"ok": True, "id": row["id"]})

        return self.send_json({"error": "not_found"}, 404)

    def do_PATCH(self):
        parsed = urlparse(self.path)
        prefix = "/api/admin/rsvps/"
        if not parsed.path.startswith(prefix):
            return self.send_json({"error": "not_found"}, 404)
        if not self.token_ok():
            return self.send_json({"error": "unauthorized"}, 401)
        rsvp_id = parsed.path[len(prefix) :]
        try:
            payload = self.read_body()
        except json.JSONDecodeError:
            return self.send_json({"error": "invalid_json"}, 400)
        row = set_featured(rsvp_id, payload.get("featured"))
        if not row:
            return self.send_json({"error": "not_found"}, 404)
        return self.send_json({"ok": True, "rsvp": row, "stats": stats(load_rsvps())})


if __name__ == "__main__":
    DATA_DIR.mkdir(exist_ok=True)
    init_db()
    if not ADMIN_FILE.exists():
        write_json(ADMIN_FILE, {"password": "1234"})
    port = 4173
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Invitation running at http://127.0.0.1:{port}/")
    print(f"Owner dashboard: http://127.0.0.1:{port}/admin")
    server.serve_forever()

#!/usr/bin/env python3
"""Local static server and API proxy for development only."""

from hmac import compare_digest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen


HOST = "127.0.0.1"
PORT = 8080
APP_VERSION = "v21"
ACCESS_KEY = os.environ.get("BUS_DEPARTURES_ACCESS_KEY", "")
ROOT = Path(__file__).resolve().parent
UPSTREAM_URL = "https://www.wienerlinien.at/ogd_realtime/monitor"
ALLOWED_STOP_IDS = frozenset({"754", "770", "1687", "1698"})
MAX_STOP_IDS = 4
UPSTREAM_TIMEOUT_SECONDS = 10


class DevelopmentServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        request_url = urlparse(self.path)
        if request_url.path == "/api/monitor":
            self.proxy_monitor(request_url.query)
            return
        super().do_GET()

    def proxy_monitor(self, query):
        if not ACCESS_KEY:
            self.send_error(503, "Access key is not configured")
            return

        authorization = self.headers.get("Authorization", "")
        provided_key = authorization.removeprefix("Bearer ") if authorization.startswith("Bearer ") else ""
        if not provided_key or not compare_digest(provided_key, ACCESS_KEY):
            self.send_response(401)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("WWW-Authenticate", "Bearer")
            self.end_headers()
            self.wfile.write(b"Unauthorized")
            return

        stop_ids = list(dict.fromkeys(parse_qs(query).get("stopId", [])))
        if (
            not stop_ids
            or len(stop_ids) > MAX_STOP_IDS
            or any(stop_id not in ALLOWED_STOP_IDS for stop_id in stop_ids)
        ):
            self.send_error(400, "Invalid stopId")
            return

        upstream_query = urlencode([("stopId", stop_id) for stop_id in stop_ids])
        request = Request(
            f"{UPSTREAM_URL}?{upstream_query}",
            headers={"Accept": "application/json", "User-Agent": f"ViennaBusDepartures/{APP_VERSION}"},
        )

        try:
            with urlopen(request, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
                body = response.read()
                self.send_response(response.status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except HTTPError as error:
            self.send_error(error.code, "Upstream API error")
        except (URLError, TimeoutError):
            self.send_error(502, "Upstream API unavailable")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-App-Version", APP_VERSION)
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


if __name__ == "__main__":
    if not ACCESS_KEY:
        raise SystemExit("Set BUS_DEPARTURES_ACCESS_KEY before starting the development server.")
    server = DevelopmentServer((HOST, PORT), AppHandler)
    print(f"Development server: http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDevelopment server stopped.")
    finally:
        server.server_close()

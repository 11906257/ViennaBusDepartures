#!/usr/bin/env python3
"""Local static server and API proxy for development only."""

from hmac import compare_digest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlparse
from urllib.request import Request, urlopen


HOST = "127.0.0.1"
PORT = 8080
APP_VERSION = "v29"
ACCESS_KEY = os.environ.get("BUS_DEPARTURES_ACCESS_KEY", "")
ROOT = Path(__file__).resolve().parent
UPSTREAM_URL = "https://www.wienerlinien.at/ogd_realtime/monitor"
ALLOWED_STOP_IDS = frozenset({"754", "1699", "1687", "1698"})
STATIC_PATHS = frozenset({
    "/", "/index.html", "/manifest.webmanifest", "/service-worker.js",
    "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png",
})
MAX_STOP_IDS = 4
MAX_QUERY_FIELDS = MAX_STOP_IDS * 2
MAX_ACCESS_KEY_LENGTH = 256
MAX_UPSTREAM_BYTES = 2 * 1024 * 1024
UPSTREAM_TIMEOUT_SECONDS = 8


def valid_access_key(value):
    return (
        isinstance(value, str)
        and 0 < len(value) <= MAX_ACCESS_KEY_LENGTH
        and all(0x21 <= ord(character) <= 0x7E for character in value)
    )


def bearer_token(header_value):
    prefix = "Bearer "
    if not isinstance(header_value, str) or not header_value.startswith(prefix):
        return ""
    token = header_value[len(prefix):]
    return token if valid_access_key(token) else ""


def validated_stop_ids(query):
    try:
        parameters = parse_qsl(
            query,
            keep_blank_values=True,
            max_num_fields=MAX_QUERY_FIELDS,
        )
    except ValueError:
        return None

    if not parameters or any(name != "stopId" for name, _ in parameters):
        return None

    stop_ids = list(dict.fromkeys(value for _, value in parameters))
    if (
        not stop_ids
        or len(stop_ids) > MAX_STOP_IDS
        or any(stop_id not in ALLOWED_STOP_IDS for stop_id in stop_ids)
    ):
        return None
    return stop_ids


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

    def send_head(self):
        # Do not expose local files, secrets, or directory listings.
        if urlparse(self.path).path not in STATIC_PATHS:
            self.send_error(404, "Not Found")
            return None
        return super().send_head()

    def proxy_monitor(self, query):
        if not valid_access_key(ACCESS_KEY):
            self.send_text(503, "Access key is not configured")
            return

        provided_key = bearer_token(self.headers.get("Authorization", ""))
        if not provided_key or not compare_digest(provided_key, ACCESS_KEY):
            self.send_text(401, "Unauthorized", {"WWW-Authenticate": "Bearer"})
            return

        stop_ids = validated_stop_ids(query)
        if stop_ids is None:
            self.send_text(400, "Invalid request")
            return

        upstream_query = urlencode([("stopId", stop_id) for stop_id in stop_ids])
        request = Request(
            f"{UPSTREAM_URL}?{upstream_query}",
            headers={"Accept": "application/json", "User-Agent": f"ViennaBusDepartures/{APP_VERSION}"},
        )

        try:
            with urlopen(request, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
                body = response.read(MAX_UPSTREAM_BYTES + 1)
                if len(body) > MAX_UPSTREAM_BYTES:
                    self.send_text(502, "Upstream response is too large")
                    return
                self.send_response(response.status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            # The frontend cancels requests when it moves into the background.
            return
        except HTTPError:
            self.send_text(502, "Upstream API error")
        except (OSError, URLError, TimeoutError):
            self.send_text(502, "Upstream API unavailable")

    def send_text(self, status, message, extra_headers=None):
        body = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-App-Version", APP_VERSION)
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


if __name__ == "__main__":
    if not valid_access_key(ACCESS_KEY):
        raise SystemExit(
            "Set BUS_DEPARTURES_ACCESS_KEY to 1-256 printable ASCII characters without spaces."
        )
    with DevelopmentServer((HOST, PORT), AppHandler) as server:
        print(f"Development server: http://{HOST}:{PORT}")
        print("Press Ctrl+C to stop.")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nDevelopment server stopped.")

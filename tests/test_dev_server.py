import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "dev-server.py"
SPEC = importlib.util.spec_from_file_location("dev_server", MODULE_PATH)
dev_server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dev_server)


class AccessKeyTests(unittest.TestCase):
    def test_valid_access_key(self):
        self.assertTrue(dev_server.valid_access_key("abc-12345"))
        self.assertFalse(dev_server.valid_access_key(""))
        self.assertFalse(dev_server.valid_access_key("contains space"))
        self.assertFalse(dev_server.valid_access_key("ä"))
        self.assertFalse(dev_server.valid_access_key("x" * 257))


class QueryValidationTests(unittest.TestCase):
    def test_accepts_and_deduplicates_allowed_stops(self):
        self.assertEqual(
            dev_server.validated_stop_ids("stopId=1687&stopId=1687&stopId=754"),
            ["1687", "754"],
        )

    def test_rejects_invalid_or_unexpected_parameters(self):
        self.assertIsNone(dev_server.validated_stop_ids(""))
        self.assertIsNone(dev_server.validated_stop_ids("stopId="))
        self.assertIsNone(dev_server.validated_stop_ids("stopId=9999"))
        self.assertIsNone(dev_server.validated_stop_ids("stopId=1687&extra=1"))


class StaticFileTests(unittest.TestCase):
    def test_only_app_assets_are_served(self):
        handler = object.__new__(dev_server.AppHandler)
        handler.send_error = Mock()
        with patch.object(dev_server.SimpleHTTPRequestHandler, "send_head", return_value="asset") as serve:
            for path in ["/", "/index.html", "/icons/icon-192.png?v=test"]:
                handler.path = path
                self.assertEqual(handler.send_head(), "asset")
            for path in ["/.env", "/proxy/", "/dev-server.py", "/icons/../.env", "/%2eenv"]:
                handler.path = path
                self.assertIsNone(handler.send_head())
            self.assertEqual(serve.call_count, 3)


if __name__ == "__main__":
    unittest.main()

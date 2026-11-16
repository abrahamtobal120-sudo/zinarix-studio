# SPDX-FileCopyrightText: 2026 Zinarix Studio
#
# SPDX-License-Identifier: GPL-2.0-or-later

"""Tests for zinarix_ai/client.py. Pure stdlib, no bpy, no network.

Run: python -I -m unittest discover -s apps/desktop/blender/tests
"""

import http.server
import importlib.util
import json
import os
import socket
import sys
import threading
import unittest
from unittest import mock

_ADDON_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), os.pardir, "scripts", "addons", "zinarix_ai",
)
# Load client.py by path so the package __init__ (which imports bpy) never runs.
_spec = importlib.util.spec_from_file_location("zinarix_ai_client", os.path.join(_ADDON_DIR, "client.py"))
client = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = client
_spec.loader.exec_module(client)

TOKEN = "zx-secret-token-1234567890"


class _Handler(http.server.BaseHTTPRequestHandler):
    # Set per test: list of (status, body) or callables, consumed in order.
    script = []
    requests = []

    def log_message(self, *_args):
        pass

    def _serve(self):
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length) if length else b""
        type(self).requests.append({
            "method": self.command, "path": self.path,
            "headers": {k.lower(): v for k, v in self.headers.items()},
            "body": json.loads(body) if body else None,
        })
        step = type(self).script.pop(0) if type(self).script else (500, {"error": "no script"})
        if step == "reset":
            # Abort the connection without answering.
            self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, b"\x01\x00\x00\x00\x00\x00\x00\x00")
            self.connection.close()
            self.close_connection = True
            return
        status, payload = step
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = _serve
    do_POST = _serve


def _ok(text):
    return (200, {"choices": [{"message": {"role": "assistant", "content": text}}]})


class StubServerCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = "http://127.0.0.1:{:d}/v1".format(cls.server.server_address[1])

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        _Handler.script = []
        _Handler.requests = []
        patcher = mock.patch.dict(os.environ, {
            "ZINARIX_BRIDGE_URL": self.base, "ZINARIX_BRIDGE_TOKEN": TOKEN,
        })
        patcher.start()
        self.addCleanup(patcher.stop)
        delay = mock.patch.object(client, "RETRY_DELAY", 0)
        delay.start()
        self.addCleanup(delay.stop)

    def chat(self, provider="ZINARIX", **kw):
        args = dict(base_url="", model="", api_key="", system="sys",
                    messages=[{"role": "user", "content": "hi"}], max_tokens=100)
        args.update(kw)
        return client.chat(provider, **args)


class TestProviders(unittest.TestCase):
    def test_zinarix_first_and_shape(self):
        self.assertEqual(next(iter(client.PROVIDERS)), "ZINARIX")
        info = client.PROVIDERS["ZINARIX"]
        self.assertEqual(info["label"], "Zinarix Studio")
        self.assertEqual(info["kind"], "openai")
        self.assertEqual(info["model"], "")
        self.assertFalse(info["needs_key"])
        self.assertIn("ZINARIX_BRIDGE_TOKEN", info["key_env"])
        for info in client.PROVIDERS.values():
            for key in ("label", "kind", "base_url", "model", "key_env", "needs_key"):
                self.assertIn(key, info)

    def test_all_exports(self):
        for name in client.__all__:
            self.assertTrue(hasattr(client, name), name)
        for name in ("bridge_available", "list_models", "resolve_base_url", "default_timeout"):
            self.assertIn(name, client.__all__)

    def test_bridge_available_and_resolution(self):
        with mock.patch.dict(os.environ, {"ZINARIX_BRIDGE_URL": ""}):
            self.assertFalse(client.bridge_available())
            self.assertEqual(client.resolve_base_url("ZINARIX"), "")
        with mock.patch.dict(os.environ, {"ZINARIX_BRIDGE_URL": "http://127.0.0.1:1/v1"}):
            self.assertTrue(client.bridge_available())
            self.assertEqual(client.resolve_base_url("ZINARIX"), "http://127.0.0.1:1/v1")
            self.assertEqual(client.resolve_base_url("ZINARIX", "http://x/v1"), "http://x/v1")
        self.assertEqual(client.resolve_base_url("OPENAI"), "https://api.openai.com/v1")

    def test_timeouts(self):
        self.assertEqual(client.default_timeout("ZINARIX"), 600)
        self.assertEqual(client.default_timeout("OLLAMA"), 600)
        self.assertEqual(client.default_timeout("OPENAI"), 180)
        self.assertEqual(client.default_timeout("ANTHROPIC"), 180)
        self.assertEqual(client.default_timeout("CUSTOM", "http://localhost:1234/v1"), 600)
        self.assertEqual(client.default_timeout("CUSTOM", "https://api.groq.com/v1"), 180)

    def test_is_local_url(self):
        self.assertTrue(client.is_local_url("http://127.0.0.1:5/v1"))
        self.assertTrue(client.is_local_url("http://127.1.2.3/v1"))
        self.assertTrue(client.is_local_url("http://[::1]:8/v1"))
        self.assertTrue(client.is_local_url("http://LOCALHOST/v1"))
        self.assertFalse(client.is_local_url("https://api.openai.com/v1"))
        self.assertFalse(client.is_local_url(""))

    def test_build_request_backward_compatible(self):
        url, headers, body = client.build_request(
            "ANTHROPIC", base_url="", model="", api_key="k" * 10, system="s",
            messages=[{"role": "user", "content": "x"}], max_tokens=50,
        )
        self.assertEqual(url, "https://api.anthropic.com/v1/messages")
        self.assertEqual(headers["x-api-key"], "k" * 10)
        self.assertEqual(json.loads(body)["system"], "s")
        with self.assertRaises(client.ClientError):
            client.build_request("OPENAI", base_url="", model="", api_key="", system="",
                                 messages=[], max_tokens=1)
        with self.assertRaises(client.ClientError):
            client.build_request("CUSTOM", base_url="http://h/v1", model="", api_key="",
                                 system="", messages=[], max_tokens=1)
        with self.assertRaises(client.ClientError):
            client.build_request("NOPE", base_url="", model="", api_key="", system="",
                                 messages=[], max_tokens=1)

    def test_bridge_token_only_to_loopback(self):
        env = {"ZINARIX_BRIDGE_URL": "http://127.0.0.1:1/v1", "ZINARIX_BRIDGE_TOKEN": TOKEN}
        kw = dict(model="", api_key="", system="", messages=[], max_tokens=1)
        with mock.patch.dict(os.environ, env):
            _url, headers, _body = client.build_request("ZINARIX", base_url="", **kw)
            self.assertEqual(headers["authorization"], "Bearer " + TOKEN)
            _url, headers, _body = client.build_request(
                "ZINARIX", base_url="https://evil.example/v1", **kw)
            self.assertNotIn("authorization", headers)

    def test_bridge_without_url(self):
        with mock.patch.dict(os.environ, {"ZINARIX_BRIDGE_URL": ""}):
            with self.assertRaises(client.ClientError) as cm:
                client.build_request("ZINARIX", base_url="", model="", api_key="", system="",
                                     messages=[], max_tokens=1)
            self.assertIn("Zinarix Studio is not running", str(cm.exception))
            with self.assertRaises(client.ClientError):
                client.list_models({"provider": "ZINARIX"})

    def test_parse_response(self):
        self.assertEqual(client.parse_response("OPENAI", _ok("hey")[1]), "hey")
        self.assertEqual(client.parse_response(
            "ANTHROPIC", {"content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]}), "ab")
        with self.assertRaises(client.ClientError):
            client.parse_response("OPENAI", {"choices": []})
        with self.assertRaises(client.ClientError):
            client.parse_response("OPENAI", _ok("  ")[1])


class TestExtractCode(unittest.TestCase):
    def test_single_block(self):
        self.assertEqual(client.extract_code("Sure:\n```python\nimport bpy\n```\nDone."), "import bpy\n")

    def test_multiple_blocks_joined_in_order(self):
        text = "A\n```python\na = 1\n```\nthen\n```py\nb = 2\n```\nend"
        self.assertEqual(client.extract_code(text), "a = 1\n\nb = 2\n")

    def test_bare_fence(self):
        self.assertEqual(client.extract_code("```\nx = 1\n```"), "x = 1\n")

    def test_labelled_preferred_over_bare_and_other_langs(self):
        text = "```bash\nrm -rf /\n```\nnow\n```\noutput\n```\n```Python\ny = 2\n```"
        self.assertEqual(client.extract_code(text), "y = 2\n")

    def test_other_lang_closing_not_treated_as_opening(self):
        text = "```bash\nls\n```\nexplain\n```\nz = 3\n```"
        self.assertEqual(client.extract_code(text), "z = 3\n")

    def test_unclosed_fence(self):
        self.assertEqual(client.extract_code("```python\nq = 1\nr = 2"), "q = 1\nr = 2\n")

    def test_no_fence(self):
        self.assertEqual(client.extract_code("  import bpy  \n"), "import bpy\n")

    def test_crlf(self):
        self.assertEqual(client.extract_code("```python\r\na = 1\r\n```\r\n"), "a = 1\n")


class TestRiskyCalls(unittest.TestCase):
    def test_flags(self):
        cases = {
            "os.system('x')": "os.system",
            "import subprocess": "subprocess",
            "shutil.rmtree(p)": "shutil.rmtree",
            "os.remove(p)": "os.remove",
            "os.unlink(p)": "os.remove",
            "eval('1')": "eval",
            "exec(code)": "exec",
            "__import__('os')": "__import__",
            "import socket": "socket",
            "urllib.request.urlopen(u)": "urllib",
            "import requests": "requests",
            "Path(p).unlink()": "Path.unlink",
            "import ctypes": "ctypes",
            "os.popen('x')": "os.popen",
            "getattr(os, 'system')('x')": "getattr(os)",
            "import webbrowser": "webbrowser",
            "pickle.loads(b)": "pickle",
            "open('/tmp/x', 'w')": "open",
            "io.open(p)": "open",
            "Path(p).write_text('x')": "Path.write",
            "shutil.copyfile(a, b)": "shutil.copy",
            "bpy.ops.wm.save_mainfile()": "bpy.ops.wm.save_mainfile",
        }
        for code, label in cases.items():
            self.assertIn(label, client.risky_calls(code), code)

    def test_safe_code(self):
        code = (
            "import bpy\nimport ast\n"
            "# no subprocess or os.system here\n"
            "v = ast.literal_eval('1')\nmesh = bpy.data.meshes.new('Cube')\n"
            "pattern = re.compile('x')\nevaluate = 1\n"
            "op = bpy.ops.wm.open_mainfile\nimg.reopen()\n"
        )
        self.assertEqual(client.risky_calls(code), [])

    def test_sorted_unique(self):
        self.assertEqual(client.risky_calls("eval(a)\neval(b)\nos.system(c)"), ["eval", "os.system"])

    def test_broken_code_still_scanned(self):
        self.assertIn("os.system", client.risky_calls("def f(:\n    os.system('x'"))


class TestChat(StubServerCase):
    def test_bridge_chat(self):
        _Handler.script = [_ok("```python\nprint(1)\n```")]
        text = self.chat()
        self.assertIn("print(1)", text)
        req = _Handler.requests[0]
        self.assertEqual(req["path"], "/v1/chat/completions")
        self.assertEqual(req["headers"]["authorization"], "Bearer " + TOKEN)
        self.assertEqual(req["body"]["model"], "")
        self.assertEqual(req["body"]["messages"][0], {"role": "system", "content": "sys"})

    def test_explicit_model(self):
        _Handler.script = [_ok("hi")]
        self.chat(model="claude-cli")
        self.assertEqual(_Handler.requests[0]["body"]["model"], "claude-cli")

    def test_retry_once_on_503(self):
        _Handler.script = [(503, {"error": {"message": "busy"}}), _ok("ok")]
        self.assertEqual(self.chat(), "ok")
        self.assertEqual(len(_Handler.requests), 2)

    def test_retry_on_429_and_529(self):
        for status in (429, 529, 502):
            _Handler.script = [(status, {"error": "x"}), _ok("ok")]
            _Handler.requests = []
            self.assertEqual(self.chat(), "ok")
            self.assertEqual(len(_Handler.requests), 2)

    def test_only_one_retry(self):
        _Handler.script = [(503, {"error": "busy"}), (503, {"error": "busy"}), _ok("never")]
        with self.assertRaises(client.ClientError) as cm:
            self.chat()
        self.assertIn("503", str(cm.exception))
        self.assertEqual(len(_Handler.requests), 2)

    def test_no_retry_on_500(self):
        _Handler.script = [(500, {"error": "boom"}), _ok("never")]
        with self.assertRaises(client.ClientError):
            self.chat()
        self.assertEqual(len(_Handler.requests), 1)

    def test_retry_on_connection_reset(self):
        _Handler.script = ["reset", _ok("after reset")]
        self.assertEqual(self.chat(), "after reset")

    def test_401_hides_token(self):
        _Handler.script = [(401, {"error": {"message": "bad token " + TOKEN}})]
        with self.assertRaises(client.ClientError) as cm:
            self.chat()
        msg = str(cm.exception)
        self.assertIn("401", msg)
        self.assertNotIn(TOKEN, msg)

    def test_401_cloud_hides_key(self):
        key = "sk-very-secret-key-000"
        _Handler.script = [(401, {"error": {"message": "Incorrect API key provided: " + key}})]
        with self.assertRaises(client.ClientError) as cm:
            self.chat("CUSTOM", base_url=self.base, model="m", api_key=key)
        self.assertIn("API key", str(cm.exception))
        self.assertNotIn(key, str(cm.exception))

    def test_404_model(self):
        _Handler.script = [(404, {"error": {"message": "model not found"}})]
        with self.assertRaises(client.ClientError) as cm:
            self.chat(model="ghost")
        self.assertIn("ghost", str(cm.exception))
        self.assertIn("404", str(cm.exception))

    def test_invalid_json(self):
        _Handler.script = [(200, b"<html>nope</html>")]
        with self.assertRaises(client.ClientError) as cm:
            self.chat()
        self.assertIn("valid JSON", str(cm.exception))

    def test_timeout(self):
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)  # Accepts the connection but never answers.
        self.addCleanup(listener.close)
        url = "http://127.0.0.1:{:d}/v1".format(listener.getsockname()[1])
        with self.assertRaises(client.ClientError) as cm:
            self.chat(base_url=url, timeout=0.5)
        self.assertIn("too long", str(cm.exception))

    def test_bridge_not_running(self):
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()  # Nothing listens on this port now.
        with mock.patch.dict(os.environ, {"ZINARIX_BRIDGE_URL": "http://127.0.0.1:{:d}/v1".format(port)}):
            with self.assertRaises(client.ClientError) as cm:
                self.chat()
            self.assertEqual(str(cm.exception), client.BRIDGE_NOT_RUNNING)
            self.assertFalse(client.bridge_available(probe=True))
            with self.assertRaises(client.ClientError):
                self.chat("OLLAMA", base_url="http://127.0.0.1:{:d}/v1".format(port))

    def test_bridge_available_probe(self):
        self.assertTrue(client.bridge_available(probe=True))


class TestListModels(StubServerCase):
    def test_openai_shape(self):
        _Handler.script = [(200, {"object": "list", "data": [{"id": "default"}, {"id": "claude-cli"}]})]
        self.assertEqual(client.list_models({"provider": "ZINARIX"}), ["default", "claude-cli"])
        req = _Handler.requests[0]
        self.assertEqual((req["method"], req["path"]), ("GET", "/v1/models"))
        self.assertEqual(req["headers"]["authorization"], "Bearer " + TOKEN)

    def test_custom_base(self):
        _Handler.script = [(200, {"models": [{"name": "qwen3"}]})]
        self.assertEqual(client.list_models({"provider": "OLLAMA", "base_url": self.base}), ["qwen3"])

    def test_anthropic_no_request(self):
        self.assertEqual(client.list_models({"provider": "ANTHROPIC"}), ["claude-opus-5-5"])
        self.assertEqual(_Handler.requests, [])

    def test_errors(self):
        _Handler.script = [(401, {"error": "nope"})]
        with self.assertRaises(client.ClientError):
            client.list_models({"provider": "ZINARIX"})
        _Handler.script = [(200, {"weird": True})]
        with self.assertRaises(client.ClientError):
            client.list_models({"provider": "ZINARIX"})


if __name__ == "__main__":
    unittest.main()

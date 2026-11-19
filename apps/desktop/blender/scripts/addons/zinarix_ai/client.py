# SPDX-FileCopyrightText: 2026 Zinarix Studio
#
# SPDX-License-Identifier: GPL-2.0-or-later

"""HTTP client for external AI providers.

Pure Python (only the standard library, no ``bpy``) so it can be tested outside
Zinarix Studio 3D. Supports the Anthropic Messages API and any OpenAI-compatible
``/chat/completions`` endpoint (the Zinarix Studio bridge, OpenAI, Ollama,
LM Studio, OpenRouter, Groq...).

Error messages are English; the add-on translates them for display. They never
contain the API key or bridge token.
"""

__all__ = (
    "PROVIDERS",
    "ClientError",
    "build_request",
    "parse_response",
    "extract_code",
    "risky_calls",
    "is_local_url",
    "chat",
    # Added for the Zinarix Studio bridge.
    "BRIDGE_PROVIDER",
    "BRIDGE_NOT_RUNNING",
    "bridge_available",
    "bridge_endpoint",
    "resolve_base_url",
    "resolve_api_key",
    "default_timeout",
    "list_models",
)

import http.client
import ipaddress
import io
import json
import os
import re
import socket
import time
import tokenize
import urllib.error
import urllib.parse
import urllib.request

ANTHROPIC_VERSION = "2023-06-01"

BRIDGE_PROVIDER = "ZINARIX"
BRIDGE_URL_ENV = "ZINARIX_BRIDGE_URL"
BRIDGE_TOKEN_ENV = "ZINARIX_BRIDGE_TOKEN"
# Permanent bridge: Zinarix Studio announces it in this file so a Blender opened
# outside Zinarix finds it too. ZINARIX_BRIDGE_FILE overrides the path.
BRIDGE_FILE_ENV = "ZINARIX_BRIDGE_FILE"
BRIDGE_NOT_RUNNING = (
    "Zinarix Studio is not running or the bridge is closed; open 3D Pro from Zinarix Studio."
)

# Timeouts in seconds. CLI-backed bridge models and local models can take minutes.
TIMEOUT_CLOUD = 180
TIMEOUT_LOCAL = 600
TIMEOUT_LIST_MODELS = 10

# Retry policy: one retry for transient failures. Tests set RETRY_DELAY to 0.
RETRY_STATUSES = frozenset((429, 502, 503, 529))
RETRY_DELAY = 1.5
RETRY_AFTER_MAX = 10.0

# kind: wire format. base_url: default endpoint ("" = must be configured, or for
# ZINARIX read from ZINARIX_BRIDGE_URL at call time). key_env: environment
# variables read when the preferences have no key. needs_key: False for local
# servers. model: "" = the server's default model (ZINARIX) or must be set.
# timeout: seconds to wait for one answer. ZINARIX is first: it is the default.
PROVIDERS = {
    "ZINARIX": {
        "label": "Zinarix Studio",
        "kind": "openai",
        "base_url": "",
        "model": "",
        "key_env": (BRIDGE_TOKEN_ENV,),
        "needs_key": False,
        "timeout": TIMEOUT_LOCAL,
    },
    "ANTHROPIC": {
        "label": "Anthropic (Claude)",
        "kind": "anthropic",
        "base_url": "https://api.anthropic.com/v1",
        "model": "claude-opus-5-5",
        "key_env": ("ZINARIX_AI_KEY", "ANTHROPIC_API_KEY"),
        "needs_key": True,
        "timeout": TIMEOUT_CLOUD,
    },
    "OPENAI": {
        "label": "OpenAI",
        "kind": "openai",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-5",
        "key_env": ("ZINARIX_AI_KEY", "OPENAI_API_KEY"),
        "needs_key": True,
        "timeout": TIMEOUT_CLOUD,
    },
    "OPENROUTER": {
        "label": "OpenRouter",
        "kind": "openai",
        "base_url": "https://openrouter.ai/api/v1",
        "model": "anthropic/claude-opus-5-5",
        "key_env": ("ZINARIX_AI_KEY", "OPENROUTER_API_KEY"),
        "needs_key": True,
        "timeout": TIMEOUT_CLOUD,
    },
    "OLLAMA": {
        "label": "Ollama (local)",
        "kind": "openai",
        "base_url": "http://localhost:11434/v1",
        "model": "qwen3-coder",
        "key_env": ("ZINARIX_AI_KEY",),
        "needs_key": False,
        "timeout": TIMEOUT_LOCAL,
    },
    "CUSTOM": {
        "label": "Custom (OpenAI-compatible)",
        "kind": "openai",
        "base_url": "",
        "model": "",
        "key_env": ("ZINARIX_AI_KEY",),
        "needs_key": False,
        "timeout": None,  # Local URL: TIMEOUT_LOCAL, otherwise TIMEOUT_CLOUD.
    },
}

# Providers whose empty model means "let the server pick its default".
_SERVER_DEFAULT_MODEL = frozenset((BRIDGE_PROVIDER,))


class ClientError(Exception):
    """An error with a message that can be shown to the user as is."""


def _info(provider):
    info = PROVIDERS.get(provider)
    if info is None:
        raise ClientError("Unknown provider: {!s}".format(provider))
    return info


def _join(base_url, path):
    return base_url.rstrip("/") + "/" + path.lstrip("/")


# -----------------------------------------------------------------------------
# Settings resolution


def _bridge_file():
    path = os.environ.get(BRIDGE_FILE_ENV, "").strip()
    return path or os.path.join(os.path.expanduser("~"), ".zinarix", "blender-bridge.json")


def bridge_endpoint():
    """``(url, token)`` of the Zinarix Studio bridge, or ``("", "")``.

    The environment set by Zinarix Studio ("Modo Pro") wins; otherwise the
    permanent bridge's discovery file. A file URL that is not loopback is ignored,
    so its token is never sent anywhere else.
    """
    url = os.environ.get(BRIDGE_URL_ENV, "").strip()
    if url:
        return url, os.environ.get(BRIDGE_TOKEN_ENV, "")
    try:
        with open(_bridge_file(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return "", ""
    if not isinstance(data, dict):
        return "", ""
    url = data.get("url")
    token = data.get("token")
    if not isinstance(url, str) or not url.strip() or not is_local_url(url.strip()):
        return "", ""
    return url.strip(), token if isinstance(token, str) else ""


def resolve_base_url(provider, base_url=""):
    """Return the effective base URL: explicit value, then environment, then default.

    For ``ZINARIX`` the bridge URL comes from ``ZINARIX_BRIDGE_URL`` at call time.
    Returns ``""`` when nothing is configured.
    """
    info = _info(provider)
    url = (base_url or "").strip()
    if not url and provider == BRIDGE_PROVIDER:
        url = bridge_endpoint()[0]
    return url or info["base_url"]


def resolve_api_key(provider, api_key=""):
    """Return the explicit key, or the first non-empty ``key_env`` variable."""
    if api_key:
        return api_key
    for name in _info(provider)["key_env"]:
        value = os.environ.get(name, "")
        if value:
            return value
    if provider == BRIDGE_PROVIDER:
        return bridge_endpoint()[1]
    return ""


def _bridge_key(api_key, base_url):
    """The bridge token (environment or discovery file), only for a loopback URL."""
    if api_key:
        return api_key
    return resolve_api_key(BRIDGE_PROVIDER) if is_local_url(base_url) else ""


def default_timeout(provider, base_url=""):
    """Seconds to wait for one chat answer from ``provider``."""
    timeout = _info(provider).get("timeout")
    if timeout:
        return timeout
    return TIMEOUT_LOCAL if is_local_url(resolve_base_url(provider, base_url)) else TIMEOUT_CLOUD


def bridge_available(probe=False, timeout=0.5):
    """True when Zinarix Studio exported a bridge URL or announced a permanent bridge.

    With ``probe=True`` also check that something accepts TCP connections on it
    (blocks up to ``timeout`` seconds, so do not probe from a draw callback).
    """
    url = bridge_endpoint()[0]
    if not url:
        return False
    if not probe:
        return True
    try:
        parts = urllib.parse.urlparse(url)
        host = parts.hostname
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError:
        return False
    if not host:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def is_local_url(url):
    """True for loopback hosts (localhost, 127.0.0.0/8, ::1)."""
    try:
        host = (urllib.parse.urlparse(url or "").hostname or "").lower()
    except ValueError:
        return False
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


# -----------------------------------------------------------------------------
# Request / response


def build_request(provider, *, base_url, model, api_key, system, messages, max_tokens):
    """Return ``(url, headers, body_bytes)`` for one chat request.

    ``messages`` is a list of ``{"role": "user"|"assistant", "content": str}``.
    """
    info = _info(provider)
    base_url = resolve_base_url(provider, base_url)
    model = (model or info["model"] or "").strip()
    if provider == BRIDGE_PROVIDER:
        api_key = _bridge_key(api_key, base_url)
    if not base_url:
        if provider == BRIDGE_PROVIDER:
            raise ClientError(BRIDGE_NOT_RUNNING)
        raise ClientError("Set the server URL in the add-on preferences.")
    if not model and provider not in _SERVER_DEFAULT_MODEL:
        raise ClientError("Set the model in the add-on preferences.")
    if info["needs_key"] and not api_key:
        raise ClientError(
            "Missing API key. Add it in Preferences > Add-ons > Zinarix AI "
            "or set the {:s} environment variable.".format(info["key_env"][-1])
        )

    headers = {"content-type": "application/json", "user-agent": "zinarix-studio-3d"}
    if info["kind"] == "anthropic":
        url = _join(base_url, "messages")
        headers["x-api-key"] = api_key
        headers["anthropic-version"] = ANTHROPIC_VERSION
        # No temperature / top_p: current Claude models reject sampling parameters.
        body = {"model": model, "max_tokens": int(max_tokens), "messages": messages}
        if system:
            body["system"] = system
    else:
        url = _join(base_url, "chat/completions")
        if api_key:
            headers["authorization"] = "Bearer " + api_key
        all_messages = ([{"role": "system", "content": system}] if system else []) + list(messages)
        # An empty model asks the bridge for its default model.
        body = {"model": model, "max_tokens": int(max_tokens), "messages": all_messages}
    return url, headers, json.dumps(body).encode("utf-8")


def parse_response(provider, data):
    """Extract the reply text from a decoded JSON response."""
    kind = _info(provider)["kind"]
    if isinstance(data, dict) and data.get("error") and not data.get("choices") and not data.get("content"):
        err = data["error"]
        detail = err.get("message") if isinstance(err, dict) else err
        raise ClientError("Server error: {!s}".format(detail)[:500])
    try:
        if kind == "anthropic":
            text = "".join(
                block.get("text", "") for block in data["content"] if block.get("type") == "text"
            )
        else:
            content = data["choices"][0]["message"]["content"] or ""
            if isinstance(content, list):  # Content parts.
                content = "".join(
                    part.get("text", "") for part in content if isinstance(part, dict)
                )
            text = content
    except (KeyError, IndexError, TypeError, AttributeError):
        raise ClientError("Unexpected answer from the server.") from None
    if not isinstance(text, str) or not text.strip():
        raise ClientError("The model returned an empty answer.")
    return text


# -----------------------------------------------------------------------------
# Code extraction and review

_FENCE_OPEN_RE = re.compile(r"^ {0,3}(`{3,})[ \t]*([^\s`]*)[^`]*$")
_PYTHON_LANGS = frozenset(("python", "py", "python3", "py3", "bpy"))


def _fenced_blocks(text):
    """Yield ``(lang, code)`` for every fenced block, in order.

    Fences of other languages are consumed too, so their closing fence is never
    mistaken for the opening of a bare block. An unclosed final fence (a
    truncated answer) runs to the end of the text.
    """
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        match = _FENCE_OPEN_RE.match(lines[i])
        if not match:
            i += 1
            continue
        fence, lang = match.group(1), match.group(2).lower()
        body = []
        i += 1
        while i < len(lines):
            stripped = lines[i].strip()
            if stripped.startswith(fence) and stripped.strip("`") == "":
                break
            body.append(lines[i])
            i += 1
        i += 1  # Skip the closing fence.
        yield lang, "\n".join(body)


def extract_code(text):
    """Return the Python code of a reply.

    All ```python / ```py blocks are joined in order. Without labelled blocks,
    the bare ``` blocks are joined. Without any fence the whole text is returned.
    """
    text = text or ""
    blocks = list(_fenced_blocks(text))
    chosen = [code for lang, code in blocks if lang in _PYTHON_LANGS]
    if not chosen:
        chosen = [code for lang, code in blocks if lang == ""]
    chosen = [code.strip("\n") for code in chosen if code.strip()]
    if chosen:
        return "\n\n".join(chosen).strip() + "\n"
    return text.strip() + "\n"


# Calls that deserve an explicit warning before running generated code:
# (label shown to the user, pattern).
_RISKY_PATTERNS = tuple(
    (label, re.compile(pattern))
    for label, pattern in (
        ("os.system", r"\bos\s*\.\s*system\b"),
        ("os.popen", r"\bos\s*\.\s*popen\b"),
        ("os.exec", r"\bos\s*\.\s*exec\w*"),
        ("os.spawn", r"\bos\s*\.\s*spawn\w*"),
        ("os.fork", r"\bos\s*\.\s*fork\w*"),
        ("os.kill", r"\bos\s*\.\s*kill\w*"),
        ("os.startfile", r"\bos\s*\.\s*startfile\b"),
        ("os.remove", r"\bos\s*\.\s*(?:remove|unlink)\b"),
        ("os.rmdir", r"\bos\s*\.\s*(?:rmdir|removedirs)\b"),
        ("os.rename", r"\bos\s*\.\s*(?:rename|renames|replace)\b"),
        ("os.chmod", r"\bos\s*\.\s*(?:chmod|chown)\b"),
        ("shutil.rmtree", r"\bshutil\s*\.\s*rmtree\b"),
        ("shutil.move", r"\bshutil\s*\.\s*move\b"),
        ("Path.unlink", r"\.\s*(?:unlink|rmdir)\s*\("),
        ("open", r"(?<![\w.])open\s*\(|\b(?:io|os|codecs)\s*\.\s*open\b"),
        ("Path.write", r"\.\s*(?:write_text|write_bytes)\s*\("),
        ("shutil.copy", r"\bshutil\s*\.\s*copy\w*"),
        ("bpy.ops.wm.save_mainfile", r"\bwm\s*\.\s*save(?:_as)?_mainfile\b"),
        ("subprocess", r"\bsubprocess\b"),
        ("multiprocessing", r"\bmultiprocessing\b"),
        ("pty", r"\bimport\s+pty\b|\bpty\s*\.\s*spawn\b"),
        ("socket", r"\bsocket\b"),
        ("urllib", r"\burllib\d?\b"),
        ("requests", r"\brequests\b"),
        ("http.client", r"\bhttp\s*\.\s*(?:client|server)\b"),
        ("httpx", r"\b(?:httpx|aiohttp)\b"),
        ("ftplib", r"\b(?:ftplib|smtplib|telnetlib|poplib|imaplib)\b"),
        ("webbrowser", r"\bwebbrowser\b"),
        ("ctypes", r"\b(?:ctypes|cffi)\b"),
        ("pickle", r"\b(?:pickle|marshal|shelve)\b"),
        ("importlib", r"\bimportlib\b"),
        ("__import__", r"\b__import__\b"),
        ("__builtins__", r"\b__builtins__\b|\bimport\s+builtins\b"),
        ("eval", r"(?<![\w.])eval\s*\("),
        ("exec", r"(?<![\w.])exec\s*\("),
        ("compile", r"(?<![\w.])compile\s*\("),
        ("getattr(os)", r"\bgetattr\s*\(\s*(?:os|sys|shutil|subprocess|builtins)\b"),
        ("bpy.ops.wm.quit_blender", r"\bwm\s*\.\s*quit_blender\b"),
        ("bpy.utils.execfile", r"\bbpy\s*\.\s*utils\s*\.\s*execfile\b"),
    )
)


def _strip_comments(code):
    """Drop ``#`` comments so explanations like "# no subprocess" are not flagged."""
    try:
        tokens = [
            tok for tok in tokenize.generate_tokens(io.StringIO(code).readline)
            if tok.type != tokenize.COMMENT
        ]
        return tokenize.untokenize(tokens)
    except (tokenize.TokenError, IndentationError, SyntaxError, ValueError):
        return code


def risky_calls(code):
    """Return the sorted, unique risky names found in ``code`` (comments ignored)."""
    code = _strip_comments(code or "")
    return sorted({label for label, pattern in _RISKY_PATTERNS if pattern.search(code)})


# -----------------------------------------------------------------------------
# Transport


def _redact(message, *secrets):
    for secret in secrets:
        if secret and len(secret) >= 4:
            message = message.replace(secret, "***")
    return message


def _error_detail(raw):
    try:
        data = json.loads(raw)
        err = data.get("error")
        if isinstance(err, dict):
            detail = err.get("message") or json.dumps(err)
        else:
            detail = err or data.get("message") or data.get("detail") or raw
    except (ValueError, AttributeError):
        detail = raw
    return " ".join(str(detail).split())[:400]


def _error_message(status, raw, provider="", model=""):
    detail = _error_detail(raw)
    suffix = ": " + detail if detail else "."
    if status == 401:
        if provider == BRIDGE_PROVIDER:
            return (
                "The Zinarix Studio bridge rejected the session token (401). "
                "Reopen 3D Pro from Zinarix Studio" + suffix
            )
        return "The server rejected the API key (401)" + suffix
    if status == 403:
        return "Access denied by the server (403)" + suffix
    if status == 404:
        if model:
            return "Model \"{:s}\" or endpoint not found (404)".format(model) + suffix
        return "Endpoint or model not found (404); check the server URL" + suffix
    if status == 429:
        return "Rate limit or quota reached (429)" + suffix
    if status in (502, 503, 529):
        return "The server is overloaded or unavailable ({:d})".format(status) + suffix
    return "Server error {:d}".format(status) + suffix


def _is_refused(reason):
    if isinstance(reason, ConnectionRefusedError):
        return True
    return isinstance(reason, OSError) and getattr(reason, "errno", None) in (61, 111, 10061)


def _is_reset(exc):
    return isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError,
                            http.client.RemoteDisconnected))


def _is_timeout(exc):
    return isinstance(exc, (TimeoutError, socket.timeout))


def _retry_after(headers):
    try:
        value = float(headers.get("retry-after", ""))
    except (TypeError, ValueError, AttributeError):
        return RETRY_DELAY
    return max(0.0, min(value, RETRY_AFTER_MAX)) if RETRY_DELAY else 0.0


def _request_json(provider, url, *, data=None, headers, timeout, model="", secret="", retries=1):
    """Perform one HTTP request (with retries) and return the decoded JSON.

    Raises ``ClientError`` with a user-facing message that never contains ``secret``.
    """
    host = urllib.parse.urlsplit(url)
    where = "{:s}://{:s}".format(host.scheme, host.netloc) if host.netloc else url

    def fail(message):
        return ClientError(_redact(message, secret))

    attempt = 0
    while True:
        delay = None
        request = urllib.request.Request(
            url, data=data, headers=headers, method="POST" if data is not None else "GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8", "replace")
            break
        except urllib.error.HTTPError as ex:
            try:
                raw = ex.read().decode("utf-8", "replace")
            except Exception:
                raw = ""
            if ex.code in RETRY_STATUSES and attempt < retries:
                delay = _retry_after(ex.headers)
            else:
                raise fail(_error_message(ex.code, raw, provider, model)) from None
        except urllib.error.URLError as ex:
            reason = ex.reason
            if _is_timeout(reason):
                raise fail("The server took too long to answer ({:d} s).".format(int(timeout))) from None
            if _is_reset(reason) and attempt < retries:
                delay = RETRY_DELAY
            elif _is_refused(reason) and provider == BRIDGE_PROVIDER:
                raise fail(BRIDGE_NOT_RUNNING) from None
            elif _is_refused(reason):
                raise fail("Could not connect to {:s}; is the server running?".format(where)) from None
            else:
                raise fail("Could not connect to {:s}: {!s}".format(where, reason)) from None
        except OSError as ex:  # Raised while reading: timeouts, resets.
            if _is_timeout(ex):
                raise fail("The server took too long to answer ({:d} s).".format(int(timeout))) from None
            if _is_reset(ex) and attempt < retries:
                delay = RETRY_DELAY
            elif _is_reset(ex) and provider == BRIDGE_PROVIDER:
                raise fail("The Zinarix Studio bridge closed the connection; try again.") from None
            else:
                raise fail("Connection to {:s} failed: {!s}".format(where, ex)) from None
        except http.client.HTTPException as ex:
            raise fail("Invalid HTTP answer from {:s}: {:s}".format(where, type(ex).__name__)) from None
        attempt += 1
        if delay:
            time.sleep(delay)
    try:
        return json.loads(raw)
    except ValueError:
        raise fail("The server did not return valid JSON.") from None


def chat(provider, *, base_url, model, api_key, system, messages, max_tokens=4096, timeout=None):
    """Send one request and return the reply text. Raises ``ClientError``.

    ``timeout=None`` uses the provider default (``default_timeout``).
    """
    url, headers, body = build_request(
        provider,
        base_url=base_url,
        model=model,
        api_key=api_key,
        system=system,
        messages=messages,
        max_tokens=max_tokens,
    )
    if timeout is None:
        timeout = default_timeout(provider, base_url)
    secret = headers.get("x-api-key") or headers.get("authorization", "")[len("Bearer "):]
    model = (model or _info(provider)["model"] or "").strip()
    data = _request_json(
        provider, url, data=body, headers=headers, timeout=timeout, model=model, secret=secret,
    )
    return parse_response(provider, data)


def list_models(settings, timeout=TIMEOUT_LIST_MODELS):
    """Return the model ids offered by the configured server.

    ``settings`` is a mapping with ``provider`` and optionally ``base_url`` and
    ``api_key`` (the add-on's effective settings). OpenAI-compatible servers are
    asked ``GET {base}/models``; for Anthropic the known default model is
    returned without a request. Raises ``ClientError``.
    """
    provider = settings.get("provider") or BRIDGE_PROVIDER
    info = _info(provider)
    if info["kind"] == "anthropic":
        return [info["model"]] if info["model"] else []
    base_url = resolve_base_url(provider, settings.get("base_url", ""))
    if not base_url:
        if provider == BRIDGE_PROVIDER:
            raise ClientError(BRIDGE_NOT_RUNNING)
        raise ClientError("Set the server URL in the add-on preferences.")
    if provider == BRIDGE_PROVIDER:
        api_key = _bridge_key(settings.get("api_key", ""), base_url)
    else:
        api_key = resolve_api_key(provider, settings.get("api_key", ""))
    headers = {"accept": "application/json", "user-agent": "zinarix-studio-3d"}
    if api_key:
        headers["authorization"] = "Bearer " + api_key
    data = _request_json(
        provider, _join(base_url, "models"), headers=headers, timeout=timeout, secret=api_key,
    )
    items = data.get("data") if isinstance(data, dict) else data
    if isinstance(data, dict) and items is None:
        items = data.get("models")  # Ollama's native shape.
    if not isinstance(items, list):
        raise ClientError("Unexpected answer from the server.")
    ids = []
    for item in items:
        model_id = item.get("id") or item.get("name") if isinstance(item, dict) else item
        if isinstance(model_id, str) and model_id and model_id not in ids:
            ids.append(model_id)
    return ids


def _bridge_call(path, body=None, timeout=TIMEOUT_LIST_MODELS):
    """One request to the Zinarix Studio bridge (``/v1/<path>``). Raises ``ClientError``."""
    url, token = bridge_endpoint()
    if not url:
        raise ClientError(BRIDGE_NOT_RUNNING)
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "user-agent": "zinarix-studio-3d",
        "authorization": "Bearer " + token,
    }
    data = None if body is None else json.dumps(body).encode("utf-8")
    return _request_json(
        BRIDGE_PROVIDER, _join(url, path), data=data, headers=headers, timeout=timeout,
        secret=token, retries=0,
    )


def submit_job(messages, *, system="", model="", title="", max_tokens=4096):
    """Leave a task on the permanent bridge and return its id at once.

    Zinarix Studio runs it in the background and keeps the answer, also with its
    window closed; if the computer turns off first, it runs when Zinarix opens again.
    Read it later with ``get_job``. Raises ``ClientError``.
    """
    msgs = ([{"role": "system", "content": system}] if system else []) + list(messages)
    body = {"messages": msgs, "max_tokens": max_tokens}
    if model:
        body["model"] = model
    if title:
        body["title"] = title
    data = _bridge_call("jobs", body)
    job_id = data.get("id") if isinstance(data, dict) else None
    if not isinstance(job_id, str) or not job_id:
        raise ClientError("The Zinarix Studio bridge did not accept the task.")
    return job_id


def get_job(job_id):
    """``(status, text, error)`` of a task left with ``submit_job``.

    ``status`` is queued, running, done, error or cancelled; ``text`` is the answer
    once done. Raises ``ClientError`` (an unknown id too).
    """
    data = _bridge_call("jobs/" + urllib.parse.quote(job_id, safe=""))
    if not isinstance(data, dict):
        raise ClientError("Invalid answer from the Zinarix Studio bridge.")
    text = ""
    completion = data.get("completion")
    if isinstance(completion, dict):
        text = parse_response(BRIDGE_PROVIDER, completion)
    error = data.get("error") if isinstance(data.get("error"), dict) else {}
    return str(data.get("status", "")), text, str(error.get("message", ""))

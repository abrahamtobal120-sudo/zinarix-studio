# SPDX-FileCopyrightText: 2026 Zinarix Studio
#
# SPDX-License-Identifier: GPL-2.0-or-later

"""Pure-Python tests for zinarix_ai/agent.py (no Blender needed).

Run: python -m unittest discover -s apps/desktop/blender/tests
"""

import os
import sys
import unittest

ADDON_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), os.pardir, "scripts", "addons", "zinarix_ai",
)
sys.path.insert(0, os.path.normpath(ADDON_DIR))

import agent  # noqa: E402


def _raise(code):
    """Compile and run ``code`` like run_code does; return the formatted error."""
    try:
        exec(compile(code, agent.CODE_FILENAME, "exec"), {"__name__": "__zinarix_ai__"})
    except Exception as ex:
        return agent.format_exception(ex, code)
    return None


class SystemPromptTest(unittest.TestCase):
    def test_contract(self):
        prompt = agent.build_system_prompt("en", True)
        for needle in ("```python", "print()", "bpy.data", "WITHOUT", "Specular IOR Level",
                       "Emission Color", "view_layer.update()", "BLENDER_EEVEE_NEXT",
                       "temp_override", "subprocess", "English", "automatically"):
            self.assertIn(needle, prompt)

    def test_lang_and_manual_run(self):
        prompt = agent.build_system_prompt("es", False)
        self.assertIn("Spanish", prompt)
        self.assertIn("reviews", prompt)
        self.assertNotIn("automatically", prompt)


class IsFinalTest(unittest.TestCase):
    def test_code_block_is_not_final(self):
        self.assertFalse(agent.is_final("Doing it:\n```python\nprint(1)\n```\n"))
        self.assertFalse(agent.is_final("```\nprint(1)\n```"))
        self.assertFalse(agent.is_final("```py\nx = 1\n```"))

    def test_plain_text_is_final(self):
        self.assertTrue(agent.is_final("Done. I added a red cube."))
        self.assertTrue(agent.is_final(""))
        self.assertTrue(agent.is_final("Use `bpy.data` inline only."))

    def test_other_language_block_is_final(self):
        self.assertTrue(agent.is_final("Run this:\n```bash\nls\n```"))


class TracebackTest(unittest.TestCase):
    def test_name_error_trimmed(self):
        err = _raise("x = 1\ny = undefined_name + x\n")
        self.assertIn('File "<zinarix_ai>", line 2', err)
        self.assertIn("y = undefined_name + x", err)
        self.assertIn("NameError", err)
        # Frames of this test file / the exec caller are dropped.
        self.assertNotIn("test_agent.py", err)

    def test_nested_function_frames(self):
        err = _raise("def f():\n    return 1 / 0\nf()\n")
        self.assertIn("line 3, in <module>", err)
        self.assertIn("line 2, in f", err)
        self.assertIn("ZeroDivisionError", err)

    def test_syntax_error(self):
        err = _raise("x = (1,\nprint(x\n")
        self.assertIn("SyntaxError", err)
        self.assertIn("<zinarix_ai>", err)
        self.assertNotIn("Traceback", err)


class TruncateTest(unittest.TestCase):
    def test_short_unchanged(self):
        self.assertEqual(agent.truncate_tail("abc", 10), "abc")
        self.assertEqual(agent.truncate_tail(None, 10), "")

    def test_keeps_tail(self):
        text = "".join("line {:d}\n".format(i) for i in range(2000))
        out = agent.truncate_tail(text, 500)
        self.assertTrue(out.startswith("[..."))
        self.assertIn("line 1999", out)
        self.assertNotIn("line 0\n", out)
        self.assertLess(len(out), 600)


class FeedbackTest(unittest.TestCase):
    def test_success_en(self):
        msg = agent.feedback_message({"ok": True, "output": "Cube created\n", "error": None}, "en")
        self.assertIn("ran successfully", msg)
        self.assertIn("Cube created", msg)
        self.assertIn("without a code block", msg)

    def test_success_no_output_es(self):
        msg = agent.feedback_message({"ok": True, "output": "", "error": None}, "es")
        self.assertIn("correctamente", msg)
        self.assertIn("print()", msg)

    def test_error_es(self):
        msg = agent.feedback_message(
            {"ok": False, "output": "before\n", "error": "NameError: name 'x' is not defined"}, "es")
        self.assertIn("falló", msg)
        self.assertIn("before", msg)
        self.assertIn("NameError", msg)
        self.assertIn("Corrige", msg)

    def test_error_en(self):
        msg = agent.feedback_message({"ok": False, "output": "", "error": "Boom"}, "en")
        self.assertIn("failed", msg)
        self.assertIn("Boom", msg)
        self.assertNotIn("Output before", msg)


class ContractTest(unittest.TestCase):
    def test_constants_and_callables(self):
        self.assertEqual(agent.MAX_STEPS, 8)
        for name in ("describe_scene", "run_code", "capture_viewport"):
            self.assertTrue(callable(getattr(agent, name)))
        # No bpy outside Blender: capture_viewport fails gracefully.
        self.assertFalse(agent.capture_viewport(os.devnull))


if __name__ == "__main__":
    unittest.main()

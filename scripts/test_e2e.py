"""e2e.py의 정리(finish, cleanup)만 시험한다. Claude Code를 띄우지 않는다.

    python3 -I scripts/test_e2e.py
"""
import importlib.util
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("e2e", os.path.join(HERE, "e2e.py"))
e2e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e2e)


class FinishTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = self.tmp.name
        self.home = os.path.join(base, "home")
        e2e.ROOT = os.path.join(base, "repo")  # .superpowers가 없는 새 저장소
        e2e.WORK = os.path.join(base, "work")
        e2e.STORES = os.path.join(self.home, ".claude", "plugins", "store", "detour_*.json")
        e2e.SESSION_ENV = os.path.join(self.home, ".claude", "session-env")
        os.makedirs(e2e.ROOT)
        os.makedirs(e2e.WORK)
        self.project = os.path.join(self.home, ".claude", "projects", "-work")
        os.makedirs(self.project)
        with open(os.path.join(self.project, "S1.jsonl"), "w") as f:
            f.write("{}\n")
        os.makedirs(os.path.join(e2e.SESSION_ENV, "S1"))
        os.makedirs(os.path.dirname(e2e.STORES))
        self.store = os.path.join(os.path.dirname(e2e.STORES), "detour_inline-x.json")
        with open(self.store, "w") as f:
            json.dump({"rec:S1": {"id": "S1"}, "rec:OTHER": {"id": "OTHER"}, "settings": 1}, f)

    def tearDown(self):
        self.tmp.cleanup()

    def test_finish_cleans_up_even_without_superpowers_folder(self):
        e2e.finish(self.project, os.path.join(e2e.WORK, "debug.txt"), "screen", failure="boom")
        self.assertFalse(os.path.exists(self.project))
        self.assertFalse(os.path.exists(e2e.WORK))
        self.assertFalse(os.path.exists(os.path.join(e2e.SESSION_ENV, "S1")))
        with open(self.store) as f:
            self.assertEqual(json.load(f), {"rec:OTHER": {"id": "OTHER"}, "settings": 1})
        self.assertTrue(os.path.exists(os.path.join(e2e.ROOT, ".superpowers", "e2e-last-screen.txt")))

    def test_finish_cleans_up_when_keeping_artifacts_fails(self):
        original = e2e.keep_artifacts
        e2e.keep_artifacts = lambda *_: (_ for _ in ()).throw(OSError("disk full"))
        try:
            e2e.finish(self.project, "/nope", "screen", failure="boom")
        finally:
            e2e.keep_artifacts = original
        self.assertFalse(os.path.exists(self.project))


if __name__ == "__main__":
    sys.exit(unittest.main())

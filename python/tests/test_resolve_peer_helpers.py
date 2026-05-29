import importlib.util
import sys
import unittest
from pathlib import Path

RUN_PY = Path(__file__).resolve().parents[1] / "tg_worker" / "run.py"
spec = importlib.util.spec_from_file_location("tg_worker_run", RUN_PY)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules["tg_worker_run"] = mod
spec.loader.exec_module(mod)


class TestResolvePeerHelpers(unittest.TestCase):
    def test_looks_like_e164_phone(self):
        self.assertTrue(mod._looks_like_e164_phone("+14786079026"))
        self.assertFalse(mod._looks_like_e164_phone("14786079026"))
        self.assertFalse(mod._looks_like_e164_phone("@user"))
        self.assertFalse(mod._looks_like_e164_phone(""))

    def test_entity_not_found_error(self):
        self.assertTrue(
            mod._entity_not_found_error(ValueError("Cannot find any entity corresponding to '+1'"))
        )
        self.assertTrue(mod._entity_not_found_error(ValueError("Invalid peer")))
        self.assertFalse(mod._entity_not_found_error(ValueError("Something else")))


if __name__ == "__main__":
    unittest.main()

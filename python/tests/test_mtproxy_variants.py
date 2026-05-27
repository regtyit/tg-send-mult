"""MTProxy transport variant selection (loads tg_worker/run.py; needs Telethon)."""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

_PYTHON_DIR = Path(__file__).resolve().parents[1]


def _load_run_module():
    path = _PYTHON_DIR / "tg_worker" / "run.py"
    name = "tg_worker_run_under_test"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


class TestMtproxyTransportVariants(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._run = _load_run_module()
        from telethon.network.connection.tcpmtproxy import (
            ConnectionTcpMTProxyAbridged,
            ConnectionTcpMTProxyRandomizedIntermediate,
        )

        cls.Abridged = ConnectionTcpMTProxyAbridged
        cls.RandInt = ConnectionTcpMTProxyRandomizedIntermediate

    def test_dd_only_randomized_intermediate(self):
        fn = self._run._mtproxy_transport_variants
        s = "dd" + "00" * 16
        variants = fn(s)
        self.assertEqual(len(variants), 1)
        self.assertIs(variants[0][0], self.RandInt)
        self.assertEqual(variants[0][1], s)

    def test_classic_32_hex_randomized_then_abridged(self):
        fn = self._run._mtproxy_transport_variants
        s = "a1" * 16
        variants = fn(s)
        self.assertEqual(len(variants), 2)
        self.assertIs(variants[0][0], self.RandInt)
        self.assertIs(variants[1][0], self.Abridged)
        self.assertEqual(variants[0][1], s)
        self.assertEqual(variants[1][1], s)

    def test_ee_length_32_uses_classic_branch_not_fake_tls(self):
        fn = self._run._mtproxy_transport_variants
        s = "ee" + ("0a" * 15)
        self.assertEqual(len(s), 32)
        self.assertTrue(s.startswith("ee"))
        variants = fn(s)
        self.assertEqual(len(variants), 2)
        self.assertIs(variants[0][0], self.RandInt)

    def test_invalid_raises(self):
        fn = self._run._mtproxy_transport_variants
        with self.assertRaises(ValueError):
            fn("deadbeef")

    def test_fake_tls_ee_long(self):
        fn = self._run._mtproxy_transport_variants
        s = "ee" + "aa" * 20
        self.assertGreater(len(s), 32)
        try:
            variants = fn(s)
        except ValueError as e:
            self.assertIn("Fake-TLS", str(e))
            return
        self.assertEqual(len(variants), 1)
        self.assertIn("FakeTLS", variants[0][0].__name__)


if __name__ == "__main__":
    unittest.main()

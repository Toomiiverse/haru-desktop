"""Startup must consume both lazy warm-up passes before reporting readiness."""
import asyncio
import importlib.util
from pathlib import Path
import unittest
import faulthandler


def server():
    path = Path(__file__).resolve().parents[1] / "electron/asr-server.py"
    spec = importlib.util.spec_from_file_location("haru_asr_startup_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StartupTests(unittest.TestCase):
    def test_vad_and_decoder_are_consumed_before_ready(self):
        module = server()
        calls, consumed = [], []

        class Engine:
            def transcribe(self, samples, **kwargs):
                self_outer.assertEqual(samples.shape, (16000,))
                self_outer.assertFalse(samples.any(), "warm-up must not use microphone data")
                calls.append(kwargs)

                def segments():
                    consumed.append(kwargs["vad_filter"])
                    yield type("Segment", (), {"text": "discarded diagnostic output"})()

                return segments(), object()

        self_outer = self
        module.model = Engine()
        self.assertFalse(module.health()["ok"])

        async def run():
            async with module.lifespan(module.app):
                self.assertTrue(module.health()["ok"])
                self.assertTrue(module.health()["warmed"])
                self.assertEqual(consumed, [True, False])
                self.assertTrue(all(not c["condition_on_previous_text"] for c in calls))

        asyncio.run(run())

    def test_failed_decoder_warmup_does_not_advertise_ready(self):
        module = server()

        class Engine:
            def transcribe(self, *_args, **_kwargs):
                def segments():
                    raise RuntimeError("decoder unavailable")
                    yield
                return segments(), object()

        module.model = Engine()

        async def run():
            with self.assertRaisesRegex(RuntimeError, "decoder unavailable"):
                async with module.lifespan(module.app):
                    self.fail("startup should not finish")

        asyncio.run(run())
        self.assertFalse(module.health()["ok"])


if __name__ == "__main__":
    faulthandler.dump_traceback_later(15, exit=True)
    unittest.main()

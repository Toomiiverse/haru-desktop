import io
import sys
import unittest
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'electron'))
from voice_affect import RATE, acoustic_features, decode


def wav(samples, rate=RATE):
    out = io.BytesIO()
    with wave.open(out, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())
    return out.getvalue()


class AcousticTests(unittest.TestCase):
    def test_silence_and_short_speech_are_not_emotional_evidence(self):
        samples = np.zeros(RATE)
        features, quality, _ = acoustic_features(samples, [])
        self.assertEqual(quality, 'unusable')
        self.assertIsNone(features['pitchMedianHz'])
        _, quality, _ = acoustic_features(np.ones(RATE) * .1, [{'start': 0, 'end': 3000}])
        self.assertEqual(quality, 'unusable')

    def test_pitch_and_pace_are_measured_separately_from_emotion(self):
        samples = .15 * np.sin(2 * np.pi * 200 * np.arange(2 * RATE) / RATE)
        f, quality, _ = acoustic_features(samples, [{'start': 0, 'end': len(samples)}], 6)
        self.assertEqual(quality, 'usable')
        self.assertAlmostEqual(f['pitchMedianHz'], 200, delta=4)
        self.assertEqual(f['wordsPerSecond'], 3)
        self.assertLess(f['pitchRangeSemitones'], .2)

    def test_clipping_is_marked_limited(self):
        _, quality, issues = acoustic_features(np.ones(RATE), [{'start': 0, 'end': RATE}])
        self.assertEqual(quality, 'limited')
        self.assertIn('clipping', issues)

    def test_decode_resamples_and_rejects_corruption_and_long_uploads(self):
        self.assertAlmostEqual(len(decode(wav(np.zeros(24000), 24000))), RATE, delta=1)
        with self.assertRaises(Exception):
            decode(b'not audio')
        with self.assertRaisesRegex(ValueError, '30 seconds'):
            decode(wav(np.zeros(31 * RATE)))


if __name__ == '__main__':
    unittest.main()

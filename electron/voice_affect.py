"""Local vocal expression evidence. Audio is processed in memory, never retained.

The classifier estimates audible expression, not a person's internal feelings.
Acoustic measurements remain available if the optional model is unavailable.
"""
import io
import math
import os
from pathlib import Path

import av
import numpy as np

RATE = 16000
MAX_SECONDS = 30
MODEL_SECONDS = 12
LABELS = ("angry", "disgusted", "fearful", "happy", "neutral", "other", "sad", "surprised", "unknown")


def decode(raw):
    """Bound decoded length as well as uploaded bytes, including compressed input."""
    chunks, count = [], 0
    with av.open(io.BytesIO(raw)) as container:
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=RATE)
        for frame in container.decode(audio=0):
            for part in resampler.resample(frame):
                samples = part.to_ndarray().reshape(-1)
                count += samples.size
                if count > RATE * MAX_SECONDS:
                    raise ValueError("audio exceeds 30 seconds")
                chunks.append(samples)
        for part in resampler.resample(None):
            chunks.append(part.to_ndarray().reshape(-1))
    samples = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
    if samples.size > RATE * MAX_SECONDS or not np.isfinite(samples).all():
        raise ValueError("invalid audio")
    return samples.astype(np.float32, copy=False)


def acoustic_features(samples, spans, word_count=None):
    duration = len(samples) / RATE
    speech = np.concatenate([samples[s["start"]:s["end"]] for s in spans]) if spans else np.zeros(0)
    seconds = len(speech) / RATE
    rms = float(np.sqrt(np.mean(speech ** 2))) if len(speech) else 0
    db = 20 * math.log10(max(rms, 1e-6))
    pitches = []
    # Autocorrelation on 40 ms voiced frames, every 20 ms; report pitch only
    # for periodic frames. Pitch alone is never converted to an emotion.
    for span in spans:
        for start in range(span["start"], span["end"] - 640, 320):
            frame = samples[start:start + 640].astype(np.float64)
            frame -= frame.mean()
            if np.sqrt(np.mean(frame ** 2)) < 0.003:
                continue
            spectrum = np.fft.rfft(frame * np.hanning(640), n=2048)
            corr = np.fft.irfft(spectrum * spectrum.conj(), n=2048)[:640]
            lo, hi = RATE // 450, RATE // 65
            lag = lo + int(np.argmax(corr[lo:hi]))
            if corr[0] > 0 and corr[lag] / corr[0] > 0.55:
                pitches.append(RATE / lag)
    pitch = float(np.median(pitches)) if len(pitches) >= 5 else None
    spread = float(12 * np.log2(np.percentile(pitches, 90) / np.percentile(pitches, 10))) if pitch else None
    clipping = float(np.mean(np.abs(samples) >= 0.99)) if len(samples) else 0
    issues = []
    if seconds < 0.35 or db < -52:
        issues.append("insufficient_speech")
    elif seconds < 0.8:
        issues.append("short_speech")
    if clipping > 0.02:
        issues.append("clipping")
    if db < -38 and seconds >= 0.35:
        issues.append("low_level")
    quality = "unusable" if "insufficient_speech" in issues else "limited" if issues else "usable"
    return {
        "durationSeconds": round(duration, 3), "speechSeconds": round(seconds, 3),
        "rmsDbfs": round(db, 1), "pitchMedianHz": round(pitch, 1) if pitch else None,
        "pitchRangeSemitones": round(spread, 2) if spread is not None else None,
        "pauseRatio": round(max(0, 1 - seconds / duration), 3) if duration else 1,
        "clippingRatio": round(clipping, 4),
        # Only meaningful if the text describes the whole clip.
        "wordsPerSecond": round(word_count / duration, 2) if word_count and duration >= 1 else None,
    }, quality, issues


class VoiceAffect:
    def __init__(self, model_dir=None):
        self.model_dir = Path(model_dir or os.environ.get("HARU_AFFECT_MODEL", str(Path(__file__).resolve().parent.parent / "models/emotion2vec-plus-base")))
        self.model = None
        self.model_error = None

    def load(self):
        try:
            if not (self.model_dir / "model.pt").is_file():
                raise FileNotFoundError("local model not installed")
            # Never download anything in the live service.
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["MODELSCOPE_OFFLINE"] = "1"
            from funasr import AutoModel
            self.model = AutoModel(model=str(self.model_dir), device="cpu", ncpu=2,
                                   disable_update=True, disable_pbar=True, disable_log=True, log_level="ERROR")
            # Warm both the classifier and Silero before declaring readiness.
            from faster_whisper.vad import get_speech_timestamps
            get_speech_timestamps(np.zeros(RATE, dtype=np.float32))
            self.model.generate(input=np.zeros(RATE, dtype=np.float32), granularity="utterance", extract_embedding=False)
        except Exception as error:
            self.model_error = type(error).__name__ + ": " + str(error)[:200]
            self.model = None

    def analyze(self, raw, word_count=None):
        from faster_whisper.vad import get_speech_timestamps, VadOptions
        samples = decode(raw)
        spans = get_speech_timestamps(samples, vad_options=VadOptions(min_speech_duration_ms=150, min_silence_duration_ms=200)) if len(samples) else []
        features, quality, issues = acoustic_features(samples, spans, word_count)
        scores = {}
        if self.model is not None and quality != "unusable":
            # Concatenate speech, then bound inference cost on long turns.
            speech = np.concatenate([samples[s["start"]:s["end"]] for s in spans])
            speech = speech[-RATE * MODEL_SECONDS:]
            try:
                result = self.model.generate(input=speech, granularity="utterance", extract_embedding=False)[0]
                for label, score in zip(result["labels"], result["scores"]):
                    name = label.split("/")[-1].lower()
                    if name == "<unk>":
                        name = "unknown"
                    if name in LABELS and np.isfinite(score):
                        scores[name] = round(float(score), 5)
            except Exception:
                issues.append("classifier_failed")
        return {"version": 1, "source": "local-audio", "model": "emotion2vec-plus-base" if scores else None,
                "scores": scores, "acoustics": features, "quality": quality, "issues": issues}

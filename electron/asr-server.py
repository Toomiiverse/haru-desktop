"""Speech to text for Haru, on 127.0.0.1:9881.

Runs under the Python that GPT-SoVITS already bundles, because that install
already carries faster-whisper, CTranslate2 and a CUDA torch — the same reason
the voice server lives there. Nothing new is installed to make this work.

The route is OpenAI's `/v1/audio/transcriptions` rather than something bespoke.
That is the shape every local speech server already speaks, so the app's side of
this stays a plain HTTP call and swapping in whisper.cpp, or anything else that
implements the same route, needs no change to the app at all. It is the same
decision the TTS side made for the same reason.

Everything stays on this machine: the audio is decoded in memory, transcribed
locally on the GPU, and never written to disk.
"""
import io
import os
import sys
import time
import asyncio
from contextlib import asynccontextmanager
from threading import Lock

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
import uvicorn

# medium.en, quantised. small.en heard "where are you up to in Chainsaw Man" as
# "Way up to a chance, oh man, hooray" and the reply answered the nonsense, which
# is what sent this back for another look. Measured over 25 labelled clips and
# three synthesised lines on the 1660 Ti, beside the voice server:
#
#   small.en   float16        712 MiB   8.6% WER   6.0x realtime
#   medium.en  float16       1994 MiB   7.9% WER   2.1x realtime
#   medium.en  int8_float16   970 MiB   8.3% WER   7.2x realtime
#
# The last line is the one to take: better than small on every proper noun that
# was being mangled — "Chainsaw Mac" became "Chainsaw Man", "for a custom"
# became "for a customer" — and *faster* than the model it replaces, for 258 MiB
# more. Faster because this card is a Turing GTX: no tensor cores, so fp16 runs
# at fp32 rates and the int8 path is the only one that gains anything. Full
# float16 medium is three times slower for half a point of WER and would leave
# nothing on the card for GPT-SoVITS to peak into.
MODEL = os.environ.get("HARU_ASR_MODEL", "medium.en")
DEVICE = os.environ.get("HARU_ASR_DEVICE", "cuda")
# int8_float16 on the GPU, int8 on a CPU fallback — quantised weights with
# float16 compute, which on this card is both the smallest and the quickest.
COMPUTE = os.environ.get("HARU_ASR_COMPUTE", "int8_float16" if DEVICE == "cuda" else "int8")
PORT = int(os.environ.get("HARU_ASR_PORT", "9881"))
# Under this much speech in a take there was no take. A spoken "no" is 0.3s.
MIN_SPEECH_SECONDS = float(os.environ.get("HARU_ASR_MIN_SPEECH", "0.25"))

model = None
warmed = False
active_device = DEVICE
load_lock = Lock()


def load():
    """Load once, normally during startup before accepting microphone audio."""
    global model, active_device
    with load_lock:
        if model is not None:
            return model
        from faster_whisper import WhisperModel
        print(f"[asr] loading {MODEL} on {DEVICE} ({COMPUTE})", flush=True)
        started = time.time()
        try:
            model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE)
        except Exception as error:
            print(f"[asr] {DEVICE} failed ({error}); falling back to CPU", flush=True)
            model = WhisperModel(MODEL, device="cpu", compute_type="int8")
            active_device = "cpu"
        print(f"[asr] ready in {time.time() - started:.1f}s", flush=True)
    return model


def warmup():
    """Warm both VAD and decoder with generated silence, never microphone data.

    VAD removes silence before decoding, so a second pass with VAD disabled is
    necessary to initialize the GPU decoder. Consume its lazy segment iterator.
    """
    global warmed
    import numpy as np
    started = time.monotonic()
    engine = load()
    silence = np.zeros(16000, dtype=np.float32)
    for vad in (True, False):
        segments, _ = engine.transcribe(silence, language="en", vad_filter=vad,
                                       beam_size=5, condition_on_previous_text=False)
        for _ in segments:
            pass
    warmed = True
    print(f"[asr] startup warm-up finished in {time.monotonic() - started:.2f}s on {active_device}", flush=True)


@asynccontextmanager
async def lifespan(_app):
    # Startup now pays the first-use cost. Do not advertise ready and make the
    # first caller wait for model loading, VAD initialization and CUDA kernels.
    await asyncio.to_thread(warmup)
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": warmed, "model": MODEL, "loaded": model is not None,
            "warmed": warmed, "device": active_device}


@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile = File(...), language: str = Form("en"), prompt: str = Form(""), hotwords: str = Form("")):
    raw = await file.read()
    if not raw:
        return JSONResponse({"error": "empty audio"}, status_code=400)
    try:
        started = time.time()
        segments, info = load().transcribe(
            io.BytesIO(raw),
            language=language or None,
            # Whisper will otherwise cheerfully invent a sentence out of a cough
            # or a fan. The VAD drops silence before it reaches the decoder, which
            # is the single biggest source of nonsense in push-to-talk dictation.
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
            beam_size=5,
            # No default prompt, and this is the reason: primed with a sentence
            # and handed near-silence, Whisper does not return nothing — it
            # carries on writing the prompt. A default of "Haru. A casual spoken
            # message to a desktop companion." came back verbatim as the
            # transcript every time a door closed, and went to her as a message.
            # The spelling it was there to fix is handled by the wake matcher,
            # which expects to be given the name wrong.
            initial_prompt=prompt or None,
            # The names in play, from the app — see vocabulary.ts. Held by the
            # decoder as previous text, which is the prompt by another door, so
            # the floor below and the app's echo check both stand guard.
            hotwords=hotwords.strip() or None,
            condition_on_previous_text=False,
        )
        # Nothing to decode. The VAD has already run by here and the generator
        # has not: a take with less speech in it than a short word is a bumped
        # key or a closing door, and decoding it is exactly when Whisper invents
        # a sentence — or, primed, reads the hotwords back. It is refused before
        # the decoder sees it, which is also faster than the alternative.
        spoken = getattr(info, "duration_after_vad", None)
        if spoken is not None and spoken < MIN_SPEECH_SECONDS:
            print(f"[asr] {len(raw)} bytes -> {spoken:.2f}s of speech after the VAD, nothing said", flush=True)
            return {"text": "", "duration": getattr(info, "duration", None), "seconds": round(time.time() - started, 3)}
        text = " ".join(segment.text.strip() for segment in segments).strip()
        took = time.time() - started
        print(f"[asr] {len(raw)} bytes -> {len(text)} chars in {took:.2f}s", flush=True)
        return {"text": text, "duration": getattr(info, "duration", None), "seconds": round(took, 3)}
    except Exception as error:
        print(f"[asr] failed: {error}", flush=True)
        return JSONResponse({"error": str(error)}, status_code=500)


if __name__ == "__main__":
    print(f"[asr] starting on 127.0.0.1:{PORT}; loading and warming before accepting audio", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")

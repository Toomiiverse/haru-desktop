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

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
import uvicorn

# small.en is the sweet spot for dictation on a desktop: markedly better than
# base at proper nouns and short commands, and still only a few hundred MB, which
# matters because the voice server and the chat model are already on this card.
MODEL = os.environ.get("HARU_ASR_MODEL", "small.en")
DEVICE = os.environ.get("HARU_ASR_DEVICE", "cuda")
# float16 on the GPU, int8 on a CPU fallback — int8 there is several times faster
# and the accuracy difference is not audible in dictation.
COMPUTE = os.environ.get("HARU_ASR_COMPUTE", "float16" if DEVICE == "cuda" else "int8")
PORT = int(os.environ.get("HARU_ASR_PORT", "9881"))

app = FastAPI()
model = None


def load():
    """Loaded once, on the first request rather than at import, so the server is
    listening immediately and a first-run model download cannot look like a hang
    that never finished starting."""
    global model
    if model is None:
        from faster_whisper import WhisperModel
        print(f"[asr] loading {MODEL} on {DEVICE} ({COMPUTE})", flush=True)
        started = time.time()
        try:
            model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE)
        except Exception as error:
            print(f"[asr] {DEVICE} failed ({error}); falling back to CPU", flush=True)
            model = WhisperModel(MODEL, device="cpu", compute_type="int8")
        print(f"[asr] ready in {time.time() - started:.1f}s", flush=True)
    return model


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "loaded": model is not None}


@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile = File(...), language: str = Form("en"), prompt: str = Form("")):
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
            condition_on_previous_text=False,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        took = time.time() - started
        print(f"[asr] {len(raw)} bytes -> {len(text)} chars in {took:.2f}s", flush=True)
        return {"text": text, "duration": getattr(info, "duration", None), "seconds": round(took, 3)}
    except Exception as error:
        print(f"[asr] failed: {error}", flush=True)
        return JSONResponse({"error": str(error)}, status_code=500)


if __name__ == "__main__":
    print(f"[asr] listening on 127.0.0.1:{PORT}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")

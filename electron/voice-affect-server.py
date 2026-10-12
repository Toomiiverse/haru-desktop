"""Loopback-only audio expression service; CPU, bounded work, no recordings."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import os
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uvicorn

from voice_affect import VoiceAffect
from maintenance_gate import gate_state, admit_analysis, active_analysis

engine = VoiceAffect()
executor = ThreadPoolExecutor(max_workers=1)
busy = False
MAX_BYTES = 8 * 1024 * 1024


@asynccontextmanager
async def lifespan(app):
    await asyncio.get_running_loop().run_in_executor(executor, engine.load)
    print("[voice-affect] " + ("emotion model ready on CPU" if engine.model is not None else "acoustics only: " + str(engine.model_error)), flush=True)
    yield
    executor.shutdown(wait=False, cancel_futures=True)


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": True, "model": "emotion2vec-plus-base", "loaded": engine.model is not None,
            "device": "cpu", "busy": busy or active_analysis(), "workerPid": os.getpid(), "modelError": engine.model_error,
            "maintenance": gate_state()}


@app.post("/v1/audio/affect")
async def affect(request: Request):
    global busy
    def draining():
        if gate_state()['draining']:
            return JSONResponse({'error': 'maintenance draining'}, status_code=503,
                                headers={'Retry-After': '2'})
        return None
    blocked = draining()
    if blocked is not None:
        return blocked
    # Raw request streaming avoids multipart UploadFile's temporary disk spool.
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > MAX_BYTES:
            return JSONResponse({"error": "oversized audio"}, status_code=413)
    if not raw or len(raw) > MAX_BYTES:
        return JSONResponse({"error": "empty or oversized audio"}, status_code=413 if raw else 400)
    # Re-check after streaming: a lease may have started during an upload.
    # No await between this admission check and setting busy. The controller
    # confirms the gate through /health before waiting for busy=false.
    blocked = draining()
    if blocked is not None:
        return blocked
    if busy:
        return JSONResponse({"error": "analyzer busy"}, status_code=429)
    admission = admit_analysis()
    if admission is None:
        return JSONResponse({"error": "maintenance draining"}, status_code=503, headers={"Retry-After": "2"})
    busy = True
    started = time.monotonic()
    # Keep the busy flag until inference REALLY finishes, even if the client
    # disconnects or times out. No unbounded inference backlog.
    try:
        word_count = int(request.headers.get("x-haru-word-count", "0"))
        word_count = word_count if 0 < word_count <= 2000 else None
    except ValueError:
        word_count = None
    try:
        future = asyncio.get_running_loop().run_in_executor(executor, engine.analyze, bytes(raw), word_count)
    except BaseException:
        admission.release()
        busy = False
        raise
    def finished(_):
        global busy
        admission.release()
        busy = False
    future.add_done_callback(finished)
    try:
        result = await asyncio.shield(future)
        result["analysisMs"] = round((time.monotonic() - started) * 1000)
        return result
    except ValueError as error:
        return JSONResponse({"error": str(error)}, status_code=400)
    except Exception:
        return JSONResponse({"error": "audio could not be analyzed"}, status_code=422)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("HARU_AFFECT_PORT", "9882")), log_level="warning")

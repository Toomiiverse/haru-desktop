# Local voice awareness

Haru's voice loop now carries acoustic evidence into the current conversation and records the delivery of generated replies. It uses the existing Whisper recognition, local chat model, call/VAD pipeline, and Breeze voice. This is a local implementation of the listen/respond/reflect pattern, not a replacement implementation of Hume's proprietary models.

## Behavior

- Microphone audio is transcribed and analyzed concurrently. The local emotion2vec+ base model estimates vocal expression; a separate acoustic pass measures speech duration, pitch variation, recording level, clipping, pauses, and speaking pace when a transcript is available.
- Input evidence is matched to the normalized transcript, including complete fragments joined by the call handler. It is consumed once and expires after 45 seconds. Unrelated text never inherits the preceding voice impression. This is an in-memory bridge for existing clients, not a persistent speaker profile or speaker identification system.
- Strong, unambiguous vocal cues can guide the reply and synthesis. Poor-quality, very short, silent, ambiguous, or unknown recordings do not choose an emotion. Model scores are not calibrated probabilities or proof of someone's feelings. The user's own account overrides an inferred feeling.
- “Your voice sounds annoyed”, “speak softer”, “too fast”, “speak faster”, and similar delivery feedback changes the synthesis direction. Breeze receives acting instructions; supported engines also receive speed changes. “Use your normal voice” clears the adjustment. Adjustments expire after ten minutes rather than changing the character or permanent settings.
- Generated audio is analyzed asynchronously. Each recent delivery records its text, intended direction, actual audio measurements when available, and whether the stream completed or was cut off. A generated or streamed clip is not proof the phone played it. The latest three records reach the local model's evidence-only final reply pass as well as the main prompt.
- Tone feedback is treated as the user's impression of the delivery. Haru can acknowledge that impression, explain her intended delivery, and recognize adjustments without claiming a classifier proves the user wrong or inventing a reason for feeling annoyed.

## Runtime

`electron/voice_affect.py` contains acoustic extraction and local inference. `electron/voice-affect-server.py` serves `GET /health` and `POST /v1/audio/affect` on loopback port 9882. The latter accepts raw audio bytes with the media type in `Content-Type`; optional `X-Haru-Word-Count` enables pace measurement. No transcript is uploaded to this service.

The CPU model is loaded and warmed once at startup. One inference runs at a time; extra requests receive 429. The client allows two brief retries within a 2.5-second deadline. Analysis failure leaves transcription and speech usable. Uploads are capped at 8 MiB and decoded audio at 30 seconds; emotion inference uses at most twelve seconds of detected speech. Outgoing streaming analysis samples at most the first twelve seconds of PCM and adds no wait to audio delivery. Recordings and embeddings are never retained by the analyzer; raw request streaming avoids multipart disk spooling.

The service uses the existing `gpt-sovits` Python environment, including FunASR, NumPy, PyAV, FastAPI, faster-whisper's Silero VAD, and PyTorch. It runs on CPU with two threads, leaving the speech GPU available. No cloud emotion API or new paid account is needed. Existing chat-provider behavior is unchanged; audio evidence becomes part of the normal chat context.

Install the pinned model with `scripts/install-voice-affect-model.py` using that environment. The revision is `b318240bfe67db81a8c572ecb37ce9c3759b81c9` of [emotion2vec/emotion2vec_plus_base](https://huggingface.co/emotion2vec/emotion2vec_plus_base). The [authors' repository](https://github.com/ddlBoJack/emotion2vec) describes the model; Hume's [EVI documentation](https://dev.hume.ai/docs/speech-to-speech-evi/overview) describes the conversational pattern this feature follows.

`scripts/haru-voice-affect.service` is the user-service template for this installation. The live service loads local files with update checks disabled. `HARU_AFFECT_ENDPOINT` may select another loopback endpoint. `HARU_VOICE_AFFECT=0` disables acoustic requests while leaving delivery feedback and intended-tone records available. To disable the analyzer service, use `systemctl --user disable --now haru-voice-affect.service`.

## Validation and limits

The automated checks cover evidence validation, silence, short speech, clipping, pitch measurement, bounded decoding, utterance matching, stale input, user corrections, tone feedback, expired adjustments, self-audio evidence, streaming cancellation, and unavailable services, plus existing synthesis/call/EVI/final-reply regressions.

Live checks used the model's supplied speech sample and two synthetic Breeze replies in Haru's configured voice. The test compared normal delivery with a softer/slower direction, analyzed the actual returned audio, and exercised the real local model's final reply pass. No test messages were added to the user's conversation or memory. This establishes integration and behavior, not accuracy on the user's microphone. Sarcasm, mixed feelings, accents, background noise, and device playback can still be misread. The engine preserves that uncertainty instead of treating an inferred emotion as a remembered fact.

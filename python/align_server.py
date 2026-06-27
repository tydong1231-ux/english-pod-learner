"""
WhisperX Transcription Server
Provides full transcription with word-level timestamps and speaker diarization.

Usage:
    pip install whisperx flask flask-cors
    python align_server.py

The server runs on http://localhost:8765

For speaker diarization, you need a HuggingFace token with access to:
- pyannote/speaker-diarization-3.1
- pyannote/segmentation-3.0
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import whisperx
import tempfile
import os
import json
import torch
import gc
import threading
import traceback

# Load .env file from project root
try:
    from dotenv import load_dotenv
    # Look for .env in parent directory (project root)
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    if os.path.exists(env_path):
        load_dotenv(env_path)
        print(f"[ENV] Loaded .env from {env_path}")
    else:
        print(f"[ENV] No .env found at {env_path}")
except ImportError:
    print("[ENV] python-dotenv not installed, using system env only")

# PyTorch 2.6+ compatibility: patch torch.load to ALWAYS use weights_only=False
# This is needed because whisperx/pyannote models contain complex configs
# that aren't in PyTorch's safe globals list
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    # ALWAYS force weights_only=False for model loading (these are trusted HuggingFace models)
    kwargs['weights_only'] = False
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load
print("[PyTorch] Patched torch.load to force weights_only=False")

# App Config
app = Flask(__name__)
# CORS: Allow local and remote access
CORS(app, origins=[
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://podcast.botly.cn",
    "https://api.botly.cn"
])

# Configuration
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
COMPUTE_TYPE = "float16" if DEVICE == "cuda" else "int8"
BATCH_SIZE = 48 if DEVICE == "cuda" else 8  # 48 optimal for 16GB VRAM + small model

# Enable TF32 for better performance on Ampere+ GPUs (RTX 30xx/40xx/50xx)
# This also silences the Pyannote ReproducibilityWarning
# if DEVICE == "cuda":
#     torch.backends.cuda.matmul.allow_tf32 = True
#     torch.backends.cudnn.allow_tf32 = True
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")  # Options: tiny, base, small, medium, large-v2, large-v3

# HuggingFace token for speaker diarization (optional)
# Get token from: https://huggingface.co/settings/tokens
# Accept terms for: pyannote/speaker-diarization-3.1 and pyannote/segmentation-3.0
HF_TOKEN = os.environ.get("HF_TOKEN", None)

print(f"===================================================")
print(f"[WhisperX] Initializing Engine...")
print(f"[WhisperX] Detected System Device: {DEVICE.upper()}", flush=True)
if torch.cuda.is_available():
    print("[Debug] Calling get_device_name...", flush=True)
    try:
        print(f"[WhisperX] GPU Name: {torch.cuda.get_device_name(0)}", flush=True)
    except Exception as e:
        print(f"[Debug] get_device_name failed: {e}", flush=True)
    
    print("[Debug] Calling cuda.version...", flush=True)
    print(f"[WhisperX] CUDA Version: {torch.version.cuda}", flush=True)
else:
    print(f"[WhisperX] WARNING: Running on CPU. This will be slow.", flush=True)
    print(f"[WhisperX] If you have a GPU, ensure PyTorch with CUDA support is installed.", flush=True)
print(f"[WhisperX] Compute Type: {COMPUTE_TYPE}", flush=True)
print(f"===================================================")

whisper_model = None
align_model = None
align_metadata = None
diarize_model = None
model_load_error = None
models_loading = False
model_lock = threading.Lock()


def load_models_if_needed():
    """Load WhisperX models lazily so the HTTP service can start even offline."""
    global whisper_model, align_model, align_metadata, diarize_model
    global model_load_error, models_loading

    if whisper_model is not None and align_model is not None:
        return True

    with model_lock:
        if whisper_model is not None and align_model is not None:
            return True

        models_loading = True
        model_load_error = None

        try:
            print(f"[WhisperX] Loading Whisper model '{WHISPER_MODEL}'...", flush=True)
            whisper_model = whisperx.load_model(
                WHISPER_MODEL,
                DEVICE,
                compute_type=COMPUTE_TYPE
            )
            print("[WhisperX] Whisper model loaded!", flush=True)

            print("[WhisperX] Loading alignment model...", flush=True)
            align_model, align_metadata = whisperx.load_align_model(
                language_code="en",
                device=DEVICE
            )
            print("[WhisperX] Alignment model loaded!", flush=True)

            if HF_TOKEN:
                try:
                    print("[WhisperX] Loading speaker diarization model...", flush=True)
                    from pyannote.audio import Pipeline
                    diarize_model = Pipeline.from_pretrained(
                        "pyannote/speaker-diarization-3.1",
                    )
                    if DEVICE == "cuda":
                        diarize_model.to(torch.device("cuda"))
                    print("[WhisperX] Speaker diarization model loaded!", flush=True)
                except Exception as diarize_error:
                    diarize_model = None
                    print(f"[WhisperX] Speaker diarization not available: {diarize_error}", flush=True)
            else:
                print("[WhisperX] No HF_TOKEN set, speaker diarization disabled", flush=True)

            return True
        except Exception as error:
            whisper_model = None
            align_model = None
            align_metadata = None
            diarize_model = None
            model_load_error = str(error)
            print(f"[WhisperX] Model loading failed: {error}", flush=True)
            traceback.print_exc()
            return False
        finally:
            models_loading = False


def model_status():
    return {
        "loaded": whisper_model is not None and align_model is not None,
        "loading": models_loading,
        "error": model_load_error,
        "diarization": diarize_model is not None
    }


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "ok",
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "model": WHISPER_MODEL,
        "models": model_status()
    })


@app.route('/transcribe', methods=['POST'])
def transcribe():
    """
    Full transcription with word-level timestamps and optional speaker diarization.
    
    Expects multipart form data:
    - audio: The audio file
    
    Returns:
    - Segments with word-level timestamps and speakers
    """
    try:
        if not load_models_if_needed():
            return jsonify({
                "success": False,
                "error": (
                    "Local WhisperX models are not available. "
                    "The app can still use Gemini fallback. "
                    f"Details: {model_load_error}"
                )
            }), 503

        # Get audio file
        if 'audio' not in request.files:
            return jsonify({"error": "No audio file provided"}), 400
        
        audio_file = request.files['audio']
        
        # Save audio to temp file
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
            audio_file.save(tmp.name)
            audio_path = tmp.name
        
        try:
            print(f"[WhisperX] Loading audio: {audio_path}")
            audio = whisperx.load_audio(audio_path)
            
            # Step 1: Transcribe
            print("[WhisperX] Transcribing...")
            result = whisper_model.transcribe(audio, batch_size=BATCH_SIZE)
            print(f"[WhisperX] Transcription complete: {len(result['segments'])} segments")
            
            # Step 2: Align for word-level timestamps
            print("[WhisperX] Aligning for word-level timestamps...")
            result = whisperx.align(
                result["segments"],
                align_model,
                align_metadata,
                audio,
                DEVICE,
                return_char_alignments=False
            )
            print(f"[WhisperX] Alignment complete: {len(result['segments'])} segments")
            
            # Step 3: Speaker diarization (if available)
            if diarize_model:
                print("[WhisperX] Running speaker diarization...")
                diarize_segments = diarize_model(audio_path)
                result = whisperx.assign_word_speakers(diarize_segments, result)
                print("[WhisperX] Speaker diarization complete")
            
            # Format response
            segments = []
            for seg in result.get("segments", []):
                formatted_seg = {
                    "start": round(seg.get("start", 0), 2),
                    "end": round(seg.get("end", 0), 2),
                    "text": seg.get("text", "").strip(),
                    "speaker": seg.get("speaker", None),
                    "words": []
                }
                
                # Add word-level timestamps
                for word in seg.get("words", []):
                    if "start" in word and "end" in word:
                        formatted_seg["words"].append({
                            "word": word.get("word", "").strip(),
                            "start": round(word.get("start", 0), 2),
                            "end": round(word.get("end", 0), 2)
                        })
                
                if formatted_seg["text"]:  # Only add non-empty segments
                    segments.append(formatted_seg)
            
            # Merge consecutive segments from the same speaker into paragraphs
            if diarize_model and len(segments) > 0:
                print("[WhisperX] Merging consecutive speaker segments...")
                merged = []
                current = segments[0].copy()
                
                for seg in segments[1:]:
                    # If same speaker, merge into current paragraph
                    if seg["speaker"] == current["speaker"]:
                        current["end"] = seg["end"]
                        current["text"] = current["text"] + " " + seg["text"]
                        current["words"].extend(seg["words"])
                    else:
                        # Different speaker, save current and start new
                        merged.append(current)
                        current = seg.copy()
                
                # Don't forget the last segment
                merged.append(current)
                segments = merged
                print(f"[WhisperX] Merged into {len(segments)} speaker paragraphs")
            
            print(f"[WhisperX] Returning {len(segments)} segments")
            
            # Cleanup memory
            gc.collect()
            if DEVICE == "cuda":
                torch.cuda.empty_cache()
            
            return jsonify({
                "success": True,
                "segments": segments
            })
            
        finally:
            # Cleanup temp file
            os.unlink(audio_path)
            
    except Exception as e:
        print(f"[WhisperX] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/align', methods=['POST'])
def align():
    """
    Align audio with existing transcript (legacy endpoint).
    """
    try:
        if not load_models_if_needed():
            return jsonify({
                "success": False,
                "error": (
                    "Local WhisperX models are not available. "
                    f"Details: {model_load_error}"
                )
            }), 503

        if 'audio' not in request.files:
            return jsonify({"error": "No audio file provided"}), 400
        
        audio_file = request.files['audio']
        transcript_json = request.form.get('transcript')
        
        if not transcript_json:
            return jsonify({"error": "No transcript provided"}), 400
        
        transcript = json.loads(transcript_json)
        segments = transcript.get('segments', [])
        
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
            audio_file.save(tmp.name)
            audio_path = tmp.name
        
        try:
            audio = whisperx.load_audio(audio_path)
            
            whisperx_segments = [{
                "start": seg.get("start", 0),
                "end": seg.get("end", 0),
                "text": seg.get("text", ""),
                "speaker": seg.get("speaker", None)
            } for seg in segments]
            
            result = whisperx.align(
                whisperx_segments,
                align_model,
                align_metadata,
                audio,
                DEVICE,
                return_char_alignments=False
            )
            
            response_segments = []
            for seg in result.get("segments", []):
                formatted_seg = {
                    "start": round(seg.get("start", 0), 2),
                    "end": round(seg.get("end", 0), 2),
                    "text": seg.get("text", "").strip(),
                    "speaker": seg.get("speaker", None),
                    "words": [{
                        "word": w.get("word", "").strip(),
                        "start": round(w.get("start", 0), 2),
                        "end": round(w.get("end", 0), 2)
                    } for w in seg.get("words", []) if "start" in w and "end" in w]
                }
                if formatted_seg["text"]:
                    response_segments.append(formatted_seg)
            
            return jsonify({"success": True, "segments": response_segments})
            
        finally:
            os.unlink(audio_path)
            
    except Exception as e:
        print(f"[WhisperX] Error: {str(e)}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    print("[WhisperX] Starting server on http://localhost:8765")
    print("[WhisperX] Endpoints:")
    print("  GET  /health     - Check server status")
    print("  POST /transcribe - Full transcription with word timestamps")
    print("  POST /align      - Align existing transcript (legacy)")
    app.run(host='0.0.0.0', port=8765, debug=False)

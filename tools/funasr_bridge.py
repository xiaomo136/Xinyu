import os
import re
import base64
import tempfile
import traceback
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from funasr import AutoModel
import uvicorn

MODEL_NAME = os.getenv("FUNASR_MODEL", "iic/SenseVoiceSmall")
DEVICE = os.getenv("FUNASR_DEVICE", "cpu")
HOST = os.getenv("FUNASR_HOST", "127.0.0.1")
PORT = int(os.getenv("FUNASR_PORT", "8778"))
TARGET_SAMPLE_RATE = int(os.getenv("FUNASR_SAMPLE_RATE", "16000"))

app = FastAPI(title="Xinyu FunASR Bridge")
model = AutoModel(model=MODEL_NAME, device=DEVICE, disable_update=True)


class RecognizeRequest(BaseModel):
    audioBase64: str
    sampleRate: int = TARGET_SAMPLE_RATE
    mimeType: str = "audio/wav"


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_NAME,
        "device": DEVICE,
        "port": PORT,
        "sample_rate": TARGET_SAMPLE_RATE,
    }


@app.post("/recognize")
async def recognize(payload: RecognizeRequest):
    temp_path = None
    try:
        audio_bytes = base64.b64decode(payload.audioBase64)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
            temp_file.write(audio_bytes)
            temp_path = temp_file.name
        result = model.generate(input=temp_path, cache={}, language="auto")
        text = result[0].get("text", "") if result else ""
        text = clean_text(text)
        return {"text": text}
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


def clean_text(text: str) -> str:
    return re.sub(r"<\|.*?\|>", "", text).strip()


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)

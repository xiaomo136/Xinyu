import base64
import requests

with open('data/tts/asr-test.wav', 'rb') as f:
    audio_base64 = base64.b64encode(f.read()).decode('utf-8')

resp = requests.post(
    'http://127.0.0.1:8778/recognize',
    json={
        'audioBase64': audio_base64,
        'sampleRate': 16000,
        'mimeType': 'audio/wav'
    },
    timeout=120,
)
print(resp.status_code)
print(resp.text)

import argparse
import os
import time
import pyttsx3


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text")
    parser.add_argument("--text-file")
    parser.add_argument("--output", required=True)
    parser.add_argument("--voice-hint", default="Chinese")
    parser.add_argument("--rate", type=int, default=150)
    parser.add_argument("--volume", type=float, default=1.0)
    args = parser.parse_args()
    text = resolve_text(args)

    engine = pyttsx3.init()
    try:
        voice_id = pick_voice(engine, args.voice_hint)
        if voice_id:
            engine.setProperty("voice", voice_id)
        engine.setProperty("rate", args.rate)
        engine.setProperty("volume", args.volume)
        engine.save_to_file(text, args.output)
        engine.runAndWait()
        wait_for_audio_file(args.output)
    finally:
        engine.stop()


def resolve_text(args: argparse.Namespace) -> str:
    if args.text_file:
        with open(args.text_file, "r", encoding="utf-8") as file:
            return file.read()
    if args.text:
        return args.text
    raise ValueError("Either --text or --text-file must be provided")


def pick_voice(engine: pyttsx3.Engine, voice_hint: str) -> str | None:
    hint = (voice_hint or "").lower()
    for voice in engine.getProperty("voices"):
        name = getattr(voice, "name", "") or ""
        voice_id = getattr(voice, "id", "") or ""
        languages = " ".join(str(item) for item in getattr(voice, "languages", []) or [])
        payload = f"{name} {voice_id} {languages}".lower()
        if hint and hint in payload:
            return voice.id
        if any(keyword in payload for keyword in ["zh", "chinese", "huihui", "xiaoxiao"]):
            return voice.id
    return None


def wait_for_audio_file(output_path: str, timeout: float = 8.0) -> None:
    deadline = time.time() + timeout
    last_size = -1
    stable_count = 0

    while time.time() < deadline:
      if os.path.exists(output_path):
        size = os.path.getsize(output_path)
        if size > 1024 and size == last_size:
          stable_count += 1
          if stable_count >= 3:
            return
        else:
          stable_count = 0
        last_size = size
      time.sleep(0.2)

    if not os.path.exists(output_path) or os.path.getsize(output_path) <= 1024:
      raise RuntimeError("windows_tts output file was not fully generated")


if __name__ == "__main__":
    main()

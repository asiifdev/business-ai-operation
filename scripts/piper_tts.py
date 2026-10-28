"""Reads text on stdin, writes a mono 16-bit WAV on stdout, using Piper (OHF-Voice/piper1-gpl).

Run as a separate process by `src/integrations/speech/piper.ts`; Piper is GPL and is never imported into our code.
Usage: python piper_tts.py <voice.onnx> [speaker-id]   (speaker-id only for multi-speaker voices)
"""
import os
import sys
import tempfile
import wave

from piper import PiperVoice, SynthesisConfig
from piper.phonemize_espeak import ESPEAK_DATA_DIR


def main() -> int:
    text = sys.stdin.read().strip()
    if not text:
        return 2
    # espeak-ng mis-reads a data folder that is literally named "espeak-ng-data" (it looks for phontab one level up),
    # so give it the same folder under another name.
    with tempfile.TemporaryDirectory() as tmp:
        link = os.path.join(tmp, "espeak_data")
        os.symlink(str(ESPEAK_DATA_DIR), link)
        voice = PiperVoice.load(sys.argv[1], espeak_data_dir=link)
        out = os.path.join(tmp, "out.wav")
        with wave.open(out, "wb") as wav_file:
            config = SynthesisConfig(speaker_id=int(sys.argv[2])) if len(sys.argv) > 2 else None
            voice.synthesize_wav(text, wav_file, config)
        with open(out, "rb") as f:
            sys.stdout.buffer.write(f.read())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

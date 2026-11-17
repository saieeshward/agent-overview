"""Rebuild the original, quiet chat cues. Python standard library only."""
import math
import struct
import wave
from pathlib import Path

RATE = 22050
SOUNDS = {
    "run": [(523.25, .09), (659.25, .14)],
    "review": [(440, .12), (349.23, .13)],
    "quota": [(329.63, .16), (261.63, .16)],
    "question": [(587.33, .10), (783.99, .16)],
}


def synth(notes):
    samples = []
    for hz, seconds in notes:
        size = round(RATE * seconds)
        for i in range(size):
            t = i / RATE
            envelope = min(1, t / .012) * max(0, 1 - i / size) ** 2
            sample = .14 * envelope * (math.sin(math.tau * hz * t) + .15 * math.sin(math.tau * hz * 2 * t))
            samples.append(round(sample * 32767))
        samples.extend([0] * round(RATE * .025))
    assert max(map(abs, samples)) < 6000
    assert len(samples) / RATE < .5
    return struct.pack(f"<{len(samples)}h", *samples)


def main():
    folder = Path(__file__).resolve().parents[1] / "sounds"
    folder.mkdir(exist_ok=True)
    for name, notes in SOUNDS.items():
        data = synth(notes)
        path = folder / f"{name}.wav"
        with wave.open(str(path), "wb") as out:
            out.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
            out.writeframes(data)
        with wave.open(str(path), "rb") as check:
            assert check.getnchannels() == 1 and check.getsampwidth() == 2
            assert check.readframes(check.getnframes()) == data


if __name__ == "__main__":
    main()

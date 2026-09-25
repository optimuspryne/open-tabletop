#!/usr/bin/env python3
"""Original deterministic tile cues, synthesized for Open Tabletop (CC0).
Offline asset authoring only. Uses Python stdlib and ffmpeg's libvorbis encoder.
No recordings, borrowed samples or runtime dependencies.
"""
import math
import random
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

RATE = 44100
DEST = Path(__file__).resolve().parents[1] / 'public/static_assets/sounds'


def impact(samples, start, amplitude, pitch, rng):
    # Short, inharmonic resonances and a filtered contact transient: a hard tile on felt/wood.
    modes = [(650, .012, .5), (1480, .019, .32), (2940, .009, .19), (4210, .006, .08)]
    phases = [rng.random() * math.tau for _ in modes]
    noise = 0
    offset = int(start * RATE)
    for i in range(int(.15 * RATE)):
        if offset + i >= len(samples):
            break
        t = i / RATE
        noise = .45 * noise + .55 * rng.uniform(-1, 1)
        attack = min(1, t / .0007)
        value = sum(gain * math.sin(math.tau * freq * pitch * t + phase) * math.exp(-t / decay)
                    for (freq, decay, gain), phase in zip(modes, phases))
        value += .6 * noise * math.exp(-t / .004)
        samples[offset + i] += amplitude * attack * value


def generate(kind, variant):
    rng = random.Random(92026 + variant + (100 if kind == 'shuffle' else 0))
    duration = .46 if kind == 'flip' else 1.35
    samples = [0.] * int(RATE * duration)
    if kind == 'flip':
        for start, gain in [(0.015, .42), (.09 + rng.random() * .025, .68), (.16, .16)]:
            impact(samples, start, gain, rng.uniform(.86, 1.15), rng)
    else:
        # Three hand-driven shakes, irregular contacts followed by a few settling tiles.
        for center in [.16, .48, .82]:
            for _ in range(15):
                start = max(.01, rng.gauss(center, .075))
                impact(samples, start, rng.uniform(.10, .28), rng.uniform(.70, 1.40), rng)
        for start in [1.04, 1.13]:
            impact(samples, start, .13, rng.uniform(.9, 1.2), rng)
    peak = max(abs(x) for x in samples)
    scale = .70 / max(1., peak)
    with tempfile.TemporaryDirectory(prefix='ott-tile-sound-') as tmp:
        wav = Path(tmp) / 'cue.wav'
        with wave.open(str(wav), 'wb') as out:
            out.setparams((1, 2, RATE, len(samples), 'NONE', 'not compressed'))
            out.writeframes(b''.join(struct.pack('<h', round(x * scale * 32767)) for x in samples))
        output = DEST / f'tile-{kind}-{variant}.ogg'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(wav), '-c:a', 'libvorbis', '-q:a', '5', str(output)], check=True)
        print(output.name)


if __name__ == '__main__':
    for kind in ['flip', 'shuffle']:
        for variant in range(1, 4):
            generate(kind, variant)

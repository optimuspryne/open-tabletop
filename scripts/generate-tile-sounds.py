#!/usr/bin/env python3
"""Original deterministic tile cues, synthesized for Open Tabletop (CC0).
Offline asset authoring only. Uses Python stdlib and ffmpeg's libvorbis encoder.
No recordings, borrowed samples or runtime dependencies.

By default, author the ceramic pickup/drop/flip/shuffle set under new filenames.
Use --legacy to reproduce the earlier flip/shuffle placeholders separately.
"""
import argparse
import math
import random
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

RATE = 44100
DEST = Path(__file__).resolve().parents[1] / 'public/static_assets/sounds'
VARIANTS = {'pickup': 3, 'drop': 4, 'flip': 3, 'shuffle': 3}
# Center frequency, Q, relative gain for short noise-excited bandpass responses.
# Broad 5–9 kHz texture matches the supplied Mahjong references more closely
# than isolated sine partials. No source recordings are sampled or bundled.
CERAMIC_BANDS = [
    (4300, 2.5, .25), (6000, 4.0, 1.00), (7900, 4.0, .50),
]
CERAMIC_GAIN = .98  # Fixed across cues; quiet handling stays quieter than drops.
CONTACT_EXCITATION_DECAY = .0022
CONTACT_SMOOTHING_PASSES = 2  # Remove the overly bright top end of the synthesized shock.


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


def write_cue(samples, output):
    """Encode mono PCM with headroom; only attenuate if overlapping hits need it."""
    peak = max(abs(x) for x in samples)
    scale = min(1., .78 / max(peak, 1e-9))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ott-tile-sound-') as tmp:
        wav = Path(tmp) / 'cue.wav'
        with wave.open(str(wav), 'wb') as out:
            out.setparams((1, 2, RATE, len(samples), 'NONE', 'not compressed'))
            out.writeframes(b''.join(struct.pack('<h', round(x * scale * 32767)) for x in samples))
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(wav), '-c:a', 'libvorbis', '-q:a', '5', str(output)], check=True)
    print(output.name)


def generate(kind, variant, dest=DEST):
    """Reproduce the original September 2026 flip/shuffle waveform."""
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
    write_cue([x * scale for x in samples], dest / f'tile-{kind}-{variant}.ogg')


def ceramic_contact(samples, start, amplitude, pitch, rng, *, edge=False, damping=1.):
    """A rough ceramic clink from a short shock plus filtered contact noise."""
    bands = []
    for freq, quality, gain in CERAMIC_BANDS:
        omega = math.tau * freq * pitch * rng.uniform(.98, 1.02) / RATE
        alpha = math.sin(omega) / (2 * quality * damping)
        # Constant-peak bandpass biquad: b1=0, b2=-b0.
        bands.append([alpha / (1 + alpha), -2 * math.cos(omega) / (1 + alpha),
                      (1 - alpha) / (1 + alpha), gain * rng.uniform(.85, 1.15), 0., 0.])
    offset = round(start * RATE)
    previous = previous2 = 0.
    smoothing = [[0., 0.] for _ in range(CONTACT_SMOOTHING_PASSES)]
    decay = CONTACT_EXCITATION_DECAY * damping * (.8 if edge else 1.)
    for i in range(min(round(.06 * RATE), len(samples) - offset)):
        t = i / RATE
        excitation = rng.uniform(-1, 1) * math.exp(-t / decay) + (2.2 if i == 1 else 0.)
        value = 0.
        for band in bands:
            b0, a1, a2, gain, y1, y2 = band
            response = b0 * (excitation - previous2) - a1 * y1 - a2 * y2
            band[4], band[5] = response, y1
            value += gain * response
        for history in smoothing:
            filtered = (value + history[0] + history[1]) / 3
            history[1], history[0] = history[0], value
            value = filtered
        previous2, previous = previous, excitation
        attack = 1 - math.exp(-t / .000035)
        samples[offset + i] += CERAMIC_GAIN * amplitude * attack * value


def ceramic_rub(samples, start, duration, amplitude, rng):
    """Very quiet friction during handling, with no sustained hiss after contact."""
    offset = round(start * RATE)
    count = round(duration * RATE)
    filtered = 0.
    for i in range(min(count, len(samples) - offset)):
        filtered = .78 * filtered + .22 * rng.uniform(-1, 1)
        envelope = math.sin(math.pi * i / count) ** 2
        samples[offset + i] += amplitude * filtered * envelope


def ceramic_samples(kind, variant):
    """Deterministic action timing; reuse a tile's voice through its contacts."""
    if kind not in VARIANTS or not 1 <= variant <= VARIANTS[kind]:
        raise ValueError('Unknown ceramic cue or variant')
    rng = random.Random(10122026 + 100 * list(VARIANTS).index(kind) + variant)
    duration = {'pickup': .24, 'drop': .32, 'flip': .44, 'shuffle': 1.32}[kind]
    samples = [0.] * round(RATE * duration)
    pitch = rng.uniform(.95, 1.05)
    if kind == 'pickup':
        ceramic_rub(samples, .003, .045, .055, rng)
        ceramic_contact(samples, .018, .36, pitch, rng, edge=True, damping=.55)
        ceramic_contact(samples, .049, .065, pitch, rng, edge=True, damping=.45)
    elif kind == 'drop':
        ceramic_contact(samples, .006, .93, pitch, rng, damping=.75)
        ceramic_contact(samples, rng.uniform(.075, .110), .24, pitch, rng, edge=True, damping=.7)
        ceramic_rub(samples, .013, .035, .04, rng)
    elif kind == 'flip':
        ceramic_contact(samples, .006, .32, pitch, rng, edge=True)
        ceramic_rub(samples, .009, .05, .045, rng)
        landing = rng.uniform(.078, .105)
        ceramic_contact(samples, landing, .84, pitch, rng, damping=.8)
        ceramic_contact(samples, landing + rng.uniform(.032, .05), .13, pitch, rng, edge=True, damping=.6)
    else:
        # The reference shuffle is a continuous tumble with overlapping contacts,
        # rather than separated box shakes. Keep a small, consistent set of voices.
        voices = [rng.uniform(.91, 1.09) for _ in range(8)]
        ceramic_rub(samples, .01, 1.08, .025, rng)
        start = .012
        while start < 1.04:
            envelope = math.sin(math.pi * start / 1.16) ** .6
            ceramic_contact(samples, start, rng.uniform(.12, .32) * envelope,
                            rng.choice(voices), rng, edge=rng.random() < .75,
                            damping=rng.uniform(.65, 1.))
            start += rng.uniform(.008, .026)
        for start, gain in [(1.06, .12), (1.13, .065)]:
            ceramic_contact(samples, start, gain, rng.choice(voices), rng, edge=True, damping=.65)
    # Remove residual DC and taper both boundaries to prevent edit/codec clicks.
    mean = sum(samples) / len(samples)
    fade = round(.004 * RATE)
    return [(value - mean) * min(1., i / fade, (len(samples) - 1 - i) / fade)
            for i, value in enumerate(samples)]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy', action='store_true', help='Reproduce the earlier flip/shuffle cues')
    parser.add_argument('--output-dir', type=Path, default=DEST)
    args = parser.parse_args()
    if args.legacy:
        for kind in ['flip', 'shuffle']:
            for variant in range(1, 4):
                generate(kind, variant, args.output_dir)
    else:
        for kind, count in VARIANTS.items():
            for variant in range(1, count + 1):
                write_cue(ceramic_samples(kind, variant),
                          args.output_dir / f'ceramic-tile-{kind}-{variant}.ogg')

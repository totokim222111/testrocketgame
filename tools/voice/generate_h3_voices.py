"""Synthesize all dialogue lines for a heroine YAML pack using local ComfyUI MiniMax H3 Dasiwa v4.

Follows the shared ComfyUI queue rules:
- Submits at the ordinary tail of http://127.0.0.1:8188/prompt (never uses front/number).
- Uses unique project prefix testrocket_h3_v4/.
- Persists receipts under .local/voice-h3-v4/jobs/ so interrupted runs can resume.
- Runs UVR-MDX-NET vocal isolation, faster-whisper alignment, female voice check,
  EBU R128 -16 LUFS normalization, and encodes 96 kbps mono 48 kHz MP3 into the
  heroine's audio directory.
"""

from __future__ import annotations

import argparse
from difflib import SequenceMatcher
from functools import lru_cache
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time
import unicodedata
from uuid import uuid4

import numpy as np
import onnxruntime as ort
import requests
from scipy.fft import irfft, rfft
from scipy.signal import resample_poly
from scipy.signal.windows import hann
from scipy.special import softmax
import soundfile as sf
from faster_whisper import WhisperModel

SERVER = "http://127.0.0.1:8188"
MODEL = "DasiwaMinimaxH3_dasiwaHybridV4Turbo_int8.safetensors"
CLIP_MODEL = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"

ROOT = Path(__file__).resolve().parents[2]
VR_GYM_H3 = Path("F:/testgame/my_vr_gym/.local/voice-h3-v4")
UVR_MODEL = VR_GYM_H3 / "production/models/UVR-MDX-NET-Voc_FT.onnx"
ASR_TURBO = VR_GYM_H3 / "production/asr-turbo"
FEMALE_CLS = VR_GYM_H3 / "voice_check/onnx/model_quantized.onnx"
DEFAULT_REF_DIR = VR_GYM_H3 / "production/references"

RATE = 48000

NUMBERS = {
    "1": "일", "2": "이", "3": "삼", "4": "사", "5": "오",
    "15": "십오", "90": "구십", "0": "영", "3.8": "삼점팔",
}


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def parse_dialogue_yaml(path: Path) -> list[dict]:
    """Parse heroine dialogue.yaml without requiring external PyYAML."""
    try:
        import yaml  # type: ignore
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return list(data["lines"])
    except ImportError:
        pass

    lines_out: list[dict] = []
    cur: dict | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("- id:"):
            if cur:
                lines_out.append(cur)
            cur = {"id": stripped.split(":", 1)[1].strip().strip('"').strip("'")}
            continue
        if cur is not None and ":" in stripped and raw.startswith("    "):
            k, v = stripped.split(":", 1)
            k = k.strip()
            v = v.strip()
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            elif re.fullmatch(r"-?\d+(\.\d+)?", v):
                v = float(v) if "." in v else int(v)
            cur[k] = v
    if cur:
        lines_out.append(cur)
    return lines_out


def parse_heroine_profile(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    m = re.search(r"h3ProfileEn:\s*>-?\s*\n((?:\s{4,}.+\n?)+)", text)
    if m:
        return " ".join(line.strip() for line in m.group(1).splitlines() if line.strip())
    return (
        "A 17-year-old heroine in a Korean anime dub. Bright, high and quick with bubbly musical upturns, "
        "an audible grin and a playful competitive edge. Crisp, buoyant animation acting with punchy accents."
    )


def laid_out(rows: list[dict], gap: float = 0.65) -> tuple[list[tuple[float, float]], float]:
    cursor = 0.45
    timings = []
    for row in rows:
        text = str(row["text"])
        syllables = len(re.findall(r"[가-힣a-zA-Z0-9]", text))
        pace = str(row.get("pace", "normal"))
        speed = {"fast": 6.4, "normal": 5.6, "slow": 5.0}.get(pace, 5.6)
        pauses = len(re.findall(r"[.!?…,]\s", text)) * 0.16
        length = max(0.55, syllables / speed + pauses + 0.18)
        timings.append((round(cursor, 2), round(cursor + length, 2)))
        cursor += length + gap
    return timings, cursor


def pack_tracks(rows: list[dict], max_lines: int = 3, gap: float = 0.68, max_dur: float = 13.6):
    pending: list[dict] = []
    for row in rows:
        cand = [*pending, row]
        if pending and (len(cand) > max_lines or laid_out(cand, gap)[1] > max_dur):
            yield pending
            pending = []
        pending.append(row)
    if pending:
        yield pending


def node(kind: str, **kwargs):
    return {"class_type": kind, "inputs": kwargs}


def track_prompt(profile: str, rows: list[dict], intervals: list[tuple[float, float]], retake: bool = False) -> str:
    direction = "Keep the light, bright, and energetic speaking style of the reference actor."
    if retake:
        direction += " Articulate every single Korean syllable clearly and cleanly. Stay completely silent between lines."
    reading = "\n".join(
        f'[{begin:.2f}–{end:.2f}s; {row.get("emotion", "happy")}, {row.get("pace", "normal")} pace] "{row["text"]}"'
        for row, (begin, end) in zip(rows, intervals, strict=True)
    )
    return (
        "integrated_multimodal_description:\n"
        "Static close-up of one young Korean voice actor alone at a close microphone in a soundproof recording booth. "
        "Match the same female speaker, voice placement and youthful delivery of <Audio 1>. "
        "Dry unaccompanied Korean speech recorded on a dedicated voice track. The booth is silent between takes. "
        "There is no music, instrument, backing track, ambience, effect or other speaker. "
        + profile + " " + direction + "\n"
        f"Say the following {len(rows)} Korean lines once each and in order. "
        "Speak only the quoted words verbatim in native Korean. Do not read timing labels, directions, or anything from the reference. "
        "Leave a clear silent pause between separate takes.\n" + reading
    )


def remap(value, ids: dict[str, str]):
    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and value[0] in ids:
        return [ids[value[0]], value[1]]
    return value


def build_single_branch(profile: str, rows: list[dict], intervals: list[tuple[float, float]],
                        duration: float, prefix: str, seed: int, steps: int,
                        reference: str, retake: bool = False) -> dict:
    prompt = track_prompt(profile, rows, intervals, retake)
    frames = math.ceil((max(124, (duration + 0.45) * 24) - 5) / 17) * 17 + 5
    length = min(345, frames)
    conditioning = node(
        "MiniMaxH3ReferenceToVideo",
        clip=["3", 0],
        audio_vae=["4", 0],
        prompt=prompt,
        width=32,
        height=32,
        length=length,
        ref_image_size="match",
        **{"ref_audios.ref_audio_0": ["14", 0]},
    )
    return {
        "1": node("UNETLoader", unet_name=MODEL, weight_dtype="default"),
        "2": node("MiniMaxH3SigmaShift", model=["1", 0], shift_video=12.0, shift_audio=3.0),
        "3": node("CLIPLoader", clip_name=CLIP_MODEL, type="minimax", device="default"),
        "4": node("VAELoader", vae_name=AUDIO_VAE),
        "5": conditioning,
        "6": node("BasicGuider", model=["2", 0], conditioning=["5", 0]),
        "7": node("RandomNoise", noise_seed=seed),
        "8": node("KSamplerSelect", sampler_name="euler"),
        "9": node("BasicScheduler", model=["2", 0], scheduler="simple", steps=steps, denoise=1.0),
        "10": node("SamplerCustomAdvanced", noise=["7", 0], guider=["6", 0], sampler=["8", 0],
                   sigmas=["9", 0], latent_image=["5", 1]),
        "11": node("LTXVSeparateAVLatent", av_latent=["10", 0]),
        "12": node("VAEDecodeAudio", samples=["11", 1], vae=["4", 0]),
        "13": node("SaveAudio", audio=["12", 0], filename_prefix=prefix),
        "14": node("LoadAudio", audio=reference),
    }


def build_batch_graph(heroine: str, profile: str, groups: list[list[dict]], reference: str,
                      job_id: str, steps: int = 8, seed: int = 812345671, retake: bool = False):
    result: dict = {}
    tracks_meta = []
    conditioning = []
    shared = {"1", "2", "3", "4", "8", "9", "14"}
    for i, rows in enumerate(groups):
        gap = 0.85 if retake else 0.68
        intervals, duration = laid_out(rows, gap)
        prefix = f"testrocket_h3_v4/{job_id}_{heroine}_{i:03d}"
        branch = build_single_branch(profile, rows, intervals, duration, prefix,
                                     seed + 313 * i, steps, reference, retake)
        ids = {k: k if k in shared else str(100 + i * 30 + int(k)) for k in branch}
        for k, obj in branch.items():
            if ids[k] not in result:
                result[ids[k]] = {
                    "class_type": obj["class_type"],
                    "inputs": {name: remap(val, ids) for name, val in obj["inputs"].items()},
                }
        conditioning.append((ids["5"], ids["6"]))
        tracks_meta.append({
            "number": i,
            "audio_node": ids["13"],
            "prefix": prefix,
            "rows": rows,
            "timings": intervals,
        })
    if len(groups) > 1:
        value = ["2", 0]
        for i, (cond, _) in enumerate(conditioning):
            gate = str(9000 + i)
            result[gate] = node("ImpactExecutionOrderController", signal=[cond, 0], value=value)
            value = [gate, 1]
        for _, guider in conditioning:
            result[guider]["inputs"]["model"] = value
    return result, tracks_meta


class VoiceSeparator:
    sample_rate = 44100
    fft_size = 7680
    hop = 1024
    frames = 256
    bins = 3072

    def __init__(self):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 3
        opts.inter_op_num_threads = 1
        opts.enable_cpu_mem_arena = False
        self.session = ort.InferenceSession(str(UVR_MODEL), sess_options=opts, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.window = hann(self.fft_size, sym=False).astype(np.float32)
        self.frame_offsets = range(0, self.frames * self.hop, self.hop)
        self.window_energy = np.zeros((self.frames - 1) * self.hop + self.fft_size, dtype=np.float32)
        for offset in self.frame_offsets:
            self.window_energy[offset:offset + self.fft_size] += self.window ** 2

    def _infer(self, stereo):
        trim = self.fft_size // 2
        padded = np.pad(stereo, ((0, 0), (trim, trim)), mode="reflect")
        frames = np.lib.stride_tricks.sliding_window_view(padded, self.fft_size, axis=-1)[:, ::self.hop]
        spectrum = rfft(frames * self.window, axis=-1)[:, :, :self.bins].transpose(0, 2, 1)
        features = np.empty((1, 4, self.bins, self.frames), dtype=np.float32)
        features[0, 0::2] = spectrum.real
        features[0, 1::2] = spectrum.imag
        pred = self.session.run(None, {self.input_name: features})[0]
        comp = pred[0, 0::2] + 1j * pred[0, 1::2]
        recon = irfft(comp.transpose(0, 2, 1), n=self.fft_size, axis=-1) * self.window
        wave = np.zeros_like(padded)
        for frame, offset in enumerate(self.frame_offsets):
            wave[:, offset:offset + self.fft_size] += recon[:, frame]
        return wave[:, trim:-trim] / self.window_energy[trim:-trim]

    def vocals(self, audio, sr):
        if audio.shape[1] == 1:
            audio = np.repeat(audio, 2, axis=1)
        src = resample_poly(audio.T, self.sample_rate, sr, axis=-1).astype(np.float32)
        trim = self.fft_size // 2
        length = self.hop * (self.frames - 1)
        usable = length - 2 * trim
        stride = int(usable * 0.75)
        count = src.shape[1]
        padded = np.pad(src, ((0, 0), (trim, length)))
        vocal = np.zeros((2, count), dtype=np.float32)
        weight = np.zeros(count, dtype=np.float32)
        ramp = np.linspace(0, 1, usable - stride, dtype=np.float32)
        for start in range(0, count, stride):
            stop = min(count, start + usable)
            portion = self._infer(padded[:, start:start + length])[:, trim:trim + stop - start]
            blend = np.ones(stop - start, dtype=np.float32)
            if start:
                edge = min(len(ramp), len(blend))
                blend[:edge] *= ramp[:edge]
            if stop < count:
                blend[-len(ramp):] *= ramp[::-1]
            vocal[:, start:stop] += portion * blend
            weight[start:stop] += blend
            if stop == count:
                break
        vocal = resample_poly(vocal / np.maximum(weight, 1e-5), sr, self.sample_rate, axis=-1)
        return (vocal[:, :len(audio)].T * 1.021).astype(np.float32)


def make_female_classifier():
    if not FEMALE_CLS.exists():
        return lambda _p: 1.0
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 2
    opts.inter_op_num_threads = 1
    sess = ort.InferenceSession(str(FEMALE_CLS), sess_options=opts, providers=["CPUExecutionProvider"])
    in_name = sess.get_inputs()[0].name

    def classify(path: Path) -> float:
        audio, rate = sf.read(path, always_2d=True, dtype="float32")
        mono = resample_poly(audio.mean(axis=1), 16000, rate).astype(np.float32)
        logits = sess.run(None, {in_name: mono[np.newaxis, :]})[0]
        return float(softmax(logits, axis=-1)[0, 1])

    return classify


def normalized(text: str) -> str:
    text = text.lower()
    text = text.replace("쓰리", "삼").replace("투", "이").replace("원", "일")
    for k, v in NUMBERS.items():
        text = text.replace(k, v)
    return re.sub(r"[^가-힣0-9a-z]", "", text)


def match_text(target: str, spoken: str) -> float:
    a, b = normalized(target), normalized(spoken)
    if not a or not b:
        return 0.0
    lit = SequenceMatcher(None, a, b).ratio()
    jamo = SequenceMatcher(None, unicodedata.normalize("NFD", a), unicodedata.normalize("NFD", b)).ratio()
    return max(lit, jamo * 0.96)


def select_spans(rows: list[dict], timings: list[tuple[float, float]], words: list[dict]):
    candidates = []
    for row, (exp_s, exp_e) in zip(rows, timings, strict=True):
        word_count = len(str(row["text"]).split())
        poss = []
        for start in range(len(words)):
            if abs(words[start]["start"] - exp_s) > 5.0:
                continue
            for stop in range(start + 1, min(len(words), start + word_count + 8) + 1):
                phrase = " ".join(w["word"] for w in words[start:stop])
                acc = match_text(str(row["text"]), phrase)
                if acc < 0.72:
                    continue
                b, e = words[start]["start"], words[stop - 1]["end"]
                if e - b > max(3.0, 2.5 * (exp_e - exp_s)):
                    continue
                cost = 0.02 * abs(b - exp_s) + 0.008 * abs(e - exp_e)
                poss.append((start, stop, phrase, acc, 1.0 + acc - cost))
        candidates.append(poss)

    @lru_cache(maxsize=None)
    def best(i: int, cursor: int):
        if i == len(rows):
            return 0.0, ()
        val, picked = best(i + 1, cursor)
        res = (val, (None, *picked))
        for cand in candidates[i]:
            start, stop, _, _, weight = cand
            if start < cursor:
                continue
            v2, p2 = best(i + 1, stop)
            if v2 + weight > res[0]:
                res = (v2 + weight, (cand, *p2))
        return res

    return best(0, 0)[1]


def clip_regions(audio: np.ndarray, rate: int, words: list[dict], start: int, stop: int):
    first, last = words[start]["start"], words[stop - 1]["end"]
    left = max(0.0, first - 0.24, words[start - 1]["end"] + 0.015 if start > 0 else 0.0)
    right = min(len(audio) / rate, last + 0.30, words[stop]["start"] - 0.015 if stop < len(words) else 999.0)
    if right <= left:
        left, right = max(0.0, first), min(len(audio) / rate, last)
    hop = rate // 100
    begin = round(left * rate)
    data = audio[begin:round(right * rate)]
    if len(data) < hop:
        return []
    pad = (-len(data)) % hop
    rms = np.sqrt(np.mean(np.pad(data, (0, pad)).reshape(-1, hop) ** 2, axis=1))
    thresh = max(0.0022, float(np.percentile(rms, 95)) * 0.075)
    selected = np.flatnonzero(rms > thresh)
    if not len(selected):
        return [(left, right)]
    sections = []
    for group in np.split(selected, np.flatnonzero(np.diff(selected) > 35) + 1):
        if group.size >= 4:
            sections.append((left + float(group[0]) * 0.01, min(right, left + (float(group[-1]) + 1) * 0.01)))
    return sections or [(left, right)]


def run_ffmpeg(*args: str) -> str:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", *args],
        capture_output=True, encoding="utf-8", errors="replace", check=True,
    )
    return proc.stderr


def measure_levels(path: Path) -> tuple[float, float]:
    out = run_ffmpeg("-i", str(path), "-af", "apad=whole_dur=0.41,ebur128=peak=true", "-f", "null", "-").split("Summary:")[-1]
    lufs = float(re.search(r"\bI:\s*(-?[\d.]+) LUFS", out).group(1))
    peak = float(re.search(r"\bPeak:\s*(-?[\d.]+) dBFS", out).group(1))
    return lufs, peak


def process_clip(mono: np.ndarray, rate: int, spans: list[tuple[float, float]],
                 max_sec: float, wav_out: Path, mp3_out: Path) -> tuple[float, float, float]:
    gap = np.zeros(round(rate * 0.08), dtype=np.float32)
    parts = []
    for idx, (s, e) in enumerate(spans):
        if idx:
            parts.append(gap)
        a = max(0, round(rate * (s - 0.03)))
        b = min(len(mono), round(rate * (e + 0.045)))
        seg = mono[a:b].copy()
        fade = np.linspace(0, 1, min(round(rate * 0.008), max(1, len(seg) // 2)), dtype=np.float32)
        seg[:len(fade)] *= fade
        seg[-len(fade):] *= fade[::-1]
        parts.append(seg)
    audio = resample_poly(np.concatenate(parts), RATE, rate).astype(np.float32)
    scratch = wav_out.with_suffix(".scratch.wav")
    level_path = wav_out.with_suffix(".level.wav")
    sf.write(scratch, audio, RATE, subtype="FLOAT")
    dur = len(audio) / RATE
    speed = max(1.0, min(1.22, dur / max(1.0, max_sec - 0.05)))
    stretch = f"atempo={speed:.4f}," if speed > 1.01 else ""
    run_ffmpeg("-y", "-i", str(scratch), "-af", stretch + "highpass=f=70", "-c:a", "pcm_f32le", str(level_path))
    lufs, _ = measure_levels(level_path)
    gain = -16.0 - lufs
    peak = -1.0
    for _ in range(3):
        filt = f"volume={gain:.2f}dB,alimiter=limit=0.82:attack=4:release=45:level=false:latency=true"
        run_ffmpeg("-y", "-i", str(level_path), "-af", filt, "-c:a", "pcm_s16le", str(wav_out))
        lufs, peak = measure_levels(wav_out)
        if abs(lufs + 16.0) <= 0.7 and peak <= -0.9:
            break
        gain += -16.0 - lufs
    mp3_out.parent.mkdir(parents=True, exist_ok=True)
    tmp_mp3 = mp3_out.with_suffix(".tmp.mp3")
    run_ffmpeg("-y", "-i", str(wav_out), "-ac", "1", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "96k", str(tmp_mp3))
    tmp_mp3.replace(mp3_out)
    scratch.unlink(missing_ok=True)
    level_path.unlink(missing_ok=True)
    info = sf.info(wav_out)
    return round(info.duration, 2), round(lufs, 2), round(peak, 2)


def upload_reference(session: requests.Session, heroine: str, ref_wav: Path, work_dir: Path) -> str:
    cache = work_dir / f"ref_{heroine}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))["path"]
    with ref_wav.open("rb") as fh:
        resp = session.post(
            f"{SERVER}/upload/image",
            data={"type": "input", "subfolder": "testrocket_h3_v4"},
            files={"image": (f"{uuid4().hex}_{heroine}.wav", fh, "audio/wav")},
            timeout=30,
        )
    resp.raise_for_status()
    item = resp.json()
    path = f'{item["subfolder"]}/{item["name"]}'
    save_json(cache, {"path": path})
    return path


def submit_job(session: requests.Session, heroine: str, profile: str, groups: list[list[dict]],
               reference: str, jobs_dir: Path, steps: int = 8, retake: bool = False) -> dict:
    job_id = str(uuid4())
    seed = int(uuid4().hex[:12], 16)
    prompt, tracks_meta = build_batch_graph(heroine, profile, groups, reference, job_id.replace("-", ""), steps, seed, retake)
    job = {
        "prompt_id": job_id,
        "heroine": heroine,
        "created": time.time(),
        "retake": retake,
        "tracks": tracks_meta,
    }
    save_json(jobs_dir / f"{job_id}.json", job)
    # Ordinary tail submission: omit front and number!
    resp = session.post(f"{SERVER}/prompt", json={"client_id": job_id, "prompt_id": job_id, "prompt": prompt}, timeout=40)
    if not resp.ok:
        job["rejected"] = resp.text
        save_json(jobs_dir / f"{job_id}.json", job)
        resp.raise_for_status()
    print(f"[H3] Submitted job {job_id} ({len(groups)} tracks, {sum(len(g) for g in groups)} lines, retake={retake})", flush=True)
    return job


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--heroine", default="gemhwang")
    parser.add_argument("--ref-wav", type=Path, default=None)
    parser.add_argument("--tracks-per-job", type=int, default=4)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--max-rounds", type=int, default=3)
    args = parser.parse_args()

    heroine_dir = ROOT / "public/content/heroines" / args.heroine
    dialogue_yaml = heroine_dir / "dialogue.yaml"
    heroine_yaml = heroine_dir / "heroine.yaml"
    audio_dir = heroine_dir / "audio"
    ref_wav = args.ref_wav or (DEFAULT_REF_DIR / f"{args.heroine}.wav")
    if not ref_wav.exists():
        raise FileNotFoundError(f"Reference WAV not found: {ref_wav}")

    work_dir = ROOT / ".local/voice-h3-v4" / args.heroine
    jobs_dir = work_dir / "jobs"
    collected_dir = work_dir / "collected"
    jobs_dir.mkdir(parents=True, exist_ok=True)
    collected_dir.mkdir(parents=True, exist_ok=True)

    all_lines = parse_dialogue_yaml(dialogue_yaml)
    profile = parse_heroine_profile(heroine_yaml)
    print(f"[H3] Heroine={args.heroine}, lines={len(all_lines)}, ref={ref_wav}", flush=True)

    session = requests.Session()
    reference = upload_reference(session, args.heroine, ref_wav, work_dir)
    separator = VoiceSeparator()
    asr_model = WhisperModel(str(ASR_TURBO), device="cpu", compute_type="int8", cpu_threads=3)
    female_score_fn = make_female_classifier()

    manifest_path = work_dir / "manifest.json"
    manifest: dict[str, dict] = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}

    def pending_lines() -> list[dict]:
        return [row for row in all_lines if not (audio_dir / str(row["audio"])).exists()]

    def transcribe(path: Path) -> list[dict]:
        segments, _ = asr_model.transcribe(
            str(path), language="ko", beam_size=5, word_timestamps=True,
            condition_on_previous_text=False, no_speech_threshold=None,
        )
        return [
            {"word": w.word.strip(), "start": w.start, "end": w.end}
            for seg in segments for w in (seg.words or ()) if normalized(w.word)
        ]

    def process_finished_job(job: dict) -> bool:
        pid = job["prompt_id"]
        out_dir = collected_dir / pid
        if (out_dir / "checked.json").exists():
            return True
        resp = session.get(f"{SERVER}/history/{pid}", timeout=15)
        resp.raise_for_status()
        history = resp.json().get(pid)
        if not history or history["status"]["status_str"] not in {"success", "error"}:
            return False
        out_dir.mkdir(parents=True, exist_ok=True)
        if history["status"]["status_str"] != "success":
            print(f"[H3] Job {pid} error: {history['status'].get('messages')}", flush=True)
            save_json(out_dir / "checked.json", {"status": "error"})
            return True

        outputs = history["outputs"]
        for track in job["tracks"]:
            stem = f"{job['heroine']}-{track['number']:03d}"
            raw_flac = out_dir / f"{stem}.flac"
            report_path = out_dir / f"{stem}.json"
            if report_path.exists():
                continue
            files = outputs.get(track["audio_node"], {}).get("audio", [])
            if not files:
                save_json(report_path, {"status": "no_audio"})
                continue
            if not raw_flac.exists():
                dl = session.get(f"{SERVER}/view", params=files[0], timeout=35)
                dl.raise_for_status()
                tmp = raw_flac.with_suffix(".part")
                tmp.write_bytes(dl.content)
                tmp.replace(raw_flac)

            voc_flac = out_dir / f"{stem}.vocals.flac"
            if voc_flac.exists():
                vocals, rate = sf.read(voc_flac, dtype="float32", always_2d=True)
            else:
                audio, rate = sf.read(raw_flac, dtype="float32", always_2d=True)
                vocals = separator.vocals(audio, rate)
                sf.write(voc_flac, vocals, rate, format="FLAC", subtype="PCM_24")

            words = transcribe(voc_flac)
            picked = select_spans(track["rows"], track["timings"], words)
            mono = vocals.mean(axis=1)
            records = {}
            accepted_count = 0
            for row, match in zip(track["rows"], picked, strict=True):
                lid = str(row["id"])
                mp3_target = audio_dir / str(row["audio"])
                if mp3_target.exists():
                    records[lid] = {"state": "already_installed"}
                    accepted_count += 1
                    continue
                if match is None:
                    records[lid] = {"state": "retry", "reason": "not_aligned"}
                    continue
                start, stop, recognized, acc, _ = match
                regions = clip_regions(mono, rate, words, start, stop)
                wav_tmp = out_dir / "clips" / f"{lid}.wav"
                wav_tmp.parent.mkdir(parents=True, exist_ok=True)
                try:
                    sec, lufs, peak = process_clip(mono, rate, regions, float(row.get("maxSec", 5.5)) + 0.6, wav_tmp, mp3_target)
                    fscore = female_score_fn(wav_tmp)
                    if fscore < 0.55:
                        mp3_target.unlink(missing_ok=True)
                        records[lid] = {
                            "state": "retry",
                            "reason": f"low_female_score:{fscore:.3f}",
                            "transcript": recognized,
                            "accuracy": round(acc, 3),
                        }
                        continue
                    accepted_count += 1
                    rec = {
                        "state": "accepted",
                        "duration": sec,
                        "lufs": lufs,
                        "peak": peak,
                        "female_score": round(fscore, 3),
                        "transcript": recognized,
                        "accuracy": round(acc, 3),
                        "audio": str(row["audio"]),
                        "prompt_id": pid,
                    }
                    records[lid] = rec
                    manifest[lid] = rec
                    save_json(manifest_path, manifest)
                except Exception as exc:  # noqa: BLE001
                    mp3_target.unlink(missing_ok=True)
                    records[lid] = {"state": "retry", "reason": str(exc), "transcript": recognized}
            save_json(report_path, {"prompt_id": pid, "records": records, "words": words})
            print(f"[H3] Track {stem}: {accepted_count}/{len(track['rows'])} accepted (total {len(manifest)}/{len(all_lines)})", flush=True)
        save_json(out_dir / "checked.json", {"status": "success"})
        return True

    for round_idx in range(1, args.max_rounds + 1):
        # First drain any existing in-flight jobs on disk
        existing_jobs = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(jobs_dir.glob("*.json"))]
        in_flight = [j for j in existing_jobs if not j.get("rejected") and not (collected_dir / j["prompt_id"] / "checked.json").exists()]

        if not in_flight:
            todo = pending_lines()
            if not todo:
                break
            retake = round_idx > 1
            max_lines = 1 if round_idx >= 3 else (2 if retake else 3)
            gap = 0.85 if retake else 0.68
            chunks = list(pack_tracks(todo, max_lines=max_lines, gap=gap))
            print(f"[H3] Round {round_idx}: {len(todo)} remaining lines -> {len(chunks)} tracks", flush=True)
            for off in range(0, len(chunks), args.tracks_per_job):
                job = submit_job(session, args.heroine, profile, chunks[off:off + args.tracks_per_job],
                                 reference, jobs_dir, steps=args.steps, retake=retake)
                in_flight.append(job)

        while in_flight:
            still = []
            for job in in_flight:
                try:
                    done = process_finished_job(job)
                except requests.RequestException as err:
                    print(f"[H3] Poll warning: {err}", flush=True)
                    done = False
                if not done:
                    still.append(job)
            in_flight = still
            if in_flight:
                time.sleep(8)

    missing = pending_lines()
    print(f"[H3] DONE. Installed={len(all_lines) - len(missing)}/{len(all_lines)}, Missing={[r['id'] for r in missing]}", flush=True)
    if missing:
        sys.exit(1)


if __name__ == "__main__":
    main()

"""Trace the launch bay PNGs and measure their rendered SVGs.

Run with the project's vector toolchain Python:
    F:/testgame/my_vr_gym/.local/vector-venv/Scripts/python.exe -B tools/vectorize/trace_backgrounds.py
"""

import json
from pathlib import Path
import xml.etree.ElementTree as ET

import cv2
import numpy as np
from PIL import Image

from mesh import atomic_write, svg_document
from quality import compare, rasterize_svg
from trace import Trace


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / ".local/raw-bg"
OUTPUT = ROOT / "public/content/housings/mk1-column/backgrounds"
SIZE_TARGET = 450_000
SIZE_LIMIT = 600_000
SVG_NS = "{http://www.w3.org/2000/svg}"


def key_cloud_background(image):
    """Estimate a uniform matte from the perimeter and remove it in Lab."""
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2Lab)
    border = np.concatenate((lab[0], lab[-1], lab[:, 0], lab[:, -1]))
    matte = np.median(border, axis=0)
    low = max(2.0, float(np.quantile(np.linalg.norm(border - matte, axis=1), .90)) + 1)
    distance = np.linalg.norm(lab - matte, axis=2)
    alpha = np.clip((distance - low) / 12, 0, 1)
    alpha = alpha**2 * (3 - 2 * alpha)
    matte_rgb = cv2.cvtColor(matte[None, None, :], cv2.COLOR_Lab2RGB)[0, 0]
    # Undo the background contribution at mixed pixels before the RGBA resize.
    foreground = matte_rgb + (rgb - matte_rgb) / np.maximum(alpha[..., None], .01)
    rgba = np.dstack((np.clip(foreground, 0, 1), alpha))
    return Image.fromarray(np.rint(rgba * 255).astype(np.uint8))


def panorama_foreground(image):
    """Separate the island from the sky and sea shared by both wrap edges."""
    rgb = np.asarray(image, dtype=np.float32) / 255
    margin = max(2, image.width // 16)
    profile = np.median(np.concatenate((rgb[:, :margin], rgb[:, -margin:]), axis=1), axis=1)
    profile = np.ascontiguousarray(profile[:, None, :])
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2Lab)
    matte = cv2.cvtColor(profile, cv2.COLOR_RGB2Lab)
    distance = np.linalg.norm(lab - matte, axis=2)
    alpha = np.clip((distance - 2) / 6, 0, 1)
    # The source reserves both margins for uninterrupted sky and sea.
    alpha[:, :margin] = 0
    alpha[:, -margin:] = 0
    _, labels, stats, _ = cv2.connectedComponentsWithStats((alpha >= .5).astype(np.uint8))
    keep = stats[:, cv2.CC_STAT_AREA] >= 12
    keep[0] = False
    alpha *= keep[labels]
    foreground = profile + (rgb - profile) / np.maximum(alpha[..., None], .01)
    rgba = np.dstack((np.clip(foreground, 0, 1), alpha))
    return Image.fromarray(np.rint(rgba * 255).astype(np.uint8)), np.rint(profile[:, 0] * 255).astype(int)


def normalize(image, transparent):
    width = min(1280, image.width)
    size = (width, round(image.height * width / image.width))
    image = image.convert("RGBA" if transparent else "RGB")
    if transparent and image.getchannel("A").getextrema() == (255, 255):
        image = key_cloud_background(image)
    return image.resize(size, Image.Resampling.LANCZOS)


def sky_gradient(profile):
    height = len(profile)
    rows = set(range(0, height, 12)) | {height - 1}
    # Keep individual samples around the sea horizon and any sharp sky bands.
    for row in np.flatnonzero(np.max(np.abs(np.diff(profile, axis=0)), axis=1) >= 4):
        rows.update((row, row + 1))
    stops = [
        f'<stop offset="{(row + .5) / height:.6f}" stop-color="{hex_color(profile[row])}"/>'
        for row in sorted(rows)
    ]
    return "\n".join([
        '<defs><linearGradient id="sky-sea" x2="0%" y2="100%">',
        *stops,
        "</linearGradient></defs>",
    ])


def hex_color(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def zenith_color(image):
    top = np.asarray(image)[:max(1, image.height // 10)]
    return np.rint(np.median(top.reshape(-1, 3), axis=0)).astype(int)


def clean_zenith(image):
    """Collapse near-identical colors in the dark sky without softening stars."""
    rgb = np.array(image)
    zenith = zenith_color(image)
    near_zenith = np.linalg.norm(rgb - zenith, axis=2) <= 6
    rgb[near_zenith] = zenith
    return Image.fromarray(rgb)


def draw_background(regions, image, transparent, profile):
    extent = f'width="{image.width}" height="{image.height}"'
    svg = svg_document(regions, image.size).replace(" viewBox=", f" {extent} viewBox=", 1)
    if transparent:
        return svg
    base = f'<rect {extent} fill="{hex_color(zenith_color(image))}"/>'
    if profile is not None:
        base += f'\n{sky_gradient(profile)}\n<rect {extent} fill="url(#sky-sea)"/>'
    return svg.replace("\n", f"\n{base}\n", 1)


def trace_background(name, *, palette_size, min_color_area, transparent=False, panorama=False):
    with Image.open(RAW / f"{name}.png") as image:
        original_size = image.size
        source = normalize(image, transparent)
    prepared = source
    profile = None
    if panorama:
        prepared, profile = panorama_foreground(source)
    elif not transparent:
        prepared = clean_zenith(source)
    # The stacked tracer covers the alpha-derived silhouette first, then shades it.
    # Adjacent transparent color shapes would otherwise leave antialiasing gaps.
    trace = Trace(prepared, scale=1, palette_size=palette_size, min_color_area=min_color_area,
                  separate_ink=False)
    for tolerance in (.48, .65, .85, 1.15, 1.5, 2):
        svg = draw_background(trace.regions(tolerance), source, transparent, profile)
        encoded = svg.encode("utf-8")
        if len(encoded) <= SIZE_TARGET:
            break
    if len(encoded) > SIZE_LIMIT:
        raise ValueError(f"{name}: SVG exceeds {SIZE_LIMIT:,} bytes")

    root = ET.fromstring(encoded)
    paths = root.findall(f".//{SVG_NS}path")
    if root.tag != f"{SVG_NS}svg" or not paths:
        raise ValueError(f"{name}: no SVG paths")
    rendered = rasterize_svg(svg, source.size)
    pixels = np.asarray(rendered)
    alpha = pixels[..., 3]
    if transparent:
        if not np.all(alpha[:, [0, -1]] == 0) or alpha.max() == 0:
            raise ValueError(f"{name}: expected visible clouds and transparent wrap edges")
    elif alpha.min() != 255:
        raise ValueError(f"{name}: expected full-bleed opacity")

    ssim, delta_e = compare(source, rendered)
    stats = {
        "sourceSize": original_size,
        "traceSize": prepared.size,
        "pathCount": len(paths),
        "svgBytes": len(encoded),
        "ssim": round(ssim, 5),
        "deltaE00": round(delta_e, 3),
        "tolerancePx": tolerance,
    }
    if panorama:
        seam = np.abs(pixels[:, 0, :3].astype(np.int16) - pixels[:, -1, :3])
        if seam.max() > 1:
            raise ValueError(f"{name}: wrap edges have different colors")
        stats["wrapEdgeMeanRgbDifference"] = round(float(seam.mean()), 3)
        stats["wrapEdgeMaxRgbDifference"] = int(seam.max())
    atomic_write(OUTPUT / f"{name}.svg", encoded)
    return stats


def main():
    report = {
        "launch-bay-vista": trace_background("launch-bay-vista", palette_size=32, min_color_area=7, panorama=True),
        "cloud-horizon": trace_background("cloud-horizon", palette_size=9, min_color_area=15, transparent=True),
        "cosmos-dome": trace_background("cosmos-dome", palette_size=13, min_color_area=4),
    }
    summary = json.dumps(report, indent=2) + "\n"
    atomic_write(RAW / "trace-report.json", summary)
    print(summary, end="")


if __name__ == "__main__":
    main()

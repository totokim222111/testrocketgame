"""Shared SVG and little-endian VEC1 exporters."""

from dataclasses import dataclass
from pathlib import Path
import os
import struct

import mapbox_earcut
import numpy as np

FOUNDATION = 5


@dataclass
class Region:
    rings: list
    rgba: tuple
    part: int
    ink: bool = False

    def triangulate(self):
        points = np.concatenate(self.rings).astype(np.float32)
        ring_ends = np.cumsum([len(ring) for ring in self.rings], dtype=np.uint32)
        indices = mapbox_earcut.triangulate_float32(points, ring_ends).reshape(-1, 3)
        return points, indices


def _decimal(value):
    return f"{value:.2f}".rstrip("0").rstrip(".") or "0"


def svg_document(regions, size):
    w, h = size
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" fill-rule="evenodd">']
    for ink in (False, True):
        lines.append('<g id="ink">' if ink else '<g id="color">')
        for region in regions:
            if region.ink != ink:
                continue
            path = "".join(
                "M" + " ".join(f"{_decimal(x)},{_decimal(y)}" for x, y in ring) + "Z"
                for ring in region.rings
            )
            r, g, b, alpha = region.rgba
            opacity = f' fill-opacity="{alpha / 255:.4f}"' if alpha != 255 else ""
            lines.append(f'<path data-part="{region.part}" fill="#{r:02x}{g:02x}{b:02x}"{opacity} d="{path}"/>')
        lines.append("</g>")
    return "\n".join(lines + ["</svg>", ""])


class MeshBuilder:
    def __init__(self, size, normals=False, transparent=False):
        self.width, self.height = size
        self.normals = normals
        self.transparent = transparent
        self.parts = []
        self.elements = []
        self.count = 0

    def add(self, points, indices, rgba, part=0, ink=False, z=0, normals=None):
        if len(indices) == 0:
            return
        xyz = np.column_stack((
            (points[:, 0] - self.width / 2) / self.height,
            0.5 - points[:, 1] / self.height,
            np.broadcast_to(z, len(points)),
        ))
        quantized = np.rint(xyz * 8192)
        if np.abs(quantized).max() > 32767:
            raise ValueError("VEC1 coordinate overflow")
        stride = 16 if self.normals else 12
        data = np.zeros((len(points), stride), dtype=np.uint8)
        data[:, :6] = quantized.astype("<i2").view(np.uint8)
        data[:, 6:10] = rgba
        data[:, 10] = part
        data[:, 11] = int(ink)
        if self.normals:
            data[:, 12:15] = np.rint(np.clip(normals, -1, 1) * 127).astype(np.int8).view(np.uint8)
        self.parts.append(data.tobytes())
        self.elements.append(indices.astype(np.uint32).ravel() + self.count)
        self.count += len(points)

    def encode(self):
        indices = np.concatenate(self.elements)
        wide = self.count > 65536
        flags = int(self.normals) | (int(self.transparent) << 1) | (int(wide) << 2)
        header = struct.pack("<4sIIIf", b"VEC1", self.count, len(indices), flags, self.width / self.height)
        raw = header + b"".join(self.parts) + indices.astype("<u4" if wide else "<u2").tobytes()
        return raw, len(indices) // 3


def flat_mesh(regions, size, transparent=False):
    mesh = MeshBuilder(size, transparent=transparent)
    for region, depth in zip(regions, paint_depths(regions)):
        points, indices = region.triangulate()
        # Earcut is CCW in its input coordinates. The Y flip reverses that.
        mesh.add(points, indices[:, ::-1], region.rgba, region.part, region.ink, z=0 if transparent else depth)
    return mesh.encode()


def paint_depths(regions):
    # Two VEC1 depth steps per palette entry, for surfaces rendered with depth
    # writes. The unlit planar shader projects these back onto a single plane.
    depths = {}
    for region in regions:
        key = (region.part == FOUNDATION, region.ink, region.rgba)
        yield depths.setdefault(key, len(depths) / 4096)


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temp.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))
    temp.replace(path)

"""Measure the rendered SVG in the same coordinate frame as the source."""

import io

import numpy as np
import skia
from PIL import Image
from scipy.ndimage import binary_dilation
from skimage.color import deltaE_ciede2000, rgb2lab
from skimage.metrics import structural_similarity


def rasterize_svg(svg, size):
    stream = skia.MemoryStream(svg.encode("utf-8"), copyData=True)
    dom = skia.SVGDOM.MakeFromStream(stream)
    if dom is None:
        raise ValueError("Generated SVG did not parse")
    surface = skia.Surface(*size)
    canvas = surface.getCanvas()
    canvas.clear(skia.ColorTRANSPARENT)
    dom.setContainerSize(skia.Size(*size))
    dom.render(canvas)
    return Image.open(io.BytesIO(bytes(surface.makeImageSnapshot().encodeToData()))).convert("RGBA")


def compare(source, rendered):
    a, b = (np.asarray(im.convert("RGBA"), dtype=np.float32) / 255 for im in (source, rendered))
    if a.shape != b.shape:
        raise ValueError("Comparison requires matching dimensions")
    region = binary_dilation(np.maximum(a[..., 3], b[..., 3]) > 0.04, iterations=5)
    if not region.any():
        return 1.0, 0.0
    similarities, distances = [], []
    for background in ([27, 39, 52], [236, 240, 246]):
        bg = np.asarray(background, dtype=np.float32) / 255
        x, y = (image[..., :3] * image[..., 3:] + bg * (1 - image[..., 3:]) for image in (a, b))
        _, local = structural_similarity(
            x, y, channel_axis=-1, data_range=1, gaussian_weights=True, full=True
        )
        similarities.append(local[region].mean())
        distances.append(deltaE_ciede2000(rgb2lab(x[region]), rgb2lab(y[region])).mean())
    return float(np.mean(similarities)), float(np.mean(distances))


def measure(source, svg, max_edge=1024):
    size = tuple(round(dimension * max_edge / max(source.size)) for dimension in source.size)
    target = source.resize(size, Image.Resampling.LANCZOS)
    rendered = rasterize_svg(svg, size)
    ssim, delta_e = compare(target, rendered)
    return {"ssim": round(ssim, 5), "deltaE00": round(delta_e, 3), "rasterSize": size}

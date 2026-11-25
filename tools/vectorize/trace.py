"""Separate ink, quantize color and trace topology-preserving mask rings."""

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage.measure import find_contours

from mesh import FOUNDATION, Region

BACK, BODY, FACE, FRINGE, HAND = range(5)

# Authored in normalized image coordinates for the three full-body lab cards.
# The outlines are clipped against the traced image, so the silhouettes are still
# derived entirely from the source alpha. Hand placement differs between poses.
PROFILES = {
    "front": {
        "body": [(0.06, .81), (.15, .64), (.35, .59), (.65, .59), (.85, .64), (.95, .81), (.95, 1), (.06, 1)],
        "face": [(.235, .36), (.49, .32), (.77, .34), (.855, .48), (.824, .55), (.70, .61), (.29, .61), (.215, .53)],
        "fringe": [(.14, .45), (.16, .11), (.30, 0), (.73, 0), (.86, .20), (.83, .38), (.74, .39), (.63, .38), (.56, .44), (.46, .42), (.39, .37), (.28, .44), (.24, .53), (.215, .61), (.16, .56)],
        "eyes": [(.370, .468, .079, .075), (.634, .451, .080, .071)],
    },
    "demoGuard": {
        "body": [(.18, .63), (.31, .54), (.68, .54), (.82, .63), (.87, 1), (.12, 1)],
        "face": [(.235, .35), (.47, .28), (.76, .33), (.864, .45), (.81, .51), (.66, .58), (.35, .58), (.235, .51)],
        "fringe": [(.19, .43), (.15, .18), (.27, 0), (.76, 0), (.86, .20), (.83, .39), (.73, .355), (.63, .365), (.54, .43), (.45, .405), (.40, .345), (.31, .375), (.255, .43), (.235, .53), (.19, .50)],
        "hands": [(.36, .565, .095, .082), (.63, .56, .105, .088)],
        "eyes": [(.371, .442, .075, .067), (.634, .434, .079, .067)],
    },
    "cheer": {
        "body": [(.06, .33), (.17, .29), (.35, .55), (.65, .55), (.83, .27), (.95, .33), (.76, .66), (.87, 1), (.09, 1), (.24, .66)],
        "face": [(.205, .35), (.47, .24), (.79, .32), (.80, .42), (.72, .52), (.62, .55), (.39, .55), (.26, .50)],
        "fringe": [(.12, .28), (.18, .13), (.35, 0), (.70, 0), (.85, .17), (.86, .31), (.73, .32), (.62, .37), (.53, .39), (.47, .37), (.39, .335), (.32, .35), (.22, .42)],
        "hands": [(.12, .282, .112, .092), (.86, .284, .118, .097)],
    },
}


def part_map(shape, profile):
    height, width = shape
    parts = np.full(shape, BACK, dtype=np.uint8)
    scale = np.array([width, height])
    if profile is None:
        parts.fill(BODY)
        return parts
    for key, part in (("body", BODY), ("face", FACE), ("fringe", FRINGE)):
        polygon = np.rint(np.asarray(profile[key]) * scale).astype(np.int32)
        cv2.fillPoly(parts, [polygon], part)
    for x, y, rx, ry in profile.get("hands", []):
        cv2.ellipse(parts, (round(x * width), round(y * height)), (round(rx * width), round(ry * height)),
                    0, 0, 360, HAND, cv2.FILLED)
    return parts


def _palette(features, count, seed):
    """Sample common colors and retain chromatic/bright features in the fit."""
    rng = np.random.default_rng(seed)
    sample_ids = rng.choice(len(features), min(24000, len(features)), replace=False)
    chroma = np.linalg.norm(features[:, 1:3], axis=1)
    detail = np.flatnonzero((chroma >= 24) | (features[:, 0] > 94))
    if len(detail):
        sample_ids = np.concatenate([sample_ids, rng.choice(detail, min(len(detail), 5500), replace=False)])
    sample = np.ascontiguousarray(features[sample_ids], dtype=np.float32)
    count = min(count, len(np.unique(np.rint(sample), axis=0)))
    if count == 1:
        return np.median(sample, axis=0, keepdims=True)
    cv2.setRNGSeed(seed)
    _, _, centers = cv2.kmeans(sample, count, None,
                               (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 32, .08),
                               2, cv2.KMEANS_PP_CENTERS)
    return centers[np.argsort(centers[:, 0], kind="stable")]


def _nearest_pixels(retain):
    return ndimage.distance_transform_edt(~retain, return_distances=False, return_indices=True)


def _merge_specks(labels, eligible, count, min_pixels):
    retained = np.zeros(labels.shape, dtype=bool)
    for color in range(count):
        _, components, stats, _ = cv2.connectedComponentsWithStats((labels == color).astype(np.uint8), connectivity=8)
        large = stats[:, cv2.CC_STAT_AREA] >= min_pixels
        large[0] = False
        retained |= large[components]
    if retained.any() and np.any(eligible & ~retained):
        rows, cols = _nearest_pixels(retained)
        small = eligible & ~retained
        labels[small] = labels[rows[small], cols[small]]
    return labels


def _color_layers(lab, alpha, eligible, count, seed, min_pixels, transparent=False):
    features = lab[eligible]
    if transparent:
        features = np.column_stack((features, alpha[eligible] * 72))
    if not len(features):
        return [], [], np.full(alpha.shape, -1, dtype=np.int16)
    centers = _palette(features, count, seed)
    labels = np.full(alpha.shape, -1, dtype=np.int16)
    labels[eligible] = cKDTree(centers).query(features)[1]
    labels = _merge_specks(labels, eligible, len(centers), min_pixels)
    rgb = cv2.cvtColor(centers[None, :, :3].copy(), cv2.COLOR_LAB2RGB)[0]
    opacity = np.rint(centers[:, 3] * (255 / 72)).clip(1, 255) if transparent else np.full(len(centers), 255)
    colors = np.column_stack((np.rint(rgb * 255), opacity)).astype(np.uint8)
    return colors, [labels == color for color in range(len(centers))], labels


def _stacked_layers(colors, labels):
    # Assign each swatch to an earlier, more prevalent neighbor. Painting its
    # subtree together keeps large shapes continuous and avoids duplicate edges.
    count = len(colors)
    if not count:
        return []
    frequency = np.bincount(labels[labels >= 0], minlength=count)
    ordered = [label for label in np.argsort(-frequency, kind="stable") if frequency[label]]
    adjacency = np.zeros((count, count), dtype=np.int64)
    for first, second in ((labels[:, 1:], labels[:, :-1]), (labels[1:, :], labels[:-1, :])):
        edge = (first >= 0) & (second >= 0) & (first != second)
        keys = first[edge].astype(np.int32) * count + second[edge]
        adjacency += np.bincount(keys, minlength=count**2).reshape(count, count)
    adjacency = adjacency + adjacency.T
    subtree = {label: [label] for label in ordered}
    for i in range(len(ordered) - 1, 0, -1):
        label = ordered[i]
        parent = ordered[int(np.argmax(adjacency[label, ordered[:i]]))]
        subtree[parent].extend(subtree[label])
    return [(colors[label], np.isin(labels, subtree[label]), False) for label in ordered]


def _signed_area(points):
    x, y = points.T
    return float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2


def _contours(mask, scale, min_area):
    ys, xs = np.where(mask)
    if not len(xs):
        return []
    left, top = xs.min(), ys.min()
    window = np.pad(mask[top:ys.max()+1, left:xs.max()+1], 1)
    contours = []
    for contour in find_contours(window, .5, fully_connected="high"):
        points = ((contour[:-1, ::-1] + [left - .5, top - .5]) / scale).astype(np.float32)
        area = _signed_area(points)
        if abs(area) >= min_area:
            contours.append((area, points))
    return contours


def _rings(contours, epsilon):
    rings, holes = [], []
    for area, points in contours:
        closed = cv2.approxPolyDP(points, epsilon, True).reshape(-1, 2)
        if len(closed) < 3 or abs(_signed_area(closed) / area - 1) > .50:
            closed = cv2.approxPolyDP(points, epsilon * .38, True).reshape(-1, 2)
        if len(closed) < 3:
            continue
        closed = np.round(closed, 2)
        if area > 0:
            rings.append([closed])
        else:
            holes.append(closed)
    # Marching squares gives consistently wound contours, including nested
    # islands. Attach each hole to the smallest outer ring that contains it.
    rings.sort(key=lambda ring: abs(_signed_area(ring[0])))
    boxes = [(ring[0].min(axis=0), ring[0].max(axis=0)) for ring in rings]
    for hole in holes:
        low, high = hole.min(axis=0), hole.max(axis=0)
        probe = tuple(map(float, hole[0]))
        for ring, (outer_min, outer_max) in zip(rings, boxes):
            if np.all(low >= outer_min) and np.all(high <= outer_max) and cv2.pointPolygonTest(ring[0], probe, False) >= 0:
                ring.append(hole)
                break
    return rings


class Trace:
    def __init__(self, source, scale, profile=None, environment=False, illustration=False, *,
                 palette_size=22, min_color_area=4, separate_ink=True):
        self.scale = scale
        self.environment = environment
        self.size = source.size
        pixels = source.resize(tuple(value * scale for value in source.size), Image.Resampling.BICUBIC)
        raw = np.asarray(pixels.convert("RGBA"), dtype=np.float32) / 255
        alpha = raw[..., 3].copy()
        # Premultiplied resize (Pillow RGBA), followed by extension of nearby
        # opaque RGB into the antialias band to discard colored matte residue.
        inside = alpha >= (.05 if environment else .50)
        rgb = raw[..., :3].copy()
        if not environment:
            opaque = alpha >= .94
            if opaque.any():
                rows, cols = _nearest_pixels(opaque)
                unstable = inside & ~opaque
                rgb[unstable] = rgb[rows[unstable], cols[unstable]]
        lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
        self.inside = inside
        self.parts = part_map(inside.shape, profile)
        self.foundation = None
        self.contours = None
        if environment:
            colors, masks, self.labels = _color_layers(lab, alpha, inside, 28, 527, 22 * scale**2, True)
            self.layers = list(zip(colors, masks, [False] * len(colors)))
            return

        ink = np.zeros_like(inside)
        if separate_ink:
            light = lab[..., 0].copy()
            light[~inside] = 70
            surround = cv2.dilate(light, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (6 * scale + 1,) * 2))
            chroma = np.linalg.norm(lab[..., 1:3], axis=2)
            ink = inside & (light <= (27 if illustration else 34)) & (chroma < 34) & (surround - light > 15)
        colors, _, labels = _color_layers(lab, alpha, inside & ~ink, palette_size, 73, min_color_area * scale**2)
        strokes, stroke_masks, _ = _color_layers(lab, alpha, ink, 2, 127, 1.25 * scale**2)
        if ink.any() and (inside & ~ink).any():
            rows, cols = _nearest_pixels(inside & ~ink)
            labels[ink] = labels[rows[ink], cols[ink]]
        self.labels = labels
        self.layers = _stacked_layers(colors, labels)
        if profile is not None and self.layers:
            self.foundation = tuple(map(int, self.layers[0][0]))
        self.layers += list(zip(strokes, stroke_masks, [True] * len(strokes)))

    def _prepare_contours(self):
        scale = self.scale
        if self.environment:
            return [
                (tuple(map(int, color)), BACK, False, False, _contours(mask, scale, 14))
                for color, mask, _ in self.layers
            ]
        parts = [(int(number), self.parts == number) for number in np.unique(self.parts[self.inside])]
        layers = [
            (self.foundation, FOUNDATION, False, True, _contours(self.inside, scale, 1.25))
        ] if self.foundation else []
        for index, (color, mask, ink) in enumerate(self.layers):
            for part, part_mask in parts:
                area = 1.2 if ink else 2.0
                contours = _contours(mask & part_mask, scale, area)
                layers.append((tuple(map(int, color)), part, ink, index == 0 and not ink, contours))
        return layers

    def regions(self, epsilon):
        # Polygon budget retries reuse topology and vary only the simplification.
        if self.contours is None:
            self.contours = self._prepare_contours()
        result = []
        for color, part, ink, silhouette, contours in self.contours:
            tolerance = max(.20, epsilon * .63) if ink else epsilon
            if silhouette:
                tolerance = min(epsilon, .58)
            result.extend(Region(rings, color, part, ink) for rings in _rings(contours, tolerance))
        return result

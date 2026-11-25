"""Re-cut A-Z item photos and place them on a clean studio backdrop.

Usage: python3 -I studio.py SRC_DIR OUT_DIR name1.jpg name2.jpg ...
The item itself is not redrawn: its pixels are kept, only the cut-out edge is
rebuilt (re-segmented, smoothed, feathered) and the background replaced.
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter
from rembg import new_session, remove

SIZE = 1200
SESSION = new_session("isnet-general-use")


def backdrop(size):
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    r = np.sqrt((x - .5) ** 2 + ((y - .42) * 1.15) ** 2)
    t = np.clip(r / .75, 0, 1) ** 1.4
    center = np.array([46, 36, 26], np.float32)   # warm charcoal
    edge = np.array([9, 8, 7], np.float32)        # near black
    img = center * (1 - t[..., None]) + edge * t[..., None]
    # a faint floor line where the piece sits
    floor = np.exp(-((y - .80) ** 2) / .004) * 10
    img += floor[..., None] * np.array([1.0, .8, .55], np.float32)
    noise = np.random.default_rng(7).normal(0, 1.2, img.shape)  # avoids banding
    return np.clip(img + noise, 0, 255).astype(np.uint8)


def clean_mask(alpha):
    a = alpha.astype(np.float32) / 255
    hard = (a > .5).astype(np.uint8)
    # keep the biggest pieces only (drops stray specks the old cut-out left)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(hard, 8)
    if n > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        keep = [i + 1 for i, s in enumerate(areas) if s >= max(60, areas.max() * .04)]
        hard = np.isin(lab, keep).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    hard = cv2.morphologyEx(hard, cv2.MORPH_OPEN, k)
    hard = cv2.morphologyEx(hard, cv2.MORPH_CLOSE, k)
    # round off the jagged outline, then a soft 1-2 px edge
    smooth = cv2.GaussianBlur(hard.astype(np.float32), (0, 0), 2.2)
    smooth = np.clip((smooth - .5) * 2.4 + .5, 0, 1)
    smooth = cv2.GaussianBlur(smooth, (0, 0), .9)
    return smooth


def drop_tray(rgb, alpha):
    """Gold pieces shot in a white display slot: remove the white fabric that
    touches the outside of the cut-out, keep the gold and the stones."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.float32)
    h, s, v = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    inside = alpha > 127
    gold = inside & (h >= 15) & (h <= 55) & (s > .28) & (v > .25)
    if gold.sum() < .30 * max(1, inside.sum()):
        return alpha                      # white-metal piece: leave it
    white = inside & (s < .22) & (v > .45)
    white = cv2.morphologyEx(white.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    # whitish areas connected to the outside of the piece are tray, not stones
    outside = (~inside).astype(np.uint8)
    seed = cv2.dilate(outside, np.ones((3, 3), np.uint8)) & white
    n, lab = cv2.connectedComponents(white, connectivity=4)
    touch = np.unique(lab[seed > 0])
    tray = np.isin(lab, touch[touch > 0])
    tray = cv2.dilate(tray.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    out = alpha.copy()
    out[tray & ~cv2.dilate(gold.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)] = 0
    return out


def studio(src, dst):
    im = Image.open(src).convert("RGB")
    cut = remove(im, session=SESSION, post_process_mask=True)
    mask = clean_mask(drop_tray(np.array(im), np.array(cut)[..., 3]))
    ys, xs = np.where(mask > .05)
    if len(xs) < 50:
        return False
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    # a tray or case shot comes back as a solid block, not a piece: leave it alone
    if (mask[y0:y1, x0:x1] > .5).mean() > .9 and (x1 - x0) * (y1 - y0) > .25 * mask.size:
        return False
    rgb = np.array(im)
    # gentle clean-up of phone noise and a touch more sparkle, item pixels only
    rgb = cv2.fastNlMeansDenoisingColored(rgb, None, 3, 3, 7, 21)
    blur = cv2.GaussianBlur(rgb, (0, 0), 1.6)
    rgb = cv2.addWeighted(rgb, 1.45, blur, -.45, 0)
    item = rgb[y0:y1, x0:x1].astype(np.float32)
    m = mask[y0:y1, x0:x1]
    # scale so the piece fills ~72% of the frame
    h, w = m.shape
    s = (SIZE * .72) / max(h, w)
    nw, nh = max(1, int(w * s)), max(1, int(h * s))
    item = cv2.resize(item, (nw, nh), interpolation=cv2.INTER_LANCZOS4)
    m = np.clip(cv2.resize(m, (nw, nh), interpolation=cv2.INTER_CUBIC), 0, 1)
    canvas = backdrop(SIZE).astype(np.float32)
    ox, oy = (SIZE - nw) // 2, int(SIZE * .78) - nh
    oy = max(int(SIZE * .08), oy)
    # soft contact shadow under the piece
    sh = np.zeros((SIZE, SIZE), np.float32)
    cv2.ellipse(sh, (SIZE // 2, min(SIZE - 20, oy + nh)), (int(nw * .42), max(8, int(nh * .05))), 0, 0, 360, 1, -1)
    sh = cv2.GaussianBlur(sh, (0, 0), 18) * .55
    canvas *= (1 - sh[..., None])
    # warm halo behind the piece
    glow = np.zeros((SIZE, SIZE), np.float32)
    glow[oy:oy + nh, ox:ox + nw] = m
    glow = cv2.GaussianBlur(glow, (0, 0), 40) * .22
    canvas += glow[..., None] * np.array([255, 196, 110], np.float32)
    region = canvas[oy:oy + nh, ox:ox + nw]
    region[:] = region * (1 - m[..., None]) + item * m[..., None]
    out = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))
    out.save(dst, quality=88, optimize=True, progressive=True)
    return True


if __name__ == "__main__":
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[3:]:
        ok = studio(src / name, out / name)
        print(name, "ok" if ok else "SKIPPED")

"""Uploaded photos: verified, resized and re-encoded (which drops EXIF, including GPS)."""
from __future__ import annotations

import io
import secrets
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_EDGE = 1600
# Hard cap on decoded pixels, checked from the image header BEFORE any pixel
# buffer is allocated. A 10 MB highly-compressed upload can otherwise expand to
# hundreds of megabytes in convert("RGB") on this public endpoint.
MAX_PIXELS = 25_000_000


class BadImage(ValueError):
    pass


def save_photo(data: bytes, media_dir: Path, folder: str) -> str:
    """Store one uploaded photo as a clean JPEG; returns its public /media path."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise BadImage("Each photo must be under 10 MB.")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
        with Image.open(io.BytesIO(data)) as image:
            # size comes from the header — no pixels decoded yet.
            width, height = image.size
            if width * height > MAX_PIXELS:
                raise BadImage(
                    f"That photo is too large ({width}x{height}). Please use a smaller image."
                )
            image = ImageOps.exif_transpose(image)
            image = image.convert("RGB")
            image.thumbnail((MAX_EDGE, MAX_EDGE))
            target = media_dir / folder
            target.mkdir(parents=True, exist_ok=True)
            name = f"{secrets.token_hex(12)}.jpg"
            image.save(target / name, "JPEG", quality=85, optimize=True)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise BadImage("That file is not a photo we can read.") from exc
    return f"/media/{folder}/{name}"

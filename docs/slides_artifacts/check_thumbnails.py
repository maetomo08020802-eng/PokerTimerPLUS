# -*- coding: utf-8 -*-
"""Download all 11 slide thumbnails to ./thumbnails/ for visual review."""
import io
import os
import sys
import urllib.request
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(__file__))
from build_slides import get_credentials, get_services  # noqa: E402

import json
PRES_INFO = json.loads(
    Path(__file__).resolve().with_name("presentation_info.json").read_text(
        encoding="utf-8"
    )
)
PID = PRES_INFO["presentationId"]
SLIDE_IDS = PRES_INFO["slide_ids"]

OUT = Path(__file__).resolve().parent / "thumbnails"
OUT.mkdir(exist_ok=True)


def main():
    creds = get_credentials()
    _, slides = get_services(creds)
    log = []
    for i, sid in enumerate(SLIDE_IDS, 1):
        try:
            thumb = slides.presentations().pages().getThumbnail(
                presentationId=PID,
                pageObjectId=sid,
                thumbnailProperties_thumbnailSize="LARGE",
            ).execute()
            url = thumb["contentUrl"]
            out_path = OUT / f"slide_{i:02d}.png"
            urllib.request.urlretrieve(url, str(out_path))
            log.append(f"[{i:02d}] OK -> {out_path.name}")
        except Exception as e:
            log.append(f"[{i:02d}] ERR {e}")
    (OUT / "_log.txt").write_text("\n".join(log), encoding="utf-8")


if __name__ == "__main__":
    main()

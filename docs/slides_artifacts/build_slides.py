# -*- coding: utf-8 -*-
"""
PokerTimerPLUS+ 取扱説明書 v1.3.0 — Google Slides ジェネレータ
Premium Dark + Gold アクセント / 全 11 枚

認証は plus2_token.json を再利用する OAuth フロー。
全スライドの batchUpdate JSON を requests/slide_NN.json に保存し、
作成後の objectId 対応表を object_id_map.md に書き出す。

Usage:
    python build_slides.py              # 全スライド構築
    python build_slides.py --slides 5   # スライド5だけ再構築
    python build_slides.py --skip-upload  # 画像アップロードをスキップ
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ============================================================
# Paths & constants
# ============================================================
TOKEN_PATH = r"C:\Users\user\Desktop\PLUS2\plus2_token.json"
CREDS_PATH = r"C:\Users\user\google-slides-mcp\credentials.json"

ARTIFACT_DIR = Path(__file__).resolve().parent
REQUESTS_DIR = ARTIFACT_DIR / "requests"
SCREENSHOTS_DIR = Path(r"C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock\docs\screenshots")
PRESENTATION_INFO = ARTIFACT_DIR / "presentation_info.json"
IMAGE_URLS_FILE = ARTIFACT_DIR / "image_urls.md"
OBJECT_ID_MAP = ARTIFACT_DIR / "object_id_map.md"

PRESENTATION_TITLE = "PokerTimerPLUS+ 取扱説明書 v1.3.0"
DRIVE_FOLDER_NAME = "PokerTimerPLUS_Manual_Assets"
PLUS2_LOGO_DRIVE_ID = "12S6HkIC_v-ZaDgkHpVQzhAs21eYo83i6"
PLUS2_LOGO_URL = f"https://drive.google.com/uc?id={PLUS2_LOGO_DRIVE_ID}"

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/presentations",
]

SLIDE_W, SLIDE_H = 720, 405
TOTAL_SLIDES = 11

FONT_TITLE = "Noto Sans JP"
FONT_BODY = "BIZ UDPGothic"
FONT_NUM = "Roboto"


def rgb(hex_str):
    h = hex_str.lstrip("#")
    return {"red": int(h[0:2], 16) / 255.0,
            "green": int(h[2:4], 16) / 255.0,
            "blue": int(h[4:6], 16) / 255.0}


# Color palette (Premium Dark + Gold)
MIDNIGHT = rgb("#0C1829")     # Page background
SURFACE = rgb("#172D45")      # Card background
DEEP_NAVY = rgb("#112234")
ELEVATED = rgb("#1E3A56")
WHITE = rgb("#FFFFFF")
SNOW = rgb("#F0F4F8")
MIST = rgb("#C8D8E8")
FOG = rgb("#8FA8BE")
DUSK = rgb("#5A7A94")
GOLD_LIGHT = rgb("#F0C060")
GOLD = rgb("#D4A843")
GOLD_DARK = rgb("#9A7520")
DANGER = rgb("#E74C3C")
SUCCESS = rgb("#2ECC71")


# ============================================================
# Auth & service factories
# ============================================================
def get_credentials():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from google.auth.exceptions import RefreshError

    creds = None
    if os.path.exists(TOKEN_PATH):
        try:
            creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
        except Exception as e:
            print(f"[Auth] Token file unreadable: {e}")
            creds = None

    if not creds or not creds.valid:
        refreshed = False
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                refreshed = True
            except RefreshError as e:
                print(f"[Auth] Refresh failed ({e}); falling back to browser flow")
                creds = None
        if not refreshed:
            from google_auth_oauthlib.flow import InstalledAppFlow
            flow = InstalledAppFlow.from_client_secrets_file(CREDS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())
    return creds


def get_services(creds):
    from googleapiclient.discovery import build
    drive = build("drive", "v3", credentials=creds)
    slides = build("slides", "v1", credentials=creds)
    return drive, slides


# ============================================================
# Drive image upload
# ============================================================
SCREENSHOTS = [
    "attention.png",
    "01-main.png",
    "02-tournament.png",
    "03-blinds.png",
    "04a-bg-presets.png",
    "04b-slideshow.png",
    "05-slideshow-active.png",
    "06-about.png",
]


def find_or_create_folder(drive, name):
    q = (f"name='{name}' and mimeType='application/vnd.google-apps.folder' "
         "and trashed=false")
    res = drive.files().list(q=q, fields="files(id,name)").execute()
    files = res.get("files", [])
    if files:
        return files[0]["id"]
    md = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
    folder = drive.files().create(body=md, fields="id").execute()
    return folder["id"]


def upload_image(drive, folder_id, local_path):
    from googleapiclient.http import MediaFileUpload
    name = os.path.basename(local_path)
    # Replace existing file with same name to keep IDs stable on rerun
    q = (f"name='{name}' and '{folder_id}' in parents and trashed=false")
    res = drive.files().list(q=q, fields="files(id,name)").execute()
    if res.get("files"):
        file_id = res["files"][0]["id"]
        media = MediaFileUpload(local_path, mimetype="image/png", resumable=False)
        drive.files().update(fileId=file_id, media_body=media).execute()
    else:
        media = MediaFileUpload(local_path, mimetype="image/png", resumable=False)
        body = {"name": name, "parents": [folder_id]}
        f = drive.files().create(body=body, media_body=media, fields="id").execute()
        file_id = f["id"]
    drive.permissions().create(
        fileId=file_id,
        body={"role": "reader", "type": "anyone"},
        fields="id",
    ).execute()
    return file_id


def upload_all_screenshots(drive):
    folder_id = find_or_create_folder(drive, DRIVE_FOLDER_NAME)
    print(f"[Drive] Folder ID: {folder_id}")
    urls = {}
    for fname in SCREENSHOTS:
        local = SCREENSHOTS_DIR / fname
        if not local.exists():
            print(f"[Drive] WARN missing: {local}")
            continue
        fid = upload_image(drive, folder_id, str(local))
        urls[fname] = {
            "drive_id": fid,
            "url": f"https://drive.google.com/uc?id={fid}",
        }
        print(f"[Drive] {fname} -> {fid}")
    # Save URL map
    with open(IMAGE_URLS_FILE, "w", encoding="utf-8") as f:
        f.write("# 画像 URL 対応表\n\n")
        f.write(f"Drive folder: `{DRIVE_FOLDER_NAME}` (ID: `{folder_id}`)\n\n")
        f.write("| ファイル名 | Drive ID | 公開 URL |\n|---|---|---|\n")
        for name, info in urls.items():
            f.write(f"| `{name}` | `{info['drive_id']}` | {info['url']} |\n")
        f.write(f"\n## PLUS TWO ロゴ\n\n- Drive ID: `{PLUS2_LOGO_DRIVE_ID}`\n")
        f.write(f"- URL: {PLUS2_LOGO_URL}\n")
    return urls


# ============================================================
# Request primitive builders
# ============================================================
def _shape(oid, kind, page, x, y, w, h):
    return {"createShape": {
        "objectId": oid, "shapeType": kind,
        "elementProperties": {
            "pageObjectId": page,
            "size": {"width": {"magnitude": w, "unit": "PT"},
                     "height": {"magnitude": h, "unit": "PT"}},
            "transform": {"scaleX": 1, "scaleY": 1,
                          "translateX": x, "translateY": y, "unit": "PT"},
        },
    }}


def _rect(oid, page, x, y, w, h):
    return _shape(oid, "RECTANGLE", page, x, y, w, h)


def _ellipse(oid, page, x, y, w, h):
    return _shape(oid, "ELLIPSE", page, x, y, w, h)


def _tbox(oid, page, x, y, w, h):
    return _shape(oid, "TEXT_BOX", page, x, y, w, h)


def _fill(oid, color, alpha=None):
    sf = {"color": {"rgbColor": color}}
    if alpha is not None:
        sf["alpha"] = alpha
    return {"updateShapeProperties": {
        "objectId": oid,
        "shapeProperties": {
            "shapeBackgroundFill": {"solidFill": sf},
            "outline": {"propertyState": "NOT_RENDERED"},
        },
        "fields": "shapeBackgroundFill,outline",
    }}


def _txt(oid, text):
    return {"insertText": {"objectId": oid, "text": text}}


def _style(oid, size, color, bold=False, font=FONT_BODY, italic=False,
           text_range=None):
    style = {
        "fontFamily": font,
        "fontSize": {"magnitude": size, "unit": "PT"},
        "foregroundColor": {"opaqueColor": {"rgbColor": color}},
        "bold": bold,
        "italic": italic,
    }
    req = {
        "objectId": oid,
        "style": style,
        "fields": "fontFamily,fontSize,foregroundColor,bold,italic",
    }
    req["textRange"] = text_range if text_range else {"type": "ALL"}
    return {"updateTextStyle": req}


def _content_align(oid, alignment="MIDDLE"):
    """Vertically align text content within a shape (TOP / MIDDLE / BOTTOM)."""
    return {"updateShapeProperties": {
        "objectId": oid,
        "shapeProperties": {"contentAlignment": alignment},
        "fields": "contentAlignment",
    }}


def _para(oid, alignment="START", line_spacing=None, space_below=None):
    style = {"alignment": alignment}
    fields = ["alignment"]
    if line_spacing is not None:
        style["lineSpacing"] = line_spacing
        fields.append("lineSpacing")
    if space_below is not None:
        style["spaceBelow"] = {"magnitude": space_below, "unit": "PT"}
        fields.append("spaceBelow")
    return {"updateParagraphStyle": {
        "objectId": oid,
        "textRange": {"type": "ALL"},
        "style": style,
        "fields": ",".join(fields),
    }}


def txt(oid, page, x, y, w, h, text, size=14, color=MIST,
        bold=False, font=FONT_BODY, align="START", italic=False,
        line_spacing=140, space_below=None):
    return [
        _tbox(oid, page, x, y, w, h),
        _txt(oid, text),
        _style(oid, size, color, bold=bold, font=font, italic=italic),
        _para(oid, alignment=align, line_spacing=line_spacing,
              space_below=space_below),
    ]


def rect(oid, page, x, y, w, h, color, alpha=None):
    return [_rect(oid, page, x, y, w, h), _fill(oid, color, alpha=alpha)]


def ellipse(oid, page, x, y, w, h, color, alpha=None):
    return [_ellipse(oid, page, x, y, w, h), _fill(oid, color, alpha=alpha)]


def page_bg(slide_id, color=MIDNIGHT):
    return [{
        "updatePageProperties": {
            "objectId": slide_id,
            "pageProperties": {
                "pageBackgroundFill": {"solidFill": {"color": {"rgbColor": color}}},
            },
            "fields": "pageBackgroundFill",
        }
    }]


def overlay_layer(pfx, slide_id):
    """Subtle overlay rect for content slides (Surface alpha 0.3)."""
    return rect(f"{pfx}_ovl", slide_id, 0, 0, SLIDE_W, SLIDE_H, SURFACE, alpha=0.25)


def header_block(pfx, slide_id, title, subtitle=None):
    """Title (28pt) + horizontal Gold accent line (2pt)."""
    r = txt(f"{pfx}_title", slide_id, 64, 56, 592, 56,
            title, size=28, color=WHITE, bold=True, font=FONT_TITLE,
            line_spacing=120)
    r += rect(f"{pfx}_acc", slide_id, 64, 124, 80, 3, GOLD)
    if subtitle:
        r += txt(f"{pfx}_sub", slide_id, 64, 102, 592, 22,
                 subtitle, size=12, color=FOG, font=FONT_BODY)
    return r


def footer_block(pfx, slide_id, page_num):
    """Footer with app name (left) + page number (right)."""
    r = []
    r += rect(f"{pfx}_fdiv", slide_id, 64, 376, 592, 0.5, ELEVATED)
    r += txt(f"{pfx}_fl", slide_id, 64, 382, 400, 16,
             "PokerTimerPLUS+ v1.3.0",
             size=9, color=DUSK, font=FONT_BODY)
    r += txt(f"{pfx}_fp", slide_id, 596, 382, 60, 16,
             f"{page_num:02d} / {TOTAL_SLIDES:02d}",
             size=9, color=DUSK, font=FONT_NUM, align="END")
    return r


def logo_block(slide_id, page_num, title_slide=False):
    """PLUS TWO ロゴ insertion (createImage)."""
    if title_slide:
        # Title slide: 75 × 52 at lower-right
        w, h, x, y = 75, 52, 608, 320
    else:
        w, h, x, y = 50, 35, 640, 340
    return [{
        "createImage": {
            "objectId": f"plus2_logo_{page_num:02d}",
            "url": PLUS2_LOGO_URL,
            "elementProperties": {
                "pageObjectId": slide_id,
                "size": {"width": {"magnitude": w, "unit": "PT"},
                         "height": {"magnitude": h, "unit": "PT"}},
                "transform": {"scaleX": 1, "scaleY": 1,
                              "translateX": x, "translateY": y, "unit": "PT"},
            },
        }
    }]


def insert_image(oid, slide_id, url, x, y, w, h):
    return [{
        "createImage": {
            "objectId": oid,
            "url": url,
            "elementProperties": {
                "pageObjectId": slide_id,
                "size": {"width": {"magnitude": w, "unit": "PT"},
                         "height": {"magnitude": h, "unit": "PT"}},
                "transform": {"scaleX": 1, "scaleY": 1,
                              "translateX": x, "translateY": y, "unit": "PT"},
            },
        }
    }]


# ============================================================
# Slide builders
# ============================================================
def slide_01_title(slide_id, image_urls):
    """T01: タイトル — グロー + 縦アクセントバー + 大見出し."""
    pfx = "s01"
    r = page_bg(slide_id, MIDNIGHT)
    # Glow ellipse upper-left (Gold alpha 0.12)
    r += ellipse(f"{pfx}_glow", slide_id, -80, -60, 320, 240, GOLD, alpha=0.12)
    # Secondary glow lower-right (subtle)
    r += ellipse(f"{pfx}_glow2", slide_id, 480, 280, 280, 200, GOLD_DARK, alpha=0.10)
    # Vertical accent bar
    r += rect(f"{pfx}_vbar", slide_id, 64, 130, 4, 56, GOLD)
    # Eyebrow
    r += txt(f"{pfx}_eyebrow", slide_id, 80, 132, 480, 22,
             "POKER TOURNAMENT CLOCK",
             size=11, color=GOLD_LIGHT, bold=True, font=FONT_NUM)
    # Main title
    r += txt(f"{pfx}_main", slide_id, 80, 158, 600, 64,
             "PokerTimerPLUS+ 取扱説明書",
             size=38, color=WHITE, bold=True, font=FONT_TITLE,
             line_spacing=120)
    # Horizontal accent line
    r += rect(f"{pfx}_hbar", slide_id, 80, 232, 100, 3, GOLD)
    # Subtitle
    r += txt(f"{pfx}_sub", slide_id, 80, 244, 480, 30,
             "v1.3.0 / 2026.04",
             size=20, color=SNOW, font=FONT_NUM)
    # Description
    r += txt(f"{pfx}_desc", slide_id, 80, 282, 480, 36,
             "全国のポーカールームへ無料配布する Electron 製ポーカークロック",
             size=12, color=FOG, font=FONT_BODY, line_spacing=150)
    # Author (bottom-left)
    r += txt(f"{pfx}_author", slide_id, 80, 340, 400, 20,
             "制作 ：Yu Shitamachi（PLUS2 運営）",
             size=11, color=FOG, font=FONT_BODY)
    # Bottom-bottom note
    r += txt(f"{pfx}_note", slide_id, 80, 360, 400, 14,
             "Free distribution to all poker rooms in Japan.",
             size=8, color=DUSK, font=FONT_NUM, italic=True)
    # Logo (large)
    r += logo_block(slide_id, 1, title_slide=True)
    return r


def slide_02_warning(slide_id, image_urls):
    """T08-style 2 column: SmartScreen warning + safety reasoning."""
    pfx = "s02"
    r = page_bg(slide_id, MIDNIGHT)
    r += overlay_layer(pfx, slide_id)
    r += header_block(pfx, slide_id,
                      "はじめに：起動時の警告について",
                      "最初に必ず読んでください")

    # LEFT card (X:64, Y:144, W:280, H:221)
    cx, cy, cw, ch = 64, 144, 280, 221
    r += rect(f"{pfx}_lcard", slide_id, cx, cy, cw, ch, SURFACE)
    # left thin Danger accent bar (because warning topic)
    r += rect(f"{pfx}_lbar", slide_id, cx, cy, 3, ch, DANGER)
    r += txt(f"{pfx}_lh", slide_id, cx + 16, cy + 12, cw - 32, 24,
             "初回起動時の警告",
             size=16, color=SNOW, bold=True, font=FONT_TITLE)
    r += txt(f"{pfx}_lb", slide_id, cx + 16, cy + 38, cw - 32, 32,
             "未署名アプリのため警告が出ますが、安全に起動できます。",
             size=10, color=MIST, font=FONT_BODY, line_spacing=140)
    r += txt(f"{pfx}_ls1", slide_id, cx + 16, cy + 76, cw - 32, 18,
             "1.「詳細情報」をクリック",
             size=10, color=GOLD_LIGHT, bold=True, font=FONT_BODY)
    r += txt(f"{pfx}_ls2", slide_id, cx + 16, cy + 96, cw - 32, 18,
             "2.「実行」をクリック",
             size=10, color=GOLD_LIGHT, bold=True, font=FONT_BODY)
    r += txt(f"{pfx}_lnote", slide_id, cx + 16, cy + 116, cw - 32, 14,
             "※ 次回以降は表示されません",
             size=8, color=FOG, font=FONT_BODY, italic=True)
    # Image (attention.png) inside left card bottom — preserve aspect (~1.6:1)
    if "attention.png" in image_urls:
        r += rect(f"{pfx}_limgf", slide_id, cx + 38, cy + 137, 204, 76,
                  GOLD, alpha=0.4)
        r += insert_image(f"{pfx}_limg", slide_id,
                          image_urls["attention.png"]["url"],
                          cx + 40, cy + 139, 200, 72)

    # RIGHT card (X:376, Y:144, W:280, H:221)
    rx, ry, rw, rh = 376, 144, 280, 221
    r += rect(f"{pfx}_rcard", slide_id, rx, ry, rw, rh, SURFACE)
    r += rect(f"{pfx}_rbar", slide_id, rx, ry, 3, rh, GOLD)
    r += txt(f"{pfx}_rh", slide_id, rx + 16, ry + 12, rw - 32, 44,
             "位置情報・カメラ・マイクの\n通知について",
             size=14, color=SNOW, bold=True, font=FONT_TITLE,
             line_spacing=130)
    r += txt(f"{pfx}_rb", slide_id, rx + 16, ry + 58, rw - 32, 102,
             "Windows から確認通知が出る場合がありますが、このアプリは"
             "位置情報・カメラ・マイクを一切使用していません。\n"
             "すべてオフラインで動作し、外部通信もありません。",
             size=10, color=MIST, font=FONT_BODY, line_spacing=160)
    # Highlight band — single TEXT_BOX with two-line text, vertically centered
    hl_x, hl_y, hl_w, hl_h = rx + 16, ry + 168, rw - 32, 42
    r += rect(f"{pfx}_hl", slide_id, hl_x, hl_y, hl_w, hl_h, GOLD, alpha=0.18)
    hl_text = f"{pfx}_hlt"
    text_main = "コード全公開で透明性を確保"
    text_sub = "\n（GitHub 公開予定）"
    full = text_main + text_sub
    r += [_tbox(hl_text, slide_id, hl_x + 12, hl_y + 4, hl_w - 24, hl_h - 8)]
    r += [_txt(hl_text, full)]
    r += [_style(hl_text, 11, GOLD_LIGHT, bold=True, font=FONT_BODY,
                 text_range={"type": "FIXED_RANGE",
                             "startIndex": 0, "endIndex": len(text_main)})]
    r += [_style(hl_text, 8, GOLD_LIGHT, bold=False, font=FONT_BODY,
                 text_range={"type": "FIXED_RANGE",
                             "startIndex": len(text_main),
                             "endIndex": len(full)})]
    r += [_para(hl_text, alignment="CENTER", line_spacing=120)]
    r += [_content_align(hl_text, "MIDDLE")]

    r += footer_block(pfx, slide_id, 2)
    r += logo_block(slide_id, 2)
    return r


def slide_03_features(slide_id, image_urls):
    """T07: 9 項目を 2 カラム + 右上にメイン画面スクショ."""
    pfx = "s03"
    r = page_bg(slide_id, MIDNIGHT)
    r += overlay_layer(pfx, slide_id)
    r += header_block(pfx, slide_id, "このアプリでできること",
                      "ポーカートーナメント運営に必要な機能を 1 画面に集約")

    items = [
        ("ブラインドタイマー",
         "警告音 + スタート前カウント"),
        ("多彩なゲーム種対応",
         "NLH / PLO / 10-Game MIX / 自由記入"),
        ("複数大会並行 + 店名表示",
         "タブ切替・店名常時表示"),
        ("賞金プール / PRIZE 設定",
         "自動計算 + 順位別ペイアウト"),
        ("+スタック対応",
         "リエントリー / アドオン / リバイ"),
        ("背景 8 種 + カスタム画像",
         "暗さ 3 段階で視認性確保"),
        ("休憩中スライドショー",
         "30 秒遅延 / 1 分前自動復帰"),
        ("テロップ + サウンド選択",
         "流れる文字 / カウント音試聴"),
        ("PC 間データ移行",
         "エクスポート / インポート対応"),
    ]

    # 2 columns: left 5 items, right 4 items
    col_w = 184
    line_h = 42
    cols = [
        (64, items[:5]),
        (256, items[5:]),
    ]
    for ci, (cx, col_items) in enumerate(cols):
        for i, (head, body) in enumerate(col_items):
            global_i = ci * 5 + i
            yy = 148 + i * line_h
            # Bar spans full item height to visually link with text block
            r += rect(f"{pfx}_b{global_i}_bar", slide_id, cx, yy + 2, 3, 36, GOLD)
            head_id = f"{pfx}_b{global_i}_h"
            r += [_tbox(head_id, slide_id, cx + 10, yy, col_w - 10, 18)]
            r += [_txt(head_id, head)]
            r += [_style(head_id, 11, SNOW, bold=True, font=FONT_TITLE)]
            r += [_para(head_id, alignment="START", line_spacing=110)]
            r += [_content_align(head_id, "MIDDLE")]
            body_id = f"{pfx}_b{global_i}_t"
            r += [_tbox(body_id, slide_id, cx + 10, yy + 19, col_w - 10, 22)]
            r += [_txt(body_id, body)]
            r += [_style(body_id, 8, MIST, font=FONT_BODY)]
            r += [_para(body_id, alignment="START", line_spacing=120)]
            r += [_content_align(body_id, "TOP")]

    # Top-right image panel
    if "01-main.png" in image_urls:
        r += rect(f"{pfx}_imframe", slide_id, 448, 148, 212, 121, GOLD, alpha=0.5)
        r += insert_image(f"{pfx}_img", slide_id,
                          image_urls["01-main.png"]["url"],
                          450, 150, 208, 117)
        r += txt(f"{pfx}_imcap", slide_id, 448, 270, 212, 14,
                 "メイン画面 — テレビ全画面表示推奨",
                 size=8, color=FOG, font=FONT_BODY, align="CENTER", italic=True)

    # Bottom tagline (full width) — moved down because items now reach y=358
    r += txt(f"{pfx}_tl", slide_id, 64, 360, 592, 14,
             "テレビに映してそのまま運営できる、無料のオフラインアプリ。",
             size=10, color=GOLD_LIGHT, bold=True, font=FONT_TITLE,
             align="CENTER")

    r += footer_block(pfx, slide_id, 3)
    r += logo_block(slide_id, 3)
    return r


def slide_04_main_screen(slide_id, image_urls):
    """T05改: 中央にメイン画面 + 周囲に注釈."""
    pfx = "s04"
    r = page_bg(slide_id, MIDNIGHT)
    r += overlay_layer(pfx, slide_id)
    r += header_block(pfx, slide_id, "メイン画面の見方",
                      "各エリアの意味を覚えれば、誰でも操作できる")

    # Center image
    if "01-main.png" in image_urls:
        # gold border under
        r += rect(f"{pfx}_imframe", slide_id, 199, 153, 322, 184, GOLD, alpha=0.5)
        r += insert_image(f"{pfx}_img", slide_id,
                          image_urls["01-main.png"]["url"],
                          200, 154, 320, 182)

    # Annotations around image
    annots = [
        # (x, y, w, h, text, align)
        (64, 148, 130, 32, "▍レベル / 大会名", "START"),
        (526, 148, 130, 32, "▍残り時間 / 次レベル", "START"),
        (64, 196, 130, 32, "▍賞金プール\nペイアウト 1〜3 位", "START"),
        (526, 196, 130, 50, "▍人数 / リエントリー\nアドオン / アベスタック", "START"),
        (64, 256, 130, 32, "▍SB / BB / アンティ\n（現在レベル）", "START"),
        (526, 256, 130, 32, "▍次レベルのブラインド\n プレビュー", "START"),
    ]
    for i, (x, y, w, h, text, align) in enumerate(annots):
        oid = f"{pfx}_an{i}"
        r += txt(oid, slide_id, x, y, w, h, text,
                 size=10, color=GOLD_LIGHT, bold=True, font=FONT_BODY,
                 line_spacing=140, align=align)

    # Bottom note about the timer area
    r += txt(f"{pfx}_n1", slide_id, 200, 340, 320, 18,
             "中央の数字 = 現在レベルの残り時間",
             size=10, color=MIST, font=FONT_BODY, align="CENTER", italic=True)

    r += footer_block(pfx, slide_id, 4)
    r += logo_block(slide_id, 4)
    return r


def _two_col_with_image(slide_id, pfx, page_num, title, subtitle, items,
                       image_key, image_urls, img_w=288, img_h=204):
    """Helper for T07 layout: left bullets + right screenshot."""
    r = page_bg(slide_id, MIDNIGHT)
    r += overlay_layer(pfx, slide_id)
    r += header_block(pfx, slide_id, title, subtitle)

    # Left bullets — taller rows so wrapping body text stays in column
    bx, by, bw = 64, 148, 312
    line_h = 44
    for i, item in enumerate(items):
        yy = by + i * line_h
        if isinstance(item, tuple):
            head, body = item
            r += rect(f"{pfx}_b{i}_bar", slide_id, bx, yy + 3, 3, 32, GOLD)
            r += txt(f"{pfx}_b{i}_h", slide_id, bx + 12, yy, bw - 12, 18,
                     head, size=12, color=SNOW, bold=True, font=FONT_TITLE)
            r += txt(f"{pfx}_b{i}_t", slide_id, bx + 12, yy + 18, bw - 12, 26,
                     body, size=9, color=MIST, font=FONT_BODY,
                     line_spacing=130)
        else:
            r += rect(f"{pfx}_b{i}_bar", slide_id, bx, yy + 6, 3, 20, GOLD)
            r += txt(f"{pfx}_b{i}_t", slide_id, bx + 12, yy, bw - 12, 36,
                     item, size=11, color=MIST, font=FONT_BODY,
                     line_spacing=140)

    # Right image
    if image_key and image_key in image_urls:
        # Center image in right column (X:392-656, Y:148-336)
        ix = 392 + (264 - img_w) / 2
        iy = 148 + (188 - img_h) / 2
        r += rect(f"{pfx}_imframe", slide_id, ix - 1, iy - 1, img_w + 2, img_h + 2,
                  GOLD, alpha=0.5)
        r += insert_image(f"{pfx}_img", slide_id,
                          image_urls[image_key]["url"],
                          ix, iy, img_w, img_h)

    r += footer_block(pfx, slide_id, page_num)
    r += logo_block(slide_id, page_num)
    return r


def slide_05_tournament(slide_id, image_urls):
    items = [
        ("新規トーナメント作成", "名前 / スターティングスタック / 通貨単位"),
        ("既存の編集・複製・削除", "間違って消さない確認ダイアログ付き"),
        ("複数トーナメント並行管理", "タブで切替・それぞれ独立した進行状態"),
        ("データ永続化", "再起動しても進行状態を保持（自動保存）"),
    ]
    return _two_col_with_image(slide_id, "s05", 5,
                              "トーナメント設定タブ",
                              "大会の基本情報を登録・管理する",
                              items, "02-tournament.png", image_urls)


def slide_06_blinds(slide_id, image_urls):
    items = [
        ("テンプレート 7 種同梱", "demo-fast / turbo / regular / deep など"),
        ("レベルごとに自由編集", "時間 / SB / BB / アンティ"),
        ("ブレイク行のチェック", "ON で休憩を挿入、OFF で削除"),
        ("ゲーム種 13 種対応", "NLH / PLO / PLO8 / Limit / Stud / Short Deck ほか"),
        ("複製して編集", "同梱テンプレを安全にカスタマイズ"),
    ]
    return _two_col_with_image(slide_id, "s06", 6,
                              "ブラインド構造タブ",
                              "レベル進行と休憩を組み立てる",
                              items, "03-blinds.png", image_urls)


def slide_07_background(slide_id, image_urls):
    items = [
        ("8 色標準プリセット", "黒 / 紺 / カーボン / フェルト / バーガンディ / "
                          "ミッドナイト / エメラルド / オブシディアン"),
        ("カスタム画像 (9 種目)", "PNG / JPEG / WebP（5 MB 以下）を選択"),
        ("暗くする強度 3 段階", "弱 30% / 中 50% / 強 70% — 数字の視認性を確保"),
        ("数字フォント切替", "JetBrains Mono / Roboto Mono など"),
    ]
    return _two_col_with_image(slide_id, "s07", 7,
                              "背景・色の設定タブ",
                              "テレビ画面に映えるビジュアルへ",
                              items, "04a-bg-presets.png", image_urls)


def slide_08_slideshow_setup(slide_id, image_urls):
    items = [
        ("複数画像を登録", "最大 20 枚 / 各 5 MB 以下"),
        ("切替間隔の設定", "3〜60 秒で設定可能（既定 10 秒）"),
        ("縮小タイマー（PIP）サイズ", "小 / 中 / 大 から選択"),
        ("サムネイル一覧", "個別削除 / 一括削除に対応"),
        ("⚠ 150 MB 超で警告", "重くなる懸念に対応"),
    ]
    return _two_col_with_image(slide_id, "s08", 8,
                              "休憩中の画像スライドショー（設定）",
                              "休憩時間を退屈させない演出を作る",
                              items, "04b-slideshow.png", image_urls)


def slide_09_slideshow_active(slide_id, image_urls):
    """T05改: 中央〜右に画像 + 周囲に注釈."""
    pfx = "s09"
    r = page_bg(slide_id, MIDNIGHT)
    r += overlay_layer(pfx, slide_id)
    r += header_block(pfx, slide_id, "休憩中スライドショー（実行画面）",
                      "じんわりフェードインで滑らかに始まり、自動で本画面へ戻る")

    # Image centered (320×180)
    if "05-slideshow-active.png" in image_urls:
        r += rect(f"{pfx}_imframe", slide_id, 199, 153, 322, 184, GOLD, alpha=0.5)
        r += insert_image(f"{pfx}_img", slide_id,
                          image_urls["05-slideshow-active.png"]["url"],
                          200, 154, 320, 182)

    # Annotations: 3 on left, 3 on right, with 60pt gap between pairs
    # Each pair occupies 60pt vertical (head 24 + body 16 + gap 20)
    annots = [
        # left side
        (64, 148, 130, "30 秒後に自動スタート", "席を立つ余裕を確保"),
        (64, 208, 130, "じんわりフェードイン", "滑らかに表示開始"),
        (64, 268, 130, "縮小タイマー (PIP)", "金色枠で右下常時表示"),
        # right side
        (526, 148, 130, "再開 1 分前で自動復帰", "通常画面に戻る"),
        (526, 208, 130, "手動切替ボタン", "画面左下から戻せる"),
        (526, 268, 130, "クロスフェード切替", "画像が滑らかに切替"),
    ]
    for i, (x, y, w, head, body) in enumerate(annots):
        # accent bar
        r += rect(f"{pfx}_an{i}_bar", slide_id, x, y + 2, 3, 14, GOLD)
        r += txt(f"{pfx}_an{i}_h", slide_id, x + 8, y, w - 8, 16, head,
                 size=10, color=GOLD_LIGHT, bold=True, font=FONT_BODY)
        r += txt(f"{pfx}_an{i}_b", slide_id, x + 8, y + 18, w - 8, 30, body,
                 size=9, color=FOG, font=FONT_BODY, line_spacing=130)

    r += footer_block(pfx, slide_id, 9)
    r += logo_block(slide_id, 9)
    return r


def slide_10_shortcuts(slide_id, image_urls):
    """ショートカットキー一覧 — 2 列レイアウト (左: プレイヤー管理 / 右: タイマー & 画面)."""
    pfx = "s10"
    r = page_bg(slide_id, MIDNIGHT)
    r += overlay_layer(pfx, slide_id)
    r += header_block(pfx, slide_id, "ショートカットキー一覧",
                      "マウスなしでテレビの前から運営できる")

    timer_keys = [
        ("Space", "スタート / 一時停止"),
        ("[", "30 秒戻る"),
        ("]", "30 秒進む"),
    ]
    player_keys = [
        ("↑", "新規エントリー追加"),
        ("Shift + ↑", "エントリー取消"),
        ("↓", "脱落"),
        ("Shift + ↓", "復活"),
        ("Ctrl + R", "リエントリー ±"),
        ("Ctrl + A", "アドオン ±"),
    ]
    screen_keys = [
        ("F11", "フルスクリーン切替"),
        ("F12", "開発者ツール"),
        ("Ctrl + Q", "アプリ終了"),
    ]

    def render_card(card_id, x, y, w, h, title, items, max_rows=None):
        rows = []
        # Card background + gold top
        rows += rect(f"{pfx}_{card_id}_card", slide_id, x, y, w, h, SURFACE)
        rows += rect(f"{pfx}_{card_id}_top", slide_id, x, y, w, 3, GOLD)
        # Title — vertically centered in 24pt header band
        title_id = f"{pfx}_{card_id}_h"
        rows += [_tbox(title_id, slide_id, x + 14, y + 8, w - 28, 24)]
        rows += [_txt(title_id, title)]
        rows += [_style(title_id, 13, SNOW, bold=True, font=FONT_TITLE)]
        rows += [_para(title_id, alignment="START", line_spacing=100)]
        rows += [_content_align(title_id, "MIDDLE")]

        row_y0 = y + 40
        row_h = 24
        chip_h = 20
        chip_w = 86
        for ri, (key, desc) in enumerate(items):
            ry = row_y0 + ri * row_h
            # Chip = single RECTANGLE shape with embedded text (text vertically centered)
            chip_id = f"{pfx}_{card_id}_k{ri}"
            chip_x = x + 14
            chip_y = ry
            rows += [_rect(chip_id, slide_id, chip_x, chip_y, chip_w, chip_h)]
            rows += [_fill(chip_id, ELEVATED)]
            rows += [_txt(chip_id, key)]
            rows += [_style(chip_id, 10, GOLD_LIGHT, bold=True, font=FONT_NUM)]
            rows += [_para(chip_id, alignment="CENTER", line_spacing=100)]
            rows += [_content_align(chip_id, "MIDDLE")]
            # Description — also vertically centered to match chip height
            desc_id = f"{pfx}_{card_id}_d{ri}"
            desc_x = chip_x + chip_w + 10
            desc_w = w - (desc_x - x) - 14
            rows += [_tbox(desc_id, slide_id, desc_x, chip_y, desc_w, chip_h)]
            rows += [_txt(desc_id, desc)]
            rows += [_style(desc_id, 10, MIST, font=FONT_BODY)]
            rows += [_para(desc_id, alignment="START", line_spacing=100)]
            rows += [_content_align(desc_id, "MIDDLE")]
        return rows

    # Left card: プレイヤー管理 (full height)
    r += render_card("p", 64, 136, 308, 232,
                     "プレイヤー管理", player_keys)
    # Right top card: タイマー操作 (3 rows × 24 + 40 header = 112, +4 margin = 116)
    r += render_card("t", 388, 136, 268, 116,
                     "タイマー操作", timer_keys)
    # Right bottom card: 画面操作 (3 rows fully visible)
    r += render_card("s", 388, 256, 268, 116,
                     "画面操作", screen_keys)

    r += footer_block(pfx, slide_id, 10)
    r += logo_block(slide_id, 10)
    return r


def slide_11_credits(slide_id, image_urls):
    """T11/T12: クレジット / お問い合わせ."""
    pfx = "s11"
    r = page_bg(slide_id, MIDNIGHT)
    # Glow on left side (mirrored from title)
    r += ellipse(f"{pfx}_glow", slide_id, -60, 240, 320, 240, GOLD, alpha=0.10)
    r += header_block(pfx, slide_id, "クレジット / お問い合わせ",
                      "Thank you for using PokerTimerPLUS+")

    # 3 sections (cards)
    card_w, card_h, gap = 200, 192, 16
    card_y = 148
    x0 = 64

    sections = [
        ("制作", [
            "Yu Shitamachi",
            "（PLUS2 運営）",
            "",
            "2026 年 4 月 制作",
        ], GOLD),
        ("配布形態", [
            "全国のポーカールーム",
            "向け 無料配布",
            "",
            "GitHub にて公開予定",
        ], GOLD_LIGHT),
        ("お問い合わせ", [
            "ポーカールーム PLUS2",
            "大阪府西区北堀江",
            "2-5-10 マツエダビル 2F",
            "",
            "TEL : 06-6532-6577",
        ], GOLD),
    ]

    for i, (head, lines, accent) in enumerate(sections):
        cx = x0 + i * (card_w + gap)
        r += rect(f"{pfx}_c{i}_bg", slide_id, cx, card_y, card_w, card_h, SURFACE)
        r += rect(f"{pfx}_c{i}_top", slide_id, cx, card_y, card_w, 3, accent)
        r += txt(f"{pfx}_c{i}_h", slide_id, cx + 14, card_y + 12, card_w - 28, 24,
                 head, size=14, color=SNOW, bold=True, font=FONT_TITLE)
        body_text = "\n".join(lines)
        r += txt(f"{pfx}_c{i}_b", slide_id, cx + 14, card_y + 44, card_w - 28,
                 card_h - 56, body_text,
                 size=11, color=MIST, font=FONT_BODY, line_spacing=160)

    # License bar (bottom)
    r += rect(f"{pfx}_lic_bg", slide_id, 64, 350, 592, 22, SURFACE, alpha=0.7)
    r += rect(f"{pfx}_lic_bar", slide_id, 64, 350, 3, 22, GOLD_DARK)
    r += txt(f"{pfx}_lic", slide_id, 76, 354, 580, 18,
             "Fonts: Noto Sans JP / BIZ UDPGothic / Roboto / Barlow Condensed (SIL OFL 1.1) ほか",
             size=8, color=FOG, font=FONT_BODY)

    r += footer_block(pfx, slide_id, 11)
    r += logo_block(slide_id, 11, title_slide=True)
    return r


# ============================================================
# Main pipeline
# ============================================================
SLIDE_BUILDERS = [
    ("Title", slide_01_title),
    ("SmartScreen Warning", slide_02_warning),
    ("Features Overview", slide_03_features),
    ("Main Screen Guide", slide_04_main_screen),
    ("Tournament Settings", slide_05_tournament),
    ("Blind Structure", slide_06_blinds),
    ("Background Settings", slide_07_background),
    ("Slideshow Setup", slide_08_slideshow_setup),
    ("Slideshow Active", slide_09_slideshow_active),
    ("Shortcuts", slide_10_shortcuts),
    ("Credits", slide_11_credits),
]


def create_or_load_presentation(slides, drive):
    """Create new presentation or reuse existing one (via state file)."""
    if PRESENTATION_INFO.exists():
        info = json.loads(PRESENTATION_INFO.read_text(encoding="utf-8"))
        print(f"[Slides] Reusing presentation: {info['presentationId']}")
        return info
    pres = slides.presentations().create(
        body={"title": PRESENTATION_TITLE}
    ).execute()
    pid = pres["presentationId"]
    default_slide_id = pres["slides"][0]["objectId"]
    print(f"[Slides] Created new presentation: {pid}")

    # Create remaining 10 slides; record IDs
    requests = []
    slide_ids = [default_slide_id]
    for i in range(1, TOTAL_SLIDES):
        new_id = f"slide_{i+1:02d}"
        slide_ids.append(new_id)
        requests.append({
            "createSlide": {
                "objectId": new_id,
                "insertionIndex": i,
                "slideLayoutReference": {"predefinedLayout": "BLANK"},
            }
        })
    slides.presentations().batchUpdate(
        presentationId=pid, body={"requests": requests}
    ).execute()
    print(f"[Slides] Added {TOTAL_SLIDES - 1} blank slides")

    info = {
        "presentationId": pid,
        "url": f"https://docs.google.com/presentation/d/{pid}/edit",
        "slide_ids": slide_ids,
        "title": PRESENTATION_TITLE,
    }
    PRESENTATION_INFO.write_text(
        json.dumps(info, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return info


def clean_default_slide(slides, pid, slide_id):
    """Remove placeholder elements from the default slide."""
    pres = slides.presentations().get(presentationId=pid).execute()
    target = next(s for s in pres["slides"] if s["objectId"] == slide_id)
    elems = target.get("pageElements", [])
    if not elems:
        return
    requests = [{"deleteObject": {"objectId": e["objectId"]}} for e in elems]
    slides.presentations().batchUpdate(
        presentationId=pid, body={"requests": requests}
    ).execute()
    print(f"[Slides] Cleaned {len(elems)} default elements from slide 1")


def clear_slide_elements(slides, pid, slide_id):
    pres = slides.presentations().get(presentationId=pid).execute()
    target = next((s for s in pres["slides"] if s["objectId"] == slide_id), None)
    if not target:
        return
    elems = target.get("pageElements", [])
    if not elems:
        return
    requests = [{"deleteObject": {"objectId": e["objectId"]}} for e in elems]
    slides.presentations().batchUpdate(
        presentationId=pid, body={"requests": requests}
    ).execute()
    print(f"[Slides] Cleared {len(elems)} elements on slide {slide_id}")


def build_slide(slides, pid, idx, slide_id, builder, image_urls, dry=False,
                clear=False):
    REQUESTS_DIR.mkdir(parents=True, exist_ok=True)
    if clear and not dry:
        clear_slide_elements(slides, pid, slide_id)
    requests = builder(slide_id, image_urls)
    out = REQUESTS_DIR / f"slide_{idx:02d}.json"
    out.write_text(json.dumps(requests, indent=2, ensure_ascii=False),
                   encoding="utf-8")
    if dry:
        print(f"[DRY] Slide {idx:02d}: {len(requests)} requests -> {out.name}")
        return
    print(f"[Slides] Slide {idx:02d}: sending {len(requests)} requests…")
    slides.presentations().batchUpdate(
        presentationId=pid, body={"requests": requests}
    ).execute()


def write_object_id_map(info, image_urls):
    lines = ["# Object ID 対応表", "",
             f"**Presentation ID:** `{info['presentationId']}`  ",
             f"**URL:** {info['url']}", "", "## スライド ID", "",
             "| # | スライド名 | Slide ID |", "|---|---|---|"]
    for i, ((name, _), sid) in enumerate(zip(SLIDE_BUILDERS, info["slide_ids"]), 1):
        lines.append(f"| {i:02d} | {name} | `{sid}` |")
    lines.append("")
    lines.append("## 共通要素 ID 命名規則")
    lines.append("")
    lines.append("各スライド prefix: `s01` 〜 `s11`")
    lines.append("")
    lines.append("| 要素 | objectId 形式 | 例 |")
    lines.append("|---|---|---|")
    lines.append("| タイトル | `s{NN}_title` | `s05_title` |")
    lines.append("| サブタイトル | `s{NN}_sub` | `s05_sub` |")
    lines.append("| アクセント横線 | `s{NN}_acc` | `s05_acc` |")
    lines.append("| オーバーレイ | `s{NN}_ovl` | `s05_ovl` |")
    lines.append("| フッター区切り | `s{NN}_fdiv` | `s05_fdiv` |")
    lines.append("| フッター左 | `s{NN}_fl` | `s05_fl` |")
    lines.append("| フッター右ページ番号 | `s{NN}_fp` | `s05_fp` |")
    lines.append("| PLUS TWO ロゴ | `plus2_logo_{NN}` | `plus2_logo_05` |")
    lines.append("| 右画像 | `s{NN}_img` | `s05_img` |")
    lines.append("| 画像フレーム | `s{NN}_imframe` | `s05_imframe` |")
    lines.append("| 箇条書き縦バー (i 番目) | `s{NN}_b{i}_bar` | `s05_b0_bar` |")
    lines.append("| 箇条書き見出し | `s{NN}_b{i}_h` | `s05_b0_h` |")
    lines.append("| 箇条書き本文 | `s{NN}_b{i}_t` | `s05_b0_t` |")
    lines.append("")
    lines.append("## 修正手順")
    lines.append("")
    lines.append("1. `requests/slide_NN.json` を編集（座標・テキスト・色）")
    lines.append("2. `python build_slides.py --slides NN` で当該スライドだけ再構築")
    lines.append("3. もしくは Google Slides 上で直接編集して `objectId` を保ちながら API で再送信")
    OBJECT_ID_MAP.write_text("\n".join(lines), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--slides", type=str, default=None,
                        help="再構築するスライド番号 (e.g., '5' or '3,5,9' or 'all')")
    parser.add_argument("--skip-upload", action="store_true",
                        help="画像アップロードをスキップ（image_urls.md があれば再利用）")
    parser.add_argument("--dry", action="store_true",
                        help="JSON 保存のみ、API 送信しない")
    parser.add_argument("--clear", action="store_true",
                        help="再構築前に対象スライドの全要素を削除する")
    args = parser.parse_args()

    # Determine which slides to build
    if args.slides in (None, "all"):
        slide_indices = list(range(1, TOTAL_SLIDES + 1))
    else:
        slide_indices = [int(x) for x in args.slides.split(",")]

    creds = get_credentials()
    drive, slides_svc = get_services(creds)
    print("[Auth] OK")

    # ---- Phase A: image upload ----
    image_urls = {}
    if args.skip_upload and IMAGE_URLS_FILE.exists():
        # Re-parse image_urls.md? Easier: store JSON beside it.
        cache_json = ARTIFACT_DIR / "image_urls.json"
        if cache_json.exists():
            image_urls = json.loads(cache_json.read_text(encoding="utf-8"))
            print(f"[Drive] Reusing {len(image_urls)} image URLs from cache")
    if not image_urls:
        image_urls = upload_all_screenshots(drive)
        (ARTIFACT_DIR / "image_urls.json").write_text(
            json.dumps(image_urls, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    # ---- Phase B: presentation ----
    info = create_or_load_presentation(slides_svc, drive)

    # ---- Phase C: build slides ----
    if 1 in slide_indices and not args.dry:
        clean_default_slide(slides_svc, info["presentationId"], info["slide_ids"][0])

    for idx in slide_indices:
        if not (1 <= idx <= TOTAL_SLIDES):
            print(f"[WARN] Skipping invalid slide index {idx}")
            continue
        slide_id = info["slide_ids"][idx - 1]
        _, builder = SLIDE_BUILDERS[idx - 1]
        build_slide(slides_svc, info["presentationId"], idx, slide_id,
                    builder, image_urls, dry=args.dry, clear=args.clear)

    # ---- Phase D: artifacts ----
    write_object_id_map(info, image_urls)

    print("")
    print(f"✅ Done. URL: {info['url']}")


if __name__ == "__main__":
    main()

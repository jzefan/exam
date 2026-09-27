"""Structured provider content and private, durable media copies.

Provider HTML/scripts and signed URLs are never returned to the client. Files are
read only; uploaded code is displayed as text and never executed.
"""
import hashlib
import io
import re
import uuid
import zipfile
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import NavigableString, Tag

from .browser import ATTACHMENT_OBJECT, ATTACHMENT_SUFFIXES, allowed_resource, read_request_allowed, re_mutation
from .models import ExternalMedia

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_SHEET_BYTES = 50 * 1024 * 1024
VISION_IMAGE_MAX_BYTES = 4 * 1024 * 1024
VISION_IMAGES_PER_QUESTION = 6
TEXT_ATTACHMENT_SUFFIXES = ATTACHMENT_SUFFIXES | frozenset({
    "md", "markdown", "rst", "csv", "tsv", "ini", "conf", "log", "properties", "toml", "tex",
    "rtf", "html", "htm", "vue", "svelte", "ipynb", "dockerfile", "makefile", "gradle", "pom",
})


def blocks(node: Tag | None) -> list[dict]:
    if node is None:
        return []
    result: list[dict] = []
    buffer: list[str] = []

    def flush():
        value = ''.join(buffer).replace('\xa0', ' ').strip('\r\n')
        buffer.clear()
        if value.strip():
            result.append({'kind': 'text', 'text': value})

    def walk(el):
        if isinstance(el, NavigableString):
            buffer.append(str(el))
            return
        if not isinstance(el, Tag) or el.name in ('script', 'style', 'input', 'button'):
            return
        formula = el.get('data-latex') or el.get('data-tex') or el.get('latex')
        if el.name == 'math':
            annotation = el.select_one('annotation[encoding="application/x-tex"]')
            formula = annotation.get_text() if annotation else formula
        if formula:
            buffer.append(" $" + str(formula).strip("$") + "$ ")
            return
        if el.name == 'a' and el.get('href'):
            href = str(el.get('href'))
            # Navigation/help links are ordinary answer text. Linked images are
            # still images; only download/file links become attachments.
            if el.find('img') or not (el.get('objectid') or re.search(
                r"download|attachment|/file|\.(?:py|txt|md|markdown|rst|csv|tsv|log|tex|rtf|pdf|zip|docx?|xlsx?|pptx?|java|cpp|c|js|ts|sql)(?:[?#]|$)", href, re.I
            )):
                for child in el.children:
                    walk(child)
                return
        if el.name in ('img', 'iframe') or (el.name == 'a' and el.get('href')):
            flush()
            kind = 'image' if el.name == 'img' else 'file'
            result.append({
                'kind': kind,
                'name': str(el.get('filename') or el.get('alt') or el.get_text(strip=True) or ('图片' if kind == 'image' else '附件'))[:255],
                '_url': str(el.get('data-src') or el.get('src') or el.get('href') or ''),
                '_object_id': str(el.get('objectid') or ''),
                '_suffix': str(el.get('filetype') or ''),
            })
            return
        if el.name == 'br':
            buffer.append('\n')
        for child in el.children:
            walk(child)
        if el.name in ('p', 'div', 'li', 'dd', 'pre'):
            buffer.append('\n')

    walk(node)
    flush()
    return result


def media_url(raw: str, base: str) -> str:
    if not raw:
        return ""
    url = urljoin(base, raw)
    # Old editor images still carry http even though the CDN supports https.
    if url.startswith('http://'):
        url = 'https://' + url[7:]
    return url if allowed_resource(url) and not re_mutation(urlsplit(url).path) else ''


async def fetch_bytes(session, url: str, referer: str, limit: int) -> tuple[bytes, str]:
    async with httpx.AsyncClient(timeout=30, follow_redirects=False, trust_env=False) as client:
        for _ in range(5):
            if not allowed_resource(url) or re_mutation(urlsplit(url).path):
                raise ValueError('unsupported media host')
            cookies = await session.context.cookies([url])
            headers = {'Referer': referer, 'X-Requested-With': 'XMLHttpRequest',
                       'Cookie': '; '.join(f"{c['name']}={c['value']}" for c in cookies)}
            async with client.stream('GET', url, headers=headers) as response:
                if response.is_redirect:
                    url = urljoin(url, response.headers.get('location', ''))
                    continue
                response.raise_for_status()
                if int(response.headers.get('content-length') or 0) > limit:
                    raise ValueError('media too large')
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > limit:
                        raise ValueError('media too large')
                return bytes(data), response.headers.get('content-type', '').split(';')[0]
        raise ValueError('too many media redirects')


def image_mime(data: bytes) -> str | None:
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if data.startswith((b'GIF87a', b'GIF89a')):
        return 'image/gif'
    if data.startswith(b'RIFF') and data[8:12] == b'WEBP':
        return 'image/webp'
    return None


def decode_code(data: bytes, suffix: str) -> str | None:
    if suffix.lower().lstrip('.') not in TEXT_ATTACHMENT_SUFFIXES or len(data) > 1024 * 1024 or b'\x00' in data:
        return None
    for encoding in ('utf-8-sig', 'gb18030'):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            pass
    return None


def extract_docx(data: bytes) -> tuple[str, list[bytes]]:
    """Extract Word paragraphs/tables plus embedded images within bounded ZIP limits."""
    from docx import Document

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 500 or sum(entry.file_size for entry in entries) > 40 * 1024 * 1024:
                raise ValueError("Word attachment expands beyond the allowed size")
        document = Document(io.BytesIO(data))
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("Word attachment could not be parsed") from exc

    parts: list[str] = []
    # Match the existing Word reader's document-order handling for paragraphs
    # and tables, including answers laid out in a table.
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    for child in document.element.body.iterchildren():
        if child.tag.endswith("}p"):
            paragraph = Paragraph(child, document)
            if paragraph.text.strip():
                parts.append(paragraph.text.strip())
        elif child.tag.endswith("}tbl"):
            table = Table(child, document)
            for row in table.rows:
                values = [cell.text.strip() for cell in row.cells]
                if any(values):
                    parts.append(" | ".join(values))

    images: list[bytes] = []
    for relation in document.part.rels.values():
        if "image" not in relation.reltype:
            continue
        image = relation.target_part.blob
        if image_mime(image) and len(image) <= VISION_IMAGE_MAX_BYTES:
            images.append(image)
            if len(images) >= VISION_IMAGES_PER_QUESTION:
                break
    return "\n\n".join(parts).strip(), images


async def store_media(db, owner, data: bytes, mime: str) -> ExternalMedia:
    # Deterministic per-owner id makes refreshes/import hashes stable and avoids
    # duplicating the same stem image for every candidate in the class.
    media_id = uuid.uuid5(uuid.UUID(str(owner)), hashlib.sha256(data).hexdigest())
    saved = await db.get(ExternalMedia, media_id)
    if saved is None:
        saved = ExternalMedia(id=media_id, owner_id=uuid.UUID(str(owner)), data=data, mime_type=mime)
        db.add(saved)
        await db.flush()
    return saved


async def attachment_status(session, base, object_id):
    from .parsers import read_url

    if not read_url(base):
        raise ValueError("unsupported answer page")
    page = await session.context.new_page()
    try:
        async def guard(route):
            request = route.request
            if not allowed_resource(request.url) or not read_request_allowed(request.method, request.url):
                await route.abort()
            else:
                await route.fallback()
        await page.route("**/*", guard)
        await page.goto(base, wait_until="domcontentloaded", timeout=30_000)
        return await page.evaluate("""async id => {
          const r = await fetch('/ananas/status/' + id, {
            credentials: 'include', headers: {'X-Requested-With': 'XMLHttpRequest'}
          });
          if (!r.ok) throw new Error('attachment unavailable');
          return await r.json();
        }""", object_id)
    except Exception as exc:
        raise ValueError("attachment unavailable") from exc
    finally:
        await page.close()


async def resolve_media(session, pages, questions, db, owner):
    remaining = MAX_SHEET_BYTES
    fetched = {}
    for question in questions.values():
        # The parser conservatively flags attachment-only answers. Re-evaluate
        # after resolving attachments so readable images and files can enter AI
        # grading, while a genuinely absent submission remains manual.
        question["requires_manual_review"] = question.get("max_score") is None or not question.pop("_answer_present", True)
        grading_assets: list[dict] = []
        for field, parts in question.get('rich_content', {}).items():
            for part in parts:
                if part['kind'] == 'text':
                    continue
                raw = part.pop('_url', '')
                object_id = part.pop('_object_id', '')
                suffix = part.pop('_suffix', '') or part['name'].rsplit('.', 1)[-1]
                base = question.get('_base_url') or (pages[0][0] if pages else '')
                try:
                    url = media_url(raw, base)
                    if object_id:
                        if not ATTACHMENT_OBJECT.fullmatch(object_id):
                            raise ValueError('invalid object id')
                        # Resolve in the authenticated page just like the provider
                        # download button; CDN retrieval below shares its cookies.
                        payload = await attachment_status(session, base, object_id)
                        url = media_url(str(payload.get('download') or ''), base) if isinstance(payload, dict) else ''
                    if not url:
                        raise ValueError('missing media URL')
                    if url not in fetched:
                        if remaining <= 0:
                            raise ValueError('sheet media limit')
                        try:
                            data, mime = await fetch_bytes(session, url, base, min(MAX_FILE_BYTES, remaining))
                        except (ValueError, httpx.HTTPError):
                            # Some file CDNs require the browser's own fetch. Keep
                            # the previously supported text/code path as fallback.
                            from .browser import read_attachment

                            text = await read_attachment(session, base, object_id, suffix) if object_id else ""
                            if not text:
                                raise
                            data, mime = text.encode("utf-8"), "text/plain"
                        if len(data) > min(MAX_FILE_BYTES, remaining):
                            raise ValueError("media too large")
                        remaining -= len(data)
                        if not data or mime in ('text/html', 'application/xhtml+xml') and suffix.lower() != 'html':
                            raise ValueError('not an attachment')
                        mime = image_mime(data) or 'application/octet-stream'
                        saved = await store_media(db, owner, data, mime)
                        fetched[url] = (saved, data)
                    saved, data = fetched[url]
                    if part['kind'] == 'image' and not saved.mime_type.startswith('image/'):
                        raise ValueError('unsupported image')
                    part.update(asset_id=str(saved.id), size=len(data))
                    if saved.mime_type.startswith('image/'):
                        part['kind'] = 'image'
                    if part['kind'] == 'image':
                        if saved.mime_type in ('image/png', 'image/jpeg', 'image/webp') and len(data) <= VISION_IMAGE_MAX_BYTES:
                            if len(grading_assets) < VISION_IMAGES_PER_QUESTION:
                                grading_assets.append({"media_id": str(saved.id), "role": field, "name": part['name']})
                            else:
                                question['requires_manual_review'] = True
                        else:
                            question['requires_manual_review'] = True
                        preview = None
                    elif suffix.lower().lstrip('.') == 'docx':
                        preview, embedded_images = extract_docx(data)
                        for image_index, image_data in enumerate(embedded_images, 1):
                            embedded_mime = image_mime(image_data) or 'application/octet-stream'
                            embedded = await store_media(db, owner, image_data, embedded_mime)
                            part.setdefault('embedded_images', []).append({
                                "asset_id": str(embedded.id), "name": f"{part['name']} · 图片 {image_index}",
                            })
                            if embedded_mime in ('image/png', 'image/jpeg', 'image/webp') and len(image_data) <= VISION_IMAGE_MAX_BYTES and len(grading_assets) < VISION_IMAGES_PER_QUESTION:
                                grading_assets.append({
                                    "media_id": str(embedded.id), "role": field,
                                    "name": f"{part['name']} · 图片 {image_index}",
                                })
                            else:
                                question['requires_manual_review'] = True
                        if not preview and not embedded_images:
                            question['requires_manual_review'] = True
                    else:
                        preview = decode_code(data, suffix) if part['kind'] == 'file' else None
                    if preview is not None and not preview.strip():
                        preview = None
                    if preview is not None:
                        part['preview'] = preview
                        # Feed extracted attachment text into the same grading fields
                        # as ordinary provider text, not just the display preview.
                        target = question.get(field)
                        if field in ('content', 'student_answer', 'reference_answer') and preview not in (target or ''):
                            question[field] = f"{target or ''}\n\n【附件 {part['name']}】\n{preview}".strip()
                    # Current grading prompts are text-only. Never grade an image
                    # or unread binary as an empty answer, even alongside text.
                    if part['kind'] == 'file' and preview is None and not part.get('embedded_images'):
                        question['requires_manual_review'] = True
                except (ValueError, httpx.HTTPError, TypeError, KeyError):
                    part['unavailable'] = True
                    question['requires_manual_review'] = True
        if grading_assets:
            question['rich_content']['grading_assets'] = grading_assets
        elif any(part.get('unavailable') for parts in question.get('rich_content', {}).values() for part in parts):
            question['requires_manual_review'] = True
        question.pop('_base_url', None)

import copy
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from bs4 import BeautifulSoup
from fastapi import HTTPException
from sqlalchemy import func, select

from app.chaoxing import media, parsers, router, service
from app.chaoxing.models import ExternalMedia

BASE = 'https://mooc2-ans.chaoxing.com/mooc2-ans/work/library/review-work?workAnswerId=1'
PNG = b'\x89PNG\r\n\x1a\n' + b'test'
HTML = '''<div class="mark_item1"><h3 id="questionStem_12" class="mark_name">
<span class="colorShallow">(其它,100.0分)</span><div class="hiddenTitle"><img src="//p.ananas.chaoxing.com/test.png?token=secret"></div></h3>
<dl class="studentAns"><dd class="stuAnswerWords"><iframe objectid="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" filename="lesson2.py" filetype="py"></iframe><img src="https://p.ananas.chaoxing.com/answer.png"></dd></dl></div>'''


def test_image_only_stem_and_multiple_answer_media_survive_parsing():
    question = parsers.review(HTML)['questions'][0]
    assert question['content'] == ''
    assert question['max_score'] == 100
    assert [b['kind'] for b in question['rich_content']['content']] == ['image']
    assert [b['kind'] for b in question['rich_content']['student_answer']] == ['file', 'image']
    assert question['rich_content']['student_answer'][0]['name'] == 'lesson2.py'


def test_formulas_and_code_are_not_discarded_or_interpreted_as_html():
    node = BeautifulSoup(r'<div><p>求 $x^2$，\(y\)</p><img data-latex="\frac{1}{2}" src="formula.png"><pre>if x &lt; 2:\n    print(x)</pre><script>bad()</script></div>', 'html.parser').div
    parts = media.blocks(node)
    assert len(parts) == 1
    assert '$\\frac{1}{2}$' in parts[0]['text']
    assert 'if x < 2:' in parts[0]['text']
    assert 'bad()' not in parts[0]['text']
    assert '$\\frac{1}{2}$' in parsers.answer_text(node)


async def test_media_round_trip_dedup_owner_access_and_image_grading(db_session, monkeypatch):
    owner = uuid.uuid4()
    question = parsers.review(HTML)['questions'][0]
    question['_base_url'] = BASE
    monkeypatch.setattr(media, 'attachment_status', AsyncMock(return_value={'download': 'https://d0.ananas.chaoxing.com/lesson2.py?token=secret'}))
    async def fetch(session, url, referer, limit):
        return (b'if x < 2:\n    print(x)\n', 'text/plain') if 'lesson2.py' in url else (PNG, 'image/png')
    monkeypatch.setattr(media, 'fetch_bytes', fetch)
    original = copy.deepcopy(question)
    await media.resolve_media(None, [(BASE, '')], {'12': question}, db_session, owner)
    assert 'secret' not in str(question)
    assert '_url' not in str(question)
    assert not question['requires_manual_review']  # supported answer images can be sent to the vision grader
    assert {asset['role'] for asset in question['rich_content']['grading_assets']} == {'content', 'student_answer'}
    assert '    print(x)' in question['student_answer']
    again = copy.deepcopy(original)
    await media.resolve_media(None, [(BASE, '')], {'12': again}, db_session, owner)
    assert again == question
    assert await db_session.scalar(select(func.count()).select_from(ExternalMedia)) == 2
    candidate = await service.import_paper(db_session, owner, 'account',
        {'source_id': 'course', 'title': 'Python'}, {'source_id': 'work', 'title': '作业'},
        {'source_id': 'student', 'name': 'Test', 'student_no': '001'},
        {'questions': [question], 'declared_max_score': 100})
    # Read in a new identity map, independent of the browser session/cache.
    await db_session.commit()
    candidate_id = candidate.id
    db_session.expunge_all()
    paper = await service.detail(db_session, candidate_id, owner)
    item = paper['items'][0]
    assert item['rich_content'] == question['rich_content']
    assert item['status'] == 'pending'
    asset = uuid.UUID(item['rich_content']['content'][0]['asset_id'])
    response = await router.get_media(asset, SimpleNamespace(id=owner), db_session)
    assert response.body == PNG
    assert response.headers['x-content-type-options'] == 'nosniff'
    with pytest.raises(HTTPException) as exc:
        await router.get_media(asset, SimpleNamespace(id=uuid.uuid4()), db_session)
    assert exc.value.status_code == 404


async def test_partial_media_failure_preserves_other_content_and_does_not_grade(db_session, monkeypatch):
    question = parsers.review(HTML)['questions'][0]
    monkeypatch.setattr(media, 'attachment_status', AsyncMock(side_effect=ValueError('failed')))
    monkeypatch.setattr(media, 'fetch_bytes', AsyncMock(return_value=(PNG, 'image/png')))
    await media.resolve_media(None, [(BASE, '')], {'12': question}, db_session, uuid.uuid4())
    assert question['rich_content']['student_answer'][0]['unavailable']
    assert question['rich_content']['student_answer'][1]['asset_id']
    assert question['requires_manual_review']


async def test_media_fetch_rejects_redirect_outside_provider_and_oversized_stream(monkeypatch):
    real_client = httpx.AsyncClient
    session = SimpleNamespace(context=SimpleNamespace(cookies=AsyncMock(return_value=[])))
    requests = []
    def redirect(request):
        requests.append(request)
        return httpx.Response(302, headers={'location': 'http://127.0.0.1/private'})
    monkeypatch.setattr(media.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(redirect), **kw))
    with pytest.raises(ValueError, match='unsupported media host'):
        await media.fetch_bytes(session, 'https://p.ananas.chaoxing.com/image', BASE, 20)
    assert len(requests) == 1
    monkeypatch.setattr(media.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b'x' * 21)), **kw))
    with pytest.raises(ValueError, match='too large'):
        await media.fetch_bytes(session, 'https://p.ananas.chaoxing.com/image', BASE, 20)
    assert not media.media_url('javascript:alert(1)', BASE)
    assert not media.media_url('https://chaoxing.com.evil.test/a', BASE)
    assert media.image_mime(b'<svg onload="bad()"/>') is None


async def test_code_only_attachment_is_saved_and_available_to_text_grading(db_session, monkeypatch):
    question = parsers.review(HTML)['questions'][0]
    question['rich_content']['content'] = [{'kind': 'text', 'text': '编写程序'}]
    question['rich_content']['student_answer'] = question['rich_content']['student_answer'][:1]
    question.update(content='编写程序', reference_answer='print(1)', question_type='编程题')
    monkeypatch.setattr(media, 'attachment_status', AsyncMock(return_value={'download': 'https://d0.ananas.chaoxing.com/code'}))
    monkeypatch.setattr(media, 'fetch_bytes', AsyncMock(return_value=(b'print(1)', 'text/plain')))
    await media.resolve_media(None, [(BASE, '')], {'12': question}, db_session, uuid.uuid4())
    assert not question['requires_manual_review']
    assert question['rich_content']['student_answer'][0]['preview'] == 'print(1)'
    assert question['rich_content']['student_answer'][0]['asset_id']
    assert 'print(1)' in question['student_answer']


def test_migration_handles_existing_development_tables():
    import importlib.util
    from pathlib import Path
    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    path = Path(__file__).parents[1] / 'alembic/versions/20260924_chaoxing_media.py'
    spec = importlib.util.spec_from_file_location('cx_media_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine('sqlite://')
    with engine.begin() as connection:
        connection.exec_driver_sql('CREATE TABLE chaoxing_grading_items (id TEXT PRIMARY KEY)')
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.upgrade()  # also tolerates tables created by app startup
        assert 'rich_content' in {c['name'] for c in sa.inspect(connection).get_columns('chaoxing_grading_items')}
        assert 'chaoxing_media' in sa.inspect(connection).get_table_names()
    engine.dispose()


def test_navigation_links_do_not_turn_text_answers_into_manual_attachments():
    node = BeautifulSoup('<div>答案 <a href="javascript:void(0)">展开</a><a href="https://example.org/docs">参考文档</a><a href="https://p.ananas.chaoxing.com/a.png"><img src="https://p.ananas.chaoxing.com/a.png"></a></div>', 'html.parser').div
    parts = media.blocks(node)
    assert [part['kind'] for part in parts] == ['text', 'image']
    assert '参考文档' in parts[0]['text']

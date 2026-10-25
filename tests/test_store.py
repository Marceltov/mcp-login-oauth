from mcp_login_oauth import build_store


async def test_roundtrip_is_encrypted_on_disk(tmp_path):
    store = build_store(tmp_path, secret="k", salt="test")
    await store.put("a1", {"grant": {"token": "s3cret"}}, collection="access")
    assert await store.get("a1", collection="access") == {"grant": {"token": "s3cret"}}
    files = [p for p in tmp_path.rglob("*") if p.is_file()]
    assert files and not any(b"s3cret" in p.read_bytes() for p in files)


async def test_other_secret_reads_as_missing(tmp_path):
    await build_store(tmp_path, secret="k", salt="test").put("a1", {"x": 1}, collection="access")
    assert await build_store(tmp_path, secret="other", salt="test").get("a1", collection="access") is None


def test_file_store_uses_threads(tmp_path):
    build_store(tmp_path, secret="k", salt="test")
    import caio
    assert caio.AsyncioContext.__module__ == "caio.thread_aio_asyncio"

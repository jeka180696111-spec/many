"""Tests for BabyDiaryClient using a mocked Supabase client."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.integrations.supabase_baby import BabyDiaryClient, DiaryEntry, IntroducedFood


@pytest.fixture
def client() -> BabyDiaryClient:
    return BabyDiaryClient(
        url="https://example.supabase.co",
        service_role_key="service_role_key_test",
        family_id="family-123",
    )


def _make_supabase_mock(return_data: list[dict]) -> MagicMock:
    """Build a mock Supabase client where table() chains are sync and execute() is async."""
    execute_mock = AsyncMock(return_value=MagicMock(data=return_data))

    # Each chained call returns the same builder mock
    builder = MagicMock()
    builder.insert.return_value = builder
    builder.select.return_value = builder
    builder.upsert.return_value = builder
    builder.eq.return_value = builder
    builder.gte.return_value = builder
    builder.order.return_value = builder
    builder.limit.return_value = builder
    builder.execute = execute_mock

    # The Supabase client's .table() is synchronous — use plain MagicMock
    supabase = MagicMock()
    supabase.table.return_value = builder
    return supabase


@pytest.mark.asyncio
async def test_append_diary(client: BabyDiaryClient) -> None:
    entry_data = {
        "id": "uuid-1",
        "family_id": "family-123",
        "kind": "sleep",
        "event": "поспав 2 часа",
        "recorded_at": "2025-01-01T10:00:00",
        "amount": None,
        "unit": None,
        "details": None,
        "tags": [],
    }
    client._client = _make_supabase_mock([entry_data])

    entry = await client.append_diary(kind="sleep", event="поспав 2 часа")

    assert isinstance(entry, DiaryEntry)
    assert entry.kind == "sleep"
    assert entry.family_id == "family-123"


@pytest.mark.asyncio
async def test_get_diary_returns_list(client: BabyDiaryClient) -> None:
    rows = [
        {
            "id": f"uuid-{i}",
            "family_id": "family-123",
            "kind": "food",
            "event": f"еда {i}",
            "recorded_at": "2025-01-01T08:00:00",
            "amount": None,
            "unit": None,
            "details": None,
            "tags": [],
        }
        for i in range(3)
    ]
    client._client = _make_supabase_mock(rows)

    entries = await client.get_diary(days=7)

    assert len(entries) == 3
    assert all(isinstance(e, DiaryEntry) for e in entries)


@pytest.mark.asyncio
async def test_upsert_introduced_food(client: BabyDiaryClient) -> None:
    food_data = {
        "family_id": "family-123",
        "food": "морковь",
        "first_tried_at": "2025-01-01T00:00:00",
        "reaction": "ok",
        "notes": None,
    }
    client._client = _make_supabase_mock([food_data])

    food = await client.upsert_introduced_food(food="морковь", reaction="ok")

    assert isinstance(food, IntroducedFood)
    assert food.food == "морковь"
    assert food.reaction == "ok"


@pytest.mark.asyncio
async def test_get_introduced_foods(client: BabyDiaryClient) -> None:
    rows = [
        {"family_id": "family-123", "food": "яблоко", "first_tried_at": "2025-01-01T00:00:00", "reaction": "ok", "notes": None},
        {"family_id": "family-123", "food": "груша", "first_tried_at": "2025-01-02T00:00:00", "reaction": "unknown", "notes": None},
    ]
    client._client = _make_supabase_mock(rows)

    foods = await client.get_introduced_foods()

    assert len(foods) == 2
    assert foods[0].food == "яблоко"

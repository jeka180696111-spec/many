"""Supabase BabyDiary client using service_role key."""
from __future__ import annotations

from datetime import datetime
from typing import Any

import structlog
from pydantic import BaseModel
from supabase import AsyncClient, acreate_client

log = structlog.get_logger()


class DiaryEntry(BaseModel):
    id: str | None = None
    family_id: str
    kind: str  # sleep | food | medicine | note | symptom | milestone
    event: str
    recorded_at: str
    amount: float | None = None
    unit: str | None = None
    details: str | None = None
    tags: list[str] = []


class IntroducedFood(BaseModel):
    food: str
    first_tried_at: str
    reaction: str = "unknown"  # ok | rash | rejected | unknown
    notes: str | None = None


class BabyDiaryClient:
    """Async client for Supabase BabyDiary (service_role access)."""

    def __init__(self, url: str, service_role_key: str, family_id: str) -> None:
        self._url = url
        self._key = service_role_key
        self._family_id = family_id
        self._client: AsyncClient | None = None

    async def _get_client(self) -> AsyncClient:
        if self._client is None:
            self._client = await acreate_client(self._url, self._key)
        return self._client

    async def append_diary(
        self,
        kind: str,
        event: str,
        time: datetime | None = None,
        amount: float | None = None,
        unit: str | None = None,
        details: str = "",
    ) -> DiaryEntry:
        """Insert a new diary entry and return it."""
        client = await self._get_client()
        row: dict[str, Any] = {
            "family_id": self._family_id,
            "kind": kind,
            "event": event,
            "recorded_at": (time or datetime.utcnow()).isoformat(),
            "details": details or None,
        }
        if amount is not None:
            row["amount"] = amount
        if unit:
            row["unit"] = unit

        result = (
            await client.table("baby_diary")
            .insert(row)
            .execute()
        )
        data = result.data[0] if result.data else row
        log.info("baby_diary.append", kind=kind, entry=event[:40])
        return DiaryEntry(**data)

    async def get_diary(
        self,
        days: int = 7,
        kind: str | None = None,
    ) -> list[DiaryEntry]:
        """Fetch recent diary entries, optionally filtered by kind."""
        from datetime import timedelta
        client = await self._get_client()

        cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
        query = (
            client.table("baby_diary")
            .select("*")
            .eq("family_id", self._family_id)
            .gte("recorded_at", cutoff)
            .order("recorded_at", desc=True)
            .limit(100)
        )
        if kind:
            query = query.eq("kind", kind)

        result = await query.execute()
        return [DiaryEntry(**row) for row in (result.data or [])]

    async def get_introduced_foods(self) -> list[IntroducedFood]:
        """Return all foods the baby has tried."""
        client = await self._get_client()
        result = (
            await client.table("introduced_foods")
            .select("*")
            .eq("family_id", self._family_id)
            .order("first_tried_at", desc=True)
            .execute()
        )
        return [IntroducedFood(**row) for row in (result.data or [])]

    async def upsert_introduced_food(
        self,
        food: str,
        reaction: str = "unknown",
        notes: str | None = None,
    ) -> IntroducedFood:
        """Insert or update an introduced food record."""
        client = await self._get_client()
        row = {
            "family_id": self._family_id,
            "food": food,
            "first_tried_at": datetime.utcnow().isoformat(),
            "reaction": reaction,
            "notes": notes,
        }
        result = (
            await client.table("introduced_foods")
            .upsert(row, on_conflict="family_id,food")
            .execute()
        )
        data = result.data[0] if result.data else row
        log.info("baby_diary.food_upserted", food=food, reaction=reaction)
        return IntroducedFood(**data)

from __future__ import annotations
from typing import Any, TYPE_CHECKING
import structlog

from src.agents.base import BaseAgent
from src.db.models import FamilyMember, HealthRecord

if TYPE_CHECKING:
    from src.integrations.supabase_baby import BabyDiaryClient
    from src.db.memory import SharedMemory

log = structlog.get_logger()

class NannyAgent(BaseAgent):
    """
    Няня — tracks baby Matvey: sleep, food, medicine, development.
    Reads/writes Supabase BabyDiary.
    """

    agent_id = "nanny"
    emoji = "🤱"
    name = "Няня"

    def __init__(self, *args, baby_diary=None, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._baby_diary = baby_diary

    def get_system_prompt(self) -> str:
        from src.prompts.nanny import get_nanny_prompt
        # Load baby data from memory (sync-ish, defaults if not available)
        return get_nanny_prompt(
            birth_date="2025-08-01",  # Will be loaded from DB
            age_months=9,
            weight_kg=None,
            allergies=[],
            introduced_foods=[],
        )

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "write_baby_diary",
                "description": "Записать событие в дневник малыша в Google Sheets",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "enum": ["sleep", "food", "medicine", "note", "symptom", "milestone"]},
                        "event": {"type": "string", "description": "Описание события"},
                        "time": {"type": "string", "description": "Время в формате HH:MM или 'now'"},
                        "amount": {"type": "number"},
                        "unit": {"type": "string"},
                        "details": {"type": "string"},
                    },
                    "required": ["kind", "event"],
                },
            },
            {
                "name": "read_baby_diary",
                "description": "Прочитать записи дневника малыша",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "days": {"type": "integer", "default": 7},
                        "kind": {"type": "string"},
                    },
                },
            },
            {
                "name": "ask_user",
                "description": "Задать уточняющий вопрос пользователю",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "question": {"type": "string"},
                    },
                    "required": ["question"],
                },
            },
        ]

    async def _call_tool(self, tool_name: str, tool_input: dict[str, Any]) -> Any:
        from src.utils.time import now_kyiv
        from datetime import datetime

        if tool_name == "write_baby_diary":
            if self._baby_diary:
                time_str = tool_input.get("time", "now")
                if time_str == "now":
                    dt = now_kyiv()
                else:
                    try:
                        t = datetime.strptime(time_str, "%H:%M").time()
                        dt = now_kyiv().replace(hour=t.hour, minute=t.minute)
                    except ValueError:
                        dt = now_kyiv()

                entry = await self._baby_diary.append_diary(
                    kind=tool_input.get("kind", "note"),
                    event=tool_input.get("event", ""),
                    time=dt,
                    amount=tool_input.get("amount"),
                    unit=tool_input.get("unit"),
                    details=tool_input.get("details", ""),
                )
                return {"success": True, "id": entry.id}
            return {"success": True, "note": "baby_diary not configured"}

        elif tool_name == "read_baby_diary":
            if self._baby_diary:
                entries = await self._baby_diary.get_diary(
                    days=tool_input.get("days", 7),
                    kind=tool_input.get("kind"),
                )
                return [e.model_dump() for e in entries[:20]]
            return []

        elif tool_name == "ask_user":
            return {"question_sent": tool_input.get("question")}

        return await super()._call_tool(tool_name, tool_input)

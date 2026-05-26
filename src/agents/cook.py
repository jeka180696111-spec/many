from __future__ import annotations
from typing import Any
import structlog

from src.agents.base import BaseAgent

log = structlog.get_logger()

class CookAgent(BaseAgent):
    """Гурман — recipes, baby food introduction tracking, web search for recipes."""

    agent_id = "cook"
    emoji = "🍳"
    name = "Гурман"

    def __init__(self, *args, web_search=None, baby_diary=None, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._search = web_search
        self._baby_diary = baby_diary

    def get_system_prompt(self) -> str:
        from src.prompts.cook import get_cook_prompt
        return get_cook_prompt(introduced_foods=[], baby_age_months=9)

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "web_search",
                "description": "Поиск рецептов в интернете",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "log_new_food",
                "description": "Записать новый продукт прикорма",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "food": {"type": "string"},
                        "reaction": {"type": "string", "enum": ["ok", "rash", "rejected", "unknown"]},
                        "notes": {"type": "string"},
                    },
                    "required": ["food"],
                },
            },
            {
                "name": "get_introduced_foods",
                "description": "Посмотреть что малыш уже пробовал",
                "input_schema": {
                    "type": "object",
                    "properties": {},
                },
            },
        ]

    async def _call_tool(self, tool_name: str, tool_input: dict[str, Any]) -> Any:
        if tool_name == "web_search" and self._search:
            results = await self._search.search(tool_input["query"])
            return [{"title": r.title, "snippet": r.snippet, "url": r.url} for r in results[:3]]

        elif tool_name == "log_new_food":
            if self._baby_diary:
                food = await self._baby_diary.upsert_introduced_food(
                    food=tool_input["food"],
                    reaction=tool_input.get("reaction", "unknown"),
                    notes=tool_input.get("notes"),
                )
                return {"success": True, "food": food.food}
            return {"success": True, "note": "baby_diary not configured"}

        elif tool_name == "get_introduced_foods":
            if self._baby_diary:
                foods = await self._baby_diary.get_introduced_foods()
                return [{"food": f.food, "reaction": f.reaction, "tried": f.first_tried_at} for f in foods]
            return []

        return await super()._call_tool(tool_name, tool_input)

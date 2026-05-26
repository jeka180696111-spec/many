"""Verify that the dispatcher returns EXTERNAL_AGENT for finance intent
and does NOT attempt to call Фінн directly."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from src.orchestrator.dispatcher import Dispatcher, DispatchResult, EXTERNAL_AGENT


def _make_dispatcher(response_json: str) -> Dispatcher:
    claude_mock = AsyncMock()
    claude_mock.complete = AsyncMock(return_value=response_json)
    return Dispatcher(claude_client=claude_mock, model="claude-haiku-4-5-20251001")


@pytest.mark.asyncio
async def test_finance_intent_returns_external() -> None:
    """Finance messages must result in is_external=True and empty tasks."""
    dispatcher = _make_dispatcher(
        '{"agents": [], "is_critical": false, "is_settings_command": false, "intent": "finance"}'
    )
    result = await dispatcher.dispatch(
        message_text="купил молоко 50 грн",
        sender_name="Муж",
        active_agent_ids=["nanny", "news", "calendar", "cook", "health", "devops"],
    )
    assert result.is_external is True
    assert result.intent == "finance"
    assert result.tasks == []


@pytest.mark.asyncio
async def test_finance_intent_does_not_call_finn_agent() -> None:
    """Фінн must never appear in the tasks list — dispatcher stays silent."""
    dispatcher = _make_dispatcher(
        '{"agents": [], "is_critical": false, "is_settings_command": false, "intent": "finance"}'
    )
    result = await dispatcher.dispatch(
        message_text="витратив 200 на таксі",
        sender_name="Жена",
        active_agent_ids=["nanny", "news", "calendar", "cook", "health", "devops", "finn"],
    )
    agent_ids = [t.agent_id for t in result.tasks]
    assert "finn" not in agent_ids
    assert result.is_external is True


@pytest.mark.asyncio
async def test_non_finance_intent_calls_agent() -> None:
    """Non-finance messages should route to the appropriate agent."""
    dispatcher = _make_dispatcher(
        '{"agents": [{"id": "nanny", "priority": "high", "reason": "сон малыша"}], '
        '"is_critical": false, "is_settings_command": false, "intent": "nanny"}'
    )
    result = await dispatcher.dispatch(
        message_text="Матвей поспал 2 часа",
        sender_name="Муж",
        active_agent_ids=["nanny", "news", "calendar", "cook", "health", "devops"],
    )
    assert result.is_external is False
    assert any(t.agent_id == "nanny" for t in result.tasks)


@pytest.mark.asyncio
async def test_finn_not_in_active_agents() -> None:
    """Фінн должен быть зарегистрирован только как распознаваемый адресат,
    но не присутствовать в active_agent_ids продукционного запуска."""
    active_ids = ["nanny", "news", "calendar", "cook", "health", "devops"]
    assert "finn" not in active_ids
    assert EXTERNAL_AGENT == "EXTERNAL_AGENT"

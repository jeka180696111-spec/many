"""Railway API client — monitor and restart services."""
from __future__ import annotations

import asyncio
from typing import Any

import structlog

log = structlog.get_logger()

_RAILWAY_GRAPHQL = "https://backboard.railway.app/graphql/v2"

_SERVICE_QUERY = """
query GetService($serviceId: String!) {
  service(id: $serviceId) {
    id
    name
    serviceInstances {
      edges {
        node {
          id
          status
          updatedAt
        }
      }
    }
  }
}
"""

_REDEPLOY_MUTATION = """
mutation ServiceInstanceRedeploy($serviceId: String!, $environmentId: String!) {
  serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
}
"""


class ServiceStatus(dict[str, Any]):
    pass


class RailwayClient:
    """Async Railway API client (GraphQL v2)."""

    def __init__(self, api_token: str, project_id: str) -> None:
        self._token = api_token
        self._project_id = project_id

    async def _gql(self, query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        """Execute a GraphQL request against the Railway API."""
        import aiohttp
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }
        payload: dict[str, Any] = {"query": query}
        if variables:
            payload["variables"] = variables

        for attempt in range(4):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(_RAILWAY_GRAPHQL, json=payload, headers=headers) as resp:
                        resp.raise_for_status()
                        data = await resp.json()
                        if "errors" in data:
                            raise RuntimeError(f"GraphQL errors: {data['errors']}")
                        return data.get("data", {})
            except Exception as exc:
                if attempt == 3:
                    raise
                wait = 2 ** attempt
                log.warning("railway_api.retry", attempt=attempt, error=str(exc), wait=wait)
                await asyncio.sleep(wait)
        return {}

    async def get_service_status(self, service_id: str) -> ServiceStatus:
        """Return current status of a Railway service."""
        data = await self._gql(_SERVICE_QUERY, {"serviceId": service_id})
        service = data.get("service", {})
        instances = [
            edge["node"]
            for edge in service.get("serviceInstances", {}).get("edges", [])
        ]
        status = instances[0].get("status", "UNKNOWN") if instances else "UNKNOWN"
        log.info("railway.service_status", service_id=service_id, status=status)
        return ServiceStatus(
            service_id=service_id,
            name=service.get("name", ""),
            status=status,
            instances=instances,
        )

    async def restart_service(self, service_id: str, environment_id: str) -> bool:
        """Trigger a redeploy (restart) for a service instance."""
        await self._gql(
            _REDEPLOY_MUTATION,
            {"serviceId": service_id, "environmentId": environment_id},
        )
        log.info("railway.service_restarted", service_id=service_id)
        return True

    async def get_project_services(self) -> list[ServiceStatus]:
        """List all services in the configured project."""
        query = """
        query GetProject($projectId: String!) {
          project(id: $projectId) {
            services {
              edges {
                node {
                  id
                  name
                  serviceInstances {
                    edges {
                      node {
                        id
                        status
                        updatedAt
                      }
                    }
                  }
                }
              }
            }
          }
        }
        """
        data = await self._gql(query, {"projectId": self._project_id})
        services = []
        for edge in data.get("project", {}).get("services", {}).get("edges", []):
            svc = edge["node"]
            instances = [
                e["node"]
                for e in svc.get("serviceInstances", {}).get("edges", [])
            ]
            status = instances[0].get("status", "UNKNOWN") if instances else "UNKNOWN"
            services.append(ServiceStatus(
                service_id=svc["id"],
                name=svc["name"],
                status=status,
                instances=instances,
            ))
        return services

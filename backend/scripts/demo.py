"""Run against the local API: python scripts/demo.py [http://127.0.0.1:8000]."""

import sys

import httpx

BUSINESS = {"X-Actor-ID": "business-1"}
STUDENT = {"X-Actor-ID": "student-1"}


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
    with httpx.Client(base_url=base, timeout=40) as client:

        def call(method, path, headers=BUSINESS, body=None):
            response = client.request(method, f"/api/v1{path}", headers=headers, json=body)
            response.raise_for_status()
            return response.json()

        task = call(
            "POST",
            "/tasks",
            body={
                "raw_description": "Хотим реже сталкиваться с нехваткой товара в магазине.",
                "topic": "retail",
                "title": "Прогноз остатков — демо",
            },
        )
        path = f"/tasks/{task['id']}"
        print(f"Created task {task['id']}, score={task['rating']['score']}")
        assistance = call("POST", f"{path}/assist", body={})
        print(
            f"Assistant provider={assistance['provider']}, questions={len(assistance['questions'])}"
        )
        card = assistance["suggested_card"]
        card.update(
            {
                "need": "Сократить ручную работу закупщика.",
                "users": "Закупщик магазина",
                "data": "CSV продаж и остатков за полгода.",
                "constraints": "2 недели, Python, только тестовые данные.",
                "expected_result": "Прототип прогноза с инструкцией.",
                "success_criteria": "Ошибка прогноза ниже 15% на тестовой выборке.",
                "contact": "demo@example.com",
                "interaction_format": "Созвон каждую неделю.",
            }
        )
        task = call(
            "PUT", f"{path}/card", body={"expected_revision": task["revision"], "card": card}
        )
        revision = {"expected_revision": task["revision"]}
        task = call("POST", f"{path}/confirm", body=revision)
        print(f"Confirmed score={task['rating']['score']}, readiness={task['rating']['readiness']}")
        call("POST", f"{path}/publish", body=revision)
        public = call("GET", f"/catalog/{task['id']}", headers={})
        assert public["rating"]["score"] == 100
        team = client.get("/api/v1/teams/me", headers=STUDENT)
        if team.status_code == 409 and team.json()["error"]["code"] == "TEAM_REQUIRED":
            call(
                "PUT",
                "/teams/me",
                headers=STUDENT,
                body={
                    "name": "WhyNot Demo",
                    "interests": ["retail"],
                    "skills": ["ML"],
                    "technologies": ["Python"],
                },
            )
        else:
            team.raise_for_status()
        proposal = call(
            "POST",
            f"{path}/proposals",
            headers=STUDENT,
            body={
                "idea": "Построить прогноз спроса по истории продаж.",
                "plan": "Проверить данные, собрать базовую модель и показать прототип.",
                "timeline": "2 недели",
                "prototype_url": "https://example.com/demo",
            },
        )
        proposal_path = f"/proposals/{proposal['id']}"
        chosen = call("POST", f"{proposal_path}/decision", body={"decision": "accepted"})
        assert chosen["status"] == "accepted"
        milestone = call(
            "POST",
            f"{proposal_path}/milestones",
            body={
                "code": "prototype",
                "evidence": "Демонстрационный этап проверен бизнесом.",
            },
        )
        print(f"Published; proposal accepted manually; milestone points={milestone['points']}")
        print(f"Catalog card: {base}/api/v1/catalog/{task['id']}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Run a real, isolated-account QA workflow against a development Tapsyrma API.

Creates clearly named QA accounts/tasks; it does not delete existing data. Passwords
and separate cookie jars live only in memory and never enter the JSON report.
Uses only the Python standard library. Example:
  python3 scripts/qa-workflow.py --base-url http://localhost:5173/api/v1
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import http.cookiejar
import json
from pathlib import Path
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request


class QAError(Exception):
    """An already-sanitized check failure."""


class Client:
    def __init__(self, base_url: str, label: str):
        self.base_url = base_url.rstrip('/')
        parsed = urllib.parse.urlsplit(self.base_url)
        self.origin = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))
        self.label = label
        self.actor: dict = {}
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def call(self, path: str, method: str = 'GET', body: dict | None = None) -> tuple[int, dict | list]:
        headers = {'Accept': 'application/json', 'Origin': self.origin}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(self.base_url + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=30) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read()
        except urllib.error.URLError as error:
            raise QAError(f'{self.label}: соединение с API недоступно') from error
        try:
            return status, json.loads(raw)
        except (ValueError, UnicodeDecodeError) as error:
            raise QAError(f'{self.label}: API вернул не JSON (HTTP {status})') from error


class Workflow:
    def __init__(self, base_url: str, run_id: str):
        self.base_url = base_url
        self.run_id = run_id
        self.checks: list[dict] = []
        self.report: dict = {'run_id': run_id, 'started_at': datetime.now(timezone.utc).isoformat(),
                             'base_url': base_url, 'accounts': [], 'checks': self.checks,
                             'protected_requests': [], 'xp_timeline': []}

    def check(self, label: str, actual, expected):
        passed = actual == expected
        self.checks.append({'name': label, 'passed': passed, 'actual': actual, 'expected': expected})
        if not passed:
            raise QAError(f'Проверка не пройдена: {label}')

    def request(self, client: Client, path: str, method: str = 'GET', body: dict | None = None,
                expected: int = 200, code: str | None = None):
        status, payload = client.call(path, method, body)
        label = f'{client.label}: {method} {path}'
        self.check(label + ' status', status, expected)
        if code:
            actual_code = payload.get('error', {}).get('code') if isinstance(payload, dict) else None
            self.check(label + ' error', actual_code, code)
            self.report['protected_requests'].append({'actor': client.label, 'method': method,
                'path': path, 'status': status, 'code': actual_code})
        return payload

    def register(self, label: str, role: str) -> Client:
        client = Client(self.base_url, label)
        email = f'qa-api-{self.run_id}-{label}@example.test'
        password = secrets.token_urlsafe(24)
        session = self.request(client, '/auth/register', 'POST', {
            'name': f'QA API {self.run_id} {label}', 'email': email,
            'password': password, 'role': role,
        }, 201)
        client.actor = session['actor']
        self.check(f'{label}: registered role', client.actor['role'], role)
        self.request(client, '/auth/logout', 'POST')
        self.request(client, '/auth/me', expected=401, code='LOGIN_REQUIRED')
        session = self.request(client, '/auth/login', 'POST', {'email': email, 'password': password})
        self.check(f'{label}: login identity', session['actor']['id'], client.actor['id'])
        self.report['accounts'].append({'label': label, 'id': client.actor['id'], 'role': role, 'email': email})
        return client

    def points(self, students: list[Client], expected: list[int], phase: str):
        actual = [self.request(student, '/teams/me')['points'] for student in students]
        self.check(f'XP: {phase}', actual, expected)
        self.report['xp_timeline'].append({'phase': phase, 'points': actual})

    def run(self):
        guest = Client(self.base_url, 'guest')
        self.request(guest, '/catalog?limit=1')
        business = self.register('business', 'business')
        outsider = self.register('other-business', 'business')
        students = [self.register(f'student{index}', 'student') for index in range(1, 4)]
        teams = []
        for index, student in enumerate(students, 1):
            team = self.request(student, '/teams/me', 'PUT', {
                'name': f'QA API {self.run_id} Команда {index}', 'interests': ['retail'],
                'skills': ['Аналитика', 'Тестирование'], 'technologies': ['Python', 'React'],
            })
            self.check(f'student{index}: team owner', team['owner_id'], student.actor['id'])
            teams.append(team)
        self.check('Три отдельные команды', len({team['id'] for team in teams}), 3)
        self.report['team_ids'] = [team['id'] for team in teams]
        self.points(students, [0, 0, 0], 'после создания команд')

        task = self.request(business, '/tasks', 'POST', {
            'title': f'QA API {self.run_id}: прогноз запасов', 'topic': 'retail',
            'raw_description': 'Тестовая задача QA: нужен прогноз запасов на синтетических данных магазина.',
        }, 201)
        task_id = task['id']
        self.report['task_id'] = task_id
        card = {
            'title': f'QA API {self.run_id}: прогноз запасов', 'topic': 'retail',
            'context': 'Учебный магазин вручную рассчитывает остатки синтетических товаров.',
            'need': 'Сократить время планирования закупок и число ошибок расчёта.',
            'users': 'Тестовый менеджер магазина и тестовый закупщик.',
            'data': 'Синтетический CSV: 1000 строк продаж за шесть месяцев, без персональных данных.',
            'constraints': 'Две недели, без платных сервисов; Python и React.',
            'expected_result': 'Прототип прогноза остатков с интерфейсом и инструкцией запуска.',
            'success_criteria': 'Правильный расчёт минимум для 18 из 20 заранее согласованных сценариев.',
            'contact': 'qa-project@example.test',
            'interaction_format': 'Тестовый созвон раз в неделю; отзыв на демонстрацию в течение двух дней.',
        }
        task = self.request(business, f'/tasks/{task_id}/card', 'PUT', {'card': card, 'expected_revision': task['revision']})
        self.request(business, f'/tasks/{task_id}/publish', 'POST', {'expected_revision': task['revision']}, 409, 'CONFIRMATION_REQUIRED')
        task = self.request(business, f'/tasks/{task_id}/confirm', 'POST', {'expected_revision': task['revision']})
        self.check('Полная подтверждённая карточка: рейтинг', task['rating']['score'], 100)
        task = self.request(business, f'/tasks/{task_id}/publish', 'POST', {'expected_revision': task['revision']})
        self.check('Задача опубликована', task['published_revision'], task['revision'])
        public_task = self.request(guest, f'/catalog/{task_id}')
        self.check('Публичная карточка: рейтинг', public_task['rating']['score'], 100)
        self.report['published_score'] = public_task['rating']['score']
        self.request(outsider, f'/tasks/{task_id}', expected=404, code='TASK_NOT_FOUND')
        self.request(students[0], '/business/history', expected=403, code='BUSINESS_REQUIRED')

        proposals = []
        inputs = []
        for index, student in enumerate(students, 1):
            payload = {'idea': f'QA команда {index}: предлагаем прототип расчёта запасов.',
                       'plan': 'Проверить CSV, реализовать расчёт, протестировать 20 сценариев, передать инструкцию.',
                       'timeline': 'Две недели после согласования исходных данных.',
                       'prototype_url': None}
            inputs.append(payload)
            proposal = self.request(student, f'/tasks/{task_id}/proposals', 'POST', payload, 201)
            self.check(f'Отклик {index}: pending', proposal['status'], 'pending')
            self.check(f'Отклик {index}: команда', proposal['team_id'], teams[index - 1]['id'])
            proposals.append(proposal)
        self.points(students, [0, 0, 0], 'после трёх откликов')
        accepted_id, rejected_id, pending_id = [proposal['id'] for proposal in proposals]
        self.report['proposal_ids'] = {'accepted': accepted_id, 'rejected': rejected_id, 'pending': pending_id}

        accepted = self.request(business, f'/proposals/{accepted_id}/decision', 'POST', {'decision': 'accepted', 'note': 'QA: начинаем работу.'})
        self.check('Ручное принятие', accepted['status'], 'accepted')
        rejected = self.request(business, f'/proposals/{rejected_id}/decision', 'POST', {'decision': 'rejected', 'note': 'QA: выбран другой вариант решения.'})
        self.check('Ручной отказ', rejected['status'], 'rejected')
        self.points(students, [0, 0, 0], 'после принятия и отказа')
        repeat_decision = self.request(business, f'/proposals/{accepted_id}/decision', 'POST', {'decision': 'accepted', 'note': 'QA: повторный запрос.'})
        self.check('Повтор принятия не меняет решение', repeat_decision['id'], accepted_id)
        self.check('Повтор принятия сохраняет исходную заметку', repeat_decision['decision_note'], accepted['decision_note'])
        self.request(business, f'/proposals/{accepted_id}/decision', 'POST', {'decision': 'rejected'}, 409, 'DECISION_FINAL')
        self.request(business, f'/proposals/{rejected_id}/decision', 'POST', {'decision': 'accepted'}, 409, 'DECISION_FINAL')

        evidence = {'prototype': 'QA: прототип проверен бизнесом на 20 синтетических сценариях, результаты соответствуют критериям.',
                    'pilot': 'QA: пилот проверен бизнесом на согласованном тестовом наборе магазина, замечания исправлены.',
                    'delivery': 'QA: бизнес проверил передачу исходников, инструкции запуска и итогового отчёта команды.'}
        prototype_input = {'code': 'prototype', 'evidence': evidence['prototype']}
        for proposal_id in [rejected_id, pending_id]:
            self.request(business, f'/proposals/{proposal_id}/milestones', 'POST', prototype_input, 409, 'TEAM_NOT_SELECTED')
        self.request(outsider, f'/proposals/{accepted_id}/decision', 'POST', {'decision': 'accepted'}, 404, 'PROPOSAL_NOT_FOUND')
        self.request(outsider, f'/proposals/{accepted_id}/milestones', 'POST', prototype_input, 404, 'PROPOSAL_NOT_FOUND')
        for student in students:
            self.request(student, f'/proposals/{accepted_id}/milestones', 'POST', prototype_input, 403, 'BUSINESS_REQUIRED')
        self.request(students[0], f'/proposals/{accepted_id}/decision', 'POST', {'decision': 'accepted'}, 403, 'BUSINESS_REQUIRED')
        self.request(guest, f'/proposals/{accepted_id}/milestones', 'POST', prototype_input, 401, 'LOGIN_REQUIRED')
        self.request(students[0], '/teams/me', 'PUT', {'name': teams[0]['name'], 'points': 9999}, 422, 'VALIDATION_ERROR')
        self.points(students, [0, 0, 0], 'после запрещённых попыток начисления XP')

        milestones = []
        for code, delta, total in [('prototype', 20, 20), ('pilot', 30, 50), ('delivery', 50, 100)]:
            payload = {'code': code, 'evidence': evidence[code]}
            milestone = self.request(business, f'/proposals/{accepted_id}/milestones', 'POST', payload)
            self.check(f'{code}: начисление за этап', milestone['points'], delta)
            self.check(f'{code}: подтвердил владелец бизнеса', milestone['confirmed_by'], business.actor['id'])
            self.points(students, [total, 0, 0], f'после {code}')
            repeat = self.request(business, f'/proposals/{accepted_id}/milestones', 'POST', payload)
            self.check(f'{code}: повтор возвращает тот же этап', repeat['id'], milestone['id'])
            self.request(business, f'/proposals/{accepted_id}/milestones', 'POST', {'code': code, 'evidence': evidence[code] + ' Другой результат.'}, 409, 'MILESTONE_EXISTS')
            self.points(students, [total, 0, 0], f'после повтора и конфликта {code}')
            milestones.append(milestone)
        stored = self.request(business, f'/proposals/{accepted_id}/milestones')
        self.check('В базе ровно три этапа', len(stored), 3)
        self.check('Сумма начислений по этапам', sum(stage['points'] for stage in stored), 100)

        duplicate_status, duplicate = students[2].call(f'/tasks/{task_id}/proposals', 'POST', inputs[2])
        if duplicate_status == 201:
            self.check('Дубликат отклика получает отдельный id', duplicate['id'] != pending_id, True)
            self.check('Дубликат не принимается автоматически', duplicate['status'], 'pending')
            duplicate_behavior = 'allowed_as_new_pending_proposal'
            pending_count = 2
        elif duplicate_status == 409:
            duplicate_behavior = 'rejected_with_conflict'
            pending_count = 1
        else:
            raise QAError(f'Неожиданный HTTP {duplicate_status} при повторном отклике')
        self.report['duplicate_proposal'] = {'status': duplicate_status, 'behavior': duplicate_behavior}
        self.points(students, [100, 0, 0], 'после повторного отклика')
        all_proposals = self.request(business, f'/tasks/{task_id}/proposals')
        statuses = dict(Counter(proposal['status'] for proposal in all_proposals))
        self.check('Статусы всех откликов', statuses, {'accepted': 1, 'rejected': 1, 'pending': pending_count})
        self.report['proposal_status_counts'] = statuses

        owner_history = self.request(business, '/business/history?limit=100&offset=0')
        self.check('История владельца содержит только его задачу', [row['task']['id'] for row in owner_history['items']], [task_id])
        self.check('История владельца: три подтверждённых этапа', sum(len(proposal['milestones']) for row in owner_history['items'] for proposal in row['proposals']), 3)
        foreign_history = self.request(outsider, '/business/history?limit=100&offset=0')
        self.check('Чужому бизнесу история не видна', foreign_history['total'], 0)
        for index, student in enumerate(students):
            history = self.request(student, '/students/history?limit=100&offset=0')
            self.check(f'student{index + 1}: только свои отклики', all(row['proposal']['team_id'] == teams[index]['id'] for row in history['items']), True)
            self.check(f'student{index + 1}: число откликов в истории', history['total'], [1, 1, pending_count][index])
            self.check(f'student{index + 1}: XP в истории', sum(stage['points'] for row in history['items'] for stage in row['milestones']), [100, 0, 0][index])
        public_teams = self.request(guest, '/teams')
        by_id = {team['id']: team for team in public_teams}
        self.check('Публичные команды показывают те же XP', [by_id[team['id']]['points'] for team in teams], [100, 0, 0])
        self.report['milestone_points'] = {stage['code']: stage['points'] for stage in milestones}
        self.report['final_team_points'] = [100, 0, 0]
        self.report['passed'] = True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://localhost:5173/api/v1')
    parser.add_argument('--output', type=Path, help='JSON report path; no passwords or cookies are written.')
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.base_url)
    if parsed.scheme not in {'http', 'https'} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        parser.error('--base-url must be an http(s) API URL without credentials, query or fragment')
    run_id = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(2)
    output = args.output or Path(__file__).resolve().parents[1] / '.runtime' / f'qa-workflow-{run_id}.json'
    workflow = Workflow(args.base_url.rstrip('/'), run_id)
    exit_code = 0
    try:
        workflow.run()
    except QAError as error:
        workflow.report.update(passed=False, failure=str(error))
        exit_code = 1
    except Exception as error:
        # Never print arbitrary exception text that could include request credentials.
        workflow.report.update(passed=False, failure=f'Неожиданная ошибка сценария: {type(error).__name__}')
        exit_code = 1
    workflow.report['finished_at'] = datetime.now(timezone.utc).isoformat()
    workflow.report['checks_passed'] = sum(check['passed'] for check in workflow.checks)
    workflow.report['checks_total'] = len(workflow.checks)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(workflow.report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: workflow.report[key] for key in ['run_id', 'passed', 'checks_passed', 'checks_total',
                     'final_team_points', 'milestone_points', 'proposal_status_counts', 'duplicate_proposal', 'failure']
                     if key in workflow.report} | {'report': str(output)}, ensure_ascii=False, indent=2))
    return exit_code


if __name__ == '__main__':
    sys.exit(main())

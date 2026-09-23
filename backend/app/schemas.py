from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, StringConstraints, model_validator

Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=8000)]
RequiredText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8000)
]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
CardField = Literal[
    "title",
    "topic",
    "context",
    "need",
    "users",
    "data",
    "constraints",
    "expected_result",
    "success_criteria",
    "contact",
    "interaction_format",
]
Readiness = Literal["draft", "working", "ready", "priority"]


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class Card(Schema):
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    topic: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] = ""
    context: Text = ""
    need: Text = ""
    users: Text = ""
    data: Text = ""
    constraints: Text = ""
    expected_result: Text = ""
    success_criteria: Text = ""
    contact: Text = ""
    interaction_format: Text = ""


class TaskCreate(Schema):
    raw_description: RequiredText
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    topic: Tag


class RevisionInput(Schema):
    expected_revision: int = Field(ge=1)


class CardUpdate(RevisionInput):
    card: Card


class ScoreItem(Schema):
    key: str
    label: str
    points: int
    max_points: int
    missing_fields: list[CardField]
    unconfirmed_fields: list[CardField]
    suggestion: str


class Rating(Schema):
    score: int
    preview_score: int
    readiness: Readiness
    breakdown: list[ScoreItem]
    missing_fields: list[CardField]
    unconfirmed_fields: list[CardField]


class TaskView(Schema):
    id: str
    owner_id: str
    raw_description: str
    card: Card
    revision: int
    confirmed_revision: int | None
    published_revision: int | None
    confirmed_fields: list[CardField]
    status: Literal["draft", "published"]
    rating: Rating
    created_at: datetime


class CatalogTask(Schema):
    id: str
    card: Card
    revision: int
    rating: Rating
    published_at: datetime


class CatalogPage(Schema):
    items: list[CatalogTask]
    total: int
    limit: int
    offset: int


class ActorView(Schema):
    id: str
    name: str
    role: Literal["business", "student"]


class TeamInput(Schema):
    name: ShortText
    interests: list[Tag] = Field(default_factory=list, max_length=30)
    skills: list[Tag] = Field(default_factory=list, max_length=30)
    technologies: list[Tag] = Field(default_factory=list, max_length=30)


class TeamView(TeamInput):
    id: str
    owner_id: str
    points: int = 0


class ProposalCreate(Schema):
    idea: RequiredText
    plan: RequiredText
    timeline: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    prototype_url: HttpUrl | None = Field(default=None, max_length=2000)


class ProposalView(Schema):
    id: str
    task_id: str
    team_id: str
    idea: str
    plan: str
    timeline: str
    prototype_url: str | None
    status: Literal["pending", "accepted", "rejected"]
    decision_note: str
    created_at: datetime
    decided_at: datetime | None


class DecisionInput(Schema):
    decision: Literal["accepted", "rejected"]
    note: Text = ""


class MilestoneInput(Schema):
    code: Literal["prototype", "pilot", "delivery"]
    evidence: RequiredText


class MilestoneView(MilestoneInput):
    id: str
    proposal_id: str
    points: int
    confirmed_by: str
    confirmed_at: datetime


class AssistInput(Schema):
    answers: dict[CardField, RequiredText] = Field(default_factory=dict, max_length=11)

    @model_validator(mode="after")
    def validate_card_field_lengths(self):
        Card.model_validate(self.answers)
        return self


class Question(Schema):
    field: CardField
    question: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=5, max_length=1000)
    ]


class AIQuestions(Schema):
    questions: list[Question] = Field(min_length=3, max_length=8)

    @model_validator(mode="after")
    def distinct_questions(self):
        if len({q.field for q in self.questions}) != len(self.questions):
            raise ValueError("Questions must target distinct fields")
        if len({q.question.casefold() for q in self.questions}) != len(self.questions):
            raise ValueError("Questions must be distinct")
        return self


class AssistView(AIQuestions):
    provider: Literal["stub", "ollama", "openai"]
    fallback_reason: str | None = None
    based_on_revision: int
    suggested_card: Card
    missing_fields: list[CardField]


class ErrorBody(Schema):
    code: str
    message: str


class ErrorResponse(Schema):
    error: ErrorBody

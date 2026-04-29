"""Models package — import all models so Base.metadata sees them."""
from app.models.annotation import Annotation, AnnotationFieldType, AnnotationSource
from app.models.annotation_revision import AnnotationRevision, RevisionAction
from app.models.base import Base, TimestampMixin, gen_uuid
from app.models.document import Document, DocumentStatus
from app.models.evaluation_field_result import EvaluationFieldResult
from app.models.evaluation_run import EvaluationRun
from app.models.processing_result import ProcessingResult, ProcessingResultSource
from app.models.project import Project
from app.models.prompt_version import PromptVersion
from app.models.user import User
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember, WorkspaceRole

__all__ = [
    "Base", "TimestampMixin", "gen_uuid",
    "Annotation", "AnnotationFieldType", "AnnotationSource",
    "AnnotationRevision", "RevisionAction",
    "Document", "DocumentStatus",
    "EvaluationFieldResult",
    "EvaluationRun",
    "ProcessingResult", "ProcessingResultSource",
    "Project",
    "PromptVersion",
    "User", "Workspace", "WorkspaceMember", "WorkspaceRole",
]

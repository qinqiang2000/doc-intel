"""Models package — import all models so Base.metadata sees them."""
from app.models.annotation import Annotation, AnnotationFieldType, AnnotationSource
from app.models.base import Base, TimestampMixin, gen_uuid
from app.models.document import Document, DocumentStatus
from app.models.processing_result import ProcessingResult, ProcessingResultSource
from app.models.project import Project
from app.models.user import User
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember, WorkspaceRole

__all__ = [
    "Base", "TimestampMixin", "gen_uuid",
    "Annotation", "AnnotationFieldType", "AnnotationSource",
    "Document", "DocumentStatus",
    "ProcessingResult", "ProcessingResultSource",
    "Project",
    "User", "Workspace", "WorkspaceMember", "WorkspaceRole",
]

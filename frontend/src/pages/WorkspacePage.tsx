import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, extractApiError } from "../lib/api-client";
import AdvancedPanel from "../components/workspace/AdvancedPanel";
import BboxOverlay from "../components/workspace/BboxOverlay";
import DocumentCanvas from "../components/workspace/DocumentCanvas";
import JsonPreview from "../components/workspace/JsonPreview";
import WorkspaceToolbar from "../components/workspace/WorkspaceToolbar";
import AnnotationEditor from "../components/predict/AnnotationEditor";
import {
  usePredictStore,
  type Annotation,
  type AnnotationPatch,
  type NewAnnotation,
} from "../stores/predict-store";

interface DocBrief {
  id: string;
  filename: string;
  mime_type?: string;
}

interface DocDetail extends DocBrief {
  mime_type: string;
}

export default function WorkspacePage() {
  const { slug, pid } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const docId = searchParams.get("doc");

  const [docs, setDocs] = useState<DocBrief[]>([]);
  const [currentDoc, setCurrentDoc] = useState<DocDetail | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const result = usePredictStore((s) => (docId ? s.results[docId] : null));
  const loading = usePredictStore((s) => (docId ? s.loading[docId] ?? false : false));
  const selectedAnnotationId = usePredictStore((s) => s.selectedAnnotationId);
  const setSelectedAnnotationId = usePredictStore((s) => s.setSelectedAnnotationId);
  const predictSingle = usePredictStore((s) => s.predictSingle);
  const loadAnnotations = usePredictStore((s) => s.loadAnnotations);
  const patchAnnotation = usePredictStore((s) => s.patchAnnotation);
  const deleteAnnotation = usePredictStore((s) => s.deleteAnnotation);
  const addAnnotation = usePredictStore((s) => s.addAnnotation);

  useEffect(() => {
    if (!pid || !slug) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.get<{ items: DocBrief[] }>(
          `/api/v1/projects/${pid}/documents?page=1&page_size=200`
        );
        if (cancelled) return;
        setDocs(r.data.items);
        if (!docId) {
          if (r.data.items.length === 0) {
            setEmpty(true);
          } else {
            navigate(
              `/workspaces/${slug}/projects/${pid}/workspace?doc=${r.data.items[0].id}`,
              { replace: true }
            );
          }
        }
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pid, slug, docId, navigate]);

  useEffect(() => {
    if (!pid || !docId) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const r = await api.get<DocDetail>(
          `/api/v1/projects/${pid}/documents/${docId}`
        );
        if (cancelled) return;
        setCurrentDoc(r.data);
        const blobResp = await api.get<Blob>(
          `/api/v1/projects/${pid}/documents/${docId}/preview`,
          { responseType: "blob" }
        );
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blobResp.data);
        setPreviewObjectUrl(objectUrl);
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pid, docId]);

  useEffect(() => {
    if (!pid || !docId) return;
    let cancelled = false;
    async function reloadAnns() {
      if (!docId) return;
      try {
        const arr = await loadAnnotations(docId);
        if (!cancelled) setAnnotations(arr);
      } catch {
        // non-fatal
      }
    }
    void (async () => {
      if (!result) {
        try {
          await predictSingle(pid, docId);
        } catch (e) {
          if (!cancelled) setError((e as { message?: string })?.message ?? "Predict failed");
        }
      }
      await reloadAnns();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, docId]);

  function onSwitchDoc(newDocId: string) {
    if (!pid || !slug) return;
    setSelectedAnnotationId(null);
    navigate(`/workspaces/${slug}/projects/${pid}/workspace?doc=${newDocId}`);
  }

  async function handlePatch(id: string, patch: AnnotationPatch): Promise<Annotation> {
    if (!docId) throw new Error("no doc");
    const out = await patchAnnotation(docId, id, patch);
    setAnnotations((arr) => arr.map((a) => (a.id === id ? out : a)));
    return out;
  }

  async function handleDelete(id: string): Promise<void> {
    if (!docId) return;
    await deleteAnnotation(docId, id);
    setAnnotations((arr) => arr.filter((a) => a.id !== id));
  }

  async function handleAdd(input: NewAnnotation): Promise<Annotation> {
    if (!docId) throw new Error("no doc");
    const out = await addAnnotation(docId, input);
    setAnnotations((arr) => [...arr, out]);
    return out;
  }

  if (empty) {
    return (
      <div className="text-center text-[#94a3b8] py-12">
        <div className="text-sm mb-2">这个 Project 还没有任何文档</div>
        <div className="text-xs text-[#64748b]">请先上传文档</div>
      </div>
    );
  }
  if (error) {
    return <div className="text-center text-[#ef4444] py-12 text-sm">{error}</div>;
  }
  if (!docId || !currentDoc) {
    return <div className="text-center text-[#94a3b8] py-12 text-sm">Loading workspace...</div>;
  }

  return (
    <div className="flex flex-col h-full -m-6">
      <WorkspaceToolbar
        workspaceSlug={slug ?? ""}
        projectId={pid ?? ""}
        projectName="Project"
        documents={docs}
        currentDocId={docId}
        onSwitch={onSwitchDoc}
      />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto p-3">
          <AdvancedPanel projectId={pid ?? ""} documentId={docId} />
          {loading && !result ? (
            <div className="text-sm text-[#94a3b8] p-4">⏳ Predicting (10-30s)...</div>
          ) : previewObjectUrl ? (
            <DocumentCanvas
              previewUrl={previewObjectUrl}
              mimeType={currentDoc.mime_type}
              filename={currentDoc.filename}
            >
              <BboxOverlay
                annotations={annotations}
                selectedAnnotationId={selectedAnnotationId}
                onSelect={setSelectedAnnotationId}
              />
            </DocumentCanvas>
          ) : (
            <div className="text-sm text-[#94a3b8] p-4">⏳ Loading preview...</div>
          )}
        </div>
        <div className="w-[360px] border-l border-[#2a2e3d] overflow-auto p-3">
          <div className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-2">
            Fields
          </div>
          <AnnotationEditor
            annotations={annotations}
            onPatch={handlePatch}
            onDelete={handleDelete}
            onAdd={handleAdd}
          />
        </div>
        <div className="w-[380px] border-l border-[#2a2e3d] overflow-auto p-3">
          <JsonPreview
            structuredData={result?.structured_data ?? null}
            version={result?.version ?? null}
          />
        </div>
      </div>
    </div>
  );
}

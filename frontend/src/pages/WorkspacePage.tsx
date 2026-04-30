import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, extractApiError } from "../lib/api-client";
import AdvancedPanel from "../components/workspace/AdvancedPanel";
import BboxOverlay from "../components/workspace/BboxOverlay";
import DocumentCanvas from "../components/workspace/DocumentCanvas";
import JsonPreview from "../components/workspace/JsonPreview";
import StepIndicator from "../components/workspace/StepIndicator";
import ResultTabs from "../components/workspace/ResultTabs";
import WorkspaceToolbar from "../components/workspace/WorkspaceToolbar";
import PromptHistoryPanel from "../components/workspace/PromptHistoryPanel";
import NLCorrectionConsole from "../components/workspace/NLCorrectionConsole";
import AnnotationEditor from "../components/predict/AnnotationEditor";
import {
  usePredictStore,
  type Annotation, type AnnotationPatch, type NewAnnotation,
} from "../stores/predict-store";

interface DocBrief { id: string; filename: string; mime_type?: string; }
interface DocDetail extends DocBrief { mime_type: string; }

type BoundingBox = { x: number; y: number; w: number; h: number; page: number };

export default function WorkspacePage() {
  const { slug, pid } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const docId = searchParams.get("doc");

  const [docs, setDocs] = useState<DocBrief[]>([]);
  const [currentDoc, setCurrentDoc] = useState<DocDetail | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [imgRect, setImgRect] = useState<DOMRect | null>(null);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const result = usePredictStore((s) => (docId ? s.results[docId] : null));
  const loading = usePredictStore((s) => (docId ? s.loading[docId] ?? false : false));
  const selectedAnnotationId = usePredictStore((s) => s.selectedAnnotationId);
  const setSelectedAnnotationId = usePredictStore((s) => s.setSelectedAnnotationId);
  const apiFormat = usePredictStore((s) => s.apiFormat);
  const currentStep = usePredictStore((s) => s.currentStep);
  const setStep = usePredictStore((s) => s.setStep);
  const predictSingle = usePredictStore((s) => s.predictSingle);
  const loadResults = usePredictStore((s) => s.loadResults);
  const loadAnnotations = usePredictStore((s) => s.loadAnnotations);
  const patchAnnotation = usePredictStore((s) => s.patchAnnotation);
  const deleteAnnotation = usePredictStore((s) => s.deleteAnnotation);
  const addAnnotation = usePredictStore((s) => s.addAnnotation);

  const imgRef = useRef<HTMLImageElement | null>(null);

  // 1) Bootstrap docs list + redirect-on-missing
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
          if (r.data.items.length === 0) setEmpty(true);
          else navigate(
            `/workspaces/${slug}/projects/${pid}/workspace?doc=${r.data.items[0].id}`,
            { replace: true }
          );
        }
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message);
      }
    })();
    return () => { cancelled = true; };
  }, [pid, slug, docId, navigate]);

  // 2) Doc detail + preview blob
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

  // 3) Load existing results + annotations. NEVER auto-predict — user must
  // click "Run prediction" / Re-predict explicitly (mirrors label-studio's
  // default `evaluate_predictions_automatically=False`).
  useEffect(() => {
    if (!pid || !docId) return;
    let cancelled = false;
    void (async () => {
      try {
        await loadResults(pid, docId);
      } catch (e) {
        if (!cancelled) setError((e as { message?: string })?.message ?? "Load failed");
      }
      try {
        const arr = await loadAnnotations(docId);
        if (!cancelled) setAnnotations(arr);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, docId]);

  // Auto-advance step 1 once result loads
  useEffect(() => {
    if (result && currentStep <= 1 && currentStep !== 1) setStep(1);
  }, [result, currentStep, setStep]);

  // Auto-advance step 3 when format becomes non-flat
  useEffect(() => {
    if (apiFormat !== "flat" && currentStep < 3) setStep(3);
  }, [apiFormat, currentStep, setStep]);

  function onSwitchDoc(newDocId: string) {
    if (!pid || !slug) return;
    setSelectedAnnotationId(null);
    navigate(`/workspaces/${slug}/projects/${pid}/workspace?doc=${newDocId}`);
  }

  async function handlePatch(id: string, patch: AnnotationPatch): Promise<Annotation> {
    if (!docId) throw new Error("no doc");
    const out = await patchAnnotation(docId, id, patch);
    setAnnotations((arr) => arr.map((a) => (a.id === id ? out : a)));
    if (currentStep < 2) setStep(2);
    return out;
  }

  async function handleDelete(id: string): Promise<void> {
    if (!docId) return;
    await deleteAnnotation(docId, id);
    setAnnotations((arr) => arr.filter((a) => a.id !== id));
    if (currentStep < 2) setStep(2);
  }

  async function handleAdd(input: NewAnnotation): Promise<Annotation> {
    if (!docId) throw new Error("no doc");
    const out = await addAnnotation(docId, input);
    setAnnotations((arr) => [...arr, out]);
    if (currentStep < 2) setStep(2);
    return out;
  }

  async function handlePatchBbox(id: string, bbox: BoundingBox): Promise<void> {
    await handlePatch(id, { bounding_box: bbox } as AnnotationPatch);
  }

  async function handleCreateBbox(bbox: BoundingBox, fieldName: string): Promise<void> {
    await handleAdd({
      field_name: fieldName,
      field_value: "",
      field_type: "string",
      bounding_box: bbox,
    } as NewAnnotation);
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

  const isImage = currentDoc.mime_type.startsWith("image/");
  const annsForPage = (page: number) =>
    annotations.filter((a) => (a.bounding_box?.page ?? 0) === page);

  const imageOverlay = (isImage && imgRect) ? (
    <BboxOverlay
      pageNumber={1}
      pageRect={imgRect}
      annotations={annsForPage(0)}
      selectedAnnotationId={selectedAnnotationId}
      onSelect={setSelectedAnnotationId}
      onPatchBbox={handlePatchBbox}
      onCreateBbox={handleCreateBbox}
    />
  ) : null;

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
      <StepIndicator />
      <ResultTabs
        documentId={docId}
        predicting={loading}
        onRunPredict={() => {
          void predictSingle(pid ?? "", docId).catch((e) =>
            setError((e as { message?: string })?.message ?? "Predict failed")
          );
        }}
      />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto p-3">
          <AdvancedPanel projectId={pid ?? ""} documentId={docId} />
          {loading && !result ? (
            <div className="text-sm text-[#94a3b8] p-4">⏳ Predicting (10-30s)...</div>
          ) : previewObjectUrl ? (
            isImage ? (
              <div className="relative inline-block">
                <img
                  ref={(el) => {
                    imgRef.current = el;
                    if (el) setImgRect(el.getBoundingClientRect());
                  }}
                  src={previewObjectUrl}
                  alt={currentDoc.filename}
                  className="max-w-full block"
                  onLoad={() => imgRef.current && setImgRect(imgRef.current.getBoundingClientRect())}
                />
                {imageOverlay}
              </div>
            ) : (
              <DocumentCanvas
                previewUrl={previewObjectUrl}
                mimeType={currentDoc.mime_type}
                filename={currentDoc.filename}
                renderPageOverlay={(p, rect) => (
                  <BboxOverlay
                    pageNumber={p}
                    pageRect={rect}
                    annotations={annsForPage(p - 1)}
                    selectedAnnotationId={selectedAnnotationId}
                    onSelect={setSelectedAnnotationId}
                    onPatchBbox={handlePatchBbox}
                    onCreateBbox={handleCreateBbox}
                  />
                )}
              />
            )
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
            annotations={annotations}
          />
        </div>
      </div>
      <PromptHistoryPanel projectId={pid ?? ""} />
      <NLCorrectionConsole
        projectId={pid ?? ""}
        documentId={docId}
        currentPrompt={result?.prompt_used ?? ""}
        annotations={annotations}
        currentResult={result ? { structured_data: result.structured_data } : null}
      />
    </div>
  );
}

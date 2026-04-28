import { usePredictStore } from "../../stores/predict-store";

interface Step {
  id: 0 | 1 | 2 | 3;
  label: string;
}
const REACHABLE_STEPS: Step[] = [
  { id: 0, label: "Upload" },
  { id: 1, label: "Preview" },
  { id: 2, label: "Correct" },
  { id: 3, label: "ApiFormat" },
];
const LOCKED_STEPS = [
  { id: 4, label: "Tune" },
  { id: 5, label: "GenerateAPI" },
];

export default function StepIndicator() {
  const currentStep = usePredictStore((s) => s.currentStep);
  const setStep = usePredictStore((s) => s.setStep);

  return (
    <div className="bg-[#0f1117] border-b border-[#2a2e3d] px-4 py-2 flex items-center gap-1 text-xs">
      {REACHABLE_STEPS.map((s) => {
        const isCurrent = s.id === currentStep;
        const isCompleted = s.id < currentStep;
        const cls = isCurrent
          ? "border border-[#6366f1] text-[#818cf8] font-semibold"
          : isCompleted
          ? "bg-[#312e81] text-white"
          : "bg-[#1a1d27] text-[#94a3b8]";
        return (
          <button
            key={s.id}
            type="button"
            aria-current={isCurrent ? "step" : undefined}
            onClick={() => setStep(s.id)}
            className={`${cls} px-3 py-1 rounded hover:border-[#818cf8] hover:border`}
          >
            {s.id + 1}. {s.label}
          </button>
        );
      })}
      {LOCKED_STEPS.map((s) => (
        <button
          key={s.id}
          type="button"
          disabled
          className="bg-[#1a1d27] text-[#475569] px-3 py-1 rounded opacity-50 cursor-not-allowed"
        >
          🔒 {s.id + 1}. {s.label}
        </button>
      ))}
    </div>
  );
}

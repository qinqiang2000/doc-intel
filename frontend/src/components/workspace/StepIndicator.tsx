import { useTranslation } from "react-i18next";
import { usePredictStore } from "../../stores/predict-store";

const STEP_KEYS: Array<{ id: 0 | 1 | 2 | 3 | 4 | 5; key: string }> = [
  { id: 0, key: "stepIndicator.upload" },
  { id: 1, key: "stepIndicator.preview" },
  { id: 2, key: "stepIndicator.correct" },
  { id: 3, key: "stepIndicator.apiFormat" },
  { id: 4, key: "stepIndicator.tune" },
  { id: 5, key: "stepIndicator.generateApi" },
];

export default function StepIndicator() {
  const { t } = useTranslation();
  const currentStep = usePredictStore((s) => s.currentStep);
  const setStep = usePredictStore((s) => s.setStep);
  const setCorrectionConsoleOpen = usePredictStore((s) => s.setCorrectionConsoleOpen);

  return (
    <div className="bg-canvas border-b border-default px-4 py-2 flex items-center gap-1 text-xs">
      {STEP_KEYS.map((s) => {
        const isCurrent = s.id === currentStep;
        const isCompleted = s.id < currentStep;
        const cls = isCurrent
          ? "border border-accent text-accent-hover font-semibold"
          : isCompleted
          ? "bg-accent-strong text-white"
          : "bg-surface text-muted";
        return (
          <button
            key={s.id}
            type="button"
            aria-current={isCurrent ? "step" : undefined}
            onClick={() => {
              setStep(s.id);
              if (s.id === 4) setCorrectionConsoleOpen(true);
            }}
            className={`${cls} px-3 py-1 rounded hover:border-accent-hover hover:border`}
          >
            {s.id + 1}. {t(s.key)}
          </button>
        );
      })}
    </div>
  );
}

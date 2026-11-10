export type PitchStage = "uploading" | "transcribing" | "structuring" | "review" | "saved";
const stages: { id: PitchStage; label: string; heading: string; detail: string }[] = [
  {
    id: "uploading",
    label: "Upload",
    heading: "Sending your pitch…",
    detail: "Recording has stopped. Keep this page open while your audio is sent.",
  },
  {
    id: "transcribing",
    label: "Transcribe",
    heading: "Distill is transcribing your pitch…",
    detail: "Your recording was received. We are turning your speech into text.",
  },
  {
    id: "structuring",
    label: "Prepare draft",
    heading: "Claude is preparing your template…",
    detail: "Your transcript is ready. We are organising your project in its original language.",
  },
  {
    id: "review",
    label: "Review",
    heading: "Your draft is ready to review.",
    detail: "Check the proposal, edit it, then approve and save. Nothing is published.",
  },
  {
    id: "saved",
    label: "Saved",
    heading: "Your project is saved.",
    detail: "Your approved draft is private. You can now start another project.",
  },
];
export function PitchProgress({ stage }: { stage: PitchStage }) {
  const index = stages.findIndex((item) => item.id === stage);
  return (
    <section className="pitch-progress" aria-label="Pitch progress">
      <ol className="pitch-steps">
        {stages.map((item, i) => (
          <li
            key={item.id}
            aria-current={i === index ? "step" : undefined}
            className={i < index ? "complete" : ""}
          >
            {item.label}
          </li>
        ))}
      </ol>
      <div role="status" aria-live="polite">
        <h2>{stages[index].heading}</h2>
        <p>{stages[index].detail}</p>
      </div>
    </section>
  );
}

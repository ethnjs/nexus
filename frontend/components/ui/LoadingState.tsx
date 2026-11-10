import { Spinner } from "@/components/ui/Spinner";

interface LoadingStateProps {
  /** `page` stands in for a whole page or panel; `section` for a card, list or modal body. */
  context?: "page" | "section";
}

export function LoadingState({ context = "page" }: LoadingStateProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        padding: context === "page" ? "80px 0" : "24px 0",
      }}
    >
      <Spinner size={context === "page" ? "lg" : "md"} />
    </div>
  );
}

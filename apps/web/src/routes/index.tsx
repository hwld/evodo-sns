import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">evodo</h1>
      <p className="text-muted-foreground">
        1 投稿 = 1 TODO リスト の SNS（実装中）
      </p>
    </div>
  );
}

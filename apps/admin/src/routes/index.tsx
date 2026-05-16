import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: AdminHome,
});

function AdminHome() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">evodo admin</h1>
      <p className="text-muted-foreground">管理画面のシェル（実装中）</p>
    </div>
  );
}

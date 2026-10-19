import type { ReactNode } from "react";

/** Standard-Build: keine Vorbereitung nötig. Die Browser-Version ersetzt dieses Modul (Alias @gate). */
export function Gate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

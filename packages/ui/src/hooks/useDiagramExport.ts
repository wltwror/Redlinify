import { useCallback } from "react";
import type { DesignView, EdgeRoute } from "@redlinify/shared/browser";
import type { StructuredFlowNode } from "../components/StructuredNode";
import type { Point } from "../layout/routing";
import {
  renderViewToJson,
  renderViewToMermaid,
  renderViewToSvg,
  svgToPngBlob,
  triggerFileDownload,
  type ExportFormat,
} from "../utils/exportDiagram";

interface UseDiagramExportOptions {
  activeViewRef: { current: DesignView | null };
  positionsRef: { current: Record<string, Point> };
  edgeRoutesRef: { current: Record<string, EdgeRoute> };
  rfNodes: StructuredFlowNode[];
  theme: "dark" | "light";
  bgPattern: "dots" | "grid";
  showToast: (message: string, tone?: "info" | "warning" | "error") => void;
}

export function useDiagramExport({
  activeViewRef,
  positionsRef,
  edgeRoutesRef,
  rfNodes,
  theme,
  bgPattern,
  showToast,
}: UseDiagramExportOptions) {
  const handleExportDiagram = useCallback(
    async (format: ExportFormat) => {
      const view = activeViewRef.current;
      if (!view) return;

      const measured: Record<string, { width?: number; height?: number }> = {};
      for (const n of rfNodes) {
        if (n.measured?.width || n.measured?.height) {
          measured[n.id] = {
            width: n.measured.width,
            height: n.measured.height,
          };
        }
      }

      try {
        if (format === "json") {
          triggerFileDownload(
            `${view.id}.json`,
            renderViewToJson(view),
            "application/json;charset=utf-8",
          );
          showToast(`Exported ${view.id}.json`);
          return;
        }

        if (format === "mermaid" || format === "copy_mermaid") {
          const mmd = renderViewToMermaid(view, { theme });
          if (format === "copy_mermaid") {
            await navigator.clipboard.writeText(mmd);
            showToast("Copied Mermaid diagram to clipboard");
          } else {
            triggerFileDownload(
              `${view.id}.mmd`,
              mmd,
              "text/plain;charset=utf-8",
            );
            showToast(`Exported ${view.id}.mmd`);
          }
          return;
        }

        const { svg, width, height } = renderViewToSvg({
          view,
          positions: positionsRef.current,
          edgeRoutes: edgeRoutesRef.current,
          measured,
          theme,
          bgPattern,
        });

        if (format === "svg") {
          triggerFileDownload(
            `${view.id}.svg`,
            svg,
            "image/svg+xml;charset=utf-8",
          );
          showToast(`Exported ${view.id}.svg`);
          return;
        }

        const pngBlob = await svgToPngBlob(svg, width, height, 2);
        triggerFileDownload(`${view.id}.png`, pngBlob, "image/png");
        showToast(`Exported ${view.id}.png (2× HD)`);
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "Failed to export diagram",
          "error",
        );
      }
    },
    [
      activeViewRef,
      bgPattern,
      edgeRoutesRef,
      positionsRef,
      rfNodes,
      showToast,
      theme,
    ],
  );

  return { handleExportDiagram };
}

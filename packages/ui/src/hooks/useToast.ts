import { useCallback, useState } from "react";

export interface ToastState {
  id: number;
  message: string;
  tone: "info" | "warning" | "error";
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback(
    (message: string, tone: "info" | "warning" | "error" = "info") => {
      const id = Date.now();
      setToast({ id, message, tone });
      setTimeout(() => {
        setToast((curr) => (curr?.id === id ? null : curr));
      }, 3600);
    },
    [],
  );

  return { toast, showToast };
}

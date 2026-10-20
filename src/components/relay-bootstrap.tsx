import { useEffect } from "react";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

export function RelayBootstrap() {
  useEffect(() => {
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    document.cookie = `nl-base=${encodeURIComponent(prefix)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, []);
  return null;
}

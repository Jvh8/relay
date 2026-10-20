import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, House, Monitor, RotateCw, Smartphone } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AddressBar } from "@/components/address-bar";
import { rememberVisit } from "@/lib/relay/history";
import { hostOf, toProxyPath, upstreamFromLocation } from "@/lib/relay/paths";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

export const Route = createFileRoute("/browse")({
  validateSearch: (search: Record<string, unknown>) => ({
    u: typeof search.u === "string" ? search.u : "",
  }),
  component: Browse,
});

function Browse() {
  const { u } = Route.useSearch();
  const navigate = useNavigate();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stack = useRef<string[]>([]);
  const index = useRef(0);
  const programmatic = useRef(false);
  const [ready, setReady] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [address, setAddress] = useState(u);
  const [frameSrc, setFrameSrc] = useState("about:blank");
  const [busy, setBusy] = useState(false);
  const [ua, setUa] = useState<"desktop" | "mobile">("desktop");
  const [nav, setNav] = useState({ back: false, forward: false });
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("northline.ua") === "mobile" ? "mobile" : "desktop";
    setUa(saved);
    document.cookie = `nl-ua=${saved}; Path=/; Max-Age=31536000; SameSite=Lax`;
    const nextPrefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    document.cookie = `nl-base=${encodeURIComponent(nextPrefix)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setPrefix(nextPrefix);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!u) {
      setProblem(null);
      setFrameSrc("about:blank");
      setBusy(false);
      return;
    }
    let path = "";
    try {
      path = `${prefix}${toProxyPath(u)}`;
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That address can't be opened.");
      setBusy(false);
      return;
    }
    const history = stack.current.slice(0, index.current + 1);
    if (history[history.length - 1] !== u) history.push(u);
    stack.current = history;
    index.current = history.length - 1;
    setNav({ back: index.current > 0, forward: false });
    setAddress(u);
    programmatic.current = true;
    setBusy(true);
    setFrameSrc(path);
  }, [ready, u, prefix]);

  function syncNav() {
    setNav({
      back: index.current > 0,
      forward: index.current < stack.current.length - 1,
    });
  }

  function onFrameLoad() {
    const frame = frameRef.current?.contentWindow;
    if (!frame) return;
    let upstream: string | null = null;
    let title = "";
    try {
      if (!frame.location.pathname.includes("/relay/")) return;
      upstream = upstreamFromLocation(frame.location.pathname, frame.location.search);
      title = frame.document.title;
    } catch {
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!upstream) return;
    setAddress(upstream);
    rememberVisit(upstream, title);
    if (programmatic.current) {
      programmatic.current = false;
      stack.current[index.current] = upstream;
      syncNav();
      return;
    }
    if (upstream === stack.current[index.current]) return;
    stack.current = stack.current.slice(0, index.current + 1);
    stack.current.push(upstream);
    index.current = stack.current.length - 1;
    syncNav();
  }

  function show(url: string) {
    let path = "";
    try {
      path = `${prefix}${toProxyPath(url)}`;
    } catch {
      return;
    }
    programmatic.current = true;
    setBusy(true);
    setAddress(url);
    setFrameSrc(path);
    syncNav();
  }

  function go(delta: number) {
    const next = index.current + delta;
    if (next < 0 || next >= stack.current.length) return;
    index.current = next;
    show(stack.current[next] ?? "");
  }

  function toggleUa() {
    const next = ua === "desktop" ? "mobile" : "desktop";
    setUa(next);
    localStorage.setItem("northline.ua", next);
    document.cookie = `nl-ua=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setBusy(true);
    frameRef.current?.contentWindow?.location.reload();
  }

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="safe-top safe-x border-b border-line bg-bg">
        <div className="py-2">
          <AddressBar
            initial={address}
            submitLabel="Go"
            onSubmit={(destination) => {
              if (destination === u) {
                setBusy(true);
                frameRef.current?.contentWindow?.location.reload();
                return;
              }
              void navigate({ to: "/browse", search: { u: destination } });
            }}
          />
        </div>
        <div className="flex items-center gap-1 pb-2">
          <IconButton label="Back" disabled={!nav.back} onClick={() => go(-1)}>
            <ArrowLeft className="size-4" strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Forward" disabled={!nav.forward} onClick={() => go(1)}>
            <ArrowRight className="size-4" strokeWidth={1.75} />
          </IconButton>
          <IconButton
            label="Reload"
            disabled={!u}
            onClick={() => {
              setBusy(true);
              frameRef.current?.contentWindow?.location.reload();
            }}
          >
            <RotateCw className="size-4" strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Home" onClick={() => void navigate({ to: "/" })}>
            <House className="size-4" strokeWidth={1.75} />
          </IconButton>
          <IconButton label={ua === "mobile" ? "Phone site" : "Desktop site"} pressed={ua === "mobile"} onClick={toggleUa}>
            {ua === "mobile" ? (
              <Smartphone className="size-4" strokeWidth={1.75} />
            ) : (
              <Monitor className="size-4" strokeWidth={1.75} />
            )}
          </IconButton>
          <p className="min-w-0 flex-1 truncate px-2 font-mono text-sm text-muted">{u ? hostOf(address || u) : "No page"}</p>
        </div>
        <div className="h-0.5">{busy ? <div className="relay-progress" /> : null}</div>
      </header>
      <div className="relative min-h-0 flex-1 bg-bg-sunken">
        {problem ? (
          <p className="px-6 py-10 text-muted">{problem}</p>
        ) : (
          <iframe
            ref={frameRef}
            title="Relayed page"
            src={frameSrc}
            className="h-full w-full border-0 bg-bg"
            referrerPolicy="no-referrer"
            onLoad={onFrameLoad}
          />
        )}
      </div>
    </div>
  );
}

function IconButton({
  label,
  children,
  disabled,
  pressed,
  onClick,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="press inline-flex size-11 items-center justify-center rounded-md text-fg disabled:text-subtle"
    >
      {children}
    </button>
  );
}

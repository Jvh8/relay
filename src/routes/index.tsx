import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AddressBar } from "@/components/address-bar";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const navigate = useNavigate();

  return (
    <main className="safe-x safe-bottom flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-2xl">
        <h1 className="sr-only">Search</h1>
        <AddressBar
          submitLabel="Search"
          onSubmit={(url) => {
            void navigate({ to: "/browse", search: { u: url } });
          }}
        />
      </div>
    </main>
  );
}

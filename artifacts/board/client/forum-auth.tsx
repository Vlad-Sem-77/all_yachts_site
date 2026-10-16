import React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, SignIn, SignUp, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { ruRU } from "@clerk/localizations";
import { shadcn } from "@clerk/themes";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  throw new Error("Missing Clerk publishable key.");
}

const safeNext = (value: string | null): string =>
  value?.startsWith("/") && !value.startsWith("//") ? value : "/forum";

const appearance = {
  theme: shadcn,
  variables: {
    colorPrimary: "#8c6735",
    colorBackground: "#fbf8f1",
    colorForeground: "#302a22",
    colorMutedForeground: "#756c5f",
    colorInput: "#fffdf8",
    colorInputForeground: "#302a22",
    colorNeutral: "#b9aa91",
    borderRadius: "0.6rem",
    fontFamily: "Georgia, serif",
  },
  elements: {
    cardBox: { background: "#fbf8f1", border: "1px solid #d8cbb4", boxShadow: "0 18px 48px #362a1b22", width: "440px", maxWidth: "100%" },
    card: { background: "transparent", boxShadow: "none", border: "0" },
    footer: { background: "transparent", boxShadow: "none", border: "0" },
    formButtonPrimary: { background: "#8c6735", color: "#fffaf0" },
  },
};

function SignOut() {
  const { signOut } = useClerk();
  React.useEffect(() => {
    void signOut({ redirectUrl: "/" });
  }, [signOut]);
  return <p>Выходим из аккаунта…</p>;
}

function AuthApp({ mode, next }: { mode: string; next: string }) {
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={appearance}
      localization={ruRU}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
      <div className="forum-auth-card">
        {mode === "sign-up" ? (
          <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl={next} />
        ) : mode === "sign-out" ? (
          <SignOut />
        ) : (
          <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl={next} />
        )}
      </div>
    </ClerkProvider>
  );
}

document.querySelectorAll<HTMLElement>("[data-forum-auth]").forEach((element) => {
  const mode = element.dataset.mode ?? "sign-in";
  const next = safeNext(new URLSearchParams(window.location.search).get("next"));
  createRoot(element).render(<AuthApp mode={mode} next={next} />);
});

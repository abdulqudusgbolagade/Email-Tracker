"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const form = new FormData(event.currentTarget);
        try {
          const result = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: form.get("email"),
              password: form.get("password"),
            }),
          });
          const data = await result.json();
          if (!result.ok) throw new Error(data.error);
          router.replace("/overview");
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Sign-in failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        Email address
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@grantpublishingco.com"
        />
      </label>
      <label className="field">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in to workspace →"}
      </button>
    </form>
  );
}

"use client";
import { useState } from "react";
export function OAuthConsent({
  requestId,
  csrf,
}: {
  requestId: string;
  csrf: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(allow: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await fetch("/api/mcp/oauth/consent", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ requestId, allow }),
      });
      const data = await result.json();
      if (!result.ok)
        throw new Error(
          data.error_description || "Connection approval failed.",
        );
      // The server supplies only the registered and validated client callback.
      window.location.assign(data.redirectUrl);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Connection approval failed.",
      );
      setBusy(false);
    }
  }
  return (
    <div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="oauth-actions">
        <button
          className="button"
          disabled={busy}
          onClick={() => void decide(false)}
        >
          Deny access
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void decide(true)}
        >
          {busy ? "Working…" : "Approve connection"}
        </button>
      </div>
    </div>
  );
}

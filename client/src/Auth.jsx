import React, { useState, useEffect, useCallback } from "react";
import { COLORS } from "./theme.js";

// "checking" (au chargement) -> "authenticated" | "unauthenticated"
export function useAuth() {
  const [status, setStatus] = useState("checking");
  const [username, setUsername] = useState(null);

  useEffect(() => {
    fetch("/api/me")
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        setUsername(data.username);
        setStatus("authenticated");
      })
      .catch(() => setStatus("unauthenticated"));
  }, []);

  const login = useCallback(async (u, p) => {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Connexion impossible");
    setUsername(data.username);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    setUsername(null);
    setStatus("unauthenticated");
  }, []);

  return { status, username, login, logout };
}

export function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err.message || "Connexion impossible");
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = submitting || !username || !password;

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4"
      style={{ background: COLORS.canvas, fontFamily: "'Inter', sans-serif" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bitter:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
      `}</style>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-md p-6"
        style={{ background: COLORS.canvasDeep, border: `1px solid ${COLORS.line}` }}
      >
        <h1
          className="text-lg mb-1"
          style={{ fontFamily: "'Bitter', serif", fontWeight: 700, color: COLORS.paper }}
        >
          Fiche Express
        </h1>
        <p
          className="text-[11px] mb-5"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "#8A8F97" }}
        >
          Connexion requise
        </p>

        <label
          htmlFor="auth-username"
          className="block text-[10px] tracking-[0.18em] uppercase mb-1"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: COLORS.ochreDim }}
        >
          Identifiant
        </label>
        <input
          id="auth-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
          className="w-full mb-3 px-3 py-2 rounded-sm outline-none text-[14px]"
          style={{ background: COLORS.paper, color: COLORS.ink, fontFamily: "'Bitter', serif" }}
        />

        <label
          htmlFor="auth-password"
          className="block text-[10px] tracking-[0.18em] uppercase mb-1"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: COLORS.ochreDim }}
        >
          Mot de passe
        </label>
        <input
          id="auth-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="w-full mb-4 px-3 py-2 rounded-sm outline-none text-[14px]"
          style={{ background: COLORS.paper, color: COLORS.ink, fontFamily: "'Bitter', serif" }}
        />

        {error && (
          <p className="text-[12px] mb-3" style={{ color: "#E0A98A", fontFamily: "'Bitter', serif" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={disabled}
          className="w-full text-[13px] px-4 py-2 rounded-sm transition-opacity"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            background: COLORS.ochre,
            color: COLORS.canvasDeep,
            opacity: disabled ? 0.6 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}

"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

/**
 * Supabase Auth session for purchase actions. The access token is sent as a Bearer token;
 * the server verifies it with Supabase Auth and checks the purchaser role on every request.
 */
let client: SupabaseClient | null = null;
function browserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  client ??= createClient(url, anon);
  return client;
}

export function usePurchaserSession() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  useEffect(() => {
    const supabase = browserClient();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null);
      setEmail(data.session?.user.email ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setToken(session?.access_token ?? null);
      setEmail(session?.user.email ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn(address: string, password: string) {
    setError(null);
    const supabase = browserClient();
    if (!supabase) return setError("ログイン設定（NEXT_PUBLIC_SUPABASE_ANON_KEY）がありません。");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: address, password });
    if (signInError) setError("ログインできませんでした。");
  }

  async function signOut() {
    await browserClient()?.auth.signOut();
  }

  return { configured, token, email, error, signIn, signOut };
}

export function PurchaserSignIn({ session }: { session: ReturnType<typeof usePurchaserSession> }) {
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  if (!session.configured) return <p className="purchase-auth-note">購入操作には管理者ログインの設定が必要です。</p>;
  if (session.token) {
    return (
      <p className="purchase-auth-note">
        購入担当: {session.email} <button type="button" onClick={() => void session.signOut()}>ログアウト</button>
      </p>
    );
  }
  return (
    <form className="purchase-auth" onSubmit={(e) => { e.preventDefault(); void session.signIn(address, password); }}>
      <label>購入担当メール<input type="email" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="username" /></label>
      <label>パスワード<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
      <button type="submit" disabled={!address || !password}>ログイン</button>
      {session.error && <p role="alert">{session.error}</p>}
    </form>
  );
}

import { useState } from "react";
import { Shield, Loader2, Lock } from "lucide-react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!password.trim()) { setError("Введите пароль"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка входа");
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Morena VPN</h1>
            <p className="text-muted-foreground text-sm mt-1">Панель администратора</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-8 shadow-lg space-y-6">
          <div className="text-center space-y-1">
            <h2 className="font-semibold text-lg">Вход</h2>
            <p className="text-sm text-muted-foreground">
              Введите пароль администратора
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Входим...</span>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="password"
                  placeholder="Пароль"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  className="w-full rounded-md border border-border bg-background pl-10 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <button
                onClick={handleLogin}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 text-sm font-medium transition-colors"
              >
                Войти
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive text-center">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

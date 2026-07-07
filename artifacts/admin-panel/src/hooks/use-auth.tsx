import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { getAuthMe, logout as apiLogout, telegramLogin } from "@workspace/api-client-react";

interface AuthUser {
  id: number;
  firstName: string;
  username?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (tgData: Record<string, string | number>) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAuthMe()
      .then((u) => setUser({ id: u.id, firstName: u.firstName, username: u.username }))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (tgData: Record<string, string | number>) => {
    const u = await telegramLogin({
      id: Number(tgData["id"]),
      hash: String(tgData["hash"]),
      auth_date: Number(tgData["auth_date"]),
      first_name: tgData["first_name"] ? String(tgData["first_name"]) : undefined,
      last_name: tgData["last_name"] ? String(tgData["last_name"]) : undefined,
      username: tgData["username"] ? String(tgData["username"]) : undefined,
      photo_url: tgData["photo_url"] ? String(tgData["photo_url"]) : undefined,
    });
    setUser({ id: u.id, firstName: u.firstName, username: u.username });
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

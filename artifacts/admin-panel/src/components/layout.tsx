import { Link, useLocation } from "wouter";
import { useHealthCheck } from "@workspace/api-client-react";
import { LayoutDashboard, Users, CreditCard, Key, Ticket, Shield, Activity, UserPlus, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck({ query: { queryKey: ["health"], refetchInterval: 30000 } });
  const { user, logout } = useAuth();

  const navItems = [
    { href: "/", label: "Дашборд", icon: LayoutDashboard },
    { href: "/create-client", label: "Создать клиента", icon: UserPlus },
    { href: "/subscriptions", label: "Подписки", icon: Key },
    { href: "/users", label: "Пользователи", icon: Users },
    { href: "/payments", label: "Платежи", icon: CreditCard },
    { href: "/promocodes", label: "Промокоды", icon: Ticket },
  ];

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-sidebar flex flex-col justify-between">
        <div>
          <div className="h-16 flex items-center px-6 border-b border-border">
            <Shield className="w-6 h-6 text-primary mr-3" />
            <span className="font-bold text-lg tracking-tight">Morena VPN</span>
          </div>
          <nav className="flex-1 p-4 space-y-1">
            {navItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link 
                  key={item.href} 
                  href={item.href} 
                  className={`flex items-center px-3 py-2.5 rounded-md transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                  data-testid={`nav-${item.href.replace("/", "") || "dashboard"}`}
                >
                  <item.icon className="w-5 h-5 mr-3" />
                  <span className="font-medium text-sm">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        
        <div className="p-4 border-t border-border space-y-3">
          {/* Пользователь + выход */}
          {user && (
            <div className="flex items-center justify-between px-3 py-2 rounded-md bg-sidebar-accent/50">
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium text-sidebar-accent-foreground truncate">
                  {user.firstName}
                </span>
                {user.username && (
                  <span className="text-xs text-muted-foreground truncate">
                    @{user.username}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => logout()}
                title="Выйти"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Статус сервера */}
          <div className="flex items-center text-sm px-3 py-2 text-muted-foreground">
            <Activity className="w-4 h-4 mr-2" />
            Сервер: 
            <span className={`ml-2 w-2 h-2 rounded-full ${health?.status === 'ok' ? 'bg-emerald-500' : 'bg-destructive animate-pulse'}`} />
            <span className="ml-2 text-xs">{health?.status === 'ok' ? 'В сети' : 'Недоступен'}</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-background">
        <div className="p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

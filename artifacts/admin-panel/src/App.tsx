import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import { AuthProvider, useAuth } from "@/hooks/use-auth";

import Dashboard from "./pages/dashboard";
import Users from "./pages/users";
import Payments from "./pages/payments";
import Subscriptions from "./pages/subscriptions";
import Promocodes from "./pages/promocodes";
import CreateClient from "./pages/create-client";

const queryClient = new QueryClient();

function ProtectedRouter() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm animate-pulse">Загрузка...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route>
          <Redirect to="/login" />
        </Route>
      </Switch>
    );
  }

  return (
    <Layout>
      <Switch>
        <Route path="/login">
          <Redirect to="/" />
        </Route>
        <Route path="/" component={Dashboard} />
        <Route path="/create-client" component={CreateClient} />
        <Route path="/subscriptions" component={Subscriptions} />
        <Route path="/users" component={Users} />
        <Route path="/payments" component={Payments} />
        <Route path="/promocodes" component={Promocodes} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <ProtectedRouter />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

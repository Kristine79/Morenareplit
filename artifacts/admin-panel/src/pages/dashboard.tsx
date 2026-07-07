import { useGetAdminStats, useGetResellerProfile } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, CreditCard, Key, Activity, Wallet, Percent, UserCheck } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function Dashboard() {
  const { data: stats, isLoading, isError } = useGetAdminStats({
    query: { queryKey: ["adminStats"] }
  });

  const { data: reseller, isLoading: resellerLoading } = useGetResellerProfile({
    query: { queryKey: ["resellerProfile"] }
  });

  if (isLoading) {
    return <div className="space-y-6"><Skeleton className="h-[200px] w-full" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  if (isError || !stats) {
    return <div className="text-destructive">Ошибка загрузки статистики</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Обзор</h1>
        <p className="text-muted-foreground mt-1">Основные показатели</p>
      </div>

      {/* Блок реселлера RoyaltyKey */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Реселлер · RoyaltyKey
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-electric-blue/20 bg-card/80">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Баланс реселлера</CardTitle>
              <Wallet className="h-4 w-4 text-blue-400" />
            </CardHeader>
            <CardContent>
              {resellerLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : (
                <>
                  <div className="text-2xl font-bold text-blue-400">
                    {reseller ? formatCurrency(reseller.balance) : "—"}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Доступно для закупки</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-emerald-500/20 bg-card/80">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Оптовая скидка</CardTitle>
              <Percent className="h-4 w-4 text-emerald-400" />
            </CardHeader>
            <CardContent>
              {resellerLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold text-emerald-400">
                    {reseller ? `${reseller.discount}%` : "—"}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Скидка от базовой цены</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Статистика бота */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Статистика бота
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Общий доход</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(stats.totalRevenue)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                +{formatCurrency(stats.revenueToday)} за сегодня
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Пользователи</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalUsers}</div>
              <p className="text-xs text-muted-foreground mt-1">
                +{stats.newUsersToday} за сегодня
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Активные подписки</CardTitle>
              <Key className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.activeSubscriptions}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.expiredSubscriptions} истекло
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Платежи</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.paidPayments}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.pendingPayments} в ожидании
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Активность пользователей */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Активность пользователей
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Активно сегодня</CardTitle>
              <UserCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.activeToday}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Активно за неделю</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.activeWeek}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Активно за месяц</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.activeMonth}</div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Недавние платежи */}
      <Card>
        <CardHeader>
          <CardTitle>Недавние платежи</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Пользователь</TableHead>
                <TableHead>Тариф</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.recentPayments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="font-medium">
                    {payment.username ? `@${payment.username}` : payment.telegramUserId}
                  </TableCell>
                  <TableCell>{payment.tariffId}</TableCell>
                  <TableCell>{formatCurrency(payment.amount)}</TableCell>
                  <TableCell>
                    <Badge variant={payment.status === "paid" ? "default" : payment.status === "failed" ? "destructive" : "secondary"}>
                      {payment.status === "paid" ? "Оплачен" : payment.status === "failed" ? "Ошибка" : "Ожидание"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {stats.recentPayments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                    Нет недавних платежей
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

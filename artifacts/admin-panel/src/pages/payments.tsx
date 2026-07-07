import { useState } from "react";
import { useListAdminPayments, getListAdminPaymentsQueryKey, ListAdminPaymentsStatus } from "@workspace/api-client-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { ChevronLeft, ChevronRight, Filter } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Payments() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<ListAdminPaymentsStatus | "all">("all");

  const queryStatus = statusFilter === "all" ? undefined : statusFilter;

  const { data, isLoading, isError } = useListAdminPayments(
    { page, limit: 10, status: queryStatus },
    { query: { queryKey: getListAdminPaymentsQueryKey({ page, limit: 10, status: queryStatus }) } }
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid': return <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20">Оплачен</Badge>;
      case 'failed': return <Badge variant="destructive">Ошибка</Badge>;
      case 'pending': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20">Ожидание</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Платежи</h1>
          <p className="text-muted-foreground mt-1">История транзакций пользователей</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Filter className="mr-2 h-4 w-4" />
                  Фильтр: {statusFilter === 'all' ? 'Все' : statusFilter === 'paid' ? 'Оплаченные' : statusFilter === 'pending' ? 'В ожидании' : 'Ошибки'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={statusFilter} onValueChange={(v) => { setStatusFilter(v as any); setPage(1); }}>
                  <DropdownMenuRadioItem value="all">Все статусы</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="paid">Оплаченные</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="pending">В ожидании</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="failed">Ошибки</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError || !data ? (
            <div className="text-center py-6 text-destructive">Ошибка загрузки платежей</div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID транзакции</TableHead>
                      <TableHead>Пользователь</TableHead>
                      <TableHead>Тариф</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                      <TableHead className="text-right">Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {payment.id.substring(0, 8)}...
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            {payment.username ? (
                              <span className="font-medium">@{payment.username}</span>
                            ) : (
                              <span className="font-medium text-muted-foreground italic">Без username</span>
                            )}
                            <span className="text-xs text-muted-foreground">{payment.telegramUserId}</span>
                          </div>
                        </TableCell>
                        <TableCell>{payment.tariffId}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(payment.amount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {getStatusBadge(payment.status)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          Платежи не найдены
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {data.total > 0 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    Показано {(page - 1) * 10 + 1} - {Math.min(page * 10, data.total)} из {data.total}
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Назад
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => p + 1)}
                      disabled={page * 10 >= data.total}
                    >
                      Вперед
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

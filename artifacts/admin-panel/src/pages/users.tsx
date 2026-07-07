import { useState, useEffect } from "react";
import { useListAdminUsers, useAdjustUserBalance, getListAdminUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import { Search, Plus, Minus, ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

function BalanceAdjustDialog({ userId, currentBalance, onSuccess }: { userId: string, currentBalance: number, onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const { toast } = useToast();
  
  const adjustBalance = useAdjustUserBalance();

  const handleAdjust = (type: 'add' | 'subtract') => {
    const val = parseInt(delta, 10);
    if (isNaN(val) || val <= 0) {
      toast({ title: "Ошибка", description: "Введите корректную сумму", variant: "destructive" });
      return;
    }
    
    const amount = type === 'add' ? val : -val;
    
    adjustBalance.mutate({ userId, data: { delta: amount } }, {
      onSuccess: () => {
        toast({ title: "Успешно", description: "Баланс обновлен" });
        setOpen(false);
        setDelta("");
        onSuccess();
      },
      onError: () => {
        toast({ title: "Ошибка", description: "Не удалось обновить баланс", variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Изменить баланс</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Управление балансом</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Текущий</Label>
            <div className="col-span-3 font-medium">{formatCurrency(currentBalance)}</div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="amount" className="text-right">Сумма (₽)</Label>
            <Input
              id="amount"
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              className="col-span-3"
              placeholder="100"
            />
          </div>
        </div>
        <DialogFooter className="flex space-x-2 justify-end">
          <Button 
            variant="destructive" 
            onClick={() => handleAdjust('subtract')}
            disabled={adjustBalance.isPending || !delta}
          >
            <Minus className="w-4 h-4 mr-2" />
            Списать
          </Button>
          <Button 
            onClick={() => handleAdjust('add')}
            disabled={adjustBalance.isPending || !delta}
          >
            <Plus className="w-4 h-4 mr-2" />
            Начислить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Users() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const queryClient = useQueryClient();

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const { data, isLoading, isError } = useListAdminUsers(
    { page, limit: 10, search: debouncedSearch || undefined },
    { query: { queryKey: getListAdminUsersQueryKey({ page, limit: 10, search: debouncedSearch || undefined }) } }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Пользователи</h1>
          <p className="text-muted-foreground mt-1">Управление клиентами и их балансами</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center space-x-2 max-w-sm">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по ID или @username..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9"
            />
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
            <div className="text-center py-6 text-destructive">Ошибка загрузки пользователей</div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Telegram ID</TableHead>
                      <TableHead>Username</TableHead>
                      <TableHead>Баланс</TableHead>
                      <TableHead>Подписки</TableHead>
                      <TableHead>Пробный</TableHead>
                      <TableHead>Последняя активность</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-mono text-sm">{user.id}</TableCell>
                        <TableCell>
                          {user.username ? `@${user.username}` : <span className="text-muted-foreground italic">нет</span>}
                        </TableCell>
                        <TableCell className="font-medium">{formatCurrency(user.balance)}</TableCell>
                        <TableCell>
                          <Badge variant={user.subscriptionCount > 0 ? "default" : "secondary"}>
                            {user.subscriptionCount}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {user.hasUsedTrial ? (
                            <Badge variant="outline" className="text-muted-foreground">Использован</Badge>
                          ) : (
                            <Badge variant="outline" className="text-primary border-primary/30">Доступен</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {user.lastActivityAt ? formatDate(user.lastActivityAt) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <BalanceAdjustDialog 
                            userId={user.id} 
                            currentBalance={user.balance} 
                            onSuccess={() => {
                              queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
                            }} 
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          Пользователи не найдены
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

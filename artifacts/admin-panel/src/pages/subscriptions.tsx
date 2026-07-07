import { useState } from "react";
import {
  useListAdminSubscriptions,
  useRenewSubscription,
  useDeleteSubscription,
  getListAdminSubscriptionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
import { formatDate } from "@/lib/format";
import { ChevronLeft, ChevronRight, Filter, RefreshCw, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

const TARIFFS = [
  { id: "1month", label: "1 месяц" },
  { id: "3month", label: "3 месяца" },
];

export default function Subscriptions() {
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "expired">("all");
  const [renewTarget, setRenewTarget] = useState<{ id: string; username: string | null } | null>(null);
  const [renewTariff, setRenewTariff] = useState("1month");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const queryActive = activeFilter === "all" ? undefined : activeFilter === "active";
  const queryKey = getListAdminSubscriptionsQueryKey({ page, limit: 10, active: queryActive });

  const { data, isLoading, isError } = useListAdminSubscriptions(
    { page, limit: 10, active: queryActive },
    { query: { queryKey } }
  );

  const renewMutation = useRenewSubscription({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["adminStats"] });
        queryClient.invalidateQueries({ queryKey: getListAdminSubscriptionsQueryKey({ page, limit: 10, active: queryActive }) });
        toast({ title: "Подписка продлена", description: "RoyaltyKey подтвердил продление." });
        setRenewTarget(null);
      },
      onError: () => {
        toast({ title: "Ошибка продления", variant: "destructive", description: "Проверьте баланс реселлера." });
      },
    },
  });

  const deleteMutation = useDeleteSubscription({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["adminStats"] });
        queryClient.invalidateQueries({ queryKey: getListAdminSubscriptionsQueryKey({ page, limit: 10, active: queryActive }) });
        toast({ title: "Подписка удалена", description: "Ключ деактивирован в RoyaltyKey." });
      },
      onError: () => {
        toast({ title: "Ошибка удаления", variant: "destructive" });
      },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Подписки</h1>
          <p className="text-muted-foreground mt-1">Активные и истекшие VPN-подписки</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Filter className="mr-2 h-4 w-4" />
                  Статус: {activeFilter === "all" ? "Все" : activeFilter === "active" ? "Активные" : "Истекшие"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={activeFilter} onValueChange={(v) => { setActiveFilter(v as "all" | "active" | "expired"); setPage(1); }}>
                  <DropdownMenuRadioItem value="all">Все</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="active">Только активные</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="expired">Только истекшие</DropdownMenuRadioItem>
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
            <div className="text-center py-6 text-destructive">Ошибка загрузки подписок</div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Пользователь</TableHead>
                      <TableHead>Тариф</TableHead>
                      <TableHead>VPN Ключ</TableHead>
                      <TableHead>Действует до</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((sub) => (
                      <TableRow key={sub.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            {sub.username ? (
                              <span className="font-medium">@{sub.username}</span>
                            ) : (
                              <span className="font-medium text-muted-foreground italic">Без username</span>
                            )}
                            <span className="text-xs text-muted-foreground">{sub.telegramUserId}</span>
                          </div>
                        </TableCell>
                        <TableCell>{sub.tariffId}</TableCell>
                        <TableCell>
                          {sub.vpnKey ? (
                            <Tooltip>
                              <TooltipTrigger className="font-mono text-xs px-2 py-1 bg-muted rounded truncate max-w-[140px] inline-block">
                                {sub.vpnKey}
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="font-mono text-xs break-all max-w-xs">{sub.vpnKey}</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground text-sm italic">Не выдан</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{formatDate(sub.expiresAt)}</TableCell>
                        <TableCell>
                          {sub.isActive ? (
                            <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20">Активна</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-muted-foreground">Истекла</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {/* Кнопка «Продлить» */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2 text-blue-400 border-blue-400/30 hover:bg-blue-400/10"
                              onClick={() => {
                                setRenewTarget({ id: sub.id, username: sub.username ?? null });
                                setRenewTariff(sub.tariffId || "1month");
                              }}
                            >
                              <RefreshCw className="h-3.5 w-3.5 mr-1" />
                              Продлить
                            </Button>

                            {/* Кнопка «Удалить» */}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                                  disabled={deleteMutation.isPending}
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                                  Удалить
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Удалить подписку?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Ключ будет деактивирован в RoyaltyKey и удалён из базы.{" "}
                                    {sub.username ? `Пользователь @${sub.username}` : `ID ${sub.telegramUserId}`} потеряет доступ к VPN.
                                    Это действие нельзя отменить.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive hover:bg-destructive/90"
                                    onClick={() => deleteMutation.mutate({ id: sub.id })}
                                  >
                                    Удалить
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          Подписки не найдены
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {data.total > 0 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    Показано {(page - 1) * 10 + 1}–{Math.min(page * 10, data.total)} из {data.total}
                  </div>
                  <div className="flex space-x-2">
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                      <ChevronLeft className="h-4 w-4 mr-1" />Назад
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 10 >= data.total}>
                      Вперед<ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Диалог продления */}
      <Dialog open={!!renewTarget} onOpenChange={(open) => !open && setRenewTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Продлить подписку</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Пользователь: <span className="font-medium text-foreground">
                {renewTarget?.username ? `@${renewTarget.username}` : renewTarget?.id}
              </span>
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Тариф</label>
              <Select value={renewTariff} onValueChange={setRenewTariff}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARIFFS.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewTarget(null)}>Отмена</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={renewMutation.isPending}
              onClick={() => {
                if (renewTarget) {
                  renewMutation.mutate({ id: renewTarget.id, data: { tariffId: renewTariff } });
                }
              }}
            >
              {renewMutation.isPending ? "Продляем..." : "Продлить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { useCreateResellerClient, useGetResellerProfile } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Copy, Check, Wallet, Percent, Key } from "lucide-react";
import { formatCurrency } from "@/lib/format";

const TARIFFS = [
  { id: "1month", label: "1 месяц (300 ₽)", durationDays: 30 },
  { id: "3month", label: "3 месяца (800 ₽)", durationDays: 90 },
  { id: "trial_24h", label: "Пробный 24ч", durationDays: 1 },
];

export default function CreateClient() {
  const [label, setLabel] = useState("");
  const [tariffId, setTariffId] = useState("1month");
  const [result, setResult] = useState<{ id: string; vpnKey: string; expiresAt: string; tariffId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: reseller, isLoading: resellerLoading } = useGetResellerProfile({
    query: { queryKey: ["resellerProfile"] }
  });

  const createMutation = useCreateResellerClient({
    mutation: {
      onSuccess: (data) => {
        setResult(data);
        queryClient.invalidateQueries({ queryKey: ["resellerProfile"] });
        queryClient.invalidateQueries({ queryKey: ["adminStats"] });
        toast({ title: "Клиент создан", description: "VPN-ключ сгенерирован в RoyaltyKey." });
      },
      onError: () => {
        toast({ title: "Ошибка создания", variant: "destructive", description: "Проверьте баланс реселлера или тариф." });
      },
    },
  });

  const handleCopy = () => {
    if (result?.vpnKey) {
      navigator.clipboard.writeText(result.vpnKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleReset = () => {
    setResult(null);
    setLabel("");
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Создать клиента</h1>
        <p className="text-muted-foreground mt-1">Создание VPN-подписки напрямую через RoyaltyKey API</p>
      </div>

      {/* Баланс реселлера */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-blue-400/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Баланс реселлера</CardTitle>
            <Wallet className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            {resellerLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <div className="text-2xl font-bold text-blue-400">
                {reseller ? formatCurrency(reseller.balance) : "—"}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Скидка</CardTitle>
            <Percent className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            {resellerLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold text-emerald-400">
                {reseller ? `${reseller.discount}%` : "—"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Форма создания */}
      {!result ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Новый клиент
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Метка клиента <span className="text-muted-foreground font-normal">(необязательно)</span>
              </label>
              <Input
                placeholder="Например: Иван Петров или @username"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Используется как external_id в RoyaltyKey для идентификации
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Тариф</label>
              <Select value={tariffId} onValueChange={setTariffId}>
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

            <Button
              className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate({ data: { tariffId, label: label || undefined } })}
            >
              <UserPlus className="h-4 w-4 mr-2" />
              {createMutation.isPending ? "Создаём..." : "Создать клиента"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        /* Результат */
        <Card className="border-emerald-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-400">
              <Key className="h-5 w-5" />
              Клиент создан
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">ID в RoyaltyKey</span>
                <p className="font-mono font-medium mt-1">{result.id}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Тариф</span>
                <p className="font-medium mt-1">{result.tariffId}</p>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Действует до</span>
                <p className="font-medium mt-1">{new Date(result.expiresAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">VPN-ключ для клиента</label>
                <Badge variant="outline" className="text-emerald-400 border-emerald-400/30">Готов к выдаче</Badge>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 font-mono text-xs bg-muted rounded-md px-3 py-2 break-all select-all">
                  {result.vpnKey}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Нажмите на ключ для выделения или используйте кнопку копирования</p>
            </div>

            <Button variant="outline" className="w-full" onClick={handleReset}>
              Создать ещё одного клиента
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

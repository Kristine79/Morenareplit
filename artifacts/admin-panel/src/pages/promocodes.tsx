import { useListAdminPromocodes, useCreateAdminPromocode, getListAdminPromocodesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { Ticket, Plus } from "lucide-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  id: z.string().min(3, "Код должен быть от 3 символов").max(20, "Код слишком длинный").regex(/^[A-Za-z0-9_-]+$/, "Только буквы, цифры, тире и подчеркивания"),
  bonusAmount: z.coerce.number().min(1, "Сумма должна быть больше 0").max(100000, "Слишком большая сумма"),
  maxUses: z.coerce.number().min(1, "Минимум 1 использование").max(100000, "Слишком много использований"),
});

export default function Promocodes() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError } = useListAdminPromocodes({
    query: { queryKey: getListAdminPromocodesQueryKey() }
  });

  const createMutation = useCreateAdminPromocode();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      id: "",
      bonusAmount: 100,
      maxUses: 10,
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    createMutation.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "Успешно", description: "Промокод создан" });
        form.reset();
        queryClient.invalidateQueries({ queryKey: getListAdminPromocodesQueryKey() });
      },
      onError: (err: any) => {
        toast({ 
          title: "Ошибка", 
          description: err?.message || "Не удалось создать промокод (возможно, он уже существует)", 
          variant: "destructive" 
        });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Промокоды</h1>
        <p className="text-muted-foreground mt-1">Управление бонусами и акциями</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 h-fit">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Plus className="w-5 h-5 mr-2 text-primary" />
              Новый промокод
            </CardTitle>
            <CardDescription>
              Создайте промокод, который пользователи смогут активировать в боте
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Код промокода</FormLabel>
                      <FormControl>
                        <Input placeholder="SUMMER2024" {...field} className="font-mono uppercase" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bonusAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Бонус (₽)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="maxUses"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Лимит активаций</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button 
                  type="submit" 
                  className="w-full"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Создание..." : "Создать промокод"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Ticket className="w-5 h-5 mr-2 text-primary" />
              Список промокодов
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : isError || !data ? (
              <div className="text-center py-6 text-destructive">Ошибка загрузки промокодов</div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Код</TableHead>
                      <TableHead className="text-right">Бонус</TableHead>
                      <TableHead className="text-center">Активации</TableHead>
                      <TableHead className="text-right">Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((promo) => {
                      const isExhausted = promo.usesCount >= promo.maxUses;
                      return (
                        <TableRow key={promo.id} className={isExhausted ? "opacity-50" : ""}>
                          <TableCell className="font-mono font-bold">
                            {promo.id}
                          </TableCell>
                          <TableCell className="text-right font-medium text-emerald-500">
                            +{formatCurrency(promo.bonusAmount)}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="font-medium">{promo.usesCount}</span>
                            <span className="text-muted-foreground"> / {promo.maxUses}</span>
                            <div className="w-full bg-secondary h-1.5 mt-1 rounded-full overflow-hidden">
                              <div 
                                className={`h-full ${isExhausted ? "bg-destructive" : "bg-primary"}`} 
                                style={{ width: `${Math.min(100, (promo.usesCount / promo.maxUses) * 100)}%` }}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {isExhausted ? (
                              <Badge variant="secondary">Исчерпан</Badge>
                            ) : (
                              <Badge className="bg-primary/20 text-primary hover:bg-primary/30 border-primary/20">Активен</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {data.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          Нет доступных промокодов
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
